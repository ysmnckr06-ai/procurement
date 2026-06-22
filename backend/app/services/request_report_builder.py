import os
from datetime import datetime
import xlsxwriter


def normalize_product_code(value):
    return str(value or "").strip().upper()


def normalize_product_name(value):
    turkish_lower = str(value or "").translate(str.maketrans({"I": "ı", "İ": "i"})).lower()
    return " ".join(turkish_lower.strip().split())


def enrich_request_rows_with_stock(rows, products):
    remaining_stock = {}
    enriched_rows = []

    for row in rows or []:
        product_code = str(row.get("urunKodu") or "").strip()
        product_name = str(row.get("urunAciklamasi") or "").strip()
        normalized_code = normalize_product_code(product_code)
        normalized_name = normalize_product_name(product_name)
        requested_quantity = float(row.get("talepEdilenAdet") or 0)

        if normalized_code:
            matching_products = [
                product for product in products or []
                if normalize_product_code(product.get("product_code")) == normalized_code
            ]
            match_key = f"code:{normalized_code}"
        else:
            matching_products = [
                product for product in products or []
                if normalized_name and normalize_product_name(product.get("product_name")) == normalized_name
            ]
            match_key = f"name:{normalized_name}"

        current_stock = sum(float(product.get("current_stock") or 0) for product in matching_products)
        reserved_stock = sum(float(product.get("reserved_stock") or 0) for product in matching_products)
        initial_available_stock = max(current_stock - reserved_stock, 0)
        available_stock = remaining_stock.get(match_key, initial_available_stock) if matching_products else 0
        missing_quantity = max(requested_quantity - available_stock, 0) if matching_products else requested_quantity
        allocated_quantity = min(requested_quantity, available_stock)

        if matching_products:
            remaining_stock[match_key] = max(available_stock - allocated_quantity, 0)

        if not matching_products:
            stock_status = "Ürün kartı bulunamadı"
        elif missing_quantity == 0:
            stock_status = "Stoktan karşılanabilir"
        elif available_stock > 0:
            stock_status = "Kısmi stok var"
        else:
            stock_status = "Stokta yok"

        matched_product = " | ".join(
            f"{product.get('product_code') or 'Kodsuz'} · {product.get('product_name') or 'Ürün kartı'}"
            for product in matching_products
        ) or "-"

        enriched_rows.append({
            **row,
            "mevcutStok": current_stock,
            "ayrilmisStok": reserved_stock,
            "bostaStok": available_stock,
            "eksikMiktar": missing_quantity,
            "stokDurumu": stock_status,
            "eslesenUrun": matched_product,
        })

    return enriched_rows


def build_request_excel_report(rows, output_path, company_info=None, products=None):
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
        "company_name": "Kullanıcı Firma Adı",
        "tax_no": "Vergi numarası",
        "address": "Firma adresi"
    }
    """

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    company_info = company_info or {}

    company_name = str(company_info.get("company_name") or "Firma adı belirtilmedi").strip()
    tax_no = str(company_info.get("tax_no") or "-").strip()
    address = str(company_info.get("address") or "-").strip()
    product_name = str(company_info.get("product_name") or "Corvian ERP").strip()

    report_date = datetime.now().strftime("%d.%m.%Y %H:%M")
    report_no = f"TRL-{datetime.now().strftime('%Y%m%d%H%M')}"

    rows = enrich_request_rows_with_stock(rows, products or [])
    total_items = len(rows)
    total_qty = sum(float(r.get("talepEdilenAdet") or 0) for r in rows)

    workbook = xlsxwriter.Workbook(output_path)
    ws = workbook.add_worksheet("Talep Listesi")

    ws.hide_gridlines(2)
    ws.set_zoom(90)
    ws.center_horizontally()

    # Kolon genişlikleri
    ws.set_column("A:A", 7)
    ws.set_column("B:B", 17)
    ws.set_column("C:C", 38)
    ws.set_column("D:H", 15)
    ws.set_column("I:I", 24)
    ws.set_column("J:J", 38)
    ws.set_column("K:K", 12)
    ws.set_column("L:L", 28)

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

    ws.merge_range("A1:B2", company_name, brand_fmt)
    ws.merge_range("A3:B3", product_name, brand_sub_fmt)

    ws.merge_range("C1:E1", "SATINALMA TALEP LİSTESİ", title_fmt)
    ws.merge_range("C2:E2", "Akıllı Satınalma & Teklif Analiz Sistemi", subtitle_fmt)

    ws.write("F1", "Rapor Tarihi", meta_label_fmt)
    ws.write("F2", report_date, meta_value_fmt)
    ws.write("F3", f"Rapor No: {report_no}", meta_value_fmt)

    ws.set_row(3, 8)
    ws.merge_range("A4:L4", "", workbook.add_format({"bg_color": navy}))

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
        "MEVCUT STOK",
        "AYRILMIŞ STOK",
        "BOŞTA STOK",
        "TALEP EDİLEN ADET",
        "EKSİK MİKTAR",
        "STOK DURUMU",
        "EŞLEŞEN ÜRÜN KODU / KARTI",
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
        ws.write_number(excel_row, 3, float(row.get("mevcutStok") or 0), fmt_qty)
        ws.write_number(excel_row, 4, float(row.get("ayrilmisStok") or 0), fmt_qty)
        ws.write_number(excel_row, 5, float(row.get("bostaStok") or 0), fmt_qty)
        ws.write_number(excel_row, 6, float(row.get("talepEdilenAdet") or 0), fmt_qty)
        ws.write_number(excel_row, 7, float(row.get("eksikMiktar") or 0), fmt_qty)
        ws.write(excel_row, 8, row.get("stokDurumu", "-"), fmt_center)
        ws.write(excel_row, 9, row.get("eslesenUrun", "-"), fmt_left)
        ws.write(excel_row, 10, row.get("birim", "-"), fmt_center)
        ws.write(excel_row, 11, "-", fmt_left)

    total_row = table_start_row + len(rows) + 1

    ws.merge_range(total_row, 0, total_row, 5, "GENEL TOPLAM", total_fmt)
    ws.write_number(total_row, 6, total_qty, total_fmt)
    for column in range(7, 12):
        ws.write(total_row, column, "", total_fmt)

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
        11,
        "🔒 GİZLİ SATINALMA RAPORU     |     Bu belge Corvian ERP tarafından otomatik oluşturulmuştur.",
        footer_fmt,
    )

    # Yazdırma / sayfa ayarları
    ws.freeze_panes(table_start_row + 1, 0)
    ws.autofilter(table_start_row, 0, table_start_row + len(rows), 11)
    ws.set_landscape()
    ws.fit_to_pages(1, 0)
    ws.set_margins(left=0.25, right=0.25, top=0.35, bottom=0.35)

    workbook.close()

    return output_path
