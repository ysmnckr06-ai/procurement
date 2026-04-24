import pandas as pd


def find_header_row(df):
    for i in range(len(df)):
        row = " ".join([str(x).lower() for x in df.iloc[i].values])
        if "ürün" in row and "fiyat" in row:
            return i
    return 0


def clean_number(val):
    if val is None:
        return 0

    val = str(val).replace("€", "").replace("$", "").replace("%", "")
    val = val.replace(",", ".").strip()

    try:
        return float(val)
    except:
        return 0


def parse_excel(file_path, firma_adi, file_name):
    df = pd.read_excel(file_path, header=None)

    header_row = find_header_row(df)
    df.columns = df.iloc[header_row]
    df = df[header_row + 1:]

    df = df.dropna(how="all")

    rows = []

    for _, r in df.iterrows():
        try:
            rows.append({
                "firmaAdi": firma_adi,
                "urunKodu": str(r.get("ürün kodu", "")).strip(),
                "urunAciklamasi": str(r.get("ürün açıklaması", "")).strip(),
                "birim": "adet",
                "firmaAdedi": clean_number(r.get("adet")),
                "paraBirimi": str(r.get("para birimi", "TRY")).strip(),
                "birimFiyat": clean_number(r.get("birim fiyatı")),
                "iskonto": clean_number(r.get("iskonto")),
                "vade": str(r.get("vade", "")).strip(),
                "termin": str(r.get("termin", "")).strip()
            })
        except:
            continue

    return rows