"""Persistent, resumable PDF -> reviewed-quality MuseScore draft batch worker."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import zipfile
from collections import deque
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable
from xml.etree import ElementTree as ET


MODEL = "gpt-5.6-sol"
REASONING_EFFORT = "high"
CAPACITY_MARKERS = (
    "rate limit", "rate_limit", "usage limit", "quota", "capacity", "try again later",
    "too many requests", "credit", "429",
)
GLOBAL_BLOCKER_MARKERS = (
    "not logged in", "authentication", "unauthorized", "model not found",
    "does not have access", "invalid model", "invalid_request_error",
    "unexpected argument", "usage: codex",
)


def now() -> str:
    return datetime.now(UTC).isoformat()


def slugify(name: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return value or "score"


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp.replace(path)


def discover_inputs(root: Path) -> list[Path]:
    return sorted((path for path in root.glob("*.pdf") if path.is_file()), key=lambda p: p.name.lower())


def resolve_codex() -> Path | None:
    """Resolve Codex from PATH or the bundled VS Code extension on Windows."""
    configured = os.environ.get("CHOIR_CODEX_EXECUTABLE")
    if configured and Path(configured).is_file():
        return Path(configured).resolve()
    discovered = shutil.which("codex")
    if discovered:
        return Path(discovered).resolve()
    if os.name == "nt":
        extensions = Path(os.environ.get("USERPROFILE", "")) / ".vscode" / "extensions"
        candidates = sorted(
            extensions.glob("openai.chatgpt-*/bin/windows-*/codex.exe"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        if candidates:
            return candidates[0].resolve()
    return None


@contextmanager
def job_lock(root: Path, *, force: bool = False):
    """Prevent two workers from consuming the same persistent queue."""
    lock = root / ".worker.lock"
    if force:
        lock.unlink(missing_ok=True)
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise RuntimeError(f"Un worker sembra già attivo ({lock}). Usa --force-unlock solo dopo averlo verificato.") from exc
    try:
        os.write(descriptor, f"pid={os.getpid()}\nstarted={now()}\n".encode())
        os.close(descriptor)
        yield
    finally:
        try:
            os.close(descriptor)
        except OSError:
            pass
        lock.unlink(missing_ok=True)


def create_or_resume_state(root: Path, pdfs: list[Path]) -> dict[str, Any]:
    state_path = root / "job-state.json"
    if state_path.is_file():
        state = json.loads(state_path.read_text(encoding="utf-8"))
    else:
        state = {
            "version": 1, "created_at": now(), "updated_at": now(), "status": "ready",
            "model": MODEL, "reasoning_effort": REASONING_EFFORT, "items": [],
        }
    known = {item["source"] for item in state["items"]}
    used_slugs = {item["slug"] for item in state["items"]}
    for pdf in pdfs:
        if pdf.name in known:
            continue
        base = slugify(pdf.stem)
        slug, counter = base, 2
        while slug in used_slugs:
            slug, counter = f"{base}-{counter}", counter + 1
        used_slugs.add(slug)
        state["items"].append({
            "source": pdf.name, "slug": slug, "status": "pending", "attempts": 0,
            "capacity_retries": 0, "validation": None, "error": None,
        })
    atomic_json(state_path, state)
    return state


def prompt_for(item: dict[str, Any], repair_feedback: list[str] | None = None) -> str:
    repair = ""
    if repair_feedback:
        repair = "\nThe previous draft failed these automatic checks:\n" + "\n".join(
            f"- {message}" for message in repair_feedback
        ) + "\nRepair the existing output/draft.mscz and validate it again.\n"
    return f"""Create a high-quality but minimal MuseScore transcription from input/{item['source']}.
This is an autonomous preparation job; the result will still require human admin approval.{repair}

Read every page and reproduce only what the PDF supports. Determine whether the source is SATB or a
single sung melody and preserve that scoring. Include every legible lyric, syllabification, key,
meter, tempo, repeat, ending and navigation mark. Add/reproduce an organ accompaniment. The staff
must remain named "Organo", but configure its playback channel with a pleasant MuseScore Basic
strings sound, preferably String Ensemble. Keep the notation clean and minimal. Never silently
invent unreadable notes: add visible "DA VERIFICARE:" staff text at each uncertainty.

