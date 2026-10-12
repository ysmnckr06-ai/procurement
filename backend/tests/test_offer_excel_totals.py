import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.parsers.excel_parser import parse_excel_with_audit


def parse_rows(header, rows):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "teklif.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(header)
        for row in rows:
            sheet.append(row)
        workbook.save(path)
        return parse_excel_with_audit(str(path), "Test Firma", path.name)["rows"]


class OfferExcelTotalsTest(unittest.TestCase):
    def test_delivery_days_are_not_read_as_row_total(self):
        rows = parse_rows(
            ["Ürün Kodu", "Ürün Açıklaması", "Miktar", "Birim", "Birim Fiyat", "İskonto", "Para Birimi", "Vade", "Termin"],
            [("NH125", "125A NH00 Buşon", 12, "adet", 92, 5, "TRY", "60 gün", "10 gün")],
        )
        row = rows[0]
        self.assertEqual(row["birimFiyat"], 92)
        self.assertEqual(row["iskonto"], 5)
        self.assertAlmostEqual(row["netBirimFiyat"], 87.4)
        self.assertAlmostEqual(row["netToplam"], 1048.8)

    def test_explicit_total_column_is_kept(self):
        rows = parse_rows(
            ["Ürün Kodu", "Açıklama", "Miktar", "Birim Fiyat", "Toplam Tutar"],
            [("A1", "Kablo", 10, 5, 50)],
        )
        self.assertAlmostEqual(rows[0]["netToplam"], 50)

    def test_unit_price_is_derived_from_total_only_rows(self):
        rows = parse_rows(
            ["Ürün Kodu", "Açıklama", "Miktar", "Toplam Tutar", "Termin"],
            [("B1", "Şalter", 4, 800, "3 gün")],
        )
        self.assertAlmostEqual(rows[0]["birimFiyat"], 200)
        self.assertAlmostEqual(rows[0]["netToplam"], 800)


if __name__ == "__main__":
    unittest.main()
