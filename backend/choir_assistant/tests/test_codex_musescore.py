import sys
import tempfile
import unittest
from pathlib import Path

from choir_assistant.ingestion.codex_musescore import build_prompt, run_codex_draft
from choir_assistant.ingestion.service import submit_ingestion


class CodexMuseScoreDraftTests(unittest.TestCase):
    def test_prompt_requires_human_gated_lyrics_and_string_sound(self):
        prompt = build_prompt("score.pdf")
        self.assertIn("input/score.pdf", prompt)
        self.assertIn("all lyrics", prompt)
        self.assertIn("String Ensemble", prompt)
        self.assertIn("human review", prompt)

    def test_successful_draft_is_pending_admin_review(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.pdf"
            source.write_bytes(b"%PDF-1.4 test")
            manifest = submit_ingestion(source, "test-piece", root / "data")
            script = "from pathlib import Path; Path('output/draft.mscz').write_bytes(b'MSCZ')"
            result = run_codex_draft(
                manifest["job_id"], root / "data", command=[sys.executable, "-c", script]
            )
            self.assertEqual(result["status"], "pending_admin_review")
            self.assertEqual(result["artifacts"][-1]["kind"], "draft_mscz")


if __name__ == "__main__":
    unittest.main()
