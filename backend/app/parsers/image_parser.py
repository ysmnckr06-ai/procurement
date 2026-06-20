from pydoc import text

import cv2
import pytesseract
import numpy as np
import re
import os

configured_tesseract_cmd = os.getenv("TESSERACT_CMD")
windows_tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

if configured_tesseract_cmd:
    pytesseract.pytesseract.tesseract_cmd = configured_tesseract_cmd
elif os.path.exists(windows_tesseract_cmd):
    pytesseract.pytesseract.tesseract_cmd = windows_tesseract_cmd

def read_image_unicode(image_path):
    data = np.fromfile(image_path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def ocr_image_text(img):
    if img is None:
        return ""

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    gray = cv2.resize(gray, None, fx=2, fy=2)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    _, threshold = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    adaptive = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        2,
    )
    candidates = []

    for image in [gray, threshold, adaptive]:
        for config in ["--psm 6", "--psm 11"]:
            try:
                text_value = pytesseract.image_to_string(image, lang="tur", config=config)
            except Exception:
                try:
                    text_value = pytesseract.image_to_string(image, lang="eng", config=config)
                except Exception:
                    text_value = ""
            if text_value.strip():
                candidates.append(text_value.strip())

    return max(candidates, key=len) if candidates else ""


def extract_image_ocr_text(image_path):
    return ocr_image_text(read_image_unicode(image_path))


DOCUMENT_ITEM_UNITS = {
    "ad": "adet",
    "adet": "adet",
    "pcs": "adet",
    "piece": "adet",
    "kutu": "kutu",
    "paket": "paket",
    "set": "set",
    "kg": "kg",
    "gr": "gr",
    "lt": "lt",
    "litre": "lt",
    "m": "metre",
    "mt": "metre",
    "metre": "metre",
    "m2": "m2",
    "m3": "m3",
}


