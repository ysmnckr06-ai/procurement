from app.utils import extract_days

DEFAULT_DECISION_CONFIG = {
    "currency_rates": {
        "USD": 39.2,
        "EUR": 42.8,
        "GBP": 41.2
    }
}

DEFAULT_USER_CONSTRAINTS = {
    "max_budget": None,                # örn: 50000
    "min_vade_days": None,             # örn: 60
    "max_termin_days": None,           # örn: 10
    "allow_missing_qty": False,
}

DEFAULT_USER_PREFERENCES = {
    "annual_interest_rate": 45,

    "critical_level": "medium",
    "delay_impact": "medium",
    "alternative_stock": "partial",

    "shipping_included": "included",
    "shipping_cost": 0,

    "supplier_trust": "medium",
    "quality_history": "unknown",

    "currency_risk": "medium",
}

def calculate_offer_score(offer, all_offers):
    """
    Satınalma puanı hesaplar.
    Fiyat düşükse iyi, vade yüksekse iyi, termin düşükse iyi.
    """

    price_weight = 0.50
    vade_weight = 0.25
    termin_weight = 0.25

    prices = [o.get("tcoTRY", 0) or 0 for o in all_offers if (o.get("tcoTRY", 0) or 0) > 0]
    vades = [o.get("vadeDays", 0) or 0 for o in all_offers]
    termins = [o.get("terminDays", 0) or 0 for o in all_offers if (o.get("terminDays", 0) or 0) > 0]

    price = offer.get("tcoTRY", 0) or 0
    vade = offer.get("vadeDays", 0) or 0
    termin = offer.get("terminDays", 0) or 0

    # Fiyat puanı: en düşük fiyat en yüksek puanı alır
    if prices and price > 0:
        min_price = min(prices)
        price_score = min_price / price
    else:
        price_score = 0

    # Vade puanı: en yüksek vade en yüksek puanı alır
    if vades and max(vades) > 0:
        vade_score = vade / max(vades)
    else:
        vade_score = 0

    # Termin puanı: en düşük termin en yüksek puanı alır
    if termins and termin > 0:
        min_termin = min(termins)
        termin_score = min_termin / termin
    else:
        termin_score = 0

    total_score = (
        price_score * price_weight +
        vade_score * vade_weight +
        termin_score * termin_weight
    ) * 100

    return round(total_score, 2)

def safe_float(value, default=0.0):
    try:
        if value is None or value == "":
            return default

        if isinstance(value, str):
            value = (
                value.replace("₺", "")
                .replace("TL", "")
                .replace("TRY", "")
                .replace("$", "")
                .replace("USD", "")
                .replace("€", "")
                .replace("EUR", "")
                .replace("%", "")
                .replace(",", ".")
                .strip()
            )

        return float(value)
    except Exception:
        return default

def normalize_currency(value):
    currency = str(value or "TRY").upper().strip()

    if currency in ["TL", "₺", "TRY", "TÜRK LİRASI"]:
        return "TRY"
    if currency in ["$", "USD", "DOLAR"]:
        return "USD"
    if currency in ["€", "EUR", "EURO"]:
        return "EUR"

    return "TRY"

def merge_config(config):
    merged = DEFAULT_DECISION_CONFIG.copy()
    if config:
        merged.update(config)
    return merged

def merge_constraints(constraints):
    merged = DEFAULT_USER_CONSTRAINTS.copy()
    if constraints:
        merged.update(constraints)
    return merged

def merge_preferences(preferences):
    merged = DEFAULT_USER_PREFERENCES.copy()
    if preferences:
        merged.update(preferences)
    return merged

def calculate_net_price(birim_fiyat, iskonto):
    return birim_fiyat * (1 - (iskonto / 100.0))

def calculate_net_total(net_birim_fiyat_try, talep_edilen_adet):
    adet = talep_edilen_adet if talep_edilen_adet and talep_edilen_adet > 0 else 1
    return net_birim_fiyat_try * adet

