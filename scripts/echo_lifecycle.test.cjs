const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../frontend/echo_cancellation.js');

function fixture({workerReady=true}={}){
  const elements=new Map(), workers=[], worklets=[],params=[],contextListeners=new Set();
  let now=1000,user='member-a';
  const element=id=>{if(!elements.has(id))elements.set(id,{checked:true,dataset:{},addEventListener(){},setAttribute(){}});return elements.get(id);};
  const node=()=>({connect(){},disconnect(){}});
  const context={currentTime:1,sampleRate:48000,state:'running',audioWorklet:{addModule:async()=>{}},
    addEventListener(type,listener){if(type==='statechange')contextListeners.add(listener);},
    removeEventListener(type,listener){if(type==='statechange')contextListeners.delete(listener);},
    createMediaStreamSource:node,createConvolver:node,createGain(){const n=node();n.gain={value:1,cancelled:[],targets:[],
      cancelScheduledValues(t){this.cancelled.push(t);this.targets=[];},setValueAtTime(v){this.value=v;},setTargetAtTime(v,t,tau){this.targets.push({v,t,tau});}};params.push(n.gain);return n;},
    createAnalyser:()=>({...node(),getFloatTimeDomainData:a=>a.fill(0)}),
    createMediaStreamDestination:()=>({...node(),stream:{getTracks:()=>[{stop(){}}]}}),
    createBuffer:(_,length)=>({length,copyToChannel(){}}),createBufferSource:()=>({...node(),start(){},stop(){}})};
  const stream={getAudioTracks:()=>[{readyState:'live',getSettings:()=>({deviceId:'private-device-id',sampleRate:48000,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false})}]};
  const mixer={context,referenceOutput:node(),setReferenceOutput:async()=>{},resume:async()=>{}};
  const sandbox={window:{ChoirEchoCancellation:Core,ChoirEchoDelay:require('../frontend/echo_delay.js')},document:{getElementById:element,hidden:false},
    localStorage:{getItem:()=> 'true'},crypto:{randomUUID:()=>`session-${user}`},performance:{now:()=>now},Date:{now:()=>now},
    setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},Float32Array,
    Worker:class{constructor(){workers.push(this);}postMessage(data){if(data.mode==='ready'&&workerReady)queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));}terminate(){this.terminated=true;}},
    AudioWorkletNode:class{constructor(_,name){this.name=name;this.port={postMessage:data=>{if(name==='choir-echo-delay')queueMicrotask(()=>this.port.onmessage?.({data:{type:'delay-complete',id:data.id,frames:data.frames,renderFrame:48000}}));},close(){}};worklets.push(this);}connect(){}disconnect(){}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/echo_cancellation_ui.js'),'utf8'),sandbox);
  const ui=sandbox.window.ChoirEchoCancellationUI.create({userId:()=>user,mixer:()=>mixer,stream:()=>stream,running:()=>false,volume:()=>.6});
  async function calibrate(){ui.prepare();await ui.attach(stream);const promise=ui.measure(()=>{});await new Promise(resolve=>setImmediate(resolve));
    worklets.findLast(w=>w.name==='choir-echo-capture').port.onmessage({data:{microphone:new Float32Array(10),reference:new Float32Array(10)}});
    workers.at(-1).onmessage({data:{usable:true,impulse:new Float32Array([.5]),validationDb:25,noiseRms:.001}});await promise;}
  return {ui,calibrate,context,params,workers,worklets,contextListeners,
    transition:state=>{context.state=state;for(const listener of contextListeners)listener();},advance:ms=>now+=ms,setUser:u=>user=u};
}

test('verified model is distinguishable from pass-through and invalidation cancels scheduled gain',async()=>{
  const f=fixture();await f.calibrate();assert.equal(f.ui.ready(),true);assert.equal(f.ui.diagnostics().appliedGain,1);
  const negative=f.params[1];negative.setTargetAtTime(-2,1,.015);
  f.ui.invalidate('piece-output-route');
  assert.equal(f.ui.ready(),false);assert.equal(f.ui.diagnostics().gain,0);
  assert.equal(f.ui.diagnostics().followerGain,1);assert.equal(negative.targets.length,0);
  assert.equal(f.ui.captureGraph().profile.calibrationVerified,false);
  assert.ok(f.ui.lifecycle().events.some(e=>e.reason==='model-applied'&&e.appliedGain===1));
  assert.ok(f.ui.lifecycle().events.some(e=>e.reason==='invalidate:piece-output-route'&&e.appliedGain===0));
});

