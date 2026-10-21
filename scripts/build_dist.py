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
from check_deploy_config import https_origin

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DEFAULT_CONFIG = ROOT / "deploy" / "repertoire.json"
CORE_ASSETS = (
    "startup.js", "startup.css",
    "styles.css", "studio.css", "navigation.css", "ambient.css", "ambient.js", "score_viewer.css", "performances.css", "ui_preferences.js", "score_appearance.js",
    "practice_math.js", "score_runtime.js", "pitch_detector.js",
    "pitch_detector_worker.js", "pitch_shared.js", "fluid_pitch_trail.js",
    "microphone_calibration.js", "microphone_calibration_worker.js", "microphone_calibration_ui.js",
    "audio_sample_clock.js", "calibration_probe.js", "echo_cancellation.js", "echo_cancellation_worker.js", "echo_cancellation_ui.js", "echo_capture_worklet.js", "echo_monitor_worklet.js", "echo_delay.js", "echo_delay_worklet.js", "echo_diagnostics.js", "echo_diagnostic_worklet.js",
    "vocal_feedback.js", "one_euro_filter.js", "pitch_shifter_worklet.js", "media_mixer.js", "piano_roll.js",
    "performance_client.js", "performance_review.js", "recording_client.js", "progress_client.js", "aggregate_pitch.js",
    "cockpit.css", "cockpit.js", "pitch_lab.css", "pitch_lab_core.js", "pitch_lab_worker.js", "pitch_lab.js",
    "repertorio.css", "repertorio.js", "auth.css", "app.js", "voice_lab_core.js",
    "voice_lab.js", "voice_lab_curves.js", "score_viewer.js", "relax.css", "relax.js", "lissajous.js", "home.css", "home.js", "about.css", "about.js",
)
FORBIDDEN_TEXT = ("__pitchTestHooks", "/api/", "cdn.jsdelivr", "unpkg", "localhost")
API_CLIENT_ROUTES = {
    "voice_lab.": ("/api/me",),
    "performance_client.": ("/api/me", "/api/performances", "/api/groups"),
    "recording_client.": ("/api/recordings", "/api/echo-diagnostics"),
    "progress_client.": ("/api/progress",),
    "cockpit.": ("/api/me", "/api/cockpit"),
    "repertorio.": ("/api/me", "/api/progress"),
}
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