def calculate_finance_advantage(net_toplam_try, vade_days, annual_interest_rate):
    daily_rate = (annual_interest_rate / 100) / 365
    return net_toplam_try * daily_rate * vade_days

def calculate_delay_penalty(termin_days, daily_delay_cost):
    return termin_days * daily_delay_cost

def calculate_missing_qty_cost(eksik_adet, net_birim_try, multiplier):
    if eksik_adet <= 0:
        return 0
    return eksik_adet * net_birim_try * multiplier

def calculate_supplier_risk(net_toplam_try, supplier_risk_rate):
    return net_toplam_try * (supplier_risk_rate / 100)

def calculate_advanced_risk_costs(net_toplam_try, constraints):
    critical_map = {
        "low": 0.00,
        "medium": 0.03,
        "high": 0.07,
        "critical": 0.12,
    }

    delay_map = {
        "none": 0.00,
        "low": 0.02,
        "medium": 0.05,
        "high": 0.10,
    }

    stock_map = {
        "full": 0.00,
        "partial": 0.05,
        "none": 0.15,
    }

    shipping_map = {
        "included": 0.00,
        "excluded": 0.03,
        "unknown": 0.05,
    }

    trust_map = {
        "high": 0.00,
        "medium": 0.02,
        "low": 0.05,
    }

    quality_map = {
        "good": 0.00,
        "medium": 0.03,
        "bad": 0.08,
        "unknown": 0.04,
    }

    currency_map = {
        "none": 0.00,
        "low": 0.02,
        "medium": 0.05,
        "high": 0.08,
    }

    critical_rate = critical_map.get(constraints.get("critical_level", "medium"), 0.03)
    delay_rate = delay_map.get(constraints.get("delay_impact", "medium"), 0.05)
    stock_rate = stock_map.get(constraints.get("alternative_stock", "partial"), 0.05)
    shipping_rate = shipping_map.get(constraints.get("shipping_included", "included"), 0.00)
    trust_rate = trust_map.get(constraints.get("supplier_trust", "medium"), 0.02)
    quality_rate = quality_map.get(constraints.get("quality_history", "unknown"), 0.04)
    currency_rate = currency_map.get(constraints.get("currency_risk", "medium"), 0.05)

    shipping_cost = safe_float(constraints.get("shipping_cost"), 0)

    total_risk_rate = (
        critical_rate
        + delay_rate
        + stock_rate
        + shipping_rate
        + trust_rate
        + quality_rate
        + currency_rate
    )

    # Güvenlik sınırı: toplam risk etkisi net toplamın %35'ini geçmesin
    total_risk_rate = min(total_risk_rate, 0.35)

    advanced_risk_cost = net_toplam_try * total_risk_rate + shipping_cost

    return {
        "criticalRiskRate": critical_rate,
        "delayRiskRate": delay_rate,
        "stockRiskRate": stock_rate,
        "shippingRiskRate": shipping_rate,
        "supplierTrustRiskRate": trust_rate,
        "qualityRiskRate": quality_rate,
        "currencyRiskRate": currency_rate,
        "totalRiskRate": total_risk_rate,
        "advancedRiskCostTRY": round(advanced_risk_cost, 4),
    }

def normalize_weights(preferences):
    total = (
        safe_float(preferences.get("price_weight", 0))
        + safe_float(preferences.get("vade_weight", 0))
        + safe_float(preferences.get("termin_weight", 0))
        + safe_float(preferences.get("risk_weight", 0))
    )

    if total <= 0:
        return DEFAULT_USER_PREFERENCES.copy()

    return {
        "price_weight": safe_float(preferences.get("price_weight", 0)) / total,
        "vade_weight": safe_float(preferences.get("vade_weight", 0)) / total,
        "termin_weight": safe_float(preferences.get("termin_weight", 0)) / total,
        "risk_weight": safe_float(preferences.get("risk_weight", 0)) / total,
    }

