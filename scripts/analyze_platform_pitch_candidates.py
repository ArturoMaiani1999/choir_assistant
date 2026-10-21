"""Offline candidate diagnosis on a frozen admission mask, without score data.

Uses existing YIN candidates and offline Viterbi, not pYIN. Decodes each
contiguous admitted region across the whole recording; guide labels do not
enter candidate selection. A missing decoded candidate falls back to raw F0.
This is an investigation, not an accuracy benchmark or a live implementation.
"""
import argparse
import json
from pathlib import Path
import subprocess

NODE=r"""
const fs=require('node:fs');global.window={};require(process.argv[1]);
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const b=fs.readFileSync(input.pcm),pcm=new Float32Array(b.buffer,b.byteOffset,b.length/4);
const settings={rmsThreshold:.002,yinThreshold:.18};const rows=[];
for(let at=Math.round(.5*input.rate);at+2048<=pcm.length-.5*input.rate;at+=1024){
 const x=pcm.subarray(at,at+2048),raw=window.ChoirPitch.detectPitch(x,input.rate,settings);
 rows.push({time:at/input.rate,rawHz:raw.hz||null,rawConfidence:raw.confidence,
   candidates:raw.hz?window.ChoirPitch.yinCandidates(x,input.rate).candidates:[],
   decodedHz:raw.hz||null});
}
let start=0;
while(start<rows.length){
 if(!rows[start].rawHz){start++;continue}
 let end=start+1;while(end<rows.length&&rows[end].rawHz)end++;
 const path=window.ChoirPitch.decodeYinCandidatePath(rows.slice(start,end));
 for(let i=start;i<end;i++){rows[i].decodedHz=path[i-start].hz||rows[i].rawHz;rows[i].fallback=!path[i-start].hz;}
 start=end;
}
process.stdout.write(JSON.stringify({settings,rows}));
"""

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('capture',type=Path);args=parser.parse_args()
    root=args.capture;metadata=json.loads((root/'result.json').read_text());results=[]
    for index,c in enumerate(metadata['conditions']):
        name=f'{index+1}-{c["mode"]}';params=root/(name+'-detector-input.json')
        if not params.exists():raise RuntimeError('Run analyze_platform_voice.py first')
        detector=Path(__file__).resolve().parents[1]/'frontend/pitch_detector.js'
        analyzed=json.loads(subprocess.run(['node','-e',NODE,str(detector),str(params)],check=True,capture_output=True,text=True).stdout)
        rows=analyzed['rows'];raw=sum(bool(r['rawHz']) for r in rows);decoded=sum(bool(r['decodedHz']) for r in rows)
        assert all(bool(r['rawHz'])==bool(r['decodedHz']) for r in rows)
        import math
        changes=[{'time':r['time'],'rawHz':r['rawHz'],'decodedHz':r['decodedHz'],
            'changeCents':1200*math.log2(r['decodedHz']/r['rawHz'])} for r in rows if r['rawHz'] and abs(1200*math.log2(r['decodedHz']/r['rawHz']))>100]
        results.append({'mode':c['mode'],'rawAdmitted':raw,'decodedAdmitted':decoded,'admissionMaskChanges':0,
            'largePitchChanges':changes,'settings':analyzed['settings'],'rows':rows})
    report={'method':'existing offline YIN candidate Viterbi; frozen raw admission mask; no score targets',
        'conditions':results,'limits':'No simultaneous clean voice reference; changes are acoustic hypotheses, not proven accuracy. Offline path sees future frames and is not a causal live detector.'}
    (root/'pitch-candidate-analysis.json').write_text(json.dumps(report,indent=2))
    print(json.dumps([{k:v for k,v in r.items() if k!='rows'} for r in results],indent=2))

if __name__=='__main__':main()
