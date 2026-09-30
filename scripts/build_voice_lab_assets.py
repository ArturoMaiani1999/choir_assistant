"""Build reviewed, local-only notation and vocal audio for Voice Lab exercises."""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from zipfile import ZipFile

from check_voice_lab_artifacts import audit_voice_lab_artifacts

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "sheets" / "voice-lab"
PUBLIC = ROOT / "frontend" / "voice-lab-assets"
MUSESCORE = Path(r"C:\Program Files\MuseScore 4\bin\MuseScore4.exe")

PITCHES = {0: ("C", 0), 1: ("C", 1), 2: ("D", 0), 3: ("E", -1), 4: ("E", 0), 5: ("F", 0),
           6: ("F", 1), 7: ("G", 0), 8: ("A", -1), 9: ("A", 0), 10: ("B", -1), 11: ("B", 0)}
ROLE_INTERVAL_BASES = {"soprano": 63, "alto": 58, "tenor": 51, "bass": 43}
INTERVAL_DISTANCES = (0, 1, 2, 3, 4, 5, 7, 8, 9, 11, 12)
CHOIR_PRESETS = {
    "soprano": {"name": "Sopranos", "uid": "19", "setup": "voices.choir.soprano", "anchors": (62, 68, 74)},
    "alto": {"name": "Altos", "uid": "20", "setup": "voices.choir.alto", "anchors": (57, 63, 69)},
    "tenor": {"name": "Tenors", "uid": "21", "setup": "voices.choir.tenor", "anchors": (50, 56, 62, 67)},
    "bass": {"name": "Basses", "uid": "22", "setup": "voices.choir.bass", "anchors": (42, 48, 54, 59)},
}


def pitch_xml(midi: int) -> str:
    step, alter = PITCHES[midi % 12]
    alteration = f"<alter>{alter}</alter>" if alter else ""
    return f"<pitch><step>{step}</step>{alteration}<octave>{midi // 12 - 1}</octave></pitch>"


def score_xml(title: str, notes: list[tuple[int, int]], harmonic: bool = False, leading_rest: bool = False,
              *, instrument_name: str = "Voce", instrument_sound: str = "voice.vocals",
              midi_program: int = 53, tempo: int | None = None, dynamics: int | None = None) -> str:
    body = []
    average_midi = sum(midi for midi, _ in notes) / len(notes)
    clef_sign, clef_line = ("F", 4) if average_midi < 60 else ("G", 2)
    initial_attributes = ("<attributes><divisions>2</divisions><key><fifths>0</fifths></key>"
                          f"<time print-object=\"no\"><beats>4</beats><beat-type>4</beat-type></time><clef><sign>{clef_sign}</sign><line>{clef_line}</line></clef></attributes>")
    if leading_rest:
        body.append(f'<measure number="1">{initial_attributes}<direction><sound tempo="100"/></direction>'
                    '<note><rest measure="yes"/><duration>8</duration><voice>1</voice><type>whole</type></note></measure>')
    for index, (midi, duration) in enumerate(notes):
        attributes = initial_attributes if index == 0 and not leading_rest else ""
        open_measure = f"<measure number=\"{index + 1 + int(leading_rest)}\">" if not harmonic or index == 0 else ""
        close_measure = "</measure>" if not harmonic or index == len(notes) - 1 else ""
        chord = "<chord/>" if harmonic and index else ""
        resolved_tempo = tempo or (100 if leading_rest else 72)
        dynamic_xml = "<direction-type><dynamics><mf/></dynamics></direction-type>" if dynamics is not None else ""
        dynamic_sound = f' dynamics="{dynamics}"' if dynamics is not None else ""
        body.append(f"{open_measure}{attributes}<direction>{dynamic_xml}<sound tempo=\"{resolved_tempo}\"{dynamic_sound}/></direction><note>{chord}{pitch_xml(midi)}<duration>{duration}</duration><voice>1</voice>"
                    f"<type>{'whole' if duration == 8 else 'half'}</type></note>{close_measure}")
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><work><work-title>{title}</work-title></work><identification><creator type="software">Choir Assistant Voice Lab</creator></identification>
<part-list><score-part id="P1"><part-name print-object="no">{instrument_name}</part-name><score-instrument id="P1-I1"><instrument-name>{instrument_name}</instrument-name><instrument-sound>{instrument_sound}</instrument-sound></score-instrument><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>{midi_program}</midi-program></midi-instrument></score-part></part-list>
<part id="P1">{''.join(body)}</part></score-partwise>'''


def run(*args: str) -> None:
    result = subprocess.run([str(MUSESCORE), "-f", *args], capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout)[-1000:])


def run_jobs(jobs: list[dict[str, str]], chunk_size: int = 120, trim: bool = False) -> None:
    for start in range(0, len(jobs), chunk_size):
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False) as handle:
            json.dump(jobs[start:start + chunk_size], handle, ensure_ascii=False)
            job_path = Path(handle.name)
        try:
            run(*(("-T", "12") if trim else ()), "-j", str(job_path))
        finally:
            job_path.unlink(missing_ok=True)


def write_if_changed(path: Path, content: str) -> bool:
    if path.is_file() and path.read_text(encoding="utf-8") == content:
        return False
    path.write_text(content, encoding="utf-8")
    return True


def sustained_choir_xml(role: str, midi: int) -> str:
    """A single tied 36-second tone, leaving headroom for upward pitch shifting."""
    measures = []
    for index in range(15):
        duration = 8
        ties = ('<tie type="start"/><notations><tied type="start"/></notations>' if index == 0 else
                '<tie type="stop"/><notations><tied type="stop"/></notations>' if index == 14 else
                '<tie type="stop"/><tie type="start"/><notations><tied type="stop"/><tied type="start"/></notations>')
        attributes = ('<attributes><divisions>2</divisions><key><fifths>0</fifths></key>'
                      '<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>'
                      f'{"F" if role in ("tenor", "bass") else "G"}</sign><line>{4 if role in ("tenor", "bass") else 2}</line></clef></attributes>') if index == 0 else ""
        tempo = '<direction><sound tempo="100" dynamics="72"/></direction>' if index == 0 else ""
        measures.append(f'<measure number="{index + 1}">{attributes}{tempo}<note>{pitch_xml(midi)}<duration>{duration}</duration>'
                        f'<voice>1</voice><type>whole</type>{ties}</note></measure>')
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><identification><creator type="software">Choir Assistant Voice Lab</creator></identification>
<part-list><score-part id="P1"><part-name>{role.title()}</part-name><score-instrument id="P1-I1"><instrument-name>{role.title()}</instrument-name><instrument-sound>voice.{role}</instrument-sound></score-instrument></score-part></part-list>
<part id="P1">{''.join(measures)}</part></score-partwise>'''


