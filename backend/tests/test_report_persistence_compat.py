import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main


class ReportPersistenceCompatibilityTests(unittest.TestCase):
    @patch.object(main.requests, "post")
    def test_retries_without_optional_columns_when_migration_is_pending(self, post):
        missing_column = Mock(
            status_code=400,
            text=(
                "Could not find the 'source_request_department' column "
                "of 'reports' in the schema cache"
            ),
        )
        saved = Mock(status_code=201, text="")
        post.side_effect = [missing_column, saved]

        report = {
            "id": "report-id",
            "user_id": "user-id",
            "items": [{"sourceRequestId": "request-id"}],
            "report_storage_bucket": "request-reports",
            "report_storage_path": "user-id/comparison/report.xlsx",
            "source_request_id": "request-id",
            "source_request_number": "TLB-00001",
            "source_request_title": "Test talebi",
            "source_request_owner": "Test Kullanici",
            "source_request_department": "Satinalma",
        }

        with patch.object(main, "SUPABASE_URL", "https://example.supabase.co"), patch.object(
            main, "SUPABASE_SERVICE_ROLE_KEY", "service-key"
        ):
            self.assertTrue(main.save_report_to_supabase(report))

        retried_report = post.call_args_list[1].kwargs["json"]
        self.assertEqual(retried_report["items"], report["items"])
        self.assertTrue(main.OPTIONAL_REPORT_COLUMNS.isdisjoint(retried_report))

    @patch.object(main.requests, "post")
    def test_does_not_retry_unrelated_database_errors(self, post):
        post.return_value = Mock(status_code=400, text="invalid input syntax for type uuid")

        with patch.object(main, "SUPABASE_URL", "https://example.supabase.co"), patch.object(
            main, "SUPABASE_SERVICE_ROLE_KEY", "service-key"
        ):
            self.assertFalse(main.save_report_to_supabase({"id": "not-a-uuid"}))

        post.assert_called_once()


if __name__ == "__main__":
    unittest.main()
