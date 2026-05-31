import pandas as pd
import re
import os
import unicodedata
from openpyxl import load_workbook


SECTION_NAMES = {
    "trafo",
    "kompanzasyon",
    "adp",
    "uadp",
    "sgn-t",
    "bk-t1",
    "bk-t2",
    "cms-kt-2",
    "cms-kt1",
    "mtf-t",
    "mtf-kt",
    "kzn-kt",
    "zk-t1",
    "zk-t2",
    "1k-t1",
    "1k-t2",
    "atl-at1",
    "atl-at2",
    "atl-at3",
    "atl-at4",
    "atl-at5",
    "2k-t1",
}


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


def canonical_section_name(value):
    text = normalize_col(value)
    compact = re.sub(r"[-_\s]+", "", text)

    for section_name in SECTION_NAMES:
        if compact == re.sub(r"[-_\s]+", "", section_name):
            return section_name.upper()

    return ""


def money_equals(left, right, tolerance=0.05):
    return abs(float(left or 0) - float(right or 0)) <= tolerance


def row_numbers(values):
    numbers = []

    for value in values:
        number = clean_number(value)

        if number > 0:
            numbers.append(number)

    return numbers


def choose_kdv_excluded_total(numbers):
    positive = sorted({round(float(number), 2) for number in numbers if float(number or 0) > 0})

    if not positive:
        return 0

    if len(positive) >= 2:
        for lower in positive:
            for higher in positive:
                if higher <= lower:
                    continue

                if money_equals(higher, lower * 1.20, max(0.50, lower * 0.01)):
                    return lower

    return positive[-1]


def choose_section_total(row_total, numbers):
    net_total = choose_kdv_excluded_total(numbers)

    if row_total > 0 and net_total > 0 and money_equals(row_total, net_total * 1.20, max(0.50, net_total * 0.01)):
        return net_total

    return row_total or net_total


def is_meaningful_section_label(value):
    text = clean_text(value)

    if not text:
        return False

    norm = normalize_col(text)

    if not norm or norm in ["-", "_", "tl", "try", "eur", "usd"]:
        return False

    if clean_number(text) > 0:
        return False

    return bool(re.search(r"[a-z0-9]", norm))


def is_section_fill_rgb(rgb):
    if not rgb:
        return False

    value = str(rgb).replace("#", "").upper()

    if len(value) == 8:
        value = value[2:]

    if len(value) != 6:
        return False

    try:
        red = int(value[0:2], 16)
        green = int(value[2:4], 16)
        blue = int(value[4:6], 16)
    except ValueError:
        return False

    if red >= 245 and green >= 245 and blue >= 245:
        return False

    # Section/group rows are marked with yellow/gold fills in supplier
    # workbooks. Other colors are often status colors for normal product rows.
    return red >= 200 and green >= 150 and blue <= 190


def highlighted_rows(file_path):
    try:
        workbook = load_workbook(file_path, read_only=False, data_only=True)
    except Exception:
        return set()

    sheet = workbook.worksheets[0]
    rows = set()

    for row in sheet.iter_rows():
        filled_cells = 0

        for cell in row:
            fill = cell.fill

            if not fill or fill.fill_type in [None, "none"]:
                continue

            fg_color = fill.fgColor
            rgb = fg_color.rgb if fg_color and fg_color.type == "rgb" else ""

            if (
                fill.fill_type == "solid"
                and fg_color
                and fg_color.type == "indexed"
                and fg_color.indexed in [5, 6, 13, 19, 22, 36, 44]
            ):
                filled_cells += 1
                continue

            if is_section_fill_rgb(rgb):
                filled_cells += 1

        if filled_cells > 0:
            rows.add(row[0].row)

    workbook.close()
    return rows


def section_name_from_cells(cells):
    text_cells = [
        clean_text(cell)
        for cell in cells
        if is_meaningful_section_label(cell)
    ]

    if not text_cells:
        return ""

    return clean_text(text_cells[0]).upper()


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


def should_skip_context_line(line):
    norm = normalize_col(line)

    if re.search(r"\b[tf]\s*\+?\s*\d", norm) or re.search(r"\b[tf]\s*\d", norm):
        return True

    skip_words = [
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
        "telefon",
        "tel",
        "faks",
        "fax",
        "mail",
        "email",
        "www",
        "musteri onayi",
        "musteri onay",
        "teyit ediniz",
        "siparisin onayi",
        "siparis onayi",
        "teknik cizim",
        "uretime baslanacak",
        "teslimat suresi",
        "uretim hatalari",
        "saha revizyonlari",
        "servis ucreti",
        "konaklama",
        "ulasim ucreti",
    ]

    return any(word in norm for word in skip_words)


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
    audit = parse_excel_with_audit(file_path, firma_adi, file_name)
    return audit["rows"]


