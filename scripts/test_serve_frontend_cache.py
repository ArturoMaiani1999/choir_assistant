import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from scripts import serve_frontend


def _write_mscz(path: Path, *, pitch: int = 60, editor_variant: int = 1) -> None:
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.70">
  <programVersion>4.6.4</programVersion>
  <Score>
    <eid>score-{editor_variant}</eid>
    <showInvisible>{editor_variant % 2}</showInvisible>
    <showUnprintable>{editor_variant % 2}</showUnprintable>
    <showFrames>{editor_variant % 2}</showFrames>
    <showMargins>{editor_variant % 2}</showMargins>
    <open>{editor_variant}</open>
    <metaTag name="platform">win-{editor_variant}</metaTag>
    <metaTag name="sourceRevisionId">revision-{editor_variant}</metaTag>
    <Part id="1"><Staff><eid>staff-{editor_variant}</eid></Staff></Part>
    <Staff id="1"><Measure><voice><Chord><Note><pitch>{pitch}</pitch></Note></Chord></voice></Measure></Staff>
  </Score>
</museScore>
""".encode("utf-8")
    timestamp = (2025, 1, editor_variant, 12, 0, 0)
    with zipfile.ZipFile(path, "w") as archive:
        members = {
            "score.mscx": xml,
            "score_style.mss": b"<museScore><Style><spatium>1.764</spatium></Style></museScore>",
            "audiosettings.json": json.dumps({"mute": False}, indent=editor_variant).encode("utf-8"),
            "viewsettings.json": json.dumps({"zoom": editor_variant}).encode("utf-8"),
            "Thumbnails/thumbnail.png": bytes([editor_variant]) * 8,
            "META-INF/container.xml": f"<saved>{editor_variant}</saved>".encode("utf-8"),
        }
        for name, contents in members.items():
            info = zipfile.ZipInfo(name, timestamp)
            archive.writestr(info, contents)


class SourceFingerprintTests(unittest.TestCase):
    @staticmethod
    def _write_key_mode(path: Path, mode: str) -> None:
        path.write_text(
            f'<score-partwise><part><measure><attributes><key><fifths>0</fifths>'
            f'<mode>{mode}</mode></key></attributes></measure></part></score-partwise>',
            encoding="utf-8",
        )

    def test_audio_subset_preserves_settings_and_mutes_other_tracks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.mscz"
            destination = Path(directory) / "subset.mscz"
            _write_mscz(source)
            settings = {"tracks": [
                {"partId": "999", "instrumentId": "metronome", "soloMuteState": {"mute": False, "solo": False}},
                {"partId": "1", "instrumentId": "soprano", "in": {"resourceMeta": {"id": "MS Basic\\0\\52"}},
                 "soloMuteState": {"mute": False, "solo": False}},
                {"partId": "2", "instrumentId": "organ", "in": {"resourceMeta": {"id": "94"}},
                 "soloMuteState": {"mute": False, "solo": False}},
            ]}
            # Rebuild the small fixture so the archive contains one canonical
            # audiosettings entry (duplicate ZIP members are ambiguous).
            with zipfile.ZipFile(source) as archive:
                members = {item.filename: archive.read(item.filename) for item in archive.infolist()}
            members["audiosettings.json"] = json.dumps(settings).encode("utf-8")
            with zipfile.ZipFile(source, "w") as archive:
                for name, payload in members.items():
                    archive.writestr(name, payload)

            self.assertTrue(serve_frontend._write_audio_subset_source(source, destination, {"1"}))

            with zipfile.ZipFile(destination) as archive:
                filtered = json.loads(archive.read("audiosettings.json"))
            tracks = {track["partId"]: track for track in filtered["tracks"]}
            self.assertFalse(tracks["1"]["soloMuteState"]["mute"])
            self.assertTrue(tracks["2"]["soloMuteState"]["mute"])
            self.assertTrue(tracks["999"]["soloMuteState"]["mute"])
            self.assertEqual(tracks["1"]["in"]["resourceMeta"]["id"], "MS Basic\\0\\52")
            self.assertEqual(tracks["2"]["in"]["resourceMeta"]["id"], "94")

    def test_editor_only_resave_keeps_semantic_fingerprint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.mscz"
            second = Path(directory) / "second.mscz"
            _write_mscz(first, editor_variant=1)
            _write_mscz(second, editor_variant=2)

            first_raw, first_semantic = serve_frontend._source_hashes(first)
            second_raw, second_semantic = serve_frontend._source_hashes(second)

            self.assertNotEqual(first_raw, second_raw)
            self.assertEqual(first_semantic, second_semantic)

    def test_musical_change_invalidates_semantic_fingerprint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.mscz"
            second = Path(directory) / "second.mscz"
            _write_mscz(first, pitch=60)
            _write_mscz(second, pitch=61)

            self.assertNotEqual(
                serve_frontend._source_hashes(first)[1],
                serve_frontend._source_hashes(second)[1],
            )

    def test_adjacent_musicxml_mode_invalidates_semantic_fingerprint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.mscz"
            sidecar = source.with_suffix(".xml")
            _write_mscz(source)
            self._write_key_mode(sidecar, "major")
            major_fingerprint = serve_frontend._source_hashes(source)[1]

            self._write_key_mode(sidecar, "minor")

            self.assertNotEqual(major_fingerprint, serve_frontend._source_hashes(source)[1])

    def test_explicit_sidecar_mode_is_restored_into_musescore_export(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.mscz"
            _write_mscz(source)
            self._write_key_mode(source.with_suffix(".xml"), "major")
            exported = serve_frontend.ET.fromstring(
                '<score-partwise><part><measure><attributes><key><fifths>0</fifths>'
                '</key></attributes></measure></part></score-partwise>'
            )

            self.assertTrue(serve_frontend._restore_explicit_key_modes(exported, source))
            declaration = serve_frontend._key_declarations(exported)[0]
            self.assertEqual(declaration[:2], (0, "major"))

    def test_mscz_change_atomically_exports_sidecar_and_preserves_mode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "piece" / "piece.mscz"
            source.parent.mkdir()
            source.write_bytes(b"first revision")
            sidecar = source.with_suffix(".xml")
            self._write_key_mode(sidecar, "minor")
            calls = []

            def export(command, **_kwargs):
                calls.append(command)
                output = Path(command[command.index("-o") + 1])
                output.write_text(
                    '<score-partwise><part><measure><attributes><key><fifths>0</fifths>'
                    '</key></attributes></measure></part></score-partwise>',
                    encoding="utf-8",
                )
                return mock.Mock(returncode=0, stdout="", stderr="")

            with mock.patch.object(serve_frontend, "LIBRARY_ASSETS_ROOT", root / "assets"), \
                    mock.patch.object(serve_frontend, "_musescore", return_value="MuseScore4"), \
                    mock.patch.object(serve_frontend.subprocess, "run", side_effect=export):
                target, changed = serve_frontend._sync_musicxml_from_mscz(source)
                self.assertTrue(changed)
                self.assertEqual(target, sidecar)
                self.assertEqual(serve_frontend._key_declarations(serve_frontend.ET.parse(sidecar).getroot())[0][:2],
                                 (0, "minor"))
                self.assertFalse(serve_frontend._sync_musicxml_from_mscz(source)[1])
                sidecar.unlink()
                self.assertTrue(serve_frontend._sync_musicxml_from_mscz(source)[1])
                source.write_bytes(b"second revision")
                self.assertTrue(serve_frontend._sync_musicxml_from_mscz(source)[1])

            self.assertEqual(len(calls), 3)

    def test_failed_mscz_export_never_replaces_existing_sidecar(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "piece" / "piece.mscz"
            source.parent.mkdir()
            source.write_bytes(b"revision")
            sidecar = source.with_suffix(".xml")
            sidecar.write_text("<score-partwise/>", encoding="utf-8")

            with mock.patch.object(serve_frontend, "LIBRARY_ASSETS_ROOT", root / "assets"), \
                    mock.patch.object(serve_frontend, "_musescore", return_value="MuseScore4"), \
                    mock.patch.object(serve_frontend.subprocess, "run",
                                      return_value=mock.Mock(returncode=1, stdout="", stderr="broken")):
                with self.assertRaisesRegex(RuntimeError, "broken"):
                    serve_frontend._sync_musicxml_from_mscz(source)

            self.assertEqual(sidecar.read_text(encoding="utf-8"), "<score-partwise/>")

    def test_legacy_cache_is_promoted_without_rebuild(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            metadata_path = Path(directory) / "metadata.json"
            metadata_path.write_text(json.dumps({
                "layout_version": serve_frontend.LIBRARY_ASSET_LAYOUT_VERSION,
                "source_sha256": "raw",
                "piece_id": "test",
            }), encoding="utf-8")

            metadata = serve_frontend._cached_library_metadata(metadata_path, "raw", "semantic")

            self.assertIsNotNone(metadata)
            promoted = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertEqual(promoted["source_fingerprint_version"], serve_frontend.SOURCE_FINGERPRINT_VERSION)
            self.assertEqual(promoted["source_semantic_sha256"], "semantic")

    def test_semantic_hit_refreshes_raw_checksum(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            metadata_path = Path(directory) / "metadata.json"
            metadata_path.write_text(json.dumps({
                "layout_version": serve_frontend.LIBRARY_ASSET_LAYOUT_VERSION,
                "source_sha256": "old-raw",
                "source_fingerprint_version": serve_frontend.SOURCE_FINGERPRINT_VERSION,
                "source_semantic_sha256": "semantic",
            }), encoding="utf-8")

            metadata = serve_frontend._cached_library_metadata(metadata_path, "new-raw", "semantic")

            self.assertIsNotNone(metadata)
            refreshed = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertEqual(refreshed["source_sha256"], "new-raw")


class LocalBundlePreparationTests(unittest.TestCase):
    def test_continuous_part_layout_removes_breaks_without_touching_music(self) -> None:
        root = serve_frontend.ET.fromstring("""
          <score-partwise>
            <defaults><page-layout><page-height>1600</page-height><page-width>1200</page-width>
              <page-margins type="odd"><left-margin>80</left-margin><right-margin>80</right-margin>
                <top-margin>80</top-margin><bottom-margin>80</bottom-margin></page-margins>
            </page-layout></defaults>
            <credit page="1"><credit-words>Title</credit-words></credit>
            <part id="P1">
              <measure number="1" width="400"><print new-system="yes"/><note><pitch><step>C</step></pitch></note></measure>
              <measure number="2" width="500"><print new-page="yes"/><note><pitch><step>D</step></pitch></note></measure>
            </part>
          </score-partwise>
        """)

        serve_frontend._prepare_continuous_part_musicxml(root)

        layout = root.find("./defaults/page-layout")
        self.assertGreater(float(layout.findtext("page-width")), 1200)
        self.assertEqual(float(layout.findtext("page-height")), serve_frontend.CONTINUOUS_PAGE_HEIGHT_TENTHS)
        self.assertFalse(root.findall("credit"))
        self.assertFalse(root.findall(".//print"))
        self.assertEqual([note.findtext("./pitch/step") for note in root.findall(".//note")], ["C", "D"])

    def test_repertoire_sources_exclude_voice_lab_exercises(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            sheets = Path(directory)
            repertoire = sheets / "ave-verum"
            voice_lab = sheets / "voice-lab"
            repertoire.mkdir()
            voice_lab.mkdir()
            (repertoire / "ave-verum.mscz").write_bytes(b"score")
            (voice_lab / "interval.mscz").write_bytes(b"exercise")

            with mock.patch.object(serve_frontend, "SHEETS_ROOT", sheets):
                sources = serve_frontend._library_sources()

            self.assertEqual(sources, [repertoire / "ave-verum.mscz"])

    def test_runtime_bundle_is_precomputed_on_disk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            assets = Path(directory)
            destination = assets / "test-piece"
            destination.mkdir()
            (destination / "score.json").write_text('{"score":"ready"}', encoding="utf-8")
            metadata = {
                "piece_id": "test-piece",
                "score_version_id": "local-test",
                "monodic": False,
                "parts": [{"id": "P1", "name": "Soprano"}],
                "score_pages": ["score-1.svg"],
                "part_pages": {"P1": ["part-P1-1.svg"]},
                "continuous_part_scores": {"P1": "part-P1-continuous-1.svg"},
                "voice_stems": {"P1": "voice-P1.mp3"},
                "accompaniment_file": "accompaniment.mp3",
            }

            with mock.patch.object(serve_frontend, "LIBRARY_ASSETS_ROOT", assets):
                bundle = serve_frontend._write_library_runtime_bundle(metadata)

            stored_bundle = json.loads((destination / "bundle.json").read_text(encoding="utf-8"))
            audio = json.loads((destination / "audio-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(stored_bundle, bundle)
            self.assertEqual(stored_bundle["parts"], metadata["parts"])
            self.assertEqual(
                stored_bundle["assets"]["continuous_scores"]["P1"],
                "library-assets/test-piece/part-P1-continuous-1.svg",
            )
            self.assertEqual(audio["voice_stems"], metadata["voice_stems"])
            self.assertTrue((destination / "glyph-map.json").is_file())


if __name__ == "__main__":
    unittest.main()
