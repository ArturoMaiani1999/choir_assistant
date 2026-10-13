"""Reject an Access deployment that could target the wrong Worker or expose previews."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "wrangler.access.jsonc"


def validate(config: dict) -> list[str]:
    errors: list[str] = []
    if config.get("name") != "choir-assistant":
        errors.append("name deve essere esattamente choir-assistant")
    if config.get("workers_dev") is not True:
        errors.append("workers_dev deve essere true per il Worker protetto da Access")
    if config.get("preview_urls") is not False:
        errors.append("preview_urls deve essere false")
    if config.get("main") is not None:
        errors.append("il deploy Access deve essere statico e non deve avere main")
    if config.get("routes") not in (None, []):
        errors.append("il deploy Access non deve aggiungere route alternative")
    assets = config.get("assets", {})
    if assets.get("directory") != "./dist" or assets.get("not_found_handling") != "none":
        errors.append("assets deve pubblicare solo ./dist con not_found_handling=none")
    forbidden = {"vars", "d1_databases", "kv_namespaces", "r2_buckets"}
    present = sorted(forbidden.intersection(config))
    if present:
        errors.append(f"binding non ammessi nel deploy Access: {', '.join(present)}")
    return errors


def main() -> int:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    errors = validate(config)
    if errors:
        print("Configurazione deploy Access non valida:")
        for error in errors:
            print(f"- {error}")
        return 2
    print("Configurazione deploy Cloudflare Access valida")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
