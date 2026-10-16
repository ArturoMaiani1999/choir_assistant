import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("check_deploy_config.py")
SPEC = importlib.util.spec_from_file_location("check_deploy_config", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def valid_config() -> dict:
    return {
        "workers_dev": False,
        "preview_urls": False,
        "routes": [{"pattern": "choir.example.org", "custom_domain": True}],
        "assets": {"binding": "ASSETS", "run_worker_first": True},
        "vars": {
            "APP_ORIGIN": "https://choir.example.org",
            "CLERK_FRONTEND_API_ORIGIN": "https://clerk.choir.example.org",
            "CLERK_PUBLISHABLE_KEY": "pk_live_example",
        },
        "d1_databases": [{
            "binding": "AUTH_DB",
            "database_id": "12345678-1234-4123-8123-123456789abc",
        }],
        "r2_buckets": [{
            "binding": "PERFORMANCE_BUCKET",
            "bucket_name": "choir-performances",
        }],
        "triggers": {"crons": ["17 3 * * *"]},
    }


class DeployConfigTests(unittest.TestCase):
    def test_accepts_complete_fail_closed_configuration(self) -> None:
        self.assertEqual(MODULE.validate(valid_config()), [])

    def test_rejects_placeholders_and_asset_bypass(self) -> None:
        config = valid_config()
        config["vars"]["APP_ORIGIN"] = "https://REPLACE_WITH_HOST"
        config["assets"]["run_worker_first"] = False
        errors = MODULE.validate(config)
        self.assertTrue(any("REPLACE_WITH" in error for error in errors))
        self.assertTrue(any("run_worker_first" in error for error in errors))

    def test_rejects_non_https_and_non_uuid_bindings(self) -> None:
        config = valid_config()
        config["vars"]["APP_ORIGIN"] = "http://choir.example.org/path"
        config["d1_databases"][0]["database_id"] = "not-an-id"
        errors = MODULE.validate(config)
        self.assertTrue(any("APP_ORIGIN" in error for error in errors))
        self.assertTrue(any("UUID" in error for error in errors))

    def test_rejects_workers_dev_and_noncanonical_routes(self) -> None:
        config = valid_config()
        config["workers_dev"] = True
        config["routes"] = [{"pattern": "alternate.example.org", "custom_domain": True}]
        errors = MODULE.validate(config)
        self.assertTrue(any("workers_dev" in error for error in errors))
        self.assertTrue(any("custom domain" in error for error in errors))

    def test_rejects_an_extra_route_even_with_the_canonical_domain(self) -> None:
        config = valid_config()
        config["routes"].append({"pattern": "alternate.example.org", "custom_domain": True})
        errors = MODULE.validate(config)
        self.assertTrue(any("custom domain" in error for error in errors))

    def test_requires_private_performance_storage_and_cleanup_schedule(self) -> None:
        config = valid_config()
        config["r2_buckets"] = []
        config["triggers"] = {}
        errors = MODULE.validate(config)
        self.assertTrue(any("PERFORMANCE_BUCKET" in error for error in errors))
        self.assertTrue(any("crons" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
