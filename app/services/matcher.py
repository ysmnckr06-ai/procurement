from rapidfuzz import fuzz
from collections import Counter
from app.utils import normalize_text


def safe_float(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        if isinstance(value, str):
            value = value.replace(",", ".").strip()
        return float(value)
    except Exception:
        return default


def clean_code(code):
    code = normalize_text(str(code or "")).upper().strip()

    if code in ["", "NAN", "NONE", "NULL", "-"]:
        return ""

    return code


def clean_desc(desc):
    return normalize_text(str(desc or "")).strip()


def token_set(desc):
    return set(clean_desc(desc).split())


def desc_is_same(a, b):
    d1 = clean_desc(a)
    d2 = clean_desc(b)

    if not d1 or not d2:
        return False

    if d1 == d2:
        return True

    t1 = token_set(d1)
    t2 = token_set(d2)

    if not t1 or not t2:
        return False

    # Kısa genel açıklama, uzun açıklamanın içinde diye aynı sayılmaz.
    # Örn: "kalem" ≠ "pilot kalem"
    if t1.issubset(t2) or t2.issubset(t1):
        if len(t1) != len(t2):
            return False

    score_sort = fuzz.token_sort_ratio(d1, d2)
    score_set = fuzz.token_set_ratio(d1, d2)

    return max(score_sort, score_set) >= 92


def rows_match(row1, row2):
    kod1 = clean_code(row1.get("urunKodu", ""))
    kod2 = clean_code(row2.get("urunKodu", ""))

    desc1 = clean_desc(row1.get("urunAciklamasi", ""))
    desc2 = clean_desc(row2.get("urunAciklamasi", ""))

    birim1 = clean_desc(row1.get("birim", "adet") or "adet")
    birim2 = clean_desc(row2.get("birim", "adet") or "adet")

    if birim1 and birim2 and birim1 != birim2:
        return False

    if not desc1 or not desc2:
        return False

    # Açıklama aynıysa kod farklı olsa bile eşleşir.
    if desc_is_same(desc1, desc2):
        return True

    # Kod aynıysa bile açıklama da güçlü şekilde benzemeli.
    # Böylece A001 SİLGİ ile A001 KURŞUN KALEM karışmaz.
    if kod1 and kod2 and not kod1.startswith("PRD") and not kod2.startswith("PRD"):
        if kod1 == kod2 and desc_is_same(desc1, desc2):
            return True

    return False


def build_master_row(offers):
    codes = [o.get("urunKodu", "") for o in offers if o.get("urunKodu")]
    descs = [o.get("urunAciklamasi", "") for o in offers if o.get("urunAciklamasi")]
    birims = [o.get("birim", "") for o in offers if o.get("birim")]

    real_codes = [
        c for c in codes
        if c and not str(c).upper().startswith("PRD")
    ]

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
                "offers": [row],
            })

    return groups


def match_offers_to_requests(offers, requests):
    groups = []

    for req in requests:
        matched = []

        for off in offers:
            if rows_match(req, off):
                matched.append(off)

        groups.append({
            "master": {
                "urunKodu": req.get("urunKodu", ""),
                "urunAciklamasi": req.get("urunAciklamasi", ""),
                "birim": req.get("birim", "adet"),
                "talepEdilenAdet": safe_float(
                    req.get("talepEdilenAdet")
                    or req.get("miktar")
                    or req.get("firmaAdedi")
                    or 0
                ),
            },
            "offers": matched,
        })

    return groups