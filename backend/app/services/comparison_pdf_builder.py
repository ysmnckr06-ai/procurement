from __future__ import annotations

import html
import os
from io import BytesIO
from pathlib import Path

import reportlab
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    CondPageBreak,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


NAVY = colors.HexColor("#0F172A")
BLUE = colors.HexColor("#1D4ED8")
SLATE = colors.HexColor("#475569")
LIGHT_SLATE = colors.HexColor("#F1F5F9")
GREEN = colors.HexColor("#047857")
LIGHT_GREEN = colors.HexColor("#ECFDF5")
AMBER = colors.HexColor("#92400E")
LIGHT_AMBER = colors.HexColor("#FFFBEB")
BORDER = colors.HexColor("#CBD5E1")


def _register_fonts() -> tuple[str, str]:
    regular_name = "CorvianVera"
    bold_name = "CorvianVeraBold"
    if regular_name in pdfmetrics.getRegisteredFontNames():
        return regular_name, bold_name

    font_dir = Path(reportlab.__file__).resolve().parent / "fonts"
    pdfmetrics.registerFont(TTFont(regular_name, str(font_dir / "Vera.ttf")))
    pdfmetrics.registerFont(TTFont(bold_name, str(font_dir / "VeraBd.ttf")))
    return regular_name, bold_name


REGULAR_FONT, BOLD_FONT = _register_fonts()


def _number(value, default=0.0) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return default


def _text(value, fallback="-") -> str:
    cleaned = str(value or "").strip()
    return cleaned or fallback


def _safe(value) -> str:
    return html.escape(_text(value))


def _money(value, currency="TRY") -> str:
    amount = _number(value)
    formatted = f"{amount:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return f"{formatted} {currency}"


def _supplier_name(offer) -> str:
    return _text((offer or {}).get("firmaAdi") or (offer or {}).get("firma"), "Bilinmeyen tedarikçi")


def _offer_original_total(group, offer) -> float:
    explicit = _number((offer or {}).get("netToplam"))
    if explicit > 0:
        return explicit
    quantity = _number(group.get("purchaseQuantity") or group.get("talepEdilenAdet") or offer.get("firmaAdedi"))
    return _number(offer.get("netBirimFiyat")) * quantity


def _offer_try_total(group, offer) -> float:
    explicit = _number((offer or {}).get("netToplamTRY"))
    if explicit > 0:
        return explicit
    currency = _text((offer or {}).get("paraBirimi"), "TRY").upper()
    rate = 1 if currency == "TRY" else _number((offer or {}).get("kur"), 1)
    return _offer_original_total(group, offer) * (rate if rate > 0 else 1)


def _evaluated_cost(group, offer) -> float:
    explicit = _number((offer or {}).get("evaluatedCostTRY"))
    if explicit > 0:
        return explicit
    tco = _number((offer or {}).get("tcoTRY")) or _offer_try_total(group, offer)
    return max(tco - _number((offer or {}).get("financeAdvantageTRY")), 0)


def _same_supplier(left, right) -> bool:
    return _supplier_name(left).casefold().strip() == _supplier_name(right).casefold().strip()


def _source_info(report) -> dict:
    items = report.get("items") if isinstance(report.get("items"), list) else []
    first_item = items[0] if items and isinstance(items[0], dict) else {}
    return {
        "number": report.get("source_request_number") or first_item.get("sourceRequestNumber") or "Talep numarası yok",
        "title": report.get("source_request_title") or first_item.get("sourceRequestTitle") or report.get("ad") or "Teklif Mukayese Raporu",
        "owner": report.get("source_request_owner") or first_item.get("requestOwner") or "-",
        "department": report.get("source_request_department") or first_item.get("requestDepartment") or "-",
    }


def _paragraph(value, style):
    return Paragraph(_safe(value), style)


def _draw_page(canvas, document):
    canvas.saveState()
    canvas.setStrokeColor(BORDER)
    canvas.line(16 * mm, 13 * mm, 194 * mm, 13 * mm)
    canvas.setFont(REGULAR_FONT, 7.5)
    canvas.setFillColor(SLATE)
    canvas.drawString(16 * mm, 8 * mm, "CORVIAN Business Suite - Mukayese Raporu")
    canvas.drawRightString(194 * mm, 8 * mm, f"Sayfa {document.page}")
    canvas.restoreState()


