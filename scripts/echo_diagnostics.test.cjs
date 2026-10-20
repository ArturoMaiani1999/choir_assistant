const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Diagnostic=require('../frontend/echo_diagnostics.js');
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
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/echo_diagnostic_worklet.js'),'utf8'),ctx);
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
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/echo_diagnostic_worklet.js'),'utf8'),ctx);
  const p=new Processor({processorOptions:{startFrame:0,maximumFrames:193}}),output=[[new Float32Array(128)]];
  p.process([[new Float32Array(128).fill(.2)],[],[],[]],output);ctx.currentFrame=128;
  assert.equal(p.process([[new Float32Array(128).fill(.2)],[],[],[]],output),false);
  assert.equal(packets.length,1);assert.equal(packets[0].valid,193);assert.equal(packets[0].done,true);
  for(let c=1;c<4;c++)assert.ok(packets[0].channels[c].every(v=>v===0));
});

test('capture reports a missing audio quantum instead of relabeling subsequent PCM as contiguous',()=>{
  let Processor;const packets=[];
  const ctx={AudioWorkletProcessor:class{constructor(){this.port={postMessage:p=>packets.push(p)};}},
    registerProcessor:(_,p)=>Processor=p,currentFrame:0,sampleRate:48000,Float32Array};
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/echo_diagnostic_worklet.js'),'utf8'),ctx);
  const p=new Processor({processorOptions:{startFrame:0,maximumFrames:48000}}),out=[[new Float32Array(128)]];
  p.process([],out);ctx.currentFrame=256;
  assert.equal(p.process([],out),false);assert.equal(packets[0].error,'discontinuous-capture');
  assert.equal(packets[0].expectedFrame,128);assert.equal(packets[0].actualFrame,256);
});
