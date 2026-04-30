import cv2
import pytesseract
import numpy as np
import re


def read_image_unicode(image_path):
    data = np.fromfile(image_path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def clean_text(val):
    text = str(val or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text


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


def detect_currency(text):
    text = str(text or "").upper()

    if "$" in text or "USD" in text:
        return "USD"
    if "€" in text or "EUR" in text:
        return "EUR"
    if "₺" in text or "TL" in text or "TRY" in text:
        return "TRY"

    return "TRY"


def should_skip_line(line):
    low = line.lower()

    skip_words = [
        "firma",
        "tarih",
        "teklif",
        "ürün kodu",
        "urun kodu",
        "ürün açıklaması",
        "urun aciklamasi",
        "birim fiyat",
        "toplam",
        "iskonto",
        "vade",
        "termin",
        "teslim",
    ]

    return any(word in low for word in skip_words)


def parse_offer_line(line):
    line = fix_ocr_text(line)

    if not line or should_skip_line(line):
        return None

    currency = detect_currency(line)

    price_match = re.search(
        r"(?P<price>\d+(?:[.,]\d+)?)\s*(?P<currency>₺|TL|TRY|\$|USD|€|EUR)",
        line,
        re.IGNORECASE,
    )

    if not price_match:
        return None

    price = clean_number(price_match.group("price"))
    before_price = line[:price_match.start()].strip()
    after_price = line[price_match.end():].strip()

    discount = 0.0
    discount_match = re.search(r"(\d+(?:[.,]\d+)?)\s*%", after_price)
    if discount_match:
        discount = clean_number(discount_match.group(1))

    term = ""
    term_match = re.search(
        r"(\d+\s*-\s*\d+\s*gün|\d+\s*gün|stok|hemen|hazır)",
        after_price,
        re.IGNORECASE,
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
    if re.fullmatch(r"[A-Za-z]{1,5}[-]?\d{1,6}", first):
        code = first
        desc_tokens = product_tokens[1:]

    desc = clean_text(" ".join(desc_tokens))

    if not desc:
        return None

    return {
        "urunKodu": code,
        "urunAciklamasi": desc,
        "birim": unit or "adet",
        "firmaAdedi": qty,
        "paraBirimi": currency,
        "birimFiyat": price,
        "iskonto": discount,
        "vade": "",
        "termin": term,
    }


def preprocess_image(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=1.8, fy=1.8, interpolation=cv2.INTER_CUBIC)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return th


def parse_image(image_path: str, firma_adi: str, file_name: str):
    img = read_image_unicode(image_path)

    if img is None:
        return []

    processed = preprocess_image(img)

    text = pytesseract.image_to_string(
        processed,
        lang="eng",
        config="--oem 3 --psm 6",
    )

    rows = []

    for raw_line in text.split("\n"):
        line = fix_ocr_text(raw_line)

        if not line:
            continue

        parsed = parse_offer_line(line)

        if not parsed:
            continue

        rows.append({
            "firmaAdi": firma_adi,
            "urunKodu": parsed["urunKodu"],
            "urunAciklamasi": parsed["urunAciklamasi"],
            "birim": parsed["birim"],
            "firmaAdedi": parsed["firmaAdedi"],
            "paraBirimi": parsed["paraBirimi"],
            "birimFiyat": parsed["birimFiyat"],
            "iskonto": parsed["iskonto"],
            "vade": parsed["vade"],
            "termin": parsed["termin"],
            "kaynakDosya": file_name,
            "kaynakTipi": "image",
        })

    return rows