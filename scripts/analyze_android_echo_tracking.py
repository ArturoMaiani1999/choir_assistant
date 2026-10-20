"""Score a frozen live confirmation, keeping onsets and rejected windows.

Regions are fixed by probe_android_echo_tracking.py: noise [1,4.9), clicks
[5,9.8). After-settling noise is reported separately, never substituted for
the full score. No re-alignment or fitting to these confirmation samples.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt


def energy(x):
    return float(np.mean(np.asarray(x, dtype=np.float64)**2))


def reduction(raw, processed):
    a, b = energy(raw), energy(processed)
    return float(10*np.log10(max(a, 1e-30)/max(b, 1e-30)))


def analyze(root):
    meta = json.loads((root/'result.json').read_text(encoding='utf-8'))
    with np.load(root/'live.npz') as data:
        sr = int(data['sample_rate'])
        raw, ref, prediction, processed = [data[k].astype(np.float64) for k in ('raw','reference','prediction','processed')]
    assert len({len(x) for x in (raw, ref, prediction, processed)}) == 1
    with np.load(root/'calibration.npz') as cal:
        impulse = cal['impulse'].astype(np.float64)
    fixed = raw-fftconvolve(ref, impulse)[:len(raw)]*meta['live']['profile']['gain']
    quiet = raw[:round(.8*sr)]
    threshold = max(energy(quiet)*4, 1e-14)  # +6 dB over pre-excitation noise
    regions = []
    for name, start, end in [('noise_full',1,4.9),('noise_settled',1.6,4),('metronome_full',5,9.8)]:
        sl = slice(round(start*sr), round(end*sr))
        windows = []
        for at in range(sl.start, sl.stop-round(.1*sr)+1, round(.1*sr)):
            window = slice(at,at+round(.1*sr))
            windows.append({'at': at/sr, 'active': energy(raw[window])>=threshold,
                            'reductionDb': reduction(raw[window],processed[window])})
        active = [w['reductionDb'] for w in windows if w['active']]
        bands = []
        for low,high in [(150,500),(500,1500),(1500,4000),(4000,8000)]:
            sos = butter(4,[low,high],btype='bandpass',fs=sr,output='sos')
            a,b = sosfilt(sos,raw),sosfilt(sos,processed)
            bands.append({'fromHz':low,'toHz':high,'reductionDb':reduction(a[sl],b[sl])})
        regions.append({'name':name,'start':start,'end':end,
                        'rawRms':energy(raw[sl])**.5,'processedRms':energy(processed[sl])**.5,
                        'reductionDb':reduction(raw[sl],processed[sl]),'fixedModelDb':reduction(raw[sl],fixed[sl]),
                        'activeWindows':len(active),'totalWindows':len(windows),
                        'activeMedianDb':float(np.median(active)) if active else None,
                        'activeP10Db':float(np.quantile(active,.1)) if active else None,
                        'windows':windows,'bands':bands})
    rtt = [r['ms'] for r in meta['workerRtt']]
    result = {'kind':'fresh-device-live-confirmation','build':meta['build'],'sampleRate':sr,'frames':len(raw),
              'volume':json.loads((root/'volume.json').read_text(encoding='utf-8')),
              'calibration':meta['guide']['results'],'quietRms':energy(quiet)**.5,
              'peak':float(np.max(np.abs(raw))),'samplesAbove098':int(np.sum(np.abs(raw)>=.98)),
              'regions':regions,'workerRoundTripMs':{'count':len(rtt),'median':float(np.median(rtt)),
                'p95':float(np.quantile(rtt,.95)),'maximum':max(rtt),'above350ms':sum(t>350 for t in rtt)},
              'delayEvents':[e for e in meta['lifecycle']['events'] if e['reason'] in ('delay-command','delay-complete','monitor-gap','monitor-failed')],
              'hashes':{n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ('live.npz','calibration.npz','result.json')},
              'limits':'Quiet device confirmation at one fixed volume and position. No singing, no F0 accuracy claim, no proof at other volumes. Fixed-model score is an offline counterfactual; actual treatment is the processed channel.'}
    (root/'analysis.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({**result,'regions':[{k:v for k,v in r.items() if k not in ('windows','bands')} for r in regions]},indent=2))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture',type=Path)
    analyze(parser.parse_args().capture)