def parse_document_item_number(value):
    """Parse Turkish or international formatted OCR numbers without changing raw text."""
    text = str(value or "").strip().replace(" ", "")
    text = re.sub(r"(?:TRY|TL|USD|EUR|GBP|[$€£₺])", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[^0-9,.-]", "", text)
    if not text or text in {"-", ".", ","}:
        return None

    if "," in text and "." in text:
        decimal_separator = "," if text.rfind(",") > text.rfind(".") else "."
        thousands_separator = "." if decimal_separator == "," else ","
        text = text.replace(thousands_separator, "").replace(decimal_separator, ".")
    elif "," in text:
        parts = text.split(",")
        text = "".join(parts) if len(parts[-1]) == 3 and len(parts) > 1 else ".".join(parts)
    elif text.count(".") == 1 and len(text.split(".")[-1]) == 3:
        text = text.replace(".", "")
    elif text.count(".") > 1:
        parts = text.split(".")
        text = "".join(parts[:-1]) + "." + parts[-1]

    try:
        return float(text)
    except ValueError:
        return None


def normalize_document_item_unit(value):
    key = normalize_tr(value).replace("²", "2").replace("³", "3")
    return DOCUMENT_ITEM_UNITS.get(key)


def build_document_item(product_code, product_name, quantity, unit, unit_price, total, confidence):
    quantity_value = parse_document_item_number(quantity)
    unit_price_value = parse_document_item_number(unit_price)
    total_value = parse_document_item_number(total)
    normalized_unit = normalize_document_item_unit(unit)
    clean_name = clean_text(product_name)
    clean_code = clean_text(product_code) or None

    if not clean_name or quantity_value is None or quantity_value <= 0 or not normalized_unit:
        return None
    if unit_price_value is None and total_value is None:
        return None
    if unit_price_value is None and total_value is not None:
        unit_price_value = total_value / quantity_value
        confidence -= 10
    if total_value is None and unit_price_value is not None:
        total_value = quantity_value * unit_price_value
        confidence -= 10
    expected_total = quantity_value * unit_price_value
    if total_value and abs(expected_total - total_value) / abs(total_value) > 0.03:
        confidence -= 25

    confidence = max(0, min(100, int(confidence)))
    return {
        "product_code": clean_code,
        "product_name": clean_name,
        "quantity": quantity_value,
        "unit": normalized_unit,
        "unit_price": unit_price_value,
        "total": total_value,
        "ocr_confidence": confidence,
        "review_required": confidence < 75,
    }


def extract_document_items_from_text(ocr_text):
    """Best-effort invoice/delivery-note row extraction from plain OCR text."""
    items = []
    unit_pattern = "|".join(sorted(DOCUMENT_ITEM_UNITS, key=len, reverse=True))
    number_pattern = r"[-+]?\d[\d.,]*"
    row_pattern = re.compile(
        rf"^(?:(?P<code>[A-Z0-9][A-Z0-9._/-]{{1,30}})\s+)?"
        rf"(?P<name>.+?)\s+(?P<qty>{number_pattern})\s+"
        rf"(?P<unit>{unit_pattern})\s+(?P<price>{number_pattern})\s+"
        rf"(?P<total>{number_pattern})(?:\s*(?:TRY|TL|USD|EUR|GBP|[$€£₺]))?$",
        re.IGNORECASE,
    )

    for raw_line in str(ocr_text or "").splitlines():
        line = clean_text(raw_line.replace("|", " "))
        normalized = normalize_tr(line)
        if not line or any(label in normalized for label in (
            "ara toplam", "genel toplam", "toplam tutar", "kdv", "birim fiyat",
            "urun kodu", "malzeme kodu", "aciklama miktar",
        )):
            continue
        match = row_pattern.match(line)
        if not match:
            continue
        values = match.groupdict()
        product_code = values.get("code")
        product_name = values["name"]
        likely_code = product_code and not product_code.isdigit() and (
            any(character.isdigit() for character in product_code)
            or any(character in "._/-" for character in product_code)
            or (product_code.isupper() and len(product_code) <= 12)
        )
        if product_code and not likely_code:
            product_name = f"{product_code} {product_name}"
            product_code = None
        item = build_document_item(
            product_code, product_name, values["qty"], values["unit"],
            values["price"], values["total"], 82 if product_code else 70,
        )
        if item:
            items.append(item)

    return items

def detect_company_from_image(img, fallback, file_name):
    if fallback:
        return fallback

    h, w = img.shape[:2]

    # Görselin üst %18'lik kısmı firma adı alanı
    top = img[0:int(h * 0.18), 0:w]

    gray = cv2.cvtColor(top, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=4, fy=4)
    gray = cv2.fastNlMeansDenoising(gray)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    try:
        text = pytesseract.image_to_string(th, lang="tur", config="--psm 6")
    except Exception:
        text = pytesseract.image_to_string(th, lang="eng", config="--psm 6")

    lines = [clean_text(x) for x in text.split("\n") if clean_text(x)]

    for line in lines:
        low = normalize_tr(line)

        if any(x in low for x in [
            "satinalma",
            "satin alma",
            "teklif",
            "formu",
            "tarih",
            "para birimi",
        ]):
            continue

        if len(line) >= 4 and len(re.findall(r"\d", line)) <= 2:
            return line

    return os.path.splitext(file_name)[0].replace("_", " ").replace("-", " ").title()

def clean_text(val):
    text = str(val or "").strip()
    return re.sub(r"\s+", " ", text)

def normalize_tr(val):
    text = str(val or "").lower()
    text = text.replace("̇", "")
    text = text.replace("ı", "i")
    text = text.replace("ğ", "g").replace("ü", "u")
    text = text.replace("ş", "s").replace("ö", "o").replace("ç", "c")
    return clean_text(text)

def clean_number(val):
    if val is None:
        return 0.0

    s = str(val).strip()
    s = s.replace("₺", "").replace("TL", "").replace("TRY", "")
    s = s.replace("$", "").replace("USD", "")
    s = s.replace("€", "").replace("EUR", "")
    s = s.replace("%", "")
    s = s.replace("O", "0").replace("o", "0")

    # 7,261.10 veya 7.261,10 destekle
    if "," in s and "." in s:
        if s.rfind(".") > s.rfind(","):
            s = s.replace(",", "")
        else:
            s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")

    s = re.sub(r"[^0-9.\-]", "", s)

    try:
        return float(s)
    except Exception:
        return 0.0

def fix_ocr_text(line):
    line = clean_text(line)

    replacements = {
        "giin": "gün",
        "gin": "gün",
        "gun": "gün",
        "t1": "tl",
        "T1": "TL",
        "O,": "0,",
        "O.": "0.",
        " l ": " 1 ",
    }

    for old, new in replacements.items():
        line = line.replace(old, new)

    return clean_text(line)

def detect_currency(text):
    text = str(text or "").upper()
    if "$" in text or "USD" in text:
        return "USD"
    if "€" in text or "EUR" in text:
        return "EUR"
    return "TRY"

def should_skip_line(line):
    low = normalize_tr(line)

    if re.match(r"^(dip toplam|genel toplam|kdv|ara toplam)", low):
        return True

    skip_words = [
        "firma",
        "tarih",
        "teklif no",
        "para birimi",
        "satin alma",
        "satinalma",
        "teklif formu",
        "sira kod",
        "sira no",
        "urun kodu",
        "urun aciklamasi",
        "miktar birim",
        "birim fiyat",
        "iskonto",
        "isk. fiyat",
        "satir toplami",
        "net fiyat",
        "net toplam",
        "vade:",
        "termin:",
        "odeme",
        "not:",
        "fiyatlara",
        "teklif tum",
    ]

    return any(word in low for word in skip_words)

def detect_company_name(lines, fallback, file_name):
    if fallback and not re.search(r"^[A-ZÇĞİÖŞÜ]?\s*firması$", fallback, re.IGNORECASE):
        return fallback

    for line in lines[:12]:
        line_clean = clean_text(line)
        low = normalize_tr(line_clean)

        # Başlık / tablo / ürün satırlarını firma sanma
        if any(x in low for x in [
            "satin alma",
            "satinalma",
            "teklif formu",
            "teklif no",
            "tarih",
            "para birimi",
            "sira",
            "kod",
            "urun",
            "miktar",
            "birim",
            "fiyat",
            "iskonto",
            "satir toplami",
            "vade",
            "termin",
            "not",
        ]):
            continue

        # Ürün satırı gibi görünüyorsa firma değildir
        if re.match(r"^\s*\d+\s+[A-Za-z]{1,8}-?\d+", line_clean):
            continue

        # Çok sayısal satır firma değildir
        digit_count = len(re.findall(r"\d", line_clean))
        if digit_count > 4:
            continue

        # Çok uzun tablo satırı firma değildir
        if len(line_clean.split()) > 6:
            continue

        if len(line_clean) >= 3:
            return line_clean

    return os.path.splitext(file_name)[0].replace("_", " ").replace("-", " ").title()

def extract_labeled_days(line, label):
    low = normalize_tr(line)
    m = re.search(rf"{label}\s*:?\s*(\d+)\s*(is\s*)?gun", low)
    if not m:
        return ""

    gun = m.group(1)
    is_gunu = bool(m.group(2))

    return f"{gun} iş günü" if is_gunu else f"{gun} gün"

def detect_footer(lines):
    vade = ""
    termin = ""
    dip = 0
    kdv = 0
    genel = 0

    for line in lines:
        low = normalize_tr(line)
        nums = re.findall(r"\d+(?:[.,]\d+)?", line)
        nums = [clean_number(x) for x in nums]

        found_vade = extract_labeled_days(line, "vade")
        if found_vade:
            vade = found_vade

        found_termin = extract_labeled_days(line, "termin")
        if found_termin:
            termin = found_termin

        if "dip toplam" in low or "ara toplam" in low:
            if nums:
                dip = nums[-1]

        if "kdv" in low:
            if nums:
                kdv = nums[-1]

        if "genel toplam" in low:
            if nums:
                genel = nums[-1]

    return vade, termin, dip, kdv, genel

def parse_offer_line(line):
    line = fix_ocr_text(line)

    if re.search(r"urun|aciklama|birim fiyat|iskonto",line.lower()):
        return None
    
    if not line or should_skip_line(line):
        return None

    low = normalize_tr(line)
    header_patterns = [
        "sira kod urun aciklamasi miktar birim birim fiyat iskonto isk. fiyat satir toplami",
        "sira urun kodu urun aciklamasi miktar birim birim fiyat iskonto",
    ]

    for hp in header_patterns:
        if hp in low:
            return None
        
    if not re.match(r"^\s*(?:\d+\s+)?[A-Za-z]{1,8}-?\d{1,8}", line):
        return None   

    if re.match(r"^(dip toplam|genel toplam|kdv|ara toplam)", low):
        return None

    currency = detect_currency(line)

    structured = re.match(
        r"^\s*(?:\d+\s+)?"
        r"(?P<code>[A-Za-z]{1,8}-?\d{1,8}\*?)\s+"
        r"(?P<desc>.+?)\s+"
        r"(?P<qty>\d+(?:[.,]\d+)?)\s+"
        r"(?P<unit>adet|ad|pcs|kutu|metre|mt|m)\s+"
        r"(?P<unit_price>\d[\d.,]*)\s*(?:₺|TL|TRY|\$|USD|€|EUR)?\s+"
        r"%?(?P<discount>\d+(?:[.,]\d+)?)\s+"
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

    return None

def parse_image(image_path, firma_adi="", file_name=""):
    img = read_image_unicode(image_path)

    if img is None:
        return []

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2, fy=2)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)

    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    blur = cv2.GaussianBlur(gray, (3, 3), 0)

    adaptive = cv2.adaptiveThreshold(
        blur,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        2
    )
    texts = []

    configs = ["--psm 6", "--psm 11", "--psm 4"]
    images_to_try = [gray, th, adaptive]

    for img_try in images_to_try:
        for cfg in configs:
            try:
                texts.append(pytesseract.image_to_string(img_try, lang="tur", config=cfg))
            except Exception:
                pass
                try:
                    texts.append(pytesseract.image_to_string(img_try, lang="eng", config=cfg))
                except Exception:
                    pass

    text = "\n".join([t for t in texts if t.strip()])

    print("OCR RAW TEXT LENGTH:", len(text))
    print("OCR RAW TEXT PREVIEW:", text[:1000])

    lines = [fix_ocr_text(l) for l in text.split("\n") if fix_ocr_text(l)]

    firma = detect_company_name(lines, firma_adi, file_name)

    if not firma or re.search(r"^[A-ZÇĞİÖŞÜ]?\s*firması$", firma, re.IGNORECASE):
        firma = os.path.splitext(file_name)[0].replace("_", " ").upper()

    vade, termin_footer, dip, kdv, genel = detect_footer(lines)

    rows = []

    for line in lines:
        parsed = parse_offer_line(line)

        print("LINE:", line)
        print("PARSED:", parsed)
        
        if not parsed:
            continue

        rows.append({
            "firma": firma,
            "firmaAdi": firma,
            "urunKodu": str(parsed.get("urunKodu", "")).strip().upper(),
            "urunAciklamasi": parsed["urunAciklamasi"],
            "birim": parsed["birim"] or "adet",
            "firmaAdedi": parsed["firmaAdedi"],
            "paraBirimi": parsed["paraBirimi"] or "TRY",
            "birimFiyat": parsed["birimFiyat"],
            "iskonto": parsed["iskonto"],
            "netBirimFiyat": parsed.get("netBirimFiyat", 0),
            "netToplam": parsed.get("netToplam", 0),
            "vade": vade,
            "termin": parsed.get("termin") or termin_footer,
            "firmaDipToplam": dip,
            "firmaKdv": kdv,
            "firmaGenelToplam": genel,
            "kaynakDosya": file_name,
            "kaynakTipi": "image",
        })

    return rows
