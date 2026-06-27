import re
import logging
import os
import unicodedata

logger = logging.getLogger("corvian.parsers.pdf")

import cv2
import numpy as np

from app.parsers.image_parser import (
    build_document_item,
    extract_document_items_from_text,
    normalize_document_item_unit,
    ocr_image_text,
)

try:
    import pdfplumber
except Exception:
    pdfplumber = None

try:
    from pdf2image import convert_from_path
except Exception:
    convert_from_path = None


def clean_text(val):
    if val is None:
        return ""
    text = str(val).strip()
    if text.lower() in ["nan", "none", "null"]:
        return ""
    return re.sub(r"\s+", " ", text)


def extract_pdf_ocr_text(file_path):
    if pdfplumber is None:
        raise RuntimeError("PDF okuma kütüphanesi yüklenemedi: pdfplumber")

    extracted_parts = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            if page_text.strip():
                extracted_parts.append(page_text.strip())

            for table in page.extract_tables() or []:
                for row in table or []:
                    row_text = " | ".join(
                        clean_text(cell) for cell in (row or []) if clean_text(cell)
                    )
                    if row_text:
                        extracted_parts.append(row_text)

    pdf_text = "\n".join(extracted_parts).strip()
    if pdf_text:
        return pdf_text, "pdfplumber"

    if convert_from_path is None:
        raise RuntimeError("Taranmış PDF dönüşümü için pdf2image yüklenemedi")

    page_texts = []
    try:
        pages = convert_from_path(file_path, dpi=300)
    except Exception as error:
        raise RuntimeError(f"Taranmış PDF görüntüye çevrilemedi: {error}") from error

    for page in pages:
        rgb_image = np.array(page)
        bgr_image = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR)
        text_value = ocr_image_text(bgr_image)
        if text_value.strip():
            page_texts.append(text_value.strip())

    return "\n".join(page_texts).strip(), "pdf2image-tesseract"


def _normalized_header(value):
    return normalize_tr(value).replace(" ", "_")


def extract_document_items_from_tables(tables):
    aliases = {
        "product_code": ("urun_kodu", "malzeme_kodu", "stok_kodu", "kod", "code"),
        "product_name": ("urun_adi", "malzeme_adi", "aciklama", "description"),
        "quantity": ("miktar", "adet", "quantity", "qty"),
        "unit": ("birim", "unit"),
        "unit_price": ("birim_fiyat", "fiyat", "unit_price"),
        "total": ("satir_toplami", "tutar", "toplam", "total"),
    }
    items = []

    for table in tables or []:
        rows = [row for row in (table or []) if row and any(clean_text(cell) for cell in row)]
        if len(rows) < 2:
            continue
        headers = [_normalized_header(cell) for cell in rows[0]]
        mapping = {}
        for field, names in aliases.items():
            exact_index = next(
                (index for index, header in enumerate(headers) if header in names), None
            )
            if exact_index is not None:
                mapping[field] = exact_index
                continue
            partial_index = next(
                (
                    index
                    for index, header in enumerate(headers)
                    if any(len(name) > 3 and name in header for name in names)
                ),
                None,
            )
            if partial_index is not None:
                mapping[field] = partial_index
        required = {"product_name", "quantity", "unit", "unit_price", "total"}
        if not required.issubset(mapping):
            continue

        for row in rows[1:]:
            def cell(field):
                index = mapping.get(field)
                return row[index] if index is not None and index < len(row) else None

            confidence = 95 if normalize_document_item_unit(cell("unit")) else 70
            item = build_document_item(
                cell("product_code"), cell("product_name"), cell("quantity"),
                cell("unit"), cell("unit_price"), cell("total"), confidence,
            )
            if item:
                items.append(item)

    return items


def extract_pdf_ocr_result(file_path):
    """Return OCR text plus line items, preferring structured pdfplumber tables."""
    if pdfplumber is None:
        raise RuntimeError("PDF okuma kütüphanesi yüklenemedi: pdfplumber")

    extracted_parts = []
    tables = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            if page_text.strip():
                extracted_parts.append(page_text.strip())
            page_tables = page.extract_tables() or []
            tables.extend(page_tables)
            for table in page_tables:
                for row in table or []:
                    row_text = " | ".join(clean_text(cell) for cell in (row or []) if clean_text(cell))
                    if row_text:
                        extracted_parts.append(row_text)

    pdf_text = "\n".join(extracted_parts).strip()
    table_items = extract_document_items_from_tables(tables)
    if pdf_text:
        return pdf_text, "pdfplumber-table" if table_items else "pdfplumber-regex", (
            table_items or extract_document_items_from_text(pdf_text)
        )

    ocr_text, engine = extract_pdf_ocr_text(file_path)
    return ocr_text, f"{engine}-regex", extract_document_items_from_text(ocr_text)

def normalize_tr(val):
    text = str(val or "").lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    replacements = {
        "ı": "i",
        "i̇": "i",
        "ğ": "g",
        "ü": "u",
        "ş": "s",
        "ö": "o",
        "ç": "c",
        "Ä±": "i",
        "Ä°": "i",
        "ÄŸ": "g",
        "Ã¼": "u",
        "ÅŸ": "s",
        "Ã¶": "o",
        "Ã§": "c",
        "̇": "",
    }

    for source, target in replacements.items():
        text = text.replace(source.lower(), target)

    return clean_text(text)

def clean_number(val):
    if val is None:
        return 0.0

    s = str(val).strip()
    s = re.sub(r"(?<=\d)\s+(?=\d)", "", s)
    s = s.replace("₺", "").replace("€", "").replace("£", "")
    s = s.replace("â‚º", "").replace("â‚¬", "").replace("Â£", "")
    s = s.replace("TL", "").replace("TRY", "")
    s = s.replace("$", "").replace("USD", "")
    s = s.replace("€", "").replace("EUR", "").replace("GBP", "")
    s = s.replace("%", "")
    s = s.replace(",", ".")

    if s.count(".") > 1:
        parts = s.split(".")
        s = "".join(parts[:-1]) + "." + parts[-1]

    s = re.sub(r"[^0-9.\-]", "", s)

    try:
        return float(s)
    except Exception:
        return 0.0


