"""Prepare blind local WAV clips and an unlabelled acoustic annotation template.

python scripts/prepare_pitch_annotations.py input.f32 --sample-rate 48000 \
  --windows 0:2.4,16:18.5,19.5:22.5,25:28.5,53.5:57.5 --out artifacts/pitch-research/annotations

Templates deliberately contain voiced:null and cannot be evaluated until a
reviewer supplies voiced:true (no F0 known), hz:null (unvoiced) or hz:positive.
Do not replace unknown labels with detector predictions or score targets.
"""
import argparse
import array
import hashlib
import json
import math
import sys
import wave
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pcm', type=Path)
    parser.add_argument('--sample-rate', type=int, required=True)
    parser.add_argument('--windows', required=True, help='Absolute seconds start:end,...')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.sample_rate <= 0:
        raise SystemExit('Invalid sample rate')
    data = args.pcm.read_bytes()
    samples = array.array('f')
    samples.frombytes(data)
    if sys.byteorder != 'little':
        samples.byteswap()
    if not all(math.isfinite(value) for value in samples):
        raise SystemExit('Nonfinite PCM')
    duration = len(samples) / args.sample_rate
    windows = sorted(tuple(map(float, item.split(':'))) for item in args.windows.split(','))
    for index, (start, end) in enumerate(windows):
        if not 0 <= start < end <= duration or (index and start < windows[index - 1][1]):
            raise SystemExit('Invalid or overlapping clip windows')
    args.out.mkdir(parents=True, exist_ok=True)
    frames, clips = [], []
    for index, (start, end) in enumerate(windows):
        filename = f'clip-{index + 1:02}.wav'
        pcm16 = array.array('h', (round(max(-1, min(1, value)) * 32767)
                                 for value in samples[round(start * args.sample_rate):round(end * args.sample_rate)]))
        if sys.byteorder != 'little':
            pcm16.byteswap()
        with wave.open(str(args.out / filename), 'wb') as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(args.sample_rate)
            output.writeframes(pcm16.tobytes())
        clips.append({'file': filename, 'startSec': start, 'endSec': end})
        for step in range(math.ceil((end - start) / .05)):
            frames.append({'startSec': round(start + step * .05, 6),
                           'endSec': round(min(end, start + (step + 1) * .05), 6), 'voiced': None})
    template = {'audioSha256': hashlib.sha256(data).hexdigest(), 'sampleRate': args.sample_rate,
                'referenceKind': 'manual-acoustic', 'reviewer': None, 'reviewStatus': 'unlabelled',
                'clips': clips, 'frames': frames}
    destination = args.out / 'reference.unlabelled.json'
    destination.write_text(json.dumps(template, indent=2), encoding='utf-8')
    print(f'Created {len(clips)} blind clips and {len(frames)} unknown intervals: {destination}')


if __name__ == '__main__':
    main()
