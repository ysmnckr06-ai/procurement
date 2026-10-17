import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from app.parsers.image_parser import extract_document_items_from_text
from app.parsers.pdf_parser import extract_document_items_from_tables

# GİB e-Arşiv faturanın PDF/OCR metni (taranmış belgede % işaretleri ve
# TL ekleri bozulabilir; sıra no harfe dönebilir).
INVOICE_TEXT = """ANADOLU ELEKTRİK MALZEMELERİ SAN. VE TİC. LTD. ŞTİ.
Tel: 0352 555 1234
Vergi Dairesi: Erciyes VKN: 1234567890
Ticaret Sicil No: 45678 e-Arşiv Fatura
Özelleştirme No: TR1.2
SAYIN Fatura No: | EAR2026000004817
CORVIAN PANO SİSTEMLERİ A.Ş. Fatura Tarihi: 15-10-2026
Vergi Dairesi: Konak VKN: 9876543210 Düzenleme Saati: 14:32:05
1 KNT-25 Kontaktör 25A 220V 3P 12 Adet 845,50 TL %0,00 %20,00 2.029,20 TL 10.146,00 TL
2 A16 Otomatik Sigorta 1x16A C Tipi 40 Adet 118,90 TL 40,00 920,00 951,20TL 4.756,00 TL
1 KNT-25 Kontaktör 25A 220V 3P 12 Adet 845,50 TL %0,00 %20,00 2.029,20 TL 10.146,00 TL
3 NYAF-25 NYAF Kablo 2,5 mm² Siyah 300 Metre 14,35 TL %0,00 %20,00 861,00 TL 4.305,00 TL
Mal Hizmet Toplam Tutarı 19.207,00 TL
Ödenecek Tutar 23.048,40 TL
"""

WAYBILL_TEXT = """e-İrsaliye
İrsaliye No: IRS2026000001293
İrsaliye Tarihi: 14.10.2026
Teslim Alan: CORVIAN PANO SİSTEMLERİ A.Ş. Plaka: 38 ABC 123
TI KNT-25 Kontaktör 25A 220V 3P 12 Adet
2 KK-4060 Kablo Kanalı 40x60 Gri 25 Metre
"""


class DocumentReadingTests(unittest.TestCase):
    def test_invoice_metadata(self):
        meta = main.extract_order_document_metadata(INVOICE_TEXT)
        self.assertEqual(meta["document_number"], "EAR2026000004817")
        self.assertEqual(meta["document_date"], "2026-10-15")
        # Satıcının VKN'si; "SAYIN" sonrasındaki alıcı VKN'si alınmaz.
        self.assertEqual(meta["supplier_tax_number"], "1234567890")
        self.assertEqual(meta["invoice_total"], 23048.4)

    def test_no_number_from_unrelated_words(self):
        meta = main.extract_order_document_metadata("e-Arşiv Fatura\nTel: 0352 555 1234\nToplam 100,00 TL")
        self.assertIsNone(meta["document_number"])

    def test_invoice_rows_with_tax_columns(self):
        items = extract_document_items_from_text(INVOICE_TEXT)
        self.assertEqual([item["product_code"] for item in items], ["KNT-25", "A16", "NYAF-25"])
        first = items[0]
        self.assertEqual((first["quantity"], first["unit"], first["unit_price"], first["total"]), (12.0, "adet", 845.5, 10146.0))
        self.assertEqual(items[2]["unit"], "metre")
        self.assertFalse(any(item["review_required"] for item in items))

    def test_waybill_rows_without_prices(self):
        meta = main.extract_order_document_metadata(WAYBILL_TEXT)
        self.assertEqual(meta["document_number"], "IRS2026000001293")
        self.assertEqual(meta["document_date"], "2026-10-14")
        items = extract_document_items_from_text(WAYBILL_TEXT)
        self.assertEqual([(i["product_code"], i["quantity"], i["unit"]) for i in items], [("KNT-25", 12.0, "adet"), ("KK-4060", 25.0, "metre")])

    def test_gib_table_layout(self):
        table = [
            ["Sıra No", "Mal Hizmet", "Miktar", "Birim Fiyat", "İskonto Oranı", "KDV Oranı", "KDV Tutarı", "Mal Hizmet Tutarı"],
            ["1", "KNT-25 Kontaktör 25A 220V 3P", "12 Adet", "845,50 TL", "%0,00", "%20,00", "2.029,20 TL", "10.146,00 TL"],
        ]
        items = extract_document_items_from_tables([table])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["product_code"], "KNT-25")
        self.assertEqual((items[0]["quantity"], items[0]["unit"], items[0]["unit_price"], items[0]["total"]), (12.0, "adet", 845.5, 10146.0))

    def test_waybill_table_layout(self):
        table = [
            ["Sıra No", "Mal Hizmet Kodu", "Mal Hizmet", "Miktar", "Birim"],
            ["1", "A16", "Otomatik Sigorta 1x16A", "40", "Adet"],
        ]
        items = extract_document_items_from_tables([table])
        self.assertEqual([(i["product_code"], i["product_name"], i["quantity"], i["unit"]) for i in items], [("A16", "Otomatik Sigorta 1x16A", 40.0, "adet")])


if __name__ == "__main__":
    unittest.main()
