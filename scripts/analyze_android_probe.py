"""Replay a two-noise Android calibration, with an optional offline delay ablation.

--clipping-sensitivity bypasses the clipping veto ONLY in an isolated Node VM
and retains a rejected impulse for research. It never edits/deploys the core.
The observation/update/evaluation windows are development choices, not blind
validation. No singing labels or pitch corrections are inferred from this test.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from scipy import signal

from probe_echo_path_drift import switched_prediction
from probe_santo_alignment import shift_prediction

ROOT = Path(__file__).resolve().parents[1]
FIT = r"""
const fs=require('fs'),vm=require('vm'),path=require('path');
const sourcePath=process.argv[1],folder=process.argv[2],sensitivity=process.argv[3]==='true';
const read=name=>{const b=fs.readFileSync(path.join(folder,name+'.f32'));
  return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const reference=read('reference'),microphone=read('microphone');
const sampleRate=reference.length/10,core=require(sourcePath);
const {impulse:productionImpulse,...production}=core.fit(reference,microphone,sampleRate,true);
let impulse=productionImpulse,experiment=null;
if(sensitivity){
  let source=fs.readFileSync(sourcePath,'utf8');
  const veto="if (microphone.some(v => Math.abs(v) >= .98)) return fail('clipping');";
  const result="impulse: usable ? impulse : null";
  if(!source.includes(veto)||!source.includes(result))throw Error('Core changed; review sensitivity experiment');
  source=source.replace(veto,'/* Offline sensitivity experiment only */').replace(result,'impulse');
  const box={module:{exports:{}},Float32Array,Float64Array,Math,Number};
  vm.runInNewContext(source,box);
  const fit=box.module.exports.fit(reference,microphone,sampleRate,true);
  impulse=fit.impulse;const {impulse:ignored,...metadata}=fit;experiment=metadata;
}
if(impulse)fs.writeFileSync(path.join(folder,'impulse.f32'),Buffer.from(impulse.buffer));
console.log(JSON.stringify({production,experiment,hasImpulse:Boolean(impulse)}));
"""


def reduction(microphone, prediction):
    energy = np.sum(microphone**2)
    error = np.sum((microphone-prediction)**2)
    return float(10*np.log10(energy/error))


def lag_frames(prediction, microphone, sample_rate, window):
    start, end = (round(t*sample_rate) for t in window)
    x, y = prediction[start:end], microphone[start:end]
    if not len(x) or not np.any(x):
        raise ValueError('No prediction energy in the observation window')
    correlation = signal.correlate(y, x, mode='full', method='fft')
    lags = signal.correlation_lags(len(y), len(x))
    selected = np.abs(lags) <= round(.03*sample_rate)
    return int(lags[selected][np.argmax(np.abs(correlation[selected]))])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture', type=Path)
    parser.add_argument('--clipping-sensitivity', action='store_true')
    parser.add_argument('--observation', nargs=2, type=float, default=[7.75, 8.05])
    parser.add_argument('--update-at', type=float, default=8.2)
    parser.add_argument('--evaluation', nargs=2, type=float, default=[8.3, 10.])
    parser.add_argument('--plot', action='store_true')
    args = parser.parse_args()
    if not (7 <= args.observation[0] < args.observation[1] <= args.update_at
            and args.update_at+.015 <= args.evaluation[0] < args.evaluation[1] <= 10):
        parser.error('Observation, update and evaluation must be disjoint and ordered within the holdout')
    data = np.load(args.capture, allow_pickle=False)
    sample_rate = int(data['sample_rate'])
    microphone, reference = (np.asarray(data[name], dtype=np.float64) for name in ('microphone', 'reference'))
    if any(a.ndim != 1 or len(a) != 10*sample_rate or not np.all(np.isfinite(a)) for a in (microphone, reference)):
        parser.error('Expected two finite synchronized ten-second channels')
    core = ROOT / 'frontend/echo_cancellation.js'
    with tempfile.TemporaryDirectory(prefix='android-echo-replay-') as temporary:
        folder = Path(temporary)
        for name, values in [('microphone', microphone), ('reference', reference)]:
            values.astype('<f4').tofile(folder / (name+'.f32'))
        result = json.loads(subprocess.run(['node', '-e', FIT, str(core), str(folder), str(args.clipping_sensitivity).lower()],
                                         check=True, capture_output=True, text=True, timeout=30).stdout)
        impulse = np.fromfile(folder / 'impulse.f32', dtype='<f4') if result['hasImpulse'] else None
    report = {'developmentExperiment': True, 'windowsChosenAfterExploration': True,
              'captureSha256': hashlib.sha256(args.capture.read_bytes()).hexdigest(),
              'coreSha256': hashlib.sha256(core.read_bytes()).hexdigest(),
              'sampleRate': sample_rate, 'peak': float(np.max(np.abs(microphone))),
              'samplesAtOrAbove098': int(np.sum(np.abs(microphone)>=.98)),
              'clippingVetoBypassed': args.clipping_sensitivity, **result}
    if impulse is not None:
        prediction = signal.fftconvolve(reference, impulse)[:len(reference)]
        lag = lag_frames(prediction, microphone, sample_rate, args.observation)
        adjusted = switched_prediction(prediction, shift_prediction(prediction, lag), sample_rate, args.update_at)
        start, end = (round(t*sample_rate) for t in args.evaluation)
        report['delayAblation'] = {'observation': args.observation, 'updateAt': args.update_at,
            'fadeSec': .015, 'evaluation': args.evaluation, 'deltaFrames': lag, 'deltaMs': lag/sample_rate*1000,
            'frozenDb': reduction(microphone[start:end], prediction[start:end]),
            'delayOnlyDb': reduction(microphone[start:end], adjusted[start:end]),
            'fullHoldoutFrozenDb': reduction(microphone[7*sample_rate:], prediction[7*sample_rate:]),
            'fullHoldoutDelayOnlyDb': reduction(microphone[7*sample_rate:], adjusted[7*sample_rate:])}
        if args.plot:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
            figure, axes = plt.subplots(2, 1, figsize=(11, 7), layout='constrained')
            ends = np.arange(7.4, 9.01, .05)
            delays = [lag_frames(prediction, microphone, sample_rate, [end-.2, end])/sample_rate*1000 for end in ends]
            axes[0].step(ends, delays, where='post', color='#117f99')
            axes[0].set(ylabel='Ritardo aggiuntivo (ms)', title='Stima offline su finestre di 200 ms')
            hop = round(sample_rate*.01)
            for values, label, color in [(microphone, 'Ingresso', '#117f99'), (microphone-prediction, 'Residuo filtro fisso', '#b37a18'), (microphone-adjusted, 'Residuo dopo riallineamento', '#287b36')]:
                rms = np.sqrt(np.mean(values[:len(values)//hop*hop].reshape(-1, hop)**2, axis=1))
                axes[1].plot((np.arange(len(rms))+.5)*hop/sample_rate, 20*np.log10(np.maximum(rms, 1e-7)), label=label, color=color, lw=1)
            axes[1].set(ylabel='RMS (dBFS)', xlabel='Tempo (s)', ylim=(-90, 0));axes[1].legend(loc='lower left')
            for axis in axes:
                axis.set_xlim(7, 10);axis.grid(alpha=.2)
                axis.axvspan(*args.observation, color='#777777', alpha=.12)
                axis.axvline(args.update_at, color='black', ls='--', lw=.8)
                axis.axvspan(*args.evaluation, color='green', alpha=.05)
            figure.suptitle('S25+: replay del ritardo, stesso audio e stesso filtro\nEsperimento offline; nessuna voce registrata; eventuale veto picchi escluso solo per ricerca')
            figure.savefig(args.capture.parent / 'analysis-delay.png', dpi=150)
            plt.close(figure)
    (args.capture.parent / 'analysis.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
