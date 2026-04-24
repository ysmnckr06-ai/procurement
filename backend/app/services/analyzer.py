from app.utils import extract_days


def calculate_net_price(birim_fiyat, iskonto):
    return birim_fiyat * (1 - (iskonto / 100.0))


def calculate_net_total(net_birim_fiyat, firma_adedi):
    adet = firma_adedi if firma_adedi and firma_adedi > 0 else 1
    return net_birim_fiyat * adet


def score_offer(row, exchange_rates):
    currency = row.get("paraBirimi", "TRY")
    kur = exchange_rates.get(currency, 1)

    birim_fiyat = float(row.get("birimFiyat", 0) or 0)
    iskonto = float(row.get("iskonto", 0) or 0)
    firma_adedi = float(row.get("firmaAdedi", 0) or 0)

    net_birim = calculate_net_price(birim_fiyat, iskonto)
    net_birim_try = net_birim * kur
    net_toplam_try = calculate_net_total(net_birim_try, firma_adedi)

    vade_days = extract_days(row.get("vade", "0"))
    termin_days = extract_days(row.get("termin", "0"))

    # düşük net toplam iyi
    # yüksek vade iyi
    # düşük termin iyi
    score = (
        net_toplam_try * 0.70
        + max(0, 90 - vade_days) * 1.50
        + termin_days * 1.20
    )

    return {
        "netBirimFiyat": round(net_birim, 4),
        "netBirimFiyatTRY": round(net_birim_try, 4),
        "netToplamTRY": round(net_toplam_try, 4),
        "score": round(score, 4)
    }


def analyze_groups(groups, exchange_rates):
    analyzed = []

    for group in groups:
        offers = []

        for row in group["offers"]:
            metrics = score_offer(row, exchange_rates)
            merged = {**row, **metrics}
            offers.append(merged)

        offers = sorted(offers, key=lambda x: x["score"])
        best_offer = offers[0] if offers else None

        analyzed.append({
            "urunKodu": group["master"].get("urunKodu", ""),
            "urunAciklamasi": group["master"].get("urunAciklamasi", ""),
            "birim": group["master"].get("birim", ""),
            "talepEdilenAdet": group["master"].get("talepEdilenAdet", 0),
            "offers": offers,
            "bestOffer": best_offer
        })

    return analyzed