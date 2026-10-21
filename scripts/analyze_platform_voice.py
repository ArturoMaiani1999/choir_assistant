"""Score guided voice windows with fixed detector settings, not score labels."""
import argparse
import json
from pathlib import Path
import subprocess

import numpy as np

NODE = r"""
const fs=require('node:fs');global.window={};require(process.argv[1]);
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const b=fs.readFileSync(input.pcm),pcm=new Float32Array(b.buffer,b.byteOffset,b.length/4);
const settings={rmsThreshold:.002,yinThreshold:.18,minHz:65,maxHz:800};
const rows=[];
for(let at=Math.round(.5*input.rate);at+2048<=pcm.length-.5*input.rate;at+=1024){
 const x=pcm.subarray(at,at+2048),r=window.ChoirPitch.detectPitch(x,input.rate,settings);
 const t=at/input.rate,phase=t>=input.window[0]+.5&&t+2048/input.rate<=input.window[1]-.5?'voice':t+2048/input.rate<input.window[0]-.5||t>input.window[1]+.5?'quiet':'boundary';
 rows.push({time:t,phase,hz:r.hz||null,confidence:r.confidence||0,rms:Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length)});
}
process.stdout.write(JSON.stringify({settings,frames:rows}));
"""

def analyze(root):
    metadata=json.loads((root/'result.json').read_text());results=[]
    for index,c in enumerate(metadata['conditions']):
        name=f'{index+1}-{c["mode"]}';path=root/(name+'.npz')
        if not path.exists():continue
        with np.load(path) as d:y=d['captured'];ref=d['reference'];rate=int(d['sample_rate'])
        pcm=root/(name+'.f32');y.astype('<f4').tofile(pcm)
        voice_window=c.get('voiceWindow',[3,9])
        params=root/(name+'-detector-input.json');params.write_text(json.dumps({'pcm':str(pcm.resolve()),'rate':rate,'window':voice_window}))
        detector=Path(__file__).resolve().parents[1]/'frontend/pitch_detector.js'
        detected=json.loads(subprocess.run(['node','-e',NODE,str(detector),str(params)],check=True,capture_output=True,text=True).stdout)
        frames=[r for r in detected['frames'] if r['phase']=='voice'];voiced=[r['hz'] for r in frames if r['hz']]
        quiet=[r for r in detected['frames'] if r['phase']=='quiet']
        part=y[round((voice_window[0]+.5)*rate):min(len(y),round((voice_window[1]-.5)*rate))].astype(float)
        results.append({'mode':c['mode'],'kind':c.get('kind'),'error':c['error'],'frames':len(y),
            'voiceWindowComplete':len(y)>=round((voice_window[1]-.5)*rate),'voiceRms':float(np.sqrt(np.mean(part**2))) if len(part) else None,
            'voiceNonzeroSamples':int(np.count_nonzero(part)),
            'guidedFrames':len(frames),'admittedFrames':len(voiced),'admittedFraction':len(voiced)/len(frames) if frames else None,
            'quietFrames':len(quiet),'quietAdmittedFrames':sum(bool(r['hz']) for r in quiet),
            'medianHz':float(np.median(voiced)) if voiced else None,
            'referenceEnergy':float(np.mean(ref.astype(float)**2)),'settings':c.get('settings'),
            'detector':detected})
    music=any(c.get('kind')=='voice-music' for c in results)
    report={'kind':'guided-voice-with-music-platform-aec' if music else 'guided-voice-only-platform-aec','conditions':results,
        'limits':'Guided windows are approximate labels. Sequential human performances are not identical clean references; admission is not proof of correct F0 or preserved vocal timbre. A voiced result with backing can still be residual echo; inspect quiet intervals and compare against the known reference.'}
    (root/'voice-analysis.json').write_text(json.dumps(report,indent=2))
    print(json.dumps([{k:v for k,v in r.items() if k!='detector'} for r in results],indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('capture',type=Path)
    analyze(parser.parse_args().capture)
