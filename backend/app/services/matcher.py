from rapidfuzz import fuzz
from collections import Counter
from app.utils import normalize_text


def safe_float(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def rows_match(row1, row2, threshold=85):
    kod1 = normalize_text(row1.get("urunKodu", ""))
    kod2 = normalize_text(row2.get("urunKodu", ""))

    if kod1 and kod2 and kod1 == kod2:
        return True

    desc1 = normalize_text(row1.get("urunAciklamasi", ""))
    desc2 = normalize_text(row2.get("urunAciklamasi", ""))

    if not desc1 or not desc2:
        return False

    score = fuzz.token_sort_ratio(desc1, desc2)
    return score >= threshold


def build_master_row(offers):
    codes = [o.get("urunKodu", "") for o in offers if o.get("urunKodu")]
    descs = [o.get("urunAciklamasi", "") for o in offers if o.get("urunAciklamasi")]
    birims = [o.get("birim", "") for o in offers if o.get("birim")]

    real_codes = [c for c in codes if not str(c).upper().startswith("PRD-")]
    best_code = real_codes[0] if real_codes else (codes[0] if codes else "")
    best_desc = Counter(descs).most_common(1)[0][0] if descs else ""
    best_birim = Counter(birims).most_common(1)[0][0] if birims else "adet"

    adetler = []

    for o in offers:
        talep = safe_float(o.get("talepEdilenAdet", 0))
        firma_adedi = safe_float(o.get("firmaAdedi", 0))

        if talep > 0:
            adetler.append(talep)
        elif firma_adedi > 0:
            adetler.append(firma_adedi)

    # Şimdilik talep listesi bağlı olmadığı için en yüksek adet ana talep kabul ediliyor.
    # Talep listesi bağlanınca burası doğrudan talep dosyasından gelecek.
    talep_edilen_adet = max(adetler) if adetler else 1

    return {
        "urunKodu": best_code,
        "urunAciklamasi": best_desc,
        "birim": best_birim,
        "talepEdilenAdet": talep_edilen_adet,
    }


def group_rows(rows):
    groups = []

    for row in rows:
        matched = False

        for group in groups:
            if rows_match(row, group["master"]):
                group["offers"].append(row)
                group["master"] = build_master_row(group["offers"])
                matched = True
                break

        if not matched:
            groups.append({
                "master": build_master_row([row]),
                "offers": [row]
            })

    return groups