def build_comparison_pdf(report: dict, output_path: str | os.PathLike | None = None) -> bytes:
    buffer = BytesIO()
    target = str(output_path) if output_path else buffer
    document = SimpleDocTemplate(
        target,
        pagesize=A4,
        rightMargin=16 * mm,
        leftMargin=16 * mm,
        topMargin=15 * mm,
        bottomMargin=18 * mm,
        title="Mukayese Raporu",
        author="CORVIAN Business Suite",
    )

    styles = getSampleStyleSheet()
    body = ParagraphStyle("BodyTR", parent=styles["BodyText"], fontName=REGULAR_FONT, fontSize=8.5, leading=12, textColor=NAVY)
    small = ParagraphStyle("SmallTR", parent=body, fontSize=7, leading=9)
    small_bold = ParagraphStyle("SmallBoldTR", parent=small, fontName=BOLD_FONT)
    table_header = ParagraphStyle("TableHeaderTR", parent=small_bold, textColor=colors.white)
    section_title = ParagraphStyle("SectionTitleTR", parent=body, fontName=BOLD_FONT, fontSize=12, leading=15, textColor=NAVY, spaceAfter=6)
    product_title = ParagraphStyle("ProductTitleTR", parent=section_title, fontSize=10.5, leading=13, textColor=BLUE)
    white_title = ParagraphStyle("WhiteTitleTR", parent=body, fontName=BOLD_FONT, fontSize=20, leading=24, textColor=colors.white)
    white_subtitle = ParagraphStyle("WhiteSubtitleTR", parent=body, fontSize=8.5, leading=12, textColor=colors.HexColor("#DBEAFE"))
    green_note = ParagraphStyle("GreenNoteTR", parent=body, fontName=BOLD_FONT, fontSize=8.5, leading=12, textColor=GREEN)
    amber_note = ParagraphStyle("AmberNoteTR", parent=body, fontName=BOLD_FONT, fontSize=8, leading=11, textColor=AMBER)

    source = _source_info(report)
    analysis = report.get("analysis") if isinstance(report.get("analysis"), list) else []
    suppliers = sorted({
        _supplier_name(offer)
        for group in analysis
        for offer in (group.get("offers") if isinstance(group.get("offers"), list) else [])
    })
    automatic_count = sum(1 for group in analysis if group.get("bestOffer"))
    review_count = len(analysis) - automatic_count
    recommended_total = sum(
        _offer_try_total(group, group.get("bestOffer") or {})
        for group in analysis
        if group.get("bestOffer")
    )
    rate_rows = {}
    annual_rate = None
    for group in analysis:
        for offer in group.get("offers") or []:
            currency = _text(offer.get("paraBirimi"), "TRY").upper()
            if currency != "TRY" and _number(offer.get("kur")) > 0:
                rate_rows[currency] = _number(offer.get("kur"))
            if annual_rate is None and offer.get("annualInterestRate") is not None:
                annual_rate = _number(offer.get("annualInterestRate"))

    story = []
    hero = Table([
        [Paragraph("CORVIAN", white_subtitle)],
        [Paragraph("Satınalma Mukayese Raporu", white_title)],
        [Paragraph(f"{_safe(source['number'])} - {_safe(source['title'])}", white_subtitle)],
    ], colWidths=[178 * mm])
    hero.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, 0), 10),
        ("TOPPADDING", (0, 1), (-1, 1), 2),
        ("BOTTOMPADDING", (0, 2), (-1, -1), 12),
    ]))
    story.extend([hero, Spacer(1, 5 * mm)])

    metadata = [
        ["Rapor No", f"RPR-{str(report.get('id') or '')[:8].upper()}", "Rapor Tarihi", _text(report.get("created_at") or report.get("tarih"))],
        ["Talebi Açan", source["owner"], "Birim", source["department"]],
    ]
    metadata_table = Table(metadata, colWidths=[27 * mm, 62 * mm, 27 * mm, 62 * mm])
    metadata_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), REGULAR_FONT),
        ("FONTNAME", (0, 0), (0, -1), BOLD_FONT),
        ("FONTNAME", (2, 0), (2, -1), BOLD_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("TEXTCOLOR", (0, 0), (-1, -1), NAVY),
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT_SLATE),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.extend([metadata_table, Spacer(1, 6 * mm), Paragraph("Yönetici özeti", section_title)])

    summary = Table([
        ["Talep kalemi", "Teklif veren", "Otomatik öneri", "Manuel kontrol", "Önerilen toplam"],
        [str(len(analysis)), str(len(suppliers)), str(automatic_count), str(review_count), _money(recommended_total, "TRY")],
    ], colWidths=[31 * mm, 31 * mm, 31 * mm, 31 * mm, 54 * mm])
    summary.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), BOLD_FONT),
        ("FONTNAME", (0, 1), (-1, 1), BOLD_FONT),
        ("FONTSIZE", (0, 0), (-1, 0), 7),
        ("FONTSIZE", (0, 1), (-1, 1), 10),
        ("TEXTCOLOR", (0, 0), (-1, 0), SLATE),
        ("TEXTCOLOR", (0, 1), (-1, 1), NAVY),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.extend([summary, Spacer(1, 4 * mm)])

    assumptions = []
    if rate_rows:
        assumptions.append("Analiz kurları: " + ", ".join(f"{currency} {_money(rate, 'TRY')}" for currency, rate in sorted(rate_rows.items())))
    if annual_rate is not None:
        assumptions.append(f"Yıllık finansman / fırsat maliyeti oranı: %{annual_rate:g}")
    assumptions.append("Öneri; net fiyat, vade, termin, miktar yeterliliği ve kayıtlı risk etkilerinin birlikte değerlendirilmesiyle oluşur.")
    assumption_box = Table([[Paragraph("<br/>".join(_safe(item) for item in assumptions), body)]], colWidths=[178 * mm])
    assumption_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EFF6FF")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#BFDBFE")),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.extend([assumption_box, PageBreak(), Paragraph("Kalem bazlı mukayese", section_title)])

    for index, group in enumerate(analysis, start=1):
        offers = group.get("offers") if isinstance(group.get("offers"), list) else []
        best = group.get("bestOffer") if isinstance(group.get("bestOffer"), dict) else None
        eligible_alternatives = [offer for offer in offers if offer.get("uygunMu") is not False and not (best and _same_supplier(offer, best))]
        alternative = min(eligible_alternatives, key=lambda offer: _evaluated_cost(group, offer), default=None)

        story.extend([
            CondPageBreak(58 * mm),
            Paragraph(f"{index}. {_safe(group.get('urunKodu') or 'Kodsuz')} - {_safe(group.get('urunAciklamasi') or 'Ürün')}", product_title),
            Paragraph(
                f"Talep edilen: <b>{_safe(group.get('talepEdilenAdet'))} {_safe(group.get('birim'))}</b> &nbsp;&nbsp; Teklif sayısı: <b>{len(offers)}</b>",
                body,
            ),
            Spacer(1, 2 * mm),
        ])

        table_data = [[
            _paragraph("Tedarikçi", table_header),
            _paragraph("Net toplam", table_header),
            _paragraph("TL karşılığı", table_header),
            _paragraph("Vade", table_header),
            _paragraph("Termin", table_header),
            _paragraph("Değ. maliyet", table_header),
            _paragraph("Sonuç", table_header),
        ]]
        best_row = None
        for row_index, offer in enumerate(offers, start=1):
            is_best = bool(best and _same_supplier(offer, best))
            if is_best:
                best_row = row_index
            currency = _text(offer.get("paraBirimi"), "TRY").upper()
            result = "Önerilen" if is_best else ("Uygun değil" if offer.get("uygunMu") is False else "Alternatif")
            table_data.append([
                _paragraph(_supplier_name(offer), small_bold if is_best else small),
                _paragraph(_money(_offer_original_total(group, offer), currency), small),
                _paragraph(_money(_offer_try_total(group, offer), "TRY"), small),
                _paragraph(offer.get("vade") or f"{_number(offer.get('vadeDays')):g} gün", small),
                _paragraph(offer.get("termin") or f"{_number(offer.get('terminDays')):g} gün", small),
                _paragraph(_money(_evaluated_cost(group, offer), "TRY"), small_bold),
                _paragraph(result, small_bold if is_best else small),
            ])

        offers_table = Table(table_data, colWidths=[29 * mm, 25 * mm, 27 * mm, 25 * mm, 22 * mm, 28 * mm, 22 * mm], repeatRows=1)
        offers_style = [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.45, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
        if best_row is not None:
            offers_style.extend([
                ("BACKGROUND", (0, best_row), (-1, best_row), LIGHT_GREEN),
                ("TEXTCOLOR", (-1, best_row), (-1, best_row), GREEN),
            ])
        offers_table.setStyle(TableStyle(offers_style))
        story.extend([offers_table, Spacer(1, 2.5 * mm)])

        if best and alternative:
            best_cost = _evaluated_cost(group, best)
            alternative_cost = _evaluated_cost(group, alternative)
            gap = max(alternative_cost - best_cost, 0)
            gap_rate = (gap / alternative_cost * 100) if alternative_cost > 0 else 0
            decision_text = (
                f"Neden {_supplier_name(best)}? Vade, termin ve kayıtlı risk etkileri sonrasında değerlendirilmiş maliyet "
                f"{_money(best_cost, 'TRY')}; en yakın uygun alternatif {_supplier_name(alternative)} için "
                f"{_money(alternative_cost, 'TRY')}. Ekonomik fark {_money(gap, 'TRY')} (%{gap_rate:.1f}). "
                f"Vade finansman avantajları sırasıyla {_money(best.get('financeAdvantageTRY'), 'TRY')} ve "
                f"{_money(alternative.get('financeAdvantageTRY'), 'TRY')} olarak hesaba katıldı."
            )
            decision_box = Table([[_paragraph(decision_text, green_note)]], colWidths=[178 * mm])
            decision_box.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT_GREEN),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#A7F3D0")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]))
            story.append(decision_box)
        elif best:
            story.append(_paragraph(f"{_supplier_name(best)} karşılaştırılabilir başka uygun teklif bulunmadığı için önerildi.", green_note))
        else:
            warnings = group.get("decisionWarnings") if isinstance(group.get("decisionWarnings"), list) else []
            message = "Manuel kontrol gerekli. " + " | ".join(str(item) for item in warnings)
            warning_box = Table([[_paragraph(message, amber_note)]], colWidths=[178 * mm])
            warning_box.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT_AMBER),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#FDE68A")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]))
            story.append(warning_box)

        story.append(Spacer(1, 5 * mm))

    story.extend([
        CondPageBreak(40 * mm),
        Spacer(1, 4 * mm),
        Paragraph("Onay ve izlenebilirlik", section_title),
        _paragraph(
            "Bu rapor, analiz anındaki teklif verileri ve şirket karar parametreleriyle oluşturulmuş değişmez bir mukayese çıktısıdır. "
            "Sipariş öncesinde fiyat kapsamı, miktar, teslim, ödeme ve tedarikçi bilgileri yetkili tarafından doğrulanmalıdır.",
            body,
        ),
        Spacer(1, 8 * mm),
    ])
    approval = Table([
        ["Hazırlayan", "Kontrol Eden", "Onaylayan"],
        ["Ad / İmza / Tarih", "Ad / İmza / Tarih", "Ad / İmza / Tarih"],
        ["", "", ""],
    ], colWidths=[59.3 * mm] * 3, rowHeights=[8 * mm, 8 * mm, 18 * mm])
    approval.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), BOLD_FONT),
        ("FONTNAME", (0, 1), (-1, -1), REGULAR_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("GRID", (0, 0), (-1, -1), 0.6, BORDER),
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT_SLATE),
        ("ALIGN", (0, 0), (-1, 1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(approval)

    document.build(story, onFirstPage=_draw_page, onLaterPages=_draw_page)
    if output_path:
        return Path(output_path).read_bytes()
    return buffer.getvalue()
