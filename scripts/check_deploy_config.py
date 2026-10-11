"""Reject unsafe or placeholder consumer-auth deployment configuration."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "wrangler.jsonc"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def https_origin(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlsplit(value)
    return (
        parsed.scheme == "https"
        and bool(parsed.hostname)
        and parsed.path in {"", "/"}
        and not parsed.query
        and not parsed.fragment
        and parsed.username is None
        and parsed.password is None
    )


def validate(config: dict) -> list[str]:
    errors: list[str] = []
    serialized = json.dumps(config)
    if "REPLACE_WITH_" in serialized:
        errors.append("wrangler.jsonc contiene valori REPLACE_WITH_...")
    if config.get("preview_urls") is not False:
        errors.append("preview_urls deve essere false")
    assets = config.get("assets", {})
    if assets.get("binding") != "ASSETS" or assets.get("run_worker_first") is not True:
        errors.append("ASSETS deve avere binding ASSETS e run_worker_first=true")
    variables = config.get("vars", {})
    if not https_origin(variables.get("APP_ORIGIN")):
        errors.append("APP_ORIGIN deve essere una singola origine HTTPS")
    if not https_origin(variables.get("CLERK_FRONTEND_API_ORIGIN")):
        errors.append("CLERK_FRONTEND_API_ORIGIN deve essere una singola origine HTTPS")
    if not str(variables.get("CLERK_PUBLISHABLE_KEY", "")).startswith("pk_"):
        errors.append("CLERK_PUBLISHABLE_KEY non sembra una publishable key Clerk")
    databases = config.get("d1_databases", [])
    auth_databases = [entry for entry in databases if entry.get("binding") == "AUTH_DB"]
    if len(auth_databases) != 1 or not UUID.fullmatch(str(auth_databases[0].get("database_id", ""))):
        errors.append("AUTH_DB deve indicare un solo database_id D1 UUID valido")
    return errors


def main() -> int:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    errors = validate(config)
    if errors:
        print("Configurazione deploy non valida:")
        for error in errors:
            print(f"- {error}")
        return 2
    print("Configurazione deploy autenticato valida")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
