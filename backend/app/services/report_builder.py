from collections import Counter
from datetime import datetime
import xlsxwriter
import re


def _safe_num(v, default=0.0):
    try:
        if v is None or v == "":
            return default
        return float(v)
    except Exception:
        return default


def _clean(v):
    if v is None:
        return ""
    return str(v).strip()


def _firma_name(row):
    return _clean(row.get("firma") or row.get("firmaAdi") or "")


def _normalize_key(value):
    text = _clean(value).upper()
    text = text.replace("İ", "I").replace("Ş", "S").replace("Ğ", "G").replace("Ü", "U").replace("Ö", "O").replace("Ç", "C")
    return re.sub(r"[^A-Z0-9]+", "", text)


def _brand_name(row):
    return _clean(row.get("marka") or row.get("brand") or row.get("urunMarka") or "")


def _group_brand(group):
    brands = [_brand_name(offer) for offer in group.get("offers", []) if _brand_name(offer)]
    if brands:
        return Counter(brands).most_common(1)[0][0]
    return _clean(group.get("marka") or group.get("brand") or "")


def _sheet_name(value, used):
    base = re.sub(r"[\[\]\:\*\?\/\\]", " ", _clean(value) or "Mukayese").strip()[:25] or "Mukayese"
    name = base
    index = 2
    while name in used:
        suffix = f" {index}"
        name = f"{base[:31 - len(suffix)]}{suffix}"
        index += 1
    used.add(name)
    return name


def _brand_code_groups(analyzed_groups):
    grouped = {}
    for group in analyzed_groups:
        code = _clean(group.get("urunKodu") or group.get("master", {}).get("urunKodu"))
        group_brand = _group_brand(group)
        group_desc = _clean(group.get("urunAciklamasi") or group.get("master", {}).get("urunAciklamasi"))
        group_qty = _safe_num(group.get("purchaseQuantity", group.get("talepEdilenAdet", 0)))
        offers = group.get("offers", [])
        for offer in offers:
            brand = _brand_name(offer) or group_brand
            offer_code = _clean(offer.get("urunKodu") or code)
            if not brand or not offer_code:
                continue
            key = (_normalize_key(brand), _normalize_key(offer_code))
            bucket = grouped.setdefault(key, {
                "brand": brand,
                "code": offer_code,
                "description": _clean(offer.get("urunAciklamasi")) or group_desc,
                "quantity": group_qty or _safe_num(offer.get("firmaAdedi", 0)),
                "offers": [],
                "firms": set(),
            })
            bucket["offers"].append(offer)
            firma = _firma_name(offer)
            if firma:
                bucket["firms"].add(firma)

    brand_buckets = {}
    for item in grouped.values():
        if len(item["firms"]) < 2:
            continue
        brand_key = _normalize_key(item["brand"])
        brand_bucket = brand_buckets.setdefault(brand_key, {
            "brand": item["brand"],
            "items": [],
            "firms": set(),
        })
        brand_bucket["items"].append(item)
        brand_bucket["firms"].update(item["firms"])

    return [
        item for item in brand_buckets.values()
        if len(item["firms"]) >= 2 and item["items"]
    ]


def _pick_reason(best_offer, all_offers):
    if not best_offer:
        return "-"

    best_total = _safe_num(best_offer.get("netToplamTRY", 0))

    valid_totals = sorted([
        _safe_num(x.get("netToplamTRY", 0))
        for x in all_offers
        if _safe_num(x.get("netToplamTRY", 0)) > 0
    ])

    if valid_totals and best_total == valid_totals[0]:
        return "En düşük net toplam fiyat"

    if _safe_num(best_offer.get("eksikAdet", 0)) > 0:
        return "Eksik adet nedeniyle dezavantajlı"

    vade = _safe_num(best_offer.get("vadeDays", 0))
    termin = _safe_num(best_offer.get("terminDays", 0))

    if vade >= 60:
        return "Uzun vade avantajı"

    if termin <= 7:
        return "Hızlı teslim avantajı"

    return "Genel maliyet avantajı"


def _extract_auto_codes(analyzed_groups):
    rows = []

    for g in analyzed_groups:
        kod = _clean(g.get("urunKodu", ""))
        if kod.upper().startswith("PRD-"):
            rows.append({
                "kod": kod,
                "aciklama": _clean(g.get("urunAciklamasi", "")),
                "neden": "Kod bulunamadı"
            })

    return rows


def _extract_match_warnings(analyzed_groups):
    warnings = []

    for g in analyzed_groups:
        kod = _clean(g.get("urunKodu", ""))
        aciklama = _clean(g.get("urunAciklamasi", ""))
        offers = g.get("offers", [])

        unique_desc = sorted({
            _clean(o.get("urunAciklamasi", ""))
            for o in offers
            if _clean(o.get("urunAciklamasi", ""))
        })

        if len(unique_desc) >= 2:
            warnings.append(
                f'{kod or "-"} / {aciklama or "-"} → '
                + " ~ ".join(unique_desc[:4])
            )

    return warnings[:8]


def _build_summary(analyzed_groups):
    firmalar = set()
    best_counter = Counter()

    for g in analyzed_groups:
        for o in g.get("offers", []):
            firma = _firma_name(o)
            if firma:
                firmalar.add(firma)

        best = g.get("bestOffer")
        if best:
            best_counter[_firma_name(best)] += 1

    auto_codes = _extract_auto_codes(analyzed_groups)

    return {
        "toplam_urun": len(analyzed_groups),
        "firma_sayisi": len(firmalar),
        "otomatik_kod_sayisi": len(auto_codes),
        "best_counter": best_counter,
        "firmalar": sorted(list(firmalar)),
        "auto_codes": auto_codes,
        "match_warnings": _extract_match_warnings(analyzed_groups),
    }


def _firm_performance(analyzed_groups, firms, best_counter):
    total_groups = max(len(analyzed_groups), 1)
    performance = []

    for firma in firms:
        totals = []
        evaluated_totals = []
        termins = []
        vades = []
        discounts = []
        quoted_items = 0

        for group in analyzed_groups:
            offer = None
            for row in group.get("offers", []):
                if _firma_name(row) == firma:
                    offer = row
                    break

            if not offer:
                continue

            quoted_items += 1
            total = _safe_num(offer.get("netToplamTRY", 0))
            evaluated = _safe_num(offer.get("evaluatedCostTRY", 0)) or total
            if total > 0:
                totals.append(total)
            if evaluated > 0:
                evaluated_totals.append(evaluated)
            termins.append(_safe_num(offer.get("terminDays", 0)))
            vades.append(_safe_num(offer.get("vadeDays", 0)))
            discounts.append(_safe_num(offer.get("iskonto", 0)))

        performance.append({
            "firma": firma,
            "quoted_items": quoted_items,
            "missing_items": max(total_groups - quoted_items, 0),
            "coverage": quoted_items / total_groups if total_groups else 0,
            "total": sum(totals),
            "evaluated_total": sum(evaluated_totals),
            "avg_termin": sum(termins) / len(termins) if termins else 0,
            "avg_vade": sum(vades) / len(vades) if vades else 0,
            "avg_discount": sum(discounts) / len(discounts) if discounts else 0,
            "wins": best_counter.get(firma, 0),
        })

    return performance


def _best_firm(performance):
    candidates = [row for row in performance if row["quoted_items"] > 0]
    if not candidates:
        return None
    return sorted(
        candidates,
        key=lambda row: (
            -row["wins"],
            -row["coverage"],
            row["evaluated_total"] if row["evaluated_total"] > 0 else 10**18,
        )
    )[0]


