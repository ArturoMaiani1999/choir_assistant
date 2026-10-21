const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Diagnostic=require('../frontend/echo_diagnostics.js');
const Clock=require('../frontend/audio_sample_clock.js');
function loadWorklet(ctx){ctx.ChoirAudioSampleClock=Clock;vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/echo_diagnostic_worklet.js'),'utf8').replace(/^import .*;\r?$/gm,''),ctx);}
test('exports four synchronized float channels including overload and embedded provenance',async()=>{
  const channels=[new Float32Array([1.2,-1.3]),new Float32Array([.2,.3]),new Float32Array([.9,-1.6]),new Float32Array([.3,.3])];
  const blob=Diagnostic.wav([{channels,valid:2}],48000,{pieceId:'santo-frisina',pitchFrames:[{accepted:false,rawHz:null}],consent:'registrazione locale'});
  const b=Buffer.from(await blob.arrayBuffer());assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt16LE(20),3);assert.equal(b.readUInt16LE(22),4);
  assert.equal(b.readUInt32LE(24),48000);assert.equal(b.readUInt32LE(40),32);
  for(let i=0;i<2;i++)for(let c=0;c<4;c++)assert.equal(b.readFloatLE(44+(i*4+c)*4),channels[c][i]);
  assert.equal(b.toString('ascii',76,80),'chAI');const meta=JSON.parse(b.toString('utf8',84,84+b.readUInt32LE(80)));
  assert.equal(meta.frames,2);assert.equal(meta.sampleRate,48000);assert.deepEqual(meta.channelNames,Diagnostic.CHANNELS);assert.equal(meta.pieceId,'santo-frisina');
  assert.equal(meta.pitchFrames[0].accepted,false);assert.equal(b.readUInt32LE(4),b.length-8);
});
test('capture worklet preserves sample alignment and partial stop without audible output',()=>{
  let Processor;const packets=[];
  const ctx={AudioWorkletProcessor:class{constructor(){this.port={postMessage:p=>packets.push(p)};}},
    registerProcessor:(_,p)=>Processor=p,currentFrame:0,sampleRate:48000,Float32Array};
  loadWorklet(ctx);
  const p=new Processor({processorOptions:{startFrame:128,maximumFrames:48000}}),output=[[new Float32Array(128).fill(1)]];
  const inputs=Array.from({length:4},(_,c)=>[new Float32Array(128).fill(c+.25)]);
  for(let i=0;i<35;i++){ctx.currentFrame=i*128;p.process(inputs,output);}
  p.port.onmessage({data:'stop'});assert.equal(packets.length,2);assert.equal(packets[0].firstFrame,128);assert.equal(packets[1].firstFrame,128+4096);
  assert.equal(packets[0].valid+packets[1].valid,34*128);assert.equal(packets[1].done,true);
  for(const packet of packets)for(let c=0;c<4;c++)for(let i=0;i<packet.valid;i++)assert.equal(packet.channels[c][i],c+.25);
  assert.ok(output[0][0].every(v=>v===0));assert.equal(p.process(inputs,output),false);
});
test('shared graphics preserve every admitted pitch, including weak voices and wrong notes, but not provisional candidates',()=>{
  global.window={};require('../frontend/piano_roll.js');const accepts=window.PianoRoll.isAcceptedObservation;
  assert.equal(accepts({beat:1,displayPitch:60,trackedPitch:60,confidence:.1}),true);
  assert.equal(accepts({beat:1,displayPitch:72,trackedPitch:72,confidence:.1}),true,'Do not correct a wrong note to score');
  assert.equal(accepts({beat:1,displayPitch:84,trackedPitch:null,confidence:0,confirmationState:'provisional'}),false);
  assert.equal(accepts({beat:1,displayPitch:84,confidence:0}),false,'Legacy rejected candidates remain unaccepted');
  assert.equal(accepts({beat:1,displayPitch:60}),true,'Legacy traces without confidence remain readable');
});

