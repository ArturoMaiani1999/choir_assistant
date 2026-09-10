"""Render one monophonic review guide from a normalized score timeline."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from build_backing_tracks import TICKS_PER_QUARTER, resolve_executable, variable_length


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_midi(
    score: dict,
    part_id: str,
    output: Path,
    *,
    program: int,
    velocity: int,
    chord_overlap_beats: float = 0.0,
    chord_lead_beats: float = 0.0,
) -> None:
    targets = sorted(
        (event for event in score["target_events"] if event["part_id"] == part_id and not event["is_rest"]),
        key=lambda event: event["onset_beats"],
    )
    intervals: list[dict] = []
    for event in targets:
        start = float(event["onset_beats"])
        end = start + float(event["duration_beats"])
        if (
            intervals and event.get("tie_stop") and intervals[-1]["pitch"] == event["midi_pitch"]
            and abs(intervals[-1]["end"] - start) < 1e-6
        ):
            intervals[-1]["end"] = end
            intervals[-1]["tie_start"] = event.get("tie_start", False)
        else:
            intervals.append({"start": start, "end": end, "pitch": event["midi_pitch"], "tie_start": event.get("tie_start", False)})

    events: list[tuple[int, int, bytes]] = []
    for tempo in score["tempo_map"]:
        tick = round(float(tempo["beat"]) * TICKS_PER_QUARTER)
        micros = round(60_000_000 / float(tempo["bpm"]))
        events.append((tick, 0, b"\xff\x51\x03" + micros.to_bytes(3, "big")))
    # Alternating channels let adjacent sustained chords overlap without a
    # note-off from the old voicing cutting a shared pitch in the new one.
    channels = (0, 1) if chord_overlap_beats else (0,)
    for channel in channels:
        events.append((0, 0, bytes([0xC0 | channel, program])))
    for interval in intervals:
        # String samples speak a little slowly. Start later chords just ahead
        # of the barline so their audible attack lands on the harmonic change.
        adjusted_start = interval["start"] if interval["start"] == 0 else max(0.0, interval["start"] - chord_lead_beats)
        start = round(adjusted_start * TICKS_PER_QUARTER)
        end = round((interval["end"] + chord_overlap_beats) * TICKS_PER_QUARTER)
        pitch = int(interval["pitch"])
        channel = channels[int(interval["start"] // 4) % len(channels)]
        events.append((start, 1, bytes([0x90 | channel, pitch, velocity])))
        events.append((end, 0, bytes([0x80 | channel, pitch, 0])))
    final_tick = round((max(item["end_beat"] for item in score["performance_occurrences"]) + chord_overlap_beats) * TICKS_PER_QUARTER)
    events.append((final_tick, 2, b"\xff\x2f\x00"))
    events.sort(key=lambda item: (item[0], item[1]))
    payload = bytearray()
    cursor = 0
    for tick, _, message in events:
        payload.extend(variable_length(tick - cursor))
        payload.extend(message)
        cursor = tick
    output.write_bytes(b"MThd" + (6).to_bytes(4, "big") + (0).to_bytes(2, "big") + (1).to_bytes(2, "big") + TICKS_PER_QUARTER.to_bytes(2, "big") + b"MTrk" + len(payload).to_bytes(4, "big") + payload)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("timeline", type=Path)
    parser.add_argument("build_directory", type=Path)
    parser.add_argument("asset_directory", type=Path)
    args = parser.parse_args()
    score = json.loads(args.timeline.read_text(encoding="utf-8"))
    part_id = score["parts"][0]["id"]
    organ_part_id = next(part["id"] for part in score["parts"] if part["name"].lower() == "organo")
    args.build_directory.mkdir(parents=True, exist_ok=True)
    args.asset_directory.mkdir(parents=True, exist_ok=True)
    melody_midi = args.build_directory / "melody.mid"
    strings_midi = args.build_directory / "strings.mid"
    melody_wav = args.build_directory / "melody.wav"
    strings_wav = args.build_directory / "strings.wav"
    mp3 = args.asset_directory / "ecco-mvp-guide.mp3"
    duration = max(item["end_seconds"] for item in score["performance_occurrences"])
    write_midi(score, part_id, melody_midi, program=52, velocity=78)
    write_midi(
        score,
        organ_part_id,
        strings_midi,
        program=48,
        velocity=58,
        chord_overlap_beats=0.06,
        chord_lead_beats=0.22,
    )
    muse_score = resolve_executable("MuseScore4", Path(r"C:\Program Files\MuseScore 4\bin\MuseScore4.exe"))
    ffmpeg = resolve_executable("ffmpeg", Path(r"C:\Program Files\FFmpeg\Providers\org.buanzo.ffmpeg8.1\bin\ffmpeg.exe"))
    subprocess.run([str(muse_score), "-f", "-o", str(melody_wav), str(melody_midi)], check=True)
    subprocess.run([str(muse_score), "-f", "-o", str(strings_wav), str(strings_midi)], check=True)
    filter_graph = (
        "[0:a]volume=0.92[melody];"
        "[1:a]volume=0.62,aecho=0.84:0.14:22|42:0.07|0.025[strings];"
        "[melody][strings]amix=inputs=2:duration=longest:normalize=0,"
        f"alimiter=limit=0.92,atrim=duration={duration:.6f},"
        f"afade=t=out:st={duration - 0.4:.6f}:d=0.4,asetpts=PTS-STARTPTS[mix]"
    )
    subprocess.run([
        str(ffmpeg), "-y", "-i", str(melody_wav), "-i", str(strings_wav),
        "-filter_complex", filter_graph, "-map", "[mix]", "-ar", "44100", "-ac", "2",
        "-codec:a", "libmp3lame", "-b:a", "192k", str(mp3),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    speed_files = {"1": mp3.name}
    audio_hashes = {mp3.name: sha256(mp3)}
    for speed in (0.75, 0.5):
        variant = args.asset_directory / f"ecco-mvp-guide-{int(speed * 100)}.mp3"
        stretched_duration = duration / speed
        rubberband = (
            f"rubberband=tempo={speed}:pitch=1:transients=smooth:detector=soft:"
            f"window=long:smoothing=on:channels=together,apad,atrim=duration={stretched_duration:.6f},"
            f"alimiter=limit=0.92,afade=t=out:st={stretched_duration - 0.9:.6f}:d=0.9"
        )
        subprocess.run([
            str(ffmpeg), "-y", "-i", str(mp3), "-filter:a", rubberband,
            "-ar", "44100", "-ac", "2", "-codec:a", "libmp3lame", "-b:a", "192k", str(variant),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        speed_files[str(speed)] = variant.name
        audio_hashes[variant.name] = sha256(variant)
    manifest = {
        "publication_status": "review_ready",
        "score_version_id": score["score_version_id"],
        "timeline_hash": sha256(args.timeline),
        "duration_seconds": duration,
        "mixes": {part_id: {
            "file": mp3.name,
            "files_by_speed": speed_files,
            "time_stretch": "Rubber Band offline, long smooth window",
            "kind": "melody_and_strings_guide",
            "included_parts": [part_id, organ_part_id],
            "accompaniment_sound": "MS Basic / String Ensemble 1",
            "accompaniment_program": 48,
            "chord_overlap_beats": 0.06,
            "chord_lead_beats": 0.22,
            "reverb": "very short two-tap room",
        }},
        "audio_hashes": audio_hashes,
    }
    (args.asset_directory / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
