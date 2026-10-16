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
REPERTOIRE_CONFIG = ROOT / "deploy" / "repertoire.json"
MUSESCORE_CANDIDATES = (
    Path(r"C:\Program Files\MuseScore 4\bin\MuseScore4.exe"),
)
_library_lock = threading.Lock()
_musicxml_sync_lock = threading.Lock()
LIBRARY_ASSET_LAYOUT_VERSION = 15
MUSICXML_SYNC_VERSION = 1
DEFAULT_SCORE_TEMPO_BPM = 80.0
SOURCE_FINGERPRINT_VERSION = 2
SOURCE_PLAYBACK_EXPORT_VERSION = 1
CONTINUOUS_PAGE_HEIGHT_TENTHS = 520.0
CONTINUOUS_PAGE_MARGIN_TENTHS = 40.0
CONTINUOUS_HORIZONTAL_PADDING_TENTHS = 900.0
_IGNORED_MSCZ_MEMBERS = frozenset({"META-INF/container.xml", "viewsettings.json"})
_IGNORED_MSCX_SCORE_TAGS = frozenset({"showInvisible", "showUnprintable", "showFrames", "showMargins", "open"})
_IGNORED_MSCX_META_TAGS = frozenset({"audioComUrl", "platform", "sourceRevisionId"})


def _page_asset_sort_key(path: str | Path) -> tuple[str, int]:
    """Sort MuseScore page assets numerically (1, 2, ... 10), not lexically."""
    name = Path(path).name
    match = re.search(r"-(\d+)\.svg$", name, re.IGNORECASE)
    return (name[:match.start(1)], int(match.group(1))) if match else (name, -1)


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
    return sorted(
        path for path in SHEETS_ROOT.glob("*/*.mscz")
        if path.is_file() and path.parent.name != "voice-lab"
    )


def _piece_id(value: str) -> str:
    return value.lower().replace("_", "-")


def _repertoire_piece(piece_id: str) -> dict:
    try:
        pieces = json.loads(REPERTOIRE_CONFIG.read_text(encoding="utf-8")).get("pieces", [])
    except (OSError, ValueError):
        return {}
    return next((item for item in pieces if item.get("id") == piece_id), {})


def _xml_local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _adjacent_musicxml_source(source: Path) -> Path | None:
    """Find the editorial MusicXML beside an MSCZ when one is available."""

    exact = [source.with_suffix(".xml"), source.with_suffix(".musicxml")]
    for candidate in exact:
        if candidate.is_file():
            return candidate
    candidates = sorted((*source.parent.glob("*.xml"), *source.parent.glob("*.musicxml")))
    return candidates[0] if len(candidates) == 1 else None


def _key_declarations(root: ET.Element) -> list[tuple[int, str | None, ET.Element]]:
    declarations: list[tuple[int, str | None, ET.Element]] = []
    for key in root.iter():
        if _xml_local_name(key.tag) != "key":
            continue
        fifths_element = next(
            (child for child in key if _xml_local_name(child.tag) == "fifths"), None
        )
        if fifths_element is None or not fifths_element.text:
            continue
        mode_element = next(
            (child for child in key if _xml_local_name(child.tag) == "mode"), None
        )
        mode = (mode_element.text or "").strip().lower() if mode_element is not None else None
        declarations.append((int(float(fifths_element.text)), mode or None, key))
    return declarations


def _source_key_modes(source: Path) -> list[tuple[int, str | None]]:
    musicxml = _adjacent_musicxml_source(source)
    if musicxml is None:
        return []
    try:
        root = ET.parse(musicxml).getroot()
    except (OSError, ET.ParseError):
        return []
    return [(fifths, mode) for fifths, mode, _ in _key_declarations(root)]


