"""Validate and unpack a locally downloaded echo diagnostic WAV without resampling.

Usage: python scripts/read_echo_diagnostic.py file.wav --output artifacts/echo-test
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import numpy as np


def read(path):
    data = Path(path).read_bytes()
    if data[:4] != b'RIFF' or data[8:12] != b'WAVE' or struct.unpack_from('<I', data, 4)[0] != len(data)-8:
        raise ValueError('Invalid RIFF/WAVE length')
    blocks = {}
    at = 12
    while at < len(data):
        tag, length = struct.unpack_from('<4sI', data, at)
        start = at+8
        if start+length > len(data) or tag in blocks:
            raise ValueError('Truncated or duplicate WAV chunk')
        blocks[tag] = memoryview(data)[start:start+length]
        at = start+length+(length % 2)
    fmt = struct.unpack_from('<HHIIHH', blocks[b'fmt '])
    encoding, channels, rate, byte_rate, align, bits = fmt
    if encoding != 3 or channels != 4 or bits != 32 or align != 16 or byte_rate != rate*16 or rate <= 0:
        raise ValueError('Expected four synchronized float32 channels')
    pcm = np.frombuffer(blocks[b'data'], dtype='<f4').reshape((-1, 4))
    metadata = json.loads(bytes(blocks[b'chAI']))
    names = ['microphone-raw', 'app-reference', 'microphone-processed', 'echo-prediction-unscaled']
    if metadata.get('channelNames') != names or metadata.get('frames') != len(pcm) or metadata.get('sampleRate') != rate:
        raise ValueError('WAV and provenance disagree')
    if not np.isfinite(pcm).all():
        raise ValueError('Non-finite PCM samples')
    return pcm, metadata, hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wav', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    pcm, metadata, digest = read(args.wav)
    args.output.mkdir(parents=True, exist_ok=True)
    summary = []
    for index, name in enumerate(metadata['channelNames']):
        samples = pcm[:, index].copy()
        samples.tofile(args.output / (name+'.f32'))
        summary.append({'channel': name, 'rms': float(np.sqrt(np.mean(samples.astype(float)**2))) if len(samples) else 0,
                        'peak': float(np.max(np.abs(samples))) if len(samples) else 0})
    manifest = {'sourceSha256': digest, 'metadata': metadata, 'channels': summary,
                'note': 'No resampling or normalization. Pitch callbacks have analyser/worker bridge timing; PCM shares one clock.'}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    print(json.dumps({'frames': len(pcm), 'sampleRate': metadata['sampleRate'], 'channels': summary}))


if __name__ == '__main__':
    main()
