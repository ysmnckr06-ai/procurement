import unittest

from app.parsers.consistency import check_item_consistency


def row(code, name):
    return {"product_code": code, "product_name": name}


class ItemConsistencyTests(unittest.TestCase):
    def test_clean_list_has_no_warnings(self):
        result = check_item_consistency([
            row("A16", "Otomatik Sigorta 1x16A"),
            row("A25", "Otomatik Sigorta 1x25A"),
            row("A16", "Otomatik sigorta 1X16 A"),  # aynı ürün, yazım farkı
        ])
        self.assertEqual(result["warnings"], [])

    def test_same_code_different_description(self):
        result = check_item_consistency([
            row("YN-100", "Pamuk iplik 30/1 beyaz"),
            row("YN-100", "Örgü iğnesi 4 mm"),
        ])
        self.assertEqual(len(result["same_code_different_name"]), 1)
        self.assertIn("Aynı kod farklı açıklamayla", result["warnings"][0])
        self.assertIn("YN-100", result["warnings"][0])

    def test_same_description_different_code(self):
        result = check_item_consistency([
            row("KNT-25", "Kontaktör 25A 220V 3P"),
            row("KNT25A", "Kontaktör 25A 220V 3P"),
            row("KNT-2S", "kontaktör 25a 220v 3p"),
        ])
        self.assertEqual(len(result["same_name_different_code"]), 1)
        self.assertEqual(result["same_name_different_code"][0]["codes"], ["KNT-25", "KNT25A", "KNT-2S"])
        self.assertIn("Aynı açıklama farklı kodlarla", result["warnings"][0])

    def test_codeless_items_listed(self):
        result = check_item_consistency([
            row("KODSUZ-0001", "Kablo kanalı 40x60"),
            row("", "Montaj vidası"),
            row("X1", "Ray klemens"),
        ])
        self.assertEqual(result["codeless_count"], 2)
        self.assertIn("Kodu olmayan 2 kalem", result["warnings"][0])

    def test_long_lists_are_truncated(self):
        rows = [row(f"C{i}", f"Ürün {i}") for i in range(8)] + [row(f"C{i}", f"Başka bir malzeme türü {i}") for i in range(8)]
        result = check_item_consistency(rows)
        self.assertIn("ve 3 kalem daha", result["warnings"][0])


if __name__ == "__main__":
    unittest.main()
