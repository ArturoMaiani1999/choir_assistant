import json
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).parents[3]


class GloriaAssetIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.xml = ET.parse(
            ROOT / "frontend/score-assets/gloria-frisina-draft.musicxml"
        ).getroot()
        self.runtime = json.loads(
            (ROOT / "frontend/score-fixtures/gloria-frisina-draft.json").read_text(
                encoding="utf-8"
            )
        )
        self.geometry = json.loads(
            (ROOT / "frontend/score-assets/gloria-parts/glyph-map.json").read_text(
                encoding="utf-8"
            )
        )

    def test_false_tuplets_and_expression_noise_are_absent(self) -> None:
        for tag in (
            "time-modification", "tuplet", "dynamics", "articulations",
            "ornaments", "technical", "arpeggiate", "fermata",
        ):
            self.assertEqual(len(self.xml.findall(f".//{tag}")), 0, tag)

    def test_tenor_proven_false_tuplets_are_ordinary_eighths(self) -> None:
        tenor = self.xml.find("./part[@id='P3']")
        self.assertIsNotNone(tenor)
        measures = tenor.findall("measure")
        self.assertEqual([n.findtext("duration") for n in measures[0].findall("note")], ["3"] * 6)
        self.assertEqual([n.findtext("duration") for n in measures[2].findall("note")], ["9", "3", "3", "3"])

    def test_runtime_values_and_geometry_retain_source_identity(self) -> None:
        source = {event["id"]: event for event in self.runtime["events"]}
        for target in self.runtime["target_events"]:
            event = source[target["source_event_id"]]
            self.assertEqual(target["part_id"], event["part_id"])
            self.assertEqual(target["written_measure_id"], event["measure_id"])
            self.assertEqual(target["duration_beats"], event["duration_beats"])
            self.assertEqual(target["midi_pitch"], event["midi_pitch"])
            self.assertEqual(target["lyric"], event["lyric"])
        vocal_notes = [event for event in source.values() if event["kind"] == "note" and event["part_id"] in {"P1", "P2", "P3", "P4"}]
        self.assertTrue(all(event["id"] in self.geometry for event in vocal_notes))

    def test_geometry_is_monotonic_inside_each_explicit_system(self) -> None:
        groups = {}
        for source_id, glyph in self.geometry.items():
            groups.setdefault((source_id.split("-", 1)[0], glyph["system_id"]), []).append((source_id, glyph))
        for group in groups.values():
            xs = [glyph["x_percent"] for _, glyph in group]
            self.assertEqual(xs, sorted(xs))


if __name__ == "__main__":
    unittest.main()
