"""Regression checks for MuseScore exports with missing vocal sound packs."""

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from xml.etree import ElementTree as ET

from scripts.serve_frontend import _set_choir_aahs, _set_organ_fast_strings, _source_audio_has_distinct_stems


class SourceAudioStemTests(unittest.TestCase):
    def test_vocal_program_is_choir_aahs_and_organ_uses_fast_strings(self):
        with TemporaryDirectory() as directory:
            musicxml = Path(directory) / "score.musicxml"
            musicxml.write_text("""<score-partwise><part-list>
              <score-part id="P1"><score-instrument id="P1-I1"><instrument-sound>keyboard.piano.grand</instrument-sound></score-instrument>
                <midi-instrument id="P1-I1"><midi-program>1</midi-program></midi-instrument></score-part>
              <score-part id="P2"><part-name>Organ</part-name><score-instrument id="P2-I1"><instrument-sound>keyboard.organ</instrument-sound></score-instrument>
                <midi-instrument id="P2-I1"><midi-program>20</midi-program></midi-instrument></score-part>
              <score-part id="P3"><part-name>Basso</part-name><score-instrument id="P3-I1"><instrument-sound>keyboard.piano.grand</instrument-sound></score-instrument>
                <midi-instrument id="P3-I1"><midi-program>1</midi-program></midi-instrument></score-part>
              </part-list><part id="P1"/><part id="P2"/><part id="P3"/></score-partwise>""", encoding="utf-8")
            _set_choir_aahs(musicxml, {"P1", "P3"})
            _set_organ_fast_strings(musicxml)
            root = ET.parse(musicxml).getroot()
            self.assertEqual(root.findtext("./part-list/score-part[@id='P1']/midi-instrument/midi-program"), "53")
            self.assertEqual(root.findtext("./part-list/score-part[@id='P1']/score-instrument/instrument-sound"), "voice.soprano")
            self.assertEqual(root.findtext("./part-list/score-part[@id='P2']/part-name"), "Organ")
            self.assertEqual(root.findtext("./part-list/score-part[@id='P2']/midi-instrument/midi-program"), "49")
            self.assertEqual(root.findtext("./part-list/score-part[@id='P3']/score-instrument/instrument-sound"), "voice.bass")
            self.assertEqual(root.findtext("./part-list/score-part[@id='P3']/midi-instrument/midi-program"), "53")

    def test_organ_named_part_keeps_name_but_changes_timbre(self):
        with TemporaryDirectory() as directory:
            musicxml = Path(directory) / "score.musicxml"
            musicxml.write_text("""<score-partwise><part-list>
              <score-part id="P5"><part-name>Organo</part-name><score-instrument id="P5-I1"><instrument-name>Organ</instrument-name><instrument-sound>keyboard.organ</instrument-sound></score-instrument>
                <midi-instrument id="P5-I1"><midi-program>20</midi-program></midi-instrument></score-part>
              </part-list><part id="P5"/></score-partwise>""", encoding="utf-8")
            _set_organ_fast_strings(musicxml)
            root = ET.parse(musicxml).getroot()
            score_part = root.find("./part-list/score-part[@id='P5']")
            self.assertEqual(score_part.findtext("part-name"), "Organo")
            self.assertEqual(score_part.findtext("score-instrument/instrument-name"), "Strings Fast")
            self.assertEqual(score_part.findtext("score-instrument/instrument-sound"), "strings.group")
            self.assertEqual(score_part.findtext("midi-instrument/midi-program"), "49")

    def test_rejects_silent_vocals_and_organ_only_mix(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "score.mp3").write_bytes(b"organ")
            (root / "accompaniment.mp3").write_bytes(b"organ")
            (root / "voice-P1.mp3").write_bytes(b"silence")
            (root / "voice-P2.mp3").write_bytes(b"silence")
            self.assertFalse(_source_audio_has_distinct_stems(
                root, {"P1": "voice-P1.mp3", "P2": "voice-P2.mp3"}, "accompaniment.mp3"
            ))

    def test_accepts_separate_vocals_and_accompaniment(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for filename, contents in {
                "score.mp3": b"mix", "accompaniment.mp3": b"organ",
                "voice-P1.mp3": b"soprano", "voice-P2.mp3": b"alto",
            }.items():
                (root / filename).write_bytes(contents)
            self.assertTrue(_source_audio_has_distinct_stems(
                root, {"P1": "voice-P1.mp3", "P2": "voice-P2.mp3"}, "accompaniment.mp3"
            ))


if __name__ == "__main__":
    unittest.main()
