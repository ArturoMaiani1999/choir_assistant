"""Watch an already-running automate_mscz job without taking its worker lock."""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def snapshot(root: Path) -> tuple:
    state_path = root / "job-state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    newest = max((p for p in (root / ".work").rglob("*") if p.is_file()), key=lambda p: p.stat().st_mtime, default=None)
    items = tuple((item["source"], item["status"], item["attempts"], item.get("phase"), item.get("heartbeat_at")) for item in state["items"])
    newest_data = (str(newest.relative_to(root)), newest.stat().st_size, newest.stat().st_mtime) if newest else None
    return state["status"], items, newest_data


def main() -> int:
    parser = argparse.ArgumentParser(description="Show live progress for automate_mscz")
    parser.add_argument("--input-dir", type=Path, default=ROOT / "automate_mscz")
    parser.add_argument("--interval", type=int, default=5)
    parser.add_argument("--heartbeat", type=int, default=30, help="Print reassurance even when no files change")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    previous = None
    last_print = 0.0
    while True:
        current = snapshot(args.input_dir.resolve())
        changed = current != previous
        if changed or time.monotonic() - last_print >= max(1, args.heartbeat):
            print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] job={current[0]}", flush=True)
            for source, status, attempts, phase, heartbeat in current[1]:
                detail = f", fase={phase}, heartbeat={heartbeat}" if phase else ""
                print(f"  {source}: {status}, tentativi={attempts}{detail}", flush=True)
            if current[2]:
                print(f"  ultimo file: {current[2][0]} ({current[2][1]} byte)", flush=True)
            if not changed:
                print("  nessun nuovo file; il monitor è attivo", flush=True)
            previous = current
            last_print = time.monotonic()
        if args.once or current[0] in {"completed", "completed_with_blockers", "blocked", "interrupted"}:
            return 0
        time.sleep(max(1, args.interval))


if __name__ == "__main__":
    raise SystemExit(main())
