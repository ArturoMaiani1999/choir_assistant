import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("check_access_deploy_config.py")
SPEC = importlib.util.spec_from_file_location("check_access_deploy_config", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def valid_config() -> dict:
    return {
        "name": "choir-assistant",
        "workers_dev": True,
        "preview_urls": False,
        "assets": {"directory": "./dist", "not_found_handling": "none"},
    }


class AccessDeployConfigTests(unittest.TestCase):
    def test_accepts_the_existing_access_worker(self) -> None:
        self.assertEqual(MODULE.validate(valid_config()), [])

    def test_rejects_preview_routes_and_runtime_bindings(self) -> None:
        config = valid_config()
        config["preview_urls"] = True
        config["routes"] = ["public.example.org/*"]
        config["d1_databases"] = []
        errors = MODULE.validate(config)
        self.assertTrue(any("preview_urls" in error for error in errors))
        self.assertTrue(any("route" in error for error in errors))
        self.assertTrue(any("binding" in error for error in errors))

    def test_rejects_a_worker_entrypoint_or_wrong_name(self) -> None:
        config = valid_config()
        config["name"] = "choir-assistant-auth-staging"
        config["main"] = "./src/worker.ts"
        errors = MODULE.validate(config)
        self.assertTrue(any("name" in error for error in errors))
        self.assertTrue(any("main" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
