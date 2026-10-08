"""Serve the frontend with HTTP byte ranges required by HTML media seeking."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import shutil
import tempfile
import threading
import re
import sys
import math
import hashlib
import time
import zipfile
from copy import deepcopy
from urllib.parse import urlparse, parse_qs
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.choir_assistant.ingestion.codex_musescore import run_codex_draft
from backend.choir_assistant.ingestion.job_store import JobStore, sha256_file
from backend.choir_assistant.ingestion.service import submit_ingestion
from backend.choir_assistant.ingestion.musicxml import compile_musicxml

DATA_ROOT = ROOT / "data"
SHEETS_ROOT = ROOT / "sheets"
LIBRARY_ASSETS_ROOT = ROOT / "frontend" / "library-assets"
MUSESCORE_CANDIDATES = (
    Path(r"C:\Program Files\MuseScore 4\bin\MuseScore4.exe"),
)
_library_lock = threading.Lock()
LIBRARY_ASSET_LAYOUT_VERSION = 10
DEFAULT_SCORE_TEMPO_BPM = 80.0
SOURCE_FINGERPRINT_VERSION = 1
_IGNORED_MSCZ_MEMBERS = frozenset({"META-INF/container.xml", "viewsettings.json"})
_IGNORED_MSCX_SCORE_TAGS = frozenset({"showInvisible", "showUnprintable", "showFrames", "showMargins", "open"})
_IGNORED_MSCX_META_TAGS = frozenset({"audioComUrl", "platform", "sourceRevisionId"})


def _musescore() -> str:
    executable = shutil.which("MuseScore4") or shutil.which("musescore4")
    if executable:
        return executable
    candidate = next((path for path in MUSESCORE_CANDIDATES if path.is_file()), None)
    if candidate:
        return str(candidate)
    raise RuntimeError("MuseScore 4 non disponibile: non posso preparare il brano selezionato")


def _is_accompaniment(name: str) -> bool:
    return bool(re.search(
        r"\b(organo|organ|piano|accompagnamento|accompaniment|archi|string(?:s)?|orchestra|viol(?:ino|ini|a|e)|cello|contrabbasso)\b",
        name,
        re.I,
    ))


def _library_sources() -> list[Path]:
    return sorted(path for path in SHEETS_ROOT.glob("*/*.mscz") if path.is_file())


def _piece_id(value: str) -> str:
    return value.lower().replace("_", "-")


def _strip_xml_indentation(element: ET.Element) -> None:
    if element.text is not None and not element.text.strip():
        element.text = None
    if element.tail is not None and not element.tail.strip():
        element.tail = None
    for child in element:
        _strip_xml_indentation(child)


def _canonical_mscx(payload: bytes) -> bytes:
    """Remove editor-only state while preserving notation, layout and playback data."""
    root = ET.fromstring(payload)
    score = root.find("Score")
    if score is not None:
        for child in list(score):
            if child.tag in _IGNORED_MSCX_SCORE_TAGS:
                score.remove(child)
            elif child.tag == "metaTag" and child.get("name") in _IGNORED_MSCX_META_TAGS:
                score.remove(child)
    for parent in root.iter():
        for child in list(parent):
            if child.tag == "eid":
                parent.remove(child)
    _strip_xml_indentation(root)
    xml = ET.tostring(root, encoding="unicode")
    return ET.canonicalize(xml_data=xml).encode("utf-8")


def _canonical_json(payload: bytes) -> bytes:
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return payload
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _source_hashes(source: Path) -> tuple[str, str]:
    """Return raw provenance and a stable build fingerprint for a MuseScore archive."""
    payload = source.read_bytes()
    raw_hash = hashlib.sha256(payload).hexdigest()
    if source.suffix.lower() != ".mscz":
        return raw_hash, raw_hash
    try:
        digest = hashlib.sha256()
        with zipfile.ZipFile(source) as archive:
            members = sorted(name for name in archive.namelist()
                             if name not in _IGNORED_MSCZ_MEMBERS
                             and not name.lower().startswith("thumbnails/"))
            for name in members:
                member = archive.read(name)
                if name.lower().endswith(".mscx"):
                    member = _canonical_mscx(member)
                elif name.lower().endswith(".json"):
                    member = _canonical_json(member)
                encoded_name = name.encode("utf-8")
                digest.update(len(encoded_name).to_bytes(4, "big"))
                digest.update(encoded_name)
                digest.update(len(member).to_bytes(8, "big"))
                digest.update(member)
        return raw_hash, digest.hexdigest()
    except (OSError, ValueError, zipfile.BadZipFile, ET.ParseError):
        return raw_hash, raw_hash


def _write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as temporary:
            json.dump(payload, temporary, ensure_ascii=False)
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def _cached_library_metadata(metadata_path: Path, raw_hash: str, semantic_hash: str) -> dict | None:
    if not metadata_path.is_file():
        return None
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if metadata.get("layout_version") != LIBRARY_ASSET_LAYOUT_VERSION:
        return None
    semantic_match = (metadata.get("source_fingerprint_version") == SOURCE_FINGERPRINT_VERSION
                      and metadata.get("source_semantic_sha256") == semantic_hash)
    legacy_raw_match = metadata.get("source_semantic_sha256") is None and metadata.get("source_sha256") == raw_hash
    if not semantic_match and not legacy_raw_match:
        return None
    if legacy_raw_match:
        metadata["source_fingerprint_version"] = SOURCE_FINGERPRINT_VERSION
        metadata["source_semantic_sha256"] = semantic_hash
        _write_json_atomic(metadata_path, metadata)
    elif metadata.get("source_sha256") != raw_hash:
        # Preserve the latest archive checksum for diagnostics without
        # invalidating derivatives whose meaningful contents are unchanged.
        metadata["source_sha256"] = raw_hash
        _write_json_atomic(metadata_path, metadata)
    return metadata


def _wait_for_file(path: Path, timeout: float = 8.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.is_file() and path.stat().st_size:
            return
        time.sleep(.1)
    raise RuntimeError(f"MuseScore non ha prodotto {path.name}")


def _tempo_directions(root: ET.Element) -> list[tuple[int, str | None, ET.Element]]:
    """Return score-level tempo directions that MuseScore may store in one part only."""
    directions = []
    for part in root.findall("part"):
        for measure_index, measure in enumerate(part.findall("measure")):
            for direction in measure.findall("direction"):
                if direction.find(".//sound[@tempo]") is not None or direction.find(".//metronome") is not None:
                    directions.append((measure_index, measure.get("number"), direction))
    return directions


def _ensure_explicit_tempo(root: ET.Element, bpm: float = DEFAULT_SCORE_TEMPO_BPM) -> bool:
    """Give MuseScore the same fallback tempo used by the timeline compiler."""
    if _tempo_directions(root):
        return False
    first_measure = root.find("./part/measure")
    if first_measure is None:
        return False
    tempo_text = f"{bpm:g}"
    direction = ET.Element("direction", {"placement": "above"})
    direction_type = ET.SubElement(direction, "direction-type")
    metronome = ET.SubElement(direction_type, "metronome")
    ET.SubElement(metronome, "beat-unit").text = "quarter"
    ET.SubElement(metronome, "per-minute").text = tempo_text
    ET.SubElement(direction, "sound", {"tempo": tempo_text})
    insertion_index = 1 if first_measure.find("attributes") is not None else 0
    first_measure.insert(insertion_index, direction)
    return True


def _ensure_global_tempo(root: ET.Element,
                         directions: list[tuple[int, str | None, ET.Element]]) -> None:
    """Keep filtered MusicXML stems at the same tempo as the complete score."""
    measures = root.findall("./part/measure")
    for measure_index, measure_number, direction in directions:
        target = next((measure for measure in measures if measure_number is not None
                       and measure.get("number") == measure_number), None)
        if target is None and measure_index < len(measures):
            target = measures[measure_index]
        if target is None or target.find(".//sound[@tempo]") is not None or target.find(".//metronome") is not None:
            continue
        insertion_index = 1 if target.find("attributes") is not None else 0
        target.insert(insertion_index, deepcopy(direction))


def _export_part_svg(musicxml: Path, destination: Path, part_id: str, executable: str,
                     tempo_directions: list[tuple[int, str | None, ET.Element]]) -> list[str]:
    """Render one vocal staff, never the SATB/organ full-score page."""
    tree = ET.parse(musicxml)
    root = tree.getroot()
    part_list = root.find("part-list")
    if part_list is None:
        raise RuntimeError("MusicXML senza elenco parti")
    for score_part in list(part_list.findall("score-part")):
        if score_part.get("id") != part_id:
            part_list.remove(score_part)
    for part in list(root.findall("part")):
        if part.get("id") != part_id:
            root.remove(part)
    _ensure_global_tempo(root, tempo_directions)
    source = destination / f"part-{part_id}.musicxml"
    tree.write(source, encoding="utf-8", xml_declaration=True)
    output = destination / f"part-{part_id}.svg"
    for old in destination.glob(f"part-{part_id}-*.svg"):
        old.unlink(missing_ok=True)
    result = subprocess.run([executable, "-f", "-o", str(output), str(source)],
                            capture_output=True, text=True, timeout=180, check=False)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "MuseScore part export failed").strip()[-600:])
    first_page = destination / f"part-{part_id}-1.svg"
    _wait_for_file(first_page)
    return [path.name for path in sorted(destination.glob(f"part-{part_id}-*.svg"))]


def _export_audio_stem(source: Path, output: Path, executable: str) -> None:
    output.unlink(missing_ok=True)
    result = subprocess.run([executable, "-f", "-o", str(output), str(source)],
                            capture_output=True, text=True, timeout=180, check=False)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "MuseScore stem export failed").strip()[-600:])
    _wait_for_file(output)


def _source_part_ids(source: Path) -> list[str]:
    """Return MuseScore's part ids in score order from an MSCZ archive."""
    try:
        with zipfile.ZipFile(source) as archive:
            score_name = next(name for name in archive.namelist() if name.lower().endswith(".mscx"))
            root = ET.fromstring(archive.read(score_name))
    except (OSError, ValueError, StopIteration, zipfile.BadZipFile, ET.ParseError):
        return []
    return [part_id for part in root.findall("./Score/Part")
            if (part_id := part.get("id")) is not None]