Use the installed MuseScore 4 CLI at C:/Program Files/MuseScore 4/bin/MuseScore4.exe as needed.
The required final file is output/draft.mscz. Do not edit outside this workspace. Before finishing,
open or export the result with MuseScore CLI and ensure it is non-empty and structurally valid.
"""


def summarize_codex_event(line: str) -> str | None:
    """Turn Codex JSONL into a compact, user-facing progress message."""
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        return line.strip() or None
    event_type = event.get("type", "event")
    if event_type in {"thread.started", "turn.started"}:
        return event_type.replace(".", " ")
    if event_type in {"turn.completed", "turn.failed", "error"}:
        detail = event.get("message") or event.get("error") or event.get("usage")
        return f"{event_type.replace('.', ' ')}" + (f": {str(detail)[:300]}" if detail else "")
    item = event.get("item") or {}
    if event_type in {"item.started", "item.completed", "item.updated"}:
        item_type = item.get("type", "item")
        detail = item.get("text") or item.get("command") or item.get("status") or ""
        detail = re.sub(r"\s+", " ", str(detail)).strip()
        return f"{item_type} {event_type.split('.')[-1]}" + (f": {detail[:300]}" if detail else "")
    return None


def run_codex(
    work: Path,
    prompt: str,
    reports: Path,
    codex: Path | None = None,
    progress: Callable[[str, bool], None] | None = None,
) -> subprocess.CompletedProcess[str]:
    reports.mkdir(parents=True, exist_ok=True)
    args = [
        str(codex or resolve_codex() or "codex"), "--ask-for-approval", "never", "exec",
        "--ephemeral", "--model", MODEL,
        "-c", f'model_reasoning_effort="{REASONING_EFFORT}"',
        "--sandbox", "workspace-write",
        "--skip-git-repo-check", "--json", "-C", str(work),
        "--output-last-message", str(reports / "last-message.txt"), "-",
    ]
    stdout_tail: deque[str] = deque(maxlen=2500)
    stderr_tail: deque[str] = deque(maxlen=1000)
    write_lock = threading.Lock()
    with (reports / "events.jsonl").open("w", encoding="utf-8") as events, (reports / "stderr.log").open("w", encoding="utf-8") as errors:
        process = subprocess.Popen(
            args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace", cwd=work, bufsize=1,
        )
        assert process.stdin is not None
        process.stdin.write(prompt)
        process.stdin.close()

        def pump(stream, destination, tail: deque[str], is_event: bool) -> None:
            if stream is None:
                return
            for line in stream:
                with write_lock:
                    destination.write(line)
                    destination.flush()
                    tail.append(line)
                if progress:
                    summary = summarize_codex_event(line) if is_event else line.strip()
                    if summary:
                        progress(("Codex: " if is_event else "Codex stderr: ") + summary, False)

        readers = [
            threading.Thread(target=pump, args=(process.stdout, events, stdout_tail, True), daemon=True),
            threading.Thread(target=pump, args=(process.stderr, errors, stderr_tail, False), daemon=True),
        ]
        for reader in readers:
            reader.start()
        deadline = time.monotonic() + 60 * 60
        next_heartbeat = time.monotonic() + 30
        while process.poll() is None:
            if time.monotonic() >= deadline:
                process.kill()
                process.wait(timeout=15)
                raise subprocess.TimeoutExpired(args, 60 * 60)
            if time.monotonic() >= next_heartbeat:
                if progress:
                    progress(f"Codex ancora attivo (PID {process.pid})", True)
                next_heartbeat = time.monotonic() + 30
            time.sleep(1)
        for reader in readers:
            reader.join(timeout=5)
    return subprocess.CompletedProcess(args, process.returncode, "".join(stdout_tail), "".join(stderr_tail))


def classify_failure(result: subprocess.CompletedProcess[str]) -> str:
    output = ((result.stdout or "") + "\n" + (result.stderr or "")).lower()
    if any(marker in output for marker in GLOBAL_BLOCKER_MARKERS):
        return "global_blocker"
    if any(marker in output for marker in CAPACITY_MARKERS):
        return "capacity"
    return "execution"


def validate_mscz(mscz: Path, musescore: Path, validation_dir: Path) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    if not mscz.is_file() or mscz.stat().st_size < 100:
        return {"passed": False, "errors": ["draft.mscz assente o vuoto"], "warnings": []}
    validation_dir.mkdir(parents=True, exist_ok=True)
    musicxml = validation_dir / "score.musicxml"
    result = subprocess.run(
        [str(musescore), "-o", str(musicxml), str(mscz)], capture_output=True, text=True,
        timeout=180, check=False,
    )
    (validation_dir / "musescore.log").write_text((result.stdout or "") + "\n" + (result.stderr or ""), encoding="utf-8")
    if result.returncode != 0 or not musicxml.is_file():
        return {"passed": False, "errors": [f"MuseScore non riesce ad aprire/esportare il file (exit {result.returncode})"], "warnings": []}
    try:
        xml = ET.parse(musicxml).getroot()
    except ET.ParseError as exc:
        return {"passed": False, "errors": [f"MusicXML esportato non valido: {exc}"], "warnings": []}
    measures = xml.findall("./part/measure")
    notes = [note for note in xml.findall(".//note") if note.find("pitch") is not None]
    lyrics = xml.findall(".//lyric/text")
    part_names = [element.text.strip() for element in xml.findall("./part-list/score-part/part-name") if element.text]
    lower_names = " ".join(part_names).lower()
    if len(measures) < 4:
        errors.append(f"solo {len(measures)} misure esportate")
    if len(notes) < 12:
        errors.append(f"solo {len(notes)} note intonate esportate")
    if not lyrics:
        errors.append("nessun testo cantato rilevato")
    if not any(token in lower_names for token in ("organ", "organo")):
        errors.append("parte Organo non rilevata")
    vocal_tokens = ("sopran", "alto", "contralto", "tenor", "bass", "canto", "voce", "voice", "melod", "choir", "coro")
    if not any(token in lower_names for token in vocal_tokens):
        warnings.append("nome della parte vocale non riconosciuto; verificare manualmente")
    try:
        with zipfile.ZipFile(mscz) as archive:
            score_names = [name for name in archive.namelist() if name.lower().endswith(".mscx")]
            score_text = archive.read(score_names[0]).decode("utf-8", errors="ignore").lower() if score_names else ""
            if not any(token in score_text for token in ("string ensemble", "strings", "string section")):
                warnings.append("suono archi MuseScore Basic non confermato nel contenuto MSCZ")
    except (zipfile.BadZipFile, OSError):
        warnings.append("contenuto MSCZ non ispezionabile come archivio")
    return {
        "passed": not errors, "errors": errors, "warnings": warnings,
        "metrics": {"parts": part_names, "measures": len(measures), "pitched_notes": len(notes), "lyrics": len(lyrics)},
    }


def write_report(root: Path, state: dict[str, Any]) -> None:
    reports = root / "reports"
    reports.mkdir(exist_ok=True)
    atomic_json(reports / "feasibility-report.json", state)
    lines = ["# Report di fattibilità MSCZ", "", f"Stato: **{state['status']}**", f"Aggiornato: {state['updated_at']}", ""]
    for item in state["items"]:
        lines += [f"## {item['source']}", "", f"- Stato: `{item['status']}`", f"- Tentativi: {item['attempts']}"]
        if item.get("output"):
            lines.append(f"- Output: `{item['output']}`")
        if item.get("error"):
            lines.append(f"- Blocker/errore: {item['error']}")
        validation = item.get("validation") or {}
        for error in validation.get("errors", []):
            lines.append(f"- Controllo fallito: {error}")
        for warning in validation.get("warnings", []):
            lines.append(f"- Avviso: {warning}")
        lines.append("")
    (reports / "feasibility-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_batch(root: Path, *, max_attempts: int = 2, capacity_retries: int = 96, retry_seconds: int = 900) -> dict[str, Any]:
    root = root.resolve()
    pdfs = discover_inputs(root)
    state = create_or_resume_state(root, pdfs)
    worker_log = root / "reports" / "worker.log"
    worker_log.parent.mkdir(exist_ok=True)
    log_lock = threading.Lock()

    def log(message: str) -> None:
        line = f"[{datetime.now().astimezone():%Y-%m-%d %H:%M:%S}] {message}"
        with log_lock:
            print(line, flush=True)
            with worker_log.open("a", encoding="utf-8") as stream:
                stream.write(line + "\n")

    log(f"Avvio/ripresa job: {len(pdfs)} PDF, modello {MODEL}, reasoning {REASONING_EFFORT}")
    musescore = Path("C:/Program Files/MuseScore 4/bin/MuseScore4.exe")
    state["status"] = "running"
    if not pdfs:
        state.update(status="blocked", blocker="Nessun PDF trovato", updated_at=now())
        atomic_json(root / "job-state.json", state); write_report(root, state); return state
    codex = resolve_codex()
    if not codex or not musescore.is_file():
        missing = [name for name, available in (("Codex CLI", codex), ("MuseScore 4", musescore.is_file())) if not available]
        state.update(status="blocked", blocker="Dipendenze mancanti: " + ", ".join(missing), updated_at=now())
        atomic_json(root / "job-state.json", state); write_report(root, state); return state

    work_root, output_root = root / ".work", root / "output"
    work_root.mkdir(exist_ok=True); output_root.mkdir(exist_ok=True)
    global_blocker = None
    for item in state["items"]:
        if item["status"] == "completed":
            log(f"SKIP {item['source']}: già completato")
            continue
        work = work_root / item["slug"]
        (work / "input").mkdir(parents=True, exist_ok=True)
        (work / "output").mkdir(exist_ok=True)
        shutil.copy2(root / item["source"], work / "input" / item["source"])
        existing_draft = work / "output" / "draft.mscz"
        if existing_draft.is_file() and item.get("validation") is None:
            log(f"RECOVERY {item['source']}: valido la bozza trovata dopo una precedente interruzione")
            recovered = validate_mscz(existing_draft, musescore, work / "validation" / "recovered")
            item["validation"] = recovered
            if recovered["passed"]:
                destination = output_root / f"{item['slug']}.mscz"
                shutil.copy2(existing_draft, destination)
                item.update(status="completed", output=str(destination.relative_to(root)), error=None, completed_at=now())
                state["updated_at"] = now(); atomic_json(root / "job-state.json", state); write_report(root, state)
                log(f"COMPLETATO {item['source']}: bozza recuperata e promossa in {destination.relative_to(root)}")
                continue
        feedback = (item.get("validation") or {}).get("errors")
        while item["attempts"] < max_attempts:
            item.update(status="running", attempts=item["attempts"] + 1, error=None, updated_at=now())
            state["updated_at"] = now(); atomic_json(root / "job-state.json", state)
            log(f"INIZIO {item['source']}: tentativo {item['attempts']}/{max_attempts}")

            def progress(message: str, heartbeat: bool) -> None:
                log(f"{item['source']} | {message}")
                if heartbeat:
                    item.update(heartbeat_at=now(), phase="codex_running")
                    state["updated_at"] = now()
                    atomic_json(root / "job-state.json", state)
            try:
                result = run_codex(work, prompt_for(item, feedback), work / "reports" / f"attempt-{item['attempts']}", codex, progress)
            except subprocess.TimeoutExpired:
                log(f"TIMEOUT {item['source']}: Codex oltre 60 minuti")
                item.update(status="failed", error="Codex ha superato il timeout di 60 minuti"); break
            if result.returncode != 0:
                kind = classify_failure(result)
                if kind == "capacity" and item["capacity_retries"] < capacity_retries:
                    item.update(status="waiting_for_capacity", capacity_retries=item["capacity_retries"] + 1, error="Capacità/quota temporaneamente non disponibile")
                    atomic_json(root / "job-state.json", state); write_report(root, state)
                    log(f"ATTESA {item['source']}: capacità/quota non disponibile, nuovo tentativo tra {retry_seconds}s")
                    time.sleep(max(1, retry_seconds)); item["attempts"] -= 1; continue
                if kind == "global_blocker":
                    global_blocker = "Autenticazione o modello Codex non disponibile; vedere il log dell'ultimo tentativo"
                    item.update(status="blocked", error=global_blocker); break
                item.update(status="failed", error=f"Codex terminato con exit code {result.returncode}"); continue
            log(f"VALIDAZIONE {item['source']}: apro ed esporto la bozza con MuseScore")
            validation = validate_mscz(work / "output" / "draft.mscz", musescore, work / "validation" / f"attempt-{item['attempts']}")
            item["validation"] = validation
            if validation["passed"]:
                destination = output_root / f"{item['slug']}.mscz"
                shutil.copy2(work / "output" / "draft.mscz", destination)
                item.update(status="completed", output=str(destination.relative_to(root)), error=None, completed_at=now())
                log(f"COMPLETATO {item['source']}: {validation['metrics']}")
                break
            feedback = validation["errors"]
            log(f"RETRY QUALITÀ {item['source']}: {'; '.join(feedback)}")
            item.update(status="quality_retry", error="La bozza non supera i controlli automatici")
        if item["status"] not in {"completed", "blocked"}:
            item.update(status="infeasible_or_manual", error=item.get("error") or "Qualità automatica insufficiente dopo i tentativi consentiti")
        state["updated_at"] = now(); atomic_json(root / "job-state.json", state); write_report(root, state)
        if global_blocker:
            break
    if global_blocker:
        for pending in state["items"]:
            if pending["status"] == "pending":
                pending.update(status="blocked", error="Non avviato a causa del blocker globale")
    complete = all(item["status"] == "completed" for item in state["items"])
    state.update(status="completed" if complete else "completed_with_blockers", updated_at=now())
    if global_blocker:
        state["blocker"] = global_blocker
    atomic_json(root / "job-state.json", state); write_report(root, state)
    log(f"FINE JOB: {state['status']}")
    return state