def _restore_explicit_key_modes(root: ET.Element, source: Path) -> bool:
    """Restore editorial modes that MuseScore may omit from its XML export."""

    source_declarations = _source_key_modes(source)
    target_declarations = _key_declarations(root)
    if not source_declarations or not target_declarations:
        return False

    if (len(source_declarations) == len(target_declarations)
            and [item[0] for item in source_declarations]
            == [item[0] for item in target_declarations]):
        desired_modes = [mode for _, mode in source_declarations]
    else:
        modes_by_fifths: dict[int, set[str]] = {}
        for fifths, mode in source_declarations:
            if mode:
                modes_by_fifths.setdefault(fifths, set()).add(mode)
        unique_modes = {
            fifths: next(iter(modes)) for fifths, modes in modes_by_fifths.items()
            if len(modes) == 1
        }
        desired_modes = [unique_modes.get(fifths) for fifths, _, _ in target_declarations]

    changed = False
    for (_, current_mode, key), desired_mode in zip(target_declarations, desired_modes):
        if not desired_mode or current_mode == desired_mode:
            continue
        mode_element = next(
            (child for child in key if _xml_local_name(child.tag) == "mode"), None
        )
        if mode_element is None:
            namespace = key.tag[:-3] if key.tag.endswith("key") else ""
            mode_element = ET.Element(f"{namespace}mode")
            fifths_index = next(
                index for index, child in enumerate(key)
                if _xml_local_name(child.tag) == "fifths"
            )
            key.insert(fifths_index + 1, mode_element)
        mode_element.text = desired_mode
        changed = True
    return changed


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
        key_modes = _source_key_modes(source)
        if key_modes:
            digest.update(b"adjacent-musicxml-key-modes\0")
            digest.update(json.dumps(key_modes, separators=(",", ":")).encode("utf-8"))
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


def _musicxml_sync_state_path(source: Path) -> Path:
    return LIBRARY_ASSETS_ROOT / _piece_id(source.parent.name) / "source-sync.json"


def _read_musicxml_sync_state(source: Path) -> dict:
    path = _musicxml_sync_state_path(source)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _sync_musicxml_from_mscz(source: Path, *, force: bool = False) -> tuple[Path, bool]:
    """Keep the adjacent MusicXML as an atomic derivative of the edited MSCZ.

    MuseScore may omit MusicXML ``key/mode`` while exporting. Explicit modes in
    the previous sidecar are therefore merged into the temporary export before
    replacement; the existing XML remains untouched if conversion fails.
    """

    target = _adjacent_musicxml_source(source)
    if target is None:
        target = source.with_suffix(".xml")
    source_hash = _sha256_path(source)
    state = _read_musicxml_sync_state(source)
    target_hash = _sha256_path(target) if target.is_file() else None
    if not force and state.get("version") == MUSICXML_SYNC_VERSION:
        if state.get("mscz_sha256") == source_hash and target_hash is not None:
            if target_hash != state.get("musicxml_sha256") and target_hash is not None:
                # A deliberate sidecar-only metadata edit (notably key mode) is
                # preserved and becomes the baseline for the next MSCZ export.
                _write_json_atomic(_musicxml_sync_state_path(source), {
                    "version": MUSICXML_SYNC_VERSION,
                    "mscz_sha256": source_hash,
                    "musicxml_sha256": target_hash,
                })
            return target, False

    with _musicxml_sync_lock:
        # Re-read after waiting: the server watcher and a bundle build may have
        # observed the same save concurrently.
        source_hash = _sha256_path(source)
        state = _read_musicxml_sync_state(source)
        if not force and state.get("version") == MUSICXML_SYNC_VERSION \
                and state.get("mscz_sha256") == source_hash and target.is_file():
            return target, False

        target.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary_name = tempfile.mkstemp(
            prefix=f".{target.stem}-export-", suffix=target.suffix, dir=target.parent,
        )
        os.close(handle)
        temporary = Path(temporary_name)
        temporary.unlink(missing_ok=True)
        try:
            result = subprocess.run(
                [_musescore(), "-f", "-o", str(temporary), str(source)],
                capture_output=True, text=True, timeout=180, check=False,
            )
            if result.returncode:
                raise RuntimeError(
                    (result.stderr or result.stdout or "MuseScore MusicXML export failed").strip()[-600:]
                )
            _wait_for_file(temporary)
            tree = ET.parse(temporary)
            if _restore_explicit_key_modes(tree.getroot(), source):
                tree.write(temporary, encoding="utf-8", xml_declaration=True)
            # Parse the final payload once more before replacing editorial data.
            ET.parse(temporary)
            os.replace(temporary, target)
            target_hash = _sha256_path(target)
            _write_json_atomic(_musicxml_sync_state_path(source), {
                "version": MUSICXML_SYNC_VERSION,
                "mscz_sha256": source_hash,
                "musicxml_sha256": target_hash,
            })
            return target, True
        finally:
            temporary.unlink(missing_ok=True)


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