def _write_audio_subset_source(source: Path, destination: Path,
                               included_part_ids: set[str]) -> bool:
    """Copy an MSCZ while muting every playback track outside the requested parts.

    Exporting stems from this archive, rather than round-tripped MusicXML, keeps
    the user's MS Basic/Muse Sounds assignments and mixer settings intact.
    """
    try:
        with zipfile.ZipFile(source) as archive:
            settings = json.loads(archive.read("audiosettings.json").decode("utf-8"))
            tracks = settings.get("tracks")
            if not isinstance(tracks, list):
                return False
            matched = False
            for track in tracks:
                part_id = str(track.get("partId", ""))
                enabled = part_id in included_part_ids
                matched = matched or enabled
                track["soloMuteState"] = {"mute": not enabled, "solo": False}
            if not matched:
                return False
            with zipfile.ZipFile(destination, "w") as output:
                for item in archive.infolist():
                    payload = (json.dumps(settings, ensure_ascii=False, indent=4).encode("utf-8")
                               if item.filename == "audiosettings.json" else archive.read(item.filename))
                    output.writestr(item, payload)
    except (OSError, KeyError, UnicodeDecodeError, ValueError, zipfile.BadZipFile):
        return False
    return True


def _export_source_audio_subset(source: Path, output: Path, executable: str,
                                included_part_ids: set[str]) -> bool:
    handle, temporary_name = tempfile.mkstemp(prefix=f".{source.stem}-", suffix=".mscz",
                                               dir=output.parent)
    os.close(handle)
    temporary = Path(temporary_name)
    try:
        if not _write_audio_subset_source(source, temporary, included_part_ids):
            return False
        _export_audio_stem(temporary, output, executable)
        return True
    finally:
        temporary.unlink(missing_ok=True)


