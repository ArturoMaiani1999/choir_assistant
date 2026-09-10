"""Launch or resume the autonomous automate_mscz batch."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.choir_assistant.ingestion.batch_musescore import (
    atomic_json, create_or_resume_state, discover_inputs, job_lock, now, run_batch, write_report,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Create and validate MSCZ drafts for every PDF in a folder")
    parser.add_argument("--input-dir", type=Path, default=ROOT / "automate_mscz")
    parser.add_argument("--max-attempts", type=int, default=2)
    parser.add_argument("--capacity-retries", type=int, default=96, help="15-minute retries; default waits up to 24 hours")
    parser.add_argument("--retry-seconds", type=int, default=900)
    parser.add_argument("--force-unlock", action="store_true", help="Remove a stale worker lock before starting")
    args = parser.parse_args()
    args.input_dir = args.input_dir.resolve()
    try:
        with job_lock(args.input_dir, force=args.force_unlock):
            result = run_batch(args.input_dir, max_attempts=max(1, args.max_attempts), capacity_retries=max(0, args.capacity_retries), retry_seconds=max(1, args.retry_seconds))
    except (KeyboardInterrupt, Exception) as exc:
        if isinstance(exc, RuntimeError) and str(exc).startswith("Un worker sembra già attivo"):
            print(str(exc))
            return 1
        # A final report is part of the job contract, including unexpected local blockers.
        state = create_or_resume_state(args.input_dir, discover_inputs(args.input_dir))
        state.update(status="interrupted" if isinstance(exc, KeyboardInterrupt) else "blocked", blocker=str(exc), updated_at=now())
        for item in state["items"]:
            if item["status"] == "running":
                item.update(status="blocked", error=str(exc))
        atomic_json(args.input_dir / "job-state.json", state)
        write_report(args.input_dir, state)
        print(f"Job {state['status']}: {exc}. Report: {args.input_dir / 'reports' / 'feasibility-report.md'}")
        return 130 if isinstance(exc, KeyboardInterrupt) else 1
    print(f"Job {result['status']}. Report: {args.input_dir / 'reports' / 'feasibility-report.md'}")
    return 0 if result["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
