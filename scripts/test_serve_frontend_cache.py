import json
import tempfile
import unittest
import zipfile
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
