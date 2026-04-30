import pandas as pd
import re


def normalize_col(value):
    text = str(value or "").strip().lower()
    text = text.replace("ı", "i").replace("ğ", "g").replace("ü", "u")
    text = text.replace("ş", "s").replace("ö", "o").replace("ç", "c")
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def find_header_row(df):
    for i in range(len(df)):
        row = " ".join(normalize_col(x) for x in df.iloc[i].values)
        if ("urun" in row or "malzeme" in row) and ("fiyat" in row or "miktar" in row or "adet" in row):
            return i
    return 0


def find_col(columns, keywords):
    normalized = {col: normalize_col(col) for col in columns}

    for col, clean in normalized.items():
        for key in keywords:
            if normalize_col(key) in clean:
                return col

    return None


def clean_number(val):
    if val is None or pd.isna(val):
        return 0

    text = str(val).strip()
    text = text.replace("₺", "").replace("€", "").replace("$", "").replace("%", "")
    text = text.replace(",", ".")
    text = re.sub(r"[^0-9.\-]", "", text)

    try:
        return float(text)
    except:
        return 0


def clean_text(val):
    if val is None or pd.isna(val):
        return ""
    text = str(val).strip()
    if text.lower() in ["nan", "none", "null"]:
        return ""
    return text


def parse_excel(file_path, firma_adi, file_name):
    df = pd.read_excel(file_path, header=None)

    header_row = find_header_row(df)
    df.columns = df.iloc[header_row]
    df = df[header_row + 1:]
    df = df.dropna(how="all")

    code_col = find_col(df.columns, [
        "urun kodu", "ürün kodu", "malzeme kodu", "stok kodu", "kod"
    ])

    desc_col = find_col(df.columns, [
        "urun aciklamasi", "ürün açıklaması", "aciklama", "açıklama", "malzeme", "urun"
    ])

    qty_col = find_col(df.columns, [
        "teklif miktari", "teklif miktarı", "miktar", "adet", "firma adedi", "quantity"
    ])

    unit_col = find_col(df.columns, [
        "birim", "unit"
    ])

    currency_col = find_col(df.columns, [
        "para birimi", "doviz", "döviz", "kur", "currency"
    ])

    price_col = find_col(df.columns, [
        "birim fiyat tl",
        "birim fiyat try",
        "birim fiyat",
        "birim fiyati",
        "birim fiyatı",
        "fiyat",
        "unit price",
        "price"
    ])

    discount_col = find_col(df.columns, [
        "iskonto", "indirim", "discount"
    ])

    term_col = find_col(df.columns, [
        "teslim suresi", "teslim süresi", "termin", "vade", "delivery"
    ])

    rows = []

    for _, r in df.iterrows():
        code = clean_text(r.get(code_col)) if code_col is not None else ""
        desc = clean_text(r.get(desc_col)) if desc_col is not None else ""
        qty = clean_number(r.get(qty_col)) if qty_col is not None else 0
        unit = clean_text(r.get(unit_col)) if unit_col is not None else "adet"
        currency = clean_text(r.get(currency_col)) if currency_col is not None else "TRY"
        price = clean_number(r.get(price_col)) if price_col is not None else 0
        term = clean_text(r.get(term_col)) if term_col is not None else ""

        if not code and not desc:
            continue

        rows.append({
            "firmaAdi": firma_adi,
            "urunKodu": code,
            "urunAciklamasi": desc,
            "birim": unit or "adet",
            "firmaAdedi": qty,
            "paraBirimi": currency or "TRY",
            "birimFiyat": price,
            "iskonto": clean_number(r.get(discount_col)) if discount_col is not None else 0,
            "vade": "",
            "termin": term,
            "kaynakDosya": file_name,
            "kaynakTipi": "excel",
        })

    return rows