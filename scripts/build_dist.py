"""Build statica, minimale e fail-closed per il sito privato dei coristi."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

from check_voice_lab_artifacts import audit_voice_lab_artifacts

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DEFAULT_CONFIG = ROOT / "deploy" / "repertoire.json"
CORE_ASSETS = (
    "styles.css", "studio.css", "ui_preferences.js", "score_appearance.js",
    "practice_math.js", "score_runtime.js", "pitch_detector.js",
    "pitch_detector_worker.js", "pitch_shared.js", "fluid_pitch_trail.js",
    "vocal_feedback.js", "one_euro_filter.js", "app.js", "voice_lab_core.js",
    "voice_draw_core.js", "voice_lab.js",
)
FORBIDDEN_TEXT = ("__pitchTestHooks", "/api/", "cdn.jsdelivr", "unpkg", "localhost")
FORBIDDEN_SUFFIXES = (".mscz", ".env", ".py", ".map", ".musicxml", ".xml", ".onnx")
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_FILES = 20_000
PLACEHOLDER_RIGHTS_NOTES = {
    "motivo o riferimento dell'autorizzazione",
    "motivo o riferimento dell’autorizzazione",
    "todo",
    "tbd",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def worktree_is_dirty() -> bool:
    try:
        status = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=normal"], cwd=ROOT,
            check=True, capture_output=True, text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return True
    return bool(status)


def current_version(*, dirty: bool = False) -> str:
    try:
        revision = subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"], cwd=ROOT,
            check=True, capture_output=True, text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        revision = "nogit"
    suffix = "-dirty" if dirty else ""
    return f"{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{revision}{suffix}"


def read_allowlist(path: Path) -> list[dict]:
    pieces = json.loads(path.read_text(encoding="utf-8")).get("pieces")
    if not isinstance(pieces, list) or not pieces:
        raise ValueError("Allowlist vuota: approvare esplicitamente almeno un brano prima della build")
    seen: set[str] = set()
    for item in pieces:
        piece_id = item.get("id", "")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", piece_id) or piece_id in seen:
            raise ValueError(f"ID brano non valido o duplicato: {piece_id!r}")
        if item.get("publication_approved") is not True:
            raise ValueError(f"{piece_id}: publication_approved deve essere true")
        rights_note = str(item.get("rights_note", "")).strip()
        if not rights_note:
            raise ValueError(f"{piece_id}: manca rights_note")
        if rights_note.casefold() in PLACEHOLDER_RIGHTS_NOTES:
            raise ValueError(f"{piece_id}: rights_note è ancora un segnaposto")
        seen.add(piece_id)
    return pieces


def safe_clean(destination: Path) -> None:
    resolved = destination.resolve()
    if resolved == ROOT or ROOT not in resolved.parents:
        raise ValueError(f"Destinazione non sicura: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)
    resolved.mkdir(parents=True)


def fingerprint_copy(source: Path, destination: Path) -> str:
    name = f"{source.stem}.{sha256(source)[:12]}{source.suffix}"
    shutil.copy2(source, destination / name)
    return name


def fingerprint_text(source_name: str, contents: str, destination: Path) -> str:
    temporary = destination / source_name
    temporary.write_text(contents, encoding="utf-8")
    name = fingerprint_copy(temporary, destination)
    temporary.unlink()
    return name


def build_core_assets(destination: Path) -> dict[str, str]:
    """Copy core assets while preserving dependencies between hashed scripts."""
    generated = {"app.js", "pitch_detector_worker.js"}
    names = {
        name: fingerprint_copy(FRONTEND / name, destination)
        for name in CORE_ASSETS
        if name not in generated
    }

    worker = (FRONTEND / "pitch_detector_worker.js").read_text(encoding="utf-8")
    worker = re.sub(
        r"pitch_detector\.js(?:\?v=[^'\"]+)?",
        names["pitch_detector.js"],
        worker,
    )
    names["pitch_detector_worker.js"] = fingerprint_text(
        "pitch_detector_worker.js", worker, destination,
    )

    app = (FRONTEND / "app.js").read_text(encoding="utf-8")
    app = re.sub(
        r"pitch_detector_worker\.js(?:\?v=[^'\"]+)?",
        names["pitch_detector_worker.js"],
        app,
    )
    names["app.js"] = fingerprint_text("app.js", app, destination)
    return names


def audit_local_references(destination: Path) -> None:
    """Fail the release when generated HTML or worker entry points return 404."""
    patterns = {
        ".html": re.compile(r"(?:src|href)=[\"']([^\"']+)[\"']"),
        ".js": re.compile(r"(?:new\s+Worker|importScripts)\(\s*[\"']([^\"']+)[\"']"),
    }
    missing: list[str] = []
    for path in destination.rglob("*"):
        pattern = patterns.get(path.suffix.lower())
        if not path.is_file() or pattern is None:
            continue
        for raw_reference in pattern.findall(path.read_text(encoding="utf-8")):
            parsed = urlsplit(raw_reference)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            relative = unquote(parsed.path).lstrip("/")
            target = destination / relative if parsed.path.startswith("/") else path.parent / relative
            if not target.is_file():
                missing.append(f"{path.relative_to(destination).as_posix()} -> {raw_reference}")
    if missing:
        raise ValueError("Riferimenti locali assenti nella build: " + ", ".join(sorted(missing)))


def build_piece(piece: dict, destination: Path) -> dict:
    piece_id = piece["id"]
    source = FRONTEND / "library-assets" / piece_id
    metadata_path = source / "metadata.json"
    if not metadata_path.is_file():
        raise ValueError(
            f"{piece_id}: metadata.json non trovato; eseguire "
            f"python scripts/build_library_bundle.py {piece_id}"
        )
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("piece_id") != piece_id:
        raise ValueError(f"{piece_id}: metadata incoerente")

    target = destination / "library-assets" / piece_id
    target.mkdir(parents=True)
    required = {"score.json", "glyph-map.json", "audio-manifest.json"}
    required.update(metadata.get("score_pages", []))
    for pages in metadata.get("part_pages", {}).values():
        required.update(pages)
    audio_manifest = json.loads((source / "audio-manifest.json").read_text(encoding="utf-8"))
    for mix in audio_manifest.get("mixes", {}).values():
        required.add(mix["file"])
        required.update(mix.get("files_by_speed", {}).values())
    if audio_manifest.get("accompaniment_file"):
        required.add(audio_manifest["accompaniment_file"])
    required.update(audio_manifest.get("voice_stems", {}).values())
    for name in sorted(required):
        src = source / name
        if not src.is_file() or src.resolve().parent != source.resolve():
            raise ValueError(f"{piece_id}: asset richiesto assente o non sicuro: {name}")
        shutil.copy2(src, target / name)

    root = f"library-assets/{piece_id}"
    part_ids = (["mono-soprano", "mono-contralto", "mono-tenore", "mono-basso"]
                if metadata.get("monodic") else [part["id"] for part in metadata["parts"]])
    parts = ([
        {"id": "mono-soprano", "name": "Soprano"}, {"id": "mono-contralto", "name": "Contralto"},
        {"id": "mono-tenore", "name": "Tenore"}, {"id": "mono-basso", "name": "Basso"},
    ] if metadata.get("monodic") else metadata["parts"])
    part_pages = {key: [f"{root}/{name}" for name in value] for key, value in metadata["part_pages"].items()}
    if metadata.get("monodic"):
        written = next(iter(part_pages.values()))
        part_pages = {part_id: written for part_id in part_ids}
    bundle = {
        "piece_id": piece_id, "score_version_id": metadata["score_version_id"],
        "published": True, "local_source": False, "monodic": bool(metadata.get("monodic")), "parts": parts,
        "integrity": {"consistent": True, "hashes": {"timeline": sha256(source / "score.json")}}, "checks": [],
        "assets": {
            "score": f"{root}/score.json", "glyph_map": f"{root}/glyph-map.json",
            "audio_manifest": f"{root}/audio-manifest.json", "audio_root": root,
            "full_score_pages": [f"{root}/{name}" for name in metadata["score_pages"]], "score_pages": part_pages,
        },
    }
    (target / "bundle.json").write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
    return {"piece_id": piece_id, "title": metadata["title"], "parts": parts, "monodic": bundle["monodic"]}


def write_headers(destination: Path) -> None:
    (destination / "_headers").write_text("""/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: microphone=(self), camera=(), geolocation=()
  Strict-Transport-Security: max-age=31536000
  X-Robots-Tag: noindex, nofollow, noarchive

