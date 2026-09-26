"""Turn I cieli narrano's one-beat pickup into a full 6/4 lead-in bar.

The original MuseScore source encodes only the final quarter-note of the
opening 6/4 bar.  This utility inserts a whole-rest plus quarter-rest before
that chord in every staff, so MuseScore's audio export includes five beats of
silence before the opening syllable.
"""
from __future__ import annotations

import argparse
from pathlib import Path
from tempfile import NamedTemporaryFile
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile


def rest(duration: str) -> ET.Element:
    element = ET.Element("Rest")
    ET.SubElement(element, "durationType").text = duration
    return element


def add_leadin(source: Path, destination: Path) -> None:
    with ZipFile(source) as archive:
        score_name = next(name for name in archive.namelist() if name.endswith(".mscx"))
        tree = ET.ElementTree(ET.fromstring(archive.read(score_name)))
        opening_measures = [measure for measure in tree.iter("Measure") if measure.get("len") == "1/4"]
        if len(opening_measures) != 4:
            raise RuntimeError(f"Expected four opening 1/4 measures, found {len(opening_measures)}")
        for measure in opening_measures:
            measure.attrib.pop("len")
            for child in list(measure):
                if child.tag == "irregular":
                    measure.remove(child)
            voice = measure.find("voice")
            chord = voice.find("Chord") if voice is not None else None
            if voice is None or chord is None:
                raise RuntimeError("Opening measure has no voice/chord to move after the lead-in rests")
            chord_index = list(voice).index(chord)
            voice.insert(chord_index, rest("whole"))
            voice.insert(chord_index + 1, rest("quarter"))
        with NamedTemporaryFile(delete=False, dir=destination.parent, suffix=".mscz") as temporary:
            temporary_path = Path(temporary.name)
        try:
            with ZipFile(temporary_path, "w", compression=ZIP_DEFLATED) as output:
                for entry in archive.infolist():
                    content = ET.tostring(tree.getroot(), encoding="utf-8", xml_declaration=True) if entry.filename == score_name else archive.read(entry.filename)
                    output.writestr(entry.filename, content)
            temporary_path.replace(destination)
        finally:
            temporary_path.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    add_leadin(args.source, args.destination)