def _write_brand_comparison_sheet(wb, bucket, used_sheet_names):
    sheet_name = _sheet_name(f"{bucket['brand']} Mukayese", used_sheet_names)
    ws = wb.add_worksheet(sheet_name)
    ws.hide_gridlines(2)
    ws.freeze_panes(5, 5)
    ws.set_landscape()
    ws.fit_to_pages(1, 0)

    firms = sorted(bucket["firms"])
    navy = "#08295C"
    line = "#C8D3E1"

    title_fmt = wb.add_format({"bold": True, "font_size": 18, "font_color": navy, "align": "left", "valign": "vcenter"})
    sub_fmt = wb.add_format({"font_size": 9, "font_color": "#52657A", "align": "left"})
    head_fmt = wb.add_format({"bold": True, "font_size": 9, "font_color": "#FFFFFF", "bg_color": navy, "border": 1, "border_color": navy, "align": "center", "valign": "vcenter", "text_wrap": True})
    sub_head_fmt = wb.add_format({"bold": True, "font_size": 8, "font_color": navy, "bg_color": "#F4F7FB", "border": 1, "border_color": line, "align": "center", "valign": "vcenter", "text_wrap": True})
    text_fmt = wb.add_format({"font_size": 9, "border": 1, "border_color": line, "valign": "vcenter", "text_wrap": True})
    num_fmt = wb.add_format({"font_size": 9, "border": 1, "border_color": line, "align": "right", "valign": "vcenter", "num_format": "#,##0.00"})
    best_fmt = wb.add_format({"font_size": 9, "border": 1, "border_color": line, "bg_color": "#E8F7EE", "font_color": "#08743B", "align": "right", "valign": "vcenter", "num_format": "#,##0.00"})
    missing_fmt = wb.add_format({"font_size": 9, "border": 1, "border_color": line, "bg_color": "#FDECEC", "font_color": "#B91C1C", "align": "center", "valign": "vcenter"})
    decision_fmt = wb.add_format({"font_size": 9, "border": 1, "border_color": line, "bg_color": "#FFF7E6", "valign": "vcenter", "text_wrap": True})

    ws.merge_range(0, 0, 0, 8, f"{bucket['brand']} - Marka/Kod Bazlı Mukayese", title_fmt)
    ws.merge_range(1, 0, 1, 8, "Bu sayfada yalnızca aynı marka ve aynı ürün koduyla en az iki tedarikçiden gelen teklifler karşılaştırılır.", sub_fmt)

    base_headers = ["S.No", "Marka", "Ürün Kodu", "Açıklama", "Talep"]
    for col, header in enumerate(base_headers):
        ws.merge_range(3, col, 4, col, header, head_fmt)

    col = len(base_headers)
    firm_columns = ["Birim", "Toplam TRY", "Vade", "Teslim"]
    for firma in firms:
        ws.merge_range(3, col, 3, col + len(firm_columns) - 1, firma.upper(), head_fmt)
        for offset, header in enumerate(firm_columns):
            ws.write(4, col + offset, header, sub_head_fmt)
        col += len(firm_columns)

    ws.merge_range(3, col, 4, col, "Kazanan", head_fmt)
    ws.merge_range(3, col + 1, 4, col + 1, "Not", head_fmt)

    row = 5
    for idx, item in enumerate(bucket["items"], start=1):
        offers = item.get("offers", [])
        offer_map = {}
        for offer in offers:
            firma = _firma_name(offer)
            if firma:
                offer_map[firma] = offer

        best = None
        valid_offers = [offer for offer in offers if _safe_num(offer.get("evaluatedCostTRY", 0)) > 0]
        if valid_offers:
            best = sorted(valid_offers, key=lambda offer: _safe_num(offer.get("evaluatedCostTRY", 10**18)))[0]
        best_firma = _firma_name(best or {})

        ws.write_number(row, 0, idx, text_fmt)
        ws.write(row, 1, bucket["brand"], text_fmt)
        ws.write(row, 2, _clean(item.get("code") or "-"), text_fmt)
        ws.write(row, 3, _clean(item.get("description") or "-"), text_fmt)
        ws.write_number(row, 4, _safe_num(item.get("quantity", 0)), num_fmt)

        col = len(base_headers)
        for firma in firms:
            offer = offer_map.get(firma)
            if not offer:
                for offset in range(len(firm_columns)):
                    ws.write(row, col + offset, "-", missing_fmt)
                col += len(firm_columns)
                continue

            is_best = _firma_name(offer) == best_firma
            price_fmt = best_fmt if is_best else num_fmt
            ws.write_number(row, col, _safe_num(offer.get("netBirimFiyatTRY", offer.get("netBirimFiyat", 0))), price_fmt)
            ws.write_number(row, col + 1, _safe_num(offer.get("evaluatedCostTRY", offer.get("netToplamTRY", 0))), price_fmt)
            ws.write_number(row, col + 2, _safe_num(offer.get("vadeDays", 0)), num_fmt)
            ws.write_number(row, col + 3, _safe_num(offer.get("terminDays", 0)), num_fmt)
            col += len(firm_columns)

        ws.write(row, col, best_firma or "-", decision_fmt)
        ws.write(row, col + 1, "Aynı marka ve ürün kodu içinde en düşük değerlendirilmiş maliyet.", decision_fmt)
        row += 1

    widths = [8, 18, 22, 34, 12] + ([13, 14, 10, 10] * len(firms)) + [18, 34]
    for index, width in enumerate(widths):
        ws.set_column(index, index, width)

    return sheet_name


