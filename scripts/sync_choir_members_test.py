import csv
import importlib.util
import tempfile
import unittest
import sys
from pathlib import Path

SCRIPT = Path(__file__).with_name("sync_choir_members.py")
SPEC = importlib.util.spec_from_file_location("sync_choir_members", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class ChoirMemberSyncTests(unittest.TestCase):
    def write_csv(self, rows: list[dict[str, str]]) -> Path:
        handle = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="", suffix=".csv", delete=False)
        with handle:
            writer = csv.DictWriter(handle, fieldnames=["email", "display_name", "groups", "roles", "view_groups"])
            writer.writeheader(); writer.writerows(rows)
        self.addCleanup(Path(handle.name).unlink, missing_ok=True)
        return Path(handle.name)

    def test_sql_contains_digest_but_not_email(self) -> None:
        secret = "test-only-secret-with-at-least-32-characters"
        records = [MODULE.MemberRecord("mario@example.org", "Mario", ("Tenori",), ("section_viewer",), ("Tenori",))]
        sql = MODULE.sql_for(records, secret, False)
        self.assertIn(MODULE.email_digest(records[0].email, secret), sql)
        self.assertNotIn(records[0].email, sql)
        self.assertIn("performance_view_grants", sql)
        self.assertIn("group_memberships", sql)
        self.assertNotIn("BEGIN", sql.upper())
        self.assertNotIn("COMMIT", sql.upper())
        self.assertNotIn("SAVEPOINT", sql.upper())

    def test_roles_and_multigroup_values_are_validated(self) -> None:
        path = self.write_csv([{
            "email": "mario@example.org", "display_name": "Mario", "groups": "Tenori; Solisti",
            "roles": "section_viewer", "view_groups": "Tenori|Bassi",
        }])
        record = MODULE.read_records(path)[0]
        self.assertEqual(record.groups, ("Tenori", "Solisti"))
        self.assertEqual(record.view_groups, ("Tenori", "Bassi"))

    def test_view_groups_require_a_viewing_role(self) -> None:
        path = self.write_csv([{
            "email": "mario@example.org", "display_name": "Mario", "groups": "Tenori",
            "roles": "singer", "view_groups": "Tenori",
        }])
        with self.assertRaisesRegex(ValueError, "view_groups"):
            MODULE.read_records(path)

    def test_replace_requires_exact_confirmation(self) -> None:
        with self.assertRaisesRegex(ValueError, "confirm-replace-count"):
            MODULE.validate_replace(True, False, 12, 11)
        MODULE.validate_replace(True, False, 12, 12)


if __name__ == "__main__":
    unittest.main()

