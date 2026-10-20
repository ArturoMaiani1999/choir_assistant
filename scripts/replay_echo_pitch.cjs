// Fixed live mask, recorded detector parameters; no score target is an input to any detector.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
global.window={};require('../frontend/pitch_detector.js');const Pitch=window.ChoirPitch;
const root=process.argv[2],manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const drift=process.argv.includes('--path-drift');
const m=manifest.metadata,sr=m.sampleRate,alignment=JSON.parse(fs.readFileSync(path.join(root,drift?'path-drift-ablation.json':'alignment-ablation.json'),'utf8'));
const load=name=>{const b=fs.readFileSync(path.join(root,name+'.f32'));return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const proposals=drift?Object.fromEntries(Object.entries(alignment.channels).map(([key,file])=>[key,load(file.replace(/\.f32$/,''))])):
  {delayOnly:load('delay-only'),delayGain:load('delay-gain'),delayColor:load('delay-color')};
const channels={current:load('microphone-processed'),raw:load('microphone-raw'),...proposals};
const variants=['raw',...Object.keys(proposals)];
const N=2048,offset=alignment.callbackBestRmsEndLagSamples,rows=[];
for(const [index,f]of m.pitchFrames.entries()){
  const end=Math.round(f.contextTime*sr)-offset;
  if(end<N||end>=channels.current.length||!f.running)continue;
  const admitted=Number.isFinite(f.trackedHz)&&f.accepted;
  const row={index,t:f.contextTime,beat:f.beat,admitted,liveRawHz:f.rawHz,liveHz:f.trackedHz,settings:f.settings,originalRms:f.rms};
  const baseline=Pitch.detectPitch(channels.current.subarray(end-N,end),sr,f.settings);
  row.replayedCurrent=baseline.hz;row.replayedRms=baseline.rms;
  if(admitted){
    row.currentRawOnMask=baseline.hz||f.trackedHz;
    for(const key of variants){
      const estimate=Pitch.detectPitch(channels[key].subarray(end-N,end),sr,{...f.settings,rmsThreshold:0});
      // Proposal can only change F0 of an existing admission. Missing proposals retain the original.
      row[key]=estimate.hz||f.trackedHz;row[key+'Fallback']=!estimate.hz;row[key+'Clarity']=estimate.clarity;
    }
  }
  rows.push(row);
  if(index%750===0)console.error(JSON.stringify({frames:index,total:m.pitchFrames.length}));
}
const cents=(a,b)=>1200*Math.log2(a/b),percentile=(x,p)=>x.length?x.slice().sort((a,b)=>a-b)[Math.min(x.length-1,Math.floor(x.length*p))]:null;
for(const row of rows)for(const key of ['currentRawOnMask',...variants])
  assert.equal(Number.isFinite(row[key])&&row[key]>0,row.admitted,'A pitch-only proposal must preserve the exact live admitted mask');
const roundTrip=rows.filter(r=>r.liveRawHz&&r.replayedCurrent).map(r=>Math.abs(cents(r.liveRawHz,r.replayedCurrent)));
const sections=[];
for(const [name,a,b]of [['intro',2,16],['singing-18-42',18,42],['pause-candidate-42-44',42,44],['singing-44-58',44,58]]){
 const chosen=rows.filter(r=>r.t>=a&&r.t<b),accepted=chosen.filter(r=>r.admitted);
 sections.push({name,from:a,to:b,frames:chosen.length,admitted:accepted.length,unchangedAdmitted:true,
   variants:Object.fromEntries(variants.map(k=>[k,{fallbacks:accepted.filter(r=>r[k+'Fallback']).length,
     changedOver50c:accepted.filter(r=>Math.abs(cents(r[k],r.liveHz))>50).length,
     medianChangeCents:percentile(accepted.map(r=>cents(r[k],r.liveHz)),.5)}]))});
}
const report={kind:'real-recording-fixed-live-mask',sourceSha256:manifest.sourceSha256,sampleRate:sr,frameSize:N,
 detectorSourceSha256:crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../frontend/pitch_detector.js'),'utf8').replace(/\r\n/g,'\n')).digest('hex'),
 totalAdmittedFrames:rows.filter(r=>r.admitted).length,
 callbackEndLagSamples:offset,roundTrip:{frames:roundTrip.length,medianAbsoluteCents:percentile(roundTrip,.5),p95AbsoluteCents:percentile(roundTrip,.95),fractionWithin50c:roundTrip.filter(e=>e<=50).length/roundTrip.length},
 caveat:'Observed callback/PCM alignment is approximate. Corrected F0 is not independent vocal truth. Admitted mask is copied from live capture, never recomputed.',sections,rows};
fs.writeFileSync(path.join(root,drift?'path-drift-pitch-replay.json':'pitch-replay.json'),JSON.stringify(report)+'\n');console.log(JSON.stringify({roundTrip:report.roundTrip,sections}));
