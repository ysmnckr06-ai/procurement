from collections import Counter
from datetime import datetime
import xlsxwriter


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


def build_excel_report(analyzed_groups, output_path, company_info=None):
    company_info = company_info or {}
    company_name = str(company_info.get("company_name") or "Firma adı belirtilmedi").strip()
    product_name = str(company_info.get("product_name") or "Corvian ERP").strip()
    summary = _build_summary(analyzed_groups)
    firms = summary["firmalar"]

    wb = xlsxwriter.Workbook(output_path)
    ws = wb.add_worksheet("Mukayese Raporu")
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
        "Ürün Kodu",
        "Ürün Açıklaması",
        "Birim",
        "Talep Edilen Adet",
        "Stoktan Karşılanabilir",
        "Satın Alınacak"
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

        ws.write(row, 0, idx, base_cell)
        ws.write(row, 1, kod, text_cell)
        ws.write(row, 2, aciklama, text_cell)
        ws.write(row, 3, birim, base_cell)
        ws.write_number(row, 4, talep, base_cell)
        ws.write_number(row, 5, _safe_num(group.get("stockCoverableQuantity", 0)), base_cell)
        ws.write_number(row, 6, _safe_num(group.get("purchaseQuantity", talep)), base_cell)

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
    ws.set_column("B:B", 14)
    ws.set_column("C:C", 28)
    ws.set_column("D:D", 10)
    ws.set_column("E:E", 16)

    total_cols = 5 + (len(firms) * 6) + 4

    for col in range(5, total_cols):
        ws.set_column(col, col, 14)

    ws.set_row(0, 26)
    ws.set_row(2, 22)
    ws.set_row(3, 28)
    ws.set_row(4, 22)
    ws.set_row(7, 24)
    ws.set_row(8, 38)

    wb.close()

    return output_path