def apply_constraints(metrics, constraints):
    reasons = []

    max_budget = safe_float(constraints.get("max_budget"), 0)
    min_vade = safe_float(constraints.get("min_vade_days"), 0)
    max_termin = safe_float(constraints.get("max_termin_days"), 0)
    allow_missing = constraints.get("allow_missing_qty", False)

    if max_budget > 0:
        if metrics["tcoTRY"] > max_budget:
            reasons.append(f"Bütçe üst limitini aşıyor ({metrics['tcoTRY']:.2f} TRY)")

    if min_vade > 0:
        if metrics["vadeDays"] < min_vade:
            reasons.append(f"Minimum vade şartını sağlamıyor ({metrics['vadeDays']} gün)")

    if max_termin > 0:
        if metrics["terminDays"] > max_termin:
            reasons.append(f"Maksimum termin şartını aşıyor ({metrics['terminDays']} gün)")

    if not allow_missing and metrics["eksikAdet"] > 0:
        reasons.append(f"Eksik adet var ({metrics['eksikAdet']})")

    return {
        "eligible": len(reasons) == 0,
        "eliminationReasons": reasons,
    }

def score_offer(row, exchange_rates, talep_edilen_adet, config=None, constraints=None, preferences=None):
    config = merge_config(config)
    constraints = merge_constraints(constraints)
    preferences = merge_preferences(preferences)
    weights = normalize_weights(preferences)

    currency = normalize_currency(row.get("paraBirimi", "TRY"))
    kur = exchange_rates.get(currency, 1)

    birim_fiyat = safe_float(row.get("birimFiyat", 0))
    iskonto = safe_float(row.get("iskonto", 0))
    firma_adedi = safe_float(row.get("firmaAdedi", 0))

    net_birim_pdf = safe_float(row.get("netBirimFiyat", 0))
    net_toplam_pdf = safe_float(row.get("netToplam", 0))

            # PDF'den iskonto sonrası net birim fiyat geldiyse onu kullan
    if net_birim_pdf > 0:
        net_birim = net_birim_pdf
    else:
        net_birim = calculate_net_price(birim_fiyat, iskonto)

    net_birim_try = net_birim * kur

            # PDF'den satır toplamı geldiyse onu kullan, tekrar hesaplama
    if net_toplam_pdf > 0:
        net_toplam_try = net_toplam_pdf * kur
    else:
        net_toplam_try = calculate_net_total(net_birim_try, talep_edilen_adet)

    vade_days = extract_days(row.get("vade", "0"))
    termin_days = extract_days(row.get("termin", "0"))

    eksik_adet = 0
    if firma_adedi > 0 and firma_adedi < talep_edilen_adet:
        eksik_adet = talep_edilen_adet - firma_adedi

    finance_advantage = calculate_finance_advantage(
        net_toplam_try,
        vade_days,
        safe_float(constraints.get("annual_interest_rate", config.get("annual_interest_rate", 45)))
    )

    delay_penalty = calculate_delay_penalty(
        termin_days,
        safe_float(config.get("daily_delay_cost", 0))
    )

    missing_qty_cost = calculate_missing_qty_cost(
        eksik_adet,
        net_birim_try,
        safe_float(config.get("missing_qty_penalty_multiplier", 1.25))
    )

    supplier_risk_cost = calculate_supplier_risk(
        net_toplam_try,
        safe_float(row.get("supplierRiskRate", config.get("supplier_risk_rate", 0)))
    )
    advanced_risk = calculate_advanced_risk_costs(net_toplam_try, constraints)
    advanced_risk_cost = safe_float(advanced_risk.get("advancedRiskCostTRY"), 0)

# TCO = gerçek toplam maliyet.
# Net toplamdan küçük olmaz; risk ve ek maliyetleri üzerine ekler.
    tco_try = (
        net_toplam_try
        + delay_penalty
        + missing_qty_cost
        + supplier_risk_cost
        + advanced_risk_cost
    )
    evaluated_cost = tco_try - finance_advantage

