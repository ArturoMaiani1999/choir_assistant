// node scripts/benchmark_santo_echo.cjs fixture-folder report.json
// Actual webapp MP3 mix + synthetic voice; no claims about the user's F0.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
global.window={};require('../frontend/pitch_detector.js');
const Pitch=window.ChoirPitch,Shared=require('../frontend/pitch_shared.js'),Echo=require('../frontend/echo_cancellation.js');
const {probe}=require('./reference_pitch_probe.cjs');
const root=path.resolve(process.argv[2]),out=process.argv[3];
const load=name=>{const b=fs.readFileSync(path.join(root,name+'.f32'));return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const metadata=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const music=load('music'),click=load('metronome'),voice=load('voice'),truth=load('truth'),wrongVoice=load('wrong-voice'),wrongTruth=load('wrong-truth');
const sr=metadata.sampleRate,n=music.length,hop=1600,N=2048;
const settings=Shared.recognitionSettings(),configs=[
  {id:'clean',gain:0},{id:'matched-path',gain:1},{id:'gain-x2',gain:2},{id:'gain-x6',gain:6},
  {id:'delay-32',gain:1,shift:32},{id:'delay-128',gain:1,shift:128},{id:'nonlinear',gain:2,limit:.04},
  {id:'click-only-gain-x4',gain:4,clickOnly:true},{id:'wrong-singer-gain-x2',gain:2,wrong:true},
];
function room(input,gain=1,shift=0,limit=null){
  const y=new Float32Array(n);
  for(const [delay,g] of [[1680,.55],[1800,-.08],[3880,.1]])for(let i=delay+shift;i<n;i++){
    const value=input[i-delay-shift];y[i]+=gain*g*(limit?limit*Math.tanh(value/limit):value);
  }
  return y;
}
function percentile(values,p){if(!values.length)return null;const v=values.slice().sort((a,b)=>a-b);return v[Math.min(v.length-1,Math.floor(v.length*p))];}
function metrics(rows,key){
  const labels=rows.filter(r=>r.truthKnown),voiced=labels.filter(r=>r.truth>0),unvoiced=labels.filter(r=>!r.truth);
  const detected=voiced.filter(r=>r[key]>0),errors=detected.map(r=>Math.abs(1200*Math.log2(r[key]/r.truth)));
  const fp=unvoiced.filter(r=>r[key]>0).length,fn=voiced.length-detected.length;
  return {labelledFrames:labels.length,voiceFrames:voiced.length,silenceFrames:unvoiced.length,tp:detected.length,fn,fp,
    recall:voiced.length?detected.length/voiced.length:null,specificity:unvoiced.length?1-fp/unvoiced.length:null,
    rpa50:voiced.length?errors.filter(e=>e<=50).length/voiced.length:null,
    medianAbsCents:percentile(errors,.5),p95AbsCents:percentile(errors,.95),grossPitchError100:errors.length?errors.filter(e=>e>100).length/errors.length:null};
}
const results=[];
for(const config of configs){
  const reference=Float32Array.from(music,(v,i)=>(config.clickOnly?0:v)+click[i]);
  const prediction=room(reference),echo=room(reference,config.gain,config.shift||0,config.limit);
  const v=config.wrong?wrongVoice:voice,t=config.wrong?wrongTruth:truth;
  const cleaned=Float32Array.from(v,(x,i)=>x+echo[i]-(config.gain?prediction[i]:0));
  const tracker=new Pitch.PitchSmoother(Shared.DETECTOR_DEFAULTS);tracker.configure(settings);
  const rows=[];
  for(let end=N;end<=n;end+=hop){
    const frame=cleaned.subarray(end-N,end),raw=Pitch.detectPitch(frame,sr,settings),tracked=tracker.update(raw,end/sr*1000);
    const admitted=tracked.accepted&&tracked.stable&&tracked.hz>0;
    const referenceFrame=prediction.subarray(end-N,end),proposal=admitted?probe(frame,referenceFrame,sr,raw,settings):null;
    const baseline=admitted?tracked.hz:null;
    const projected=admitted?(proposal?.hz||baseline):null;
    const gated=admitted&&proposal?.reason==='reference-projection'&&proposal.clarity>=raw.clarity+.03?proposal.hz:baseline;
    const center=end-N/2,low=Math.max(0,Math.floor(center-.04*sr)),high=Math.min(n-1,Math.ceil(center+.04*sr));
    // Keep mixed onset/release windows unknown; never relabel them as silence.
    const truthKnown=Boolean(t[low])===Boolean(t[high])&&Boolean(t[center])===Boolean(t[low])
      &&(!t[center]||Math.abs(1200*Math.log2(t[low]/t[high]))<60);
    const rawOnSameMask=admitted?raw.hz:null;
    const row={time:center/sr,truth:t[center],truthKnown,baseline,rawOnSameMask,projected,gated};
    assert.equal(Boolean(baseline),Boolean(projected));assert.equal(Boolean(baseline),Boolean(gated));rows.push(row);
  }
  const accepted=rows.filter(r=>r.baseline),helped=rows.filter(r=>r.truthKnown&&r.truth&&r.baseline&&r.projected&&Math.abs(1200*Math.log2(r.projected/r.truth))<Math.abs(1200*Math.log2(r.baseline/r.truth))-25).length;
  const harmed=rows.filter(r=>r.truthKnown&&r.truth&&r.baseline&&r.projected&&Math.abs(1200*Math.log2(r.projected/r.truth))>Math.abs(1200*Math.log2(r.baseline/r.truth))+25).length;
  results.push({config,baseline:metrics(rows,'baseline'),rawOnSameMask:metrics(rows,'rawOnSameMask'),projected:metrics(rows,'projected'),qualityGated:metrics(rows,'gated'),
    fixedMask:{identical:true,acceptedFrames:accepted.length,helpedOver25c:helped,harmedOver25c:harmed},
    examples:rows.filter(r=>r.time>=27&&r.time<32||r.time>=56&&r.time<60).filter((_,i)=>i%3===0)});
  console.error(JSON.stringify({case:config.id,baseline:results.at(-1).baseline,projected:results.at(-1).projected}));
}
const report={schemaVersion:1,kind:metadata.kind,metadata,frameSize:N,hop,sampleRate:sr,
  experiment:'Fixed original admitted mask. Linear reference/derivative projection is only a pitch hypothesis, never output audio.',
  selection:'Predefined diagnostic ablation; no tuning, winner, live adoption or real-user F0 accuracy claim.',results};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:out,cases:results.length}));
