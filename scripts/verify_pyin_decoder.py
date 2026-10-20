"""Independent librosa Viterbi oracle using *identical* Lab emissions.

python scripts/verify_pyin_decoder.py --result artifacts/pitch-research/pyin-corrected.json
Requires the optional development dependencies librosa/numpy. No network.
"""
import argparse
import json
from pathlib import Path

import librosa
import numpy as np


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--result', required=True, type=Path)
    args = parser.parse_args()
    result = json.loads(args.result.read_text(encoding='utf-8'))
    config, frames = result['config'], result['frames']
    per_semitone = int(np.ceil(1 / config['resolution']))
    bins = int(np.floor(12 * per_semitone * np.log2(config['fmax'] / config['fmin']))) + 1
    observations = np.zeros((2 * bins, len(frames)))
    for index, frame in enumerate(frames):
        passed = frame['voicedProbability'] >= config.get('minVoicedProbability', 0)
        if passed:
            for candidate in frame['candidates']:
                pitch_bin = int(np.clip(np.round(12 * per_semitone * np.log2(candidate['hz'] / config['fmin'])), 0, bins - 1))
                observations[pitch_bin, index] += candidate['probability']
        observations[bins:, index] = (1 - (frame['voicedProbability'] if passed else 0)) / bins
    width = round(config['maxTransitionRate'] * 12 * config['hopLength'] / result['analysisSampleRate']) * per_semitone + 1
    transition = librosa.sequence.transition_local(bins, min(bins, width), window='triangle', wrap=False)
    transition = np.kron(librosa.sequence.transition_loop(2, 1 - config['switchProb']), transition)
    states = librosa.sequence.viterbi(observations, transition, p_init=np.ones(2 * bins) / (2 * bins))
    actual = np.array([f['trackedHz'] is not None for f in frames])
    expected = states < bins
    mismatches = int(np.sum(actual != expected))
    bin_mismatches = 0
    for i in np.flatnonzero(actual & expected):
        actual_bin = int(np.round(12 * per_semitone * np.log2(frames[i]['trackedHz'] / config['fmin'])))
        bin_mismatches += int(actual_bin != states[i])
    print(json.dumps({'frames': len(frames), 'voicingMismatches': mismatches,
                      'pitchBinMismatches': bin_mismatches, 'librosa': librosa.__version__}, indent=2))
    if mismatches or bin_mismatches:
        raise SystemExit('Decoder differs from independent Viterbi oracle')


if __name__ == '__main__':
    main()
