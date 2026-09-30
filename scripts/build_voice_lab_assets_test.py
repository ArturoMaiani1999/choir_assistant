"""Rhythmic shape of the MuseScore source, without generating the artifact bank."""
from xml.etree import ElementTree as ET
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from build_voice_lab_assets import compact_final_system, score_xml, sustained_choir_xml, sustained_strings_xml


def measures(xml: str):
    return ET.fromstring(xml).findall("./part/measure")


note = measures(score_xml("", [(60, 8)], leading_rest=True))
assert len(note) == 2
assert note[0].find("./note/rest") is not None
assert note[0].findtext("./note/duration") == "8"
assert note[1].find("./note/rest") is None
assert note[1].findtext("./note/duration") == "8"
assert [measure.attrib["number"] for measure in note] == ["1", "2"]

interval = measures(score_xml("", [(51, 8), (53, 8)], leading_rest=True))
assert len(interval) == 3
assert interval[0].find("./note/rest") is not None
assert [measure.findtext("./note/duration") for measure in interval] == ["8", "8", "8"]
assert all(measure.find("./note/pitch") is not None for measure in interval[1:])
assert [measure.attrib["number"] for measure in interval] == ["1", "2", "3"]

# Aural-recognition scores must not acquire a singing count-in.
ear = measures(score_xml("", [(51, 8), (53, 8)], harmonic=True))
assert len(ear) == 1 and ear[0].find("./note/rest") is None
strings_xml = ET.fromstring(score_xml("", [(48, 4)], instrument_name="Archi",
    instrument_sound="strings.group", midi_program=49, tempo=96, dynamics=72))
assert strings_xml.findtext("./part-list/score-part/score-instrument/instrument-sound") == "strings.group"
assert strings_xml.findtext("./part-list/score-part/midi-instrument/midi-program") == "49"
assert strings_xml.find("./part/measure/direction/direction-type/dynamics/mf") is not None
choir = measures(sustained_choir_xml("tenor", 56))
assert len(choir) == 15 and all(measure.findtext("./note/duration") == "8" for measure in choir)
assert choir[0].find('./note/tie[@type="start"]') is not None
assert choir[-1].find('./note/tie[@type="stop"]') is not None
strings_long = measures(sustained_strings_xml(48))
assert len(strings_long) == 15 and strings_long[0].find('./note/tie[@type="start"]') is not None
assert strings_long[-1].find('./note/tie[@type="stop"]') is not None
with TemporaryDirectory(prefix="choir-score-style-") as folder:
    archive = Path(folder) / "test.mscz"
    with ZipFile(archive, "w") as output:
        output.writestr("score_style.mss", "<lastSystemFillLimit>0.3</lastSystemFillLimit>")
        output.writestr("score.mscx", "<Score/>")
    assert compact_final_system(archive)
    assert not compact_final_system(archive), "the style patch must be idempotent"
    with ZipFile(archive) as updated:
        assert b"<lastSystemFillLimit>1</lastSystemFillLimit>" in updated.read("score_style.mss")
        assert updated.read("score.mscx") == b"<Score/>"
print("voice_lab_assets: preparatory rest and two full interval measures passed")
