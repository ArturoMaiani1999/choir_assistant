"""Command-line entry point for the incremental ingestion foundation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .ingestion.job_store import JobStore
from .ingestion.service import submit_ingestion


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

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
