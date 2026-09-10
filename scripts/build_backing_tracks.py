"""Build synchronized rehearsal mixes from the normalized performance timeline.

The generated audio is disposable: the approved MusicXML and normalized score
remain canonical. Each singer hears organ plus the other three vocal parts.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path


PARTS = {
    "P1": {"name": "Soprano", "program": 52, "channel": 0, "velocity": 76},
    "P2": {"name": "Contralto", "program": 52, "channel": 1, "velocity": 76},
    "P3": {"name": "Tenore", "program": 52, "channel": 2, "velocity": 76},
    "P4": {"name": "Basso", "program": 52, "channel": 3, "velocity": 76},
    "P5": {"name": "Organo", "program": 19, "channel": 4, "velocity": 68},
}
TICKS_PER_QUARTER = 480


def variable_length(value: int) -> bytes:
    buffer = value & 0x7F
    result = bytearray([buffer])
    while value >> 7:
        value >>= 7
        buffer = (value & 0x7F) | 0x80
        result.insert(0, buffer)
    return bytes(result)


def midi_track(score: dict, part_id: str, output: Path) -> None:
    settings = PARTS[part_id]
    channel = int(settings["channel"])
    events: list[tuple[int, int, bytes]] = []
    for tempo_point in score["tempo_map"]:
        tempo_tick = round(float(tempo_point["beat"]) * TICKS_PER_QUARTER)
        microseconds = round(60_000_000 / float(tempo_point["bpm"]))
        events.append((tempo_tick, 0, b"\xff\x51\x03" + microseconds.to_bytes(3, "big")))
    name = settings["name"].encode("utf-8")
    events.append((0, 0, b"\xff\x03" + variable_length(len(name)) + name))
    events.append((0, 0, bytes([0xC0 | channel, int(settings["program"])])))

    for event in score["target_events"]:
        if event["part_id"] != part_id or event["is_rest"] or event["midi_pitch"] is None:
            continue
        start = round(float(event["onset_beats"]) * TICKS_PER_QUARTER)
        end = round((float(event["onset_beats"]) + float(event["duration_beats"])) * TICKS_PER_QUARTER)
        pitch = int(event["midi_pitch"])
        velocity = int(settings["velocity"])
        events.append((start, 1, bytes([0x90 | channel, pitch, velocity])))
        events.append((max(start + 1, end), 0, bytes([0x80 | channel, pitch, 0])))

    final_beat = max(float(item["end_beat"]) for item in score["performance_occurrences"])
    final_tick = round(final_beat * TICKS_PER_QUARTER)
    events.append((final_tick, 2, b"\xff\x2f\x00"))
    events.sort(key=lambda item: (item[0], item[1]))

    payload = bytearray()
    cursor = 0
    for tick, _, message in events:
        payload.extend(variable_length(max(0, tick - cursor)))
        payload.extend(message)
        cursor = tick
    header = b"MThd" + (6).to_bytes(4, "big") + (0).to_bytes(2, "big") + (1).to_bytes(2, "big") + TICKS_PER_QUARTER.to_bytes(2, "big")
    track = b"MTrk" + len(payload).to_bytes(4, "big") + payload
    output.write_bytes(header + track)


def resolve_executable(name: str, fallback: Path) -> Path:
    found = shutil.which(name)
    result = Path(found) if found else fallback
    if not result.exists():
        raise FileNotFoundError(f"Executable not found: {result}")
    return result


def run(command: list[str]) -> None:
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("score_json", type=Path)
    parser.add_argument("build_directory", type=Path)
    parser.add_argument("asset_directory", type=Path)
    args = parser.parse_args()

    score = json.loads(args.score_json.read_text(encoding="utf-8"))
    args.build_directory.mkdir(parents=True, exist_ok=True)
    args.asset_directory.mkdir(parents=True, exist_ok=True)
    muse_score = resolve_executable("MuseScore4", Path(r"C:\Program Files\MuseScore 4\bin\MuseScore4.exe"))
    ffmpeg = resolve_executable("ffmpeg", Path(r"C:\Program Files\FFmpeg\Providers\org.buanzo.ffmpeg8.1\bin\ffmpeg.exe"))

    duration = max(float(item["end_seconds"]) for item in score["performance_occurrences"])
    wav_files: dict[str, Path] = {}
    for part_id in PARTS:
        midi = args.build_directory / f"{part_id}.mid"
        wav = args.build_directory / f"{part_id}.wav"
        midi_track(score, part_id, midi)
        run([str(muse_score), "-f", "-o", str(wav), str(midi)])
        wav_files[part_id] = wav

    mixes = {}
    for selected_part in list(PARTS)[:4]:
        included = [part_id for part_id in PARTS if part_id != selected_part]
        inputs: list[str] = []
        filters: list[str] = []
        labels: list[str] = []
        for index, part_id in enumerate(included):
            inputs.extend(["-i", str(wav_files[part_id])])
            volume = 0.68 if part_id == "P5" else 0.42
            label = f"a{index}"
            filters.append(f"[{index}:a]volume={volume}[{label}]")
            labels.append(f"[{label}]")
        filters.append(
            f"{''.join(labels)}amix=inputs={len(labels)}:duration=longest:normalize=0,"
            f"alimiter=limit=0.92,atrim=duration={duration:.6f},asetpts=PTS-STARTPTS[mix]"
        )
        filename = f"gloria-backing-{selected_part}.mp3"
        destination = args.asset_directory / filename
        run([
            str(ffmpeg), "-y", *inputs,
            "-filter_complex", ";".join(filters), "-map", "[mix]",
            "-ar", "44100", "-ac", "2", "-codec:a", "libmp3lame", "-b:a", "192k",
            str(destination),
        ])
        mixes[selected_part] = {
            "file": filename,
            "excluded_part": selected_part,
            "included_parts": included,
        }

    manifest = {
        "score_version_id": score["score_version_id"],
        "duration_seconds": duration,
        "tempo_map": score["tempo_map"],
        "mix_strategy": "organ at 0.68 plus each non-selected SATB voice at 0.42",
        "mixes": mixes,
    }
    (args.asset_directory / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