def parse_excel_with_audit(file_path, firma_adi="", file_name=""):
    raw_df = pd.read_excel(file_path, header=None)
    highlighted_excel_rows = highlighted_rows(file_path)

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

    brand_col = find_col_exact_or_contains(df.columns, [
        "marka",
        "brand",
        "uretici",
        "üretici",
    ])

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
    sections = []
    errors = []
    warnings = []
    pending_rows = []

    def attach_section_to_pending(section):
        if not pending_rows:
            warnings.append(f"{section['section_name']} toplamı bulundu ama üstünde bağlanacak malzeme satırı yok.")
            return

        for row in pending_rows:
            row["section_name"] = section["section_name"]
            row["section_total"] = section["section_total"]
            row["birimFiyat"] = 0
            row["netBirimFiyatDosyadan"] = 0
            row["satirToplamDosyadan"] = 0
            row["price_status"] = "section_total_only"

        warnings.append(
            f"{section['section_name']} toplamı üstündeki {len(pending_rows)} malzemeye bağlandı; parça fiyatları aktarılmadı."
        )
        pending_rows.clear()

    print("EXCEL PARSER DEBUG:", {
        "file": file_name,
        "firma": firma,
        "header_row": header_row,
        "columns": [str(c) for c in df.columns],
        "code_col": str(code_col),
        "brand_col": str(brand_col),
        "desc_col": str(desc_col),
        "qty_col": str(qty_col),
        "unit_col": str(unit_col),
        "price_col": str(price_col),
        "discount_col": str(discount_col),
        "net_price_col": str(net_price_col),
        "total_col": str(total_col),
    })

    for row_index, r in df.iterrows():
        code = clean_text(r.get(code_col)) if code_col is not None else ""
        brand = clean_text(r.get(brand_col)) if brand_col is not None else ""
        desc = clean_text(r.get(desc_col)) if desc_col is not None else ""
        cells = [clean_text(x) for x in r.values]
        joined = " ".join(cells)

        desc_norm = normalize_col(desc)
        numbers = row_numbers(cells)
        row_total_from_file = clean_number(r.get(total_col)) if total_col is not None else 0.0
        if row_total_from_file <= 0 and numbers:
            row_total_from_file = numbers[-1]
        is_highlight_section = (int(row_index) + 1) in highlighted_excel_rows
        section_name = (
            canonical_section_name(desc)
            or canonical_section_name(code)
            or canonical_section_name(brand)
            or canonical_section_name(joined)
        )

        if is_highlight_section or section_name:
            section_total = choose_section_total(row_total_from_file, numbers)
            display_section_name = section_name or section_name_from_cells(cells)

            if not display_section_name:
                display_section_name = f"BÖLÜM-{len(sections) + 1}"

            section = {
                "section_name": display_section_name,
                "section_total": section_total,
            }
            sections.append(section)
            attach_section_to_pending(section)
            continue

        if not code and not desc:
            continue

        if should_skip_context_line(joined):
            continue

        qty = clean_number(r.get(qty_col)) if qty_col is not None else 0.0
        unit = clean_text(r.get(unit_col)) if unit_col is not None else "adet"

        price = clean_number(r.get(price_col)) if price_col is not None else 0.0
        discount = clean_number(r.get(discount_col)) if discount_col is not None else 0.0
        net_price_from_file = clean_number(r.get(net_price_col)) if net_price_col is not None else 0.0

        if price <= 0 and net_price_from_file > 0:
            price = net_price_from_file

        if discount <= 0 and price > 0 and net_price_from_file > 0 and net_price_from_file < price:
            discount = round((1 - (net_price_from_file / price)) * 100, 4)

        net_unit_calculated = price * (1 - discount / 100)
        row_total_calculated = net_unit_calculated * qty if qty > 0 else 0.0

        if row_total_calculated > 0 and (
            row_total_from_file <= 0
            or not money_equals(row_total_calculated, row_total_from_file, 0.10)
        ):
            row_total_from_file = row_total_calculated

        if not code or not brand or not desc:
            if should_skip_context_line(joined):
                continue
            errors.append(f"Şüpheli Excel satırı atlandı: kod/marka/açıklama eksik ({joined})")
            continue

        if qty <= 0:
            errors.append(f"Şüpheli Excel satırı atlandı: adet eksik ({desc})")
            continue

        price_status = "line_priced"

        if price <= 0 or row_total_from_file <= 0:
            price = 0
            net_price_from_file = 0
            row_total_from_file = 0
            price_status = "pending_section_total"

        if price_status == "line_priced" and not money_equals(row_total_calculated, row_total_from_file, 0.10):
            price = row_total_from_file / qty
            net_price_from_file = price
            discount = 0

        rows.append({
            "firma": firma,
            "firmaAdi": firma,
            "urunKodu": code,
            "urunAciklamasi": clean_text(f"{brand} {desc}"),
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
            "section_name": "",
            "section_total": 0,
            "price_status": price_status,
        })
        pending_rows.append(rows[-1])

    if sections and pending_rows:
        for row in pending_rows:
            row["birimFiyat"] = 0
            row["netBirimFiyatDosyadan"] = 0
            row["satirToplamDosyadan"] = 0
            row["price_status"] = "section_total_only"

        warnings.append(
            f"{len(pending_rows)} Excel malzeme satırı için sonraki kategori toplamı bulunamadı; parça fiyatları güvenli olarak aktarılmadı."
        )
        pending_rows.clear()

    ungrouped_pending = [row for row in pending_rows if row.get("price_status") == "pending_section_total"]
    if ungrouped_pending:
        errors.append(f"{len(ungrouped_pending)} Excel malzeme satırı fiyat/toplam satırıyla eşleşmedi.")

    checked_total = footer.get("dipToplam") or footer.get("genelToplam") or 0
    product_total = sum(float(row.get("satirToplamDosyadan") or 0) for row in rows)

    if checked_total > 0 and product_total > 0 and not money_equals(product_total, checked_total, 0.50):
        errors.append(
            f"Excel genel toplam tutmuyor: ürünler {product_total:.2f}, teklif {checked_total:.2f}"
        )

    print("EXCEL OKUNAN SATIR SAYISI:", len(rows))
    print("EXCEL İLK 5 SATIR:", rows[:5])

    return {
        "rows": rows,
        "sections": sections,
        "errors": errors,
        "warnings": warnings,
    }
