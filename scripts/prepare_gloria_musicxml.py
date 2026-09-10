"""Create the reviewable Gloria MusicXML from the raw Audiveris hypothesis.

Every musical repair in this file is tied to visible PDF evidence.  Ambiguous
material is deliberately left unresolved and must keep the piece in
``pending_review``.
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

# (part, one-based measure, one-based note ordinal) -> corrected duration in
# MusicXML divisions.  The PDF shows conventional quarter/eighth groupings and
# no printed tuplet numbers in these locations.
FALSE_TUPLET_DURATIONS = {
    ("P2", 1, 2): 3,  # eighth
    ("P2", 1, 3): 6,  # quarter
    ("P3", 1, 4): 3,
    ("P3", 1, 5): 3,
    ("P3", 1, 6): 3,
    ("P3", 3, 2): 3,
    ("P3", 3, 3): 3,
    ("P3", 3, 4): 3,
}

# The printed SATB recitative tones in measures 9--12 use stemless whole-note
# heads as a visual convention, but each occupies one complete 6/8 bar.  Keep
# the printed ``whole`` type while giving the playback duration six eighths.
VOCAL_RECITATIVE_MEASURES = range(9, 13)

UNSUPPORTED_NOTATIONS = {
    "articulations",
    "arpeggiate",
    "dynamics",
    "fermata",
    "non-arpeggiate",
    "ornaments",
    "technical",
    "tuplet",
}


def _direction(words: str | None = None, tempo: float | None = None) -> ET.Element:
    direction = ET.Element("direction", {"placement": "above"})
    if words:
        direction_type = ET.SubElement(direction, "direction-type")
        ET.SubElement(direction_type, "words").text = words
    if tempo is not None:
        ET.SubElement(direction, "sound", {"tempo": str(tempo)})
    return direction


def _normalize_omr_noise(root: ET.Element) -> None:
    """Remove unsupported OMR expression guesses and proven false tuplets."""

    for part in root.findall("part"):
        part_id = part.get("id") or "unknown"
        for measure_index, measure in enumerate(part.findall("measure"), start=1):
            # No OMR direction in this draft has positive PDF evidence.  The
            # three verified semantic directions are inserted below on P1.
            for direction in list(measure.findall("direction")):
                measure.remove(direction)

            notes = measure.findall("note")
            divisions_node = measure.find("./attributes/divisions")
            if divisions_node is not None:
                divisions = int(divisions_node.text or "1")
            elif measure_index == 1:
                divisions = 1
            for note_ordinal, note in enumerate(notes, start=1):
                note.set("id", f"{part_id}-m{measure_index}-n{note_ordinal}")
                correction = FALSE_TUPLET_DURATIONS.get(
                    (part_id, measure_index, note_ordinal)
                )
                if correction is not None:
                    duration = note.find("duration")
                    if duration is None:
                        raise ValueError(
                            f"Missing duration for corrected note {part_id} "
                            f"measure {measure_index} note {note_ordinal}"
                        )
                    duration.text = str(correction)
                if (
                    part_id in {"P1", "P2", "P3", "P4"}
                    and measure_index in VOCAL_RECITATIVE_MEASURES
                    and note.find("rest") is None
                ):
                    duration = note.find("duration")
                    if duration is not None:
                        duration.text = str(divisions * 3)
                time_modification = note.find("time-modification")
                if time_modification is not None:
                    note.remove(time_modification)
                notations = note.find("notations")
                if notations is not None:
                    for child in list(notations):
                        if child.tag in UNSUPPORTED_NOTATIONS:
                            notations.remove(child)
                    if not list(notations):
                        note.remove(notations)


def prepare(source: Path, destination: Path) -> None:
    tree = ET.parse(source)
    root = tree.getroot()

    _normalize_omr_noise(root)

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
