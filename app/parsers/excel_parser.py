import pandas as pd
import re
import os
import unicodedata


def normalize_col(value):
    text = str(value or "").strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))

    tr_map = str.maketrans({
        "ı": "i", "ğ": "g", "ü": "u",
        "ş": "s", "ö": "o", "ç": "c"
    })
    text = text.translate(tr_map)

    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean_text(val):
    if val is None or pd.isna(val):
        return ""
    text = str(val).strip()
    if text.lower() in ["nan", "none", "null"]:
        return ""
    return text


def clean_number(val):
    if val is None or pd.isna(val):
        return 0.0

    text = str(val).strip()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))

    text = text.upper()
    text = text.replace("₺", "").replace("€", "").replace("$", "")
    text = text.replace("TL", "").replace("TRY", "").replace("USD", "").replace("EUR", "")
    text = text.replace("%", "")
    text = text.replace(",", ".")

    if text.count(".") > 1:
        parts = text.split(".")
        text = "".join(parts[:-1]) + "." + parts[-1]

    text = re.sub(r"[^0-9.\-]", "", text)

    try:
        return float(text)
    except Exception:
        return 0.0


def find_header_row(df):
    for i in range(len(df)):
        row_text = " ".join(normalize_col(x) for x in df.iloc[i].values)

        has_desc = (
            "urun aciklamasi" in row_text
            or "aciklama" in row_text
            or "malzeme adi" in row_text
            or "malzeme tanimi" in row_text
        )
        has_qty = "miktar" in row_text or "adet" in row_text or "quantity" in row_text
        has_price = "birim fiyat" in row_text or "unit price" in row_text

        if has_desc and has_qty and has_price:
            return i

    return 0


def find_col_exact_or_contains(columns, keywords, exclude_keywords=None):
    exclude_keywords = exclude_keywords or []
    normalized = {col: normalize_col(col) for col in columns}

    def allowed(clean):
        return not any(normalize_col(ex) in clean for ex in exclude_keywords)

    for col, clean in normalized.items():
        if not allowed(clean):
            continue
        for key in keywords:
            if normalize_col(key) == clean:
                return col

    for col, clean in normalized.items():
        if not allowed(clean):
            continue
        for key in keywords:
            if normalize_col(key) in clean:
                return col

    return None


def detect_firma_adi(df, fallback_firma, file_name):
    for _, row in df.head(8).iterrows():
        cells = [clean_text(x) for x in row.values if clean_text(x)]
        if not cells:
            continue

        joined = " ".join(cells)
        norm = normalize_col(joined)

        if "firma" in norm or "tedarikci" in norm or "satici" in norm:
            for i, cell in enumerate(cells):
                c = normalize_col(cell)
                if "firma" in c or "tedarikci" in c or "satici" in c:
                    if i + 1 < len(cells):
                        return cells[i + 1]

        if len(cells) == 1:
            one = cells[0]
            one_norm = normalize_col(one)
            if (
                len(one) >= 3
                and "teklif" not in one_norm
                and "urun" not in one_norm
                and "miktar" not in one_norm
                and "fiyat" not in one_norm
            ):
                return one

    if fallback_firma:
        return fallback_firma

    return os.path.splitext(file_name)[0].replace("_", " ").replace("-", " ").title()


def detect_footer_info(df):
    vade = ""
    termin = ""
    dip_toplam = 0.0
    kdv = 0.0
    genel_toplam = 0.0

    for _, row in df.iterrows():
        cells = [clean_text(x) for x in row.values]
        joined = " ".join(cells)
        norm = normalize_col(joined)
        nums = [clean_number(x) for x in cells if clean_number(x) > 0]

        if "vade" in norm or "odeme" in norm:
            vade = joined

        if "termin" in norm or "teslim" in norm:
            termin = joined

        if "dip toplam" in norm or "ara toplam" in norm:
            if nums:
                dip_toplam = nums[-1]

        if "kdv" in norm:
            if nums:
                kdv = nums[-1]

        if "genel toplam" in norm or "yekun" in norm:
            if nums:
                genel_toplam = nums[-1]

    return {
        "vade": vade,
        "termin": termin,
        "dipToplam": dip_toplam,
        "kdv": kdv,
        "genelToplam": genel_toplam,
    }


