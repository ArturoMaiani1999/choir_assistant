"""Regression tests for the static production boundary."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import build_dist


class BuildDistTest(unittest.TestCase):
    def test_piece_build_publishes_continuous_scores(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            frontend = root / "frontend"
            source = frontend / "library-assets" / "test-piece"
            destination = root / "dist"
            source.mkdir(parents=True)
            destination.mkdir()
            metadata = {
                "piece_id": "test-piece",
                "title": "Test piece",
                "score_version_id": "test-v1",
                "monodic": False,
                "parts": [{"id": "P1", "name": "Soprano"}],
                "score_pages": ["score-1.svg", "score-10.svg", "score-2.svg"],
                "part_pages": {"P1": ["part-P1-1.svg", "part-P1-10.svg", "part-P1-2.svg"]},
                "continuous_part_scores": {"P1": "part-P1-continuous-1.svg"},
            }
            audio_manifest = {
                "mixes": {"P1": {"file": "score.mp3", "files_by_speed": {}}},
                "full_mix_file": "score.mp3",
                "voice_stems": {},
            }
            (source / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
            (source / "audio-manifest.json").write_text(json.dumps(audio_manifest), encoding="utf-8")
            for name in ("score.json", "glyph-map.json", "score-1.svg", "score-2.svg", "score-10.svg",
                         "part-P1-1.svg", "part-P1-2.svg", "part-P1-10.svg",
                         "part-P1-continuous-1.svg", "score.mp3"):
                (source / name).write_text(name, encoding="utf-8")

            with mock.patch.object(build_dist, "FRONTEND", frontend):
                listing = build_dist.build_piece({
                    "id": "test-piece", "display_title": "Titolo pubblico",
                }, destination)

            bundle = json.loads(
                (destination / "library-assets" / "test-piece" / "bundle.json").read_text(encoding="utf-8")
            )
            continuous = "library-assets/test-piece/part-P1-continuous-1.svg"
            self.assertEqual(bundle["assets"]["continuous_scores"], {"P1": continuous})
            self.assertEqual(bundle["assets"]["full_score_pages"], [
                "library-assets/test-piece/score-1.svg",
                "library-assets/test-piece/score-2.svg",
                "library-assets/test-piece/score-10.svg",
            ])
            self.assertEqual(bundle["assets"]["score_pages"]["P1"], [
                "library-assets/test-piece/part-P1-1.svg",
                "library-assets/test-piece/part-P1-2.svg",
                "library-assets/test-piece/part-P1-10.svg",
            ])
            self.assertTrue((destination / continuous).is_file())
            self.assertEqual(listing["title"], "Titolo pubblico")

    def test_empty_display_title_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "repertoire.json"
            config.write_text(json.dumps({
                "pieces": [{
                    "id": "o-sacrum",
                    "display_title": "  ",
                    "publication_approved": True,
                    "rights_note": "Pubblicazione autorizzata",
                }],
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "display_title"):
                build_dist.read_allowlist(config)

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

    def test_workers_and_ui_preferences_are_fingerprinted_and_reachable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            names = build_dist.build_core_assets(destination)

            self.assertIn("ui_preferences.js", names)
            self.assertIn("recording_client.js", names)
            self.assertIn("pitch_detector_worker.js", names)
            self.assertIn("pitch_shifter_worklet.js", names)
            for generated_name in names.values():
                self.assertTrue((destination / generated_name).is_file(), generated_name)

            app = (destination / names["app.js"]).read_text(encoding="utf-8")
            worker = (destination / names["pitch_detector_worker.js"]).read_text(encoding="utf-8")
            self.assertIn(names["pitch_detector_worker.js"], app)
            self.assertIn(names["pitch_shifter_worklet.js"], app)
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

    def test_audit_allows_only_declared_api_client_routes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            client = destination / "recording_client.123.js"
            client.write_text("fetch('/api/recordings')", encoding="utf-8")
            build_dist.audit(destination)

            client.write_text("fetch('/api/admin')", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Route API non autorizzata"):
                build_dist.audit(destination)

    def test_versioned_library_assets_are_immutable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            build_dist.write_headers(destination)
            headers = (destination / "_headers").read_text(encoding="utf-8")

            self.assertIn("/library.json\n  Cache-Control: public, max-age=31536000, immutable", headers)
            self.assertIn("/library-assets/*\n  Cache-Control: public, max-age=31536000, immutable", headers)
            self.assertIn("/sign-up.html\n  Cache-Control: no-store", headers)
            app = (build_dist.FRONTEND / "app.js").read_text(encoding="utf-8")
            viewer = (build_dist.FRONTEND / "score_viewer.js").read_text(encoding="utf-8")
            self.assertIn("releaseAssetUrl(RUNTIME_CONFIG.libraryUrl)", app)
            self.assertIn("releaseAssetUrl(config.libraryUrl)", viewer)

    def test_practice_toolbar_exposes_settings_without_redundant_menu_actions(self) -> None:
        html = (build_dist.FRONTEND / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="settings" type="button" aria-label="Impostazioni"', html)
        self.assertIn('id="settings-menu-mixer"', html)
        self.assertIn('id="settings-menu-recording"', html)
        self.assertIn('id="settings-menu-basic"', html)
        self.assertIn('id="settings-menu-advanced"', html)
        self.assertNotIn("toolbar-more", html)
        self.assertNotIn('id="library"', html)
        self.assertNotIn('id="restart-practice"', html)

    def test_audio_output_choice_is_first_and_bluetooth_supports_500_ms(self) -> None:
        html = (build_dist.FRONTEND / "index.html").read_text(encoding="utf-8")

        dialog = html[html.index('id="settings-dialog"'):]
        self.assertLess(dialog.index('id="settings-audio-output-heading"'), dialog.index('id="settings-text-scale-heading"'))
        self.assertIn('id="settings-audio-output-bluetooth"', dialog)
        self.assertIn('id="settings-basic-panel"', dialog)
        self.assertIn('id="settings-advanced-panel"', dialog)
        self.assertIn('id="note-names" hidden', dialog)
        self.assertIn('id="settings-piano-roll-delay" type="range" min="0" max="600"', dialog)
        self.assertNotIn('settings-display-pitch-algorithm', dialog)
        self.assertNotIn('Come mostrare la tua intonazione', dialog)
        self.assertIn('id="settings-v1-plume-advance" type="range" min="0" max="600"', dialog)
        score_appearance = (build_dist.FRONTEND / "score_appearance.js").read_text(encoding="utf-8")
        self.assertIn("basicPanel.appendChild(section)", score_appearance)

    def test_piece_picker_uses_compact_mode_and_section_labels(self) -> None:
        html = (build_dist.FRONTEND / "index.html").read_text(encoding="utf-8")

        self.assertIn('aria-label="La tua sezione"', html)
        self.assertIn('id="library-voice-lab"', html)
        self.assertNotIn("Personalizza il nome", html)
        self.assertNotIn("La parte selezionata viene usata solo", html)
        self.assertNotIn("Note, intervalli e controllo vocale", html)
        self.assertNotIn("La tua parte, piano roll e ascolto della voce", html)

    def test_score_viewer_is_isolated_from_pitch_and_microphone_runtime(self) -> None:
        html = (build_dist.FRONTEND / "score-viewer.html").read_text(encoding="utf-8")
        javascript = (build_dist.FRONTEND / "score_viewer.js").read_text(encoding="utf-8")

        self.assertIn("score_viewer.js", html)
        self.assertIn('id="viewer-audio"', html)
        self.assertIn("media_mixer.js", html)
        for label in ("Carta", "Grigio chiaro", "Bianco"):
            self.assertIn(label, html)
        for forbidden_markup in ("<canvas", "pitch-lane", "microphone"):
            self.assertNotIn(forbidden_markup, html.lower())
        for forbidden_runtime in (
            "getUserMedia", "mediaDevices", "AudioContext", "pitch_detector",
            "pitch_shared", "fluid_pitch_trail", "vocal_feedback", "app.js",
        ):
            self.assertNotIn(forbidden_runtime, html + javascript)
        self.assertIn("applyMix({ resume:false })", javascript)
        self.assertIn("event.code === 'Space'", javascript)


if __name__ == "__main__":
    unittest.main()
