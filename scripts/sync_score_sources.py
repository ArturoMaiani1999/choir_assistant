"""Synchronize repertoire MusicXML sidecars from their canonical MSCZ files."""

from __future__ import annotations

import argparse

from serve_frontend import (
    _library_sources,
    _piece_id,
    _sync_musicxml_from_mscz,
)


def selected_sources(piece_id: str | None):
    sources = _library_sources()
    if piece_id is None:
        return sources
    matches = [source for source in sources if _piece_id(source.parent.name) == piece_id]
    if not matches:
        available = ", ".join(_piece_id(source.parent.name) for source in sources)
        raise ValueError(f"Brano {piece_id!r} non trovato. Disponibili: {available}")
    return matches


def synchronize(sources, *, force: bool = False) -> int:
    changed = 0
    for source in sources:
        target, exported = _sync_musicxml_from_mscz(source, force=force)
        status = "esportato" if exported else "già aggiornato"
        print(f"{_piece_id(source.parent.name)}: {target.name} {status}", flush=True)
        changed += int(exported)
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("piece_id", nargs="?", help="ID del brano; omesso significa tutto il repertorio")
    parser.add_argument("--force", action="store_true", help="riesporta anche sorgenti già sincronizzate")
    args = parser.parse_args()
    sources = selected_sources(args.piece_id)
    synchronize(sources, force=args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