def _source_audio_has_distinct_stems(destination: Path, voice_stems: dict,
                                     accompaniment_file: str | None) -> bool:
    """Reject source exports that muted every voice despite containing vocal notes.

    This can happen when a score refers to Muse Sounds unavailable on the
    export machine: MuseScore reports success but writes silent vocal stems.
    """
    try:
        voice_hashes = [sha256_file(destination / name) for name in voice_stems.values()]
        if len(voice_hashes) > 1 and len(set(voice_hashes)) == 1:
            return False
        if accompaniment_file and voice_hashes:
            if sha256_file(destination / "score.mp3") == sha256_file(destination / accompaniment_file):
                return False
    except OSError:
        return False
    return True


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


def _set_choir_aahs(musicxml: Path, vocal_part_ids: set[str]) -> None:
    """Preserve the intended MS Basic vocal timbre across MusicXML re-import.

    MuseScore's MusicXML export can label a voice as grand piano and assign GM
    program 1 even when its source mixer uses MS Basic Choir Aahs (program 52,
    zero-based). MusicXML's midi-program is one-based, therefore 53.
    """
    tree = ET.parse(musicxml)
    root = tree.getroot()
    matched = set()
    for score_part in root.findall("./part-list/score-part"):
        part_id = score_part.get("id")
        if part_id not in vocal_part_ids:
            continue
        matched.add(part_id)
        instrument = score_part.find("score-instrument")
        if instrument is None:
            instrument = ET.SubElement(score_part, "score-instrument", {"id": f"{part_id}-I1"})
        name = instrument.find("instrument-name")
        if name is None:
            name = ET.SubElement(instrument, "instrument-name")
        name.text = "Choir Aahs"
        sound = instrument.find("instrument-sound")
        if sound is None:
            sound = ET.SubElement(instrument, "instrument-sound")
        part_name = (score_part.findtext("part-name") or "").casefold()
        if "basso" in part_name or "bass" in part_name:
            sound.text = "voice.bass"
        elif "tenore" in part_name or "tenor" in part_name:
            sound.text = "voice.tenor"
        elif "contralto" in part_name or "alto" in part_name:
            sound.text = "voice.alto"
        else:
            sound.text = "voice.soprano"
        midi = score_part.find("midi-instrument")
        if midi is None:
            midi = ET.SubElement(score_part, "midi-instrument", {"id": instrument.get("id", f"{part_id}-I1")})
        program = midi.find("midi-program")
        if program is None:
            program = ET.SubElement(midi, "midi-program")
        program.text = "53"
    if matched != vocal_part_ids:
        raise ValueError(f"Parti vocali MusicXML mancanti: {sorted(vocal_part_ids - matched)}")
    tree.write(musicxml, encoding="utf-8", xml_declaration=True)


def _set_organ_fast_strings(musicxml: Path) -> None:
    """Keep an organ's notation/name while using MS Basic Strings Fast audio.

    MuseScore's source archive may already use the preset, but its MusicXML
    export describes the instrument as an organ. Re-importing that MusicXML
    for browser audio would otherwise silently restore the organ timbre.
    """
    tree = ET.parse(musicxml)
    root = tree.getroot()
    changed = False
    for score_part in root.findall("./part-list/score-part"):
        if not re.search(r"\b(organo|organ)\b", score_part.findtext("part-name") or "", re.I):
            continue
        instrument = score_part.find("score-instrument")
        if instrument is None:
            instrument = ET.SubElement(score_part, "score-instrument", {"id": f"{score_part.get('id')}-I1"})
        name = instrument.find("instrument-name")
        if name is None:
            name = ET.SubElement(instrument, "instrument-name")
        name.text = "Strings Fast"
        sound = instrument.find("instrument-sound")
        if sound is None:
            sound = ET.SubElement(instrument, "instrument-sound")
        sound.text = "strings.group"
        midi = score_part.find("midi-instrument")
        if midi is None:
            midi = ET.SubElement(score_part, "midi-instrument", {"id": instrument.get("id", f"{score_part.get('id')}-I1")})
        program = midi.find("midi-program")
        if program is None:
            program = ET.SubElement(midi, "midi-program")
        program.text = "49"  # MusicXML is one-based; MS Basic Strings Fast is preset 48.
        changed = True
    if changed:
        tree.write(musicxml, encoding="utf-8", xml_declaration=True)


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
    return [path.name for path in sorted(destination.glob(f"part-{part_id}-*.svg"), key=_page_asset_sort_key)]