/index.html
  Cache-Control: no-cache

/*.js
  Cache-Control: public, max-age=31536000, immutable

/*.css
  Cache-Control: public, max-age=31536000, immutable

/library-assets/*
  Cache-Control: public, max-age=31536000, immutable
""", encoding="utf-8")


def audit(destination: Path) -> dict[str, str]:
    files = [path for path in destination.rglob("*") if path.is_file()]
    if len(files) > MAX_FILES:
        raise ValueError(f"Troppi file: {len(files)} > {MAX_FILES}")
    hashes: dict[str, str] = {}
    for path in files:
        relative = path.relative_to(destination).as_posix()
        if path.stat().st_size > MAX_FILE_BYTES:
            raise ValueError(f"File oltre 25 MiB: {relative}")
        if path.name == ".env" or path.suffix.lower() in FORBIDDEN_SUFFIXES:
            raise ValueError(f"File vietato nella build: {relative}")
        if path.name.lower().startswith(("ort.", "onnxruntime")):
            raise ValueError(f"Runtime neurale vietato nella build: {relative}")
        if path.suffix.lower() in {".html", ".js", ".css", ".json", ""}:
            text = path.read_text(encoding="utf-8")
            for marker in FORBIDDEN_TEXT:
                if marker in text:
                    raise ValueError(f"Riferimento vietato {marker!r} in {relative}")
        hashes[relative] = sha256(path)
    return hashes


def main() -> int:
    audit_voice_lab_artifacts()
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    parser.add_argument(
        "--allow-dirty", action="store_true",
        help="consente una build diagnostica locale, marcata -dirty e non pubblicabile",
    )
    args = parser.parse_args()
    pieces = read_allowlist(args.config.resolve())
    dirty = worktree_is_dirty()
    if dirty and not args.allow_dirty:
        raise ValueError(
            "working tree non pulito: committare le modifiche prima di creare una release "
            "oppure usare --allow-dirty solo per una verifica locale"
        )
    destination = args.output.resolve()
    safe_clean(destination)
    version = current_version(dirty=dirty)
    names = build_core_assets(destination)
    index = (FRONTEND / "index.html").read_text(encoding="utf-8")
    index = re.sub(r'\s*<script src="https://cdn\.jsdelivr\.net/[^\n]+\n', "\n", index)
    index = re.sub(r'\s*<script src="pitch_test_harness\.js[^\n]+\n', "\n", index)
    for original, fingerprinted in names.items():
        index = re.sub(rf'{re.escape(original)}(?:\?v=[^"\']+)?', fingerprinted, index)
    runtime = "window.ChoirRuntimeConfig = Object.freeze(" + json.dumps({
        "mode": "production", "buildVersion": version, "libraryUrl": "library.json",
        "bundleUrlTemplate": "library-assets/{pieceId}/bundle.json", "benchmarkEventUrl": None,
        "crepeModelUrl": None, "crepeRuntimeScriptUrl": None, "crepeRuntimeBaseUrl": None,
        "features": {"diagnostics": False, "crepe": False, "transpose": False},
    }, ensure_ascii=False, separators=(",", ":")) + ");\n"
    temporary_runtime = destination / "runtime-config.js"
    temporary_runtime.write_text(runtime, encoding="utf-8")
    runtime_name = fingerprint_copy(temporary_runtime, destination)
    temporary_runtime.unlink()
    index = index.replace("runtime-config.js", runtime_name)
    (destination / "index.html").write_text(index, encoding="utf-8")
    lab_index = (FRONTEND / "voice-lab.html").read_text(encoding="utf-8")
    for original, fingerprinted in names.items():
        lab_index = re.sub(rf'{re.escape(original)}(?:\?v=[^"\']+)?', fingerprinted, lab_index)
    lab_index = lab_index.replace("runtime-config.js", runtime_name)
    (destination / "voice-lab.html").write_text(lab_index, encoding="utf-8")
    lab_assets = destination / "voice-lab-assets"
    lab_assets.mkdir()
    for source in (FRONTEND / "voice-lab-assets").iterdir():
        if source.is_dir() or source.name == "manifest.json" or source.name == "choir-voice-c4.wav" or source.suffix == ".svg":
            if source.is_dir():
                shutil.copytree(source, lab_assets / source.name)
            else:
                shutil.copy2(source, lab_assets / source.name)
    listings = [build_piece(piece, destination) for piece in pieces]
    (destination / "library.json").write_text(json.dumps({"pieces": listings}, ensure_ascii=False), encoding="utf-8")
    write_headers(destination)
    audit_local_references(destination)
    hashes = audit(destination)
    manifest = {"build_version": version, "created_at": datetime.now(timezone.utc).isoformat(),
                "pieces": [piece["id"] for piece in pieces], "files": hashes}
    (destination / "deployment-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Build {version}: {len(hashes) + 1} file, {len(pieces)} brani -> {destination}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"Build non eseguita: {error}")
        raise SystemExit(2) from None