test('diagnostic capture stops exactly at its frame limit and keeps absent inputs silent',()=>{
  let Processor;const packets=[];
  const ctx={AudioWorkletProcessor:class{constructor(){this.port={postMessage:p=>packets.push(p)};}},
    registerProcessor:(_,p)=>Processor=p,currentFrame:0,sampleRate:48000,Float32Array};
  loadWorklet(ctx);
  const p=new Processor({processorOptions:{startFrame:0,maximumFrames:193}}),output=[[new Float32Array(128)]];
  p.process([[new Float32Array(128).fill(.2)],[],[],[]],output);ctx.currentFrame=128;
  assert.equal(p.process([[new Float32Array(128).fill(.2)],[],[],[]],output),false);
  assert.equal(packets.length,1);assert.equal(packets[0].valid,193);assert.equal(packets[0].done,true);
  for(let c=1;c<4;c++)assert.ok(packets[0].channels[c].every(v=>v===0));
});

test('a forward clock jump preserves the delivered prefix and never appends subsequent PCM',()=>{
  let Processor;const packets=[];
  const ctx={AudioWorkletProcessor:class{constructor(){this.port={postMessage:p=>packets.push(p)};}},
    registerProcessor:(_,p)=>Processor=p,currentFrame:0,sampleRate:48000,Float32Array};
  loadWorklet(ctx);
  const p=new Processor({processorOptions:{startFrame:0,maximumFrames:48000}}),out=[[new Float32Array(128)]];
  p.process([],out);ctx.currentFrame=256;
  assert.equal(p.process([],out),false);assert.equal(packets[0].valid,128);
  assert.equal(packets[1].error,'discontinuous-capture');
  assert.equal(packets[1].expectedFrame,128);assert.equal(packets[1].actualFrame,256);
});

test('diagnostic UI saves only the delivered prefix on context interruption and removes its listener',async()=>{
  const elements=new Map(),listeners=new Set();let capture,saved;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{hidden:false,checked:true,handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},
      showModal(){this.open=true;},close(){this.open=false;},focus(){}});
    return elements.get(id);
  };
  const connectable=()=>({connect(){},disconnect(){}});
  const context={sampleRate:48000,currentTime:1,state:'running',audioWorklet:{addModule:async()=>{}},
    createGain:()=>({...connectable(),gain:{value:1}}),
    addEventListener(type,fn){if(type==='statechange')listeners.add(fn);},
    removeEventListener(type,fn){if(type==='statechange')listeners.delete(fn);}};
  const sandbox={document:{getElementById:element,visibilityState:'visible',addEventListener(){}},
    crypto:{randomUUID:()=> 'diagnostic-fixture'},Blob,TextEncoder,ArrayBuffer,DataView,Uint8Array,
    setTimeout,clearTimeout,
    AudioWorkletNode:class{constructor(){capture=this;this.port={close(){}};}connect(){}disconnect(){}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/echo_diagnostics.js'),'utf8'),sandbox);
  const graph={context,raw:connectable(),reference:connectable(),processed:connectable(),prediction:connectable(),
    profile:{calibrationVerified:true,impulse:new Float32Array([1])}};
  const ui=sandbox.ChoirEchoDiagnostics.create({ready:()=>true,startMicrophone:async()=>{},graph:()=>graph,
    metadata:()=>({pieceId:'santo-frisina'}),play:async()=>{},running:()=>true,pause:async()=>{},
    save:async(id,metadata)=>{saved=metadata;return {diagnostic:{id}};}});
  element('echo-test-start').handlers.click();await new Promise(r=>setImmediate(r));
  assert.equal(ui.isBusy(),true);assert.equal(listeners.size,1);
  const start=Math.ceil(1.05*48000/128)*128;
  capture.port.onmessage({data:{channels:Array.from({length:4},()=>new Float32Array(128)),valid:128,firstFrame:start,
    clock:{timebase:'processed-samples',skewCount:1,forwardGaps:0}}});
  context.state='suspended';for(const listener of listeners)listener();await new Promise(r=>setImmediate(r));
  assert.equal(ui.isBusy(),false);assert.equal(listeners.size,0);
  assert.equal(saved.stoppedReason,'audio-context-suspended');assert.equal(saved.pcmContinuity.capturedFrames,128);
  assert.equal(saved.pcmContinuity.clock.skewCount,1);assert.equal(saved.pcmContinuity.discontinuous,false);
  assert.ok(saved.events.some(e=>e.type==='audio-context-state-change'));
});
