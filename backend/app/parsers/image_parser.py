import cv2
import pytesseract
import numpy as np
import re
import os


def read_image_unicode(image_path):
    data = np.fromfile(image_path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def clean_text(val):
    text = str(val or "").strip()
    return re.sub(r"\s+", " ", text)


def clean_number(val):
    if val is None:
        return 0.0

    s = str(val).strip()
    s = s.replace("₺", "").replace("TL", "").replace("TRY", "")
    s = s.replace("$", "").replace("USD", "")
    s = s.replace("€", "").replace("EUR", "")
    s = s.replace("%", "")
    s = s.replace(",", ".")
    s = s.replace("O", "0").replace("o", "0")

    if s.count(".") > 1:
        parts = s.split(".")
        s = "".join(parts[:-1]) + "." + parts[-1]

    s = re.sub(r"[^0-9.\-]", "", s)

    try:
        return float(s)
    except:
        return 0.0


def fix_ocr_text(line):
    line = clean_text(line)

    replacements = {
        "giin": "gün",
        "gin": "gün",
        "gun": "gün",
        "stak": "stok",
        "stin": "stok",
        "€€": "€",
        "$$": "$",
        "t1": "tl",
        "T1": "TL",
    }

    for old, new in replacements.items():
        line = line.replace(old, new)

    return clean_text(line)


def detect_company_name(lines, fallback, file_name):
    for line in lines[:10]:
        low = line.lower()

        if "firma" in low or "tedarik" in low or "satici" in low:
            parts = re.split(r":|-", line)
            if len(parts) > 1:
                return clean_text(parts[1])

        if len(line) > 3 and "teklif" not in low and "urun" not in low:
            return line

    if fallback:
        return fallback

    return os.path.splitext(file_name)[0]


def detect_footer(lines):
    vade = ""
    termin = ""
    dip = 0
    kdv = 0
    genel = 0

    for line in lines:
        low = line.lower()

        if "vade" in low or "odeme" in low:
            vade = line

        if "termin" in low or "teslim" in low:
            termin = line

        nums = re.findall(r"\d+(?:[.,]\d+)?", line)
        nums = [clean_number(x) for x in nums]

        if "toplam" in low:
            if nums:
                dip = nums[-1]

        if "kdv" in low:
            if nums:
                kdv = nums[-1]

        if "genel toplam" in low:
            if nums:
                genel = nums[-1]

    return vade, termin, dip, kdv, genel


def detect_currency(text):
    text = text.upper()
    if "$" in text or "USD" in text:
        return "USD"
    if "€" in text or "EUR" in text:
        return "EUR"
    return "TRY"


def should_skip_line(line):
    low = line.lower()

    return any(x in low for x in [
        "toplam", "kdv", "vade", "termin", "firma", "tarih"
    ])


def parse_offer_line(line):
    line = fix_ocr_text(line)

    if not line or should_skip_line(line):
        return None

    currency = detect_currency(line)

    price_match = re.search(
        r"(\d+(?:[.,]\d+)?)\s*(₺|TL|TRY|\$|USD|€|EUR)",
        line
    )

    if not price_match:
        return None

    price = clean_number(price_match.group(1))
    before = line[:price_match.start()].strip()
    after = line[price_match.end():].strip()

    discount = 0
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*%", line)
    if m:
        discount = clean_number(m.group(1))

    term = ""
    t = re.search(r"(\d+\s*gün|\d+-\d+\s*gün|stok|hemen)", line.lower())
    if t:
        term = t.group(1)

    tokens = before.split()

    if len(tokens) < 2:
        return None

    qty = clean_number(tokens[-1])
    desc_tokens = tokens[:-1]

    if qty <= 0:
        return None

    desc = " ".join(desc_tokens)

    return {
        "urunKodu": "",
        "urunAciklamasi": desc,
        "birim": "adet",
        "firmaAdedi": qty,
        "paraBirimi": currency,
        "birimFiyat": price,
        "iskonto": discount,
        "termin": term,
        "vade": "",
    }


def parse_image(image_path, firma_adi, file_name):
    img = read_image_unicode(image_path)

    if img is None:
        return []

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2, fy=2)
    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_OTSU)

    text = pytesseract.image_to_string(th, lang="eng")

    lines = [fix_ocr_text(l) for l in text.split("\n") if fix_ocr_text(l)]

    firma = detect_company_name(lines, firma_adi, file_name)
    vade, termin_footer, dip, kdv, genel = detect_footer(lines)

    rows = []

    for line in lines:
        parsed = parse_offer_line(line)
        if not parsed:
            continue

        rows.append({
            "firma": firma,
            "firmaAdi": firma,
            "urunKodu": parsed["urunKodu"],
            "urunAciklamasi": parsed["urunAciklamasi"],
            "birim": parsed["birim"],
            "firmaAdedi": parsed["firmaAdedi"],
            "paraBirimi": parsed["paraBirimi"],
            "birimFiyat": parsed["birimFiyat"],
            "iskonto": parsed["iskonto"],
            "vade": vade,
            "termin": parsed["termin"] or termin_footer,
            "firmaDipToplam": dip,
            "firmaKdv": kdv,
            "firmaGenelToplam": genel,
            "kaynakDosya": file_name,
            "kaynakTipi": "image",
        })

    return rows