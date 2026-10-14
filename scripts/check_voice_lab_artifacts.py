"""Fail when the Muse Choir sample bank drifts or exceeds reviewed budgets."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "sheets" / "voice-lab"
PUBLIC = ROOT / "frontend" / "voice-lab-assets"
MANIFEST = PUBLIC / "manifest.json"

MAX_AUTHORING_BYTES = 32 * 1024 * 1024
MAX_PUBLIC_BYTES = 72 * 1024 * 1024
ALLOWED_AUTHORING_SUFFIXES = {".musicxml", ".mscz"}


def total_bytes(files: list[Path]) -> int:
    return sum(path.stat().st_size for path in files)


def require_git_ignores() -> None:
    for directory in ("choir", "phrases", "pads", "scores"):
        sentinel = SOURCE / directory / "generated.mscz"
        result = subprocess.run(["git", "check-ignore", str(sentinel)], cwd=ROOT, capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(f"La cache audio {directory} deve restare in .gitignore")
        tracked = subprocess.run(["git", "ls-files", f"sheets/voice-lab/{directory}"], cwd=ROOT,
                                 check=True, capture_output=True, text=True).stdout.strip()
        if tracked:
            raise AssertionError(f"Artifact audio ricostruibili presenti nell'indice Git: {tracked.splitlines()[0]}")


def audit_voice_lab_artifacts(*, require_public: bool = True) -> dict[str, int]:
    if not MANIFEST.is_file():
        if require_public:
            raise AssertionError("Manifest Voice Lab assente: eseguire build_voice_lab_assets.py")
        return {}
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 3:
        raise AssertionError("Il manifest Voice Lab deve usare schemaVersion 3")
    choir_config = manifest.get("choirSamples", {})
    roles = choir_config.get("roles", {})
    expected_names = {f"{role}-{midi}.flac" for role, config in roles.items() for midi in config.get("anchors", [])}
    choir_dir = PUBLIC / "choir"
    choir_samples = list(choir_dir.glob("*.flac")) if choir_dir.is_dir() else []
    if require_public and {path.name for path in choir_samples} != expected_names:
        missing = sorted(expected_names - {path.name for path in choir_samples})
        raise AssertionError(f"Banca Muse Choir incompleta o inattesa; primo mancante: {missing[0] if missing else 'nessuno'}")
    phrase_items = manifest.get("guidePhrases", {}).get("items", [])
    pad_items = manifest.get("pads", {}).get("items", [])
    phrase_dir, pad_dir = PUBLIC / "phrases", PUBLIC / "pads"
    phrase_files = list(phrase_dir.glob("*.flac")) if phrase_dir.is_dir() else []
    pad_files = list(pad_dir.glob("*.flac")) if pad_dir.is_dir() else []
    expected_phrases = {Path(item["file"]).name for item in phrase_items}
    expected_pads = {Path(item["file"]).name for item in pad_items}
    if require_public and {path.name for path in phrase_files} != expected_phrases:
        raise AssertionError("Banca frasi Muse Choir incompleta o inattesa")
    if require_public and {path.name for path in pad_files} != expected_pads:
        raise AssertionError("Banca pad Voice Lab incompleta o inattesa")
    score_items = manifest.get("scoreSvgs", {}).get("items", [])
    score_dir = PUBLIC / "scores"
    score_files = list(score_dir.glob("*.svg")) if score_dir.is_dir() else []
    expected_scores = {Path(item["file"]).name for item in score_items}
    if require_public and {path.name for path in score_files} != expected_scores:
        raise AssertionError("Banca spartiti MuseScore Voice Lab incompleta o inattesa")
    authoring_files = []
    for directory in (SOURCE / "choir", SOURCE / "phrases", SOURCE / "pads", SOURCE / "scores"):
        if directory.is_dir():
            authoring_files.extend(path for path in directory.iterdir() if path.is_file())
    unexpected = [path for path in authoring_files if path.suffix.lower() not in ALLOWED_AUTHORING_SUFFIXES]
    if unexpected:
        raise AssertionError(f"Tipo di artifact inatteso: {unexpected[0].relative_to(ROOT)}")
    expected_authoring = (len(expected_names) + len(expected_phrases) + len(expected_pads) + len(expected_scores)) * 2
    if authoring_files and len(authoring_files) != expected_authoring:
        raise AssertionError(f"Artifact audio di authoring: {len(authoring_files)}, attesi {expected_authoring}")
    public_files = choir_samples + phrase_files + pad_files + score_files + [MANIFEST]
    authoring_bytes, public_bytes = total_bytes(authoring_files), total_bytes(public_files)
    if authoring_bytes > MAX_AUTHORING_BYTES:
        raise AssertionError(f"Cache Muse Choir oltre budget: {authoring_bytes / 1024 / 1024:.2f} MiB")
    if public_bytes > MAX_PUBLIC_BYTES:
        raise AssertionError(f"Asset pubblici Voice Lab oltre budget: {public_bytes / 1024 / 1024:.2f} MiB")
    return {"authoringFiles": len(authoring_files), "authoringBytes": authoring_bytes,
            "choirFiles": len(choir_samples), "phraseFiles": len(phrase_files),
            "padFiles": len(pad_files), "scoreFiles": len(score_files), "publicBytes": public_bytes}


def main() -> int:
    require_git_ignores(); report = audit_voice_lab_artifacts()
    print("Voice Lab artifact audit: " + ", ".join(f"{key}={value}" for key, value in report.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
