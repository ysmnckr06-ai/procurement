import pdfplumber
import re


def clean_number(val):
    if val is None:
        return 0.0
    s = str(val).strip()
    s = s.replace("$", "").replace("€", "").replace("%", "")
    s = s.replace(",", ".")
    try:
        return float(s)
    except:
        return 0.0


def parse_pdf(file_path, firma_adi, file_name):
    rows = []
    row_no = 1

    with pdfplumber.open(file_path) as pdf:
        full_text = "\n".join([page.extract_text() or "" for page in pdf.pages])

    lines = [x.strip() for x in full_text.split("\n") if x.strip()]

    for line in lines:
        low = line.lower()

        if low.startswith("b firması"):
            continue
        if "firma/talep sahibi" in low:
            continue
        if low.startswith("tarih"):
            continue
        if "ürün kodu" in low:
            continue

        # Örnek:
        # kalem 10 $ 0,3 0% 30 gün stok
        # yeşil kalem 40 $ 2,05 30 gün stok
        pattern = re.compile(
            r"^(.+?)\s+(\d+)\s+([$€])\s+([\d.,]+)(?:\s+(\d+)%)?\s+(\d+)\s+gün\s+(.+)$",
            re.IGNORECASE
        )

        m = pattern.match(line)

        if not m:
            continue

        urun_aciklamasi = m.group(1).strip()
        adet = clean_number(m.group(2))
        para = "USD" if m.group(3) == "$" else "EUR"
        fiyat = clean_number(m.group(4))
        iskonto = clean_number(m.group(5)) if m.group(5) else 0.0
        vade = f"{m.group(6)} gün"
        termin = m.group(7).strip()

        rows.append({
            "firmaAdi": firma_adi,
            "urunKodu": f"PDF-{row_no:04d}",
            "urunAciklamasi": urun_aciklamasi,
            "birim": "adet",
            "talepEdilenAdet": adet,
            "firmaAdedi": adet,
            "paraBirimi": para,
            "birimFiyat": fiyat,
            "iskonto": iskonto,
            "vade": vade,
            "termin": termin,
            "kaynakDosya": file_name,
            "kaynakTipi": "pdf"
        })

        row_no += 1

    return rows