def page_asset_sort_key(path: str | Path) -> tuple[str, int]:
    """Sort MuseScore page assets numerically (1, 2, ... 10), not lexically."""
    name = Path(path).name
    match = re.search(r"-(\d+)\.svg$", name, re.IGNORECASE)
    return (name[:match.start(1)], int(match.group(1))) if match else (name, -1)


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
        display_title = str(item.get("display_title", "")).strip()
        if "display_title" in item and not display_title:
            raise ValueError(f"{piece_id}: display_title non può essere vuoto")
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
    generated = {"app.js", "pitch_detector_worker.js", "pitch_lab_worker.js", "pitch_lab.js", "microphone_calibration_worker.js", "microphone_calibration_ui.js", "echo_cancellation_worker.js", "echo_cancellation_ui.js", "echo_delay_worklet.js", "echo_diagnostics.js"}
    generated.update({"echo_capture_worklet.js", "echo_monitor_worklet.js", "echo_diagnostic_worklet.js", "calibration_probe.js"})
    names = {
        name: fingerprint_copy(FRONTEND / name, destination)
        for name in CORE_ASSETS
        if name not in generated
    }
    probe = (FRONTEND / 'calibration_probe.js').read_text(encoding='utf-8')
    for filename in ('bach-bwv846-1.wav', 'bach-bwv846-2.wav', 'MS-Basic-License.txt', 'manifest.json'):
        original = 'audio-calibration/' + filename
        names[original] = fingerprint_copy(FRONTEND / original, destination)
        probe = probe.replace(original, names[original])
    names['calibration_probe.js'] = fingerprint_text('calibration_probe.js', probe, destination)

    worker = (FRONTEND / "pitch_detector_worker.js").read_text(encoding="utf-8")
    worker = re.sub(
        r"pitch_detector\.js(?:\?v=[^'\"]+)?",
        names["pitch_detector.js"],
        worker,
    )
    names["pitch_detector_worker.js"] = fingerprint_text(
        "pitch_detector_worker.js", worker, destination,
    )

    lab_worker = (FRONTEND / "pitch_lab_worker.js").read_text(encoding="utf-8")
    lab_worker = lab_worker.replace("pitch_lab_core.js", names["pitch_lab_core.js"])
    names["pitch_lab_worker.js"] = fingerprint_text(
        "pitch_lab_worker.js", lab_worker, destination,
    )

    pitch_lab = (FRONTEND / "pitch_lab.js").read_text(encoding="utf-8")
    pitch_lab = pitch_lab.replace("pitch_lab_worker.js", names["pitch_lab_worker.js"])
    names["pitch_lab.js"] = fingerprint_text("pitch_lab.js", pitch_lab, destination)

    calibration_worker = (FRONTEND / "microphone_calibration_worker.js").read_text(encoding="utf-8")
    for dependency in ("pitch_detector.js", "microphone_calibration.js"):
        calibration_worker = calibration_worker.replace(dependency, names[dependency])
    names["microphone_calibration_worker.js"] = fingerprint_text("microphone_calibration_worker.js", calibration_worker, destination)
    calibration_ui = (FRONTEND / "microphone_calibration_ui.js").read_text(encoding="utf-8")
    calibration_ui = calibration_ui.replace("microphone_calibration_worker.js", names["microphone_calibration_worker.js"])
    names["microphone_calibration_ui.js"] = fingerprint_text("microphone_calibration_ui.js", calibration_ui, destination)

    for module in ("echo_capture_worklet.js", "echo_monitor_worklet.js", "echo_diagnostic_worklet.js"):
        worklet = (FRONTEND / module).read_text(encoding="utf-8")
        worklet = worklet.replace("audio_sample_clock.js", names["audio_sample_clock.js"])
        names[module] = fingerprint_text(module, worklet, destination)

    echo_worker = (FRONTEND / "echo_cancellation_worker.js").read_text(encoding="utf-8")
    echo_worker = echo_worker.replace("echo_cancellation.js", names["echo_cancellation.js"])
    echo_worker = echo_worker.replace("echo_delay.js", names["echo_delay.js"])
    names["echo_cancellation_worker.js"] = fingerprint_text("echo_cancellation_worker.js", echo_worker, destination)
    delay_worklet = (FRONTEND / "echo_delay_worklet.js").read_text(encoding="utf-8")
    for dependency in ("echo_cancellation.js", "echo_delay.js"):
        delay_worklet = delay_worklet.replace(dependency, names[dependency])
    names["echo_delay_worklet.js"] = fingerprint_text("echo_delay_worklet.js", delay_worklet, destination)
    echo_ui = (FRONTEND / "echo_cancellation_ui.js").read_text(encoding="utf-8")
    for dependency in ("echo_cancellation_worker.js", "echo_capture_worklet.js", "echo_monitor_worklet.js", "echo_delay_worklet.js"):
        echo_ui = echo_ui.replace(dependency, names[dependency])
    names["echo_cancellation_ui.js"] = fingerprint_text("echo_cancellation_ui.js", echo_ui, destination)
    diagnostic = (FRONTEND / "echo_diagnostics.js").read_text(encoding="utf-8")
    diagnostic = diagnostic.replace("echo_diagnostic_worklet.js", names["echo_diagnostic_worklet.js"])
    names["echo_diagnostics.js"] = fingerprint_text("echo_diagnostics.js", diagnostic, destination)

    app = (FRONTEND / "app.js").read_text(encoding="utf-8")
    app = re.sub(
        r"pitch_detector_worker\.js(?:\?v=[^'\"]+)?",
        names["pitch_detector_worker.js"],
        app,
    )
    app = re.sub(
        r"pitch_shifter_worklet\.js(?:\?v=[^'\"]+)?",
        names["pitch_shifter_worklet.js"],
        app,
    )
    names["app.js"] = fingerprint_text("app.js", app, destination)
    return names