test('TTL expiry disables subtraction and records cause while follower retains its own value',async()=>{
  const f=fixture();await f.calibrate();f.advance(Core.TTL+1);
  assert.equal(f.ui.ready(),false);assert.equal(f.ui.diagnostics().appliedGain,0);
  assert.ok(f.ui.lifecycle().events.some(e=>e.reason==='invalidate:profile-expired'));
});

test('journal is bounded, snapshot immutable, omits device identifiers and resets across accounts',async()=>{
  const f=fixture();await f.calibrate();const snapshot=f.ui.lifecycle();const oldCount=snapshot.events.length;
  for(let i=0;i<400;i++)f.ui.checkpoint('test');
  assert.ok(f.ui.lifecycle().events.length<=384);assert.ok(f.ui.lifecycle().droppedEvents>0);
  assert.equal(snapshot.events.length,oldCount);assert.ok(!JSON.stringify(snapshot).includes('private-device-id'));
  f.setUser('member-b');assert.equal(f.ui.ready(),false);
  const next=f.ui.lifecycle();assert.notEqual(next.sessionId,snapshot.sessionId);
  assert.ok(next.events.every(e=>e.reason!=='model-applied'));
});

test('monitoring chatter cannot evict the applied model and routing history',async()=>{
  const f=fixture();await f.calibrate();
  for(let i=0;i<1000;i++){f.ui.checkpoint('observation-reason');f.ui.checkpoint('status:waiting');}
  const events=f.ui.lifecycle().events;
  assert.ok(events.some(e=>e.reason==='model-applied'));
  assert.ok(events.some(e=>e.reason==='attach-complete'));
  assert.equal(events.filter(e=>e.reason==='observation-reason'||e.reason==='status:waiting').length,128);
  assert.ok(events.every((e,i)=>!i||e.sequence>events[i-1].sequence));
});

test('a failed capture module load can be retried on the same audio context',async()=>{
  const f=fixture();f.ui.prepare();await f.ui.attach({getAudioTracks:()=>[{readyState:'live',getSettings:()=>({deviceId:'private-device-id',sampleRate:48000,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false})}]});
  let attempts=0;
  f.context.audioWorklet.addModule=async()=>{attempts++;throw new Error('network unavailable');};
  await assert.rejects(f.ui.measure(()=>{}),/network unavailable/);
  await assert.rejects(f.ui.measure(()=>{}),/network unavailable/);
  assert.equal(attempts,2);
});

