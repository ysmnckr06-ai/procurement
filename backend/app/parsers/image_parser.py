import cv2
import pytesseract
import numpy as np
import re


def read_image_unicode(image_path):
    data = np.fromfile(image_path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def clean_number(val):
    if val is None:
        return 0.0

    s = str(val).strip()

    s = s.replace("€", "").replace("$", "").replace("₺", "")
    s = s.replace("%", "")
    s = s.replace(",", ".")
    s = s.replace("O", "0").replace("o", "0")

    #  OCR düzeltme (14 -> 1.4 gibi)
    if re.fullmatch(r"\d{2}", s):
        s = f"{s[0]}.{s[1]}"

    if re.fullmatch(r"\d{3}", s):
        s = f"{s[0]}.{s[1:]}"

    try:
        return float(s)
    except:
        return 0.0


def fix_ocr_text(line):
    line = line.strip()

    replacements = {
        "giin": "gün",
        "gin": "gün",
        "gun": "gün",
        "stak": "stok",
        "stin": "stok",
        "pdro": "pdr0",
        "pdrO": "pdr0",
        "€€": "€",
        "$$": "$",
        "4hafta": "4 hafta",
        "1hafta": "1 hafta",
        "2hafta": "2 hafta",
        "3hafta": "3 hafta",
    }

    for old, new in replacements.items():
        line = line.replace(old, new)

    line = re.sub(r"\s+", " ", line)
    line = re.sub(r"(\d+)\s*gün", r"\1 gün", line)

    return line


def detect_currency(symbol):
    if symbol == "$":
        return "USD"
    if symbol == "€":
        return "EUR"
    return "TRY"


def parse_offer_line(line):
    """
    Genel mantık:
    pdr001 kalem 10 € 0,25€ 0% 4% 45 gün stok

    - ilk kod = ürün kodu
    - ilk sayıdan önceki metin = açıklama
    - ilk sayı = adet
    - para sembolü = para birimi
    - sembolden sonraki sayı = fiyat
    - yüzde değerlerinden sonuncusu = iskonto
    - gün = vade
    - kalan = termin
    """

    line = fix_ocr_text(line)

    pattern = re.compile(
        r"^(?P<kod>[A-Za-z0-9\-_.]+)\s+"
        r"(?P<aciklama>.+?)\s+"
        r"(?P<adet>\d+)\s+"
        r"(?P<para>[€$₺]|TRY|TL|EUR|USD)\s*"
        r"(?P<fiyat>[\d.,]+)\s*[€$₺]?\s+"
        r"(?P<yuzdeler>(?:\d+%\s*)*)"
        r"(?P<vade>\d+)\s*gün\s+"
        r"(?P<termin>.+)$",
        re.IGNORECASE
    )

    m = pattern.match(line)

    if not m:
        return None

    yuzdeler = re.findall(r"(\d+)%", m.group("yuzdeler") or "")
    iskonto = clean_number(yuzdeler[-1]) if yuzdeler else 0.0

    para_raw = m.group("para").upper()
    if para_raw in ["€", "EUR"]:
        para_birimi = "EUR"
    elif para_raw in ["$", "USD"]:
        para_birimi = "USD"
    else:
        para_birimi = "TRY"

    return {
        "urunKodu": m.group("kod").strip(),
        "urunAciklamasi": m.group("aciklama").strip(),
        "firmaAdedi": clean_number(m.group("adet")),
        "paraBirimi": para_birimi,
        "birimFiyat": clean_number(m.group("fiyat")),
        "iskonto": iskonto,
        "vade": f"{m.group('vade')} gün",
        "termin": m.group("termin").strip(),
    }


def parse_image(image_path: str, firma_adi: str, file_name: str):
    img = read_image_unicode(image_path)

    if img is None:
        return []

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    text = pytesseract.image_to_string(
        gray,
        lang="eng",
        config="--oem 3 --psm 6"
    )

    rows = []

    for raw_line in text.split("\n"):
        line = fix_ocr_text(raw_line)

        if not line:
            continue

        # başlıkları geç
        low = line.lower()
        if "firma" in low or "tarih" in low or "ürün kodu" in low or "urun kodu" in low:
            continue

        parsed = parse_offer_line(line)

        if not parsed:
            continue

        rows.append({
            "firmaAdi": firma_adi,
            "urunKodu": parsed["urunKodu"],
            "urunAciklamasi": parsed["urunAciklamasi"],
            "birim": "adet",
            "talepEdilenAdet": 0,
            "firmaAdedi": parsed["firmaAdedi"],
            "paraBirimi": parsed["paraBirimi"],
            "birimFiyat": parsed["birimFiyat"],
            "iskonto": parsed["iskonto"],
            "vade": parsed["vade"],
            "termin": parsed["termin"],
            "kaynakDosya": file_name,
            "kaynakTipi": "image"
        })

    return rows