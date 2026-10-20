const {test} = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../frontend/echo_cancellation.js');
const fs = require('node:fs');
const vm = require('node:vm');
const sr = 32000;
function capture(pathChange=false) {
  const x = new Float32Array(sr*14), h = new Float32Array(6000);
  h[481]=.45; h[790]=-.12; h[3800]=.08;
  x.set(Core.noise(sr*6,.08,123),sr*4); x.set(Core.noise(sr*2,.08,957),sr*11);
  const y = Float32Array.from(Core.convolve(x,h));
  if(pathChange)for(let i=sr*11;i<y.length;i++)y[i]*=-1;
  return {x,y,h};
}
test('identifies a causal delayed room path and passes independent excitation',()=>{
  const {x,y}=capture(),p=Core.fit(x,y,sr);
  assert.ok(p.usable,JSON.stringify(p)); assert.ok(p.validationDb>25,p.validationDb);
  assert.ok(Math.abs(p.peakDelayMs-481/sr*1000)<.1);
});
test('compact unified capture measures each current latency and rejects held-out path changes',()=>{
  for (const delay of [481, 1278]) {
    const x = new Float32Array(sr*10), h = new Float32Array(6000);
    h[delay]=.45; h[delay+256]=-.12; h[delay+3000]=.08;
    x.set(Core.noise(sr*3,.08,173),sr*3); x.set(Core.noise(sr*2,.08,957),sr*7);
    const y=Float32Array.from(Core.convolve(x,h)), p=Core.fit(x,y,sr,true);
    assert.ok(p.usable,JSON.stringify(p));
    assert.ok(Math.abs(p.peakDelayMs-delay/sr*1000)<.1);
    assert.ok(p.validationDb>25);
    for(let i=sr*7;i<y.length;i++)y[i]*=-1;
    assert.equal(Core.fit(x,y,sr,true).usable,false,'held-out data must not train the filter');
  }
});
test('preserves a singer at the same F0 and phase differences using a frozen reference model',()=>{
  const {x,y,h}=capture(),p=Core.fit(x,y,sr);
  const reference=Float32Array.from({length:sr*2},(_,i)=>.04*Math.sin(2*Math.PI*220*i/sr));
  const echo=Core.convolve(reference,h),prediction=Core.convolve(reference,p.impulse);
  for(const phase of [0,Math.PI/3,Math.PI]){
    let error=0,energy=0;
    for(let i=sr/2;i<reference.length;i++){
      const voice=.03*Math.sin(2*Math.PI*220*i/sr+phase), cleaned=voice+echo[i]-prediction[i];
      error+=(cleaned-voice)**2;energy+=voice**2;
    }
    assert.ok(error/energy<.002, error/energy);
  }
  assert.deepEqual(Core.convolve(new Float32Array(2000),p.impulse),new Float64Array(2000));
});
test('rejects changed paths, absent output, clipping and incomplete/nonfinite captures',()=>{
  const {x,y}=capture(true); assert.equal(Core.fit(x,y,sr).usable,false);
  assert.equal(Core.fit(new Float32Array(x.length),y,sr).usable,false);
  y[0]=1; assert.equal(Core.fit(x,y,sr).reason,'clipping');
  assert.equal(Core.fit(x.slice(1),y,sr).reason,'capture');
  y[0]=NaN;assert.equal(Core.fit(x,y,sr).reason,'capture');
});

test('follows louder and quieter broadband echo only after independent and repeated confirmation',()=>{
  for (const rate of [32000,44100,48000,96000]) {
    const predicted=Core.noise(8192,.04,193);
    const follower=new Core.GainFollower();
    let time=0;
    for(const target of [2,.5,3,1]) {
      const mic=Float32Array.from(predicted,v=>v*target);
      const observation=Core.gainObservation(predicted,mic,rate);
      assert.ok(observation.usable,JSON.stringify(observation));
      assert.ok(Math.abs(observation.gain-target)<1e-5);
      for(let i=0;i<3;i++) {
        time+=8192/rate+.01;
        const decision=follower.observe(observation,time);
        assert.equal(decision.changed,i===2);
        assert.equal(decision.pending,i<2);
      }
      assert.ok(Math.abs(follower.gain-target)<1e-5);
    }
  }
});

test('cannot learn same-frequency singers from tonal output, with any phase or level',()=>{
  const predicted=Float32Array.from({length:8192},(_,i)=>.04*Math.sin(2*Math.PI*220*i/48000));
  for(const phase of [0,Math.PI/3,Math.PI]) for(const amplitude of [.001,.03,.08]) {
    const mic=Float32Array.from(predicted,(v,i)=>2*v+amplitude*Math.sin(2*Math.PI*220*i/48000+phase));
    const observation=Core.gainObservation(predicted,mic,48000);
    assert.equal(observation.usable,false); assert.equal(observation.reason,'narrow');
    const follower=new Core.GainFollower();
    for(let i=0;i<10;i++) follower.observe(observation,i*.2);
    assert.equal(follower.gain,1);
  }
  const vowel=Float32Array.from({length:8192},(_,i)=>{
    let value=0;
    for(let harmonic=1;harmonic<=35;harmonic++)value+=.003*Math.sin(2*Math.PI*220*harmonic*i/48000+harmonic*.37);
    return value;
  });
  const observation=Core.gainObservation(vowel,Float32Array.from(vowel,v=>v*2),48000);
  assert.equal(observation.usable,false,'A harmonic-rich same-F0 signal is still ambiguous');
});