def sustained_strings_xml(midi: int) -> str:
    """A 36-second tied strings tone with no silence for browser looping."""
    measures = []
    for index in range(15):
        ties = ('<tie type="start"/><notations><tied type="start"/></notations>' if index == 0 else
                '<tie type="stop"/><notations><tied type="stop"/></notations>' if index == 14 else
                '<tie type="stop"/><tie type="start"/><notations><tied type="stop"/><tied type="start"/></notations>')
        attributes = ('<attributes><divisions>2</divisions><key><fifths>0</fifths></key>'
                      '<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>'
                      f'{"F" if midi < 60 else "G"}</sign><line>{4 if midi < 60 else 2}</line></clef></attributes>') if index == 0 else ""
        tempo = '<direction><sound tempo="100" dynamics="72"/></direction>' if index == 0 else ""
        measures.append(f'<measure number="{index + 1}">{attributes}{tempo}<note>{pitch_xml(midi)}<duration>8</duration>'
                        f'<voice>1</voice><type>whole</type>{ties}</note></measure>')
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><identification><creator type="software">Choir Assistant Voice Lab</creator></identification>
<part-list><score-part id="P1"><part-name>Archi</part-name><score-instrument id="P1-I1"><instrument-name>Archi</instrument-name><instrument-sound>strings.group</instrument-sound></score-instrument><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>49</midi-program></midi-instrument></score-part></part-list>
<part id="P1">{''.join(measures)}</part></score-partwise>'''


def apply_muse_choir(mscz_path: Path, role: str) -> None:
    preset = CHOIR_PRESETS[role]
    with ZipFile(mscz_path) as source:
        settings = json.loads(source.read("audiosettings.json"))
        track = next((item for item in settings["tracks"] if item.get("partId") != "999"), None)
        if track is None:
            track = {"partId": "1", "instrumentId": role,
                     "out": {"balance": 0, "fxChain": {}, "volumeDb": 0}}
            settings["tracks"].append(track)
        track["instrumentId"] = role
        track["in"] = {"resourceMeta": {"attributes": {"museCategory": "Muse Choir", "museName": preset["name"],
            "musePack": "Muse Choir", "museUID": preset["uid"], "museVendorName": "Muse",
            "playbackSetupData": preset["setup"]}, "hasNativeEditorSupport": False, "id": preset["uid"],
            "type": "muse_sampler_sound_pack", "vendor": "MuseSounds"}, "unitConfiguration": {}}
        settings["activeSoundProfile"] = "MuseSounds"
        with tempfile.NamedTemporaryFile(dir=mscz_path.parent, suffix=".mscz.tmp", delete=False) as handle:
            temporary = Path(handle.name)
        with ZipFile(temporary, "w") as updated:
            for item in source.infolist():
                data = json.dumps(settings, ensure_ascii=False, indent=4).encode() if item.filename == "audiosettings.json" else source.read(item)
                updated.writestr(item, data)
    os.replace(temporary, mscz_path)


def compact_final_system(mscz_path: Path) -> bool:
    """Keep three-measure exercises readable instead of MuseScore's page-wide last line."""
    with tempfile.NamedTemporaryFile(dir=SOURCE, suffix=".mscz.tmp", delete=False) as handle:
        temporary = Path(handle.name)
    try:
        with ZipFile(mscz_path) as source:
            style = source.read("score_style.mss")
            if b"<lastSystemFillLimit>1</lastSystemFillLimit>" in style:
                return False
            old = b"<lastSystemFillLimit>0.3</lastSystemFillLimit>"
            if old not in style:
                raise RuntimeError(f"Stile MuseScore inatteso: {mscz_path}")
            with ZipFile(temporary, "w") as updated:
                for item in source.infolist():
                    data = style.replace(old, b"<lastSystemFillLimit>1</lastSystemFillLimit>") if item.filename == "score_style.mss" else source.read(item)
                    updated.writestr(item, data)
        for attempt in range(6):
            try:
                os.replace(temporary, mscz_path)
                break
            except PermissionError:
                if attempt == 5:
                    raise
                time.sleep(.1 * (attempt + 1))
    finally:
        temporary.unlink(missing_ok=True)
    return True


def main() -> int:
    if not MUSESCORE.is_file():
        raise SystemExit("MuseScore 4 non disponibile")
    SOURCE.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    definitions = {
        "listen-repeat": ("Ascolta e ripeti", [(60, 8)], False),
        "sustain": ("Mantieni la nota", [(60, 8)], False),
        "interval-melodic": ("Intervallo melodico", [(60, 8), (64, 8)], False),
        "interval-harmonic": ("Intervallo armonico", [(60, 8), (64, 8)], True),
    }
    manifest = {"schemaVersion": 1, "timbre": "General MIDI voice (program 53)", "templates": {}}
    for slug, (title, notes, harmonic) in definitions.items():
        xml_path, mscz_path, svg_path = SOURCE / f"{slug}.musicxml", SOURCE / f"{slug}.mscz", PUBLIC / f"{slug}.svg"
        changed = write_if_changed(xml_path, score_xml(title, notes, harmonic, leading_rest=not harmonic))
        if changed or not mscz_path.is_file():
            run("-o", str(mscz_path), str(xml_path))
        compacted = compact_final_system(mscz_path) if slug == "interval-melodic" else False
        if changed or compacted or not (PUBLIC / f"{slug}-1.svg").is_file():
            run("-o", str(svg_path), str(mscz_path))
        rendered = svg_path if svg_path.is_file() else PUBLIC / f"{slug}-1.svg"
        if not rendered.is_file():
            raise RuntimeError(f"MuseScore non ha prodotto lo spartito SVG di {slug}")
        manifest["templates"][slug] = {"musicxml": f"../../sheets/voice-lab/{slug}.musicxml", "mscz": f"../../sheets/voice-lab/{slug}.mscz", "score": f"voice-lab-assets/{rendered.name}"}
    choir_source, choir_public = SOURCE / "choir", PUBLIC / "choir"
    choir_source.mkdir(exist_ok=True); choir_public.mkdir(exist_ok=True)
    choir_manifest = {"sourceDurationSeconds": 36, "exerciseDurationSeconds": 30, "format": "flac", "roles": {}}
    for role, preset in CHOIR_PRESETS.items():
        choir_manifest["roles"][role] = {"anchors": list(preset["anchors"]),
            "urlTemplate": f"voice-lab-assets/choir/{role}-{{midi}}.flac", "timbre": f"Muse Choir {preset['name']}"}
        for midi in preset["anchors"]:
            xml_path, mscz_path = choir_source / f"{role}-{midi}.musicxml", choir_source / f"{role}-{midi}.mscz"
            audio_path = choir_public / f"{role}-{midi}.flac"
            changed = write_if_changed(xml_path, sustained_choir_xml(role, midi))
            if changed or not mscz_path.is_file():
                run("-o", str(mscz_path), str(xml_path)); apply_muse_choir(mscz_path, role)
            if changed or not audio_path.is_file():
                run("-o", str(audio_path), str(mscz_path))
    manifest["choirSamples"] = choir_manifest
    string_source, string_public = SOURCE / "strings", PUBLIC / "strings"
    string_source.mkdir(exist_ok=True); string_public.mkdir(exist_ok=True)
    string_low, string_high = 36, 60
    string_mscz_jobs, string_audio_jobs = [], []
    for midi in range(string_low, string_high + 1):
        xml_path = string_source / f"string-{midi}.musicxml"
        mscz_path = string_source / f"string-{midi}.mscz"
        audio_path = string_public / f"string-{midi}.ogg"
        changed = write_if_changed(xml_path, sustained_strings_xml(midi))
        if changed or not mscz_path.is_file():
            string_mscz_jobs.append({"in": str(xml_path), "out": str(mscz_path)})
        if changed or not audio_path.is_file():
            string_audio_jobs.append({"in": str(mscz_path), "out": str(audio_path)})
    run_jobs(string_mscz_jobs)
    run_jobs(string_audio_jobs)
    manifest["stringSamples"] = {"lowMidi": string_low, "highMidi": string_high,
                                  "sourceDurationSeconds": 36, "format": "ogg", "timbre": "MuseScore Strings (GM 49)",
                                  "urlTemplate": "voice-lab-assets/strings/string-{midi}.ogg"}
    note_source, note_public = SOURCE / "notes", PUBLIC / "notes"
    note_source.mkdir(exist_ok=True); note_public.mkdir(exist_ok=True)
    for midi in range(36, 85):
        xml_path, mscz_path, svg_path = note_source / f"note-{midi}.musicxml", note_source / f"note-{midi}.mscz", note_public / f"note-{midi}.svg"
        changed = write_if_changed(xml_path, score_xml("", [(midi, 8)], leading_rest=True))
        if changed or not mscz_path.is_file():
            run("-o", str(mscz_path), str(xml_path))
        if changed or not (note_public / f"note-{midi}-1.svg").is_file():
            run("-T", "12", "-o", str(svg_path), str(mscz_path))
    manifest["noteScores"] = {"lowMidi": 36, "highMidi": 84, "urlTemplate": "voice-lab-assets/notes/note-{midi}-1.svg"}
    interval_source, interval_public = SOURCE / "intervals", PUBLIC / "intervals"
    interval_source.mkdir(exist_ok=True); interval_public.mkdir(exist_ok=True)
    melodic_pairs = {(first, second) for first in range(36, 85) for second in range(36, 85)
                     if abs(second - first) in INTERVAL_DISTANCES}
    harmonic_pairs = {tuple(sorted(pair)) for pair in melodic_pairs}
    plans = [("melodic", first, second) for first, second in sorted(melodic_pairs)]
    plans += [("harmonic", first, second) for first, second in sorted(harmonic_pairs)]
    mscz_jobs, svg_jobs = [], []
    for mode, first, second in plans:
        slug = f"{mode}-{first}-{second}"
        xml_path, mscz_path, svg_path = interval_source / f"{slug}.musicxml", interval_source / f"{slug}.mscz", interval_public / f"{slug}.svg"
        harmonic = mode == "harmonic"; duration = 8
        changed = write_if_changed(xml_path, score_xml("", [(first, duration), (second, duration)], harmonic, leading_rest=not harmonic))
        if changed or not mscz_path.is_file():
            mscz_jobs.append({"in": str(xml_path), "out": str(mscz_path)})
        if changed or not (interval_public / f"{slug}-1.svg").is_file():
            svg_jobs.append({"in": str(mscz_path), "out": str(svg_path)})
    run_jobs(mscz_jobs)
    for mode, first, second in plans:
        if mode != "melodic":
            continue
        slug = f"{mode}-{first}-{second}"
        if compact_final_system(interval_source / f"{slug}.mscz"):
            svg_jobs.append({"in": str(interval_source / f"{slug}.mscz"), "out": str(interval_public / f"{slug}.svg")})
    run_jobs(svg_jobs, trim=True)
    missing = [f"{mode}-{first}-{second}" for mode, first, second in plans
               if not (interval_public / f"{mode}-{first}-{second}-1.svg").is_file()]
    if missing:
        raise RuntimeError(f"MuseScore non ha prodotto {len(missing)} spartiti intervallo; primo: {missing[0]}")
    manifest["intervalScores"] = {"roleBases": ROLE_INTERVAL_BASES, "distances": list(INTERVAL_DISTANCES),
                                  "melodicUrlTemplate": "voice-lab-assets/intervals/melodic-{first}-{second}-1.svg",
                                  "harmonicUrlTemplate": "voice-lab-assets/intervals/harmonic-{first}-{second}-1.svg",
                                  "musicxmlTemplate": "../../sheets/voice-lab/intervals/{mode}-{first}-{second}.musicxml",
                                  "msczTemplate": "../../sheets/voice-lab/intervals/{mode}-{first}-{second}.mscz"}
    (PUBLIC / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    audit_voice_lab_artifacts()
    print(f"Voice Lab: {len(definitions)} template, {len(plans)} intervalli e campione vocale -> {PUBLIC}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
