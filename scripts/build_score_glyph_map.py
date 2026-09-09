"""Map written symbolic note events to MuseScore SVG note-head positions."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET


TRANSFORM = re.compile(r"matrix\([^,]+,[^,]+,[^,]+,[^,]+,([^,]+),([^\)]+)\)")
PART_FILES = {"P1": "soprano", "P2": "contralto", "P3": "tenore", "P4": "basso"}


def note_positions(svg_path: Path, page: int) -> list[dict[str, float | int]]:
    root = ET.parse(svg_path).getroot()
    view_box = [float(value) for value in root.attrib["viewBox"].split()]
    width, height = view_box[2], view_box[3]
    positions: list[tuple[float, float]] = []
    for element in root.iter():
        if element.attrib.get("class") != "Note":
            continue
        match = TRANSFORM.fullmatch(element.attrib.get("transform", ""))
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

    ordered = [position for system in systems for position in sorted(system, key=lambda item: item[0])]
    return [
        {"page": page, "x_percent": x / width * 100, "y_percent": y / height * 100}
        for x, y in ordered
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("score_json", type=Path)
    parser.add_argument("svg_directory", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    score = json.loads(args.score_json.read_text(encoding="utf-8"))
    mapping: dict[str, dict[str, float | int]] = {}
    for part_id, filename in PART_FILES.items():
        events = [
            event for event in score["events"]
            if event["part_id"] == part_id and event["kind"] == "note" and event["midi_pitch"] is not None
        ]
        events.sort(key=lambda event: (event["onset_beats"], event["id"]))
        glyphs = [
            glyph
            for page in range(1, 4)
            for glyph in note_positions(args.svg_directory / f"{filename}-{page}.svg", page)
        ]
        if len(events) != len(glyphs):
            raise ValueError(f"{part_id}: {len(events)} eventi ma {len(glyphs)} teste di nota")
        mapping.update({event["id"]: glyph for event, glyph in zip(events, glyphs, strict=True)})

    args.output.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Mapped {len(mapping)} note glyphs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
