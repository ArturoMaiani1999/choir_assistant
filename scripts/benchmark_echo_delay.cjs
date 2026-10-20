// Causal replay of the actual observer/follower/retimer. No score or F0 labels.
// Input folder: microphone.f32, reference.f32, impulse.f32 (or explicit
// --rejected-model for the exploratory sensitivity-impulse.f32).
const fs=require('node:fs'),path=require('node:path'),Core=require('../frontend/echo_cancellation.js'),D=require('../frontend/echo_delay.js');
function replay(reference,microphone,impulse,options={}) {
const forced=Boolean(options.forcedRejectedModel);
const sr=options.sampleRate||reference.length/10,prepared=D.prepare(impulse,sr),early=Float32Array.from(Core.convolve(reference,prepared.impulse.slice(prepared.baseFrames)));
const frozen=Float32Array.from(Core.convolve(reference,prepared.impulse)),tracked=new Float32Array(reference.length);
const retimer=new D.Retimer(Math.round(sr*.080),prepared.baseFrames),follower=new D.Follower(-prepared.baseFrames,Math.round(sr*D.MAX_SHIFT_SEC));
let offset=0,lastSent=0,resetAt=(options.startAt??7)*sr,pending=null,epoch=0;
const events=[],reasons={},processingMs=[];
const workerDelayFrames=Math.ceil(sr*(options.workerMs??10)/1000/128)*128; // explicit 10 ms + render-boundary command delay
for(let n=0;n<reference.length;n+=128){
  if(pending&&pending.at<=n){
    if(pending.epoch===epoch){
      const decision=follower.observe(pending.observation,pending.end/sr,offset);
      if(decision.changed){
        const fade=Math.round(sr*.015);retimer.setDelay(prepared.baseFrames+decision.offsetFrames,fade);
        events.push({at:n/sr,observationEnd:pending.end/sr,previousOffsetFrames:offset,offsetFrames:decision.offsetFrames,deltaMs:(decision.offsetFrames-offset)/sr*1000});
        offset=decision.offsetFrames;epoch++;resetAt=n+fade;follower.reset();
      }
    }
    pending=null;
  }
  const end=Math.min(reference.length,n+128);retimer.process(early.subarray(n,end),tracked.subarray(n,end));
  if(!pending&&end>=resetAt+D.WINDOW&&end-lastSent>=D.HOP){
    const started=performance.now();
    const observation=D.observation(tracked.slice(end-D.WINDOW,end),microphone.slice(end-D.WINDOW,end),sr,{noiseRms:options.noiseRms??.0005,validationDb:25});
    processingMs.push(performance.now()-started);reasons[observation.usable?'usable':observation.reason]=(reasons[observation.usable?'usable':observation.reason]||0)+1;
    pending={at:end+workerDelayFrames,end,epoch,observation};lastSent=end;
  }
}
const score=(prediction,a,b)=>Core.reduction(microphone.subarray(Math.round(a*sr),Math.round(b*sr)),prediction.subarray(Math.round(a*sr),Math.round(b*sr)));
processingMs.sort((a,b)=>a-b);
const report={kind:'causal-delay-replay',sampleRate:sr,forcedRejectedModel:forced,window:D.WINDOW,hop:D.HOP,
  workerDelayMs:workerDelayFrames/sr*1000,fadeMs:15,controllerStartsAt:options.startAt??7,
  retimeBaseFrames:prepared.baseFrames,removedImpulseEnergyFraction:prepared.removedEnergyFraction,
  events,reasons,processingMs:{median:processingMs[Math.floor(processingMs.length*.5)],p95:processingMs[Math.floor(processingMs.length*.95)]},
  regions:(options.regions||[[7,10],[8.3,10]]).map(([from,to])=>({from,to,frozenDb:score(frozen,from,to),trackedDb:score(tracked,from,to)})),
  caveat:'Development PCM. No voiced mask is changed or F0 truth inferred.'+(forced?' The high-level sensitivity model was rejected by production; this is not a valid calibration.':'')};
return {report,frozen,tracked};
}
module.exports={replay};
if(require.main===module){
  const args=process.argv.slice(2),root=path.resolve(args[0]||''),forced=args.includes('--rejected-model');
  if(!args[0])throw Error('Usage: node scripts/benchmark_echo_delay.cjs CAPTURE_FOLDER [--rejected-model]');
  const read=name=>{const b=fs.readFileSync(path.join(root,name));return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
  const microphone=read('microphone.f32'),reference=read('reference.f32'),impulse=read(forced?'sensitivity-impulse.f32':'impulse.f32');
  const {report,tracked}=replay(reference,microphone,impulse,{forcedRejectedModel:forced});
  fs.writeFileSync(path.join(root,'causal-delay-replay.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(root,'causal-delay-prediction.f32'),Buffer.from(tracked.buffer));
  console.log(JSON.stringify(report,null,2));
}