def money_values_from_line(line):
    text = clean_text(line)
    if not text:
        return []

    currency_pattern = r"(?:₺|TL|TRY|\$|USD|€|EUR|£|GBP|â‚º|â‚¬|Â£)"
    values = []

    for match in re.finditer(currency_pattern + r"\s*([0-9][0-9\s.,]*)", text, flags=re.IGNORECASE):
        value = clean_number(match.group(1))
        if value > 0:
            values.append(value)

    for match in re.finditer(r"([0-9][0-9\s.,]*)\s*" + currency_pattern, text, flags=re.IGNORECASE):
        value = clean_number(match.group(1))
        if value > 0:
            values.append(value)

    return values


def detect_currency(text):
    text = str(text or "").upper()

    if "€" in text or "â‚¬" in text or re.search(r"\b(EUR|EURO)\b", text):
        return "EUR"
    if "£" in text or "Â£" in text or re.search(r"\b(GBP|STERLIN)\b", text):
        return "GBP"
    if "$" in text or re.search(r"\b(USD|DOLAR)\b", text):
        return "USD"
    return "TRY"


MONEY_RE = r"\d[\d.,]*"
UNIT_RE = r"adet|ad|pcs|kutu|metre|mt|m|adet"
CURRENCY_RE = r"₺|TL|TRY|\$|USD|€|EUR|£|GBP"


def clean_unit(value):
    unit = normalize_tr(value)

    if unit in ["ad", "adet", "pcs"]:
        return "adet"
    if unit in ["mt", "m", "metre"]:
        return "metre"
    if unit:
        return unit

    return "adet"


