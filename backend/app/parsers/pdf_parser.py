import pdfplumber
import re


def clean_text(val):
    if val is None:
        return ""
    text = str(val).strip()
    if text.lower() in ["nan", "none", "null"]:
        return ""
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
    s = re.sub(r"[^0-9.\-]", "", s)

    try:
        return float(s)
    except:
        return 0.0


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


def parse_pdf_line(line):
    line = clean_text(line)

    if not line or should_skip_line(line):
        return None

    # Örnekler:
    # A101 Pilot Kalem Mavi 100 adet 12,50 TL 7-14 gün
    # Pilot Kalem Mavi 100 12,50 TL 7-14 gün
    # kalem 10 $ 0,3 0% 30 gün stok

    currency = detect_currency(line)

    price_match = re.search(
        r"(?P<price>\d+(?:[.,]\d+)?)\s*(?P<currency>₺|TL|TRY|\$|USD|€|EUR)",
        line,
        re.IGNORECASE
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
    if re.fullmatch(r"[A-Za-z]{1,5}[-]?\d{1,6}", first):
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


def parse_pdf(file_path, firma_adi, file_name):
    rows = []

    with pdfplumber.open(file_path) as pdf:
        full_text = "\n".join([page.extract_text() or "" for page in pdf.pages])

    lines = [clean_text(x) for x in full_text.split("\n") if clean_text(x)]

    for line in lines:
        parsed = parse_pdf_line(line)

        if not parsed:
            continue

        rows.append({
            "firmaAdi": firma_adi,
            "urunKodu": parsed["urunKodu"],
            "urunAciklamasi": parsed["urunAciklamasi"],
            "birim": parsed["birim"] or "adet",
            "firmaAdedi": parsed["firmaAdedi"],
            "paraBirimi": parsed["paraBirimi"] or "TRY",
            "birimFiyat": parsed["birimFiyat"],
            "iskonto": parsed["iskonto"],
            "vade": parsed["vade"],
            "termin": parsed["termin"],
            "kaynakDosya": file_name,
            "kaynakTipi": "pdf",
        })

    return rows