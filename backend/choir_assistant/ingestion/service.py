"""Capability discovery and first ingestion-stage application service."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from .job_store import JobStore


def _executable_info(path: str | None) -> dict[str, Any]:
    if not path:
        return {"available": False, "path": None, "version": None}
    return {"available": True, "path": path, "version": None}


def discover_capabilities() -> dict[str, Any]:
    """Discover tools without installing or silently substituting them."""

    musescore = shutil.which("MuseScore4") or shutil.which("musescore4")
    if not musescore and os.name == "nt":
        candidate = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "MuseScore 4" / "bin" / "MuseScore4.exe"
        if candidate.is_file():
            musescore = str(candidate)

    audiveris = shutil.which("audiveris") or shutil.which("audiveris.bat")
    java = shutil.which("java")
    ffmpeg = shutil.which("ffmpeg")
    return {
        "musescore": _executable_info(musescore),
        "omr": {"adapter": "audiveris", **_executable_info(audiveris)},
        "java": _executable_info(java),
        "ffmpeg": _executable_info(ffmpeg),
    }


def submit_ingestion(source: Path, piece_id: str, data_root: Path) -> dict[str, Any]:
    store = JobStore(data_root)
    return store.create(source, piece_id, discover_capabilities())