def clean_product_description(value):
    text = clean_text(value)
    text = re.sub(r"\(\s*\d{4,}\s*\)", " ", text)
    text = re.sub(
        r"\b\d+(?:[.,]\d+)?\s*(?:adet|ad)\s+(?:stok|sipariş|siparis|hazır|hazir)\s+\d+(?:[.,]\d+)?\s*(?:adet|ad)\b",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    return clean_text(text)


def parsed_offer_row(code, description, quantity, unit_price, line_total, currency, unit="adet", discount=0, term=""):
    qty = clean_number(quantity)
    net_price = clean_number(unit_price)
    total = clean_number(line_total)
    clean_description = clean_product_description(description)
    clean_term = clean_text(re.sub(r"\s*(?:TL|TRY|USD|EUR|GBP|₺|€|£|\$)\s*$", "", clean_text(term), flags=re.IGNORECASE))

    if not clean_description or qty <= 0 or (net_price <= 0 and total <= 0):
        return None

    if net_price <= 0 and total > 0:
        net_price = total / qty

    if total <= 0 and net_price > 0:
        total = net_price * qty

    return {
        "urunKodu": clean_text(code),
        "urunAciklamasi": clean_description,
        "birim": clean_unit(unit),
        "firmaAdedi": qty,
        "paraBirimi": currency or "TRY",
        "birimFiyat": net_price,
        "iskonto": clean_number(discount),
        "netBirimFiyat": net_price,
        "netToplam": total,
        "vade": "",
        "termin": clean_term,
    }


def money_equals(left, right, tolerance=0.05):
    return abs(float(left or 0) - float(right or 0)) <= tolerance


def canonical_section_name(value):
    return ""


def extract_project_main_group_name(full_text, fallback_name=""):
    text = clean_text(full_text)
    if text:
        match = re.search(
            r"PROJE\s*ADI\s*:?\s*(.+?)(?:\s+E-?MA[Iİ]L|\s+ŞALT|\s+SALT|\s+TEKL[Iİ]F|\n|$)",
            text,
            flags=re.IGNORECASE,
        )
        if match:
            project_title = clean_text(match.group(1))
            if project_title:
                return project_title.upper()

    clean_fallback = clean_text(os.path.splitext(fallback_name or "")[0].replace("_", " ").replace("-", " "))
    return clean_fallback.upper() if clean_fallback else "DOSYADAN AKTARILAN ANA KALEM"


def is_meaningful_section_label(value):
    text = clean_text(value)

    if not text:
        return False

    low = normalize_tr(text)
    normalized = re.sub(r"[^a-z0-9]", "", low)

    if not normalized or normalized in ["tl", "try", "eur", "usd"]:
        return False

    if len(normalized) <= 1:
        return False

    has_letters = bool(re.search(r"[a-z]", normalized))

    if clean_number(text) > 0 and (not has_letters or any(currency in low for currency in ["eur", "euro", "usd", "try", "tl", "₺", "€", "$"])):
        return False

    return True


def section_name_from_cells(cells):
    text_cells = []

    for cell in cells:
        text = clean_text(cell)

        if not is_meaningful_section_label(text):
            continue

        low = normalize_tr(text)
        if low in ["-", "_"] or should_skip_line(low):
            continue

        text_cells.append(text)

    if not text_cells:
        return ""

    return clean_text(max(text_cells, key=lambda value: len(normalize_tr(value)))).upper()


def looks_like_section_total_row(cells, code, brand, description, quantity, line_total):
    numbers = row_numbers(cells)
    effective_total = line_total or choose_section_total(0, numbers)
    effective_quantity = infer_quantity_from_cells(cells, quantity, effective_total)

    if effective_total <= 0:
        return False

    joined = " ".join(clean_text(cell) for cell in cells)

    if should_skip_line(joined) or is_product_table_header(joined):
        return False

    has_product_identity = bool(code and brand and description)

    if has_product_identity and quantity > 0:
        return False

    # PDF exports can shift columns. If a row has a meaningful title, quantity
    # and total but misses code/brand/detail fields, it is a main item candidate.
    return bool(section_name_from_cells(cells)) and effective_quantity > 0


def is_section_name(value):
    return bool(canonical_section_name(value))


def row_numbers(cells):
    numbers = []

    for cell in cells:
        value = clean_number(cell)

        if value > 0:
            numbers.append(value)

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


def choose_section_total(line_total, numbers):
    net_total = choose_kdv_excluded_total(numbers)

    if line_total > 0 and net_total > 0 and money_equals(line_total, net_total * 1.20, max(0.50, net_total * 0.01)):
        return net_total

    return line_total or net_total


def infer_quantity_from_cells(cells, explicit_quantity, total):
    if explicit_quantity > 0:
        return explicit_quantity

    first_cell_number = clean_number(cells[0]) if cells else 0
    candidates = []

    for index, cell in enumerate(cells):
        normalized = re.sub(r"[^a-z0-9]", "", normalize_tr(cell))
        if re.search(r"[a-z]", normalized):
            continue

        value = clean_number(cell)

        if value <= 0:
            continue

        if total > 0 and money_equals(value, total, 0.01):
            continue

        # The first PDF table column is often only the row number.
        if index == 0 and first_cell_number > 0:
            continue

        if float(value).is_integer() and value <= 10000:
            candidates.append(value)

    return candidates[0] if candidates else 0


def is_product_table_header(line):
    low = normalize_tr(line)

    return (
        ("no" in low or "sira" in low)
        and "malzeme" in low
        and "kod" in low
        and ("aciklama" in low or "cinsi" in low or "malzeme" in low)
        and ("adet" in low or "miktar" in low or "ad/mt" in low or "ad mt" in low)
        and ("tutar" in low or "net fiyat" in low or "fiyat" in low)
    )


def detect_company_name(full_text, fallback_firma, file_name):
    lines = [clean_text(x) for x in full_text.split("\n") if clean_text(x)]

    for line in lines[:10]:
        low = line.lower()

        if "firma" in low or "tedarikçi" in low or "tedarikci" in low or "satıcı" in low or "satici" in low:
            parts = re.split(r":|-", line, maxsplit=1)
            if len(parts) > 1 and clean_text(parts[1]):
                return clean_text(parts[1])

        if (
            len(line) >= 3
            and "teklif" not in low
            and "ürün" not in low
            and "urun" not in low
            and "fiyat" not in low
            and "miktar" not in low
        ):
            return line

    if fallback_firma:
        return fallback_firma

    return os.path.splitext(file_name)[0].replace("_", " ").replace("-", " ").title()


def detect_footer_info(full_text):
    vade = ""
    termin = ""
    dip_toplam = 0
    kdv = 0
    genel_toplam = 0

    lines = [clean_text(x) for x in full_text.split("\n") if clean_text(x)]

    for line in lines:
        low = line.lower()
        normalized_low = normalize_tr(line)

        if "vade" in low or "ödeme" in low or "odeme" in low:
            vade = line

        if "termin" in low or "teslim" in low:
            termin = line

        money_values = money_values_from_line(line)
        nums = money_values or [clean_number(x) for x in re.findall(r"\d+(?:[.,]\d+)?", line)]

        if money_values and (
            "ara toplam" in normalized_low
            or "dip toplam" in normalized_low
            or re.search(r"\btoplam\b", normalized_low)
        ):
            if nums:
                dip_toplam = nums[-1]

        if "kdv" in normalized_low and money_values:
            kdv = max(money_values)

        if money_values and (
            "genel toplam" in normalized_low
            or "yekun" in normalized_low
            or re.search(r"\btutar\b", normalized_low)
        ):
            if nums:
                genel_toplam = nums[-1]

    return {
        "vade": vade,
        "termin": termin,
        "dipToplam": dip_toplam,
        "kdv": kdv,
        "genelToplam": genel_toplam,
    }


def should_skip_line(line):
    low = normalize_tr(line)

    if re.search(r"\b[tf]\s*:\s*\+?\s*\d", low):
        return True

    skip_words = [
        "not",
        "rapor",
        "rapor olusturan",
        "rapor no",
        "mukayese",
        "karsilastirma raporu",
        "teklif karsilastirma",
        "fiyatlandırma",
        "teklif tüm",
        "teklif tum",
        "firma",
        "tarih",
        "teklif no",
        "ürün kodu",
        "urun kodu",
        "ürün açıklaması",
        "urun aciklamasi",
        "birim fiyat",
        "net fiyat",
        "net toplam",
        "ara toplam",
        "dip toplam",
        "genel toplam",
        "kdv",
        "vade",
        "ödeme",
        "odeme",
        "opsiyon",
        "teklif",
        "toplam",
        "proje adi",
        "proje adı",
        "telefon",
        "tel:",
        "t:+",
        "faks",
        "fax",
        "f:+",
        "mail",
        "e-mail",
        "email",
        "www",
        "hasemek",
        "mpsystem",
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

    return any(word in low for word in skip_words)


def is_pdf_product_row_start(line):
    text = clean_text(line)

    if not text or is_product_table_header(text):
        return False

    if should_skip_line(text):
        return False

    return bool(
        re.match(r"^\s*\d+\s+(?=\S*\d)[A-Za-z0-9][A-Za-z0-9._/-]{1,}\b", text)
        or re.match(r"^\s*[A-Za-z]{1,8}\d{2,}[A-Za-z0-9._/-]*\b", text)
    )


def build_logical_product_lines(lines):
    logical_lines = []
    current = []
    in_product_area = False

    for line in lines:
        text = clean_text(line)

        if not text:
            continue

        if is_product_table_header(text):
            in_product_area = True
            if current:
                logical_lines.append(clean_text(" ".join(current)))
                current = []
            continue

        low = normalize_tr(text)

        row_start = is_pdf_product_row_start(text)

        if row_start:
            if current:
                logical_lines.append(clean_text(" ".join(current)))
            current = [text]
            in_product_area = True
            continue

        if current and (
            low.startswith("toplam")
            or low.startswith("ara toplam")
            or low.startswith("genel toplam")
            or low.startswith("kdv")
            or low.startswith("aciklama")
            or low.startswith("odeme")
            or low.startswith("teslimat")
            or low.startswith("not")
            or low.startswith("opsiyon")
            or low.startswith("teklif onayi")
            or re.fullmatch(r"\d[\d.,]*\s*(?:₺|€|£|\$|tl|try|usd|eur|gbp)", low)
        ):
            logical_lines.append(clean_text(" ".join(current)))
            current = []
            in_product_area = False
            continue

        if not in_product_area and not is_pdf_product_row_start(text):
            continue

        if current:
            current.append(text)

    if current:
        logical_lines.append(clean_text(" ".join(current)))

    return logical_lines


def parse_pdf_line(line):
    line = clean_text(line)

    if not line or should_skip_line(line):
        return None
    
    low = normalize_tr(line)

    if is_section_name(line) or is_section_name(line.split()[0] if line.split() else ""):
        return None

    
    if re.match(r"^(dip toplam|genel toplam|kdv)", low):
        return None 
    
    currency = detect_currency(line)

    # Göktürk benzeri format:
    # S.No Ürün Kodu Malzemenin Cinsi Birim Miktar NET Fiyat Tutar Para Birimi ...
    standard_row = re.match(
        rf"^\s*\d+\s+"
        rf"(?P<code>[A-Za-z0-9._/-]+)\s+"
        rf"(?P<desc>.+?)\s+"
        rf"(?P<unit>{UNIT_RE})\s+"
        rf"(?P<qty>\d+(?:[.,]\d+)?)\s+"
        rf"(?P<unit_price>{MONEY_RE})\s+"
        rf"(?P<line_total>{MONEY_RE})\s*"
        rf"(?P<currency>{CURRENCY_RE})?"
        rf"(?:\s+(?P<term>.*))?$",
        line,
        re.IGNORECASE,
    )

    if standard_row:
        return parsed_offer_row(
            standard_row.group("code"),
            standard_row.group("desc"),
            standard_row.group("qty"),
            standard_row.group("unit_price"),
            standard_row.group("line_total"),
            detect_currency(standard_row.group("currency") or line),
            standard_row.group("unit"),
            0,
            standard_row.group("term") or "",
        )

    # Vata/MP System benzeri format:
    # No Kod Açıklama ... STOK/SİPARİŞ - Marka Miktar Ad Liste Fiyat İsk Net Fiyat Tutar
    vata_row = re.match(
        rf"^\s*\d+\s+"
        rf"(?P<code>[A-Za-z0-9._/-]+)\s+"
        rf"(?P<desc>.+?)\s+"
        rf"(?P<delivery>STOK|SİPARİŞ|SIPARIS|HAZIR|HAZİR)\s*-\s*"
        rf"(?P<brand>[A-Za-z0-9ÇĞİÖŞÜçğıöşü._/-]+)\s+"
        rf"(?P<qty>\d+(?:[.,]\d+)?)\s*(?P<unit>{UNIT_RE})\s+"
        rf"(?P<list_price>{MONEY_RE})\s*(?:{CURRENCY_RE})?\s+"
        rf"(?P<discount>\d+(?:[.,]\d+)?)\s+"
        rf"(?P<net_price>{MONEY_RE})\s*(?:{CURRENCY_RE})?\s+"
        rf"(?P<line_total>{MONEY_RE})\s*(?:{CURRENCY_RE})?.*$",
        line,
        re.IGNORECASE,
    )

    if vata_row:
        return parsed_offer_row(
            vata_row.group("code"),
            f"{vata_row.group('brand')} {vata_row.group('desc')}",
            vata_row.group("qty"),
            vata_row.group("net_price"),
            vata_row.group("line_total"),
            currency,
            vata_row.group("unit"),
            vata_row.group("discount"),
            vata_row.group("delivery"),
        )

    # BKC benzeri ters kolon çıktısı:
    # Kod Açıklama Marka Birim Liste Tutar Net İsk Tutar Miktar No Teslim ParaBirimi
    bkc_row = re.match(
        rf"^\s*"
        rf"(?P<code>[A-Za-z0-9._/-]+)\s+"
        rf"(?P<desc>.+?)\s+"
        rf"(?P<unit>ADET|Adet|adet|AD|ad)\s+"
        rf"(?P<list_price>{MONEY_RE})\s+"
        rf"(?P<line_total_precise>{MONEY_RE})\s+"
        rf"(?P<net_price>{MONEY_RE})\s+"
        rf"(?P<discount>\d+(?:[.,]\d+)?)\s+"
        rf"(?P<line_total_rounded>{MONEY_RE})\s+"
        rf"(?P<qty>\d+(?:[.,]\d+)?)\s+"
        rf"(?P<row_no>\d+)\s+"
        rf"(?P<delivery>.+?)\s+"
        rf"(?P<currency>{CURRENCY_RE})\s*$",
        line,
        re.IGNORECASE,
    )

    if bkc_row:
        return parsed_offer_row(
            bkc_row.group("code"),
            bkc_row.group("desc"),
            bkc_row.group("qty"),
            bkc_row.group("net_price"),
            bkc_row.group("line_total_precise"),
            detect_currency(bkc_row.group("currency")),
            bkc_row.group("unit"),
            bkc_row.group("discount"),
            bkc_row.group("delivery"),
        )

    # MP System fiyat listesi görselindeki sıra:
    # S.No Teslim Referans Ad/Mt Amb Malzemenin Cinsi Net Birim Net Tutar İskonto
    mp_system_row = re.match(
        rf"^\s*\d+\s+"
        rf"(?P<delivery>\d+\s*-\s*\d+\s*HAFTA|HAZIR|HAZİR|STOK|SİPARİŞ|SIPARIS)\s+"
        rf"(?P<code>[A-Za-z0-9._/-]+)\s+"
        rf"(?P<qty>\d+(?:[.,]\d+)?)\s+"
        rf"(?:\d+(?:[.,]\d+)?\s+)?"
        rf"(?P<desc>.+?)\s+"
        rf"(?P<unit_price>{MONEY_RE})\s+"
        rf"(?P<line_total>{MONEY_RE})"
        rf"(?:\s+(?P<discount>\d+(?:[.,]\d+)?))?\s*$",
        line,
        re.IGNORECASE,
    )

    if mp_system_row:
        return parsed_offer_row(
            mp_system_row.group("code"),
            mp_system_row.group("desc"),
            mp_system_row.group("qty"),
            mp_system_row.group("unit_price"),
            mp_system_row.group("line_total"),
            currency,
            "adet",
            mp_system_row.group("discount") or 0,
            mp_system_row.group("delivery"),
        )

    table_row = re.match(
        r"^\s*\d+\s+"
        r"(?P<code>[A-Za-z0-9][A-Za-z0-9._/-]*)\s+"
        r"(?P<brand>[A-Za-z0-9ÇĞİÖŞÜçğıiöşü._/-]+)\s+"
        r"(?P<desc>.+?)\s+"
        r"(?P<qty>\d+(?:[.,]\d+)?)\s+"
        r"(?P<unit_price>\d[\d.,]*)\s*(?:₺|TL|TRY|\$|USD|€|EUR)?\s+"
        r"(?P<line_total>\d[\d.,]*)\s*(?:₺|TL|TRY|\$|USD|€|EUR)?\s*$",
        line,
        re.IGNORECASE
    )

    if table_row:
        brand = clean_text(table_row.group("brand"))
        desc = clean_text(f"{brand} {table_row.group('desc')}")

        return {
            "urunKodu": clean_text(table_row.group("code")),
            "urunAciklamasi": desc,
            "birim": "adet",
            "firmaAdedi": clean_number(table_row.group("qty")),
            "paraBirimi": currency,
            "birimFiyat": clean_number(table_row.group("unit_price")),
            "iskonto": 0,
            "netBirimFiyat": clean_number(table_row.group("unit_price")),
            "netToplam": clean_number(table_row.group("line_total")),
            "vade": "",
            "termin": "",
        }

    structured = re.match(
        r"^\s*(?:\d+\s+)?"
        r"(?P<code>[A-Za-z]{1,8}-?\d{1,8}\*?)\s+"
        r"(?P<desc>.+?)\s+"
        r"(?P<qty>\d+(?:[.,]\d+)?)\s+"
        r"(?P<unit>adet|ad|pcs|kutu|metre|mt|m)\s+"
        r"(?P<unit_price>\d[\d.,]*)\s*(?:₺|TL|TRY|\$|USD|€|EUR)?\s+"
        r"%(?P<discount>\d+(?:[.,]\d+)?)\s+"
        r"(?P<net_price>\d[\d.,]*)\s*(?:₺|TL|TRY|\$|USD|€|EUR)?\s+"
        r"(?P<line_total>\d[\d.,]*)\s*(?:₺|TL|TRY|\$|USD|€|EUR)?\s*$",
        line,
        re.IGNORECASE
    )

    if structured:
        return {
            "urunKodu": clean_text(structured.group("code")),
            "urunAciklamasi": clean_text(structured.group("desc")),
            "birim": clean_text(structured.group("unit")) or "adet",
            "firmaAdedi": clean_number(structured.group("qty")),
            "paraBirimi": currency,
            "birimFiyat": clean_number(structured.group("unit_price")),
            "iskonto": clean_number(structured.group("discount")),
            "netBirimFiyat": clean_number(structured.group("net_price")),
            "netToplam": clean_number(structured.group("line_total")),
            "vade": "",
            "termin": "",
        }

    # Fiyat para birimiyle gelirse
    price_match = re.search(
        r"(?P<price>\d+(?:[.,]\d+)?)\s*(?P<currency>₺|TL|TRY|\$|USD|€|EUR)",
        line,
        re.IGNORECASE
    )

    # Bazı PDF'lerde fiyat para birimsiz olur: ürün miktar adet fiyat iskonto toplam
    if price_match:
        price = clean_number(price_match.group("price"))
        before_price = line[:price_match.start()].strip()
        after_price = line[price_match.end():].strip()
    else:
        numbers = re.findall(r"\d+(?:[.,]\d+)?", line)
        if len(numbers) < 2:
            return None

        price = clean_number(numbers[-1])
        before_price = line.rsplit(numbers[-1], 1)[0].strip()
        after_price = line.rsplit(numbers[-1], 1)[1].strip()

    discount = 0.0
    discount_match = re.search(r"(\d+(?:[.,]\d+)?)\s*%", line)
    if discount_match:
        discount = clean_number(discount_match.group(1))

    term = ""
    term_match = re.search(
        r"(\d+\s*-\s*\d+\s*gün|\d+\s*gün|\d+\s*hafta|stok|hemen|hazır|hazir)",
        line,
        re.IGNORECASE
    )
    if term_match:
        term = clean_text(term_match.group(1))

    tokens = before_price.split()

    if len(tokens) < 2:
        return None

    unit = "adet"

    if tokens[-1].lower() in ["adet", "ad", "pcs", "kutu", "metre", "mt", "m"]:
        unit = tokens[-1]
        qty_token = tokens[-2]
        product_tokens = tokens[:-2]
    else:
        qty_token = tokens[-1]
        product_tokens = tokens[:-1]

    qty = clean_number(qty_token)

    if qty <= 0 or price <= 0 or not product_tokens:
        return None

    code = ""
    desc_tokens = product_tokens

    first = product_tokens[0]
    if re.fullmatch(r"[A-Za-z]{1,8}[-]?\d{1,8}\*?", first):
        code = first
        desc_tokens = product_tokens[1:]

    desc = clean_text(" ".join(desc_tokens))

    if not desc:
        return None

    return {
        "urunKodu": code,
        "urunAciklamasi": desc,
        "birim": unit,
        "firmaAdedi": qty,
        "paraBirimi": currency,
        "birimFiyat": price,
        "iskonto": discount,
        "vade": "",
        "termin": term,
    }


def find_header_column(header, required_words):
    for index, cell in enumerate(header):
        low = normalize_tr(cell)

        if all(word in low for word in required_words):
            return index

    return -1


def find_header_column_any(header, candidates, exclude_words=None):
    exclude_words = exclude_words or []

    for words in candidates:
        for index, cell in enumerate(header):
            low = normalize_tr(cell)

            if any(word in low for word in exclude_words):
                continue

            if all(word in low for word in words):
                return index

    return -1


def cell_at(row, index):
    if index < 0 or index >= len(row):
        return ""

    return clean_text(row[index])


def make_offer_row(parsed, firma, footer, file_name):
    return {
        "firma": firma,
        "firmaAdi": firma,
        "urunKodu": parsed["urunKodu"],
        "urunAciklamasi": parsed["urunAciklamasi"],
        "birim": parsed["birim"] or "adet",
        "firmaAdedi": parsed["firmaAdedi"],
        "paraBirimi": parsed["paraBirimi"] or "TRY",
        "birimFiyat": parsed["birimFiyat"],
        "iskonto": parsed["iskonto"],
        "netBirimFiyat": parsed.get("netBirimFiyat", 0),
        "netToplam": parsed.get("netToplam", 0),
        "vade": footer.get("vade", ""),
        "termin": parsed["termin"] or footer.get("termin", ""),
        "firmaDipToplam": footer.get("dipToplam", 0),
        "firmaKdv": footer.get("kdv", 0),
        "firmaGenelToplam": footer.get("genelToplam", 0),
        "kaynakDosya": file_name,
        "kaynakTipi": "pdf",
    }


def parse_product_tables(tables, firma, footer, file_name):
    rows = []
    sections = []
    errors = []
    warnings = []
    pending_rows = []
    open_section = None
    open_section_child_count = 0
    section_debug = []
    active_header = None
    active_indexes = None

    def make_flat_section_row(section):
        quantity = section.get("section_quantity") or 0
        section_total = section.get("section_total") or 0
        unit_price = section_total / quantity if quantity > 0 and section_total > 0 else 0
        flat_row = make_offer_row(
            {
                "urunKodu": section.get("product_code") or "",
                "urunAciklamasi": section["section_name"],
                "birim": section.get("unit") or "adet",
                "firmaAdedi": quantity,
                "paraBirimi": section.get("currency") or "TRY",
                "birimFiyat": unit_price,
                "iskonto": 0,
                "netBirimFiyat": unit_price,
                "netToplam": section_total,
                "vade": "",
                "termin": "",
            },
            firma,
            footer,
            file_name,
        )
        flat_row["section_name"] = ""
        flat_row["section_total"] = 0
        flat_row["section_quantity"] = 0
        flat_row["price_status"] = "flat_main_item"
        return flat_row

    def apply_section_to_row(row, section):
        row["section_name"] = section["section_name"]
        row["section_total"] = section["section_total"]
        row["section_quantity"] = section.get("section_quantity") or 0
        row["birimFiyat"] = 0
        row["netBirimFiyat"] = 0
        row["netToplam"] = 0
        row["price_status"] = "section_total_only"

    def close_open_section_as_flat_if_empty():
        nonlocal open_section, open_section_child_count

        if not open_section:
            return

        if open_section_child_count <= 0:
            rows.append(make_flat_section_row(open_section))
            warnings.append("Bu dosyada alt kalem ilişkisi bulunmayan ana kalem satırı görüldü; bağımsız ana kalem olarak aktarılabilir.")
            section_debug.append({
                "section_name": open_section["section_name"],
                "child_count": 0,
                "page_end_parent": bool(open_section.get("page_end_parent")),
                "page_number": open_section.get("page_number"),
                "mode": "flat_main_item",
            })
        else:
            section_debug.append({
                "section_name": open_section["section_name"],
                "child_count": open_section_child_count,
                "page_end_parent": bool(open_section.get("page_end_parent")),
                "page_number": open_section.get("page_number"),
                "mode": "attached_to_following_rows",
            })

        open_section = None
        open_section_child_count = 0

    def attach_section_to_pending(section):
        if not pending_rows:
            section_debug.append({
                "section_name": section["section_name"],
                "child_count": 0,
                "page_end_parent": bool(section.get("page_end_parent")),
                "page_number": section.get("page_number"),
                "mode": "open_parent_waiting_for_following_rows",
            })
            return

        for row in pending_rows:
            apply_section_to_row(row, section)

        warnings.append(
            f"{section['section_name']} toplamı üstündeki {len(pending_rows)} malzemeye bağlandı; parça fiyatları aktarılmadı."
        )
        section_debug.append({
            "section_name": section["section_name"],
            "child_count": len(pending_rows),
            "page_end_parent": bool(section.get("page_end_parent")),
            "page_number": section.get("page_number"),
            "mode": "attached_to_previous_rows",
        })
        pending_rows.clear()

    for table_entry in tables:
        page_number = None
        table = table_entry
        if isinstance(table_entry, dict):
            page_number = table_entry.get("page_number")
            table = table_entry.get("table") or []

        if not table:
            continue

        header = None
        data_rows = []

        for index, raw_row in enumerate(table):
            cells = [clean_text(cell) for cell in raw_row]
            joined = " ".join(cells)

            if is_product_table_header(joined):
                header = cells
                data_rows = table[index + 1:]
                break

        if header:
            code_index = find_header_column_any(header, [
                ["malzeme", "kod"],
                ["urun", "kod"],
                ["referans"],
                ["kod"],
            ], exclude_words=["sira", "s no"])
            brand_index = find_header_column_any(header, [["marka"], ["brand"], ["uretici"]])
            desc_index = find_header_column_any(header, [
                ["aciklama"],
                ["malzeme", "cinsi"],
                ["malzemenin", "cinsi"],
                ["malzeme"],
                ["urun"],
            ], exclude_words=["kod"])
            qty_index = find_header_column_any(header, [
                ["adet"],
                ["miktar"],
                ["ad", "mt"],
                ["ad/mt"],
            ])
            unit_index = find_header_column_any(header, [["birim"], ["unit"]], exclude_words=["fiyat"])
            unit_price_index = find_header_column_any(header, [
                ["net", "birim", "fiyat"],
                ["net", "fiyat"],
                ["birim", "fiyat"],
                ["fiyat"],
            ], exclude_words=["liste"])
            total_index = find_header_column_any(header, [["net", "tutar"], ["tutar"], ["toplam"]])
            delivery_index = find_header_column_any(header, [["teslim"], ["termin"], ["stok", "durum"]])
            currency_index = find_header_column_any(header, [["para", "birim"], ["currency"], ["doviz"]])

            if qty_index < 0 or desc_index < 0:
                active_header = None
                active_indexes = None
                continue

            active_header = header
            active_indexes = {
                "code": code_index,
                "brand": brand_index,
                "desc": desc_index,
                "qty": qty_index,
                "unit": unit_index,
                "unit_price": unit_price_index,
                "total": total_index,
                "delivery": delivery_index,
                "currency": currency_index,
            }
        elif active_header and active_indexes:
            data_rows = table
        else:
            continue

        code_index = active_indexes["code"]
        brand_index = active_indexes["brand"]
        desc_index = active_indexes["desc"]
        qty_index = active_indexes["qty"]
        unit_index = active_indexes["unit"]
        unit_price_index = active_indexes["unit_price"]
        total_index = active_indexes["total"]
        delivery_index = active_indexes["delivery"]
        currency_index = active_indexes["currency"]

        for row_position, raw_row in enumerate(data_rows):
            cells = [clean_text(cell) for cell in raw_row]
            joined = " ".join(cells)

            if not joined or is_product_table_header(joined):
                continue

            quantity = clean_number(cell_at(cells, qty_index))
            code = cell_at(cells, code_index)
            brand = cell_at(cells, brand_index)
            description = cell_at(cells, desc_index)
            unit = cell_at(cells, unit_index) or "adet"
            unit_price = clean_number(cell_at(cells, unit_price_index))
            line_total = clean_number(cell_at(cells, total_index))
            delivery = cell_at(cells, delivery_index)
            row_currency = detect_currency(cell_at(cells, currency_index) or joined)
            section_source = description or brand or code or joined
            section_name = canonical_section_name(section_source)

            if section_name or looks_like_section_total_row(cells, code, brand, description, quantity, line_total):
                close_open_section_as_flat_if_empty()
                numbers = row_numbers(cells)
                section_total = choose_section_total(line_total, numbers)
                section_quantity = infer_quantity_from_cells(cells, quantity, section_total)
                section_name = section_name or section_name_from_cells(cells)
                logger.debug("Parent detected:", {"row": joined, "name": section_name})
                section_debug.append({
                    "event": "Parent detected",
                    "row": joined,
                    "name": section_name,
                    "quantity": section_quantity,
                    "total": section_total,
                    "page_number": page_number,
                })
                section = {
                    "section_name": section_name,
                    "section_total": section_total,
                    "section_quantity": section_quantity if section_quantity > 0 else 0,
                    "product_code": code,
                    "unit": unit or "adet",
                    "currency": row_currency or "TRY",
                    "page_number": page_number,
                    "page_end_parent": row_position == len(data_rows) - 1,
                }
                if section_quantity <= 0:
                    warnings.append(f"{section_name} ana kalem miktarı kontrol gerekli.")
                sections.append(section)
                had_pending_rows = bool(pending_rows)
                attach_section_to_pending(section)
                if not had_pending_rows:
                    open_section = section
                continue

            if should_skip_line(joined):
                continue

            if not code or not description:
                warnings.append(f"Kontrol uyarısı: kod/açıklama eksik satır atlandı ({joined})")
                logger.debug("Rejected:", {"row": joined, "reason": "kod/aciklama eksik"})
                section_debug.append({
                    "event": "Rejected",
                    "skipped_row": joined,
                    "reason": "kod/aciklama eksik",
                    "page_number": page_number,
                })
                continue

            name = clean_text(f"{brand} {description}") if brand else description

            if should_skip_line(name) or is_section_name(name):
                warnings.append(f"Kontrol uyarısı: kategori/toplam satırı ürün olarak algılandı ({name})")
                logger.debug("Rejected:", {"row": name, "reason": "kategori/toplam satiri urun gibi gorundu"})
                section_debug.append({
                    "event": "Rejected",
                    "skipped_row": name,
                    "reason": "kategori/toplam satiri urun gibi gorundu",
                    "page_number": page_number,
                })
                continue

            if quantity <= 0:
                warnings.append(f"Kontrol uyarısı: adet eksik satır atlandı ({name})")
                logger.debug("Rejected:", {"row": name, "reason": "adet eksik"})
                section_debug.append({
                    "event": "Rejected",
                    "skipped_row": name,
                    "reason": "adet eksik",
                    "page_number": page_number,
                })
                continue

            price_status = "line_priced"

            if unit_price <= 0 or line_total <= 0:
                unit_price = 0
                line_total = 0
                price_status = "pending_section_total"

            expected_total = quantity * unit_price

            if price_status == "line_priced" and not money_equals(expected_total, line_total, 0.10):
                unit_price = line_total / quantity

            rows.append(make_offer_row(
                {
                    "urunKodu": code,
                    "urunAciklamasi": name,
                    "birim": unit or "adet",
                    "firmaAdedi": quantity,
                    "paraBirimi": row_currency,
                    "birimFiyat": unit_price,
                    "iskonto": 0,
                    "netBirimFiyat": unit_price,
                    "netToplam": line_total,
                    "vade": "",
                    "termin": delivery,
                },
                firma,
                footer,
                file_name,
            ))
            rows[-1]["section_name"] = ""
            rows[-1]["section_total"] = 0
            rows[-1]["section_quantity"] = 0
            rows[-1]["price_status"] = price_status
            if open_section:
                apply_section_to_row(rows[-1], open_section)
                open_section_child_count += 1
            else:
                pending_rows.append(rows[-1])

    close_open_section_as_flat_if_empty()

    if sections and pending_rows:
        for row in pending_rows:
            row["birimFiyat"] = 0
            row["netBirimFiyat"] = 0
            row["netToplam"] = 0
            row["price_status"] = "section_total_only"

        warnings.append(
            f"{len(pending_rows)} malzeme satırı için sonraki kategori toplamı bulunamadı; parça fiyatları güvenli olarak aktarılmadı."
        )
        pending_rows.clear()

    ungrouped_pending = [row for row in pending_rows if row.get("price_status") == "pending_section_total"]
    if ungrouped_pending:
        errors.append(f"{len(ungrouped_pending)} malzeme satırı fiyat/toplam satırıyla eşleşmedi.")

    checked_total = footer.get("dipToplam") or footer.get("genelToplam") or 0
    product_total = sum(float(row.get("netToplam") or 0) for row in rows)

    if checked_total > 0 and product_total > 0 and not money_equals(product_total, checked_total, 0.50):
        errors.append(
            f"Genel toplam tutmuyor: ürünler {product_total:.2f}, teklif {checked_total:.2f}"
        )

    logger.debug("PDF ANA KALEM DEBUG:", section_debug)

    return {
        "rows": rows,
        "sections": sections,
        "errors": errors,
        "warnings": warnings,
        "debug": section_debug,
    }


def parse_pdf(file_path, firma_adi="", file_name=""):
    audit = parse_pdf_with_audit(file_path, firma_adi, file_name)
    return audit["rows"]


def parse_pdf_with_audit(file_path, firma_adi="", file_name=""):
    rows = []
    sections = []
    errors = []
    warnings = []

    if pdfplumber is None:
        raise RuntimeError("PDF okuma kütüphanesi yüklenemedi: pdfplumber")

    with pdfplumber.open(file_path) as pdf:
        full_text = "\n".join([page.extract_text() or "" for page in pdf.pages])
        tables = []

        for page_number, page in enumerate(pdf.pages, start=1):
            for table in page.extract_tables() or []:
                tables.append({"page_number": page_number, "table": table})

    firma = detect_company_name(full_text, firma_adi, file_name)
    footer = detect_footer_info(full_text)
    project_main_group_name = extract_project_main_group_name(full_text, file_name)
    table_result = parse_product_tables(tables, firma, footer, file_name)
    rows.extend(table_result["rows"])
    sections.extend(table_result["sections"])
    errors.extend(table_result["errors"])
    warnings.extend(table_result.get("warnings", []))
    debug = table_result.get("debug", [])
    lines = [clean_text(x) for x in full_text.split("\n") if clean_text(x)]
    has_product_table_header = any(is_product_table_header(line) for line in lines)

    logical_lines = build_logical_product_lines(lines)

    if not logical_lines and not has_product_table_header:
        logical_lines = lines

    fallback_rows = []

    for line in logical_lines:
        parsed = parse_pdf_line(line)

        if not parsed:
            continue

        fallback_rows.append(make_offer_row(parsed, firma, footer, file_name))

    if fallback_rows and not sections and (not rows or len(fallback_rows) >= len(rows)):
        if rows and len(fallback_rows) > len(rows):
            warnings.append(
                f"PDF tablo okuması yerine satır okuması kullanıldı: {len(fallback_rows)} satır."
            )
        rows = fallback_rows

    if rows and not sections and project_main_group_name:
        section_total = footer.get("dipToplam") or sum(float(row.get("netToplam") or 0) for row in rows)
        section = {
            "section_name": project_main_group_name,
            "section_total": section_total,
            "section_quantity": 1,
            "product_code": "",
            "unit": "adet",
            "currency": "TRY",
            "page_number": 1,
            "page_end_parent": False,
            "source": "project_title_fallback",
        }
        sections.append(section)

        for row in rows:
            row["section_name"] = section["section_name"]
            row["section_total"] = section["section_total"]
            row["section_quantity"] = section["section_quantity"]
            row["price_status"] = "section_total_only"
            row["birimFiyat"] = 0
            row["netBirimFiyat"] = 0
            row["netToplam"] = 0

        warnings.append(
            f"PDF icinde ayri ana kalem satiri bulunamadi; belge basligindan {project_main_group_name} ana kalem grubu olusturuldu ve {len(rows)} malzeme alt kalem olarak baglandi. Aktarmadan once ana kalem adini kontrol edin."
        )
        errors = [
            error for error in errors
            if not str(error).startswith("Genel toplam tutmuyor:")
        ]
        debug.append({
            "event": "Project title fallback parent",
            "section_name": project_main_group_name,
            "child_count": len(rows),
            "section_total": section_total,
        })

    if has_product_table_header and not rows:
        errors.append("Ürün tablosu bulundu ama güvenilir ürün satırı çıkarılamadı.")

    return {
        "rows": rows,
        "sections": sections,
        "errors": errors,
        "warnings": warnings,
        "debug": debug,
    }