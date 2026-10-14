"""Build the reviewed Muse Sounds Choir sample bank used by Voice Lab."""
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
CHOIR_PRESETS = {
    "soprano": {"name": "Sopranos", "uid": "19", "setup": "voices.choir.soprano", "anchors": (62, 68, 74)},
    "alto": {"name": "Altos", "uid": "20", "setup": "voices.choir.alto", "anchors": (57, 63, 69)},
    "tenor": {"name": "Tenors", "uid": "21", "setup": "voices.choir.tenor", "anchors": (50, 56, 62, 67)},
    "bass": {"name": "Basses", "uid": "22", "setup": "voices.choir.bass", "anchors": (42, 48, 54, 59)},
}
SCALE_OFFSETS = (0, 2, 4, 5, 7, 5, 4, 2, 0)
SCALE_ROOTS = {
    "soprano": {60: (65, 66, 67, 68), 80: (65, 66, 67, 68), 100: (65, 66, 67, 68)},
    "alto": {60: (53, 54, 55, 56), 80: (53, 54, 55, 56), 100: (53, 54, 55, 56)},
    "tenor": {60: (53, 54, 55, 56), 80: (53, 54, 55, 56), 100: (53, 54, 55, 56)},
    "bass": {60: (41, 42, 43, 44), 80: (41, 42, 43, 44), 100: (41, 42, 43, 44)},
}
PAD_ROOT_PITCH_CLASSES = (5, 6, 7, 8)
SCORE_PATTERNS = {
    "scale-major": ((0, 2, 4, 5, 7, 5, 4, 2, 0), ("1", "2", "3", "4", "5", "4", "3", "2", "1")),
    "triad-major-root": ((0, 4, 7, 4, 0), ("1", "3M", "5", "3M", "1")),
    "triad-minor-root": ((0, 3, 7, 3, 0), ("1", "3m", "5", "3m", "1")),
    "triad-major-first": ((4, 7, 12, 7, 4), ("3M", "5", "1", "5", "3M")),
    "triad-minor-first": ((3, 7, 12, 7, 3), ("3m", "5", "1", "5", "3m")),
    "triad-major-second": ((7, 12, 16, 12, 7), ("5", "1", "3M", "1", "5")),
    "triad-minor-second": ((7, 12, 15, 12, 7), ("5", "1", "3m", "1", "5")),
}
DEGREE_SPECS = (
    ("sharp1-flat2", "♯1 / ♭2", 1), ("2", "2", 2), ("sharp2-flat3", "♯2 / ♭3", 3),
    ("3", "3", 4), ("4", "4", 5), ("sharp4-flat5", "♯4 / ♭5", 6), ("5", "5", 7),
    ("sharp5-flat6", "♯5 / ♭6", 8), ("6", "6", 9), ("sharp6-flat7", "♯6 / ♭7", 10),
    ("7", "7", 11), ("8", "8", 12),
)
for degree_id, label, offset in DEGREE_SPECS:
    SCORE_PATTERNS[f"degree-{degree_id}"] = ((offset,), (label,))
ARPEGGIO_ROOTS = {
    "soprano": {"root": 65, "first": 65, "second": 53},
    "alto": {"root": 53, "first": 53, "second": 53},
    "tenor": {"root": 53, "first": 53, "second": 41},
    "bass": {"root": 41, "first": 41, "second": 41},
}
DEGREE_ROOTS = {"soprano": 65, "alto": 53, "tenor": 53, "bass": 41}
SCALE_SPELLINGS = {
    5: (-1, (("F", 0), ("G", 0), ("A", 0), ("B", -1), ("C", 0))),
    6: (6, (("F", 1), ("G", 1), ("A", 1), ("B", 0), ("C", 1))),
    7: (1, (("G", 0), ("A", 0), ("B", 0), ("C", 0), ("D", 0))),
    8: (-4, (("A", -1), ("B", -1), ("C", 0), ("D", -1), ("E", -1))),
}
NATURAL_PITCH_CLASSES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def pitch_xml(midi: int) -> str:
    step, alter = PITCHES[midi % 12]
    alteration = f"<alter>{alter}</alter>" if alter else ""
    return f"<pitch><step>{step}</step>{alteration}<octave>{midi // 12 - 1}</octave></pitch>"


