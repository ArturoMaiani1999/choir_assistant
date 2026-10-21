"""Compare sequential captures, never calling cross-capture attenuation ERLE."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

REGIONS=[('quiet',.5,1.5),('noise_low',2,4.7),('noise_high',5,7.7),
         ('clicks_low',8,9.7),('clicks_high',10,12.5)]

def energy(x):return float(np.mean(np.asarray(x,dtype=float)**2)) if len(x) else None

def analyze(root):
    meta=json.loads((root/'result.json').read_text())
    results=[]
    for index,c in enumerate(meta['conditions']):
        filename=f'{index+1}-{c["mode"]}.npz'
        path=root/filename
        if not path.exists():continue
        with np.load(path) as d:
            y,x=d['captured'].astype(float),d['reference'].astype(float)
            sr=int(d['sample_rate'])
        assert len(x)==len(y)==c['frames']
        regions=[]
        for name,start,end in REGIONS:
            complete=len(y)>=round(end*sr)
            stop=min(len(y),round(end*sr));a=round(start*sr)
            if stop<=a:continue
            yy,xx=energy(y[a:stop]),energy(x[a:stop])
            regions.append({'name':name,'complete':complete,'capturedRms':yy**.5,
                'referenceRms':xx**.5,'energy':yy,'referenceEnergy':xx,
                'digitalSilence':bool(np.count_nonzero(y[a:stop])==0),
                'normalizedEnergy':yy/xx if xx>1e-14 else None})
        results.append({'index':index+1,'mode':c['mode'],'settings':c.get('settings'),
            'error':c.get('error'),'frames':len(y),'sampleRate':sr,'peak':float(np.max(np.abs(y))),
            'samplesAbove098':int(np.sum(np.abs(y)>=.98)),
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'regions':regions})
    comparisons=[]
    for c in results:
        if c['mode']=='raw':continue
        for r in c['regions']:
            baselines=[region['normalizedEnergy'] for b in results if b['mode']=='raw' and not b['error']
                for region in b['regions'] if region['name']==r['name'] and region['complete'] and region['normalizedEnergy'] is not None]
            if r['complete'] and r['normalizedEnergy'] is not None and baselines:
                silent=r['digitalSilence']
                values=[] if silent else [float(10*np.log10(max(v,1e-30)/max(r['normalizedEnergy'],1e-30))) for v in baselines]
                comparisons.append({'condition':c['index'],'mode':c['mode'],'region':r['name'],
                    'digitalSilence':silent,
                    'relativeAttenuationDb':None if silent else float(10*np.log10(np.mean(baselines)/max(r['normalizedEnergy'],1e-30))),
                    'versusEachRawDb':values})
    report={'kind':'sequential-platform-aec-comparison','build':meta['build'],'conditions':results,
        'comparisons':comparisons,'volume':json.loads((root/'volume.json').read_text()),
        'limits':'Sequential recordings, no simultaneous pre-AEC microphone. Differences include route and input processing effects; attenuation is not ERLE. No singing or voice-preservation claim.'}
    (root/'analysis.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'comparisons':comparisons,'volume':report['volume'],'conditions':[{k:v for k,v in c.items() if k!='regions'} for c in results]},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('capture',type=Path)
    analyze(parser.parse_args().capture)
