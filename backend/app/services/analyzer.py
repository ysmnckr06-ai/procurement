from app.utils import extract_days


def safe_float(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def calculate_net_price(birim_fiyat, iskonto):
    return birim_fiyat * (1 - (iskonto / 100.0))


def calculate_net_total(net_birim_fiyat_try, talep_edilen_adet):
    adet = talep_edilen_adet if talep_edilen_adet and talep_edilen_adet > 0 else 1
    return net_birim_fiyat_try * adet


def score_offer(row, exchange_rates, talep_edilen_adet):
    currency = str(row.get("paraBirimi", "TRY") or "TRY").upper().strip()

    if currency in ["TL", "₺"]:
        currency = "TRY"
    if currency in ["$", "USD"]:
        currency = "USD"
    if currency in ["€", "EUR"]:
        currency = "EUR"

    kur = exchange_rates.get(currency, 1)

    birim_fiyat = safe_float(row.get("birimFiyat", 0))
    iskonto = safe_float(row.get("iskonto", 0))
    firma_adedi = safe_float(row.get("firmaAdedi", 0))

    net_birim = calculate_net_price(birim_fiyat, iskonto)
    net_birim_try = net_birim * kur

    # ASIL DÜZELTME BURASI:
    # Net toplam artık firma adediyle değil, talep edilen adetle hesaplanıyor.
    net_toplam_try = calculate_net_total(net_birim_try, talep_edilen_adet)

    vade_days = extract_days(row.get("vade", "0"))
    termin_days = extract_days(row.get("termin", "0"))

    eksik_adet = max(0, talep_edilen_adet - firma_adedi) if firma_adedi > 0 else talep_edilen_adet
    eksik_adet_cezasi = eksik_adet * net_birim_try * 2

    # Profesyonel skor:
    # düşük fiyat iyi, uzun vade iyi, kısa termin iyi, eksik adet kötü
    score = (
        net_toplam_try * 0.65
        + max(0, 90 - vade_days) * 2.0
        + termin_days * 2.5
        + eksik_adet_cezasi
    )

    karar_notlari = []

    if eksik_adet > 0:
        karar_notlari.append(f"Firma talep adedinden {int(eksik_adet)} adet eksik teklif verdi")

    if not birim_fiyat:
        karar_notlari.append("Birim fiyat eksik")

    if not row.get("termin"):
        karar_notlari.append("Termin bilgisi eksik")

    if not row.get("vade"):
        karar_notlari.append("Vade bilgisi eksik")

    return {
        "netBirimFiyat": round(net_birim, 4),
        "netBirimFiyatTRY": round(net_birim_try, 4),
        "netToplamTRY": round(net_toplam_try, 4),
        "score": round(score, 4),
        "eksikAdet": round(eksik_adet, 2),
        "kararNotlari": karar_notlari,
    }


def analyze_groups(groups, exchange_rates):
    analyzed = []

    for group in groups:
        master = group.get("master", {})
        offers_raw = group.get("offers", [])

        talep_edilen_adet = safe_float(master.get("talepEdilenAdet", 0))

        if talep_edilen_adet <= 0:
            talep_edilen_adet = max(
                [safe_float(o.get("firmaAdedi", 0)) for o in offers_raw] or [1]
            )

        offers = []

        for row in offers_raw:
            metrics = score_offer(row, exchange_rates, talep_edilen_adet)
            merged = {**row, **metrics}
            offers.append(merged)

        offers = sorted(offers, key=lambda x: x["score"])
        best_offer = offers[0] if offers else None

        analyzed.append({
            "urunKodu": master.get("urunKodu", ""),
            "urunAciklamasi": master.get("urunAciklamasi", ""),
            "birim": master.get("birim", ""),
            "talepEdilenAdet": talep_edilen_adet,
            "offers": offers,
            "bestOffer": best_offer
        })

    return analyzed