def spelled_pitch_xml(midi: int, step: str, alter: int) -> str:
    alteration = f"<alter>{alter}</alter>" if alter else ""
    octave = (midi - NATURAL_PITCH_CLASSES[step] - alter) // 12 - 1
    return f"<pitch><step>{step}</step>{alteration}<octave>{octave}</octave></pitch>"


def score_pitch_xml(pattern_id: str, root_midi: int, index: int, midi: int) -> str:
    if pattern_id != "scale-major":
        return pitch_xml(midi)
    degree_indexes = (0, 1, 2, 3, 4, 3, 2, 1, 0)
    _, spellings = SCALE_SPELLINGS[root_midi % 12]
    return spelled_pitch_xml(midi, *spellings[degree_indexes[index]])


def exercise_score_xml(role: str, pattern_id: str, root_midi: int) -> str:
    """Compact engraved exercise; MuseScore owns every visible music glyph."""
    offsets, labels = SCORE_PATTERNS[pattern_id]
    key_fifths = SCALE_SPELLINGS[root_midi % 12][0] if pattern_id == "scale-major" else -1
    measures, event_index = [], 0
    while event_index < len(offsets):
        measure_notes = []
        take = min(4, len(offsets) - event_index)
        for local_index in range(take):
            index = event_index + local_index
            notations = []
            if index == 0 and len(offsets) > 1:
                notations.append('<slur type="start" number="1"/>')
            if index == len(offsets) - 1 and len(offsets) > 1:
                notations.append('<slur type="stop" number="1"/>')
            notation_xml = f'<notations>{"".join(notations)}</notations>' if notations else ""
            lyric = f'<lyric number="1"><syllabic>single</syllabic><text>{labels[index]}</text></lyric>'
            duration, note_type = (16, "whole") if len(offsets) == 1 else (4, "quarter")
            midi = root_midi + offsets[index]
            measure_notes.append(f'<note>{score_pitch_xml(pattern_id, root_midi, index, midi)}'
                                 f'<duration>{duration}</duration><voice>1</voice><type>{note_type}</type>'
                                 f'{notation_xml}{lyric}</note>')
        event_index += take
        if len(offsets) > 1 and take < 4:
            remaining = 4 - take
            rest_type = "half" if remaining >= 2 else "quarter"
            dot = "<dot/>" if remaining == 3 else ""
            measure_notes.append(f'<note><rest/><duration>{remaining * 4}</duration><voice>1</voice>'
                                 f'<type>{rest_type}</type>{dot}</note>')
        measure_number = len(measures) + 1
        attributes = ""
        if measure_number == 1:
            if role == "bass":
                clef = '<clef><sign>F</sign><line>4</line></clef>'
            elif role == "tenor":
                clef = '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>'
            else:
                clef = '<clef><sign>G</sign><line>2</line></clef>'
            attributes = (f'<attributes><divisions>4</divisions><key><fifths>{key_fifths}</fifths></key>'
                          f'<time><beats>4</beats><beat-type>4</beat-type></time>{clef}</attributes>')
        barline = '<barline location="right"><bar-style>light-heavy</bar-style></barline>' if event_index == len(offsets) else ""
        measures.append(f'<measure number="{measure_number}">{attributes}{"".join(measure_notes)}{barline}</measure>')
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><identification><creator type="software">Choir Assistant Voice Lab</creator></identification>
<part-list><score-part id="P1"><part-name>{role.title()}</part-name><score-instrument id="P1-I1"><instrument-name>{role.title()}</instrument-name><instrument-sound>voice.{role}</instrument-sound></score-instrument></score-part></part-list>
<part id="P1">{''.join(measures)}</part></score-partwise>'''


def sustained_choir_xml(role: str, midi: int) -> str:
    """A tied 36-second tone with a clean Muse Sounds attack and long body."""
    measures = []
    for index in range(15):
        ties = ('<tie type="start"/><notations><tied type="start"/></notations>' if index == 0 else
                '<tie type="stop"/><notations><tied type="stop"/></notations>' if index == 14 else
                '<tie type="stop"/><tie type="start"/><notations><tied type="stop"/><tied type="start"/></notations>')
        attributes = ('<attributes><divisions>2</divisions><key><fifths>0</fifths></key>'
                      '<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>'
                      f'{"F" if role in ("tenor", "bass") else "G"}</sign><line>{4 if role in ("tenor", "bass") else 2}</line></clef></attributes>') if index == 0 else ""
        tempo = '<direction><sound tempo="100" dynamics="72"/></direction>' if index == 0 else ""
        measures.append(f'<measure number="{index + 1}">{attributes}{tempo}<note>{pitch_xml(midi)}<duration>8</duration>'
                        f'<voice>1</voice><type>whole</type>{ties}</note></measure>')
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><identification><creator type="software">Choir Assistant Voice Lab</creator></identification>
<part-list><score-part id="P1"><part-name>{role.title()}</part-name><score-instrument id="P1-I1"><instrument-name>{role.title()}</instrument-name><instrument-sound>voice.{role}</instrument-sound></score-instrument></score-part></part-list>
<part id="P1">{''.join(measures)}</part></score-partwise>'''


