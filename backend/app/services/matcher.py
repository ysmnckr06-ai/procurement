from rapidfuzz import fuzz
from app.utils import normalize_text


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


def group_rows(rows):
    groups = []

    for row in rows:
        matched = False

        for group in groups:
            if rows_match(row, group["master"]):
                group["offers"].append(row)
                matched = True
                break

        if not matched:
            groups.append({
                "master": row,
                "offers": [row]
            })

    return groups