def _build_library_piece(source: Path) -> dict:
    """Build browser-only derivatives of a user-owned MSCZ source on demand."""
    piece_id = _piece_id(source.parent.name)
    destination = LIBRARY_ASSETS_ROOT / piece_id
    metadata_path = destination / "metadata.json"
    raw_source_hash, semantic_source_hash = _source_hashes(source)
    cached = _cached_library_metadata(metadata_path, raw_source_hash, semantic_source_hash)
    if cached is not None:
        return cached
    with _library_lock:
        # Another request may have completed this piece while we waited. Also
        # re-read the source in case MuseScore saved it during that interval.
        raw_source_hash, semantic_source_hash = _source_hashes(source)
        cached = _cached_library_metadata(metadata_path, raw_source_hash, semantic_source_hash)
        if cached is not None:
            return cached
        destination.mkdir(parents=True, exist_ok=True)
        musicxml = destination / "score.musicxml"
        score_svg = destination / "score.svg"
        score_audio = destination / "score.mp3"
        executable = _musescore()
        for output in (musicxml, score_audio):
            output.unlink(missing_ok=True)
        for old_svg in destination.glob("score-*.svg"):
            old_svg.unlink(missing_ok=True)
        # Export MusicXML first, then make its tempo explicit. The timeline
        # compiler defaults to 80 BPM for scores without a tempo marking,
        # whereas MuseScore's audio exporter defaults to 120 BPM. Exporting
        # audio from this normalized MusicXML keeps both clocks identical.
        result = subprocess.run(
            [executable, "-f", "-o", str(musicxml), str(source)],
            capture_output=True, text=True, timeout=180, check=False,
        )
        if result.returncode:
            raise RuntimeError((result.stderr or result.stdout or "MuseScore export failed").strip()[-600:])
        _wait_for_file(musicxml)
        musicxml_tree = ET.parse(musicxml)
        source_has_explicit_tempo = bool(_tempo_directions(musicxml_tree.getroot()))
        if _ensure_explicit_tempo(musicxml_tree.getroot()):
            musicxml_tree.write(musicxml, encoding="utf-8", xml_declaration=True)

        for output, export_source in ((score_svg, source), (score_audio, musicxml)):
            result = subprocess.run(
                [executable, "-f", "-o", str(output), str(export_source)],
                capture_output=True, text=True, timeout=180, check=False,
            )
            if result.returncode:
                raise RuntimeError((result.stderr or result.stdout or "MuseScore export failed").strip()[-600:])
            # MuseScore names multipage SVG output score-1.svg, score-2.svg…
            # rather than the requested score.svg.
            _wait_for_file(destination / "score-1.svg" if output == score_svg else output)
        score_version_id = f"local-{piece_id}-{semantic_source_hash[:12]}"
        score = compile_musicxml(musicxml, score_version_id=score_version_id)
        payload = score.to_dict()
        score_json = destination / "score.json"
        score_json.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        vocal_parts = [part for part in payload["parts"] if not _is_accompaniment(part["name"])]
        complete_root = ET.parse(musicxml).getroot()
        tempo_directions = _tempo_directions(complete_root)
        source_part_ids = _source_part_ids(source)
        source_part_by_exported_id = {
            part["id"]: source_part_id
            for part, source_part_id in zip(payload["parts"], source_part_ids)
        }
        preserve_source_sounds = source_has_explicit_tempo and len(source_part_ids) == len(payload["parts"])
        if preserve_source_sounds:
            preserve_source_sounds = _export_source_audio_subset(
                source, score_audio, executable, set(source_part_ids),
            )
        part_pages = {
            part["id"]: _export_part_svg(musicxml, destination, part["id"], executable, tempo_directions)
            for part in vocal_parts
        }
        voice_stems = {}
        for part in vocal_parts:
            filename = f"voice-{part['id']}.mp3"
            preserved = preserve_source_sounds and _export_source_audio_subset(
                source, destination / filename, executable,
                {source_part_by_exported_id[part["id"]]},
            )
            if not preserved:
                _export_audio_stem(destination / f"part-{part['id']}.musicxml", destination / filename, executable)
                preserve_source_sounds = False
            voice_stems[part["id"]] = filename
        vocal_ids = {part["id"] for part in vocal_parts}
        tree = ET.parse(musicxml)
        root = tree.getroot()
        part_list = root.find("part-list")
        if part_list is not None:
            for score_part in list(part_list.findall("score-part")):
                if score_part.get("id") in vocal_ids:
                    part_list.remove(score_part)
        for part in list(root.findall("part")):
            if part.get("id") in vocal_ids:
                root.remove(part)
        _ensure_global_tempo(root, tempo_directions)
        accompaniment_file = None
        if root.findall("part"):
            accompaniment_source = destination / "accompaniment.musicxml"
            tree.write(accompaniment_source, encoding="utf-8", xml_declaration=True)
            accompaniment_file = "accompaniment.mp3"
            accompaniment_ids = ({
                source_part_by_exported_id[part["id"]]
                for part in payload["parts"] if part["id"] not in vocal_ids
            } if preserve_source_sounds else set())
            preserved = preserve_source_sounds and _export_source_audio_subset(
                source, destination / accompaniment_file, executable, accompaniment_ids,
            )
            if not preserved:
                _export_audio_stem(accompaniment_source, destination / accompaniment_file, executable)
                preserve_source_sounds = False
        metadata = {
            "layout_version": LIBRARY_ASSET_LAYOUT_VERSION,
            "piece_id": piece_id,
            "title": payload["title"],
            "source_sha256": raw_source_hash,
            "source_fingerprint_version": SOURCE_FINGERPRINT_VERSION,
            "source_semantic_sha256": semantic_source_hash,
            "score_version_id": score_version_id,
            "parts": vocal_parts,
            "monodic": len(vocal_parts) == 1,
            "score_pages": [path.name for path in sorted(destination.glob("score-*.svg"))],
            "part_pages": part_pages,
            "voice_stems": voice_stems,
            "accompaniment_file": accompaniment_file,
            "source_playback_sounds_preserved": preserve_source_sounds,
        }
        _write_json_atomic(metadata_path, metadata)
        return metadata