def build_auth_client(destination: Path) -> dict[str, str]:
    """Bundle ClerkJS locally so production does not execute a third-party script."""
    npx = shutil.which("npx")
    if not npx:
        raise ValueError("Node/npm non trovato; eseguire npm install prima della build")
    names = {}
    try:
        for source, output in (
            ("auth-client.ts", "auth-client.js"),
            ("session-client.ts", "session-client.js"),
        ):
            subprocess.run([
                npx, "--no-install", "esbuild", str(FRONTEND / source),
                "--bundle", "--minify", "--platform=browser", "--target=es2022",
                f"--outfile={destination / output}",
            ], cwd=ROOT, check=True)
            names[output] = fingerprint_copy(destination / output, destination)
            # Keep revalidated aliases for HTML already open during a rollout.
    except FileNotFoundError as error:
        raise ValueError("Node/npm non trovato; eseguire npm install prima della build") from error
    except subprocess.CalledProcessError as error:
        raise ValueError("Build del client di autenticazione fallita") from error
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
    required.update(metadata.get("continuous_part_scores", {}).values())
    audio_manifest = json.loads((source / "audio-manifest.json").read_text(encoding="utf-8"))
    for mix in audio_manifest.get("mixes", {}).values():
        required.add(mix["file"])
        required.update(mix.get("files_by_speed", {}).values())
    if audio_manifest.get("full_mix_file"):
        required.add(audio_manifest["full_mix_file"])
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
    part_pages = {
        key: [f"{root}/{name}" for name in sorted(value, key=page_asset_sort_key)]
        for key, value in metadata["part_pages"].items()
    }
    continuous_scores = {
        key: f"{root}/{name}"
        for key, name in metadata.get("continuous_part_scores", {}).items()
    }
    if metadata.get("monodic"):
        written = next(iter(part_pages.values()))
        part_pages = {part_id: written for part_id in part_ids}
        if continuous_scores:
            written_continuous_score = next(iter(continuous_scores.values()))
            continuous_scores = {part_id: written_continuous_score for part_id in part_ids}
    bundle = {
        "piece_id": piece_id, "score_version_id": metadata["score_version_id"],
        "published": True, "local_source": False, "monodic": bool(metadata.get("monodic")), "parts": parts,
        "integrity": {"consistent": True, "hashes": {"timeline": sha256(source / "score.json")}}, "checks": [],
        "assets": {
            "score": f"{root}/score.json", "glyph_map": f"{root}/glyph-map.json",
            "audio_manifest": f"{root}/audio-manifest.json", "audio_root": root,
            "full_score_pages": [f"{root}/{name}" for name in sorted(metadata["score_pages"], key=page_asset_sort_key)], "score_pages": part_pages,
            "continuous_scores": continuous_scores,
        },
    }
    (target / "bundle.json").write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
    return {
        "piece_id": piece_id,
        "title": str(piece.get("display_title", "")).strip() or metadata["title"],
        "parts": parts,
        "monodic": bundle["monodic"],
    }


