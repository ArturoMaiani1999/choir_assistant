"""Validate the Muse Choir MusicXML source without invoking MuseScore."""
from xml.etree import ElementTree as ET

from build_voice_lab_assets import (CHOIR_PRESETS, SCALE_OFFSETS, exercise_score_xml, guide_phrase_xml,
                                    pad_xml, scale_phrase_xml, sustained_choir_xml)


def measures(xml: str):
    return ET.fromstring(xml).findall("./part/measure")


for role, preset in CHOIR_PRESETS.items():
    choir = measures(sustained_choir_xml(role, preset["anchors"][0]))
    assert len(choir) == 15 and all(measure.findtext("./note/duration") == "8" for measure in choir)
    assert choir[0].find('./note/tie[@type="start"]') is not None
    assert choir[-1].find('./note/tie[@type="stop"]') is not None

phrase = measures(scale_phrase_xml("tenor", 53, 120))
phrase_notes = phrase[0].findall("./note")
assert len(phrase_notes) == len(SCALE_OFFSETS)
assert [int(note.findtext("./pitch/octave")) * 12 + {"C": 0, "D": 2, "E": 4, "F": 5,
        "G": 7, "A": 9, "B": 11}[note.findtext("./pitch/step")] +
        int(note.findtext("./pitch/alter") or 0) + 12 for note in phrase_notes] == [53 + value for value in SCALE_OFFSETS]
assert phrase_notes[0].find('./notations/slur[@type="start"]') is not None
assert phrase_notes[-1].find('./notations/slur[@type="stop"]') is not None
assert phrase[1].find("./note/rest") is not None

pad = measures(pad_xml(5))
assert len(pad) == 6 and all(len(measure.findall("./note")) == 4 for measure in pad)
assert all(note.find('./tie[@type="start"]') is not None for note in pad[0].findall("./note"))
assert all(note.find('./tie[@type="stop"]') is not None for note in pad[-1].findall("./note"))

minor_pad = measures(pad_xml(5, "minor"))
minor_pad_midis = [int(note.findtext("./pitch/octave")) * 12 + {"C": 0, "D": 2, "E": 4, "F": 5,
                    "G": 7, "A": 9, "B": 11}[note.findtext("./pitch/step")] +
                    int(note.findtext("./pitch/alter") or 0) + 12 for note in minor_pad[0].findall("./note")]
assert minor_pad_midis == [41, 48, 53, 56]

arpeggio = measures(guide_phrase_xml("tenor", "triad-minor-second", 41, 80))
arpeggio_notes = arpeggio[0].findall("./note")
arpeggio_midis = [int(note.findtext("./pitch/octave")) * 12 + {"C": 0, "D": 2, "E": 4, "F": 5,
                   "G": 7, "A": 9, "B": 11}[note.findtext("./pitch/step")] +
                   int(note.findtext("./pitch/alter") or 0) + 12 for note in arpeggio_notes]
assert arpeggio_midis == [48, 53, 56, 53, 48]
assert arpeggio[0].findtext("./attributes/time/beats") == "5"

engraved = measures(exercise_score_xml("tenor", "scale-major", 54))
engraved_notes = [note for measure in engraved for note in measure.findall("./note") if note.find("./pitch") is not None]
assert len(engraved) == 3 and len(engraved_notes) == 9
assert engraved[0].findtext("./attributes/clef/clef-octave-change") == "-1"
assert engraved[0].findtext("./attributes/key/fifths") == "6"
assert engraved_notes[1].findtext("./pitch/step") == "G" and engraved_notes[1].findtext("./pitch/alter") == "1"
assert [note.findtext("./lyric/text") for note in engraved_notes] == ["1", "2", "3", "4", "5", "4", "3", "2", "1"]
assert engraved[-1].find("./note/rest") is not None

major_score = measures(exercise_score_xml("tenor", "triad-major-root", 53))
minor_score = measures(exercise_score_xml("tenor", "triad-minor-root", 53))
assert [note.findtext("./lyric/text") for measure in major_score for note in measure.findall("./note")
        if note.find("./pitch") is not None] == ["1", "3M", "5", "3M", "1"]
assert [note.findtext("./lyric/text") for measure in minor_score for note in measure.findall("./note")
        if note.find("./pitch") is not None] == ["1", "3m", "5", "3m", "1"]
print("voice_lab_assets: Muse Choir sources passed")
