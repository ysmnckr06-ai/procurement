import pandas as pd
from app.utils import normalize_text, safe_float, safe_str, parse_currency


COLUMN_ALIASES = {
    "urunKodu": [
        "urun kodu", "ürün kodu", "stok kodu", "stok kod", "malzeme kodu", "kod"
    ],
    "urunAciklamasi": [
        "urun aciklamasi", "ürün açıklaması", "aciklama", "açıklama",
        "urun adi", "ürün adı", "malzeme", "kalem", "description"
    ],
    "birim": [
        "birim", "unit", "olcu birimi", "ölçü birimi"
    ],
    "firmaAdedi": [
        "miktar", "adet", "miktari", "miktarı", "teklif miktar", "firma adedi", "qty", "quantity"
    ],
    "birimFiyat": [
        "birim fiyat", "fiyat", "unit price", "teklif fiyat", "fiyat tl", "fiyat usd"
    ],
    "paraBirimi": [
        "para birimi", "currency", "doviz", "döviz"
    ],
    "iskonto": [
        "iskonto", "indirim", "discount"
    ],
    "vade": [
        "vade", "odeme vadesi", "ödeme vadesi", "payment term"
    ],
    "termin": [
        "termin", "teslim suresi", "teslim süresi", "lead time"
    ]
}


def find_column(columns, aliases):
    normalized_cols = {col: normalize_text(col) for col in columns}
    for alias in aliases:
        n_alias = normalize_text(alias)
        for original, normalized in normalized_cols.items():
            if n_alias == normalized or n_alias in normalized:
                return original
    return None


def normalize_dataframe(df: pd.DataFrame, firma_adi: str, kaynak_dosya: str, kaynak_tipi: str):
    df = df.copy()
    df.columns = [safe_str(c) for c in df.columns]

    mapping = {}
    for target, aliases in COLUMN_ALIASES.items():
        col = find_column(df.columns, aliases)
        mapping[target] = col

    rows = []
    for _, row in df.iterrows():
        urun_kodu = safe_str(row[mapping["urunKodu"]]) if mapping["urunKodu"] else ""
        aciklama = safe_str(row[mapping["urunAciklamasi"]]) if mapping["urunAciklamasi"] else ""
        birim = safe_str(row[mapping["birim"]]) if mapping["birim"] else ""
        firma_adedi = safe_float(row[mapping["firmaAdedi"]]) if mapping["firmaAdedi"] else 0
        birim_fiyat = safe_float(row[mapping["birimFiyat"]]) if mapping["birimFiyat"] else 0
        iskonto = safe_float(row[mapping["iskonto"]]) if mapping["iskonto"] else 0
        vade = safe_str(row[mapping["vade"]]) if mapping["vade"] else ""
        termin = safe_str(row[mapping["termin"]]) if mapping["termin"] else ""

        para_birimi = "TRY"
        if mapping["paraBirimi"]:
            para_birimi = parse_currency(safe_str(row[mapping["paraBirimi"]]))
        else:
            if mapping["birimFiyat"]:
                para_birimi = parse_currency(mapping["birimFiyat"])

        if not urun_kodu and not aciklama:
            continue

        rows.append({
            "firmaAdi": firma_adi,
            "urunKodu": urun_kodu,
            "urunAciklamasi": aciklama,
            "birim": birim,
            "talepEdilenAdet": 0,
            "firmaAdedi": firma_adedi,
            "paraBirimi": para_birimi,
            "birimFiyat": birim_fiyat,
            "iskonto": iskonto,
            "vade": vade,
            "termin": termin,
            "kaynakDosya": kaynak_dosya,
            "kaynakTipi": kaynak_tipi
        })

    return rows