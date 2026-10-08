"""Re-export every approved score and isolated channel with MuseScore 4.

The input for each voice is a one-part MusicXML, never a mixer-muted MSCZ.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from xml.etree import ElementTree as ET

from serve_frontend import (LIBRARY_ASSET_LAYOUT_VERSION, LIBRARY_ASSETS_ROOT,
                            _export_audio_stem, _musescore, _set_choir_aahs,
                            _set_organ_fast_strings)

ROOT = Path(__file__).resolve().parents[1]


def part_ids(path: Path) -> set[str]:
    return {part.get("id") for part in ET.parse(path).getroot().findall("part")}


def export_atomic(source: Path, target: Path, executable: str) -> None:
    handle, temporary_name = tempfile.mkstemp(prefix=f".{target.stem}-", suffix=".mp3", dir=target.parent)
    os.close(handle)
    temporary = Path(temporary_name)
    try:
        _export_audio_stem(source, temporary, executable)
        if temporary.stat().st_size < 1024:
            raise ValueError(f"Esportazione audio vuota: {source}")
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def regenerate(piece_id: str, executable: str, workers: int, organ_only: bool = False) -> None:
    destination = LIBRARY_ASSETS_ROOT / piece_id
    metadata_path = destination / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    voices = metadata["voice_stems"]
    voice_ids = set(voices)
    score_source = destination / "score.musicxml"
    accompaniment_source = destination / "accompaniment.musicxml"
    if not voice_ids or not voice_ids <= part_ids(score_source):
        raise ValueError(f"{piece_id}: parti vocali non presenti nello score MusicXML")
    organ_parts = [part for part in ET.parse(score_source).getroot().findall("./part-list/score-part")
                   if "organ" in (part.findtext("part-name") or "").casefold()
                   or "organo" in (part.findtext("part-name") or "").casefold()]
    if organ_only and not organ_parts:
        print(f"{piece_id}: nessuna parte d'organo", flush=True)
        return
    _set_choir_aahs(score_source, voice_ids)
    _set_organ_fast_strings(score_source)
    jobs = [(score_source, destination / "score.mp3")]
    if not organ_only:
        for voice_id, name in voices.items():
            source = destination / f"part-{voice_id}.musicxml"
            if part_ids(source) != {voice_id}:
                raise ValueError(f"{piece_id}: {source.name} non contiene soltanto {voice_id}")
            _set_choir_aahs(source, {voice_id})
            jobs.append((source, destination / name))
    accompaniment = metadata.get("accompaniment_file")
    if accompaniment:
        accompaniment_ids = part_ids(accompaniment_source)
        if not accompaniment_ids or accompaniment_ids & voice_ids:
            raise ValueError(f"{piece_id}: accompagnamento non isolato")
        _set_organ_fast_strings(accompaniment_source)
        jobs.append((accompaniment_source, destination / accompaniment))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(export_atomic, source, target, executable): target.name for source, target in jobs}
        for future in as_completed(futures):
            future.result()
            print(f"{piece_id}: {futures[future]}", flush=True)
    metadata["layout_version"] = LIBRARY_ASSET_LAYOUT_VERSION
    metadata["source_playback_sounds_preserved"] = False
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--piece", help="Solo un brano approvato, per prova o recupero")
    parser.add_argument("--organ-only", action="store_true",
                        help="Aggiorna solo mix completo e accompagnamento con Strings Fast, lasciando intatte le voci")
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.workers <= 3:
        parser.error("--workers deve essere tra 1 e 3")
    approved = [item["id"] for item in json.loads((ROOT / "deploy/repertoire.json").read_text(encoding="utf-8"))["pieces"]]
    if args.piece and args.piece not in approved:
        parser.error(f"Brano non approvato: {args.piece}")
    executable = _musescore()
    for piece_id in ([args.piece] if args.piece else approved):
        regenerate(piece_id, executable, args.workers, args.organ_only)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
