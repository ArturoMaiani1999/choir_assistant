import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from choir_assistant.ingestion.batch_musescore import (
    classify_failure,
    create_or_resume_state,
    discover_inputs,
    job_lock,
    prompt_for,
    resolve_codex,
    summarize_codex_event,
    validate_mscz,
)


MUSICXML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list>
<score-part id="P1"><part-name>Melodia</part-name></score-part>
<score-part id="P2"><part-name>Organo</part-name></score-part></part-list>
<part id="P1">{measures}</part><part id="P2">{organ}</part></score-partwise>"""
NOTE = "<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><lyric><text>La</text></lyric></note>"


class BatchMuseScoreTests(unittest.TestCase):
    def test_codex_jsonl_event_has_readable_summary(self):
        line = '{"type":"item.completed","item":{"type":"command_execution","command":"musescore -o draft.mscz score.musicxml"}}'
        summary = summarize_codex_event(line)
        self.assertIn("command_execution completed", summary)
        self.assertIn("draft.mscz", summary)

    def test_failure_classifier_accepts_missing_captured_streams(self):
        class Result:
            stdout = None
            stderr = None
        self.assertEqual(classify_failure(Result()), "execution")

    def test_cli_usage_error_is_a_global_blocker(self):
        class Result:
            stdout = ""
            stderr = "error: unexpected argument '--bad'\nUsage: codex exec"
        self.assertEqual(classify_failure(Result()), "global_blocker")

    def test_codex_can_be_configured_outside_path(self):
        with tempfile.TemporaryDirectory() as temp:
            executable = Path(temp) / "codex.exe"
            executable.write_bytes(b"exe")
            with patch.dict("os.environ", {"CHOIR_CODEX_EXECUTABLE": str(executable)}):
                self.assertEqual(resolve_codex(), executable.resolve())

    def test_lock_rejects_a_second_worker(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with job_lock(root):
                with self.assertRaises(RuntimeError):
                    with job_lock(root):
                        pass
            self.assertFalse((root / ".worker.lock").exists())

    def test_discovers_and_persists_all_pdfs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ("B brano.pdf", "a_brano.pdf", "ignore.txt"):
                (root / name).write_bytes(b"pdf")
            pdfs = discover_inputs(root)
            self.assertEqual([path.name for path in pdfs], ["a_brano.pdf", "B brano.pdf"])
            first = create_or_resume_state(root, pdfs)
            second = create_or_resume_state(root, pdfs)
            self.assertEqual(len(first["items"]), 2)
            self.assertEqual(len(second["items"]), 2)

    def test_prompt_requests_required_quality_contract(self):
        prompt = prompt_for({"source": "brano.pdf"}, ["nessun testo"])
        self.assertIn("SATB", prompt)
        self.assertIn("String Ensemble", prompt)
        self.assertIn("nessun testo", prompt)
        self.assertIn("output/draft.mscz", prompt)

    def test_validator_requires_music_content_and_organ(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            score = root / "draft.mscz"
            with zipfile.ZipFile(score, "w") as archive:
                archive.writestr("score.mscx", "<Staff><Instrument><trackName>Organo</trackName><Channel name='String Ensemble'/></Instrument></Staff>")
            measures = "".join(f"<measure number='{i}'>{NOTE * 3}</measure>" for i in range(1, 5))
            organ = "".join(f"<measure number='{i}'>{NOTE * 3}</measure>" for i in range(1, 5))

            def fake_run(args, **kwargs):
                Path(args[2]).write_text(MUSICXML.format(measures=measures, organ=organ), encoding="utf-8")
                class Result:
                    returncode = 0
                    stdout = ""
                    stderr = ""
                return Result()

            with patch("choir_assistant.ingestion.batch_musescore.subprocess.run", side_effect=fake_run):
                result = validate_mscz(score, Path("MuseScore4"), root / "validation")
            self.assertTrue(result["passed"])
            self.assertEqual(result["metrics"]["parts"], ["Melodia", "Organo"])


if __name__ == "__main__":
    unittest.main()