def write_headers(destination: Path, *, worker_config: Path = ROOT / "wrangler.jsonc") -> None:
    config = json.loads(worker_config.read_text(encoding="utf-8"))
    frontend_origin = config.get("vars", {}).get("CLERK_FRONTEND_API_ORIGIN")
    if not https_origin(frontend_origin) or re.search(r"[\s;'\"<>]", frontend_origin):
        raise ValueError("CLERK_FRONTEND_API_ORIGIN deve essere una singola origine HTTPS")
    (destination / "_headers").write_text("""/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://img.clerk.com; media-src 'self' blob:; connect-src 'self' CLERK_FRONTEND_API_ORIGIN https://*.protect.clerk.com:*; worker-src 'self' blob:; frame-src https://challenges.cloudflare.com https://*.protect.clerk.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: microphone=(self), camera=(), geolocation=()
  Strict-Transport-Security: max-age=31536000
  X-Robots-Tag: noindex, nofollow, noarchive

/index.html
  Cache-Control: no-cache

/cockpit.html
  Cache-Control: no-cache

/repertorio.html
  Cache-Control: no-cache

/relax.html
  Cache-Control: no-cache

/about.html
  Cache-Control: no-cache

/sign-in.html
  Cache-Control: no-store

/sign-up.html
  Cache-Control: no-store

/sign-out.html
  Cache-Control: no-store

/not-authorized.html
  Cache-Control: no-store

/*.js
  Cache-Control: no-cache

/*.css
  Cache-Control: no-cache

/library.json
  Cache-Control: public, max-age=31536000, immutable

/library-assets/*
  Cache-Control: public, max-age=31536000, immutable
""".replace("CLERK_FRONTEND_API_ORIGIN", frontend_origin), encoding="utf-8")


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
            # ClerkJS contains provider API and dormant development-origin
            # strings. CSP prevents connections to localhost in production;
            # CDN and test-hook markers remain forbidden in the pinned bundle.
            allowed_api_routes = next(
                (routes for prefix, routes in API_CLIENT_ROUTES.items()
                 if relative.startswith(prefix) and relative.endswith(".js")),
                None,
            )
            if allowed_api_routes:
                positions = [match.start() for match in re.finditer(r"/api/", text)]
                if any(not any(text.startswith(route, position) for route in allowed_api_routes)
                       for position in positions):
                    raise ValueError(f"Route API non autorizzata in {relative}")
            forbidden = (
                tuple(marker for marker in FORBIDDEN_TEXT if marker not in {"/api/", "localhost"})
                if re.fullmatch(r'(?:auth-client|session-client)(?:\.[a-f0-9]{12})?\.js', relative)
                else tuple(marker for marker in FORBIDDEN_TEXT if marker != "/api/")
                if allowed_api_routes
                else FORBIDDEN_TEXT
            )
            for marker in forbidden:
                if marker in text:
                    raise ValueError(f"Riferimento vietato {marker!r} in {relative}")
        hashes[relative] = sha256(path)
    return hashes


