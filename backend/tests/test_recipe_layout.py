import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.parsers.excel_parser import parse_excel_with_audit  # noqa: E402


class RecipeLayoutTest(unittest.TestCase):
    """Sektörden bağımsız düzen: ana ürün üstte, bileşenleri altında
    (tekstil reçetesi). "Seviye" sütunu ana/alt ayrımını verir."""

    def parse(self, header, rows):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "recete.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(header)
            for row in rows:
                sheet.append(row)
            workbook.save(path)
            return parse_excel_with_audit(str(path), "Örme Ltd", path.name)

    def test_textile_recipe_with_per_unit_consumption(self):
        audit = self.parse(
            ["Seviye", "Ürün Kodu", "Ürün Açıklaması", "Birim Başı", "Miktar", "Birim", "Birim Fiyat", "Toplam"],
            [
                ("Ana", "KZK-01", "Kazak Model A Lacivert", None, 200, "adet", 450, 90000),
                ("Alt", "IPL-30", "Pamuk iplik 30/1 lacivert", 0.45, None, "kg", 180, None),
                ("Alt", "DGM-12", "Düğme 12 mm", 5, None, "adet", 1.5, None),
                ("Alt", "ETK-01", "Yaka etiketi", 1, None, "adet", 0.8, None),
                ("Ana", "HRK-02", "Hırka Model B", None, 50, "adet", 600, 30000),
                ("Alt", "IPL-30", "Pamuk iplik 30/1 lacivert", 0.6, None, "kg", 180, None),
            ],
        )
        sections = {section["section_name"]: section for section in audit["sections"]}
        self.assertEqual(list(sections), ["Kazak Model A Lacivert", "Hırka Model B"])
        self.assertEqual(sections["Kazak Model A Lacivert"]["section_quantity"], 200)
        self.assertEqual(sections["Kazak Model A Lacivert"]["section_total"], 90000)
        self.assertEqual(sections["Kazak Model A Lacivert"]["product_code"], "KZK-01")

        kazak = [row for row in audit["rows"] if row["section_name"] == "Kazak Model A Lacivert"]
        quantities = {row["urunKodu"]: row["firmaAdedi"] for row in kazak}
        self.assertEqual(quantities, {"IPL-30": 90, "DGM-12": 1000, "ETK-01": 200})
        self.assertTrue(all(row["price_status"] == "section_total_only" for row in kazak))

        hirka = [row for row in audit["rows"] if row["section_name"] == "Hırka Model B"]
        self.assertEqual([(row["urunKodu"], row["firmaAdedi"]) for row in hirka], [("IPL-30", 30)])

    def test_main_without_total_takes_children_sum(self):
        audit = self.parse(
            ["Seviye", "Ürün Kodu", "Ürün Açıklaması", "Miktar", "Birim", "Birim Fiyat"],
            [
                ("Ana", "MSA-1", "Toplantı masası", 2, "adet", None),
                ("Alt", "TBL-1", "Masa tablası", 2, "adet", 1500),
                ("Alt", "AYK-1", "Metal ayak", 8, "adet", 250),
            ],
        )
        self.assertEqual(audit["sections"][0]["section_total"], 5000)

    def test_files_without_level_column_unchanged(self):
        audit = self.parse(
            ["Ürün Kodu", "Ürün Açıklaması", "Miktar", "Birim", "Birim Fiyat", "Toplam"],
            [
                ("A1", "Vida M6", 100, "adet", 2, 200),
                ("A2", "Somun M6", 100, "adet", 1, 100),
            ],
        )
        self.assertEqual(audit["sections"], [])
        self.assertEqual([row["price_status"] for row in audit["rows"]], ["line_priced", "line_priced"])


if __name__ == "__main__":
    unittest.main()