def guide_phrase_xml(role: str, pattern_id: str, root_midi: int, preview_bpm: int) -> str:
    """One slurred gesture rendered as a continuous Muse Choir performance."""
    offsets = SCORE_PATTERNS[pattern_id][0]
    notes = []
    apex = len(offsets) // 2
    for index, offset in enumerate(offsets):
        slur = (f'<notations><slur type="start" number="1"/></notations>' if index == 0 else
                f'<notations><slur type="stop" number="1"/></notations>' if index == len(offsets) - 1 else "")
        notes.append(f'<note>{pitch_xml(root_midi + offset)}<duration>4</duration><voice>1</voice>'
                     f'<type>quarter</type>{slur}</note>')
        if index == apex:
            notes.append('<direction placement="below"><direction-type><wedge type="stop" number="1"/>'
                         '<wedge type="diminuendo" number="2"/></direction-type><sound dynamics="72"/></direction>')
    clef_sign = "F" if role in ("tenor", "bass") else "G"
    clef_line = 4 if role in ("tenor", "bass") else 2
    opening = (f'<attributes><divisions>4</divisions><key><fifths>0</fifths></key>'
               f'<time><beats>{len(offsets)}</beats><beat-type>4</beat-type></time>'
               f'<clef><sign>{clef_sign}</sign><line>{clef_line}</line></clef></attributes>'
               f'<direction placement="below"><direction-type><dynamics><mp/></dynamics></direction-type>'
               f'<sound tempo="{preview_bpm}" dynamics="62"/></direction>'
               '<direction placement="below"><direction-type><wedge type="crescendo" number="1"/></direction-type></direction>')
    notes.append('<direction placement="below"><direction-type><wedge type="stop" number="2"/></direction-type>'
                 '<sound dynamics="60"/></direction>')
    tail = '<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
    tail += '<note><rest/><duration>16</duration><voice>1</voice><type>whole</type></note>'
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><identification><creator type="software">Choir Assistant Voice Lab</creator></identification>
<part-list><score-part id="P1"><part-name>{role.title()}</part-name><score-instrument id="P1-I1"><instrument-name>{role.title()}</instrument-name><instrument-sound>voice.{role}</instrument-sound></score-instrument></score-part></part-list>
<part id="P1"><measure number="1">{opening}{''.join(notes)}</measure><measure number="2">{tail}</measure></part></score-partwise>'''


def scale_phrase_xml(role: str, root_midi: int, preview_bpm: int) -> str:
    """Compatibility wrapper for the scale phrase used by tests and tooling."""
    return guide_phrase_xml(role, "scale-major", root_midi, preview_bpm)


def pad_xml(root_pitch_class: int, quality: str = "major") -> str:
    """A restrained low string bed voiced for the exercise's chord quality."""
    if quality not in {"major", "minor"}:
        raise ValueError(f"Qualità del pad non supportata: {quality}")
    root_midi = 36 + root_pitch_class
    third = 4 if quality == "major" else 3
    chord = (root_midi, root_midi + 7, root_midi + 12, root_midi + 12 + third)
    measures = []
    for measure_index in range(6):
        attributes = ('<attributes><divisions>2</divisions><key><fifths>0</fifths></key>'
                      '<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef>'
                      '</attributes>') if measure_index == 0 else ""
        direction = ('<direction placement="below"><direction-type><dynamics><pp/></dynamics></direction-type>'
                     '<sound tempo="60" dynamics="38"/></direction>') if measure_index == 0 else ""
        chord_notes = []
        for note_index, midi in enumerate(chord):
            chord_tag = '<chord/>' if note_index else ''
            if measure_index == 0:
                ties = '<tie type="start"/><notations><tied type="start"/></notations>'
            elif measure_index == 5:
                ties = '<tie type="stop"/><notations><tied type="stop"/></notations>'
            else:
                ties = ('<tie type="stop"/><tie type="start"/><notations><tied type="stop"/>'
                        '<tied type="start"/></notations>')
            chord_notes.append(f'<note>{chord_tag}{pitch_xml(midi)}<duration>8</duration><voice>1</voice>'
                               f'<type>whole</type>{ties}</note>')
        measures.append(f'<measure number="{measure_index + 1}">{attributes}{direction}{"".join(chord_notes)}</measure>')
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><identification><creator type="software">Choir Assistant Voice Lab</creator></identification>
<part-list><score-part id="P1"><part-name>Warm strings</part-name><score-instrument id="P1-I1"><instrument-name>Strings</instrument-name><instrument-sound>strings.group</instrument-sound></score-instrument></score-part></part-list>
<part id="P1">{''.join(measures)}</part></score-partwise>'''


