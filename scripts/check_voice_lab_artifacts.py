"""Fail when generated Voice Lab assets drift or grow beyond reviewed budgets."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "sheets" / "voice-lab"
PUBLIC = ROOT / "frontend" / "voice-lab-assets"
MANIFEST = PUBLIC / "manifest.json"

MAX_AUTHORING_BYTES = 32 * 1024 * 1024
MAX_INTERVAL_SVG_BYTES = 8 * 1024 * 1024
MAX_PUBLIC_BYTES = 10 * 1024 * 1024
ALLOWED_AUTHORING_SUFFIXES = {".musicxml", ".mscz"}


def total_bytes(files: list[Path]) -> int:
    return sum(path.stat().st_size for path in files)


def expected_pairs(low: int, high: int, distances: set[int]) -> tuple[set[tuple[int, int]], set[tuple[int, int]]]:
    melodic = {(first, second) for first in range(low, high + 1) for second in range(low, high + 1)
               if abs(second - first) in distances}
    harmonic = {tuple(sorted(pair)) for pair in melodic}
    return melodic, harmonic


def require_git_ignores() -> None:
    sentinels = [SOURCE / "intervals" / "generated.mscz", SOURCE / "notes" / "generated.musicxml"]
    result = subprocess.run(["git", "check-ignore", *map(str, sentinels)], cwd=ROOT, capture_output=True, text=True)
    if result.returncode or len(result.stdout.splitlines()) != len(sentinels):
        raise AssertionError("Le cache di authoring Voice Lab devono restare in .gitignore")
    tracked = subprocess.run(["git", "ls-files", "sheets/voice-lab/intervals", "sheets/voice-lab/notes"],
                             cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    if tracked:
        raise AssertionError(f"Artifact Voice Lab ricostruibili presenti nell'indice Git: {tracked.splitlines()[0]}")


def audit_voice_lab_artifacts(*, require_public: bool = True) -> dict[str, int]:
    if not MANIFEST.is_file():
        if require_public:
            raise AssertionError("Manifest Voice Lab assente: eseguire build_voice_lab_assets.py")
        return {}
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    interval_config = manifest.get("intervalScores", {})
    note_config = manifest.get("noteScores", {})
    low, high = int(note_config.get("lowMidi", 36)), int(note_config.get("highMidi", 84))
    distances = set(map(int, interval_config.get("distances", [])))
    melodic, harmonic = expected_pairs(low, high, distances)
    expected_intervals = len(melodic) + len(harmonic)
    expected_notes = high - low + 1

    interval_svgs = list((PUBLIC / "intervals").glob("*.svg"))
    note_svgs = list((PUBLIC / "notes").glob("*.svg"))
    if require_public and len(interval_svgs) != expected_intervals:
        raise AssertionError(f"SVG intervalli: {len(interval_svgs)}, attesi {expected_intervals}")
    if require_public and len(note_svgs) != expected_notes:
        raise AssertionError(f"SVG note: {len(note_svgs)}, attesi {expected_notes}")
    expected_names = {f"melodic-{first}-{second}-1.svg" for first, second in melodic}
    expected_names |= {f"harmonic-{first}-{second}-1.svg" for first, second in harmonic}
    if require_public and {path.name for path in interval_svgs} != expected_names:
        raise AssertionError("La banca SVG contiene coppie mancanti o inattese")

    authoring_files = [path for folder in (SOURCE / "intervals", SOURCE / "notes") if folder.is_dir()
                       for path in folder.iterdir() if path.is_file()]
    unexpected = [path for path in authoring_files if path.suffix.lower() not in ALLOWED_AUTHORING_SUFFIXES]
    if unexpected:
        raise AssertionError(f"Tipo di artifact inatteso: {unexpected[0].relative_to(ROOT)}")
    expected_authoring = 2 * (expected_intervals + expected_notes)
    if authoring_files and len(authoring_files) != expected_authoring:
        raise AssertionError(f"Artifact di authoring: {len(authoring_files)}, attesi {expected_authoring}")

    authoring_bytes, interval_svg_bytes = total_bytes(authoring_files), total_bytes(interval_svgs)
    public_files = [path for path in PUBLIC.rglob("*") if path.is_file()]
    public_bytes = total_bytes(public_files)
    if authoring_bytes > MAX_AUTHORING_BYTES:
        raise AssertionError(f"Cache authoring oltre 32 MiB: {authoring_bytes / 1024 / 1024:.2f} MiB")
    if interval_svg_bytes > MAX_INTERVAL_SVG_BYTES:
        raise AssertionError(f"SVG intervalli oltre 8 MiB: {interval_svg_bytes / 1024 / 1024:.2f} MiB")
    if public_bytes > MAX_PUBLIC_BYTES:
        raise AssertionError(f"Asset pubblici Voice Lab oltre 10 MiB: {public_bytes / 1024 / 1024:.2f} MiB")
    return {"authoringFiles": len(authoring_files), "authoringBytes": authoring_bytes,
            "intervalSvgFiles": len(interval_svgs), "intervalSvgBytes": interval_svg_bytes,
            "publicFiles": len(public_files), "publicBytes": public_bytes}


def main() -> int:
    require_git_ignores()
    report = audit_voice_lab_artifacts()
    print("Voice Lab artifact audit: " + ", ".join(f"{key}={value}" for key, value in report.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
