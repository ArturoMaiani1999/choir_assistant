import hashlib
import json
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).parents[3]


class EccoMvpAssetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.xml_path = ROOT / "frontend/score-assets/ecco-mvp/ecco-mvp.musicxml"
        self.timeline_path = ROOT / "frontend/score-fixtures/ecco-mvp.json"
        self.geometry_path = ROOT / "frontend/score-assets/ecco-mvp/glyph-map.json"
        self.root = ET.parse(self.xml_path).getroot()
        self.timeline = json.loads(self.timeline_path.read_text(encoding="utf-8"))
        self.geometry = json.loads(self.geometry_path.read_text(encoding="utf-8"))

    def test_excerpt_is_eight_complete_two_two_measures(self) -> None:
        measures = self.root.findall("./part[@id='P1']/measure")
        self.assertEqual(len(measures), 8)
        divisions = int(measures[0].findtext("./attributes/divisions"))
        for measure in measures:
            duration = sum(int(note.findtext("duration") or 0) for note in measure.findall("note") if note.find("chord") is None)
            self.assertEqual(duration / divisions, 4)
        self.assertEqual(self.root.findtext("./part/measure/attributes/time/beats"), "2")
        self.assertEqual(self.root.findtext("./part/measure/attributes/time/beat-type"), "2")

    def test_organ_realizes_the_printed_chords(self) -> None:
        self.assertEqual(self.root.findtext("./part-list/score-part[@id='P2']/part-name"), "Organo")
        harmonies = [measure.findtext("harmony/kind") for measure in self.root.findall("./part[@id='P1']/measure")]
        self.assertEqual(harmonies, ["major", "major-seventh", "major", "major", "minor", "minor", "major", "dominant"])
        self.assertEqual(len(self.root.findall("./part[@id='P2']/measure")), 8)
        self.assertIn("P2", {part["id"] for part in self.timeline["parts"]})

    def test_lyrics_and_geometry_derive_from_source_events(self) -> None:
        lyric_text = " ".join(event["lyric"] for event in self.timeline["events"] if event["lyric"])
        # MuseScore may join adjacent syllable tokens during an admin round-trip;
        # their textual content must remain unchanged.
        self.assertEqual(
            lyric_text.replace(" ", ""),
            "Eccoquelcheabbiamonullaciappartieneormaieccoifruttidellaterrachetumoltiplicherai",
        )
        notes = [event for event in self.timeline["events"] if event["part_id"] == "P1" and event["kind"] == "note"]
        self.assertEqual(len(notes), 36)
        self.assertTrue(all(note["id"] in self.geometry for note in notes))
        source = {event["id"]: event for event in self.timeline["events"]}
        for target in (event for event in self.timeline["target_events"] if event["part_id"] == "P1"):
            self.assertEqual(target["lyric"], source[target["source_event_id"]]["lyric"])
            self.assertEqual(target["tie_start"], source[target["source_event_id"]]["tie_start"])
            self.assertEqual(target["tie_stop"], source[target["source_event_id"]]["tie_stop"])

    def test_bundle_hashes_are_current_and_consistent(self) -> None:
        manifest = json.loads((ROOT / "frontend/practice-piece.json").read_text(encoding="utf-8"))
        audio_manifest = json.loads((ROOT / "frontend/audio/ecco-mvp/manifest.json").read_text(encoding="utf-8"))
        self.assertTrue(manifest["integrity"]["consistent"])
        self.assertEqual(audio_manifest["mixes"]["P1"]["included_parts"], ["P1", "P2"])
        self.assertEqual(audio_manifest["mixes"]["P1"]["accompaniment_program"], 48)
        self.assertGreater(audio_manifest["mixes"]["P1"]["chord_overlap_beats"], 0)
        self.assertGreater(audio_manifest["mixes"]["P1"]["chord_lead_beats"], 0)
        self.assertEqual(set(audio_manifest["mixes"]["P1"]["files_by_speed"]), {"0.5", "0.75", "1"})
        self.assertEqual(manifest["integrity"]["hashes"]["review_musicxml"], hashlib.sha256(self.xml_path.read_bytes()).hexdigest())
        self.assertEqual(manifest["integrity"]["hashes"]["timeline"], hashlib.sha256(self.timeline_path.read_bytes()).hexdigest())
        self.assertEqual(manifest["integrity"]["hashes"]["geometry"], hashlib.sha256(self.geometry_path.read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()
