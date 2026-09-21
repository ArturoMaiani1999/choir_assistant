"""Conservative multi-engine OMR pipeline utilities.

No function in this module silently repairs musical content.  Disagreement becomes
review metadata and visible MusicXML annotations.
"""
from __future__ import annotations

import copy
import json
import math
import re
import shutil
import struct
import subprocess
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


PITCH_CLASS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def resolve_tool(name: str, windows_fallback: str | None = None) -> Path | None:
    found = shutil.which(name)
    if found:
        return Path(found).resolve()
    if windows_fallback and Path(windows_fallback).is_file():
        return Path(windows_fallback).resolve()
    return None


def analyze_pdf(pdf: Path) -> dict[str, Any]:
    def output(command: list[str]) -> str:
        result = subprocess.run(command, capture_output=True, text=True, timeout=60, check=False)
        return (result.stdout or "") + (result.stderr or "")

    info = output(["pdfinfo", str(pdf)])
    fonts = output(["pdffonts", str(pdf)])
    images = output(["pdfimages", "-list", str(pdf)])
    pages_match = re.search(r"^Pages:\s+(\d+)", info, re.MULTILINE)
    font_rows = [line for line in fonts.splitlines()[2:] if line.strip()]
    image_rows = [line for line in images.splitlines()[2:] if line.strip()]
    dpi = []
    for row in image_rows:
        values = re.findall(r"\b(\d{2,4})\b", row)
        if len(values) >= 2:
            # pdfimages places x/y DPI near the end; retain plausible scan values.
            dpi.extend(int(value) for value in values if 50 <= int(value) <= 1200)
    kind = "vector" if font_rows and not image_rows else "scan" if image_rows and not font_rows else "mixed"
    return {
        "kind": kind, "pages": int(pages_match.group(1)) if pages_match else None,
        "font_count": len(font_rows), "image_count": len(image_rows),
        "estimated_dpi": Counter(dpi).most_common(1)[0][0] if dpi else None,
    }


def render_pdf(pdf: Path, destination: Path, dpi: int) -> list[Path]:
    destination.mkdir(parents=True, exist_ok=True)
    prefix = destination / "page"
    result = subprocess.run(
        ["pdftoppm", "-gray", "-r", str(dpi), str(pdf), str(prefix)],
        capture_output=True, text=True, timeout=15 * 60, check=False,
    )
    pages = sorted(destination.glob("page-*.pgm"))
    if result.returncode or not pages:
        raise RuntimeError(f"Rendering PDF fallito: {(result.stderr or result.stdout or '').strip()}")
    return pages


def read_pgm(path: Path):
    """Read an 8-bit binary PGM using only NumPy plus the standard library."""
    import numpy as np
    data = path.read_bytes()
    match = re.match(br"P5\s+(?:#[^\r\n]*[\r\n]+\s*)*(\d+)\s+(\d+)\s+(\d+)\s", data)
    if not match or int(match.group(3)) > 255:
        raise ValueError(f"PGM non supportato: {path}")
    width, height = int(match.group(1)), int(match.group(2))
    pixels = np.frombuffer(data, dtype=np.uint8, offset=match.end())
    return pixels[: width * height].reshape((height, width))


def write_pgm(path: Path, image) -> None:
    height, width = image.shape
    path.write_bytes(f"P5\n{width} {height}\n255\n".encode() + image.astype("uint8").tobytes())


def preprocess_pgm(source: Path, destination: Path) -> Path:
    """Normalize contrast losslessly in geometry; never synthesize musical marks."""
    import numpy as np
    image = read_pgm(source).astype(np.float32)
    black, white = np.percentile(image, (1, 99))
    if white > black:
        image = np.clip((image - black) * (255.0 / (white - black)), 0, 255)
    destination.parent.mkdir(parents=True, exist_ok=True)
    write_pgm(destination, image.astype(np.uint8))
    return destination


