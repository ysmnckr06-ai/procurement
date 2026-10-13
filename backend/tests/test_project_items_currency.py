import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def project_file(rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Ürün Kodu", "Marka", "Ürün Açıklaması", "Miktar", "Birim", "Birim Fiyat", "Para Birimi"])
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


class ProjectItemsCurrencyTest(unittest.TestCase):
    """Uçtan uca testte bulunan hata: proje malzeme dosyasındaki para birimi
    sonuç satırına konmuyordu; USD/EUR fiyatlar projeye TL olarak yazılıyordu."""

    @patch.object(main, "verify_user_token", lambda *args, **kwargs: {"id": "test-user"})
    def test_row_currency_is_returned(self):
        client = TestClient(main.app)
        content = project_file([
            ("YDK-0355", "Eaton", "Yedek Parça Kalem 355", 18, "adet", 410.96, "TRY"),
            ("YDK-0231", "Entes", "Yedek Parça Kalem 231", 7, "adet", 9.78, "EUR"),
            ("SGR-63A", "ABB", "NH Sigorta 63A", 4, "adet", 3.5, "USD"),
        ])
        response = client.post(
            "/parse-project-items",
            files={"files": ("proje.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers={"Authorization": "Bearer test"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        rows = {row["product_code"]: row for row in response.json()["rows"]}
        self.assertEqual(rows["YDK-0355"]["currency"], "TRY")
        self.assertEqual(rows["YDK-0231"]["currency"], "EUR")
        self.assertEqual(rows["SGR-63A"]["currency"], "USD")
        self.assertAlmostEqual(rows["YDK-0231"]["estimated_unit_price"], 9.78)


if __name__ == "__main__":
    unittest.main()
