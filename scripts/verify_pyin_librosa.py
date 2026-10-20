"""Optional development oracle: compare browser pYIN against librosa.pyin.

This script is not part of the deployed application. It requires librosa 0.11
and executes the deterministic browser probe with Node.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_RATE = 16_000
FRAME_LENGTH = 2048
HOP_LENGTH = 512


def synth(duration: float, frequency_at, harmonics=(1.0,)) -> np.ndarray:
    count = round(duration * SAMPLE_RATE)
    output = np.zeros(count, dtype=np.float32)
    phases = np.zeros(len(harmonics), dtype=np.float64)
    normalizer = sum(abs(value) for value in harmonics) or 1
    for index in range(count):
        hz = frequency_at(index / SAMPLE_RATE)
        sample = 0.0
        for harmonic, gain in enumerate(harmonics):
            phases[harmonic] += 2 * np.pi * hz * (harmonic + 1) / SAMPLE_RATE
            sample += gain * np.sin(phases[harmonic])
        output[index] = 0.2 * sample / normalizer
    return output


def cents(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    return 1200 * np.log2(left / right)


def main() -> int:
    fixtures = {
        "steady220": synth(1.6, lambda _time: 220),
        "vibrato": synth(1.8, lambda time: 220 * 2 ** (45 * np.sin(2 * np.pi * 5 * time) / 1200)),
        "octave": synth(1.8, lambda time: 220 if time < 0.9 else 440),
        "weakFundamental": synth(1.6, lambda _time: 220, (0.12, 1, 0.7, 0.35)),
    }
    browser = json.loads(subprocess.run(
        ["node", str(ROOT / "scripts" / "pyin_browser_probe.js")],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout)
    failures = []
    report = {}
    for name, audio in fixtures.items():
        oracle_f0, oracle_voiced, oracle_probability = librosa.pyin(
            audio, sr=SAMPLE_RATE, fmin=70, fmax=1000, frame_length=FRAME_LENGTH,
            hop_length=HOP_LENGTH, n_thresholds=100, beta_parameters=(2, 18),
            boltzmann_parameter=2, resolution=0.1, max_transition_rate=35.92,
            switch_prob=0.01, no_trough_prob=0.01, center=False,
        )
        browser_f0 = np.array([np.nan if value is None else value for value in browser[name]["f0"]], dtype=float)
        count = min(len(oracle_f0), len(browser_f0))
        oracle_f0, oracle_voiced, browser_f0 = oracle_f0[:count], oracle_voiced[:count], browser_f0[:count]
        browser_voiced = np.isfinite(browser_f0)
        both = oracle_voiced & browser_voiced & np.isfinite(oracle_f0)
        median_cents = float(np.median(np.abs(cents(browser_f0[both], oracle_f0[both])))) if np.any(both) else float("inf")
        voicing_agreement = float(np.mean(browser_voiced == oracle_voiced))
        report[name] = {"frames": count, "median_f0_difference_cents": median_cents,
                        "voicing_agreement": voicing_agreement}
        if median_cents > 35 or voicing_agreement < 0.75:
            failures.append(name)
    print(json.dumps({"librosa": librosa.__version__,
                      "browser_algorithm": browser["_meta"]["algorithmVersion"],
                      "fixtures": report}, indent=2))
    if failures:
        raise SystemExit("Oracle tolerance exceeded: " + ", ".join(failures))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
