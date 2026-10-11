import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("sync_authorized_members.py")
SPEC = importlib.util.spec_from_file_location("sync_authorized_members", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AuthorizedMemberSyncTests(unittest.TestCase):
    def test_normalization_matches_worker_contract(self) -> None:
        self.assertEqual(MODULE.normalize_email(" SINGER＠EXAMPLE.ORG "), "singer@example.org")

    def test_generated_sql_contains_no_plaintext_email(self) -> None:
        secret = "test-only-secret-with-at-least-32-characters"
        digest = MODULE.digest_email("singer@example.org", secret)
        sql = MODULE.sql_for([digest], replace=True)
        self.assertIn(digest, sql)
        self.assertNotIn("singer@example.org", sql)
        self.assertIn("BEGIN TRANSACTION", sql)
        self.assertIn("COMMIT", sql)


if __name__ == "__main__":
    unittest.main()
