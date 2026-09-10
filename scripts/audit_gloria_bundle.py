"""Validate and fingerprint the Gloria review bundle without approving it."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

EXPRESSION_TAGS = ("time-modification", "tuplet", "dynamics", "articulations", "ornaments", "technical", "arpeggiate", "fermata")
VOCAL_PARTS = ("P1", "P2", "P3", "P4")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def measure_durations(root: ET.Element, part_id: str) -> list[float]:
    part = root.find(f"./part[@id='{part_id}']")
    if part is None:
        return []
    divisions = 1
    totals: list[float] = []
    for measure in part.findall("measure"):
        value = measure.findtext("./attributes/divisions")
        if value:
            divisions = int(value)
        cursor = furthest = 0
        for child in list(measure):
            duration = int(child.findtext("duration") or 0)
            if child.tag == "backup":
                cursor -= duration
            elif child.tag == "forward":
                cursor += duration
            elif child.tag == "note" and child.find("chord") is None:
                cursor += duration
            furthest = max(furthest, cursor)
        totals.append(furthest / divisions)
    return totals


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ("raw", "musicxml", "mscz", "timeline", "glyph-map", "audio-manifest", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    raw_root = ET.parse(args.raw).getroot()
    normalized_root = ET.parse(args.musicxml).getroot()
    timeline = json.loads(args.timeline.read_text(encoding="utf-8"))
    glyph_map = json.loads(args.glyph_map.read_text(encoding="utf-8"))
    audio_manifest = json.loads(args.audio_manifest.read_text(encoding="utf-8"))

    errors: list[str] = []
    warnings: list[str] = []
    counts = {tag: len(normalized_root.findall(f".//{tag}")) for tag in EXPRESSION_TAGS}
    if any(counts.values()):
        errors.append(f"unsupported normalized notation remains: {counts}")
    for part_id in VOCAL_PARTS:
        totals = measure_durations(normalized_root, part_id)
        if len(totals) != 12 or any(abs(total - 3.0) > 1e-9 for total in totals):
            errors.append(f"{part_id} does not contain twelve complete 6/8 measures: {totals}")

    events = {event["id"]: event for event in timeline["events"]}
    written_notes = [event for event in events.values() if event["kind"] == "note"]
    missing_provenance = [event["id"] for event in timeline["target_events"] if event.get("source_event_id") not in events]
    if missing_provenance:
        errors.append(f"runtime targets without valid source provenance: {missing_provenance[:8]}")
    missing_geometry = [event["id"] for event in written_notes if event["part_id"] in VOCAL_PARTS and event["id"] not in glyph_map]
    if missing_geometry:
        errors.append(f"vocal notes without renderer geometry: {missing_geometry[:8]}")

    lyric_count = sum(event.get("lyric") is not None for event in written_notes)
    if lyric_count == 0:
        warnings.append("Raw OMR and review MusicXML contain no approved lyrics; UI labels must remain blank.")
    organ_totals = measure_durations(normalized_root, "P5")
    if any(abs(total - 3.0) > 1e-9 for total in organ_totals):
        warnings.append(f"Organ measure spans require manual correction: {organ_totals}")
    if audio_manifest.get("score_version_id") != timeline["score_version_id"]:
        warnings.append("Existing audio derives from an older score version and is quarantined.")

    render_files = sorted(args.glyph_map.parent.glob("*.svg"))
    audio_files = sorted(args.audio_manifest.parent.glob("*.mp3"))
    manifest = {
        "piece_id": "gloria-frisina",
        "publication_status": "pending_review",
        "score_version_id": timeline["score_version_id"],
        "approved_musicxml_hash": None,
        "review_musicxml_hash": sha256(args.musicxml),
        "musescore_hash": sha256(args.mscz),
        "timeline_hash": sha256(args.timeline),
        "glyph_map_hash": sha256(args.glyph_map),
        "rendered_score_hashes": {path.name: sha256(path) for path in render_files},
        "audio_score_version_id": audio_manifest.get("score_version_id"),
        "audio_stem_hashes": {path.name: sha256(path) for path in audio_files},
        "bundle_consistent": not errors and not warnings,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tool_versions": {"normalizer": "prepare_gloria_musicxml.py", "compiler": "choir_assistant.musicxml", "musescore": "4.7.4"},
        "raw_omr_tuplet_count": len(raw_root.findall(".//time-modification")),
        "normalized_expression_counts": counts,
        "written_note_count": len(written_notes),
        "geometry_note_count": len(glyph_map),
        "approved_lyric_count": lyric_count,
        "errors": errors,
        "warnings": warnings,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
