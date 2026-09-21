"""Run the conservative free multi-engine OMR pipeline."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.choir_assistant.ingestion.omr_pipeline import Pipeline, run_all


def main() -> int:
    parser = argparse.ArgumentParser(description="PDF -> Audiveris + homr/oemer -> comparison -> review MSCZ")
    parser.add_argument("pdf", type=Path, nargs="?", help="One PDF; omit to process every PDF in --input-dir")
    parser.add_argument("--input-dir", type=Path, default=ROOT / "automate_mscz")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data" / "omr-consensus")
    parser.add_argument("--skip-codex", action="store_true", help="Skip the review-priority report; musical comparison still runs")
    args = parser.parse_args()
    if args.pdf:
        results = [Pipeline(args.pdf, args.output_dir, use_codex=not args.skip_codex).run()]
    else:
        results = run_all(args.input_dir, args.output_dir, use_codex=not args.skip_codex)
    print(json.dumps([{"source": result["source"], "status": result["status"], "blocker": result.get("blocker")} for result in results], indent=2, ensure_ascii=False))
    return 0 if results and all(result["status"] == "pending_human_review" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
