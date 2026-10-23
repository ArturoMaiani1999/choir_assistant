const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../frontend/echo_cancellation.js');
function fixture(probeLoader=async()=>[{duration:2},{duration:2}],nativeMode=true){
  const elements=new Map(),nodes=[],listeners=new Set();let user='singer-a',now=1000;
  const el=id=>{if(!elements.has(id))elements.set(id,{checked:true,dataset:{},handlers:{},addEventListener(t,f){this.handlers[t]=f;},setAttribute(){}});return elements.get(id);};
  const node=()=>({connect(){},disconnect(){}});
  const context={sampleRate:8000,currentTime:1,state:'running',audioWorklet:{addModule:async()=>{}},
    createMediaStreamSource:node,createGain:()=>({...node(),gain:{value:0}}),
    createBuffer:(_,length)=>({length,copyToChannel(){}}),createBufferSource:()=>({...node(),start(){},stop(){}}),
    createConvolver(){throw Error('Native AEC must never create a custom convolver');},
    addEventListener(t,f){listeners.add(f);},removeEventListener(t,f){listeners.delete(f);}};
  const config={echoCancellation:nativeMode==='all'?'all':true,noiseSuppression:false,autoGainControl:false};
  const track={readyState:'live',getSettings:()=>({...config})},stream={getAudioTracks:()=>[track]};
  const mixer={context,referenceOutput:node(),resume:async()=>{},setReferenceOutput:async()=>{}};
  const sandbox={window:{ChoirEchoCancellation:Core,ChoirCalibrationProbe:{id:'test-music',load:probeLoader}},document:{getElementById:el,hidden:false},localStorage:{getItem:()=> 'true'},
    crypto:{randomUUID:()=> 'native-session'},Date:{now:()=>now},Float32Array,setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout,
    AudioWorkletNode:class{constructor(){this.port={close(){}};nodes.push(this);}connect(){}disconnect(){}},
    Worker:class{constructor(){throw Error('Native AEC must not start a custom filter worker');}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/echo_cancellation_ui.js'),'utf8'),sandbox);
  const ui=sandbox.window.ChoirEchoCancellationUI.create({nativeAEC:true,nativeMode,userId:()=>user,mixer:()=>mixer,volume:()=>.62,running:()=>false});
  const begin=async()=>{ui.prepare();await ui.attach(stream);const p=ui.measure(()=>{});await new Promise(r=>setImmediate(r));return {p,node:nodes.at(-1)};};
  const packet=(value=.0001)=>({microphone:new Float32Array(64000).fill(value),reference:new Float32Array(64000).fill(.02)});
  return {ui,context,stream,config,listeners,nodes,begin,packet,setUser:u=>user=u,advance:ms=>now+=ms};
}

test('probe preparation failure starts no acoustic capture and allows retry',async()=>{
  let failing=true;const f=fixture(async()=>{if(failing)throw Error('Unavailable music');return [{duration:2},{duration:2}];});
  f.ui.prepare();await f.ui.attach(f.stream);await assert.rejects(f.ui.measure(()=>{}));
  assert.equal(f.nodes.length,0);assert.equal(f.ui.isBusy(),false);assert.equal(f.ui.ready(),false);
  failing=false;const {p,node}=await f.begin();node.port.onmessage({data:f.packet()});await p;assert.equal(f.ui.ready(),true);
});

function musicalPcm(bar){
  const wav=fs.readFileSync(require('node:path').join(__dirname,`../frontend/audio-calibration/bach-bwv846-${bar}.wav`));
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',36,40),'data');
  assert.equal(wav.readUInt32LE(24),48000);assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt16LE(34),16);
  const pcm=Float32Array.from({length:(wav.length-44)/2},(_,i)=>wav.readInt16LE(44+i*2)/32768);
  assert.equal(pcm.length,96000);assert.ok(Math.abs(Math.sqrt(pcm.reduce((s,v)=>s+v*v,0)/pcm.length)-.08/Math.sqrt(3))<.00001);
  assert.ok(pcm.every(v=>Math.abs(v)<.45));assert.equal(pcm[0],0);assert.equal(pcm.at(-1),0);
  return Float32Array.from({length:16000},(_,i)=>pcm[i*6]);
}
test('actual MuseScore probes retain duration/energy and reject uncancelled echo at the existing gate',async()=>{
  const music=[musicalPcm(1),musicalPcm(2)],noise=[Core.noise(16000,.08,173),Core.noise(16000,.08,957)];
  for(const probes of [music,noise])for(const residualGain of [.005,.5]){
    const f=fixture(),{p,node}=await f.begin(),data=f.packet(0);data.reference.fill(0);
    for(let part=0;part<2;part++)for(let i=0;i<16000;i++){
      const at=(part?40000:16000)+i;data.reference[at]=probes[part][i]*.62;
      if(at+640<data.microphone.length)data.microphone[at+640]=data.reference[at]*residualGain;
    }
    const rejected=residualGain>.1,check=rejected?assert.rejects(p):p;
    node.port.onmessage({data});await check;assert.equal(f.ui.ready(),!rejected);
  }
});
test('runtime restores the pre-music broadband PCM at each device rate without network or decoding',async()=>{
  const sandbox={window:{ChoirEchoCancellation:Core},WeakMap,
    fetch:()=>{throw Error('Calibration must not fetch musical audio');}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/calibration_probe.js'),'utf8'),sandbox);
  const load=sandbox.window.ChoirCalibrationProbe.load;
  assert.equal(sandbox.window.ChoirCalibrationProbe.id,'broadband-noise-v1');
  for(const sampleRate of [8000,44100,48000]){
    let fail=true,calls=0;
    const context={sampleRate,createBuffer(channels,length,rate){
      calls++;if(fail)throw Error('Transient buffer error');
      assert.equal(channels,1);assert.equal(length,sampleRate*2);assert.equal(rate,sampleRate);
      let pcm;return {length,duration:length/rate,copyToChannel(data,channel){assert.equal(channel,0);pcm=data;},getChannelData(){return pcm;}};
    }};
    await assert.rejects(load(context));fail=false;
    const a=await load(context),count=calls,b=await load(context);assert.equal(a,b);assert.equal(calls,count);
    for(let part=0;part<2;part++)assert.deepEqual(a[part].getChannelData(),Core.noise(sampleRate*2,.08,part?957:173));
  }
});
test('platform route verifies residual with no convolver, second subtraction, or invented dB/delay',async()=>{
  const f=fixture(),{p,node}=await f.begin();node.port.onmessage({data:f.packet()});await p;
  assert.equal(f.ui.ready(),true);assert.equal(f.ui.diagnostics().strategy,'platform');
  assert.equal(f.ui.diagnostics().validationDb,null);assert.equal(f.ui.diagnostics().peakDelayMs,null);
  assert.equal(f.ui.detectionFloor(),0);const g=f.ui.captureGraph();
  assert.equal(g.raw,g.processed);assert.equal(g.prediction,null);assert.equal(g.profile.inputStage,'post-platform-aec');
  f.ui.invalidate('piece-output-route');assert.equal(f.ui.ready(),true);
  f.context.state='suspended';for(const listener of f.listeners)listener();assert.equal(f.ui.ready(),false);
  f.ui.detach();assert.equal(f.listeners.size,0);
});
test('native capture can operate without claiming a fresh acoustic measurement',async()=>{
  const f=fixture();f.ui.prepare();await f.ui.attach(f.stream);
  assert.equal(f.ui.operational(),true);assert.equal(f.ui.ready(),false);
  assert.equal(f.ui.captureGraph().profile.calibrationVerified,false);
  assert.equal(f.ui.diagnostics().nativeResidualRms,null);
  f.advance(Core.TTL+1);assert.equal(f.ui.operational(),true);
  f.config.autoGainControl=true;assert.equal(f.ui.operational(),false);
  f.config.autoGainControl=false;f.setUser('other');assert.equal(f.ui.operational(),false);
  f.setUser('singer-a');f.stream.getAudioTracks()[0].readyState='ended';assert.equal(f.ui.operational(),false);
  f.ui.detach();assert.equal(f.ui.operational(),false);
});
test('effective capture settings are required; unknown/disabled AEC never silently passes',async()=>{
  for(const changed of [{echoCancellation:false},{echoCancellation:'all'},{noiseSuppression:true},{autoGainControl:true}]){
    const f=fixture();Object.assign(f.config,changed);f.ui.prepare();await assert.rejects(f.ui.attach(f.stream),/cuffie/);
    assert.equal(f.ui.ready(),false);
  }
});

test('explicit all trial verifies the actual mode, keeps subtraction off and reports provenance',async()=>{
  const f=fixture(undefined,'all'),{p,node}=await f.begin();node.port.onmessage({data:f.packet()});await p;
  assert.equal(f.ui.ready(),true);assert.equal(f.ui.operational(),true);
  const d=f.ui.diagnostics();assert.equal(d.requestedMode,'all');assert.equal(d.captureMode,'all');assert.equal(d.experimental,true);
  assert.equal(d.appliedGain,0);assert.equal(f.ui.captureGraph().profile.calibrationVerified,true);
  assert.ok(f.ui.lifecycle().events.every(e=>e.requestedMode==='all'));
  f.config.echoCancellation=true;assert.equal(f.ui.operational(),false);assert.equal(f.ui.ready(),false);
});

test('all trial never silently accepts normal, absent, or disabled AEC or enabled NS/AGC',async()=>{
  for(const changed of [{echoCancellation:true},{echoCancellation:false},{echoCancellation:undefined},{noiseSuppression:true},{autoGainControl:true}]){
    const f=fixture(undefined,'all');Object.assign(f.config,changed);f.ui.prepare();
    await assert.rejects(f.ui.attach(f.stream),/cuffie/);assert.equal(f.ui.operational(),false);
  }
});

test('all measurement rejects a capture mode change during the acoustic check',async()=>{
  const f=fixture(undefined,'all'),{p,node}=await f.begin();const rejected=assert.rejects(p,/Impostazioni audio cambiate/);
  f.config.echoCancellation=true;node.port.onmessage({data:f.packet()});await rejected;
  assert.equal(f.ui.ready(),false);
});
test('incomplete, nonfinite, strong echo and missing reference cannot verify platform capture',async()=>{
  for(const bad of ['short','nan','echo','reference']){
    const f=fixture(),{p,node}=await f.begin();const rejection=assert.rejects(p);
    const data=f.packet(bad==='echo'?.02:.0001);
    if(bad==='short')data.microphone=data.microphone.slice(1);
    if(bad==='nan')data.microphone[100]=NaN;
    if(bad==='reference')data.reference.fill(0);
    node.port.onmessage({data});await rejection;assert.equal(f.ui.ready(),false);assert.equal(f.ui.isBusy(),false);
  }
});
test('cancellation, track end, account and expiry cannot reuse a verified native route',async()=>{
  const f=fixture();let run=await f.begin();const rejection=assert.rejects(run.p);f.ui.cancel();await rejection;
  run=await f.begin();run.node.port.onmessage({data:f.packet()});await run.p;
  f.setUser('singer-b');assert.equal(f.ui.ready(),false);assert.equal(f.ui.lifecycle().events.length,0);
  f.setUser('singer-a');run=await f.begin();run.node.port.onmessage({data:f.packet()});await run.p;
  f.advance(Core.TTL+1);assert.equal(f.ui.ready(),false);
});
