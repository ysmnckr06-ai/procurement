import os
from datetime import datetime
import xlsxwriter


def build_request_excel_report(rows, output_path, company_info=None):
    """
    Profesyonel Satınalma Talep Listesi Excel raporu oluşturur.

    rows örnek:
    [
        {
            "urunKodu": "A101",
            "urunAciklamasi": "PİLOT KALEM MAVİ",
            "talepEdilenAdet": 410,
            "birim": "adet"
        }
    ]

    company_info örnek:
    {
        "company_name": "ASDFFG ELK. ELEKTRONİK SAN. VE TİC. LTD. ŞTİ.",
        "tax_no": "123 456 7890",
        "address": "İkitelli OSB Mah. Elektronikçiler San. Sit. No:10 / İstanbul"
    }
    """

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    company_info = company_info or {}

    company_name = company_info.get(
        "company_name",
        "ASDFFG ELK. ELEKTRONİK SAN. VE TİC. LTD. ŞTİ."
    )
    tax_no = company_info.get("tax_no", "123 456 7890")
    address = company_info.get(
        "address",
        "İkitelli OSB Mah. Elektronikçiler San. Sit. No:10"
    )

    report_date = datetime.now().strftime("%d.%m.%Y %H:%M")
    report_no = f"TRL-{datetime.now().strftime('%Y%m%d%H%M')}"

    total_items = len(rows)
    total_qty = sum(float(r.get("talepEdilenAdet") or 0) for r in rows)

    workbook = xlsxwriter.Workbook(output_path)
    ws = workbook.add_worksheet("Talep Listesi")

    ws.hide_gridlines(2)
    ws.set_zoom(90)
    ws.center_horizontally()

    # Kolon genişlikleri
    ws.set_column("A:A", 8)
    ws.set_column("B:B", 18)
    ws.set_column("C:C", 52)
    ws.set_column("D:D", 20)
    ws.set_column("E:E", 14)
    ws.set_column("F:F", 36)

    # Renkler
    navy = "#062B5F"
    blue = "#0F5CC0"
    light_blue = "#EAF3FF"
    soft_bg = "#F8FAFC"
    green = "#0F8A4B"
    orange = "#EA7A12"
    purple = "#5B35B1"
    border = "#D7DFEA"
    text = "#0F172A"
    muted = "#64748B"

    # Formatlar
    title_fmt = workbook.add_format({
        "bold": True,
        "font_size": 24,
        "font_color": navy,
        "align": "center",
        "valign": "vcenter",
    })

    subtitle_fmt = workbook.add_format({
        "font_size": 12,
        "font_color": muted,
        "align": "center",
    })

    brand_fmt = workbook.add_format({
        "bold": True,
        "font_size": 22,
        "font_color": navy,
        "align": "left",
        "valign": "vcenter",
    })

    brand_sub_fmt = workbook.add_format({
        "font_size": 10,
        "font_color": navy,
        "align": "left",
    })

    meta_label_fmt = workbook.add_format({
        "bold": True,
        "font_size": 9,
        "font_color": navy,
        "align": "left",
    })

    meta_value_fmt = workbook.add_format({
        "bold": True,
        "font_size": 9,
        "font_color": text,
        "align": "left",
    })

    section_box_fmt = workbook.add_format({
        "bg_color": "#FFFFFF",
        "border": 1,
        "border_color": border,
        "valign": "vcenter",
    })

    card_label_fmt = workbook.add_format({
        "font_size": 9,
        "font_color": navy,
        "align": "left",
        "valign": "vcenter",
    })

    card_value_fmt = workbook.add_format({
        "bold": True,
        "font_size": 14,
        "font_color": text,
        "align": "left",
        "valign": "vcenter",
    })

    table_header_fmt = workbook.add_format({
        "bold": True,
        "font_color": "#FFFFFF",
        "bg_color": navy,
        "border": 1,
        "border_color": "#1D4E89",
        "align": "center",
        "valign": "vcenter",
    })

    cell_fmt = workbook.add_format({
        "border": 1,
        "border_color": border,
        "align": "left",
        "valign": "vcenter",
        "font_color": text,
    })

    cell_center_fmt = workbook.add_format({
        "border": 1,
        "border_color": border,
        "align": "center",
        "valign": "vcenter",
        "font_color": text,
    })

    cell_qty_fmt = workbook.add_format({
        "border": 1,
        "border_color": border,
        "align": "center",
        "valign": "vcenter",
        "bold": True,
        "font_color": navy,
        "num_format": "#,##0",
    })

    zebra_fmt = workbook.add_format({
        "border": 1,
        "border_color": border,
        "bg_color": "#F3F7FB",
        "align": "left",
        "valign": "vcenter",
        "font_color": text,
    })

    zebra_center_fmt = workbook.add_format({
        "border": 1,
        "border_color": border,
        "bg_color": "#F3F7FB",
        "align": "center",
        "valign": "vcenter",
        "font_color": text,
    })

    zebra_qty_fmt = workbook.add_format({
        "border": 1,
        "border_color": border,
        "bg_color": "#F3F7FB",
        "align": "center",
        "valign": "vcenter",
        "bold": True,
        "font_color": navy,
        "num_format": "#,##0",
    })

    total_fmt = workbook.add_format({
        "bold": True,
        "font_color": "#FFFFFF",
        "bg_color": navy,
        "border": 1,
        "border_color": navy,
        "align": "center",
        "valign": "vcenter",
        "num_format": "#,##0",
    })

    note_title_fmt = workbook.add_format({
        "bold": True,
        "font_size": 11,
        "font_color": navy,
        "align": "left",
    })

    note_text_fmt = workbook.add_format({
        "font_size": 9,
        "font_color": text,
        "text_wrap": True,
        "valign": "top",
    })

    footer_fmt = workbook.add_format({
        "bold": True,
        "font_color": "#FFFFFF",
        "bg_color": navy,
        "align": "center",
        "valign": "vcenter",
        "font_size": 9,
    })

    # Üst marka alanı
    ws.set_row(0, 34)
    ws.set_row(1, 28)
    ws.set_row(2, 24)

    ws.merge_range("A1:B2", "PROCURA AI", brand_fmt)
    ws.merge_range("A3:B3", "PROCUREMENT PLATFORM", brand_sub_fmt)

    ws.merge_range("C1:E1", "SATINALMA TALEP LİSTESİ", title_fmt)
    ws.merge_range("C2:E2", "Akıllı Satınalma & Teklif Analiz Sistemi", subtitle_fmt)

    ws.write("F1", "Rapor Tarihi", meta_label_fmt)
    ws.write("F2", report_date, meta_value_fmt)
    ws.write("F3", f"Rapor No: {report_no}", meta_value_fmt)

    ws.set_row(3, 8)
    ws.merge_range("A4:F4", "", workbook.add_format({"bg_color": navy}))

    # Kullanıcı firması kartı
    ws.merge_range("A5:B5", "KULLANICI FİRMASI", meta_label_fmt)
    ws.merge_range("A6:B6", company_name, workbook.add_format({
        "bold": True,
        "font_size": 11,
        "font_color": navy,
        "text_wrap": True,
        "border": 1,
        "border_color": border,
        "bg_color": "#FFFFFF",
    }))
    ws.merge_range("A7:B7", f"Vergi No: {tax_no}", meta_value_fmt)
    ws.merge_range("A8:B8", f"Adres: {address}", workbook.add_format({
        "font_size": 9,
        "font_color": text,
        "text_wrap": True,
        "border": 1,
        "border_color": border,
        "bg_color": "#FFFFFF",
    }))

    # KPI kartları
    ws.write("C5", "TOPLAM KALEM", card_label_fmt)
    ws.write("C6", total_items, card_value_fmt)
    ws.write("C7", "Ürün kalemi", card_label_fmt)

    ws.write("D5", "TOPLAM ADET", card_label_fmt)
    ws.write("D6", total_qty, card_value_fmt)
    ws.write("D7", "Talep edilen adet", card_label_fmt)

    ws.write("E5", "RAPOR TÜRÜ", card_label_fmt)
    ws.write("E6", "Talep İcmal", card_value_fmt)
    ws.write("E7", "Oluşturulan icmal listesi", card_label_fmt)

    ws.write("F5", "KAYNAK", card_label_fmt)
    ws.write("F6", "Excel, PDF, Görsel", card_value_fmt)
    ws.write("F7", "Birleştirilmiş dokümanlar", card_label_fmt)

    # Tablo
    table_start_row = 10

    headers = [
        "SIRA",
        "ÜRÜN KODU",
        "ÜRÜN AÇIKLAMASI",
        "TALEP EDİLEN ADET",
        "BİRİM",
        "AÇIKLAMA",
    ]

    for col, header in enumerate(headers):
        ws.write(table_start_row, col, header, table_header_fmt)

    for idx, row in enumerate(rows, start=1):
        excel_row = table_start_row + idx
        is_zebra = idx % 2 == 0

        fmt_left = zebra_fmt if is_zebra else cell_fmt
        fmt_center = zebra_center_fmt if is_zebra else cell_center_fmt
        fmt_qty = zebra_qty_fmt if is_zebra else cell_qty_fmt

        ws.write(excel_row, 0, idx, fmt_center)
        ws.write(excel_row, 1, row.get("urunKodu", "-"), fmt_center)
        ws.write(excel_row, 2, row.get("urunAciklamasi", "-"), fmt_left)
        ws.write_number(excel_row, 3, float(row.get("talepEdilenAdet") or 0), fmt_qty)
        ws.write(excel_row, 4, row.get("birim", "-"), fmt_center)
        ws.write(excel_row, 5, "-", fmt_left)

    total_row = table_start_row + len(rows) + 1

    ws.merge_range(total_row, 0, total_row, 2, "GENEL TOPLAM", total_fmt)
    ws.write_number(total_row, 3, total_qty, total_fmt)
    ws.write(total_row, 4, "", total_fmt)
    ws.write(total_row, 5, "", total_fmt)

    # Alt bilgi kutuları
    info_row = total_row + 2

    ws.merge_range(info_row, 0, info_row, 1, "RAPOR AÇIKLAMASI", note_title_fmt)
    ws.merge_range(
        info_row + 1,
        0,
        info_row + 4,
        1,
        "Bu rapor, yüklenen Excel, PDF ve görsel dosyaların analiz edilmesi sonucunda oluşturulmuş talep icmal listesidir.\n"
        "Ürün kodu, açıklama, adet ve birim bilgileri birleştirilerek standartize edilmiştir.",
        note_text_fmt,
    )

    ws.merge_range(info_row, 2, info_row, 3, "SİSTEM BİLGİSİ", note_title_fmt)
    ws.merge_range(
        info_row + 1,
        2,
        info_row + 4,
        3,
        "✓ Akıllı veri çıkarım motoru ile oluşturulmuştur.\n"
        "✓ Otomatik birleştirme ve eşleştirme yapılmıştır.\n"
        "✓ Manuel kontrol sonrası kullanılmalıdır.\n"
        "✓ Veri doğruluğu sistem tarafından ön kontrolden geçirilmiştir.",
        note_text_fmt,
    )

    ws.merge_range(info_row, 4, info_row, 5, "ONAY / İMZA", note_title_fmt)
    ws.merge_range(info_row + 1, 4, info_row + 2, 5, "", section_box_fmt)
    ws.merge_range(info_row + 3, 4, info_row + 3, 5, "........................................", workbook.add_format({
        "font_size": 12,
        "align": "center",
        "font_color": navy,
    }))
    ws.merge_range(info_row + 4, 4, info_row + 4, 5, "Ad Soyad / Unvan", workbook.add_format({
        "font_size": 9,
        "align": "center",
        "font_color": text,
    }))

    footer_row = info_row + 6
    ws.merge_range(
        footer_row,
        0,
        footer_row,
        5,
        "🔒 CONFIDENTIAL PROCUREMENT REPORT     |     Bu belge ProcuraAI sistemi tarafından otomatik oluşturulmuştur.     |     © 2026 ProcuraAI Procurement Platform",
        footer_fmt,
    )

    # Yazdırma / sayfa ayarları
    ws.freeze_panes(table_start_row + 1, 0)
    ws.autofilter(table_start_row, 0, table_start_row + len(rows), 5)
    ws.set_landscape()
    ws.fit_to_pages(1, 0)
    ws.set_margins(left=0.25, right=0.25, top=0.35, bottom=0.35)

    workbook.close()

    return output_path