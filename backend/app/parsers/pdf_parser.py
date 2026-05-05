import pdfplumber
import re
import os


def clean_text(val):
    if val is None:
        return ""
    text = str(val).strip()
    if text.lower() in ["nan", "none", "null"]:
        return ""
    return re.sub(r"\s+", " ", text)

def normalize_tr(val):
    text = str(val or "").lower()
    text = text.replace("ı", "i").replace("İ".lower(), "i")
    text = text.replace("ğ", "g").replace("ü", "u").replace("ş", "s").replace("ö", "o").replace("ç", "c")
    text = text.replace("̇", "")  # Türkçe İ nokta problemi
    return clean_text(text)

def clean_number(val):
    if val is None:
        return 0.0

    s = str(val).strip()
    s = s.replace("₺", "").replace("TL", "").replace("TRY", "")
    s = s.replace("$", "").replace("USD", "")
    s = s.replace("€", "").replace("EUR", "")
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


def detect_currency(text):
    text = str(text or "").upper()

    if "$" in text or "USD" in text:
        return "USD"
    if "€" in text or "EUR" in text:
        return "EUR"
    return "TRY"


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

        if "vade" in low or "ödeme" in low or "odeme" in low:
            vade = line

        if "termin" in low or "teslim" in low:
            termin = line

        nums = re.findall(r"\d+(?:[.,]\d+)?", line)
        nums = [clean_number(x) for x in nums]

        if "ara toplam" in low or "dip toplam" in low:
            if nums:
                dip_toplam = nums[-1]

        if "kdv" in low:
            if nums:
                kdv = nums[-1]

        if "genel toplam" in low or "yekun" in low or "yekün" in low:
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

    skip_words = [
        "not",
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
    ]

    return any(word in low for word in skip_words)


def parse_pdf_line(line):
    line = clean_text(line)

    if not line or should_skip_line(line):
        return None
    
    low = normalize_tr(line)

    
    if re.match(r"^(dip toplam|genel toplam|kdv)", low):
        return None 
    
    currency = detect_currency(line)

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


def parse_pdf(file_path, firma_adi="", file_name=""):
    rows = []

    with pdfplumber.open(file_path) as pdf:
        full_text = "\n".join([page.extract_text() or "" for page in pdf.pages])

    firma = detect_company_name(full_text, firma_adi, file_name)
    footer = detect_footer_info(full_text)

    lines = [clean_text(x) for x in full_text.split("\n") if clean_text(x)]

    for line in lines:
        parsed = parse_pdf_line(line)

        if not parsed:
            continue

        rows.append({
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
        })

    return rows