def detect_staves(page: Path, crops_dir: Path) -> dict[str, Any]:
    """Detect five-line staves by horizontal projection and emit lossless crops."""
    import numpy as np
    image = read_pgm(page)
    ink = image < 160
    projection = ink.mean(axis=1)
    rows = np.flatnonzero(projection > 0.28).tolist()
    bands: list[int] = []
    for row in rows:
        if not bands or row > bands[-1] + 2:
            bands.append(row)
        else:
            bands[-1] = (bands[-1] + row) // 2
    groups: list[list[int]] = []
    index = 0
    while index <= len(bands) - 5:
        candidate = bands[index:index + 5]
        gaps = [b - a for a, b in zip(candidate, candidate[1:])]
        mean = sum(gaps) / 4
        if 3 <= mean <= 80 and max(abs(gap - mean) for gap in gaps) <= max(2, mean * .3):
            groups.append(candidate); index += 5
        else:
            index += 1
    centers = [sum(group) // 5 for group in groups]
    gaps = [b - a for a, b in zip(centers, centers[1:])]
    median = float(np.median(gaps)) if gaps else 0
    systems: list[list[int]] = [[]]
    for ordinal, center in enumerate(centers):
        if ordinal and median and center - centers[ordinal - 1] > median * 1.65:
            systems.append([])
        systems[-1].append(ordinal)
    systems = [system for system in systems if system]
    crops_dir.mkdir(parents=True, exist_ok=True)
    crops = []
    for system_index, system in enumerate(systems, 1):
        for staff_ordinal, group_index in enumerate(system, 1):
            lines = groups[group_index]
            spacing = max(4, round((lines[-1] - lines[0]) / 4))
            previous = groups[group_index - 1][-1] if group_index else 0
            following = groups[group_index + 1][0] if group_index + 1 < len(groups) else image.shape[0]
            top = max(0, min(lines[0] - spacing * 4, (previous + lines[0]) // 2))
            bottom = min(image.shape[0], max(lines[-1] + spacing * 7, (lines[-1] + following) // 2))
            crop_path = crops_dir / f"system-{system_index:03d}-staff-{staff_ordinal:02d}.pgm"
            write_pgm(crop_path, image[top:bottom, :])
            crops.append({"path": str(crop_path), "system": system_index, "staff": staff_ordinal, "y": [top, bottom]})
    counts = [len(system) for system in systems]
    return {
        "page": page.name, "staff_count": len(groups), "systems": len(systems),
        "staves_per_system": counts, "stable_layout": bool(counts) and len(set(counts)) == 1,
        "crops": crops,
    }


def crops_from_homr_positions(page: Path, positions: Path, crops_dir: Path) -> list[dict[str, Any]]:
    """Create staff crops from homr's normalized, skew-aware detector output."""
    image = read_pgm(page)
    height, width = image.shape
    crops_dir.mkdir(parents=True, exist_ok=True)
    result = []
    for ordinal, line in enumerate(positions.read_text(encoding="utf-8").splitlines(), 1):
        values = line.split()
        if len(values) != 5:
            continue
        grand, center_x, center_y, box_width, box_height = map(float, values)
        x1 = max(0, int((center_x - box_width / 2) * width))
        x2 = min(width, int((center_x + box_width / 2) * width))
        raw_y1 = int((center_y - box_height / 2) * height)
        raw_y2 = int((center_y + box_height / 2) * height)
        padding = max(40, (raw_y2 - raw_y1) * 3)
        y1, y2 = max(0, raw_y1 - padding), min(height, raw_y2 + padding * 2)
        target = crops_dir / f"staff-{ordinal:03d}.pgm"
        write_pgm(target, image[y1:y2, x1:x2])
        result.append({"path": str(target), "staff": ordinal, "grand_staff": bool(grand), "box": [x1, y1, x2, y2]})
    return result


def assemble_page_candidates(pages: list[Path], destination: Path) -> dict[str, Any]:
    """Join page-level score-partwise results while preserving part ordinals."""
    if not pages:
        raise ValueError("Nessuna pagina MusicXML neurale")
    roots = [ET.parse(path).getroot() for path in pages]
    page_parts = [root.findall("./part") for root in roots]
    counts = [len(parts) for parts in page_parts]
    if not counts[0] or len(set(counts)) != 1:
        raise ValueError(f"Numero di parti incoerente tra pagine homr: {counts}")
    output = copy.deepcopy(roots[0])
    output_parts = output.findall("./part")
    for part in output_parts:
        for measure in list(part.findall("measure")):
            part.remove(measure)
    measure_numbers = [1] * counts[0]
    for parts in page_parts:
        for part_index, part in enumerate(parts):
            for measure in part.findall("measure"):
                clone = copy.deepcopy(measure)
                clone.set("number", str(measure_numbers[part_index]))
                measure_numbers[part_index] += 1
                output_parts[part_index].append(clone)
    destination.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(output).write(destination, encoding="utf-8", xml_declaration=True)
    return {"parts_per_page": counts, "measures_per_part": [number - 1 for number in measure_numbers]}


def materialize_musicxml(source: Path, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix.lower() == ".mxl":
        with zipfile.ZipFile(source) as archive:
            names = [name for name in archive.namelist() if name.lower().endswith((".xml", ".musicxml")) and "container.xml" not in name]
            if not names:
                raise ValueError(f"Nessun MusicXML in {source}")
            destination.write_bytes(archive.read(names[0]))
    else:
        shutil.copy2(source, destination)
    ET.parse(destination)
    return destination


def musicxml_metrics(path: Path) -> dict[str, Any]:
    root = ET.parse(path).getroot()
    parts = root.findall("./part")
    measures = root.findall("./part/measure")
    pitched = [note for note in root.findall(".//note") if note.find("pitch") is not None]
    lyrics = root.findall(".//lyric/text")
    return {"parts": len(parts), "measures": len(measures), "pitched_notes": len(pitched), "lyrics": len(lyrics)}


def candidate_score(path: Path) -> float:
    try:
        metrics = musicxml_metrics(path)
    except (ET.ParseError, OSError):
        return -1
    return metrics["pitched_notes"] + metrics["measures"] * 2 + min(metrics["lyrics"], 200) * .25


def _note_signature(note: ET.Element, divisions: int) -> tuple[int | None, float]:
    pitch = note.find("pitch")
    midi = None
    if pitch is not None and pitch.findtext("step") in PITCH_CLASS:
        step = pitch.findtext("step")
        midi = 12 * (int(pitch.findtext("octave", "4")) + 1) + PITCH_CLASS[step] + int(pitch.findtext("alter", "0"))
    return midi, round(int(note.findtext("duration", "0")) / max(1, divisions), 4)


def score_signatures(path: Path) -> list[list[list[tuple[int | None, float]]]]:
    root = ET.parse(path).getroot()
    result = []
    for part in root.findall("./part"):
        divisions = 1
        part_result = []
        for measure in part.findall("measure"):
            divisions = int(measure.findtext("./attributes/divisions", str(divisions)))
            part_result.append([_note_signature(note, divisions) for note in measure.findall("note") if note.find("grace") is None])
        result.append(part_result)
    return result


def compare_candidates(a: Path, b: Path) -> dict[str, Any]:
    left, right = score_signatures(a), score_signatures(b)
    discordances = []
    max_parts = max(len(left), len(right))
    for part_index in range(max_parts):
        a_part = left[part_index] if part_index < len(left) else []
        b_part = right[part_index] if part_index < len(right) else []
        for measure_index in range(max(len(a_part), len(b_part))):
            a_notes = a_part[measure_index] if measure_index < len(a_part) else []
            b_notes = b_part[measure_index] if measure_index < len(b_part) else []
            pitches_a, pitches_b = [n[0] for n in a_notes], [n[0] for n in b_notes]
            durations_a, durations_b = [n[1] for n in a_notes], [n[1] for n in b_notes]
            if pitches_a != pitches_b or durations_a != durations_b:
                discordances.append({
                    "part": part_index + 1, "measure": measure_index + 1,
                    "pitch_match": pitches_a == pitches_b, "rhythm_match": durations_a == durations_b,
                    "candidate_a_notes": len(a_notes), "candidate_b_notes": len(b_notes),
                })
    return {
        "candidate_a": str(a), "candidate_b": str(b),
        "parts_match": len(left) == len(right), "discordance_count": len(discordances),
        "discordances": discordances,
    }


def annotate_for_review(source: Path, destination: Path, comparison: dict[str, Any]) -> None:
    """Copy the candidate and retain review facts as non-rendered MusicXML metadata.

    Review annotations must never obscure notation.  The actionable measure list
    lives in ``reports/discordance.json``; this metadata only keeps the score
    artifact traceable when it is opened independently in MuseScore.
    """
    tree = ET.parse(source)
    root = tree.getroot()
    miscellaneous = root.find("miscellaneous")
    if miscellaneous is None:
        miscellaneous = ET.SubElement(root, "miscellaneous")
    for field in list(miscellaneous.findall("miscellaneous-field")):
        if field.get("name") == "choir-review-discordances":
            miscellaneous.remove(field)
    field = ET.SubElement(miscellaneous, "miscellaneous-field", {"name": "choir-review-discordances"})
    field.text = json.dumps({
        "count": comparison.get("discordance_count", len(comparison.get("discordances", []))),
        "report": "reports/discordance.json",
        "status": "pending_human_review",
    }, ensure_ascii=False, separators=(",", ":"))
    destination.parent.mkdir(parents=True, exist_ok=True)
    tree.write(destination, encoding="utf-8", xml_declaration=True)


def assemble_staff_candidates(candidates: list[dict[str, Any]], destination: Path) -> dict[str, Any]:
    """Assemble crop results by stable staff ordinal; reject ambiguous layouts."""
    if not candidates:
        raise ValueError("Nessun pentagramma riconosciuto dal motore neurale")
    layout_counts = [entry["staves_per_system"] for entry in candidates]
    flattened = [count for page in layout_counts for count in page]
    if not flattened:
        raise ValueError("Nessun sistema musicale rilevato")
    expected = Counter(flattened).most_common(1)[0][0]
    if any(count != expected for count in flattened):
        raise ValueError(f"Layout compresso/ambiguo: pentagrammi per sistema {flattened}")
    root = ET.Element("score-partwise", {"version": "4.0"})
    part_list = ET.SubElement(root, "part-list")
    parts = []
    for ordinal in range(1, expected + 1):
        score_part = ET.SubElement(part_list, "score-part", {"id": f"P{ordinal}"})
        ET.SubElement(score_part, "part-name").text = f"Staff {ordinal} DA IDENTIFICARE"
        part = ET.SubElement(root, "part", {"id": f"P{ordinal}"})
        parts.append(part)
    measure_numbers = [1] * expected
    for page in candidates:
        for crop in page["crops"]:
            xml_path = crop.get("selected_xml")
            if not xml_path:
                raise ValueError(f"Nessun risultato neurale per {crop['path']}")
            crop_root = ET.parse(xml_path).getroot()
            crop_part = crop_root.find("./part")
            if crop_part is None:
                raise ValueError(f"MusicXML senza parte: {xml_path}")
            target_index = crop["staff"] - 1
            for measure in crop_part.findall("measure"):
                clone = copy.deepcopy(measure)
                clone.set("number", str(measure_numbers[target_index]))
                measure_numbers[target_index] += 1
                parts[target_index].append(clone)
    destination.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(root).write(destination, encoding="utf-8", xml_declaration=True)
    return {"expected_staves": expected, "measures_per_staff": [number - 1 for number in measure_numbers]}