# Karar skoru: TCO ana maliyettir.
# Vade avantajı skorda ayrıca olumlu etki yapar.
    weighted_score = (
        tco_try * weights["price_weight"]
        - finance_advantage * weights["vade_weight"]
        + delay_penalty * weights["termin_weight"]
        + supplier_risk_cost * weights["risk_weight"]
        + missing_qty_cost
    )

    metrics = {
        "firma": row.get("firma") or row.get("firmaAdi", ""),
        "firmaAdi": row.get("firmaAdi") or row.get("firma", ""),
        "paraBirimi": currency,
        "kur": kur,
        "birimFiyat": round(birim_fiyat, 4),
        "iskonto": round(iskonto, 4),
        "firmaAdedi": firma_adedi,
        "netBirimFiyat": round(net_birim, 4),
        "netBirimFiyatTRY": round(net_birim_try, 4),
        "netToplamTRY": round(net_toplam_try, 4),
        "vadeDays": vade_days,
        "terminDays": termin_days,
        "financeAdvantageTRY": round(finance_advantage, 4),
        "delayPenaltyTRY": round(delay_penalty, 4),
        "missingQtyCostTRY": round(missing_qty_cost, 4),
        "supplierRiskCostTRY": round(supplier_risk_cost, 4),
        "tcoTRY": round(tco_try, 4),
        "evaluatedCostTRY": round(evaluated_cost, 4),
        "score": round(weighted_score, 4),
        "eksikAdet": round(eksik_adet, 2),
        "advancedRiskCostTRY": round(advanced_risk_cost, 4),
        "totalRiskRate": round(advanced_risk.get("totalRiskRate", 0), 4),
        "criticalRiskRate": round(advanced_risk.get("criticalRiskRate", 0), 4),
        "delayRiskRate": round(advanced_risk.get("delayRiskRate", 0), 4),
        "stockRiskRate": round(advanced_risk.get("stockRiskRate", 0), 4),
        "shippingRiskRate": round(advanced_risk.get("shippingRiskRate", 0), 4),
        "supplierTrustRiskRate": round(advanced_risk.get("supplierTrustRiskRate", 0), 4),
        "qualityRiskRate": round(advanced_risk.get("qualityRiskRate", 0), 4),
        "currencyRiskRate": round(advanced_risk.get("currencyRiskRate", 0), 4),
    }

    uygun = True

    max_budget = safe_float(constraints.get("max_budget"), 0)
    min_vade = safe_float(constraints.get("min_vade_days"), 0)
    max_termin = safe_float(constraints.get("max_termin_days"), 0)
    allow_missing = constraints.get("allow_missing_qty", False)

    if max_budget > 0 and net_toplam_try > max_budget:
        uygun = False

    if min_vade > 0 and vade_days < min_vade:
        uygun = False

    if max_termin > 0 and termin_days > max_termin:
        uygun = False

    if allow_missing is False and eksik_adet > 0:
        uygun = False

    constraint_result = apply_constraints(metrics, constraints) or {
        "eligible":True,
        "eliminationReasons":[]
    }

    karar_notlari = []
    if constraints:
        max_budget = safe_float(constraints.get("max_budget"), 0)
        min_vade = safe_float(constraints.get("min_vade_days"), 0)
        max_termin = safe_float(constraints.get("max_termin_days"), 0)
        allow_missing = constraints.get("allow_missing_qty", False)

        if min_vade is not None and vade_days < min_vade:
            karar_notlari.append(f"Kriter dışı: minimum vade {min_vade} gün, teklif {vade_days} gün")

        if max_termin is not None and termin_days > max_termin:
            karar_notlari.append(f"Kriter dışı: maksimum termin {max_termin} gün, teklif {termin_days} gün")

        if max_budget is not None and net_toplam_try > max_budget:
            karar_notlari.append(f"Kriter dışı: bütçe aşıldı ({net_toplam_try:.2f} TRY)")

        if not allow_missing and eksik_adet > 0:
            karar_notlari.append(f"Kriter dışı: eksik adet var ({eksik_adet})")
        if iskonto > 0:
            karar_notlari.append(f"%{iskonto:g} iskonto")

        if vade_days > 0:
            karar_notlari.append(f"{vade_days} gün vade")

        if termin_days > 0:
            karar_notlari.append(f"{termin_days} gün termin")

        if finance_advantage > 0:
            karar_notlari.append(f"Vade avantajı: {finance_advantage:.2f} TRY")

        if delay_penalty > 0:
            karar_notlari.append(f"Termin maliyeti: {delay_penalty:.2f} TRY")

        if missing_qty_cost > 0:
            karar_notlari.append(f"Eksik adet maliyeti: {missing_qty_cost:.2f} TRY")

        if supplier_risk_cost > 0:
            karar_notlari.append(f"Risk primi: {supplier_risk_cost:.2f} TRY")

        if birim_fiyat <= 0:
            karar_notlari.append("Fiyat eksik")

    for reason in constraint_result["eliminationReasons"]:
        karar_notlari.append(f"Elendi: {reason}")

    metrics.update({
        "eligible": constraint_result["eligible"],
        "uygunMu": net_birim_try > 0 and constraint_result["eligible"] and uygun,
        "eliminationReasons": constraint_result["eliminationReasons"],
        "kararNotlari": karar_notlari,
    })

    return metrics

