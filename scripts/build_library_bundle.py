"""Generate browser derivatives for one reviewed MuseScore source."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from serve_frontend import LIBRARY_ASSETS_ROOT, _build_library_piece, _library_sources, _piece_id


def build_piece(piece_id: str) -> Path:
    source = next((path for path in _library_sources() if _piece_id(path.parent.name) == piece_id), None)
    if source is None:
        available = ", ".join(_piece_id(path.parent.name) for path in _library_sources())
        raise ValueError(f"Brano {piece_id!r} non trovato. Disponibili: {available}")

    metadata = _build_library_piece(source)
    destination = LIBRARY_ASSETS_ROOT / piece_id
    score_path = destination / "score.json"
    timeline_hash = hashlib.sha256(score_path.read_bytes()).hexdigest()
    part_ids = (["mono-soprano", "mono-contralto", "mono-tenore", "mono-basso"]
                if metadata["monodic"] else [part["id"] for part in metadata["parts"]])
    (destination / "glyph-map.json").write_text("{}", encoding="utf-8")
    (destination / "audio-manifest.json").write_text(json.dumps({
        "score_version_id": metadata["score_version_id"],
        "timeline_hash": timeline_hash,
        "mixes": {part_id: {"file": "score.mp3", "files_by_speed": {}} for part_id in part_ids},
        "full_mix_file": "score.mp3",
        "accompaniment_file": metadata.get("accompaniment_file"),
        "voice_stems": metadata.get("voice_stems", {}),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("piece_id", help="ID della cartella sotto sheets/, per esempio ave-verum")
    args = parser.parse_args()
    destination = build_piece(args.piece_id)
    metadata = json.loads((destination / "metadata.json").read_text(encoding="utf-8"))
    print(f"Bundle locale pronto: {metadata['title']} -> {destination}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"Bundle non generato: {error}")
        raise SystemExit(2) from None