test('freezes on double talk over broadband playback, path delay, distortion and clipping',()=>{
  const predicted=Core.noise(8192,.06,535);
  const cases=[];
  for(const phase of [0,Math.PI/3,Math.PI]) {
    cases.push(Float32Array.from(predicted,(v,i)=>v*2+.03*Math.sin(2*Math.PI*220*i/48000+phase)));
    // Harmonic singer with exactly the same 220-Hz component as an output note.
    cases.push(Float32Array.from(predicted,(v,i)=>v*2+.025*Math.sin(2*Math.PI*220*i/48000+phase)+.01*Math.sin(2*Math.PI*440*i/48000+phase)));
  }
  cases.push(Float32Array.from(predicted,(v,i)=>i ? predicted[i-1] : 0));
  cases.push(Float32Array.from(predicted,v=>.03*Math.tanh(v/.03)));
  cases.push(Float32Array.from(predicted,(v,i)=>i<4096?v*2:v*3));
  const clipping=predicted.slice();clipping[30]=.99;cases.push(clipping);
  const invalid=predicted.slice();invalid[20]=NaN;cases.push(invalid);
  for(const microphone of cases) {
    const observation=Core.gainObservation(predicted,microphone,48000);
    assert.equal(observation.usable,false,JSON.stringify(observation));
    const follower=new Core.GainFollower();
    for(let i=0;i<8;i++)follower.observe(observation,i*.2);
    assert.equal(follower.gain,1);
  }
  assert.equal(Core.gainObservation(predicted,cases[0],48000,1).usable,false,
    'A contaminated quiet-noise estimate must not exempt the singer from the residual check');
});

test('an interrupted or inconsistent gain candidate cannot be applied later',()=>{
  const follower=new Core.GainFollower();
  const twice={usable:true,gain:2};
  follower.observe(twice,.2);follower.observe(twice,.4);
  follower.observe({usable:false,reason:'double-talk-or-path'},.6);
  assert.equal(follower.observe(twice,.8).changed,false);
  assert.equal(follower.observe(twice,2).changed,false); // capture stalled
  assert.equal(follower.gain,1);
  assert.equal(follower.observe({usable:true,gain:3},2.2).changed,false);
  assert.equal(follower.observe(twice,2.4).changed,false);
  assert.equal(follower.gain,1);
});

test('monitor advances through silent zero-channel inputs and recycles only one window',()=>{
  let Processor, message, emitted=0;
  const sandbox={AudioWorkletProcessor:class { constructor(){this.port={postMessage:data=>{message=data;emitted++;}};} },
    registerProcessor:(_,value)=>{Processor=value;},sampleRate:48000,currentFrame:0,Float32Array};
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/echo_monitor_worklet.js'),'utf8'),sandbox);
  const monitor=new Processor(),mic=new Float32Array(128).fill(.03),out=[[new Float32Array(128)]];
  for(let i=0;i<64;i++){sandbox.currentFrame=i*128;monitor.process([[mic],[]],out);}
  assert.equal(emitted,1);assert.ok(message.microphone.every(v=>Math.abs(v-.03)<1e-7));
  assert.ok(message.prediction.every(v=>v===0));
  assert.equal(message.endTime,8192/48000);
  for(let i=64;i<128;i++){sandbox.currentFrame=i*128;monitor.process([[],[]],out);}
  assert.equal(emitted,1,'The audio thread must not accumulate extra windows while a worker is busy');
  monitor.port.onmessage({data:message});
  sandbox.currentFrame=128*128;monitor.process([[],[]],out);
  assert.equal(emitted,2);assert.ok(message.microphone.every(v=>v===0));
  assert.equal(message.endTime,129*128/48000,'A busy worker must receive the newest window, not a stale backlog');
  assert.ok(out[0][0].every(v=>v===0),'The monitor must never play the microphone');
});

test('actual identified room model supports scalar tracking and preserves a same-F0 voice after verification',()=>{
  const {x,y,h}=capture(),profile=Core.fit(x,y,sr);
  const signal=Core.noise(sr*2,.08,995),actual=Core.convolve(signal,h),predicted=Core.convolve(signal,profile.impulse);
  const p=Float32Array.from(predicted.slice(sr,sr+8192)),mic=Float32Array.from(actual.slice(sr,sr+8192),v=>v*2);
  const observation=Core.gainObservation(p,mic,sr);
  assert.ok(observation.usable,JSON.stringify(observation));
  assert.ok(Math.abs(observation.gain-2)<.03);
  const reference=Float32Array.from({length:sr},(_,i)=>.04*Math.sin(2*Math.PI*220*i/sr));
  const echo=Core.convolve(reference,h),prediction=Core.convolve(reference,profile.impulse);
  for(const phase of [0,Math.PI/3,Math.PI]) {
    let error=0,energy=0;
    for(let i=sr/2;i<sr;i++) {
      const voice=.03*Math.sin(2*Math.PI*220*i/sr+phase);
      const cleaned=voice+2*echo[i]-observation.gain*prediction[i];
      error+=(cleaned-voice)**2;energy+=voice**2;
    }
    assert.ok(error/energy<.003,error/energy);
  }
});
