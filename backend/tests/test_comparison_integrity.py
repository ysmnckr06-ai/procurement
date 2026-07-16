import tempfile
import unittest
import zipfile
from pathlib import Path
import sys

import pandas as pd
from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.parsers.request_parser import parse_request_excel
from app.parsers.excel_parser import parse_excel_with_audit
from app.services.analyzer import analyze_groups, calculate_delay_penalty, calculate_finance_advantage
from app.services.matcher import match_offers_to_requests, rows_match
from app.services.report_builder import build_excel_report
from app.utils import extract_days


class ComparisonIntegrityTests(unittest.TestCase):
    def test_corvian_request_export_uses_real_table_header(self):
        rows = [
            ["ABCD LTD.", None, "SATINALMA TALEP LİSTESİ", None, None],
            [None, None, "Akıllı Satınalma", None, None],
            ["KULLANICI FİRMASI", None, "TOPLAM KALEM", "TOPLAM ADET", None],
            ["ABCD LTD.", None, 2, 538, None],
            [None, None, "Ürün kalemi", "Talep edilen adet", None],
            [None, None, None, None, None],
            ["SIRA", "ÜRÜN KODU", "ÜRÜN AÇIKLAMASI", "MEVCUT STOK", "TALEP EDİLEN ADET", "BİRİM"],
            [1, "2CDS211001R0164", "SH 201-C 16", 30, 400, "adet"],
            [2, "2CDS211001R0064", "SH 201-C 6", 30, 2, "adet"],
        ]

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "request.xlsx"
            pd.DataFrame(rows).to_excel(path, header=False, index=False)
            parsed = parse_request_excel(path, path.name)

        self.assertEqual([row["urunKodu"] for row in parsed], ["2CDS211001R0164", "2CDS211001R0064"])
        self.assertEqual([row["talepEdilenAdet"] for row in parsed], [400.0, 2.0])

    def test_different_real_product_codes_never_merge_by_similar_description(self):
        c6 = {"urunKodu": "2CDS211001R0064", "urunAciklamasi": "SH 201-C 6", "birim": "adet"}
        c16 = {"urunKodu": "2CDS211001R0164", "urunAciklamasi": "SH 201-C 16", "birim": "adet"}
        self.assertFalse(rows_match(c6, c16))

    def test_code_less_exact_descriptions_match_with_unit_aliases(self):
        request = {"urunKodu": "kutu36lı", "urunAciklamasi": "36LI SİGORTA KUTUSU", "birim": "adet"}
        offer = {"urunKodu": "", "urunAciklamasi": "36LI SİGORTA KUTUSU", "birim": "AD"}
        self.assertTrue(rows_match(request, offer))

    def test_each_request_keeps_only_its_exact_code_offers(self):
        requests = [
            {"urunKodu": "2CDS211001R0164", "urunAciklamasi": "SH 201-C 16", "birim": "adet", "talepEdilenAdet": 400},
            {"urunKodu": "2CDS211001R0064", "urunAciklamasi": "SH 201-C 6", "birim": "adet", "talepEdilenAdet": 2},
        ]
        offers = []
        for supplier in ("BKC", "Göktürk"):
            offers.extend([
                {"firma": supplier, "urunKodu": "2CDS211001R0164", "urunAciklamasi": "SH 201-C 16", "birim": "adet", "firmaAdedi": 400},
                {"firma": supplier, "urunKodu": "2CDS211001R0064", "urunAciklamasi": "SH 201-C 6", "birim": "adet", "firmaAdedi": 2},
            ])

        groups = match_offers_to_requests(offers, requests)
        self.assertEqual([[offer["urunKodu"] for offer in group["offers"]] for group in groups], [
            ["2CDS211001R0164", "2CDS211001R0164"],
            ["2CDS211001R0064", "2CDS211001R0064"],
        ])

    def test_delivery_terms_use_days_and_do_not_treat_stock_quantity_as_days(self):
        self.assertEqual(extract_days("3-4 hafta"), 28)
        self.assertEqual(extract_days("1-2 hafta"), 14)
        self.assertEqual(extract_days("2-3 gün"), 3)
        self.assertEqual(extract_days("TESLİM SÜRESİ 15 İŞ GÜNÜ"), 15)
        self.assertEqual(extract_days("200 ad. Stok"), 0)
        self.assertEqual(extract_days("ÖDEME 90 VADE"), 90)

    def test_equal_price_offer_with_known_delivery_beats_missing_delivery(self):
        request = {"urunKodu": "DB7-125", "urunAciklamasi": "Dağıtım barası", "birim": "adet", "talepEdilenAdet": 8}
        offers = [
            {
                "firma": "Teslim Belirsiz",
                "urunKodu": "DB7-125",
                "urunAciklamasi": "Dağıtım barası",
                "birim": "adet",
                "firmaAdedi": 8,
                "netBirimFiyat": 2,
                "netToplam": 16,
                "paraBirimi": "TRY",
                "vade": "90 gün",
                "termin": "",
            },
            {
                "firma": "Teslim Belirli",
                "urunKodu": "DB7-125",
                "urunAciklamasi": "Dağıtım barası",
                "birim": "adet",
                "firmaAdedi": 8,
                "netBirimFiyat": 2,
                "netToplam": 16,
                "paraBirimi": "TRY",
                "vade": "90 gün",
                "termin": "15 iş günü",
            },
        ]
        groups = match_offers_to_requests(offers, [request])
        analyzed = analyze_groups(
            groups,
            {"TRY": 1.0},
            preferences={"price_weight": 50, "vade_weight": 20, "termin_weight": 20, "risk_weight": 10},
        )
        self.assertEqual(analyzed[0]["bestOffer"]["firma"], "Teslim Belirli")

    def test_report_contains_no_summary_sheet_or_purchase_quantity_column(self):
        request = {
            "urunKodu": "ABC-1",
            "urunAciklamasi": "Test Ürünü",
            "birim": "adet",
            "talepEdilenAdet": 5,
        }
        offer = {
            "firma": "Tedarikçi A",
            "urunKodu": "ABC-1",
            "urunAciklamasi": "Test Ürünü",
            "birim": "adet",
            "firmaAdedi": 5,
            "birimFiyat": 10,
            "netBirimFiyat": 10,
            "netToplam": 50,
            "paraBirimi": "TRY",
        }
        groups = match_offers_to_requests([offer], [request])
        analyzed = analyze_groups(
            groups,
            {"TRY": 1.0},
            preferences={"price_weight": 50, "vade_weight": 20, "termin_weight": 20, "risk_weight": 10},
        )

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "comparison.xlsx"
            build_excel_report(analyzed, path, {"company_name": "Test"})
            with zipfile.ZipFile(path) as workbook:
                workbook_xml = workbook.read("xl/workbook.xml").decode("utf-8")
                shared_strings = workbook.read("xl/sharedStrings.xml").decode("utf-8")

        self.assertNotIn("Özet", workbook_xml)
        self.assertNotIn("Ozet", workbook_xml)
        self.assertNotIn("Stoktan", shared_strings)
        self.assertIn("Kalem Bazlı Mukayese", workbook_xml)
        self.assertNotIn("Satın Alınacak", shared_strings)


    def test_excel_currency_is_read_from_cell_number_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "usd_offer.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(["S", "STOK NO", "URUN ADI", "MIKTAR", "BIRIM FIYATI", "TUTAR"])
            sheet.append([1, "ABC-1", "Test Urunu", 5, 1.5, 7.5])
            sheet["E2"].number_format = "[$$-409]#,##0.00"
            sheet["F2"].number_format = "[$$-409]#,##0.00"
            workbook.save(path)
            audit = parse_excel_with_audit(path, "USD Supplier", path.name)

        self.assertTrue(audit["rows"])
        self.assertEqual(audit["rows"][0]["paraBirimi"], "USD")

    def test_partial_offer_is_completed_by_split_allocation(self):
        request = {"urunKodu": "SINYAL", "urunAciklamasi": "Sinyal Lambasi", "birim": "adet", "talepEdilenAdet": 138}
        offers = [
            {
                "firma": "Ucuz Kismi", "urunKodu": "SINYAL", "urunAciklamasi": "Sinyal Lambasi",
                "birim": "adet", "firmaAdedi": 137, "netBirimFiyat": 0.005, "netToplam": 0.685,
                "paraBirimi": "USD", "vade": "90 gun", "termin": "15 is gunu",
            },
            {
                "firma": "Pahali Tam", "urunKodu": "SINYAL", "urunAciklamasi": "Sinyal Lambasi",
                "birim": "adet", "firmaAdedi": 138, "netBirimFiyat": 1.5, "netToplam": 207,
                "paraBirimi": "USD", "vade": "90 gun", "termin": "",
            },
        ]
        groups = match_offers_to_requests(offers, [request])
        analyzed = analyze_groups(
            groups,
            {"TRY": 1.0, "USD": 47.0},
            constraints={"missing_data_policy": "warn_only"},
        )
        result = analyzed[0]

        self.assertEqual([(item["firma"], item["quantity"]) for item in result["recommendedAllocation"]], [
            ("Ucuz Kismi", 137.0),
            ("Pahali Tam", 1.0),
        ])
        self.assertEqual(result["uncoveredQuantity"], 0)
        self.assertGreater(result["savingsVsFullTRY"], 9000)

    def test_finance_advantage_uses_present_value(self):
        advantage = calculate_finance_advantage(7302.10, 75, 45)
        self.assertAlmostEqual(advantage, 536.75, places=2)

    def test_delay_cost_only_applies_after_company_target(self):
        self.assertEqual(calculate_delay_penalty(15, 15, 100), 0)
        self.assertEqual(calculate_delay_penalty(20, 15, 100), 500)


if __name__ == "__main__":
    unittest.main()