def parse_excel(file_path, firma_adi="", file_name=""):
    raw_df = pd.read_excel(file_path, header=None)

    firma = detect_firma_adi(raw_df, firma_adi, file_name)
    footer = detect_footer_info(raw_df)
    header_row = find_header_row(raw_df)

    df = raw_df.copy()
    df.columns = df.iloc[header_row]
    df = df[header_row + 1:]
    df = df.dropna(how="all")

    code_col = find_col_exact_or_contains(df.columns, [
        "urun kodu",
        "malzeme kodu",
        "stok kodu",
        "kod",
    ], exclude_keywords=["sira", "sıra", "s no"])

    desc_col = find_col_exact_or_contains(df.columns, [
        "urun aciklamasi",
        "aciklama",
        "malzeme adi",
        "malzeme tanimi",
        "ürün",
        "urun",
        "ÜRÜN",
        "URUN",
    ], exclude_keywords=["kod", "sira", "sıra"])

    qty_col = find_col_exact_or_contains(df.columns, [
        "miktar",
        "adet",
        "teklif miktari",
        "firma adedi",
        "quantity",
    ])

    unit_col = find_col_exact_or_contains(df.columns, [
        "birim",
        "unit",
    ], exclude_keywords=["fiyat"])

    price_col = find_col_exact_or_contains(df.columns, [
        "birim fiyat",
        "unit price",
        "fiyat",
        "FIYAT",
        "FİYAT",
        "FIYAT",
    ], exclude_keywords=[
        "iskontolu",
        "net",
        "toplam",
        "tutar",
        "satir",
        "satır",
        "iskonto",
        "indirim",
    ])

    discount_col = find_col_exact_or_contains(df.columns, [
        "iskonto",
        "indirim",
        "discount",
    ], exclude_keywords=[
        "iskontolu fiyat",
        "net fiyat",
    ])

    net_price_col = find_col_exact_or_contains(df.columns, [
        "iskontolu fiyat",
        "net fiyat",
        "net birim fiyat",
    ])

    total_col = find_col_exact_or_contains(df.columns, [
        "satir toplami",
        "satir toplam",
        "toplam tutar",
        "tutar",
        "net toplam",
    ], exclude_keywords=[
        "genel toplam",
        "dip toplam",
        "ara toplam",
    ])

    rows = []

    print("EXCEL PARSER DEBUG:", {
        "file": file_name,
        "firma": firma,
        "header_row": header_row,
        "columns": [str(c) for c in df.columns],
        "code_col": str(code_col),
        "desc_col": str(desc_col),
        "qty_col": str(qty_col),
        "unit_col": str(unit_col),
        "price_col": str(price_col),
        "discount_col": str(discount_col),
        "net_price_col": str(net_price_col),
        "total_col": str(total_col),
    })

    for _, r in df.iterrows():
        code = clean_text(r.get(code_col)) if code_col is not None else ""
        desc = clean_text(r.get(desc_col)) if desc_col is not None else ""

        if not code and not desc:
            continue

        desc_norm = normalize_col(desc)

        if any(x in desc_norm for x in [
            "toplam",
            "dip toplam",
            "ara toplam",
            "genel toplam",
            "kdv",
            "vade",
            "termin",
            "teslim",
            "firma",
            "teklif",
            "not",
        ]):
            continue

        qty = clean_number(r.get(qty_col)) if qty_col is not None else 0.0
        unit = clean_text(r.get(unit_col)) if unit_col is not None else "adet"

        price = clean_number(r.get(price_col)) if price_col is not None else 0.0
        discount = clean_number(r.get(discount_col)) if discount_col is not None else 0.0
        net_price_from_file = clean_number(r.get(net_price_col)) if net_price_col is not None else 0.0
        row_total_from_file = clean_number(r.get(total_col)) if total_col is not None else 0.0

        if price <= 0 and net_price_from_file > 0:
            price = net_price_from_file

        if discount <= 0 and price > 0 and net_price_from_file > 0 and net_price_from_file < price:
            discount = round((1 - (net_price_from_file / price)) * 100, 4)

        net_unit_calculated = price * (1 - discount / 100)
        row_total_calculated = net_unit_calculated * qty if qty > 0 else 0.0

        if row_total_from_file <= 0:
            row_total_from_file = row_total_calculated

        if qty <= 0 or price <= 0:
            continue

        rows.append({
            "firma": firma,
            "firmaAdi": firma,
            "urunKodu": code,
            "urunAciklamasi": desc,
            "birim": unit or "adet",
            "firmaAdedi": qty,
            "paraBirimi": "TRY",
            "birimFiyat": price,
            "iskonto": discount,
            "netBirimFiyatDosyadan": net_price_from_file,
            "satirToplamDosyadan": row_total_from_file,
            "vade": footer.get("vade", ""),
            "termin": footer.get("termin", ""),
            "firmaDipToplam": footer.get("dipToplam", 0),
            "firmaKdv": footer.get("kdv", 0),
            "firmaGenelToplam": footer.get("genelToplam", 0),
            "kaynakDosya": file_name,
            "kaynakTipi": "excel",
            "parserUyarilari": [],
        })

    print("EXCEL OKUNAN SATIR SAYISI:", len(rows))
    print("EXCEL İLK 5 SATIR:", rows[:5])

    return rows