def run(*args: str) -> None:
    result = subprocess.run([str(MUSESCORE), "-f", *args], capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout)[-1000:])


def write_if_changed(path: Path, content: str) -> bool:
    if path.is_file() and path.read_text(encoding="utf-8") == content:
        return False
    path.write_text(content, encoding="utf-8"); return True


def apply_muse_choir(mscz_path: Path, role: str) -> None:
    preset = CHOIR_PRESETS[role]
    with ZipFile(mscz_path) as source:
        settings = json.loads(source.read("audiosettings.json"))
        track = next((item for item in settings["tracks"] if item.get("partId") != "999"), None)
        if track is None:
            track = {"partId": "1", "instrumentId": role, "out": {"balance": 0, "fxChain": {}, "volumeDb": 0}}
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


def compact_score_layout(mscz_path: Path) -> bool:
    """Prevent short exercises from stretching across an entire printed page."""
    with ZipFile(mscz_path) as source:
        style = source.read("score_style.mss")
        desired = b"<lastSystemFillLimit>1</lastSystemFillLimit>"
        if desired in style:
            return False
        original = b"<lastSystemFillLimit>0.3</lastSystemFillLimit>"
        if original not in style:
            raise RuntimeError(f"Stile MuseScore inatteso: {mscz_path}")
        with tempfile.NamedTemporaryFile(dir=mscz_path.parent, suffix=".mscz.tmp", delete=False) as handle:
            temporary = Path(handle.name)
        with ZipFile(temporary, "w") as updated:
            for item in source.infolist():
                data = style.replace(original, desired) if item.filename == "score_style.mss" else source.read(item)
                updated.writestr(item, data)
    for attempt in range(6):
        try:
            os.replace(temporary, mscz_path)
            return True
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(.1 * (attempt + 1))
    return False


