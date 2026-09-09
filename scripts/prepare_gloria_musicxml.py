"""Apply the human-known metadata missing from the Gloria OMR draft.

This does not approve or silently correct recognised notes. It only names the
five staves and restores the printed tempo/navigation text so the normalised
runtime can be exercised before editorial review.
"""

from __future__ import annotations

import argparse
import copy
from pathlib import Path
from xml.etree import ElementTree as ET


PART_NAMES = {
    "P1": "Soprano",
    "P2": "Contralto",
    "P3": "Tenore",
    "P4": "Basso",
    "P5": "Organo",
}


def _direction(words: str | None = None, tempo: float | None = None) -> ET.Element:
    direction = ET.Element("direction", {"placement": "above"})
    if words:
        direction_type = ET.SubElement(direction, "direction-type")
        ET.SubElement(direction_type, "words").text = words
    if tempo is not None:
        ET.SubElement(direction, "sound", {"tempo": str(tempo)})
    return direction


def prepare(source: Path, destination: Path) -> None:
    tree = ET.parse(source)
    root = tree.getroot()

    work = root.find("work")
    if work is None:
        work = ET.Element("work")
        root.insert(0, work)
    title = work.find("work-title")
    if title is None:
        title = ET.SubElement(work, "work-title")
    title.text = "Gloria"

    for score_part in root.findall("./part-list/score-part"):
        part_id = score_part.get("id")
        if part_id not in PART_NAMES:
            continue
        name = score_part.find("part-name")
        if name is None:
            name = ET.SubElement(score_part, "part-name")
        name.text = PART_NAMES[part_id]
        abbreviation = score_part.find("part-abbreviation")
        if abbreviation is not None:
            abbreviation.text = PART_NAMES[part_id][0]
        for instrument_name in score_part.findall("./score-instrument/instrument-name"):
            instrument_name.text = PART_NAMES[part_id]

    soprano = root.find("./part[@id='P1']")
    if soprano is None:
        raise ValueError("La parte P1 non è presente nel MusicXML")
    measures = soprano.findall("measure")
    if len(measures) < 12:
        raise ValueError("La bozza deve contenere almeno 12 battute")

    # The printed marking is dotted-quarter = 45. The internal beat unit is a
    # quarter note, therefore the canonical tempo used by the runtime is 90.
    measures[0].insert(1, _direction(tempo=90.0))
    measures[7].append(_direction(words="Fine"))
    measures[11].append(_direction(words="D.C. al Fine"))

    destination.parent.mkdir(parents=True, exist_ok=True)
    ET.indent(tree, space="  ")
    tree.write(destination, encoding="utf-8", xml_declaration=True)


def extract_vocal_parts(source: Path, destination: Path) -> None:
    """Write one valid MusicXML document for each SATB staff."""

    tree = ET.parse(source)
    root = tree.getroot()
    destination.mkdir(parents=True, exist_ok=True)
    for part_id, part_name in list(PART_NAMES.items())[:4]:
        part_root = copy.deepcopy(root)
        part_list = part_root.find("part-list")
        if part_list is None:
            raise ValueError("Il MusicXML non contiene part-list")
        for score_part in list(part_list.findall("score-part")):
            if score_part.get("id") != part_id:
                part_list.remove(score_part)
        for part in list(part_root.findall("part")):
            if part.get("id") != part_id:
                part_root.remove(part)
        part_tree = ET.ElementTree(part_root)
        ET.indent(part_tree, space="  ")
        part_tree.write(
            destination / f"{part_name.lower()}.musicxml",
            encoding="utf-8",
            xml_declaration=True,
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--parts-dir", type=Path)
    args = parser.parse_args()
    prepare(args.source, args.destination)
    if args.parts_dir:
        extract_vocal_parts(args.destination, args.parts_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
