"""Run the deliberately human-gated Codex -> MuseScore draft stage."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Sequence

from .job_store import JobStore, sha256_file, utc_now


def build_prompt(pdf_name: str) -> str:
    return f"""You are preparing a DRAFT score for human review by a choir administrator.
Read the complete input PDF at input/{pdf_name} and create output/draft.mscz.

Requirements:
- Produce a minimal, clean MuseScore score containing the sung melody/voices, all lyrics, and an organ accompaniment.
- Set the organ staff playback sound to a pleasant MuseScore Basic strings sound (prefer String Ensemble), while keeping the instrument/staff name "Organo".
- Preserve key, meter, tempo, repeats, verses, syllabification, and page order when legible.
- Do not invent unreadable material: mark uncertainties with visible staff text beginning "DA VERIFICARE:".
- The only required deliverable is output/draft.mscz. You may use MuseScore CLI and intermediate files inside output/.
- Do not modify anything outside this job directory. Do not publish or approve the result.
- Before finishing, verify that output/draft.mscz exists and is non-empty.
"""


def run_codex_draft(job_id: str, data_root: Path, *, command: Sequence[str] | None = None) -> dict:
    store = JobStore(data_root)
    job_dir = store.job_dir(job_id)
    manifest = store.get(job_id)
    pdf_name = Path(manifest["source"]["stored_path"]).name
    output_dir = job_dir / "output"
    reports_dir = job_dir / "reports"
    output_dir.mkdir(exist_ok=True)
    reports_dir.mkdir(exist_ok=True)
    store.update(job_id, status="codex_running", next_action="wait_for_codex")
    store.append_event(job_dir, {"event": "codex_started", "status": "codex_running"})

    args = list(command or ("codex", "--ask-for-approval", "never", "exec")) + [
        "--ephemeral", "--sandbox", "workspace-write",
        "--skip-git-repo-check", "-C", str(job_dir),
        "--output-last-message", str(reports_dir / "codex-last-message.txt"), "-",
    ]
    try:
        result = subprocess.run(
            args, input=build_prompt(pdf_name), text=True, capture_output=True,
            timeout=30 * 60, check=False, cwd=job_dir,
        )
        (reports_dir / "codex-stdout.log").write_text(result.stdout[-100_000:], encoding="utf-8")
        (reports_dir / "codex-stderr.log").write_text(result.stderr[-100_000:], encoding="utf-8")
        draft = output_dir / "draft.mscz"
        if result.returncode == 0 and draft.is_file() and draft.stat().st_size:
            artifact = {"kind": "draft_mscz", "path": str(draft), "sha256": sha256_file(draft)}
            manifest = store.get(job_id)
            manifest["artifacts"] = [a for a in manifest["artifacts"] if a["kind"] != "draft_mscz"] + [artifact]
            manifest.update(status="pending_admin_review", next_action="download_review_and_upload_corrected_mscz", updated_at=utc_now())
            store.write_manifest(job_dir, manifest)
            store.append_event(job_dir, {"event": "codex_completed", "status": manifest["status"]})
            return manifest
        error = f"Codex exited with code {result.returncode}; draft.mscz was not produced"
    except (OSError, subprocess.TimeoutExpired) as exc:
        error = f"Codex execution failed: {exc}"

    manifest = store.update(job_id, status="codex_failed", next_action="inspect_codex_logs_and_retry", error=error)
    store.append_event(job_dir, {"event": "codex_failed", "status": "codex_failed", "error": error})
    return manifest