def main() -> int:
    audit_voice_lab_artifacts()
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--worker-config", type=Path, default=ROOT / "wrangler.jsonc")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    parser.add_argument(
        "--allow-dirty", action="store_true",
        help="opzione mantenuta per compatibilità; le build dirty sono consentite e marcate -dirty",
    )
    args = parser.parse_args()
    pieces = read_allowlist(args.config.resolve())
    dirty = worktree_is_dirty()
    destination = args.output.resolve()
    safe_clean(destination)
    auth_names = build_auth_client(destination)
    version = current_version(dirty=dirty)
    names = build_core_assets(destination)
    names.update(auth_names)
    index = (FRONTEND / "index.html").read_text(encoding="utf-8")
    index = re.sub(r'\s*<script src="https://cdn\.jsdelivr\.net/[^\n]+\n', "\n", index)
    index = re.sub(r'\s*<script src="pitch_test_harness\.js[^\n]+\n', "\n", index)
    for original, fingerprinted in names.items():
        index = re.sub(rf'{re.escape(original)}(?:\?v=[^"\']+)?', fingerprinted, index)
    runtime = "window.ChoirRuntimeConfig = Object.freeze(" + json.dumps({
        "mode": "production", "buildVersion": version, "libraryUrl": "library.json",
        "bundleUrlTemplate": "library-assets/{pieceId}/bundle.json", "benchmarkEventUrl": None,
        "crepeModelUrl": None, "crepeRuntimeScriptUrl": None, "crepeRuntimeBaseUrl": None,
        "features": {"diagnostics": False, "crepe": False, "transpose": True, "performances": True},
    }, ensure_ascii=False, separators=(",", ":")) + ");\n"
    temporary_runtime = destination / "runtime-config.js"
    temporary_runtime.write_text(runtime, encoding="utf-8")
    runtime_name = fingerprint_copy(temporary_runtime, destination)
    temporary_runtime.unlink()
    index = index.replace("runtime-config.js", runtime_name)
    (destination / "index.html").write_text(index, encoding="utf-8")
    cockpit_index = (FRONTEND / "cockpit.html").read_text(encoding="utf-8")
    for original, fingerprinted in names.items():
        cockpit_index = re.sub(rf'{re.escape(original)}(?:\?v=[^"\']+)?', fingerprinted, cockpit_index)
    (destination / "cockpit.html").write_text(cockpit_index, encoding="utf-8")
    repertoire_index = (FRONTEND / "repertorio.html").read_text(encoding="utf-8")
    for original, fingerprinted in names.items():
        repertoire_index = re.sub(rf'{re.escape(original)}(?:\?v=[^"\']+)?', fingerprinted, repertoire_index)
    (destination / "repertorio.html").write_text(repertoire_index, encoding="utf-8")
    lab_index = (FRONTEND / "voice-lab.html").read_text(encoding="utf-8")
    for original, fingerprinted in names.items():
        lab_index = re.sub(rf'{re.escape(original)}(?:\?v=[^"\']+)?', fingerprinted, lab_index)
    lab_index = lab_index.replace("runtime-config.js", runtime_name)
    (destination / "voice-lab.html").write_text(lab_index, encoding="utf-8")
    viewer_index = (FRONTEND / "score-viewer.html").read_text(encoding="utf-8")
    for original, fingerprinted in names.items():
        viewer_index = re.sub(rf'{re.escape(original)}(?:\?v=[^"\']+)?', fingerprinted, viewer_index)
    viewer_index = viewer_index.replace("runtime-config.js", runtime_name)
    (destination / "score-viewer.html").write_text(viewer_index, encoding="utf-8")
    relax_index = (FRONTEND / "relax.html").read_text(encoding="utf-8")
    for original, fingerprinted in names.items():
        relax_index = re.sub(rf'{re.escape(original)}(?:\?v=[^"\']+)?', fingerprinted, relax_index)
    (destination / "relax.html").write_text(relax_index, encoding="utf-8")
    about_index = (FRONTEND / "about.html").read_text(encoding="utf-8")
    for original, fingerprinted in names.items():
        about_index = re.sub(rf'{re.escape(original)}(?:\?v=[^"\']+)?', fingerprinted, about_index)
    (destination / "about.html").write_text(about_index, encoding="utf-8")
    for auth_page in ("sign-in.html", "sign-up.html", "sign-out.html", "not-authorized.html"):
        auth_index = (FRONTEND / auth_page).read_text(encoding="utf-8")
        for original, fingerprinted in names.items():
            auth_index = auth_index.replace(original, fingerprinted)
        (destination / auth_page).write_text(auth_index, encoding="utf-8")
    lab_assets = destination / "voice-lab-assets"
    lab_assets.mkdir()
    shutil.copy2(FRONTEND / "voice-lab-assets" / "manifest.json", lab_assets / "manifest.json")
    shutil.copytree(FRONTEND / "voice-lab-assets" / "choir", lab_assets / "choir")
    shutil.copytree(FRONTEND / "voice-lab-assets" / "phrases", lab_assets / "phrases")
    shutil.copytree(FRONTEND / "voice-lab-assets" / "pads", lab_assets / "pads")
    shutil.copytree(FRONTEND / "voice-lab-assets" / "scores", lab_assets / "scores")
    listings = [build_piece(piece, destination) for piece in pieces]
    (destination / "library.json").write_text(json.dumps({"pieces": listings}, ensure_ascii=False), encoding="utf-8")
    write_headers(destination, worker_config=args.worker_config)
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