def _build_excel_report_legacy(analyzed_groups, output_path, company_info=None):
    company_info = company_info or {}
    company_name = str(company_info.get("company_name") or "Firma adı belirtilmedi").strip()
    product_name = str(company_info.get("product_name") or "Corvian ERP").strip()
    summary = _build_summary(analyzed_groups)
    firms = summary["firmalar"]

    wb = xlsxwriter.Workbook(output_path)
    used_sheet_names = set()
    summary_sheet_name = _sheet_name("Ozet", used_sheet_names)
    summary_ws = wb.add_worksheet(summary_sheet_name)
    ws = wb.add_worksheet(_sheet_name("Kalem Bazlı Mukayese", used_sheet_names))
    ws.freeze_panes(9, 5)

    title_fmt = wb.add_format({
        "bold": True,
        "font_size": 16,
        "align": "left",
        "valign": "vcenter",
        "font_color": "#163A70"
    })

    card_title_fmt = wb.add_format({
        "bold": True,
        "font_size": 10,
        "align": "center",
        "valign": "vcenter",
        "border": 1,
        "bg_color": "#F3F6FB",
        "font_color": "#4A4A4A"
    })

    card_value_fmt = wb.add_format({
        "bold": True,
        "font_size": 16,
        "align": "center",
        "valign": "vcenter",
        "border": 1,
        "bg_color": "#FFFFFF",
        "font_color": "#163A70"
    })

    card_sub_fmt = wb.add_format({
        "font_size": 9,
        "align": "center",
        "valign": "vcenter",
        "border": 1,
        "bg_color": "#FFFFFF",
        "font_color": "#666666"
    })

    section_fmt = wb.add_format({
        "bold": True,
        "font_size": 12,
        "align": "left",
        "valign": "vcenter",
        "font_color": "#163A70"
    })

    head_fmt = wb.add_format({
        "bold": True,
        "align": "center",
        "valign": "vcenter",
        "border": 1,
        "bg_color": "#D9E8FB",
        "text_wrap": True
    })

    base_cell = wb.add_format({
        "border": 1,
        "align": "center",
        "valign": "vcenter"
    })

    text_cell = wb.add_format({
        "border": 1,
        "align": "left",
        "valign": "vcenter",
        "text_wrap": True
    })

    money_cell = wb.add_format({
        "border": 1,
        "align": "center",
        "valign": "vcenter",
        "num_format": '#,##0.00'
    })
    
    red_money = wb.add_format({
        "border": 1,
        "align": "center",
        "valign": "vcenter",
        "font_color": "#B91C1C",
        "num_format": '#,##0.00 ₺'
    })

    percent_cell = wb.add_format({
        "border": 1,
        "align": "center",
        "valign": "vcenter",
        "num_format": '0.00'
    })

    green_cell = wb.add_format({
        "border": 1,
        "align": "center",
        "valign": "vcenter",
        "bg_color": "#CFE8C8"
    })

    green_money = wb.add_format({
        "border": 1,
        "align": "center",
        "valign": "vcenter",
        "bg_color": "#CFE8C8",
        "num_format": '#,##0.00'
    })

    red_cell = wb.add_format({
        "border": 1,
        "align": "center",
        "valign": "vcenter",
        "bg_color": "#F5B7B1"
    })

    yellow_cell = wb.add_format({
        "border": 1,
        "align": "center",
        "valign": "vcenter",
        "bg_color": "#F9E79F"
    })

    blue_cell = wb.add_format({
        "border": 1,
        "align": "center",
        "valign": "vcenter",
        "bg_color": "#D6EAF8"
    })

    note_box_title = wb.add_format({
        "bold": True,
        "border": 1,
        "bg_color": "#F3F6FB",
        "font_color": "#163A70"
    })

    note_box_cell = wb.add_format({
        "border": 1,
        "text_wrap": True,
        "valign": "top"
    })

    small_gray = wb.add_format({
        "font_size": 8,
        "font_color": "#666666"
    })

    center_bold = wb.add_format({
        "bold": True,
        "align": "center",
        "valign": "vcenter",
        "border": 1
    })

    karar_header_fmt = wb.add_format({
        "bold": True,
        "align": "center",
        "valign": "vcenter",
        "border": 1,
        "bg_color": "#F4C542"
    })

    firm_palette = [
        "#4A90E2",
        "#7DCEA0",
        "#F5B041",
        "#A569BD",
        "#F4D03F",
        "#48C9B0",
        "#EC7063",
        "#5DADE2"
    ]

    firm_header_formats = {}

    for idx, firma in enumerate(firms):
        firm_header_formats[firma] = wb.add_format({
            "bold": True,
            "align": "center",
            "valign": "vcenter",
            "border": 1,
            "bg_color": firm_palette[idx % len(firm_palette)],
            "font_color": "#FFFFFF"
        })

    performance = _firm_performance(analyzed_groups, firms, summary["best_counter"])
    best_firm = _best_firm(performance)
    firm_totals = [row["evaluated_total"] for row in performance if row["evaluated_total"] > 0]
    total_quantity = sum(_safe_num(g.get("purchaseQuantity", g.get("talepEdilenAdet", 0))) for g in analyzed_groups)
    best_offers = [g.get("bestOffer") for g in analyzed_groups if g.get("bestOffer")]
    average_delivery = (
        sum(_safe_num(offer.get("terminDays", 0)) for offer in best_offers) / len(best_offers)
        if best_offers else 0
    )
    covered_groups = sum(1 for g in analyzed_groups if len(g.get("offers", [])) > 0)
    coverage_rate = covered_groups / len(analyzed_groups) if analyzed_groups else 0
    report_date = datetime.now().strftime("%d.%m.%Y %H:%M")

    summary_ws.hide_gridlines(2)
    summary_ws.set_landscape()
    summary_ws.set_paper(9)
    summary_ws.fit_to_pages(1, 1)
    summary_ws.set_margins(left=0.25, right=0.25, top=0.35, bottom=0.35)
    summary_ws.set_column("A:A", 2)
    summary_ws.set_column("B:B", 18)
    summary_ws.set_column("C:C", 15)
    summary_ws.set_column("D:D", 15)
    summary_ws.set_column("E:E", 14)
    summary_ws.set_column("F:F", 14)
    summary_ws.set_column("G:G", 14)
    summary_ws.set_column("H:H", 14)
    summary_ws.set_column("I:I", 16)
    summary_ws.set_column("J:J", 16)
    summary_ws.set_column("K:K", 16)
    summary_ws.set_column("L:L", 16)
    summary_ws.set_column("M:M", 16)

    navy = "#08295C"
    navy_dark = "#061D42"
    gold = "#D8A029"
    line = "#C8D3E1"

    dashboard_title_fmt = wb.add_format({"bold": True, "font_size": 26, "align": "center", "valign": "vcenter", "font_color": navy})
    company_fmt = wb.add_format({"bold": True, "font_size": 18, "align": "left", "valign": "vcenter", "font_color": navy})
    meta_label_fmt = wb.add_format({"bold": True, "font_size": 9, "font_color": navy, "align": "left"})
    meta_value_fmt = wb.add_format({"bold": True, "font_size": 10, "font_color": navy_dark, "align": "left"})
    summary_box_title = wb.add_format({"bold": True, "font_size": 11, "font_color": "#FFFFFF", "bg_color": navy, "border": 1, "border_color": navy, "align": "left", "valign": "vcenter"})
    summary_box_text = wb.add_format({"font_size": 9, "font_color": navy_dark, "border": 1, "border_color": line, "text_wrap": True, "valign": "top"})
    kpi_label_fmt = wb.add_format({"bold": True, "font_size": 9, "font_color": navy, "align": "center", "valign": "vcenter", "top": 1, "bottom": 1, "left": 1, "right": 1, "border_color": line})
    kpi_value_fmt = wb.add_format({"bold": True, "font_size": 13, "font_color": navy_dark, "align": "center", "valign": "vcenter", "top": 1, "bottom": 1, "left": 1, "right": 1, "border_color": line, "num_format": '#,##0.00'})
    kpi_green_fmt = wb.add_format({"bold": True, "font_size": 13, "font_color": "#16803B", "align": "center", "valign": "vcenter", "top": 1, "bottom": 1, "left": 1, "right": 1, "border_color": line, "num_format": '#,##0.00'})
    kpi_red_fmt = wb.add_format({"bold": True, "font_size": 13, "font_color": "#D10F0F", "align": "center", "valign": "vcenter", "top": 1, "bottom": 1, "left": 1, "right": 1, "border_color": line, "num_format": '#,##0.00'})
    section_dark = wb.add_format({"bold": True, "font_size": 11, "font_color": "#FFFFFF", "bg_color": navy, "border": 1, "border_color": navy, "align": "left", "valign": "vcenter"})
    table_head = wb.add_format({"bold": True, "font_size": 9, "font_color": navy, "bg_color": "#F4F7FB", "border": 1, "border_color": line, "align": "center", "valign": "vcenter"})
    table_text = wb.add_format({"font_size": 9, "font_color": navy_dark, "border": 1, "border_color": line, "valign": "vcenter"})
    table_num = wb.add_format({"font_size": 9, "font_color": navy_dark, "border": 1, "border_color": line, "align": "right", "valign": "vcenter", "num_format": '#,##0.00'})
    table_pct = wb.add_format({"font_size": 9, "font_color": navy_dark, "border": 1, "border_color": line, "align": "right", "valign": "vcenter", "num_format": '0%'})
    recommendation_fmt = wb.add_format({"font_size": 10, "font_color": navy_dark, "bg_color": "#FFF7E6", "border": 1, "border_color": "#F2C879", "text_wrap": True, "valign": "vcenter"})
    note_line_fmt = wb.add_format({"font_size": 9, "font_color": navy_dark, "bottom": 1, "bottom_color": "#DDE5EF"})
    footer_fmt = wb.add_format({"bold": True, "font_size": 10, "font_color": "#FFFFFF", "bg_color": navy, "align": "center", "valign": "vcenter"})

    summary_ws.set_row(0, 28)
    summary_ws.set_row(1, 28)
    summary_ws.merge_range("B1:D2", company_name.upper(), company_fmt)
    summary_ws.merge_range("E1:J2", "MUKAYESE RAPORU", dashboard_title_fmt)
    summary_ws.merge_range("K1:M1", "RAPOR \u00d6ZET\u0130", summary_box_title)
    summary_ws.merge_range("K2:M4", "Bu rapor, al\u0131nan teklifler do\u011frultusunda en avantajl\u0131 se\u00e7ene\u011fi belirlemek i\u00e7in haz\u0131rlanm\u0131\u015ft\u0131r.", summary_box_text)
    summary_ws.merge_range("E3:J3", "", wb.add_format({"bottom": 2, "bottom_color": gold}))

    meta_items = [
        ("B5", "Rapor Tarihi", "C5", report_date),
        ("D5", "Para Birimi", "E5", "TRY"),
        ("F5", "Teklif Say\u0131s\u0131", "G5", len(firms)),
        ("H5", "Analiz Kalemi", "I5", summary["toplam_urun"]),
    ]
    for label_cell, label, value_cell, value in meta_items:
        summary_ws.write(label_cell, label, meta_label_fmt)
        summary_ws.write(value_cell, value, meta_value_fmt)

    cards = [
        ("TOPLAM KALEM", summary["toplam_urun"], kpi_value_fmt),
        ("TOPLAM M\u0130KTAR", total_quantity, kpi_value_fmt),
        ("ORTALAMA TESL\u0130M", f"{round(average_delivery, 1):g} G\u00fcn", kpi_value_fmt),
        ("EN D\u00dc\u015e\u00dcK TOPLAM", min(firm_totals) if firm_totals else 0, kpi_green_fmt),
        ("ORTALAMA TOPLAM", sum(firm_totals) / len(firm_totals) if firm_totals else 0, kpi_value_fmt),
        ("EN Y\u00dcKSEK TOPLAM", max(firm_totals) if firm_totals else 0, kpi_red_fmt),
    ]
    card_col = 1
    for title, value, fmt in cards:
        summary_ws.merge_range(6, card_col, 7, card_col + 1, title, kpi_label_fmt)
        if isinstance(value, str):
            summary_ws.merge_range(8, card_col, 8, card_col + 1, value, fmt)
        else:
            summary_ws.merge_range(8, card_col, 8, card_col + 1, value, fmt)
        card_col += 2

    summary_ws.merge_range("B11:G11", "TEKL\u0130F VEREN F\u0130RMALARIN PERFORMANSI", section_dark)
    perf_headers = ["Firma", "Toplam Tutar (TRY)", "Kapsama", "Ort. Vade", "Ort. Teslim", "Kazanan Kalem"]
    for col, header in enumerate(perf_headers, start=1):
        summary_ws.write(11, col, header, table_head)
    perf_start = 12
    for r, item in enumerate(performance, start=perf_start):
        summary_ws.write(r, 1, item["firma"], table_text)
        summary_ws.write_number(r, 2, item["evaluated_total"], table_num)
        summary_ws.write_number(r, 3, item["coverage"], table_pct)
        summary_ws.write_number(r, 4, item["avg_vade"], table_num)
        summary_ws.write_number(r, 5, item["avg_termin"], table_num)
        summary_ws.write_number(r, 6, item["wins"], table_num)

    data_start = 28
    data_col = 15
    summary_ws.set_column(data_col, data_col + 4, 1, None, {"hidden": True})
    summary_ws.write(data_start, data_col, "Firma")
    summary_ws.write(data_start, data_col + 1, "Toplam")
    summary_ws.write(data_start, data_col + 3, "Durum")
    summary_ws.write(data_start, data_col + 4, "Adet")
    for idx, item in enumerate(performance, start=data_start + 1):
        summary_ws.write(idx, data_col, item["firma"])
        summary_ws.write_number(idx, data_col + 1, item["evaluated_total"])
    summary_ws.write(data_start + 1, data_col + 3, "Kapsanan Kalem")
    summary_ws.write_number(data_start + 1, data_col + 4, covered_groups)
    summary_ws.write(data_start + 2, data_col + 3, "Kapsanmayan Kalem")
    summary_ws.write_number(data_start + 2, data_col + 4, max(summary["toplam_urun"] - covered_groups, 0))

    if performance:
        chart = wb.add_chart({"type": "bar"})
        chart.add_series({
            "name": "Toplam Tutar",
            "categories": [summary_sheet_name, data_start + 1, data_col, data_start + len(performance), data_col],
            "values": [summary_sheet_name, data_start + 1, data_col + 1, data_start + len(performance), data_col + 1],
            "data_labels": {"value": True, "num_format": '#,##0.00'},
            "fill": {"color": navy},
        })
        chart.set_title({"name": "TEKL\u0130F DA\u011eILIMI (TOPLAM TUTAR)"})
        chart.set_x_axis({"visible": False})
        chart.set_y_axis({"major_gridlines": {"visible": False}})
        chart.set_legend({"none": True})
        chart.set_plotarea({"border": {"none": True}, "fill": {"color": "#FFFFFF"}})
        summary_ws.insert_chart("H11", chart, {"x_scale": 1.18, "y_scale": 1.35})

    summary_ws.merge_range("B21:G21", "\u00d6NER\u0130", section_dark)
    if best_firm:
        recommendation = (
            f"{best_firm['firma']} firmas\u0131; {best_firm['wins']} kalemde avantajl\u0131, "
            f"%{round(best_firm['coverage'] * 100)} kapsama oran\u0131na sahip ve "
            f"de\u011ferlendirildi\u011finde toplam {best_firm['evaluated_total']:,.2f} TRY oldu\u011fu i\u00e7in \u00f6ne \u00e7\u0131k\u0131yor."
        )
    else:
        recommendation = "Uygun teklif bulunamad\u0131. PDF/Excel okuma sonu\u00e7lar\u0131 ve kalem e\u015fle\u015fmeleri kontrol edilmelidir."
    summary_ws.merge_range("B22:G24", recommendation, recommendation_fmt)

    summary_ws.merge_range("B26:G26", "KAPSANMAYAN / UYARI KALEMLER\u0130", section_dark)
    uncovered = [g for g in analyzed_groups if not g.get("offers")]
    for col, header in enumerate(["\u00dcr\u00fcn Kodu", "A\u00e7\u0131klama", "Miktar", "Sebep"], start=1):
        summary_ws.write(27, col, header, table_head)
    if uncovered:
        for idx, item in enumerate(uncovered[:6], start=28):
            summary_ws.write(idx, 1, _clean(item.get("urunKodu", "-")), table_text)
            summary_ws.write(idx, 2, _clean(item.get("urunAciklamasi", "-")), table_text)
            summary_ws.write_number(idx, 3, _safe_num(item.get("purchaseQuantity", item.get("talepEdilenAdet", 0))), table_num)
            summary_ws.write(idx, 4, "Teklif e\u015fle\u015fmedi", table_text)
    else:
        summary_ws.merge_range("B29:G31", "Kapsanmayan kalem bulunmad\u0131.", table_text)

    summary_ws.merge_range("H26:M26", "NOTLAR", section_dark)
    for r in range(27, 35):
        summary_ws.merge_range(r, 7, r, 12, "", note_line_fmt)

    summary_ws.merge_range("B36:G36", "HESAPLAMA NOTLARI", section_dark)
    summary_ws.merge_range(
        "B37:G41",
        "- Kurlu teklifler analiz kuru ile TRY kar\u015f\u0131l\u0131\u011f\u0131na \u00e7evrilir.\n"
        "- Vade avantaj\u0131 finansman oran\u0131 \u00fczerinden hesaplan\u0131r.\n"
        "- Teslim s\u00fcresi, risk ve eksik adet maliyeti de\u011ferlendirilmi\u015f maliyete yans\u0131t\u0131l\u0131r.\n"
        "- Kalem e\u015fle\u015ftirme \u00fcr\u00fcn kodu, marka ve a\u00e7\u0131klama benzerli\u011fine g\u00f6re yap\u0131l\u0131r.\n"
        "- Kazanan firma kalem baz\u0131nda en avantajl\u0131 de\u011ferlendirilmi\u015f maliyete g\u00f6re belirlenir.",
        summary_box_text,
    )

    summary_ws.merge_range("B43:M44", f"{company_name.upper()}        |        {report_date}        |        CORVIAN Business Suite", footer_fmt)

    ws.write("A1", "TEKLİF KARŞILAŞTIRMA RAPORU", title_fmt)
    ws.write("A2", f"{company_name} · {product_name}", small_gray)

    rapor_tarihi = datetime.now().strftime("%d.%m.%Y %H:%M")
    best_counter = summary["best_counter"]

    best_dist_text = (
        "  ".join([f"{k}: {v}" for k, v in best_counter.items()])
        if best_counter else "-"
    )

    cards = [
        ("Toplam Ürün", str(summary["toplam_urun"]), "Kalem"),
        ("Teklif Veren Firma", str(summary["firma_sayisi"]), "Firma"),
        ("Otomatik Kod Atanan Ürün", str(summary["otomatik_kod_sayisi"]), "Kalem"),
        ("En Avantajlı Firma Dağılımı", best_dist_text, ""),
        ("Para Birimi", "TRY", "₺ Türk Lirası"),
        ("Rapor Tarihi", rapor_tarihi.split(" ")[0], rapor_tarihi.split(" ")[1]),
    ]

    for i, (title, value, sub) in enumerate(cards):
        c1 = i * 3
        ws.merge_range(2, c1, 2, c1 + 2, title, card_title_fmt)
        ws.merge_range(3, c1, 3, c1 + 2, value, card_value_fmt)
        ws.merge_range(4, c1, 4, c1 + 2, sub, card_sub_fmt)

    info_col = len(cards) * 3
    ws.merge_range(2, info_col, 2, info_col + 3, "Bilgilendirme", note_box_title)
    ws.merge_range(
        3,
        info_col,
        4,
        info_col + 3,
        "Bu raporda * işaretli ürün kodları otomatik olarak sistem tarafından atanmıştır.",
        note_box_cell
    )

    ws.write("A6", "MUKAYESE TABLOSU", section_fmt)

    row_top = 7
    row_sub = 8

    base_headers = [
        "S.No",
        "Marka",
        "Ürün Kodu",
        "Ürün Açıklaması",
        "Birim",
        "Talep Edilen Adet",
        "Stoktan Karşılanabilir"
    ]

    for col, h in enumerate(base_headers):
        ws.merge_range(row_top, col, row_sub, col, h, head_fmt)

    col_ptr = len(base_headers)

    firm_columns = [
        "Birim Fiyat",
        "İskonto (%)",
        "Net Birim Fiyat",
        "Para Birimi",
        "Kur",
        "Net Toplam (Döviz)",
        "Net Birim Fiyat (TRY)",
        "Net Toplam (TRY)",
        "TCO (TRY)",
        "Değerlendirilmiş Maliyet (TRY)",
        "Vade",
        "Termin"
    ]

    for firma in firms:
        ws.merge_range(
            row_top,
            col_ptr,
            row_top,
            col_ptr + len(firm_columns) - 1,
            firma.upper(),
            firm_header_formats[firma]
        )

        for j, sub_h in enumerate(firm_columns):
            ws.write(row_sub, col_ptr + j, sub_h, head_fmt)

        col_ptr += len(firm_columns)

    karar_cols = [
        "Önerilen Firma",
        "Karar Nedeni",
        "En Avantajlı Değerlendirilmiş Maliyet (TRY)",
        "Not"
    ]

    ws.merge_range(
        row_top,
        col_ptr,
        row_top,
        col_ptr + len(karar_cols) - 1,
        "KARAR / ÖNERİ",
        karar_header_fmt
    )

    for j, sub_h in enumerate(karar_cols):
        ws.write(row_sub, col_ptr + j, sub_h, head_fmt)

    row = 9

    for idx, group in enumerate(analyzed_groups, start=1):
        offers = group.get("offers", [])
        best = group.get("bestOffer") or {}

        best_firma = _firma_name(best)
        talep = _safe_num(group.get("talepEdilenAdet", 0))

        offer_map = {}

        for o in offers:
            firma_key = _firma_name(o)
            if firma_key:
                offer_map[firma_key] = o

        first_offer = offers[0] if offers else {}

        kod = _clean(
            group.get("urunKodu")
            or group.get("master", {}).get("urunKodu")
            or first_offer.get("urunKodu")
            or "-"
        )
        aciklama = _clean(group.get("urunAciklamasi", ""))
        birim = _clean(group.get("birim", ""))
        marka = _group_brand(group)

        ws.write(row, 0, idx, base_cell)
        ws.write(row, 1, marka or "-", text_cell)
        ws.write(row, 2, kod, text_cell)
        ws.write(row, 3, aciklama, text_cell)
        ws.write(row, 4, birim, base_cell)
        ws.write_number(row, 5, talep, base_cell)
        ws.write_number(row, 6, _safe_num(group.get("stockCoverableQuantity", 0)), base_cell)

        c = len(base_headers)

        for firma in firms:
            o = offer_map.get(firma)

            if not o:
                for j in range(len(firm_columns)):
                    ws.write(row, c + j, "-", red_cell)
                c += len(firm_columns)
                continue

            birim_fiyat = _safe_num(o.get("birimFiyat", 0))
            iskonto = _safe_num(o.get("iskonto", 0))
            net_birim_original = _safe_num(o.get("netBirimFiyat", 0))
            currency = _clean(o.get("paraBirimi", "TRY")) or "TRY"
            exchange_rate = _safe_num(o.get("kur", 1), 1)
            net_total_original = _safe_num(o.get("netToplam", 0)) or net_birim_original * talep
            net_birim = _safe_num(o.get("netBirimFiyatTRY", 0))
            net_toplam = _safe_num(o.get("netToplamTRY", 0))
            tco = _safe_num(o.get("tcoTRY", 0))
            evaluated = _safe_num(o.get("evaluatedCostTRY", 0))
            vade = _clean(o.get("vade", ""))
            termin = _clean(o.get("termin", ""))

            row_is_best = _clean(firma).lower() == _clean(best_firma).lower()
            is_uygun = o.get("uygunMu", True)

            if not is_uygun:
                price_fmt = red_money
                normal_fmt = red_cell
            else:
                price_fmt = green_money if row_is_best else money_cell
                normal_fmt = green_cell if row_is_best else base_cell


            ws.write_number(row, c + 0, birim_fiyat, price_fmt)
            ws.write_number(row, c + 1, iskonto, green_cell if row_is_best else percent_cell)
            ws.write_number(row, c + 2, net_birim_original, price_fmt)
            ws.write(row, c + 3, currency, normal_fmt)
            ws.write_number(row, c + 4, exchange_rate, base_cell)
            ws.write_number(row, c + 5, net_total_original, price_fmt)
            ws.write_number(row, c + 6, net_birim, price_fmt)
            ws.write_number(row, c + 7, net_toplam, price_fmt)
            ws.write_number(row, c + 8, tco, price_fmt)
            ws.write_number(row, c + 9, evaluated, price_fmt)
            ws.write(row, c + 10, vade, normal_fmt)
            ws.write(row, c + 11, termin, normal_fmt)

            c += len(firm_columns)

        if best and best.get("uygunMu"):
            reason = (
                f"{best.get('firmaAdi') or best.get('firma') or '-'} önerildi. "
                f"En düşük değerlendirilmiş maliyet ve kriter uygunluğu dikkate alındı."
            )
        else:
            reason = "Kriterleri sağlayan uygun teklif bulunamadı."

        note_parts = []

        if kod.upper().startswith("PRD-"):
            note_parts.append("*Otomatik kod")

        urun_aciklamalari = set()

        master_desc = str(group.get("master", {}).get("urunAciklamasi", "")).strip().upper()
        if master_desc:
            urun_aciklamalari.add(master_desc)

        for offer in offers:
            desc = str(offer.get("urunAciklamasi", "")).strip().upper()
            if desc:
                urun_aciklamalari.add(desc)

        if kod and not kod.upper().startswith("PRD-") and len(urun_aciklamalari) > 1:
            note_parts.append(
                f"Kritik uyarı: {kod} kodu farklı ürün açıklamalarıyla geldi: "
                + ", ".join(sorted(urun_aciklamalari))
            )

        if best and _safe_num(best.get("eksikAdet", 0)) > 0:
            note_parts.append("Eksik adet uyarısı")

        #for n in best.get("kararNotlari", []) if best else []:
            #note_parts.append(str(n))
        if best:
            total_risk_rate = _safe_num(best.get("totalRiskRate", 0)) * 100
            advanced_risk_cost = _safe_num(best.get("advancedRiskCostTRY", 0))
            finance_advantage = _safe_num(best.get("financeAdvantageTRY", 0))

            #note_parts.append(
                #f"Risk: %{total_risk_rate:.0f} | "
                #f"Risk maliyeti: {advanced_risk_cost:,.2f} TRY | "
                #f"Vade avantajı: {finance_advantage:,.2f} TRY"
            #)

        #elenen_firmalar = []

        #for offer in offers:
            #if not offer.get("uygunMu"):
                #firma = offer.get("firmaAdi") or offer.get("firma") or "-"
                #reasons = offer.get("eliminationReasons", []) or offer.get("kararNotlari", [])

                #short_reason = "Kriter dışı"
                #for r in reasons:
                    #r_text = str(r)
                    #if "vade" in r_text.lower():
                        #short_reason = "Yetersiz vade"
                        #break
                    #if "termin" in r_text.lower():
                        #short_reason = "Termin sınırı aşıldı"
                        #break
                    #if "bütçe" in r_text.lower():
                        #short_reason = "Bütçe aşıldı"
                        #break

                #elenen_firmalar.append(f"{firma}: {short_reason}")

            #if elenen_firmalar:
                #note_parts.append("Elenenler: " + " | ".join(elenen_firmalar[:4]))

        if best:
            total_risk_rate = _safe_num(best.get("totalRiskRate", 0)) * 100
            advanced_risk_cost = _safe_num(best.get("advancedRiskCostTRY", 0))
            finance_advantage = _safe_num(best.get("financeAdvantageTRY", 0))

            note = (
                f"Risk %{total_risk_rate:.0f}, "
                f"risk maliyeti {advanced_risk_cost:,.2f} TRY, "
                f"vade avantajı {finance_advantage:,.2f} TRY."
            )
        else:
            note = "Uygun teklif bulunamadı."

        ws.write(row, c + 0, best_firma or "-", green_cell if best_firma else base_cell)
        ws.write(row, c + 1, reason, text_cell)

        best_total = _safe_num(best.get("evaluatedCostTRY", 0))


        ws.write_number(row, c + 2, best_total, green_money if best_firma else money_cell)
        ws.write(row, c + 3, note, text_cell)
        ws.set_row(row, 24)
        row += 1

    legend_row = row + 1

    ws.write(legend_row, 0, "", green_cell)
    ws.write(legend_row, 1, "Önerilen / en avantajlı teklif", small_gray)

    ws.write(legend_row, 3, "", red_cell)
    ws.write(legend_row, 4, "Teklif yok / veri eksik", small_gray)

    ws.write(legend_row, 6, "", yellow_cell)
    ws.write(legend_row, 7, "Vade / termin vurgusu", small_gray)

    ws.write(legend_row, 9, "", blue_cell)
    ws.write(legend_row, 10, "Bilgilendirme alanı", small_gray)

    box_row = legend_row + 3

    ws.merge_range(box_row, 0, box_row, 5, "İCMAL BİLGİLERİ", note_box_title)

    icmal_text = [
        f"• Toplam {summary['toplam_urun']} ürün kalemi analiz edildi.",
        f"• Toplam {summary['firma_sayisi']} firma teklifi değerlendirildi.",
        f"• {summary['otomatik_kod_sayisi']} ürüne sistem tarafından otomatik kod atandı.",
        "• Eşleştirme ürün kodu ve açıklama benzerliğine göre yapıldı.",
        "• En avantajlı teklif, değerlendirilmiş maliyet ve satınalma kriterlerine göre belirlendi."
    ]

    ws.merge_range(
        box_row + 1,
        0,
        box_row + 6,
        5,
        "\n".join(icmal_text),
        note_box_cell
    )

    ws.merge_range(box_row, 6, box_row, 11, "OTOMATİK KOD ATANAN ÜRÜNLER", note_box_title)
    ws.write(box_row + 1, 6, "Otomatik Kod", center_bold)
    ws.write(box_row + 1, 7, "Ürün Açıklaması", center_bold)
    ws.write(box_row + 1, 8, "Atama Nedeni", center_bold)

    auto_start = box_row + 2
    auto_code_list = summary["auto_codes"]

    if auto_code_list:
        for i, item in enumerate(auto_code_list[:4]):
            ws.write(auto_start + i, 6, item["kod"], base_cell)
            ws.write(auto_start + i, 7, item["aciklama"], text_cell)
            ws.write(auto_start + i, 8, item["neden"], text_cell)
    else:
        ws.merge_range(
            auto_start,
            6,
            auto_start + 2,
            8,
            "Otomatik kod atanan ürün bulunmadı.",
            note_box_cell
        )

    ws.merge_range(box_row, 12, box_row, 17, "EŞLEŞTİRME UYARILARI", note_box_title)

    match_text = (
        summary["match_warnings"]
        if summary["match_warnings"]
        else ["Kritik eşleştirme uyarısı bulunmadı."]
    )

    ws.merge_range(
        box_row + 1,
        12,
        box_row + 6,
        17,
        "\n".join([f"• {x}" for x in match_text]),
        note_box_cell
    )

    ws.merge_range(box_row, 18, box_row, 23, "NOTLAR", note_box_title)

    notes = [
        "HESAPLAMA MANTIĞI:",
        "• Net Birim Fiyat = Birim Fiyat x (1 - iskonto)",
        "• Net Toplam = Net Birim Fiyat x Talep Edilen Adet",
        "• Vade Avantajı = Net Toplam x (Vade Gün / 365) x Finansman Oranı",
        "• Uzun vade, ödeme geciktiği için maliyet avantajı sağlar.",
        "• Değerlendirilmiş Maliyet = Net Toplam - Vade Avantajı",
        "• TCO (Toplam Maliyet) = Net Toplam + Gecikme Maliyeti + Eksik Adet Maliyeti + Risk Primi",
        "• Karar, öncelikle değerlendirilmiş maliyete göre verilmiştir.",
        "Not:",
        "• Satınalma kriterlerini sağlamayan teklifler öneri değerlendirmesine alınmaz.",
        "• Termin süresi, belirlenen maksimum süreyi aşarsa uyarı verilir.",
    ]

    ws.merge_range(
        box_row + 1,
        18,
        box_row + 10,
        28,
        "\n".join(notes),
        note_box_cell
    )
    ws.set_row(box_row + 1, 120)
    
    footer_row = box_row + 8

    ws.write(footer_row, 0, "Rapor Oluşturan: Sistem", small_gray)
    ws.write(
        footer_row,
        10,
        f"Rapor No: RPR-{datetime.now().strftime('%Y%m%d-%H%M')}",
        small_gray
    )

    ws.set_column("A:A", 7)
    ws.set_column("B:B", 18)
    ws.set_column("C:C", 18)
    ws.set_column("D:D", 30)
    ws.set_column("E:E", 10)
    ws.set_column("F:H", 16)

    total_cols = len(base_headers) + (len(firms) * len(firm_columns)) + len(karar_cols)

    for col in range(len(base_headers), total_cols):
        ws.set_column(col, col, 14)

    ws.set_row(0, 26)
    ws.set_row(2, 22)
    ws.set_row(3, 28)
    ws.set_row(4, 22)
    ws.set_row(7, 24)
    ws.set_row(8, 38)

    # Özet sayfası kullanıcı açısından tekrar niteliğindeydi. XlsxWriter çalışma
    # kitabından sayfa silmek için genel bir API sunmadığından, paketlenmeden
    # hemen önce oluşturulmuş özet nesnesini çalışma kitabı kayıtlarından çıkar.
    # Böylece indirilen dosyada yalnız kalem bazlı mukayese ve varsa marka/kod
    # mukayese sayfaları bulunur.
    if summary_ws in wb.worksheets_objs:
        wb.worksheets_objs.remove(summary_ws)
        wb.sheetnames.pop(summary_sheet_name, None)

    for bucket in _brand_code_groups(analyzed_groups):
        _write_brand_comparison_sheet(wb, bucket, used_sheet_names)

    wb.close()

    return output_path


