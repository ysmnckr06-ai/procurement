import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.parsers.excel_parser import parse_excel_with_audit  # noqa: E402


class ProjectSectionRowsTest(unittest.TestCase):
    """Uçtan uca testte bulunan hata: büyük harfli ana kalem adının ilk kelimesi
    ("ANA DAĞITIM PANOSU" → "ANA") marka sanılıyor, pano satırı alt malzemeye
    dönüşüyor ve sonraki panonun malzemeleri yanlış panoya bağlanıyordu."""

    def parse(self, rows):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "proje.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(["Ürün Kodu", "Marka", "Ürün Açıklaması", "Miktar", "Birim", "Birim Fiyat", "Toplam", "Para Birimi"])
            for row in rows:
                sheet.append(row)
            workbook.save(path)
            return parse_excel_with_audit(str(path), "Test", path.name)

    def test_uppercase_section_names_are_sections(self):
        audit = self.parse([
            ("SLT-16A", "Schneider", "Otomatik Şalter 16A", 12, "adet", None, None, "TRY"),
            ("KNT-25A", "Schneider", "Kontaktör 25A", 4, "adet", None, None, "TRY"),
            (None, None, "ANA DAĞITIM PANOSU", 2, "adet", None, 180000, "TRY"),
            ("KND-25", "Epcos", "Kondansatör 25 kVAr", 6, "adet", None, None, "TRY"),
            (None, None, "MOTOR KONTROL PANOSU", 1, "adet", None, 95000, "TRY"),
        ])
        names = [section["section_name"] for section in audit["sections"]]
        self.assertEqual(names, ["ANA DAĞITIM PANOSU", "MOTOR KONTROL PANOSU"])
        by_code = {row["urunKodu"]: row for row in audit["rows"]}
        self.assertEqual(by_code["SLT-16A"]["section_name"], "ANA DAĞITIM PANOSU")
        self.assertEqual(by_code["KND-25"]["section_name"], "MOTOR KONTROL PANOSU")
        self.assertEqual(by_code["KND-25"]["section_quantity"], 1)
        self.assertNotIn("DAĞITIM PANOSU", [row["urunAciklamasi"] for row in audit["rows"]])


if __name__ == "__main__":
    unittest.main()
