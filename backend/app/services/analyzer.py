import re
import unicodedata

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
    "missing_data_policy": "manual_review",
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
    if net_toplam_try <= 0 or vade_days <= 0 or annual_interest_rate <= 0:
        return 0
    present_value = net_toplam_try / ((1 + annual_interest_rate / 100) ** (vade_days / 365))
    return net_toplam_try - present_value

def calculate_delay_penalty(termin_days, accepted_termin_days, daily_delay_cost):
    delayed_days = max(termin_days - max(accepted_termin_days, 0), 0)
    return delayed_days * daily_delay_cost

def calculate_missing_qty_cost(eksik_adet, net_birim_try, multiplier):
    if eksik_adet <= 0:
        return 0
    return eksik_adet * net_birim_try * multiplier

def calculate_supplier_risk(net_toplam_try, supplier_risk_rate):
    return net_toplam_try * (supplier_risk_rate / 100)

def normalize_supplier_key(value):
    text = str(value or "").strip().lower()
    text = text.translate(str.maketrans({"ı": "i", "ş": "s", "ğ": "g", "ü": "u", "ö": "o", "ç": "c"}))
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    parts = re.sub(r"[^a-z0-9]+", " ", text).split()
    suffixes = {"as", "anonim", "ltd", "limited", "sti", "sirketi", "tic", "ticaret", "san", "sanayi", "co", "corp", "inc", "llc"}
    return " ".join(part for part in parts if part not in suffixes)


def resolve_supplier_profile(row, constraints):
    supplier_name = row.get("firma") or row.get("firmaAdi") or ""
    supplier_key = normalize_supplier_key(supplier_name)
    candidates = []
    for profile in constraints.get("supplier_profiles", []) or []:
        profile_key = normalize_supplier_key(profile.get("canonical_name") or profile.get("name"))
        if not profile_key:
            continue
        if profile_key == supplier_key:
            candidates.append((1000 + len(profile_key), profile))
        elif len(profile_key) >= 3 and len(supplier_key) >= 3 and (profile_key in supplier_key or supplier_key in profile_key):
            candidates.append((len(profile_key), profile))

    profile = max(candidates, key=lambda item: item[0])[1] if candidates else None
    if not profile:
        return {
            "matched": False,
            "name": supplier_name,
            "trust_level": "unknown",
            "quality_history": "unknown",
            "trust_source": "missing",
            "quality_source": "missing",
        }

    trust_level = str(profile.get("trust_level") or "auto").lower()
    quality_history = str(profile.get("quality_history") or "auto").lower()
    status = str(profile.get("status") or "").lower()

    if trust_level == "auto":
        trust_level = "low" if any(term in status for term in ("risk", "bekli", "pasif")) else "medium"
        trust_source = "status"
    else:
        trust_source = "supplier_card"

    if quality_history == "auto":
        quality_history = "unknown"
        quality_source = "history_pending"
    else:
        quality_source = "supplier_card"

    return {
        "matched": True,
        "name": profile.get("name") or supplier_name,
        "trust_level": trust_level if trust_level in {"high", "medium", "low"} else "unknown",
        "quality_history": quality_history if quality_history in {"good", "medium", "bad"} else "unknown",
        "trust_source": trust_source,
        "quality_source": quality_source,
    }


