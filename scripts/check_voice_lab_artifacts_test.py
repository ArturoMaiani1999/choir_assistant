from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts import check_voice_lab_artifacts as guard


class VoiceLabArtifactGuardTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="voice-lab-artifact-test-")
        root = Path(self.temporary.name)
        self.originals = {name: getattr(guard, name) for name in (
            "SOURCE", "PUBLIC", "MANIFEST", "MAX_AUTHORING_BYTES", "MAX_PUBLIC_BYTES")}
        guard.SOURCE = root / "sheets" / "voice-lab"
        guard.PUBLIC = root / "frontend" / "voice-lab-assets"
        guard.MANIFEST = guard.PUBLIC / "manifest.json"
        (guard.PUBLIC / "choir").mkdir(parents=True)
        guard.MANIFEST.write_text(json.dumps({"schemaVersion": 3, "choirSamples": {"roles": {
            "tenor": {"anchors": [50, 56], "urlTemplate": "voice-lab-assets/choir/tenor-{midi}.flac"},
        }}, "guidePhrases": {"items": []}, "pads": {"items": []}}), encoding="utf-8")
        for midi in (50, 56):
            (guard.PUBLIC / "choir" / f"tenor-{midi}.flac").write_bytes(b"flac")

    def tearDown(self) -> None:
        for name, value in self.originals.items():
            setattr(guard, name, value)
        self.temporary.cleanup()

    def test_reviewed_bank_passes(self) -> None:
        report = guard.audit_voice_lab_artifacts()
        self.assertEqual(report["choirFiles"], 2)

    def test_missing_sample_fails(self) -> None:
        (guard.PUBLIC / "choir" / "tenor-56.flac").unlink()
        with self.assertRaisesRegex(AssertionError, "incompleta"):
            guard.audit_voice_lab_artifacts()

    def test_public_size_budget_fails(self) -> None:
        guard.MAX_PUBLIC_BYTES = 8
        with self.assertRaisesRegex(AssertionError, "oltre budget"):
            guard.audit_voice_lab_artifacts()


if __name__ == "__main__":
    unittest.main()
