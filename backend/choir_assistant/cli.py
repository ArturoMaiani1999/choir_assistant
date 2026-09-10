"""Command-line entry point for the incremental ingestion foundation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .ingestion.job_store import JobStore
from .ingestion.musicxml import compile_musicxml
from .ingestion.service import submit_ingestion
from .ingestion.codex_musescore import run_codex_draft


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="choir")
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    commands = parser.add_subparsers(dest="command", required=True)

    ingest = commands.add_parser("ingest")
    ingest_commands = ingest.add_subparsers(dest="ingest_command", required=True)
    submit = ingest_commands.add_parser("submit")
    submit.add_argument("source", type=Path)
    submit.add_argument("--piece-id", required=True)
    status = ingest_commands.add_parser("status")
    status.add_argument("job_id")
    report = ingest_commands.add_parser("report")
    report.add_argument("job_id")
    draft = ingest_commands.add_parser("create-draft")
    draft.add_argument("job_id")

    score = commands.add_parser("score")
    score_commands = score.add_subparsers(dest="score_command", required=True)
    compile_command = score_commands.add_parser("compile-musicxml")
    compile_command.add_argument("source", type=Path)
    compile_command.add_argument("--output", type=Path)
    compile_command.add_argument("--score-version-id", default="musicxml-score-v1")
    compile_command.add_argument("--title")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "ingest" and args.ingest_command == "submit":
        manifest = submit_ingestion(args.source, args.piece_id, args.data_root)
        print(json.dumps(manifest, indent=2, ensure_ascii=False))
        return 0

    if args.command == "ingest" and args.ingest_command in {"status", "report"}:
        manifest = JobStore(args.data_root).get(args.job_id)
        print(json.dumps(manifest, indent=2, ensure_ascii=False))
        return 0

    if args.command == "ingest" and args.ingest_command == "create-draft":
        manifest = run_codex_draft(args.job_id, args.data_root)
        print(json.dumps(manifest, indent=2, ensure_ascii=False))
        return 0 if manifest["status"] == "pending_admin_review" else 1

    if args.command == "score" and args.score_command == "compile-musicxml":
        score = compile_musicxml(
            args.source,
            score_version_id=args.score_version_id,
            title=args.title,
        )
        payload = json.dumps(score.to_dict(), indent=2, ensure_ascii=False)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(payload + "\n", encoding="utf-8")
        else:
            print(payload)
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