def _prepare_continuous_part_musicxml(root: ET.Element) -> None:
    """Turn a one-staff MusicXML document into one wide, unbroken system.

    MuseScore's batch converter deliberately renders exports in page mode even
    when the source was last saved in horizontal continuous view.  A temporary
    wide page gives the browser the same unbroken musical line without changing
    the reviewed MSCZ or the page-formatted full-score export.
    """
    defaults = root.find("defaults")
    if defaults is None:
        defaults = ET.Element("defaults")
        root.insert(0, defaults)
    page_layout = defaults.find("page-layout")
    if page_layout is None:
        page_layout = ET.SubElement(defaults, "page-layout")

    def number(element: ET.Element | None, fallback: float) -> float:
        try:
            return float(element.text) if element is not None and element.text else fallback
        except ValueError:
            return fallback

    def set_text(tag: str, value: float) -> None:
        element = page_layout.find(tag)
        if element is None:
            element = ET.SubElement(page_layout, tag)
        element.text = f"{value:g}"

    original_width = number(page_layout.find("page-width"), 1200.0)
    explicit_breaks = len(root.findall('.//print[@new-page="yes"]')) + len(
        root.findall('.//print[@new-system="yes"]')
    )
    measure_widths = []
    for measure in root.findall("./part/measure"):
        try:
            width = float(measure.get("width", ""))
        except ValueError:
            continue
        if width > 0:
            measure_widths.append(width)
    if measure_widths:
        content_width = sum(measure_widths)
    else:
        content_width = max(1, explicit_breaks + 1) * max(800.0, original_width - 170.0)
    continuous_width = max(
        original_width,
        content_width + CONTINUOUS_HORIZONTAL_PADDING_TENTHS,
    )
    set_text("page-width", continuous_width)
    set_text("page-height", CONTINUOUS_PAGE_HEIGHT_TENTHS)

    margins = page_layout.findall("page-margins")
    if not margins:
        margins = [ET.SubElement(page_layout, "page-margins", {"type": kind})
                   for kind in ("even", "odd")]
    for page_margins in margins:
        for tag in ("left-margin", "right-margin", "top-margin", "bottom-margin"):
            element = page_margins.find(tag)
            if element is None:
                element = ET.SubElement(page_margins, tag)
            element.text = f"{CONTINUOUS_PAGE_MARGIN_TENTHS:g}"

    for credit in list(root.findall("credit")):
        root.remove(credit)
    for measure in root.findall("./part/measure"):
        for print_element in list(measure.findall("print")):
            measure.remove(print_element)


def _export_continuous_part_svg(part_musicxml: Path, destination: Path, part_id: str,
                                executable: str) -> str:
    tree = ET.parse(part_musicxml)
    _prepare_continuous_part_musicxml(tree.getroot())
    source = destination / f"part-{part_id}-continuous.musicxml"
    tree.write(source, encoding="utf-8", xml_declaration=True)
    output = destination / f"part-{part_id}-continuous.svg"
    for old in destination.glob(f"part-{part_id}-continuous*.svg"):
        old.unlink(missing_ok=True)
    result = subprocess.run([executable, "-f", "-o", str(output), str(source)],
                            capture_output=True, text=True, timeout=180, check=False)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "MuseScore continuous export failed").strip()[-600:])
    first_page = destination / f"part-{part_id}-continuous-1.svg"
    _wait_for_file(first_page)
    pages = sorted(destination.glob(f"part-{part_id}-continuous-*.svg"), key=_page_asset_sort_key)
    if len(pages) != 1:
        raise RuntimeError(f"{part_id}: la vista continua ha prodotto {len(pages)} pagine")
    return pages[0].name


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