def choose_best_offer(offers):
    if not offers:
        return None

    # SADECE kriterleri sağlayan teklifler
    eligible_offers = [
        o for o in offers
        if o.get("uygunMu") is True
    ]

    # Eğer hiçbir teklif kriteri sağlamıyorsa
    if not eligible_offers:
        return None

    # En düşük değerlendirilmiş maliyet
    eligible_offers.sort(
        key=lambda x: (
            safe_float(x.get("evaluatedCostTRY", 999999999)),
            safe_float(x.get("tcoTRY", 999999999)),
            -safe_float(x.get("vadeDays", 0)),
            safe_float(x.get("terminDays", 999999999)),
        )
    )

    return eligible_offers[0]

def generate_decision(best, offers):
    if not best:
        return "Geçerli teklif yok"

    if safe_float(best.get("eksikAdet", 0)) > 0:
        return "Eksik teklif"

    evaluated = safe_float(best.get("evaluatedCostTRY", 0))
    tco = safe_float(best.get("tcoTRY", 0))
    termin = safe_float(best.get("terminDays", 999))

    if evaluated < tco:
        return "Vade avantajlı"

    if termin <= 3:
        return "Hızlı teslim"

    return "En avantajlı teklif"

def analyze_groups(groups, exchange_rates, config=None, constraints=None, preferences=None):
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
            metrics = score_offer(
                row,
                exchange_rates,
                talep_edilen_adet,
                config=config,
                constraints=constraints,
                preferences=preferences,
            )
            merged = {**row, **metrics}
            offers.append(merged)

        offers = sorted(
            offers,
            key=lambda x: (
                0 if x.get("uygunMu") else 1,
                safe_float(x.get("evaluatedCostTRY", 999999999)),
                safe_float(x.get("score", 999999999)),
            )
        )

        best_offer = choose_best_offer(offers)

        analyzed.append({
            "urunKodu": master.get("urunKodu", ""),
            "urunAciklamasi": master.get("urunAciklamasi", ""),
            "birim": master.get("birim", ""),
            "talepEdilenAdet": talep_edilen_adet,
            "offers": offers,
            "bestOffer": best_offer,
            "onerilenFirma": best_offer.get("firma", "") if best_offer else "",
            "kararNedeni": generate_decision(best_offer, offers),
            "enAvantajliNetTutarTRY": best_offer.get("netToplamTRY", 0) if best_offer else 0,
            "enAvantajliTCOTRY": best_offer.get("tcoTRY", 0) if best_offer else 0,
        })

    return analyzed