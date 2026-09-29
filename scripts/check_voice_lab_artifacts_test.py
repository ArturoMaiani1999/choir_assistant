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
            "SOURCE", "PUBLIC", "MANIFEST", "MAX_AUTHORING_BYTES", "MAX_INTERVAL_SVG_BYTES", "MAX_PUBLIC_BYTES")}
        guard.SOURCE = root / "sheets" / "voice-lab"
        guard.PUBLIC = root / "frontend" / "voice-lab-assets"
        guard.MANIFEST = guard.PUBLIC / "manifest.json"
        (guard.PUBLIC / "intervals").mkdir(parents=True)
        (guard.PUBLIC / "notes").mkdir()
        guard.MANIFEST.write_text(json.dumps({
            "noteScores": {"lowMidi": 60, "highMidi": 61},
            "intervalScores": {"distances": [0, 1]},
        }), encoding="utf-8")
        melodic, harmonic = guard.expected_pairs(60, 61, {0, 1})
        for first, second in melodic:
            (guard.PUBLIC / "intervals" / f"melodic-{first}-{second}-1.svg").write_bytes(b"svg")
        for first, second in harmonic:
            (guard.PUBLIC / "intervals" / f"harmonic-{first}-{second}-1.svg").write_bytes(b"svg")
        for midi in (60, 61):
            (guard.PUBLIC / "notes" / f"note-{midi}-1.svg").write_bytes(b"svg")

    def tearDown(self) -> None:
        for name, value in self.originals.items():
            setattr(guard, name, value)
        self.temporary.cleanup()

    def test_reviewed_bank_passes(self) -> None:
        report = guard.audit_voice_lab_artifacts()
        self.assertEqual(report["intervalSvgFiles"], 7)

    def test_unexpected_pair_fails(self) -> None:
        (guard.PUBLIC / "intervals" / "melodic-60-72-1.svg").write_bytes(b"svg")
        with self.assertRaisesRegex(AssertionError, "SVG intervalli"):
            guard.audit_voice_lab_artifacts()

    def test_public_size_budget_fails(self) -> None:
        guard.MAX_PUBLIC_BYTES = 8
        with self.assertRaisesRegex(AssertionError, "Asset pubblici"):
            guard.audit_voice_lab_artifacts()


if __name__ == "__main__":
    unittest.main()