def _browser_assets_ready(destination: Path, metadata: dict) -> bool:
    required = {"score.json", "score.mp3"}
    required.update(metadata.get("score_pages", []))
    for pages in metadata.get("part_pages", {}).values():
        required.update(pages)
    required.update(metadata.get("continuous_part_scores", {}).values())
    required.update(metadata.get("voice_stems", {}).values())
    if metadata.get("accompaniment_file"):
        required.add(metadata["accompaniment_file"])
    return all(
        isinstance(name, str)
        and (destination / name).is_file()
        and (destination / name).resolve().parent == destination.resolve()
        for name in required
    )


def _build_library_piece(source: Path) -> dict:
    """Build browser-only derivatives of a user-owned MSCZ source."""
    piece_id = _piece_id(source.parent.name)
    preserve_source_sounds = bool(_repertoire_piece(piece_id).get("preserve_source_playback_sounds"))
    destination = LIBRARY_ASSETS_ROOT / piece_id
    metadata_path = destination / "metadata.json"
    raw_source_hash, semantic_source_hash = _source_hashes(source)
    cached = _cached_library_metadata(metadata_path, raw_source_hash, semantic_source_hash)
    if cached is not None and bool(cached.get("source_playback_sounds_preserved")) != preserve_source_sounds:
        cached = None
    if preserve_source_sounds and cached is not None \
            and cached.get("source_playback_export_version") != SOURCE_PLAYBACK_EXPORT_VERSION:
        cached = None
    if cached is not None and _browser_assets_ready(destination, cached):
        return cached
    with _library_lock:
        # Another request may have completed this piece while we waited. Also
        # re-read the source in case MuseScore saved it during that interval.
        raw_source_hash, semantic_source_hash = _source_hashes(source)
        cached = _cached_library_metadata(metadata_path, raw_source_hash, semantic_source_hash)
        if cached is not None and bool(cached.get("source_playback_sounds_preserved")) != preserve_source_sounds:
            cached = None
        if preserve_source_sounds and cached is not None \
                and cached.get("source_playback_export_version") != SOURCE_PLAYBACK_EXPORT_VERSION:
            cached = None
        if cached is not None and _browser_assets_ready(destination, cached):
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
        musicxml_root = musicxml_tree.getroot()
        score_metadata_changed = _restore_explicit_key_modes(musicxml_root, source)
        score_metadata_changed = _ensure_explicit_tempo(musicxml_root) or score_metadata_changed
        if score_metadata_changed:
            musicxml_tree.write(musicxml, encoding="utf-8", xml_declaration=True)

        for output, export_source in ((score_svg, source),):
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
        source_part_ids = _source_part_ids(source)
        payload_part_ids = [part["id"] for part in payload["parts"]]
        source_part_by_payload_id = dict(zip(payload_part_ids, source_part_ids))
        if preserve_source_sounds and len(source_part_by_payload_id) != len(payload_part_ids):
            raise RuntimeError("Impossibile associare le parti MusicXML alle tracce del mixer MuseScore")
        if preserve_source_sounds:
            exported = _export_source_audio_subset(
                source, score_audio, executable, set(source_part_ids),
            )
            if not exported:
                raise RuntimeError("Mixer MuseScore senza tracce esportabili")
        else:
            _set_choir_aahs(musicxml, {part["id"] for part in vocal_parts})
            _set_organ_fast_strings(musicxml)
            _export_audio_stem(musicxml, score_audio, executable)
        complete_root = ET.parse(musicxml).getroot()
        tempo_directions = _tempo_directions(complete_root)
        part_pages = {
            part["id"]: _export_part_svg(musicxml, destination, part["id"], executable, tempo_directions)
            for part in vocal_parts
        }
        continuous_part_scores = {
            part["id"]: _export_continuous_part_svg(
                destination / f"part-{part['id']}.musicxml", destination, part["id"], executable,
            )
            for part in vocal_parts
        }
        voice_stems = {}
        for part in vocal_parts:
            filename = f"voice-{part['id']}.mp3"
            if preserve_source_sounds:
                exported = _export_source_audio_subset(
                    source, destination / filename, executable,
                    {source_part_by_payload_id[part["id"]]},
                )
                if not exported:
                    raise RuntimeError(f"Mixer MuseScore senza traccia per {part['name']}")
            else:
                _export_audio_stem(destination / f"part-{part['id']}.musicxml", destination / filename, executable)
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
            if preserve_source_sounds:
                accompaniment_source_ids = {
                    source_part_by_payload_id[part["id"]]
                    for part in payload["parts"] if part["id"] not in vocal_ids
                }
                exported = _export_source_audio_subset(
                    source, destination / accompaniment_file, executable, accompaniment_source_ids,
                )
                if not exported:
                    raise RuntimeError("Mixer MuseScore senza traccia di accompagnamento")
            else:
                _export_audio_stem(accompaniment_source, destination / accompaniment_file, executable)
        if preserve_source_sounds and not _source_audio_has_distinct_stems(
                destination, voice_stems, accompaniment_file):
            raise RuntimeError("Le tracce esportate dal mixer MuseScore non risultano isolate")
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
            "score_pages": [path.name for path in sorted(destination.glob("score-*.svg"), key=_page_asset_sort_key)],
            "part_pages": part_pages,
            "continuous_part_scores": continuous_part_scores,
            "voice_stems": voice_stems,
            "accompaniment_file": accompaniment_file,
            "source_playback_sounds_preserved": preserve_source_sounds,
            "source_playback_export_version": (
                SOURCE_PLAYBACK_EXPORT_VERSION if preserve_source_sounds else None
            ),
        }
        _write_json_atomic(metadata_path, metadata)
        return metadata