def _library_listing() -> list[dict]:
    items = []
    for source in _library_sources():
        piece_id = _piece_id(source.parent.name)
        cached = LIBRARY_ASSETS_ROOT / piece_id / "metadata.json"
        raw_hash, semantic_hash = _source_hashes(source)
        metadata = _cached_library_metadata(cached, raw_hash, semantic_hash)
        if metadata is not None:
            try:
                items.append({key: metadata[key] for key in ("piece_id", "title", "parts", "monodic")})
                continue
            except KeyError:
                pass
        # The full build happens only after the singer chooses the piece.
        items.append({"piece_id": piece_id, "title": source.stem.replace("-", " ").title(), "parts": [], "monodic": False})
    return items


class RangeRequestHandler(SimpleHTTPRequestHandler):
    _range: tuple[int, int] | None = None

    def end_headers(self):
        request_path = self.path.split("?", 1)[0]
        # `/` resolves to index.html but does not have an .html suffix.  It
        # must not be cached independently from the versionless application
        # scripts, otherwise a new app.js can run against an old DOM.
        if request_path == "/" or request_path.endswith((".html", ".js", ".json")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/library":
            return self._send_json({"pieces": _library_listing()})
        if parsed.path.startswith("/api/library/") and parsed.path.endswith("/bundle"):
            return self._library_bundle(parsed.path)
        if self.path.startswith('/api/transpose?'):
            return self._transpose_audio()
        if self.path.startswith("/api/ingestions/"):
            parts = self.path.split("?", 1)[0].strip("/").split("/")
            try:
                job_id = parts[2]
                store = JobStore(DATA_ROOT)
                manifest = store.get(job_id)
                if len(parts) == 4 and parts[3] == "draft":
                    draft = store.job_dir(job_id) / "output" / "draft.mscz"
                    if manifest["status"] != "pending_admin_review" or not draft.is_file():
                        raise FileNotFoundError("draft")
                    return self._send_file(draft, f"{manifest['piece_id']}-bozza.mscz")
                return self._send_json(manifest)
            except (FileNotFoundError, ValueError, IndexError):
                self.send_error(HTTPStatus.NOT_FOUND, "Ingestion not found")
                return
        if self.path == "/api/musescore-source":
            source = Path(__file__).resolve().parents[1] / "data/omr-ecco/ecco-mvp.mscz"
            if not source.exists():
                self.send_error(HTTPStatus.NOT_FOUND, "MuseScore source unavailable")
                return
            payload = source.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", 'attachment; filename="ecco-mvp.mscz"')
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        return super().do_GET()

    def _library_bundle(self, path: str):
        piece_id = path.removeprefix("/api/library/").removesuffix("/bundle").strip("/")
        source = next((item for item in _library_sources() if _piece_id(item.parent.name) == piece_id), None)
        if source is None:
            self._send_json({"error": "Brano non trovato"}, HTTPStatus.NOT_FOUND)
            return
        try:
            metadata = _build_library_piece(source)
            root = f"library-assets/{piece_id}"
            timeline_hash = hashlib.sha256((LIBRARY_ASSETS_ROOT / piece_id / "score.json").read_bytes()).hexdigest()
            part_ids = (["mono-soprano", "mono-contralto", "mono-tenore", "mono-basso"]
                        if metadata["monodic"] else [part["id"] for part in metadata["parts"]])
            practice_parts = ([
                {"id": "mono-soprano", "name": "Soprano"}, {"id": "mono-contralto", "name": "Contralto"},
                {"id": "mono-tenore", "name": "Tenore"}, {"id": "mono-basso", "name": "Basso"},
            ] if metadata["monodic"] else metadata["parts"])
            score_pages = [f"{root}/{name}" for name in metadata["score_pages"]]
            part_pages = {
                part_id: [f"{root}/{name}" for name in metadata["part_pages"][part_id]]
                for part_id in metadata["part_pages"]
            }
            if metadata["monodic"]:
                written_pages = next(iter(part_pages.values()))
                part_pages = {part_id: written_pages for part_id in part_ids}
            asset_root = LIBRARY_ASSETS_ROOT / piece_id
            (asset_root / "glyph-map.json").write_text("{}", encoding="utf-8")
            (asset_root / "audio-manifest.json").write_text(json.dumps({
                "score_version_id": metadata["score_version_id"], "timeline_hash": timeline_hash,
                "mixes": {part_id: {"file": "score.mp3", "files_by_speed": {}} for part_id in part_ids},
                "full_mix_file": "score.mp3",
                "accompaniment_file": metadata.get("accompaniment_file"),
                "voice_stems": metadata.get("voice_stems", {}),
            }), encoding="utf-8")
            self._send_json({
                "piece_id": piece_id,
                "score_version_id": metadata["score_version_id"],
                "local_source": True,
                "monodic": metadata["monodic"],
                "parts": practice_parts,
                "integrity": {"consistent": True, "hashes": {"timeline": timeline_hash}},
                "checks": [],
                "assets": {
                    "score": f"{root}/score.json",
                    "glyph_map": f"{root}/glyph-map.json",
                    "audio_manifest": f"{root}/audio-manifest.json",
                    "audio_root": root,
                    "full_score_pages": score_pages,
                    "score_pages": part_pages,
                },
            })
        except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
            self._send_json({"error": str(error)}, HTTPStatus.UNPROCESSABLE_ENTITY)

    def _transpose_audio(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            semitones = int(query['semitones'][0])
            if not -12 <= semitones <= 12:
                raise ValueError('Invalid transposition')
            frontend_root = (ROOT / 'frontend').resolve()
            source = (frontend_root / query['file'][0]).resolve()
            if not source.is_relative_to(frontend_root) or source.suffix.lower() not in ('.mp3', '.wav', '.ogg') or not source.is_file():
                raise ValueError('Invalid audio source')
            executable = shutil.which('ffmpeg')
            fallback = Path(r'C:\Program Files\FFmpeg\Providers\org.buanzo.ffmpeg8.1\bin\ffmpeg.exe')
            if not executable and fallback.is_file():
                executable = str(fallback)
            if not executable:
                raise ValueError('FFmpeg unavailable: transposition requires FFmpeg')
            ratio = math.pow(2, semitones / 12)
            result = subprocess.run([
                executable, '-v', 'error', '-i', str(source), '-af',
                f'aresample=48000,asetrate={48000 * ratio},aresample=48000,atempo={1 / ratio}',
                '-f', 'wav', '-acodec', 'pcm_s16le', 'pipe:1'
            ], capture_output=True, timeout=60, check=True)
            # FFmpeg cannot finalize WAV sizes on a pipe. Replace the streaming
            # placeholders so HTMLMediaElement can buffer and seek normally.
            payload = bytearray(result.stdout)
            payload[4:8] = (len(payload) - 8).to_bytes(4, 'little')
            offset = 12
            while offset + 8 <= len(payload):
                size = int.from_bytes(payload[offset + 4:offset + 8], 'little')
                if payload[offset:offset + 4] == b'data':
                    payload[offset + 4:offset + 8] = (len(payload) - offset - 8).to_bytes(4, 'little')
                    break
                offset += 8 + size + size % 2
            start, end = 0, len(payload) - 1
            range_header = self.headers.get('Range', '')
            if range_header.startswith('bytes='):
                first, _, last = range_header[6:].split(',', 1)[0].partition('-')
                start = int(first or 0)
                end = min(int(last) if last else end, end)
                if start > end or start < 0:
                    raise ValueError('Invalid byte range')
            self.send_response(HTTPStatus.PARTIAL_CONTENT if range_header else HTTPStatus.OK)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Accept-Ranges', 'bytes')
            if range_header:
                self.send_header('Content-Range', f'bytes {start}-{end}/{len(payload)}')
            self.send_header('Content-Length', str(end - start + 1))
            self.end_headers()
            self.wfile.write(payload[start:end + 1])
        except (KeyError, ValueError, OSError, subprocess.SubprocessError) as error:
            self._send_json({'error': str(error)}, HTTPStatus.UNPROCESSABLE_ENTITY)

    def _send_json(self, payload, status=HTTPStatus.OK):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _send_file(self, path, filename):
        payload = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            source = open(path, "rb")
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None
        size = os.fstat(source.fileno()).st_size
        start, end = 0, max(0, size - 1)
        range_header = self.headers.get("Range")
        if range_header and range_header.startswith("bytes="):
            requested = range_header.removeprefix("bytes=").split(",", 1)[0]
            first, _, last = requested.partition("-")
            try:
                if first:
                    start = int(first)
                    end = min(int(last) if last else end, end)
                elif last:
                    start = max(0, size - int(last))
            except ValueError:
                source.close()
                self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                return None
            if start > end or start >= size:
                source.close()
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return None
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self._range = (start, end)
        else:
            self.send_response(HTTPStatus.OK)
            self._range = None
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(os.fstat(source.fileno()).st_mtime))
        self.end_headers()
        source.seek(start)
        return source

    def copyfile(self, source, outputfile):
        if self._range is None:
            return super().copyfile(source, outputfile)
        remaining = self._range[1] - self._range[0] + 1
        while remaining:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    def do_POST(self):
        if self.path == "/api/benchmark-event":
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length > 4096:
                self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Diagnostic payload too large")
                return
            try:
                payload = json.loads(self.rfile.read(content_length) or b"{}")
            except (ValueError, UnicodeDecodeError):
                self.send_error(HTTPStatus.BAD_REQUEST, "Invalid diagnostic payload")
                return
            action = str(payload.get("action", "unknown"))[:80]
            recorder_state = str(payload.get("recorderState", "unknown"))[:40]
            print(f"[benchmark-ui] {action} recorder={recorder_state}", flush=True)
            return self._send_json({"ok": True})
        if self.path == "/api/ingestions":
            return self._create_ingestion()
        if self.path.startswith("/api/ingestions/") and self.path.endswith("/revision"):
            return self._upload_revision()
        if self.path != "/api/import-musescore":
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown API route")
            return
        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0 or content_length > 25 * 1024 * 1024:
            self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Upload limit is 25 MB")
            return
        message = BytesParser(policy=default).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + self.rfile.read(content_length)
        )
        upload = next((part for part in message.walk() if part.get_param("name", header="content-disposition") == "file"), None)
        filename = upload.get_filename( ) if upload else ""
        if upload is None or not filename.lower().endswith(".mscz"):
            self.send_error(HTTPStatus.BAD_REQUEST, "Upload an .mscz file")
            return
        root = Path(__file__).resolve().parents[1]
        with tempfile.NamedTemporaryFile(suffix=".mscz", delete=False) as handle:
            temp_path = Path(handle.name)
            handle.write(upload.get_payload(decode=True) or b"")
        try:
            result = subprocess.run(["python", str(root / "scripts/import_musescore_revision.py"), str(temp_path)],
                                    cwd=root, capture_output=True, text=True, timeout=180, check=False)
            payload = {"ok": result.returncode == 0, "output": result.stdout[-4000:], "error": result.stderr[-4000:]}
            self.send_response(HTTPStatus.OK if payload["ok"] else HTTPStatus.UNPROCESSABLE_ENTITY)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            encoded = json.dumps(payload).encode("utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
        finally:
            temp_path.unlink(missing_ok=True)

    def _multipart(self, limit=25 * 1024 * 1024):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > limit:
            raise ValueError("Upload vuoto o superiore a 25 MB")
        content_type = self.headers.get("Content-Type", "")
        return BytesParser(policy=default).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + self.rfile.read(length)
        )

    def _create_ingestion(self):
        try:
            message = self._multipart()
            upload = next((p for p in message.walk() if p.get_param("name", header="content-disposition") == "file"), None)
            piece = next((p for p in message.walk() if p.get_param("name", header="content-disposition") == "piece_id"), None)
            filename = upload.get_filename() if upload else ""
            piece_id = (piece.get_content().strip() if piece else "")
            if not upload or not filename.lower().endswith(".pdf") or not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,63}", piece_id):
                raise ValueError("Servono un PDF e un ID brano in minuscolo (lettere, numeri e trattini)")
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
                temp_path = Path(handle.name)
                handle.write(upload.get_payload(decode=True) or b"")
            try:
                manifest = submit_ingestion(temp_path, piece_id, DATA_ROOT)
                job_dir = JobStore(DATA_ROOT).job_dir(manifest["job_id"])
                stored = job_dir / "input" / Path(filename).name
                current = Path(manifest["source"]["stored_path"])
                if stored != current:
                    current.rename(stored)
                    manifest["source"].update(filename=Path(filename).name, stored_path=str(stored), sha256=sha256_file(stored))
                    manifest["artifacts"][0].update(path=str(stored), sha256=manifest["source"]["sha256"])
                    JobStore(DATA_ROOT).write_manifest(job_dir, manifest)
            finally:
                temp_path.unlink(missing_ok=True)
            JobStore(DATA_ROOT).update(manifest["job_id"], status="queued_for_codex", next_action="wait_for_codex")
            threading.Thread(target=run_codex_draft, args=(manifest["job_id"], DATA_ROOT), daemon=True).start()
            self._send_json({"ok": True, "job_id": manifest["job_id"], "status": "queued_for_codex"}, HTTPStatus.ACCEPTED)
        except (ValueError, OSError) as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def _upload_revision(self):
        try:
            job_id = self.path.strip("/").split("/")[2]
            store = JobStore(DATA_ROOT)
            job_dir = store.job_dir(job_id)
            message = self._multipart()
            upload = next((p for p in message.walk() if p.get_param("name", header="content-disposition") == "file"), None)
            if not upload or not (upload.get_filename() or "").lower().endswith(".mscz"):
                raise ValueError("Carica un file .mscz")
            destination = job_dir / "output" / "admin-revision.mscz"
            destination.parent.mkdir(exist_ok=True)
            destination.write_bytes(upload.get_payload(decode=True) or b"")
            if not destination.stat().st_size:
                raise ValueError("Il file è vuoto")
            manifest = store.get(job_id)
            manifest["artifacts"] = [a for a in manifest["artifacts"] if a["kind"] != "admin_revision_mscz"]
            manifest["artifacts"].append({"kind": "admin_revision_mscz", "path": str(destination), "sha256": sha256_file(destination)})
            manifest.update(status="admin_revision_uploaded", next_action="validate_and_publish")
            store.write_manifest(job_dir, manifest)
            store.append_event(job_dir, {"event": "admin_revision_uploaded", "status": manifest["status"]})
            self._send_json({"ok": True, "job_id": job_id, "status": manifest["status"]})
        except (ValueError, OSError, IndexError) as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5173)
    args = parser.parse_args()
    frontend = Path(__file__).resolve().parents[1] / "frontend"
    handler = lambda *handler_args, **kwargs: RangeRequestHandler(*handler_args, directory=str(frontend), **kwargs)
    print(f"Practice frontend: http://{args.host}:{args.port}")
    ThreadingHTTPServer((args.host, args.port), handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
