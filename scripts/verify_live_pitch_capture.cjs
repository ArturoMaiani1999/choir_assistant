// Replay recorded PCM through both estimators on exactly the same frame grid.
// No score or ideal note labels enter the algorithm. Requires local artifacts.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
global.window={};require('../frontend/pitch_detector.js');
const directory=process.argv[2];if(!directory)throw Error('Pass a platform capture directory after voice analysis');
const input=JSON.parse(fs.readFileSync(path.join(directory,'1-browser-detector-input.json'),'utf8'));
const b=fs.readFileSync(input.pcm),pcm=new Float32Array(b.buffer,b.byteOffset,b.length/4),rows=[];
const settings=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')).settings:{rmsThreshold:.002,yinThreshold:.18};
const originalTracker=new window.ChoirPitch.PitchSmoother(settings),liveTracker=new window.ChoirPitch.HarmonicPitchSmoother(settings);
const start=performance.now();
for(let at=Math.round(.5*input.rate);at+2048<=pcm.length-.5*input.rate;at+=1024){
  const x=pcm.subarray(at,at+2048),raw=window.ChoirPitch.detectPitch(x,input.rate,settings),
    live=window.ChoirPitch.detectPitch(x,input.rate,{...settings,resolveHarmonics:true});
  assert.equal(Boolean(raw.hz),Boolean(live.hz));assert.equal(raw.clarity,live.clarity);assert.equal(raw.confidence,live.confidence);
  const a=originalTracker.update(raw,at/input.rate*1000),c=liveTracker.update(live,at/input.rate*1000);
  assert.equal(a.accepted,c.accepted);assert.equal(a.stable,c.stable);assert.equal(a.confidence,c.confidence);
  if(c.accepted)assert.ok(c.hz>0);
  rows.push({time:at/input.rate,rawHz:raw.hz,liveHz:live.hz,confidence:live.confidence,harmonicResolved:!!live.harmonicResolved,
    accepted:a.accepted,trackedLiveHz:c.accepted?c.hz:null});
}
const voice=rows.filter(r=>r.time>=input.window[0]+.5&&r.time+2048/input.rate<=input.window[1]-.5);
const report={method:'causal acoustic harmonic selection; no temporal state or lookahead',settings,
  windows:rows.length,rawAdmitted:rows.filter(r=>r.rawHz).length,liveAdmitted:rows.filter(r=>r.liveHz).length,
  admissionMaskChanges:0,confidenceChanges:0,trackerAdmissionMaskChanges:0,trackedAdmitted:rows.filter(r=>r.accepted).length,centralVoiceAdmitted:voice.filter(r=>r.liveHz).length,
  centralVoiceAbove400Before:voice.filter(r=>r.rawHz>400).length,centralVoiceAbove400After:voice.filter(r=>r.liveHz>400).length,
  resolved:rows.filter(r=>r.harmonicResolved).length,elapsedMs:performance.now()-start,rows,
  limits:'400 Hz is a descriptive statistic of these two takes, never an algorithm threshold or an independent ground truth. No clean simultaneous voice reference.'};
fs.writeFileSync(path.join(directory,process.argv[3]?'causal-live-actual-settings.json':'causal-live-analysis.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).filter(([k])=>k!=='rows')),null,2));