def _write_library_runtime_bundle(metadata: dict) -> dict:
    """Write the small manifests consumed by the local browser application."""
    piece_id = metadata["piece_id"]
    destination = LIBRARY_ASSETS_ROOT / piece_id
    timeline_hash = hashlib.sha256((destination / "score.json").read_bytes()).hexdigest()
    part_ids = (["mono-soprano", "mono-contralto", "mono-tenore", "mono-basso"]
                if metadata["monodic"] else [part["id"] for part in metadata["parts"]])
    practice_parts = ([
        {"id": "mono-soprano", "name": "Soprano"},
        {"id": "mono-contralto", "name": "Contralto"},
        {"id": "mono-tenore", "name": "Tenore"},
        {"id": "mono-basso", "name": "Basso"},
    ] if metadata["monodic"] else metadata["parts"])
    root = f"library-assets/{piece_id}"
    part_pages = {
        part_id: [f"{root}/{name}" for name in sorted(pages, key=_page_asset_sort_key)]
        for part_id, pages in metadata["part_pages"].items()
    }
    continuous_scores = {
        part_id: f"{root}/{name}"
        for part_id, name in metadata.get("continuous_part_scores", {}).items()
    }
    if metadata["monodic"]:
        written_pages = next(iter(part_pages.values()))
        part_pages = {part_id: written_pages for part_id in part_ids}
        if continuous_scores:
            written_continuous_score = next(iter(continuous_scores.values()))
            continuous_scores = {part_id: written_continuous_score for part_id in part_ids}

    _write_json_atomic(destination / "glyph-map.json", {})
    _write_json_atomic(destination / "audio-manifest.json", {
        "score_version_id": metadata["score_version_id"],
        "timeline_hash": timeline_hash,
        "mixes": {part_id: {"file": "score.mp3", "files_by_speed": {}} for part_id in part_ids},
        "full_mix_file": "score.mp3",
        "accompaniment_file": metadata.get("accompaniment_file"),
        "voice_stems": metadata.get("voice_stems", {}),
    })
    bundle = {
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
            "full_score_pages": [f"{root}/{name}" for name in sorted(metadata["score_pages"], key=_page_asset_sort_key)],
            "score_pages": part_pages,
            "continuous_scores": continuous_scores,
        },
    }
    _write_json_atomic(destination / "bundle.json", bundle)
    return bundle