def calculate_advanced_risk_costs(net_toplam_try, constraints, currency="TRY"):
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
        "unknown": 0.00,
    }

    trust_map = {
        "high": 0.00,
        "medium": 0.02,
        "low": 0.05,
        "unknown": 0.00,
    }

    quality_map = {
        "good": 0.00,
        "medium": 0.03,
        "bad": 0.08,
        "unknown": 0.00,
    }

    currency_map = {
        "none": 0.00,
        "low": 0.02,
        "medium": 0.05,
        "high": 0.08,
    }

    critical_rate = critical_map.get(constraints.get("critical_level", "low"), 0.00)
    delay_rate = delay_map.get(constraints.get("delay_impact", "none"), 0.00)
    stock_rate = stock_map.get(constraints.get("alternative_stock", "full"), 0.00)
    shipping_rate = shipping_map.get(constraints.get("shipping_included", "unknown"), 0.00)
    trust_rate = trust_map.get(constraints.get("supplier_trust", "unknown"), 0.00)
    quality_rate = quality_map.get(constraints.get("quality_history", "unknown"), 0.00)
    # Kur riski yalnız yabancı para tekliflerine uygulanır. TRY teklifine kur
    # primi eklemek, yerli para teklifini yapay biçimde pahalılaştırır.
    currency_rate = (
        currency_map.get(constraints.get("currency_risk", "medium"), 0.05)
        if normalize_currency(currency) != "TRY"
        else 0.00
    )

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
        return {
            "price_weight": 0.50,
            "vade_weight": 0.20,
            "termin_weight": 0.20,
            "risk_weight": 0.10,
        }

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

    if constraints.get("missing_data_policy", "manual_review") == "manual_review":
        if not metrics.get("vadeKnown"):
            reasons.append("Vade bilgisi eksik; manuel kontrol gerekli")
        if not metrics.get("terminKnown"):
            reasons.append("Termin bilgisi eksik; manuel kontrol gerekli")

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

    raw_vade = str(row.get("vade", "") or "").strip()
    raw_termin = str(row.get("termin", "") or "").strip()
    vade_days = extract_days(raw_vade)
    termin_days = extract_days(raw_termin)

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
        safe_float(constraints.get("max_termin_days"), 0),
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
    supplier_profile = resolve_supplier_profile(row, constraints)
    offer_risk_context = {
        **constraints,
        "supplier_trust": supplier_profile.get("trust_level", "unknown"),
        "quality_history": supplier_profile.get("quality_history", "unknown"),
        "shipping_included": row.get("shippingIncluded") or row.get("nakliyeDahil") or "unknown",
        "shipping_cost": safe_float(row.get("shippingCost") or row.get("nakliyeMaliyeti"), 0),
    }
    advanced_risk = calculate_advanced_risk_costs(net_toplam_try, offer_risk_context, currency)
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
        "netToplam": round(net_toplam_try / kur if kur else net_toplam_try, 4),
        "netBirimFiyatTRY": round(net_birim_try, 4),
        "netToplamTRY": round(net_toplam_try, 4),
        "vadeDays": vade_days,
        "terminDays": termin_days,
        "vadeKnown": bool(raw_vade),
        "terminKnown": bool(raw_termin),
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
        "supplierProfileMatched": bool(supplier_profile.get("matched")),
        "supplierProfileName": supplier_profile.get("name", ""),
        "supplierTrustLevel": supplier_profile.get("trust_level", "unknown"),
        "supplierQualityHistory": supplier_profile.get("quality_history", "unknown"),
        "supplierTrustSource": supplier_profile.get("trust_source", "missing"),
        "supplierQualitySource": supplier_profile.get("quality_source", "missing"),
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

        if supplier_profile.get("matched"):
            karar_notlari.append(
                "Tedarikçi kartı: "
                f"güven {supplier_profile.get('trust_level', 'unknown')}, "
                f"kalite {supplier_profile.get('quality_history', 'unknown')}"
            )
        else:
            karar_notlari.append("Tedarikçi kartı eşleşmedi; firma güveni ve kalite için risk primi eklenmedi")

        if birim_fiyat <= 0:
            karar_notlari.append("Fiyat eksik")

    for reason in constraint_result["eliminationReasons"]:
        karar_notlari.append(f"Elendi: {reason}")

    metrics.update({
        "eligible": constraint_result["eligible"],
        "uygunMu": net_birim_try > 0 and constraint_result["eligible"] and uygun,
        "allocationEligible": net_birim_try > 0 and all(
            "eksik adet" in str(reason).lower()
            for reason in constraint_result["eliminationReasons"]
        ),
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
            0 if x.get("terminKnown") else 1,
            safe_float(x.get("terminDays", 999999999)),
        )
    )

    return eligible_offers[0]


def automatic_decision_warnings(offers, price_spread_limit=3.0, tie_tolerance=0.005):
    """Return conditions where the engine must not make a blind recommendation."""
    warnings = []
    eligible = [offer for offer in offers if offer.get("uygunMu") is True]
    priced = [
        safe_float(offer.get("netBirimFiyatTRY", 0))
        for offer in offers
        if safe_float(offer.get("netBirimFiyatTRY", 0)) > 0
    ]

    if len(priced) >= 2:
        cheapest = min(priced)
        highest = max(priced)
        ratio = highest / cheapest if cheapest > 0 else 0
        if ratio >= price_spread_limit:
            warnings.append(
                f"Birim fiyatlar arasında {ratio:.1f} kat fark var; ürün kapsamı ve fiyat para birimi doğrulanmalı"
            )

    ranked = sorted(
        eligible,
        key=lambda offer: safe_float(offer.get("evaluatedCostTRY", 999999999)),
    )
    if len(ranked) >= 2:
        first_cost = safe_float(ranked[0].get("evaluatedCostTRY", 0))
        second_cost = safe_float(ranked[1].get("evaluatedCostTRY", 0))
        baseline = max(min(first_cost, second_cost), 0.000001)
        if abs(second_cost - first_cost) / baseline <= tie_tolerance:
            warnings.append(
                "En iyi iki teklifin değerlendirilmiş maliyet farkı %0,5 veya altında; kullanıcı kararı gerekli"
            )

    return warnings


