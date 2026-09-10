"""Build the evidence-backed Ecco MVP excerpt from raw Audiveris MusicXML."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from xml.etree import ElementTree as ET


# Source measures 3--10, one-based note ordinals. None means a tied/rest event.
LYRICS = {
    3: {1: ("Ec", "begin", False), 2: ("co", "end", False), 3: ("quel", "single", False), 4: ("che", "single", False), 5: ("ab", "begin", False), 6: ("bia", "middle", True)},
    4: {2: ("mo", "end", True), 4: ("nul", "begin", False), 5: ("la", "end", False)},
    5: {1: ("ci", "single", False), 2: ("ap", "begin", False), 3: ("par", "middle", False), 4: ("tie", "middle", False), 5: ("ne", "end", False), 6: ("or", "begin", True)},
    6: {1: ("mai", "end", False), 2: ("ec", "begin", False), 3: ("co", "end", False), 4: ("i", "single", False)},
    7: {1: ("frut", "begin", False), 2: ("ti", "end", False), 3: ("del", "begin", False), 4: ("la", "end", False), 5: ("ter", "begin", True)},
    8: {2: ("ra", "end", False), 3: ("che", "single", False), 4: ("tu", "single", False)},
    9: {1: ("mol", "begin", False), 2: ("ti", "middle", False), 3: ("pli", "middle", False), 4: ("che", "middle", False), 5: ("rai", "end", True)},
}

REMOVE_NOTATIONS = {"articulations", "arpeggiate", "dynamics", "fermata", "ornaments", "technical", "tuplet"}

# One chord per selected source measure, copied from the printed lead sheet.
# Each voicing uses a pedal/root note plus a compact right-hand chord.
ORGAN_CHORDS = {
    3: ("G", "major", [("G", 2), ("B", 3), ("D", 4), ("G", 4)]),
    4: ("G", "major-seventh", [("G", 2), ("B", 3), ("D", 4), ("F", 4, 1)]),
    5: ("C", "major", [("C", 3), ("C", 4), ("E", 4), ("G", 4)]),
    6: ("G", "major", [("G", 2), ("B", 3), ("D", 4), ("G", 4)]),
    7: ("E", "minor", [("E", 2), ("B", 3), ("E", 4), ("G", 4)]),
    8: ("B", "minor", [("B", 2), ("B", 3), ("D", 4), ("F", 4, 1)]),
    9: ("C", "major", [("C", 3), ("C", 4), ("E", 4), ("G", 4)]),
    10: ("D", "dominant", [("D", 2), ("C", 4), ("D", 4), ("F", 4, 1), ("A", 4)]),
}

ROOT = Path(__file__).resolve().parents[1]
CANONICAL_LOCK = ROOT / "data/omr-ecco/admin-canonical.json"
PROTECTED_OUTPUTS = {
    (ROOT / "frontend/score-assets/ecco-mvp/ecco-mvp.musicxml").resolve(),
    (ROOT / "frontend/score-assets/ecco-mvp/melodia.musicxml").resolve(),
}


def add_lyric(note: ET.Element, text: str, syllabic: str, extend: bool) -> None:
    lyric = ET.SubElement(note, "lyric", {"number": "1"})
    ET.SubElement(lyric, "syllabic").text = syllabic
    ET.SubElement(lyric, "text").text = text
    if extend:
        ET.SubElement(lyric, "extend", {"type": "start"})


def add_pitch(note: ET.Element, pitch: tuple) -> None:
    step, octave, *alter = pitch
    pitch_element = ET.SubElement(note, "pitch")
    ET.SubElement(pitch_element, "step").text = step
    if alter:
        ET.SubElement(pitch_element, "alter").text = str(alter[0])
    ET.SubElement(pitch_element, "octave").text = str(octave)


def add_organ_measure(part: ET.Element, number: int, source_number: int, divisions: int) -> None:
    _, _, pitches = ORGAN_CHORDS[source_number]
    measure = ET.SubElement(part, "measure", {"number": str(number)})
    if number == 1:
        attributes = ET.SubElement(measure, "attributes")
        ET.SubElement(attributes, "divisions").text = str(divisions)
        key = ET.SubElement(attributes, "key")
        ET.SubElement(key, "fifths").text = "1"
        time = ET.SubElement(attributes, "time", {"symbol": "cut"})
        ET.SubElement(time, "beats").text = "2"
        ET.SubElement(time, "beat-type").text = "2"
        ET.SubElement(attributes, "staves").text = "2"
        for staff, sign, line in (("1", "G", "2"), ("2", "F", "4")):
            clef = ET.SubElement(attributes, "clef", {"number": staff})
            ET.SubElement(clef, "sign").text = sign
            ET.SubElement(clef, "line").text = line
    duration = divisions * 4
    for index, pitch in enumerate(pitches[1:]):
        note = ET.SubElement(measure, "note", {"id": f"P2-m{number}-rh{index + 1}"})
        if index:
            ET.SubElement(note, "chord")
        add_pitch(note, pitch)
        ET.SubElement(note, "duration").text = str(duration)
        ET.SubElement(note, "voice").text = "1"
        ET.SubElement(note, "type").text = "whole"
        ET.SubElement(note, "staff").text = "1"
    backup = ET.SubElement(measure, "backup")
    ET.SubElement(backup, "duration").text = str(duration)
    bass = ET.SubElement(measure, "note", {"id": f"P2-m{number}-pedal"})
    add_pitch(bass, pitches[0])
    ET.SubElement(bass, "duration").text = str(duration)
    ET.SubElement(bass, "voice").text = "2"
    ET.SubElement(bass, "type").text = "whole"
    ET.SubElement(bass, "staff").text = "2"


def prepare(
    source: Path,
    destination: Path,
    melody_destination: Path | None = None,
    *,
    force_overwrite_admin_revision: bool = False,
) -> None:
    requested_outputs = {destination.resolve()}
    if melody_destination is not None:
        requested_outputs.add(melody_destination.resolve())
    if CANONICAL_LOCK.exists() and requested_outputs & PROTECTED_OUTPUTS and not force_overwrite_admin_revision:
        lock = json.loads(CANONICAL_LOCK.read_text(encoding="utf-8"))
        raise RuntimeError(
            "Refusing to overwrite the admin-corrected canonical score "
            f"({lock.get('sha256', 'unknown hash')[:16]}). Audio/UI changes must derive from the MSCZ. "
            "Use --force-overwrite-admin-revision only for an intentional OMR reset."
        )
    raw = ET.parse(source).getroot()
    raw_part = raw.find("part")
    if raw_part is None or len(raw_part.findall("measure")) < 10:
        raise ValueError("The expected Ecco OMR measures are missing")

    root = ET.Element("score-partwise", {"version": "4.0"})
    work = ET.SubElement(root, "work")
    ET.SubElement(work, "work-title").text = "Ecco quel che abbiamo \u00b7 frase MVP"
    identification = ET.SubElement(root, "identification")
    ET.SubElement(identification, "creator", {"type": "composer"}).text = "Gen Verde"
    part_list = ET.SubElement(root, "part-list")
    score_part = ET.SubElement(part_list, "score-part", {"id": "P1"})
    ET.SubElement(score_part, "part-name").text = "Melodia"
    organ_score_part = ET.SubElement(part_list, "score-part", {"id": "P2"})
    ET.SubElement(organ_score_part, "part-name").text = "Organo"
    score_instrument = ET.SubElement(organ_score_part, "score-instrument", {"id": "P2-I1"})
    ET.SubElement(score_instrument, "instrument-name").text = "String Ensemble 1"
    ET.SubElement(score_instrument, "instrument-sound").text = "strings.group"
    midi_instrument = ET.SubElement(organ_score_part, "midi-instrument", {"id": "P2-I1"})
    ET.SubElement(midi_instrument, "midi-channel").text = "2"
    # MusicXML numbers programs from 1; General MIDI String Ensemble 1 is 49.
    ET.SubElement(midi_instrument, "midi-program").text = "49"
    part = ET.SubElement(root, "part", {"id": "P1"})
    organ = ET.Element("part", {"id": "P2"})

    source_attributes = raw_part.find("./measure/attributes")
    if source_attributes is None:
        raise ValueError("Raw score has no initial attributes")
    for output_number, source_number in enumerate(range(3, 11), start=1):
        measure = copy.deepcopy(raw_part.findall("measure")[source_number - 1])
        measure.set("number", str(output_number))
        measure.attrib.pop("width", None)
        for element in list(measure):
            if element.tag in {"attributes", "direction", "print", "harmony"}:
                measure.remove(element)
        if output_number == 1:
            attributes = copy.deepcopy(source_attributes)
            for child in list(attributes):
                if child.tag not in {"divisions", "key", "time", "clef"}:
                    attributes.remove(child)
            measure.insert(0, attributes)
            direction = ET.Element("direction", {"placement": "above"})
            ET.SubElement(direction, "sound", {"tempo": "68"})
            measure.insert(1, direction)

        chord_root, chord_kind, _ = ORGAN_CHORDS[source_number]
        harmony = ET.Element("harmony")
        harmony_root = ET.SubElement(harmony, "root")
        ET.SubElement(harmony_root, "root-step").text = chord_root
        ET.SubElement(harmony, "kind").text = chord_kind
        measure.insert(1 if output_number != 1 else 2, harmony)

        for note_ordinal, note in enumerate(measure.findall("note"), start=1):
            note.set("id", f"P1-m{output_number}-n{note_ordinal}")
            for lyric in list(note.findall("lyric")):
                note.remove(lyric)
            # The source lyric requires a new syllable on this repeated B;
            # Audiveris exported the visible curved mark as a tie. Preserve
            # the written attack/word alignment and remove only this OMR tie.
            if (source_number, note_ordinal) in {(6, 4), (7, 1)}:
                for tie in list(note.findall("tie")):
                    note.remove(tie)
                notations_for_tie = note.find("notations")
                if notations_for_tie is not None:
                    for tied in list(notations_for_tie.findall("tied")):
                        notations_for_tie.remove(tied)
            time_modification = note.find("time-modification")
            if time_modification is not None:
                note.remove(time_modification)
            notations = note.find("notations")
            if notations is not None:
                for child in list(notations):
                    if child.tag in REMOVE_NOTATIONS:
                        notations.remove(child)
                if not list(notations):
                    note.remove(notations)
            lyric_data = LYRICS.get(source_number, {}).get(note_ordinal)
            if lyric_data:
                add_lyric(note, *lyric_data)
        part.append(measure)
        divisions = int(source_attributes.findtext("divisions") or "1")
        add_organ_measure(organ, output_number, source_number, divisions)

    root.append(organ)

    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    destination.parent.mkdir(parents=True, exist_ok=True)
    tree.write(destination, encoding="utf-8", xml_declaration=True)
    if melody_destination is not None:
        melody_root = copy.deepcopy(root)
        melody_root.find("part-list").remove(melody_root.find("./part-list/score-part[@id='P2']"))
        melody_root.remove(melody_root.find("./part[@id='P2']"))
        melody_tree = ET.ElementTree(melody_root)
        ET.indent(melody_tree, space="  ")
        melody_destination.parent.mkdir(parents=True, exist_ok=True)
        melody_tree.write(melody_destination, encoding="utf-8", xml_declaration=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--melody-destination", type=Path)
    parser.add_argument("--force-overwrite-admin-revision", action="store_true")
    args = parser.parse_args()
    prepare(
        args.source,
        args.destination,
        args.melody_destination,
        force_overwrite_admin_revision=args.force_overwrite_admin_revision,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
