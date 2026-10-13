"""Generate browser derivatives for one reviewed MuseScore source."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from serve_frontend import (
    LIBRARY_ASSETS_ROOT,
    _library_sources,
    _piece_id,
    _prepare_library_source,
)


def build_piece(piece_id: str) -> Path:
    source = next((path for path in _library_sources() if _piece_id(path.parent.name) == piece_id), None)
    if source is None:
        available = ", ".join(_piece_id(path.parent.name) for path in _library_sources())
        raise ValueError(f"Brano {piece_id!r} non trovato. Disponibili: {available}")

    metadata, _ = _prepare_library_source(source)
    return LIBRARY_ASSETS_ROOT / metadata["piece_id"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("piece_id", nargs="?", help="ID della cartella sotto sheets/, per esempio ave-verum")
    parser.add_argument("--all", action="store_true", help="Prepara tutti i brani del repertorio locale")
    args = parser.parse_args()
    if args.all == bool(args.piece_id):
        parser.error("specifica un piece_id oppure --all")
    piece_ids = ([_piece_id(source.parent.name) for source in _library_sources()]
                 if args.all else [args.piece_id])
    for index, piece_id in enumerate(piece_ids, start=1):
        print(f"[{index}/{len(piece_ids)}] Preparo {piece_id}...", flush=True)
        destination = build_piece(piece_id)
        metadata = json.loads((destination / "metadata.json").read_text(encoding="utf-8"))
        print(f"Bundle locale pronto: {metadata['title']} -> {destination}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"Bundle non generato: {error}")
        raise SystemExit(2) from None