test('no acoustic capture starts before the worker is ready; cancellation prevents a late start',async()=>{
  const f=fixture({workerReady:false});f.ui.prepare();
  await f.ui.attach({getAudioTracks:()=>[{readyState:'live',getSettings:()=>({deviceId:'private-device-id',sampleRate:48000,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false})}]});
  const pending=f.ui.measure(()=>{});const rejected=assert.rejects(pending,/cancelled/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(!f.worklets.some(w=>w.name==='choir-echo-capture'));
  const loading=f.workers.at(-1);f.ui.cancel('cancelled');await rejected;
  loading.onmessage({data:{type:'ready'}});
  assert.ok(loading.terminated);assert.ok(!f.worklets.some(w=>w.name==='choir-echo-capture'));
});

test('unstable calibration retries once on the same graph and never applies a rejected model',async()=>{
  const f=fixture();await f.calibrate();f.ui.prepare();
  const graphId=f.ui.diagnostics().graphId;
  const pending=f.ui.measure(()=>{});
  const rejected=assert.rejects(pending,/ritardo audio continua/);
  const finish=async()=>{
    await new Promise(resolve=>setImmediate(resolve));
    f.worklets.findLast(w=>w.name==='choir-echo-capture').port.onmessage({data:{microphone:new Float32Array(10),reference:new Float32Array(10)}});
    f.workers.at(-1).onmessage({data:{usable:false,reason:'unstable-delay',stability:{unstable:true}}});
  };
  await finish();
  assert.equal(f.ui.diagnostics().appliedGain,0);
  await finish();await rejected;
  assert.equal(f.ui.diagnostics().graphId,graphId);
  assert.equal(f.ui.diagnostics().appliedGain,0);
  assert.equal(f.ui.isBusy(),false);
  assert.equal(f.ui.lifecycle().events.filter(e=>e.reason==='measurement-unstable-delay').length,2);
});

test('delay updates leave microphone gain and voicing gates active and record render acknowledgement',async()=>{
  const f=fixture();await f.calibrate();
  const worker=f.workers[0];
  const packet=endTime=>({data:{observation:null,delayObservation:{usable:true,deltaFrames:288},epoch:1,endTime,
    microphone:new Float32Array(8192),prediction:new Float32Array(8192)}});
  worker.onmessage(packet(.8));
  const correction=packet(.825);
  correction.data.observation={usable:true,gain:2};
  worker.onmessage(correction);
  assert.equal(f.ui.diagnostics().appliedGain,1);assert.ok(f.ui.detectionFloor()<Number.MAX_VALUE);
  assert.equal(f.ui.ready(),true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.ui.diagnostics().delayOffsetMs,6);
  assert.ok(f.ui.lifecycle().events.some(e=>e.reason==='delay-complete'&&e.renderFrame===48000));
});

test('stale timestamp telemetry preserves a verified model but forward render gaps disable it',async()=>{
  const f=fixture();await f.calibrate();const monitor=f.worklets.find(w=>w.name==='choir-echo-monitor');
  monitor.port.onmessage({data:{microphone:new Float32Array(8192),prediction:new Float32Array(8192),endTime:1,
    clock:{timebase:'processed-samples',skewCount:3,maxLagFrames:256,forwardGaps:0}}});
  assert.equal(f.ui.ready(),true);assert.equal(f.ui.diagnostics().appliedGain,1);
  assert.equal(f.ui.diagnostics().clock.skewCount,3);
  assert.ok(f.ui.lifecycle().events.some(e=>e.reason==='clock-skew'));
  monitor.port.onmessage({data:{type:'gap',expectedFrame:128,actualFrame:256}});
  assert.equal(f.ui.ready(),false);assert.equal(f.ui.diagnostics().appliedGain,0);
  assert.ok(f.ui.lifecycle().events.some(e=>e.reason==='invalidate:monitor-forward-gap'));
});

test('monitor startup reanchoring cannot cancel its independent acoustic capture',async()=>{
  const f=fixture();f.ui.prepare();await f.ui.attach({getAudioTracks:()=>[{readyState:'live',getSettings:()=>({deviceId:'private-device-id',sampleRate:48000,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false})}]});
  const pending=f.ui.measure(()=>{});await new Promise(resolve=>setImmediate(resolve));
  f.worklets.find(w=>w.name==='choir-echo-monitor').port.onmessage({data:{type:'gap',expectedFrame:0,actualFrame:128}});
  assert.equal(f.ui.isBusy(),true);assert.equal(f.ui.diagnostics().appliedGain,0);
  f.worklets.findLast(w=>w.name==='choir-echo-capture').port.onmessage({data:{microphone:new Float32Array(10),reference:new Float32Array(10)}});
  f.workers.at(-1).onmessage({data:{usable:true,impulse:new Float32Array([.5]),validationDb:25,noiseRms:.001}});
  await pending;assert.equal(f.ui.ready(),true);
});

test('suspension invalidates the room model and detach removes context listeners',async()=>{
  const f=fixture();await f.calibrate();assert.equal(f.contextListeners.size,1);
  f.transition('suspended');assert.equal(f.ui.ready(),false);assert.equal(f.ui.diagnostics().appliedGain,0);
  f.transition('running');assert.equal(f.ui.ready(),false,'Resume must not restore an old H');
  f.ui.detach();assert.equal(f.contextListeners.size,0);
});

test('context interruption cancels an acoustic capture before a resumed fit can be applied',async()=>{
  const f=fixture();f.ui.prepare();await f.ui.attach({getAudioTracks:()=>[{readyState:'live',getSettings:()=>({deviceId:'private-device-id',sampleRate:48000,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false})}]});
  const pending=f.ui.measure(()=>{});const rejected=assert.rejects(pending,/Ripeti il controllo/);
  await new Promise(resolve=>setImmediate(resolve));
  f.transition('suspended');await rejected;assert.equal(f.ui.isBusy(),false);
  assert.equal(f.ui.diagnostics().appliedGain,0);
});
