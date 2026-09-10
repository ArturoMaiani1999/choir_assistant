"""Map written symbolic note events to MuseScore SVG note-head positions."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET


TRANSFORM = re.compile(r"matrix\([^,]+,[^,]+,[^,]+,[^,]+,([^,]+),([^\)]+)\)")
PATH_MOVE = re.compile(r"M\s*(-?[0-9.]+),\s*(-?[0-9.]+)")
PART_FILES = {"P1": "soprano", "P2": "contralto", "P3": "tenore", "P4": "basso"}


def note_positions(svg_path: Path, page: int) -> list[dict[str, float | int | str]]:
    root = ET.parse(svg_path).getroot()
    view_box = [float(value) for value in root.attrib["viewBox"].split()]
    width, height = view_box[2], view_box[3]
    positions: list[tuple[float, float]] = []
    for element in root.iter():
        if element.attrib.get("class") != "Note":
            continue
        match = TRANSFORM.fullmatch(element.attrib.get("transform", ""))
        if not match:
            match = PATH_MOVE.match(element.attrib.get("d", ""))
        if not match:
            continue
        positions.append((float(match.group(1)), float(match.group(2))))

    # Systems are separated by far more vertical space than the vocal range.
    systems: list[list[tuple[float, float]]] = []
    for position in sorted(positions, key=lambda item: item[1]):
        if not systems or position[1] - max(item[1] for item in systems[-1]) > 500:
            systems.append([position])
        else:
            systems[-1].append(position)

    return [
        {
            "page": page,
            "system_id": f"page-{page}-system-{system_index}",
            "x_percent": x / width * 100,
            "y_percent": y / height * 100,
        }
        for system_index, system in enumerate(systems, start=1)
        for x, y in sorted(system, key=lambda item: item[0])
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("score_json", type=Path)
    parser.add_argument("svg_directory", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--part", action="append", metavar="ID=BASENAME")
    args = parser.parse_args()

    score = json.loads(args.score_json.read_text(encoding="utf-8"))
    mapping: dict[str, dict[str, float | int]] = {}
    part_files = PART_FILES
    if args.part:
        part_files = dict(item.split("=", 1) for item in args.part)
    for part_id, filename in part_files.items():
        source_musicxml = args.svg_directory / f"{filename}.musicxml"
        svg_pages = sorted(args.svg_directory.glob(f"{filename}-*.svg"))
        single_page = args.svg_directory / f"{filename}.svg"
        if not svg_pages and single_page.exists():
            svg_pages = [single_page]
        if not svg_pages:
            raise FileNotFoundError(f"{part_id}: nessuna pagina SVG per {filename}")
        if any(path.stat().st_mtime_ns < source_musicxml.stat().st_mtime_ns for path in svg_pages):
            raise ValueError(f"{part_id}: SVG obsoleto rispetto al MusicXML; attendere la fine dell'export MuseScore")
        events = [
            event for event in score["events"]
            if event["part_id"] == part_id and event["kind"] == "note" and event["midi_pitch"] is not None
        ]
        events.sort(key=lambda event: (event["onset_beats"], event["id"]))
        glyphs = [
            glyph
            for page in range(1, len(svg_pages) + 1)
            for glyph in note_positions(svg_pages[page - 1], page)
        ]
        if len(events) != len(glyphs):
            raise ValueError(f"{part_id}: {len(events)} eventi ma {len(glyphs)} teste di nota")
        for previous, current in zip(glyphs, glyphs[1:]):
            if (
                previous["system_id"] == current["system_id"]
                and float(current["x_percent"]) < float(previous["x_percent"])
            ):
                raise ValueError(f"{part_id}: geometria non monotona in {current['system_id']}")
        mapping.update({event["id"]: glyph for event, glyph in zip(events, glyphs, strict=True)})

    args.output.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Mapped {len(mapping)} note glyphs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