def main() -> int:
    if not MUSESCORE.is_file():
        raise SystemExit("MuseScore 4 non disponibile")
    choir_source, choir_public = SOURCE / "choir", PUBLIC / "choir"
    phrase_source, phrase_public = SOURCE / "phrases", PUBLIC / "phrases"
    pad_source, pad_public = SOURCE / "pads", PUBLIC / "pads"
    score_source, score_public = SOURCE / "scores", PUBLIC / "scores"
    for directory in (choir_source, choir_public, phrase_source, phrase_public, pad_source, pad_public,
                      score_source, score_public):
        directory.mkdir(parents=True, exist_ok=True)
    manifest = {"schemaVersion": 3, "timbre": "MuseScore Muse Sounds Choir", "choirSamples": {
        "sourceDurationSeconds": 36, "format": "flac", "roles": {}},
        "guidePhrases": {"format": "flac", "items": []},
        "pads": {"format": "flac", "qualities": ["major", "minor"], "items": []},
        "scoreSvgs": {"engraver": "MuseScore 4", "format": "svg", "items": []}}
    for role, preset in CHOIR_PRESETS.items():
        manifest["choirSamples"]["roles"][role] = {"anchors": list(preset["anchors"]),
            "urlTemplate": f"voice-lab-assets/choir/{role}-{{midi}}.flac", "timbre": f"Muse Choir {preset['name']}"}
        for midi in preset["anchors"]:
            xml_path, mscz_path = choir_source / f"{role}-{midi}.musicxml", choir_source / f"{role}-{midi}.mscz"
            audio_path = choir_public / f"{role}-{midi}.flac"
            changed = write_if_changed(xml_path, sustained_choir_xml(role, midi))
            if changed or not mscz_path.is_file():
                run("-o", str(mscz_path), str(xml_path)); apply_muse_choir(mscz_path, role)
            if changed or not audio_path.is_file():
                run("-o", str(audio_path), str(mscz_path))
    for role, tempos in SCALE_ROOTS.items():
        for bpm, roots in tempos.items():
            preview_bpm = bpm
            for root_midi in roots:
                stem = f"scale-major-r{root_midi}-p{preview_bpm}-{role}"
                xml_path, mscz_path = phrase_source / f"{stem}.musicxml", phrase_source / f"{stem}.mscz"
                audio_path = phrase_public / f"{stem}.flac"
                changed = write_if_changed(xml_path, scale_phrase_xml(role, root_midi, preview_bpm))
                if changed or not mscz_path.is_file():
                    run("-o", str(mscz_path), str(xml_path)); apply_muse_choir(mscz_path, role)
                if changed or not audio_path.is_file():
                    run("-o", str(audio_path), str(mscz_path))
                manifest["guidePhrases"]["items"].append({"patternId": "scale-major", "role": role,
                    "rootMidi": root_midi, "previewBpm": preview_bpm,
                    "file": f"voice-lab-assets/phrases/{stem}.flac"})
    for role, positions in ARPEGGIO_ROOTS.items():
        for inversion, root_midi in positions.items():
            for quality in ("major", "minor"):
                pattern_id = f"triad-{quality}-{inversion}"
                for preview_bpm in (60, 80, 100):
                    stem = f"{pattern_id}-r{root_midi}-p{preview_bpm}-{role}"
                    xml_path = phrase_source / f"{stem}.musicxml"
                    mscz_path = phrase_source / f"{stem}.mscz"
                    audio_path = phrase_public / f"{stem}.flac"
                    changed = write_if_changed(xml_path, guide_phrase_xml(role, pattern_id, root_midi, preview_bpm))
                    if changed or not mscz_path.is_file():
                        run("-o", str(mscz_path), str(xml_path)); apply_muse_choir(mscz_path, role)
                    if changed or not audio_path.is_file():
                        run("-o", str(audio_path), str(mscz_path))
                    manifest["guidePhrases"]["items"].append({"patternId": pattern_id, "role": role,
                        "rootMidi": root_midi, "previewBpm": preview_bpm,
                        "file": f"voice-lab-assets/phrases/{stem}.flac"})
    for quality in ("major", "minor"):
        for pitch_class in PAD_ROOT_PITCH_CLASSES:
            stem = f"{quality}-pc{pitch_class}"
            xml_path, mscz_path = pad_source / f"{stem}.musicxml", pad_source / f"{stem}.mscz"
            audio_path = pad_public / f"{stem}.flac"
            changed = write_if_changed(xml_path, pad_xml(pitch_class, quality))
            if changed or not mscz_path.is_file():
                run("-o", str(mscz_path), str(xml_path))
            if changed or not audio_path.is_file():
                run("-o", str(audio_path), str(mscz_path))
            manifest["pads"]["items"].append({"quality": quality, "rootPitchClass": pitch_class,
                "file": f"voice-lab-assets/pads/{stem}.flac"})
    score_specs = set()
    for role, tempos in SCALE_ROOTS.items():
        for roots in tempos.values():
            score_specs.update((role, "scale-major", root_midi) for root_midi in roots)
    for role, positions in ARPEGGIO_ROOTS.items():
        for inversion, root_midi in positions.items():
            score_specs.add((role, f"triad-major-{inversion}", root_midi))
            score_specs.add((role, f"triad-minor-{inversion}", root_midi))
    for role, root_midi in DEGREE_ROOTS.items():
        score_specs.update((role, f"degree-{degree_id}", root_midi) for degree_id, _, _ in DEGREE_SPECS)
    for role, pattern_id, root_midi in sorted(score_specs):
        stem = f"{pattern_id}-r{root_midi}-{role}"
        xml_path, mscz_path = score_source / f"{stem}.musicxml", score_source / f"{stem}.mscz"
        svg_path = score_public / f"{stem}.svg"
        changed = write_if_changed(xml_path, exercise_score_xml(role, pattern_id, root_midi))
        if changed or not mscz_path.is_file():
            run("-o", str(mscz_path), str(xml_path))
        compacted = compact_score_layout(mscz_path)
        if changed or compacted or not svg_path.is_file():
            run("-T", "12", "-o", str(svg_path), str(mscz_path))
        alternate = score_public / f"{stem}-1.svg"
        # MuseScore appends “-1” instead of overwriting an existing SVG. Promote
        # that fresh export even when the old target still exists.
        if alternate.is_file():
            os.replace(alternate, svg_path)
        if not svg_path.is_file():
            raise RuntimeError(f"MuseScore non ha prodotto lo spartito {stem}")
        manifest["scoreSvgs"]["items"].append({"patternId": pattern_id, "role": role,
            "rootMidi": root_midi, "file": f"voice-lab-assets/scores/{stem}.svg"})
    PUBLIC.mkdir(parents=True, exist_ok=True)
    expected_phrase_files = {Path(item["file"]).name for item in manifest["guidePhrases"]["items"]}
    expected_phrase_stems = {Path(name).stem for name in expected_phrase_files}
    for path in phrase_public.iterdir():
        if path.is_file() and path.suffix == ".flac" and path.name not in expected_phrase_files:
            path.unlink()
    for path in phrase_source.iterdir():
        if path.is_file() and path.suffix in {".musicxml", ".mscz"} and path.stem not in expected_phrase_stems:
            path.unlink()
    (PUBLIC / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    report = audit_voice_lab_artifacts()
    print(f"Voice Lab assets: {report['choirFiles']} campioni, {report['phraseFiles']} frasi, "
          f"{report['padFiles']} pad, {report['scoreFiles']} spartiti -> {PUBLIC}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
