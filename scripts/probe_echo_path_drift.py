"""Offline reference-only delay ablation with disjoint, user-confirmed quiet intervals.

This is an acoustic experiment, not a streaming implementation or an F0 label.
The symmetric resampling and full-record convolution must not be called live DSP.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy import fft, linalg, signal

from analyze_echo_diagnostic import rms
from probe_santo_alignment import shift_prediction


def weighted_delay(reference, microphone, sample_rate, band=(700, 2000)):
    size = fft.next_fast_len(2 * len(reference))
    cross = fft.rfft(microphone, size) * np.conj(fft.rfft(reference, size))
    frequencies = fft.rfftfreq(size, 1 / sample_rate)
    selected = (frequencies >= band[0]) & (frequencies <= band[1])
    power = np.abs(cross)
    if not np.any(power[selected] > 0):
        raise ValueError('No reference energy in the selected delay band')
    denominator = np.maximum(power, np.quantile(power[selected], .25) * 10) ** .75
    correlation = fft.irfft(np.where(selected, cross / np.maximum(denominator, 1e-20), 0), size)
    start, end = round(.08 * sample_rate), round(.25 * sample_rate)
    at = start + int(np.argmax(np.abs(correlation[start:end])))
    return at


def fit_reference_path(reference, microphone, sample_rate, train=(2, 6)):
    """Fit a causal FIR using quiet training samples only. No later audio is read."""
    bulk = round(.14 * sample_rate)
    delayed = shift_prediction(reference, bulk)
    start, end = (round(t * sample_rate) for t in train)
    x, y = delayed[start:end], microphone[start:end]
    taps = round(.256 * sample_rate)
    if len(x) < taps or not np.any(x):
        raise ValueError('Training interval has insufficient reference data')
    xx = signal.correlate(x, x, method='fft')[len(x)-1:len(x)+taps-1]
    xy = signal.correlate(y, x, method='fft')[len(x)-1:len(x)+taps-1]
    xx[0] *= 1.002
    impulse = linalg.solve_toeplitz(xx, xy, check_finite=False)
    return impulse, bulk


def switched_prediction(frozen, shifted, sample_rate, update_at=10, fade_sec=.015):
    """Do not apply the adaptation before its observation interval has finished."""
    start = round(update_at * sample_rate)
    length = max(1, round(fade_sec * sample_rate))
    weight = np.clip((np.arange(len(frozen)) - start) / length, 0, 1)
    return frozen * (1-weight) + shifted * weight


def callback_offset(current, frames, sample_rate):
    energy = np.r_[0., np.cumsum(current * current)]
    selected = [f for f in frames if f.get('running') and 2 < f['contextTime'] < 59 and f.get('rms', 0) > 0]
    if not selected:
        raise ValueError('No recorded callback RMS observations')
    times = np.array([f['contextTime'] for f in selected])
    expected = np.array([f['rms'] for f in selected])
    candidates = []
    for offset in range(-256, 9601, 32):
        ends = np.round(times * sample_rate).astype(int) - offset
        valid = (ends >= 2048) & (ends < len(current))
        end = ends[valid]
        calculated = np.sqrt((energy[end]-energy[end-2048]) / 2048)
        error = float(np.median(np.abs(np.log(np.maximum(calculated, 1e-8) / expected[valid]))))
        candidates.append((error, offset))
    return sorted(candidates)[:8]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--quiet-intro-confirmed', action='store_true')
    args = parser.parse_args()
    if not args.quiet_intro_confirmed:
        parser.error('Requires confirmation that 2–16 seconds contain no singing')
    folder = args.folder
    manifest = json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
    metadata = manifest['metadata']
    sr = metadata['sampleRate']
    if sr % 16000:
        parser.error('This experiment requires an integer multiple of 16 kHz')
    raw = np.fromfile(folder/'microphone-raw.f32', dtype='<f4').astype(float)
    reference = np.fromfile(folder/'app-reference.f32', dtype='<f4').astype(float)
    current = np.fromfile(folder/'microphone-processed.f32', dtype='<f4').astype(float)
    if len(raw) != len(reference) or len(raw) != len(current) or len(raw) < 58*sr:
        parser.error('This preset requires a synchronized recording of at least 58 seconds')
    rate, factor = 16000, sr//16000
    x, y = (signal.resample_poly(v, 1, factor) for v in (reference, raw))
    impulse, bulk = fit_reference_path(x, y, rate)
    frozen = signal.fftconvolve(shift_prediction(x, bulk), impulse)[:len(x)]
    band_estimates = []
    for band in [(100, 700), (700, 2000), (2000, 6000)]:
        initial = weighted_delay(x[2*rate:6*rate], y[2*rate:6*rate], rate, band)
        later = weighted_delay(x[8*rate:10*rate], y[8*rate:10*rate], rate, band)
        band_estimates.append({'bandHz': band, 'initialMs': initial/rate*1000,
                               'laterMs': later/rate*1000, 'changeSamples': later-initial,
                               'changeMs': (later-initial)/rate*1000})
    # Band fixed before holdout inspection. Cross-band agreement is reported,
    # not used to optimize held-out residual or to claim a physical cause.
    delta = band_estimates[1]['changeSamples']
    aligned = shift_prediction(frozen, delta)
    adaptation = slice(8*rate, 10*rate)
    gain = float(np.dot(y[adaptation], aligned[adaptation]) / np.dot(aligned[adaptation], aligned[adaptation]))
    rows = []
    for name, a, b in [('train', 2, 6), ('adaptation', 8, 10), ('held-out-quiet', 10, 16), ('singing-no-F0-truth', 18, 42)]:
        interval = slice(a*rate, b*rate)
        row = {'name': name, 'interval': [a, b], 'rawRms': rms(y[interval])}
        for key, prediction in [('frozen', frozen), ('delayOnly', aligned), ('delayAndGain', gain*aligned)]:
            residual = rms(y[interval]-prediction[interval])
            row[key] = {'rms': residual, 'reductionDb': float(20*np.log10(row['rawRms']/residual))}
        rows.append(row)
    # Only predictions are resampled back: the original microphone/voice is
    # never low-pass filtered by this experiment.
    up = lambda v: signal.resample_poly(v, factor, 1)[:len(raw)]
    frozen_full, aligned_full = up(frozen), up(aligned)
    outputs = {'frozen': raw-frozen_full,
               'trackedDelay': raw-switched_prediction(frozen_full, aligned_full, sr),
               'trackedDelayGain': raw-switched_prediction(frozen_full, gain*aligned_full, sr)}
    output_metrics = []
    for a, b in [(10, 16), (18, 42), (44, 58)]:
        interval = slice(a*sr, b*sr)
        output_metrics.append({'interval': [a, b], 'rawRms': rms(raw[interval]),
            'variants': {key: {'rms': rms(values[interval]),
                'reductionDb': float(20*np.log10(rms(raw[interval])/rms(values[interval])))}
                for key, values in outputs.items()}})
    files = {}
    for key, values in outputs.items():
        filename = 'path-drift-'+key+'.f32'
        values.astype('<f4').tofile(folder/filename)
        files[key] = filename
    timings = callback_offset(current, metadata['pitchFrames'], sr)
    report = {'kind': 'offline-quiet-reference-delay-ablation', 'sourceSha256': manifest['sourceSha256'],
              'quietIntroductionConfirmed': True, 'train': [2, 6], 'adaptation': [8, 10], 'holdout': [10, 16],
              'analysisSampleRate': rate, 'sampleRate': sr, 'bulkDelayMs': bulk/rate*1000,
              'impulseTaps': len(impulse), 'ridgeFraction': .002, 'bandDelays': band_estimates,
              'delayChangeMs': delta/rate*1000, 'gain': gain, 'intervals': rows,
              'updateAvailableAtSec': 10, 'updateFadeMs': 15, 'channels': files,
              'fullRateOutputMetrics': output_metrics,
              'callbackBestRmsEndLagSamples': timings[0][1], 'callbackMedianLogRmsError': timings[0][0],
              'callbackTimingCandidates': timings,
              'limits': 'Offline symmetric resampling. No isolated voice F0 truth. No singing used to fit. '
                        'Residual energy is not voice quality. Switch only after quiet adaptation ends. '
                        'Fixed live voicing mask required for pitch replay. Not deployed.'}
    (folder/'path-drift-ablation.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
