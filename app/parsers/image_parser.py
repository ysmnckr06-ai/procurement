import cv2
import pytesseract
import numpy as np
import re
import os

os.environ["PATH"] += os.pathsep + r"C:\Program Files\Tesseract-OCR"

tesseract_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
tessdata_path = r"C:\Program Files\Tesseract-OCR\tessdata"

pytesseract.pytesseract.tesseract_cmd = tesseract_path
os.environ["TESSDATA_PREFIX"] = tessdata_path

print("IMAGE PARSER LOADED:", __file__)
print("TESSERACT EXISTS:", os.path.exists(tesseract_path), tesseract_path)
print("TESSDATA EXISTS:", os.path.exists(tessdata_path), tessdata_path)
print("TESSERACT CMD:", pytesseract.pytesseract.tesseract_cmd)

def read_image_unicode(image_path):
    data = np.fromfile(image_path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)

def detect_company_from_image(img, fallback, file_name):
    if fallback:
        return fallback

    h, w = img.shape[:2]

    # Görselin üst %18'lik kısmı firma adı alanı
    top = img[0:int(h * 0.18), 0:w]

    gray = cv2.cvtColor(top, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2, fy=2)
    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    try:
       text = pytesseract.image_to_string(
            th,
            lang="tur+eng",
            config=f'--tessdata-dir "{tessdata_path}" --psm 6'
        )
    except Exception as e:
        print("OCR TUR HATASI:", repr(e))
        text = pytesseract.image_to_string(
            th,
            lang="eng",
            config=f'--tessdata-dir "{tessdata_path}" --psm 6'
        )

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

    try:
        text = pytesseract.image_to_string(
            th,
            lang="tur+eng",
            config=f'--tessdata-dir "{tessdata_path}" --psm 6'
        )
    except Exception as e:
        print("OCR TUR HATASI:", repr(e))
        text = pytesseract.image_to_string(
            th,
            lang="eng",
            config=f'--tessdata-dir "{tessdata_path}" --psm 6'
        )
    lines = [fix_ocr_text(l) for l in text.split("\n") if fix_ocr_text(l)]

    firma = detect_company_name(lines, firma_adi, file_name)

    if not firma or re.search(r"^[A-ZÇĞİÖŞÜ]?\s*firması$", firma, re.IGNORECASE):
        firma = os.path.splitext(file_name)[0].replace("_", " ").upper()

    vade, termin_footer, dip, kdv, genel = detect_footer(lines)

    rows = []

    for line in lines:
        parsed = parse_offer_line(line)

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