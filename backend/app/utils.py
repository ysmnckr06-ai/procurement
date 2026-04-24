import re
import unicodedata


def clean_text(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    text = text.replace("\n", " ").replace("\r", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_text(value: str) -> str:
    value = clean_text(value).lower()
    value = value.replace("ı", "i").replace("ş", "s").replace("ğ", "g")
    value = value.replace("ü", "u").replace("ö", "o").replace("ç", "c")
    value = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in value if not unicodedata.combining(ch))


def safe_float(value, default=0.0):
    if value is None:
        return default

    s = str(value).strip()
    if not s:
        return default

    s = s.replace("TL", "").replace("TRY", "").replace("₺", "")
    s = s.replace("$", "").replace("USD", "").replace("EUR", "").replace("€", "")
    s = s.replace("%", "")
    s = s.replace(" ", "")

    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(".", "").replace(",", ".")

    try:
        return float(s)
    except:
        return default


def safe_str(value, default=""):
    text = clean_text(value)
    return text if text else default


def parse_currency(value: str) -> str:
    s = normalize_text(value)
    raw = str(value)

    if "usd" in s or "$" in raw:
        return "USD"
    if "eur" in s or "€" in raw:
        return "EUR"
    return "TRY"


def parse_discount(value) -> float:
    return safe_float(value, 0.0)


def extract_days(text: str) -> int:
    s = normalize_text(text)
    m = re.search(r"(\d+)", s)
    return int(m.group(1)) if m else 0