def _allocation_text(group):
    allocations = group.get("recommendedAllocation", []) or []
    if not allocations:
        return "Geçerli fiyatlı teklif yok"
    return " + ".join(
        f"{_clean(item.get('firma') or item.get('firmaAdi') or '-')}: {_safe_num(item.get('quantity')):g}"
        for item in allocations
    )


def _price_spread_note(offers):
    priced = [
        (_firma_name(offer), _safe_num(offer.get("netBirimFiyatTRY", 0)))
        for offer in offers
        if _safe_num(offer.get("netBirimFiyatTRY", 0)) > 0
    ]
    if len(priced) < 2:
        return ""
    cheapest = min(priced, key=lambda item: item[1])
    highest = max(priced, key=lambda item: item[1])
    ratio = highest[1] / cheapest[1] if cheapest[1] else 0
    if ratio >= 3:
        return f"Fiyat farkı {ratio:.1f} kat: {cheapest[0]}–{highest[0]}; fiyat/ürün kapsamını doğrulayın."
    return ""


def build_excel_report(analyzed_groups, output_path, company_info=None):
    """Create a compact, decision-oriented procurement comparison workbook."""
    company_info = company_info or {}
    workbook = xlsxwriter.Workbook(output_path)
    workbook.set_properties({
        "title": "Teklif Karşılaştırma ve Satınalma Karar Raporu",
        "subject": "Miktar, fiyat, kur, vade ve termin karşılaştırması",
        "company": _clean(company_info.get("name") or company_info.get("company_name") or "Corvian ERP"),
    })

    navy = "#0B2F63"
    blue = "#DCEBFA"
    green = "#DDF4E8"
    amber = "#FFF1CC"
    red = "#FDE2E2"
    white = "#FFFFFF"
    gray = "#667085"
    border = "#B8C5D6"

    title_fmt = workbook.add_format({"bold": True, "font_size": 18, "font_color": navy})
    subtitle_fmt = workbook.add_format({"font_size": 9, "font_color": gray})
    header_fmt = workbook.add_format({
        "bold": True, "font_color": white, "bg_color": navy, "border": 1,
        "border_color": navy, "align": "center", "valign": "vcenter", "text_wrap": True,
    })
    text_fmt = workbook.add_format({"border": 1, "border_color": border, "valign": "top", "text_wrap": True})
    center_fmt = workbook.add_format({"border": 1, "border_color": border, "align": "center", "valign": "vcenter"})
    qty_fmt = workbook.add_format({"border": 1, "border_color": border, "align": "right", "num_format": "0.####"})
    money_fmt = workbook.add_format({"border": 1, "border_color": border, "align": "right", "num_format": "#,##0.00"})
    unit_money_fmt = workbook.add_format({"border": 1, "border_color": border, "align": "right", "num_format": "#,##0.0000"})
    rate_fmt = workbook.add_format({"border": 1, "border_color": border, "align": "right", "num_format": "0.0000"})
    percent_fmt = workbook.add_format({"border": 1, "border_color": border, "align": "right", "num_format": "0.00%"})
    good_fmt = workbook.add_format({"border": 1, "border_color": border, "bg_color": green, "text_wrap": True, "valign": "top"})
    warn_fmt = workbook.add_format({"border": 1, "border_color": border, "bg_color": amber, "text_wrap": True, "valign": "top"})
    bad_fmt = workbook.add_format({"border": 1, "border_color": border, "bg_color": red, "text_wrap": True, "valign": "top"})
    note_fmt = workbook.add_format({"font_size": 9, "font_color": navy, "bg_color": blue, "text_wrap": True, "valign": "vcenter"})
    total_fmt = workbook.add_format({"bold": True, "font_color": white, "bg_color": navy, "border": 1, "num_format": "#,##0.00"})

    decision = workbook.add_worksheet("Kalem Bazlı Mukayese")
    decision.hide_gridlines(2)
    decision.freeze_panes(5, 0)
    decision.set_landscape()
    decision.fit_to_pages(1, 0)
    decision.set_margins(0.25, 0.25, 0.4, 0.4)
    decision.merge_range("A1:N1", "TEKLİF KARŞILAŞTIRMA VE SATINALMA KARAR RAPORU", title_fmt)
    decision.merge_range(
        "A2:N2",
        f"{_clean(company_info.get('name') or company_info.get('company_name') or 'Corvian ERP')} · "
        f"Rapor tarihi: {datetime.now().strftime('%d.%m.%Y %H:%M')} · Tüm yabancı para teklifleri canlı analiz kuru ile TRY'ye çevrilmiştir.",
        subtitle_fmt,
    )
    decision.merge_range(
        "A3:N3",
        "Karar yöntemi: Talep miktarı, teklif edilen miktar, KDV hariç net fiyat, para birimi/kur, iskonto, vade ve termin birlikte değerlendirilir. "
        "Kısmi teklif saklanmaz; eksik miktar ve gerekiyorsa bölünmüş alım önerisi açıkça gösterilir.",
        note_fmt,
    )

    decision_headers = [
        "S.No", "Ürün Kodu", "Ürün Açıklaması", "Birim", "Talep Edilen", "Önerilen Alım",
        "Karşılanan", "Açık Miktar", "Önerilen Net Toplam (TRY, KDV Hariç)", "Tam Teklif Alternatifi",
        "Tam Teklif Net Toplamı (TRY, KDV Hariç)", "Tasarruf (TRY)", "Vade / Termin", "Karar ve Kontrol Notu",
    ]
    for column, header in enumerate(decision_headers):
        decision.write(4, column, header, header_fmt)

    for index, group in enumerate(analyzed_groups, start=1):
        row = index + 4
        requested = _safe_num(group.get("talepEdilenAdet", 0))
        uncovered = _safe_num(group.get("uncoveredQuantity", 0))
        covered = max(requested - uncovered, 0)
        full = group.get("cheapestFullOffer") or {}
        allocations = group.get("recommendedAllocation", []) or []
        timing = " | ".join(
            f"{_clean(item.get('firma') or item.get('firmaAdi'))}: "
            f"Vade {_clean(item.get('vade')) or 'belirtilmedi'}, Termin {_clean(item.get('termin')) or 'belirtilmedi'}"
            for item in allocations
        ) or "-"
        quantity_notes = []
        for offer in group.get("offers", []):
            missing = _safe_num(offer.get("eksikAdet", 0))
            if missing > 0:
                quantity_notes.append(
                    f"{_firma_name(offer)} teklifi {_safe_num(offer.get('firmaAdedi')):g}/{requested:g}; {missing:g} eksik."
                )
        spread_note = _price_spread_note(group.get("offers", []))
        if len(allocations) > 1:
            quantity_notes.append("Bölünmüş alım önerisi: minimum sipariş, nakliye ve tek tedarikçi şartını onaylayın.")
        decision_warnings = [str(item) for item in group.get("decisionWarnings", []) if str(item).strip()]
        if group.get("decisionStatus") == "manual_review":
            quantity_notes.insert(0, "Otomatik öneri durduruldu; manuel satınalma kontrolü gerekli.")
        note = " ".join(quantity_notes + decision_warnings + ([spread_note] if spread_note else [])) or "Miktar ve fiyat açısından olağan dışı fark yok."
        decision.write_number(row, 0, index, center_fmt)
        decision.write(row, 1, _clean(group.get("urunKodu")), text_fmt)
        decision.write(row, 2, _clean(group.get("urunAciklamasi")), text_fmt)
        decision.write(row, 3, _clean(group.get("birim")), center_fmt)
        decision.write_number(row, 4, requested, qty_fmt)
        allocation_text = "Manuel kontrol gerekli" if group.get("decisionStatus") == "manual_review" else _allocation_text(group)
        allocation_format = warn_fmt if group.get("decisionStatus") == "manual_review" else (good_fmt if uncovered <= 0 else bad_fmt)
        decision.write(row, 5, allocation_text, allocation_format)
        decision.write_number(row, 6, covered, qty_fmt)
        decision.write_number(row, 7, uncovered, bad_fmt if uncovered > 0 else qty_fmt)
        decision.write_number(row, 8, _safe_num(group.get("recommendedTotalTRY", 0)), money_fmt)
        decision.write(row, 9, _firma_name(full) or "Tam teklif yok", text_fmt)
        decision.write_number(row, 10, _safe_num(full.get("netToplamTRY", 0)), money_fmt)
        decision.write_number(row, 11, _safe_num(group.get("savingsVsFullTRY", 0)), money_fmt)
        decision.write(row, 12, timing, text_fmt)
        decision.write(row, 13, note, warn_fmt if quantity_notes or spread_note else text_fmt)
        decision.set_row(row, 34)

    last_decision_row = 4 + len(analyzed_groups)
    decision.autofilter(4, 0, max(last_decision_row, 4), len(decision_headers) - 1)
    widths = [7, 20, 34, 10, 13, 30, 12, 11, 18, 23, 19, 15, 34, 50]
    for column, width in enumerate(widths):
        decision.set_column(column, column, width)

    detail = workbook.add_worksheet("Teklif Detayı")
    detail.hide_gridlines(2)
    detail.freeze_panes(5, 0)
    detail.set_landscape()
    detail.fit_to_pages(1, 0)
    detail.merge_range("A1:S1", "TEKLİF DETAYI · KAYNAK VERİ VE UYGUNLUK KONTROLÜ", title_fmt)
    detail.merge_range(
        "A2:S2",
        "Net birim fiyatlar kaynak dosyanın ham hücre değeridir; ekranda yuvarlanan fiyatlardan hesap yapılmaz. "
        "Kur, her teklifin gerçek para birimine uygulanır.",
        note_fmt,
    )
    detail_headers = [
        "S.No", "Ürün Kodu", "Ürün Açıklaması", "Firma", "Talep", "Teklif Adedi", "Eksik",
        "Karşılama %", "Liste Birim Fiyat", "İskonto %", "Net Birim Fiyat", "Para Birimi",
        "Canlı Kur", "Net Toplam (Döviz, KDV Hariç)", "Net Toplam (TRY, KDV Hariç)", "Vade", "Termin",
        "Miktar Durumu", "Değerlendirme Notu",
    ]
    for column, header in enumerate(detail_headers):
        detail.write(4, column, header, header_fmt)

    detail_row = 5
    for index, group in enumerate(analyzed_groups, start=1):
        requested = _safe_num(group.get("talepEdilenAdet", 0))
        spread_note = _price_spread_note(group.get("offers", []))
        for offer in group.get("offers", []):
            offered = _safe_num(offer.get("firmaAdedi", 0))
            missing = max(requested - offered, 0) if offered > 0 else requested
            coverage = min(offered / requested, 1) if requested > 0 else 0
            status = "Tam" if missing <= 0 else f"Kısmi · {missing:g} eksik"
            warnings = list(offer.get("parserUyarilari", []) or [])
            if spread_note:
                warnings.append(spread_note)
            if missing > 0:
                warnings.append(f"Talep {requested:g}, teklif {offered:g}; eksik miktar tamamlanmalı.")
            if not _clean(offer.get("vade")):
                warnings.append("Vade belirtilmemiş.")
            if not _clean(offer.get("termin")):
                warnings.append("Termin belirtilmemiş.")
            values = [
                index, _clean(group.get("urunKodu")), _clean(group.get("urunAciklamasi")), _firma_name(offer),
                requested, offered, missing, coverage, _safe_num(offer.get("birimFiyat", 0)),
                _safe_num(offer.get("iskonto", 0)) / 100, _safe_num(offer.get("netBirimFiyat", 0)),
                _clean(offer.get("paraBirimi")) or "TRY", _safe_num(offer.get("kur", 1)),
                _safe_num(offer.get("netToplam", 0)), _safe_num(offer.get("netToplamTRY", 0)),
                _clean(offer.get("vade")) or "Belirtilmedi", _clean(offer.get("termin")) or "Belirtilmedi",
                status, " ".join(str(item) for item in warnings) or "-",
            ]
            formats = [
                center_fmt, text_fmt, text_fmt, text_fmt, qty_fmt, qty_fmt, qty_fmt, percent_fmt,
                unit_money_fmt, percent_fmt, unit_money_fmt, center_fmt, rate_fmt, money_fmt, money_fmt,
                text_fmt, text_fmt, bad_fmt if missing > 0 else good_fmt, warn_fmt if warnings else text_fmt,
            ]
            for column, (value, cell_format) in enumerate(zip(values, formats)):
                if isinstance(value, (int, float)) and column not in [1, 2, 3, 11, 15, 16, 17, 18]:
                    detail.write_number(detail_row, column, value, cell_format)
                else:
                    detail.write(detail_row, column, value, cell_format)
            detail.set_row(detail_row, 30)
            detail_row += 1

    detail.autofilter(4, 0, max(detail_row - 1, 4), len(detail_headers) - 1)
    detail_widths = [7, 20, 32, 25, 11, 13, 10, 12, 17, 12, 17, 12, 12, 18, 18, 18, 18, 18, 55]
    for column, width in enumerate(detail_widths):
        detail.set_column(column, column, width)

    workbook.close()
    return output_path
