import csv
import importlib.util
import tempfile
import unittest
import sys
from unittest import mock
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
            writer = csv.DictWriter(handle, fieldnames=["email", "display_name", "voice_part", "groups", "roles", "view_groups"])
            writer.writeheader(); writer.writerows(rows)
        self.addCleanup(Path(handle.name).unlink, missing_ok=True)
        return Path(handle.name)

    def test_sql_contains_digest_but_not_email(self) -> None:
        secret = "test-only-secret-with-at-least-32-characters"
        records = [MODULE.MemberRecord("mario@example.org", "Mario", "tenore", ("Tenori",), ("section_viewer",), ("Tenori",))]
        sql = MODULE.sql_for(records, secret, False)
        self.assertIn(MODULE.email_digest(records[0].email, secret), sql)
        self.assertNotIn(records[0].email, sql)
        self.assertIn("performance_view_grants", sql)
        self.assertIn("group_memberships", sql)
        self.assertIn("profile_completed_at IS NULL", sql)
        self.assertNotIn("BEGIN", sql.upper())
        self.assertNotIn("COMMIT", sql.upper())
        self.assertNotIn("SAVEPOINT", sql.upper())

    def test_roles_and_multigroup_values_are_validated(self) -> None:
        path = self.write_csv([{
            "email": "mario@example.org", "display_name": "Mario", "voice_part": "Tenore", "groups": "Tenori; Solisti",
            "roles": "section_viewer", "view_groups": "Tenori|Bassi",
        }])
        record = MODULE.read_records(path)[0]
        self.assertEqual(record.groups, ("Tenori", "Solisti"))
        self.assertEqual(record.view_groups, ("Tenori", "Bassi"))
        self.assertEqual(record.voice_part, "tenore")

    def test_view_groups_require_a_viewing_role(self) -> None:
        path = self.write_csv([{
            "email": "mario@example.org", "display_name": "Mario", "voice_part": "Tenore", "groups": "Tenori",
            "roles": "singer", "view_groups": "Tenori",
        }])
        with self.assertRaisesRegex(ValueError, "view_groups"):
            MODULE.read_records(path)

    def test_replace_requires_exact_confirmation(self) -> None:
        with self.assertRaisesRegex(ValueError, "confirm-replace-count"):
            MODULE.validate_replace(True, False, 12, 11)
        MODULE.validate_replace(True, False, 12, 12)

    def test_hmac_secret_is_not_inherited_by_wrangler(self) -> None:
        path = self.write_csv([{
            "email": "mario@example.org", "display_name": "Mario Rossi", "voice_part": "Tenore",
            "groups": "Tenori", "roles": "singer", "view_groups": "",
        }])
        secret = "test-only-secret-with-at-least-32-characters"
        with mock.patch.dict(MODULE.os.environ, {MODULE.SECRET_ENV: secret}), \
             mock.patch.object(MODULE.shutil, "which", return_value="npx"), \
             mock.patch.object(MODULE.subprocess, "run") as run:
            with mock.patch.object(sys, "argv", ["sync_choir_members.py", str(path)]):
                self.assertEqual(MODULE.main(), 0)
        self.assertNotIn(MODULE.SECRET_ENV, run.call_args.kwargs["env"])


if __name__ == "__main__":
    unittest.main()