def _prepare_library_source(source: Path) -> tuple[dict, dict]:
    _sync_musicxml_from_mscz(source)
    metadata = _build_library_piece(source)
    return metadata, _write_library_runtime_bundle(metadata)


def _prepare_local_library(report=None) -> list[Path]:
    sources = _library_sources()
    destinations = []
    for index, source in enumerate(sources, start=1):
        if report:
            report(index, len(sources), _piece_id(source.parent.name))
        metadata, _ = _prepare_library_source(source)
        destinations.append(LIBRARY_ASSETS_ROOT / metadata["piece_id"])
    return destinations


def _sync_local_musicxml(report=None) -> list[Path]:
    targets = []
    sources = _library_sources()
    for index, source in enumerate(sources, start=1):
        target, changed = _sync_musicxml_from_mscz(source)
        if changed and report:
            report(index, len(sources), _piece_id(source.parent.name), target)
        targets.append(target)
    return targets


def _library_listing() -> list[dict]:
    display_titles: dict[str, str] = {}
    try:
        configured = json.loads(REPERTOIRE_CONFIG.read_text(encoding="utf-8")).get("pieces", [])
        display_titles = {
            str(item.get("id", "")): str(item.get("display_title", "")).strip()
            for item in configured if str(item.get("display_title", "")).strip()
        }
    except (OSError, json.JSONDecodeError, AttributeError):
        pass
    items = []
    for source in _library_sources():
        piece_id = _piece_id(source.parent.name)
        cached = LIBRARY_ASSETS_ROOT / piece_id / "metadata.json"
        raw_hash, semantic_hash = _source_hashes(source)
        metadata = _cached_library_metadata(cached, raw_hash, semantic_hash)
        if metadata is not None and _browser_assets_ready(cached.parent, metadata):
            try:
                listing = {key: metadata[key] for key in ("piece_id", "title", "parts", "monodic")}
                listing["title"] = display_titles.get(piece_id, listing["title"])
                items.append(listing)
                continue
            except KeyError:
                pass
        # This can only occur with --skip-library-prebuild or after a source is
        # edited while the server is already running.
        items.append({"piece_id": piece_id,
                      "title": display_titles.get(piece_id, source.stem.replace("-", " ").title()),
                      "parts": [], "monodic": False})
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
            destination = LIBRARY_ASSETS_ROOT / piece_id
            raw_hash, semantic_hash = _source_hashes(source)
            metadata = _cached_library_metadata(destination / "metadata.json", raw_hash, semantic_hash)
            bundle_path = destination / "bundle.json"
            if (metadata is None or not _browser_assets_ready(destination, metadata)
                    or not bundle_path.is_file()):
                self._send_json({
                    "error": (
                        "Bundle locale non pronto o obsoleto. Riavvia il server oppure esegui "
                        f"python scripts/build_library_bundle.py {piece_id}"
                    )
                }, HTTPStatus.SERVICE_UNAVAILABLE)
                return
            self._send_json(json.loads(bundle_path.read_text(encoding="utf-8")))
        except (OSError, ValueError, json.JSONDecodeError) as error:
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
    parser.add_argument(
        "--skip-library-prebuild",
        action="store_true",
        help="Avvia subito il server senza verificare o rigenerare i bundle locali",
    )
    args = parser.parse_args()
    _sync_local_musicxml(
        lambda index, total, piece_id, target: print(
            f"MusicXML aggiornato [{index}/{total}] {piece_id}: {target.name}", flush=True,
        )
    )
    if not args.skip_library_prebuild:
        print("Verifica dei bundle locali prima dell'avvio...")
        _prepare_local_library(
            lambda index, total, piece_id: print(f"  [{index}/{total}] {piece_id}", flush=True)
        )
    frontend = Path(__file__).resolve().parents[1] / "frontend"
    handler = lambda *handler_args, **kwargs: RangeRequestHandler(*handler_args, directory=str(frontend), **kwargs)
    print(f"Practice frontend: http://{args.host}:{args.port}")
    ThreadingHTTPServer((args.host, args.port), handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
