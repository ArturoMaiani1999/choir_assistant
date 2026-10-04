"""Regression tests for the static production boundary."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import build_dist


class BuildDistTest(unittest.TestCase):
    def test_placeholder_rights_note_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "repertoire.json"
            config.write_text(json.dumps({
                "pieces": [{
                    "id": "o-sacrum",
                    "publication_approved": True,
                    "rights_note": "Motivo o riferimento dell’autorizzazione",
                }],
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "segnaposto"):
                build_dist.read_allowlist(config)

    def test_worker_and_ui_preferences_are_fingerprinted_and_reachable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            names = build_dist.build_core_assets(destination)

            self.assertIn("ui_preferences.js", names)
            self.assertIn("pitch_detector_worker.js", names)
            for generated_name in names.values():
                self.assertTrue((destination / generated_name).is_file(), generated_name)

            app = (destination / names["app.js"]).read_text(encoding="utf-8")
            worker = (destination / names["pitch_detector_worker.js"]).read_text(encoding="utf-8")
            self.assertIn(names["pitch_detector_worker.js"], app)
            self.assertIn(names["pitch_detector.js"], worker)
            build_dist.audit_local_references(destination)

            (destination / names["pitch_detector_worker.js"]).unlink()
            with self.assertRaisesRegex(ValueError, "Riferimenti locali assenti"):
                build_dist.audit_local_references(destination)

    def test_score_viewer_assets_are_part_of_the_production_core(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            names = build_dist.build_core_assets(Path(directory))

            self.assertIn("score_viewer.js", names)
            self.assertIn("score_viewer.css", names)

    def test_score_viewer_is_isolated_from_pitch_and_microphone_runtime(self) -> None:
        html = (build_dist.FRONTEND / "score-viewer.html").read_text(encoding="utf-8")
        javascript = (build_dist.FRONTEND / "score_viewer.js").read_text(encoding="utf-8")

        self.assertIn("score_viewer.js", html)
        for label in ("Carta", "Grigio chiaro", "Bianco"):
            self.assertIn(label, html)
        for forbidden_markup in ("<canvas", "<audio", "pitch-lane", "microphone"):
            self.assertNotIn(forbidden_markup, html.lower())
        for forbidden_runtime in (
            "getUserMedia", "mediaDevices", "AudioContext", "pitch_detector",
            "pitch_shared", "fluid_pitch_trail", "vocal_feedback", "app.js",
        ):
            self.assertNotIn(forbidden_runtime, html + javascript)


if __name__ == "__main__":
    unittest.main()
