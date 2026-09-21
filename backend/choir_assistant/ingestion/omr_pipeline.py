"""End-to-end free OMR consensus pipeline with mandatory human review."""
from __future__ import annotations

import json
import shutil
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from .batch_musescore import MODEL, REASONING_EFFORT, now, resolve_codex
from .omr_consensus import (
    analyze_pdf, annotate_for_review, assemble_page_candidates, candidate_score,
    compare_candidates, crops_from_homr_positions, materialize_musicxml,
    musicxml_metrics, preprocess_pgm, render_pdf, resolve_tool,
)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp.replace(path)


class Pipeline:
    def __init__(self, pdf: Path, output_root: Path, *, use_codex: bool = True) -> None:
        self.pdf = pdf.resolve()
        self.root = (output_root / self.slug(pdf.stem)).resolve()
        self.use_codex = use_codex
        self.state_path = self.root / "pipeline-state.json"
        self.log_path = self.root / "reports" / "pipeline.log"
        self.state: dict[str, Any] = {
            "source": str(self.pdf), "status": "running", "created_at": now(),
            "updated_at": now(), "stages": {}, "warnings": [], "artifacts": {},
        }

    @staticmethod
    def slug(value: str) -> str:
        import re
        return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "score"

    def log(self, message: str) -> None:
        line = f"[{datetime.now().astimezone():%Y-%m-%d %H:%M:%S}] {message}"
        print(line, flush=True)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        with self.log_path.open("a", encoding="utf-8") as stream:
            stream.write(line + "\n")

    def stage(self, name: str, status: str, **details: Any) -> None:
        self.state["stages"][name] = {"status": status, "updated_at": now(), **details}
        self.state["updated_at"] = now()
        write_json(self.state_path, self.state)
        self.log(f"{name}: {status}" + (f" — {details.get('message')}" if details.get("message") else ""))

    def run_audiveris(self) -> Path | None:
        executable = resolve_tool("audiveris", "C:/Program Files/Audiveris/Audiveris.exe")
        destination = self.root / "candidate-a-audiveris"
        destination.mkdir(parents=True, exist_ok=True)
        target = self.root / "candidates" / "candidate-a.musicxml"
        if candidate_score(target) >= 0:
            self.state["artifacts"]["candidate_a"] = str(target)
            self.stage("audiveris", "cached", metrics=musicxml_metrics(target))
            return target
        if not executable:
            self.stage("audiveris", "blocked", message="Audiveris non installato")
            return None
        result = subprocess.run(
            [str(executable), "-batch", "-transcribe", "-export", "-save", "-output", str(destination), str(self.pdf)],
            capture_output=True, text=True, timeout=60 * 60, check=False,
        )
        (destination / "stdout.log").write_text(result.stdout or "", encoding="utf-8")
        (destination / "stderr.log").write_text(result.stderr or "", encoding="utf-8")
        candidates = sorted(destination.rglob("*.mxl")) + sorted(destination.rglob("*.musicxml"))
        if result.returncode or not candidates:
            self.stage("audiveris", "failed", exit_code=result.returncode, message="Nessun MusicXML esportato")
            return None
        target = materialize_musicxml(candidates[0], target)
        self.state["artifacts"]["candidate_a"] = str(target)
        self.stage("audiveris", "completed", metrics=musicxml_metrics(target))
        return target

    def run_crop_engine(self, engine: str, crop: Path, destination: Path) -> Path | None:
        destination.mkdir(parents=True, exist_ok=True)
        cached = destination / f"{engine}.musicxml"
        if candidate_score(cached) >= 0:
            return cached
        local_crop = destination / "input.pgm"
        shutil.copy2(crop, local_crop)
        if engine == "homr":
            command = ["uvx", "homr", str(local_crop)]
        else:
            command = ["uvx", "--from", "oemer", "oemer", str(local_crop), "-o", str(destination)]
        before = {path.resolve() for path in destination.rglob("*") if path.is_file()}
        if len(page_candidates) != len(pages):
            self.stage("neural_omr", "failed", message=f"Riconosciute {len(page_candidates)} pagine su {len(pages)}; candidato completo non generato")
            return None
        try:
            result = subprocess.run(command, cwd=destination, capture_output=True, text=True, timeout=15 * 60, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            (destination / "error.log").write_text(str(exc), encoding="utf-8")
            return None
        (destination / "stdout.log").write_text(result.stdout or "", encoding="utf-8")
        (destination / "stderr.log").write_text(result.stderr or "", encoding="utf-8")
        produced = [path for path in destination.rglob("*") if path.is_file() and path.resolve() not in before and path.suffix.lower() in {".musicxml", ".xml", ".mxl"}]
        if result.returncode or not produced:
            return None
        try:
            return materialize_musicxml(produced[0], destination / f"{engine}.musicxml")
        except (ValueError, ET.ParseError, OSError, zipfile.BadZipFile):
            return None

    def run_neural(self, pages: list[Path]) -> Path | None:
        cached = self.root / "candidates" / "candidate-b.musicxml"
        if candidate_score(cached) >= 0:
            self.state["artifacts"]["candidate_b"] = str(cached)
            self.stage("neural_omr", "cached", metrics=musicxml_metrics(cached))
            return cached
        layouts = []
        page_candidates = []
        for page_number, page in enumerate(pages, 1):
            page_home = self.root / "neural" / f"page-{page_number:03d}" / "homr-page"
            page_home.mkdir(parents=True, exist_ok=True)
            local_page = page_home / "input.pgm"
            shutil.copy2(page, local_page)
            page_xml = page_home / "input.musicxml"
            positions = page_home / "input.txt"
            if candidate_score(page_xml) < 0 or not positions.is_file():
                self.log(f"homr: riconoscimento completo e rilevamento pentagrammi pagina {page_number}")
                result = subprocess.run(
                    ["uvx", "homr", "--write-staff-positions", str(local_page)],
                    cwd=page_home, capture_output=True, text=True, timeout=30 * 60, check=False,
                )
                (page_home / "stdout.log").write_text(result.stdout or "", encoding="utf-8")
                (page_home / "stderr.log").write_text(result.stderr or "", encoding="utf-8")
            if candidate_score(page_xml) < 0 or not positions.is_file():
                layouts.append({"page": page.name, "error": "homr non ha prodotto MusicXML/coordinate", "crops": []})
                continue
            page_candidates.append(page_xml)
            crops = crops_from_homr_positions(page, positions, self.root / "staff-crops" / f"page-{page_number:03d}")
            layout = {"page": page.name, "staff_count": len(crops), "detector": "homr", "crops": crops}
            self.log(f"segmentazione homr pagina {page_number}: {len(crops)} pentagrammi")
            for crop_index, crop in enumerate(crops, 1):
                crop_path = Path(crop["path"])
                self.log(f"oemer: pagina {page_number}, pentagramma {crop['staff']}")
                result = self.run_crop_engine("oemer", crop_path, self.root / "neural" / f"page-{page_number:03d}" / f"crop-{crop_index:03d}" / "oemer")
                if result:
                    crop.update(oemer_xml=str(result), oemer_score=candidate_score(result))
                else:
                    crop["oemer_error"] = "oemer non ha prodotto MusicXML"
            layouts.append(layout)
            write_json(self.root / "reports" / "staff-layout.json", layouts)
        try:
            target = self.root / "candidates" / "candidate-b.musicxml"
            assembly = assemble_page_candidates(page_candidates, target)
        except (ValueError, ET.ParseError, OSError) as exc:
            self.stage("neural_omr", "failed", message=str(exc))
            return None
        self.state["artifacts"]["candidate_b"] = str(target)
        self.stage("neural_omr", "completed", assembly=assembly, metrics=musicxml_metrics(target))
        return target

    def codex_review(self, comparison: Path) -> None:
        codex = resolve_codex()
        if not self.use_codex or not codex:
            self.stage("codex_review", "skipped", message="Codex disabilitato o non disponibile")
            return
        review = self.root / "reports" / "codex-review.json"
        if review.is_file():
            try:
                json.loads(review.read_text(encoding="utf-8"))
                self.stage("codex_review", "cached")
                return
            except json.JSONDecodeError:
                pass
        prompt = """Read reports/discordance.json and the candidate MusicXML files. Create reports/codex-review.json.
Do not alter pitches, rhythms, lyrics, or any MusicXML. Do not choose notes by musical plausibility.
The JSON must contain: summary, feasibility, and review_priority (an array of part/measure/reason objects).
Prioritize deterministic disagreements and structural anomalies for a human score reviewer.
"""
        result = subprocess.run(
            [str(codex), "--ask-for-approval", "never", "exec", "--ephemeral", "--model", MODEL,
             "-c", f'model_reasoning_effort="{REASONING_EFFORT}"', "--sandbox", "workspace-write",
             "--skip-git-repo-check", "-C", str(self.root), "-"],
            input=prompt, capture_output=True, text=True, timeout=30 * 60, check=False,
        )
        (self.root / "reports" / "codex-review.log").write_text((result.stdout or "") + "\n" + (result.stderr or ""), encoding="utf-8")
        if result.returncode or not review.is_file():
            self.stage("codex_review", "failed", exit_code=result.returncode, message="Report Codex non prodotto")
        else:
            try:
                json.loads(review.read_text(encoding="utf-8"))
                self.stage("codex_review", "completed")
            except json.JSONDecodeError as exc:
                self.stage("codex_review", "failed", message=f"JSON non valido: {exc}")

    def build_review(self, base: Path, comparison: dict[str, Any]) -> None:
        review_xml = self.root / "review" / "review.musicxml"
        annotate_for_review(base, review_xml, comparison)
        musescore = resolve_tool("MuseScore4", "C:/Program Files/MuseScore 4/bin/MuseScore4.exe")
        if not musescore:
            self.stage("musescore", "blocked", message="MuseScore 4 non disponibile")
            return
        review_mscz = self.root / "review" / "review.mscz"
        preview_pdf = self.root / "review" / "review.pdf"
        first = subprocess.run([str(musescore), "-o", str(review_mscz), str(review_xml)], capture_output=True, text=True, timeout=5 * 60, check=False)
        second = subprocess.run([str(musescore), "-o", str(preview_pdf), str(review_mscz)], capture_output=True, text=True, timeout=5 * 60, check=False) if review_mscz.is_file() else None
        if first.returncode or not review_mscz.is_file() or second is None or second.returncode or not preview_pdf.is_file():
            self.stage("musescore", "failed", message="Import/export MuseScore fallito")
            return
        self.state["artifacts"].update(review_musicxml=str(review_xml), review_mscz=str(review_mscz), preview_pdf=str(preview_pdf))
        self.stage("musescore", "completed")

    def run(self) -> dict[str, Any]:
        self.root.mkdir(parents=True, exist_ok=True)
        try:
            analysis = analyze_pdf(self.pdf)
            self.stage("analysis", "completed", **analysis)
            dpi = 600 if analysis["kind"] == "scan" else 400
            pages = sorted((self.root / "preprocessed").glob("page-*.pgm"))
            if not pages or (analysis.get("pages") and len(pages) != analysis["pages"]):
                rendered = render_pdf(self.pdf, self.root / "rendered", dpi)
                pages = [preprocess_pgm(page, self.root / "preprocessed" / page.name) for page in rendered]
            low_resolution = bool(analysis.get("estimated_dpi") and analysis["estimated_dpi"] < 300)
            if low_resolution:
                self.state["warnings"].append("La sorgente è sotto 300 DPI: il preprocessing non può ricreare dettagli mancanti")
            self.stage("render", "completed", dpi=dpi, pages=len(pages), contrast_normalized=True, low_source_resolution=low_resolution)
            candidate_a = self.run_audiveris()
            candidate_b = self.run_neural(pages)
            if not candidate_a and not candidate_b:
                raise RuntimeError("Nessun motore OMR ha prodotto un candidato MusicXML")
            if candidate_a and candidate_b:
                comparison = compare_candidates(candidate_a, candidate_b)
                # Candidate A preserves full-page/system context; neural staff crops are
                # independent evidence, not authority for silently replacing it.
                base = candidate_a
            else:
                base = candidate_a or candidate_b
                signatures = ET.parse(base).getroot()
                comparison = {
                    "candidate_a": str(candidate_a) if candidate_a else None,
                    "candidate_b": str(candidate_b) if candidate_b else None,
                    "parts_match": False,
                    "discordances": [
                        {"part": pi, "measure": mi, "pitch_match": False, "rhythm_match": False, "reason": "Manca un secondo candidato indipendente"}
                        for pi, part in enumerate(signatures.findall("./part"), 1)
                        for mi, _ in enumerate(part.findall("measure"), 1)
                    ],
                }
                comparison["discordance_count"] = len(comparison["discordances"])
                self.state["warnings"].append("Un solo candidato disponibile: tutte le misure richiedono verifica")
            comparison["selected_base"] = str(base)
            comparison_path = self.root / "reports" / "discordance.json"
            write_json(comparison_path, comparison)
            self.state["artifacts"]["discordance_report"] = str(comparison_path)
            self.stage("comparison", "completed", discordances=comparison["discordance_count"], selected_base=str(base))
            self.codex_review(comparison_path)
            self.build_review(base, comparison)
            if self.state["stages"].get("musescore", {}).get("status") != "completed":
                raise RuntimeError("Artefatto MuseScore di revisione non prodotto")
            self.state.update(status="pending_human_review", updated_at=now())
        except Exception as exc:
            self.state.update(status="blocked", blocker=str(exc), updated_at=now())
            self.log(f"BLOCKER: {exc}")
        write_json(self.state_path, self.state)
        write_json(self.root / "reports" / "feasibility.json", self.state)
        self.log(f"FINE: {self.state['status']}")
        return self.state


def run_all(input_dir: Path, output_root: Path, *, use_codex: bool = True) -> list[dict[str, Any]]:
    results = []
    for pdf in sorted(input_dir.glob("*.pdf"), key=lambda path: path.name.lower()):
        results.append(Pipeline(pdf, output_root, use_codex=use_codex).run())
    return results
