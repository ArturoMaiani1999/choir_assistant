"""Filesystem persistence for ingestion jobs."""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class JobStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def create(self, source: Path, piece_id: str, capabilities: dict[str, Any]) -> dict[str, Any]:
        source = source.resolve()
        if not source.is_file():
            raise FileNotFoundError(source)
        if source.suffix.lower() != ".pdf":
            raise ValueError("Only PDF score input is supported in this stage")

        job_id = f"ing-{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid4().hex[:8]}"
        job_dir = self.root / "ingestions" / job_id
        (job_dir / "input").mkdir(parents=True, exist_ok=False)
        (job_dir / "reports").mkdir()
        (job_dir / "audit").mkdir()

        copied_source = job_dir / "input" / source.name
        shutil.copy2(source, copied_source)
        source_hash = sha256_file(copied_source)

        audiveris_available = capabilities.get("omr", {}).get("available", False)
        status = "preflight_complete" if audiveris_available else "blocked_capability"
        manifest: dict[str, Any] = {
            "job_id": job_id,
            "piece_id": piece_id,
            "status": status,
            "created_at": utc_now(),
            "source": {
                "filename": source.name,
                "original_path": str(source),
                "stored_path": str(copied_source),
                "sha256": source_hash,
            },
            "capabilities": capabilities,
            "artifacts": [
                {
                    "kind": "source_pdf",
                    "path": str(copied_source),
                    "sha256": source_hash,
                }
            ],
            "attempts": [],
            "quality": {
                "errors": 0 if audiveris_available else 1,
                "warnings": [],
                "requires_human_review": True,
            },
            "next_action": (
                "run_omr"
                if audiveris_available
                else "install_or_configure_audiveris_then_retry"
            ),
        }
        self.write_manifest(job_dir, manifest)
        self.append_event(job_dir, {"event": "job_created", "status": status})
        return manifest

    def job_dir(self, job_id: str) -> Path:
        if not job_id or Path(job_id).name != job_id:
            raise ValueError("Invalid job id")
        path = self.root / "ingestions" / job_id
        if not path.is_dir():
            raise FileNotFoundError(job_id)
        return path

    def update(self, job_id: str, **changes: Any) -> dict[str, Any]:
        job_dir = self.job_dir(job_id)
        manifest = self.get(job_id)
        manifest.update(changes, updated_at=utc_now())
        self.write_manifest(job_dir, manifest)
        return manifest

    @staticmethod
    def write_manifest(job_dir: Path, manifest: dict[str, Any]) -> None:
        (job_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    @staticmethod
    def append_event(job_dir: Path, event: dict[str, Any]) -> None:
        record = {"timestamp": utc_now(), **event}
        with (job_dir / "audit" / "events.ndjson").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")

    def get(self, job_id: str) -> dict[str, Any]:
        path = self.job_dir(job_id) / "manifest.json"
        if not path.is_file():
            raise FileNotFoundError(job_id)
        return json.loads(path.read_text(encoding="utf-8"))
