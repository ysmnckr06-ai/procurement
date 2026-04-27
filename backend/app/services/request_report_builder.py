import xlsxwriter
from datetime import datetime


def build_request_report(rows, output_path):
    wb = xlsxwriter.Workbook(output_path)
    ws = wb.add_worksheet("Talep Listesi")

    title = wb.add_format({
        "bold": True,
        "font_size": 16,
        "font_color": "#163A70"
    })

    header = wb.add_format({
        "bold": True,
        "border": 1,
        "bg_color": "#D9E8FB",
        "align": "center"
    })

    cell = wb.add_format({
        "border": 1,
        "align": "center"
    })

    text_cell = wb.add_format({
        "border": 1,
        "align": "left"
    })

    ws.write("A1", "SATINALMA TALEP LİSTESİ", title)
    ws.write("A2", f"Rapor Tarihi: {datetime.now().strftime('%d.%m.%Y %H:%M')}")

    headers = ["Sıra", "Ürün Kodu", "Ürün Açıklaması", "Talep Edilen Adet", "Birim"]

    for col, h in enumerate(headers):
        ws.write(4, col, h, header)

    for i, row in enumerate(rows, start=1):
        excel_row = i + 4

        ws.write_number(excel_row, 0, i, cell)
        ws.write(excel_row, 1, row.get("urunKodu", "") or "-", text_cell)
        ws.write(excel_row, 2, row.get("urunAciklamasi", "") or "", text_cell)
        ws.write_number(excel_row, 3, float(row.get("talepEdilenAdet", 0) or 0), cell)
        ws.write(excel_row, 4, row.get("birim", "adet") or "adet", cell)

    ws.set_column("A:A", 8)
    ws.set_column("B:B", 18)
    ws.set_column("C:C", 32)
    ws.set_column("D:D", 20)
    ws.set_column("E:E", 12)

    wb.close()
    return output_path