def build_recommended_allocation(offers, requested_quantity):
    """Build the lowest-cost complete allocation without hiding partial quotations."""
    remaining = max(safe_float(requested_quantity), 0)
    candidates = []

    for offer in offers:
        if offer.get("allocationEligible") is False:
            continue
        offered_quantity = safe_float(offer.get("firmaAdedi", 0))
        unit_cost = safe_float(offer.get("netBirimFiyatTRY", 0))
        if offered_quantity <= 0 or unit_cost <= 0:
            continue

        economic_total = (
            safe_float(offer.get("netToplamTRY", 0))
            + safe_float(offer.get("delayPenaltyTRY", 0))
            + safe_float(offer.get("supplierRiskCostTRY", 0))
            + safe_float(offer.get("advancedRiskCostTRY", 0))
            - safe_float(offer.get("financeAdvantageTRY", 0))
        )
        economic_unit = economic_total / offered_quantity if economic_total > 0 else unit_cost
        candidates.append((economic_unit, unit_cost, offer))

    candidates.sort(key=lambda item: (
        item[0],
        item[1],
        0 if item[2].get("terminKnown") else 1,
        -safe_float(item[2].get("vadeDays", 0)),
    ))
    allocations = []

    for economic_unit, unit_cost, offer in candidates:
        if remaining <= 0:
            break
        quantity = min(remaining, safe_float(offer.get("firmaAdedi", 0)))
        if quantity <= 0:
            continue
        allocations.append({
            "firma": offer.get("firma") or offer.get("firmaAdi") or "",
            "firmaAdi": offer.get("firmaAdi") or offer.get("firma") or "",
            "quantity": round(quantity, 4),
            "unitPriceTRY": round(unit_cost, 4),
            "economicUnitCostTRY": round(economic_unit, 4),
            "totalTRY": round(quantity * unit_cost, 4),
            "paraBirimi": offer.get("paraBirimi") or "TRY",
            "kur": safe_float(offer.get("kur", 1)),
            "vade": offer.get("vade", ""),
            "termin": offer.get("termin", ""),
        })
        remaining -= quantity

    return allocations, round(max(remaining, 0), 4)

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

        provisional_best_offer = choose_best_offer(offers)
        decision_warnings = automatic_decision_warnings(offers)
        manual_review_required = bool(decision_warnings)
        best_offer = None if manual_review_required else provisional_best_offer
        if manual_review_required:
            recommended_allocation, uncovered_quantity = [], talep_edilen_adet
        else:
            recommended_allocation, uncovered_quantity = build_recommended_allocation(offers, talep_edilen_adet)
        recommended_total = sum(safe_float(item.get("totalTRY", 0)) for item in recommended_allocation)
        full_offers = [
            offer for offer in offers
            if safe_float(offer.get("firmaAdedi", 0)) >= talep_edilen_adet
            and safe_float(offer.get("netBirimFiyatTRY", 0)) > 0
            and offer.get("allocationEligible") is not False
        ]
        cheapest_full_offer = min(
            full_offers,
            key=lambda offer: safe_float(offer.get("netToplamTRY", 999999999)),
            default=None,
        )

        analyzed.append({
            "urunKodu": master.get("urunKodu", ""),
            "marka": master.get("marka", "") or master.get("brand", ""),
            "brand": master.get("brand", "") or master.get("marka", ""),
            "urunAciklamasi": master.get("urunAciklamasi", ""),
            "birim": master.get("birim", ""),
            "talepEdilenAdet": talep_edilen_adet,
            "offers": offers,
            "bestOffer": best_offer,
            "provisionalBestOffer": provisional_best_offer,
            "decisionStatus": "manual_review" if manual_review_required else ("automatic" if best_offer else "no_eligible_offer"),
            "decisionWarnings": decision_warnings,
            "recommendedAllocation": recommended_allocation,
            "recommendedTotalTRY": round(recommended_total, 4),
            "uncoveredQuantity": uncovered_quantity,
            "cheapestFullOffer": cheapest_full_offer,
            "savingsVsFullTRY": round(
                max(safe_float((cheapest_full_offer or {}).get("netToplamTRY", 0)) - recommended_total, 0),
                4,
            ) if cheapest_full_offer and uncovered_quantity <= 0 else 0,
            "onerilenFirma": best_offer.get("firma", "") if best_offer else "",
            "kararNedeni": (
                "Manuel kontrol gerekli: " + " | ".join(decision_warnings)
                if manual_review_required
                else generate_decision(best_offer, offers)
            ),
            "enAvantajliNetTutarTRY": best_offer.get("netToplamTRY", 0) if best_offer else 0,
            "enAvantajliTCOTRY": best_offer.get("tcoTRY", 0) if best_offer else 0,
            "productId": master.get("productId"),
            "normalizedProductCode": master.get("normalizedProductCode", ""),
            "currentStock": master.get("currentStock", 0),
            "reservedStock": master.get("reservedStock", 0),
            "stockCoverableQuantity": master.get("stockCoverableQuantity", 0),
            "purchaseQuantity": master.get("purchaseQuantity", talep_edilen_adet),
            "allocations": master.get("allocations", []),
        })

    return analyzed
