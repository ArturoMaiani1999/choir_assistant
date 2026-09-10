"""Fingerprint the complete Ecco review bundle for hash-bound approval."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    score = ROOT / "frontend/score-assets/ecco-mvp/ecco-mvp.musicxml"
    mscz = ROOT / "data/omr-ecco/ecco-mvp.mscz"
    timeline = ROOT / "frontend/score-fixtures/ecco-mvp.json"
    geometry = ROOT / "frontend/score-assets/ecco-mvp/glyph-map.json"
    rendered = ROOT / "frontend/score-assets/ecco-mvp/full-score-1.svg"
    audio = ROOT / "frontend/audio/ecco-mvp/ecco-mvp-guide.mp3"
    audio_manifest_path = ROOT / "frontend/audio/ecco-mvp/manifest.json"
    runtime = json.loads(timeline.read_text(encoding="utf-8"))
    audio_manifest = json.loads(audio_manifest_path.read_text(encoding="utf-8"))
    hashes = {
        "review_musicxml": sha(score), "musescore": sha(mscz), "timeline": sha(timeline),
        "geometry": sha(geometry), "rendered_score": sha(rendered), "guide_audio": sha(audio),
        "audio_manifest": sha(audio_manifest_path),
    }
    fingerprint = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()
    manifest = {
        "piece_id": "ecco-quel-che-abbiamo-mvp",
        "title": "Ecco quel che abbiamo \u00b7 frase MVP",
        "scope": "Source measures 3\u201310 (first complete lyric phrase)",
        "publication_status": "pending_review",
        "review_readiness": "ready",
        "score_version_id": runtime["score_version_id"],
        "bundle_fingerprint": fingerprint,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "assets": {
            "score": "score-fixtures/ecco-mvp.json",
            "glyph_map": "score-assets/ecco-mvp/glyph-map.json",
            "audio_manifest": "audio/ecco-mvp/manifest.json",
            "audio_root": "audio/ecco-mvp",
            "score_pages": {"P1": ["score-assets/ecco-mvp/melodia-1.svg"]},
            "full_score_pages": ["score-assets/ecco-mvp/full-score-1.svg"],
        },
        "review_pairs": [{
            "label": "First phrase \u00b7 source measures 3\u201310",
            "source": "score-assets/ecco-mvp/source-measures-3-10.png",
            "rendered": "score-assets/ecco-mvp/full-score-1.svg",
        }],
        "checks": [
            {"id": "pitch", "label": "Pitch and accidentals match the PDF"},
            {"id": "rhythm", "label": "Rhythm, rests, ties, meter and bar boundaries match"},
            {"id": "lyrics", "label": "Lyrics and syllabic/melisma alignment match"},
            {"id": "render", "label": "Rendered notation is legible and faithful"},
            {"id": "audio", "label": "Guide audio matches the notation and cursor"},
        ],
        "integrity": {
            "consistent": audio_manifest["score_version_id"] == runtime["score_version_id"] and audio_manifest["timeline_hash"] == hashes["timeline"],
            "hashes": hashes,
            "event_count": len(runtime["events"]),
            "target_count": len(runtime["target_events"]),
            "lyric_attack_count": sum(event["lyric"] is not None for event in runtime["events"]),
        },
    }
    output = ROOT / "frontend/practice-piece.json"
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0 if manifest["integrity"]["consistent"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
