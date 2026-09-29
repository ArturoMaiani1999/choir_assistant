"""Build reviewed, local-only notation and vocal audio for Voice Lab exercises."""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from check_voice_lab_artifacts import audit_voice_lab_artifacts

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "sheets" / "voice-lab"
PUBLIC = ROOT / "frontend" / "voice-lab-assets"
MUSESCORE = Path(r"C:\Program Files\MuseScore 4\bin\MuseScore4.exe")

PITCHES = {0: ("C", 0), 1: ("C", 1), 2: ("D", 0), 3: ("E", -1), 4: ("E", 0), 5: ("F", 0),
           6: ("F", 1), 7: ("G", 0), 8: ("A", -1), 9: ("A", 0), 10: ("B", -1), 11: ("B", 0)}
ROLE_INTERVAL_BASES = {"soprano": 63, "alto": 58, "tenor": 51, "bass": 43}
INTERVAL_DISTANCES = (0, 1, 2, 3, 4, 5, 7, 8, 9, 11, 12)


def pitch_xml(midi: int) -> str:
    step, alter = PITCHES[midi % 12]
    alteration = f"<alter>{alter}</alter>" if alter else ""
    return f"<pitch><step>{step}</step>{alteration}<octave>{midi // 12 - 1}</octave></pitch>"


def score_xml(title: str, notes: list[tuple[int, int]], harmonic: bool = False) -> str:
    body = []
    average_midi = sum(midi for midi, _ in notes) / len(notes)
    clef_sign, clef_line = ("F", 4) if average_midi < 60 else ("G", 2)
    for index, (midi, duration) in enumerate(notes):
        attributes = ("<attributes><divisions>2</divisions><key><fifths>0</fifths></key>"
                      f"<time print-object=\"no\"><beats>4</beats><beat-type>4</beat-type></time><clef><sign>{clef_sign}</sign><line>{clef_line}</line></clef></attributes>") if index == 0 else ""
        open_measure = f"<measure number=\"{index + 1}\">" if not harmonic or index == 0 else ""
        close_measure = "</measure>" if not harmonic or index == len(notes) - 1 else ""
        chord = "<chord/>" if harmonic and index else ""
        body.append(f"{open_measure}{attributes}<direction><sound tempo=\"72\"/></direction><note>{chord}{pitch_xml(midi)}<duration>{duration}</duration><voice>1</voice>"
                    f"<type>{'whole' if duration == 8 else 'half'}</type></note>{close_measure}")
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><work><work-title>{title}</work-title></work><identification><creator type="software">Choir Assistant Voice Lab</creator></identification>
<part-list><score-part id="P1"><part-name print-object="no">Voce</part-name><score-instrument id="P1-I1"><instrument-name>Voce</instrument-name><instrument-sound>voice.vocals</instrument-sound></score-instrument><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>53</midi-program></midi-instrument></score-part></part-list>
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


def main() -> int:
    if not MUSESCORE.is_file():
        raise SystemExit("MuseScore 4 non disponibile")
    SOURCE.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    definitions = {
        "listen-repeat": ("Ascolta e ripeti", [(60, 4)], False),
        "sustain": ("Mantieni la nota", [(60, 8)], False),
        "interval-melodic": ("Intervallo melodico", [(60, 4), (64, 4)], False),
        "interval-harmonic": ("Intervallo armonico", [(60, 8), (64, 8)], True),
    }
    manifest = {"schemaVersion": 1, "timbre": "General MIDI voice (program 53)", "templates": {}}
    for slug, (title, notes, harmonic) in definitions.items():
        xml_path, mscz_path, svg_path = SOURCE / f"{slug}.musicxml", SOURCE / f"{slug}.mscz", PUBLIC / f"{slug}.svg"
        xml_path.write_text(score_xml(title, notes, harmonic), encoding="utf-8")
        if not mscz_path.is_file():
            run("-o", str(mscz_path), str(xml_path))
        if not (PUBLIC / f"{slug}-1.svg").is_file():
            run("-o", str(svg_path), str(mscz_path))
        rendered = svg_path if svg_path.is_file() else PUBLIC / f"{slug}-1.svg"
        if not rendered.is_file():
            raise RuntimeError(f"MuseScore non ha prodotto lo spartito SVG di {slug}")
        manifest["templates"][slug] = {"musicxml": f"../../sheets/voice-lab/{slug}.musicxml", "mscz": f"../../sheets/voice-lab/{slug}.mscz", "score": f"voice-lab-assets/{rendered.name}"}
    sample_xml, sample_mscz = SOURCE / "voice-sample.musicxml", SOURCE / "voice-sample.mscz"
    sample_xml.write_text(score_xml("Campione vocale", [(60, 8)]), encoding="utf-8")
    if not sample_mscz.is_file():
        run("-o", str(sample_mscz), str(sample_xml))
    sample_wav = PUBLIC / "choir-voice-c4.wav"
    if not sample_wav.is_file():
        run("-o", str(sample_wav), str(sample_mscz))
    manifest["audioSample"] = "voice-lab-assets/choir-voice-c4.wav"
    note_source, note_public = SOURCE / "notes", PUBLIC / "notes"
    note_source.mkdir(exist_ok=True); note_public.mkdir(exist_ok=True)
    for midi in range(36, 85):
        xml_path, mscz_path, svg_path = note_source / f"note-{midi}.musicxml", note_source / f"note-{midi}.mscz", note_public / f"note-{midi}.svg"
        xml_path.write_text(score_xml("", [(midi, 8)]), encoding="utf-8")
        if not mscz_path.is_file():
            run("-o", str(mscz_path), str(xml_path))
        if not (note_public / f"note-{midi}-1.svg").is_file():
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
        harmonic = mode == "harmonic"; duration = 8 if harmonic else 4
        xml_path.write_text(score_xml("", [(first, duration), (second, duration)], harmonic), encoding="utf-8")
        if not mscz_path.is_file():
            mscz_jobs.append({"in": str(xml_path), "out": str(mscz_path)})
        if not (interval_public / f"{slug}-1.svg").is_file():
            svg_jobs.append({"in": str(mscz_path), "out": str(svg_path)})
    run_jobs(mscz_jobs)
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
