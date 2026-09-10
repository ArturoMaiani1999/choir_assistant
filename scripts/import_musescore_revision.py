"""Import an admin-edited MuseScore file and rebuild the Ecco MVP bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
MUSESCORE = Path(r"C:\Program Files\MuseScore 4\bin\MuseScore4.exe")


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


def extract_part(source: Path, destination: Path, part_id: str) -> None:
    tree = ET.parse(source)
    root = tree.getroot()
    part_list = root.find("part-list")
    for score_part in list(part_list.findall("score-part")):
        if score_part.get("id") != part_id:
            part_list.remove(score_part)
    for part in list(root.findall("part")):
        if part.get("id") != part_id:
            root.remove(part)
    ET.indent(tree, space="  ")
    tree.write(destination, encoding="utf-8", xml_declaration=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="admin-edited .mscz")
    args = parser.parse_args()
    source = args.source.resolve()
    if source.suffix.lower() != ".mscz":
        raise SystemExit("Only .mscz files can be imported")
    if not source.exists():
        raise SystemExit(f"File not found: {source}")
    target_mscz = ROOT / "data/omr-ecco/ecco-mvp.mscz"
    target_xml = ROOT / "frontend/score-assets/ecco-mvp/ecco-mvp.musicxml"
    target_part = target_xml.with_name("melodia.musicxml")
    target_mscz.parent.mkdir(parents=True, exist_ok=True)
    target_xml.parent.mkdir(parents=True, exist_ok=True)
    source_digest = hashlib.sha256(source.read_bytes()).hexdigest()
    revision = ROOT / "data/omr-ecco/revisions" / f"{source_digest}.mscz"
    revision.parent.mkdir(parents=True, exist_ok=True)
    if not revision.exists():
        shutil.copy2(source, revision)
    if source != target_mscz.resolve():
        shutil.copy2(source, target_mscz)
    digest = source_digest[:16]
    with tempfile.TemporaryDirectory(prefix="choir-musescore-") as temp:
        exported = Path(temp) / "imported.musicxml"
        run(str(MUSESCORE), "-f", "-o", str(exported), str(target_mscz))
        time.sleep(1.2)
        shutil.copy2(exported, target_xml)
        extract_part(exported, target_part, "P1")
    score_version = f"ecco-mvp-review-{digest}"
    os.environ["PYTHONPATH"] = str(ROOT / "backend")
    run("python", "-m", "choir_assistant.cli", "score", "compile-musicxml",
        str(target_xml), "--output", str(ROOT / "frontend/score-fixtures/ecco-mvp.json"),
        "--score-version-id", score_version)
    svg_dir = ROOT / "frontend/score-assets/ecco-mvp"
    for old_svg in svg_dir.glob("melodia-*.svg"):
        old_svg.unlink()
    run(str(MUSESCORE), "-f", "-o", str(svg_dir / "melodia.svg"), str(target_part))
    run(str(MUSESCORE), "-f", "-o", str(svg_dir / "full-score.svg"), str(target_mscz))
    # MuseScore writes the SVG asynchronously on some Windows installations.
    time.sleep(1.2)
    run("python", "scripts/build_score_glyph_map.py", str(ROOT / "frontend/score-fixtures/ecco-mvp.json"),
        str(ROOT / "frontend/score-assets/ecco-mvp"), str(ROOT / "frontend/score-assets/ecco-mvp/glyph-map.json"),
        "--part", "P1=melodia")
    run("python", "scripts/build_mvp_guide_audio.py",
        str(ROOT / "frontend/score-fixtures/ecco-mvp.json"),
        str(ROOT / "frontend/audio/ecco-mvp/build"),
        str(ROOT / "frontend/audio/ecco-mvp"))
    run("python", "scripts/build_ecco_mvp_manifest.py")
    lock = {
        "kind": "admin_corrected_musescore",
        "sha256": source_digest,
        "score_version_id": score_version,
        "imported_at": datetime.now(timezone.utc).isoformat(),
        "original_filename": source.name,
        "policy": "Do not regenerate score assets from OMR; derive audio and UI assets from this MSCZ.",
    }
    (ROOT / "data/omr-ecco/admin-canonical.json").write_text(
        json.dumps(lock, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Imported {source.name} as {score_version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
