const {test}=require('node:test'),assert=require('node:assert/strict');
const Core=require('../frontend/echo_cancellation.js'),Delay=require('../frontend/echo_delay.js');

test('identifies positive, negative and fractional changes at supported sample rates',()=>{
  for(const rate of [32000,44100,48000,96000])for(const delta of [-Math.round(rate*.006),Math.round(rate*.006),12.5]){
    const p=Core.noise(8192,.08,723),mic=Float32Array.from(p,(_,i)=>Delay.sample(p,i-delta));
    const result=Delay.observation(p,mic,rate);
    assert.ok(result.usable,JSON.stringify({rate,delta,result}));assert.ok(Math.abs(result.deltaFrames-delta)<=.125,JSON.stringify(result));
  }
});

test('tonal unison cannot teach delay; independent broadband evidence can track during singing',()=>{
  const rate=48000,delta=288;
  const signals=[Float32Array.from({length:8192},(_,i)=>.04*Math.sin(2*Math.PI*220*i/rate)),
    Float32Array.from({length:8192},(_,i)=>{let v=0;for(let h=1;h<=35;h++)v+=.003*Math.sin(2*Math.PI*220*h*i/rate+h*.37);return v;})];
  for(const p of signals)for(const phase of [0,Math.PI/3,Math.PI]){
    const mic=Float32Array.from(p,(_,i)=>Delay.sample(p,i-delta)+.03*Math.sin(2*Math.PI*220*i/rate+phase));
    assert.equal(Delay.observation(p,mic,rate).usable,false);
  }
  const p=Core.noise(8192,.1,319);
  for(const amplitude of [.001,.005,.03])for(const phase of [0,Math.PI/3,Math.PI])for(const actualDelta of [0,delta,-delta]){
    const mic=Float32Array.from(p,(_,i)=>Delay.sample(p,i-actualDelta)+amplitude*Math.sin(2*Math.PI*220*i/rate+phase));
    const result=Delay.observation(p,mic,rate,{noiseRms:1});
    assert.ok(result.usable,JSON.stringify({amplitude,phase,actualDelta,result}));
    assert.ok(Math.abs(result.deltaFrames-actualDelta)<=.125,JSON.stringify(result));
  }
});

test('invalid, silent, clipping and changing paths cannot update the follower',()=>{
  const p=Core.noise(8192,.1,379),bad=p.slice();bad[7000]=NaN;
  assert.equal(Delay.observation(p,bad,48000).reason,'capture');
  assert.equal(Delay.observation(new Float32Array(8192),p,48000).reason,'weak');
  const follower=new Delay.Follower(-1000,1000),candidate={usable:true,deltaFrames:288};
  assert.equal(follower.observe(candidate,1,0).changed,false);
  follower.observe({usable:false,reason:'voice'},1.02,0);
  assert.equal(follower.observe(candidate,1.04,0).changed,false);
  assert.equal(follower.observe(candidate,2,0).changed,false);
  assert.equal(follower.observe(candidate,2.02,0).offsetFrames,288);
  assert.equal(follower.observe({usable:true,deltaFrames:2000},2.04,288).changed,false);
});

test('retimer preserves continuous history and crossfades only prediction, including reverse changes',()=>{
  const input=Core.noise(20000,.1,991),out=new Float32Array(input.length),processor=new Delay.Retimer(2000,1000);
  processor.process(input.subarray(0,10000),out.subarray(0,10000));
  assert.ok(processor.setDelay(1288,720));processor.process(input.subarray(10000,12000),out.subarray(10000,12000));
  assert.ok(processor.setDelay(712,720));processor.process(input.subarray(12000),out.subarray(12000));
  for(let i=2000;i<10000;i++)assert.equal(out[i],input[i-1000]);
  for(let i=10720;i<12000;i++)assert.equal(out[i],input[i-1288]);
  for(let i=12720;i<out.length;i++)assert.equal(out[i],input[i-712]);
  assert.equal(processor.setDelay(-1),false);assert.equal(processor.setDelay(NaN),false);
  assert.equal(processor.setDelay(2001),false);
});

test('causal headroom keeps the reference model within the fixed energy budget',()=>{
  const h=new Float32Array(8000);h[7200]=.5;h[7400]=-.1;
  const prepared=Delay.prepare(h,48000);assert.equal(prepared.baseFrames,1536);assert.equal(prepared.removedEnergyFraction,0);
  const reference=Core.noise(20000,.1,37),full=Core.convolve(reference,prepared.impulse);
  const early=Core.convolve(reference,prepared.impulse.slice(prepared.baseFrames));
  const retimer=new Delay.Retimer(4000,prepared.baseFrames),actual=new Float32Array(reference.length);
  retimer.process(early,actual);
  let error=0;for(let i=0;i<full.length;i++)error+=(full[i]-actual[i])**2;
  assert.ok(error<1e-12,error);
});

test('causal tracking preserves weak unison voices and improves F0 on a fixed voiced frame mask',()=>{
  const {replay}=require('./benchmark_echo_delay.cjs');
  global.window={};require('../frontend/pitch_detector.js');const Pitch=window.ChoirPitch;
  const rate=48000,n=rate*8,h=new Float32Array(8000);h[7200]=.5;h[7456]=-.1;
  const reference=Core.noise(n,.08,837);
  for(let i=0;i<n;i++)reference[i]+=.015*Math.sin(2*Math.PI*220*i/rate)+.01*Math.sin(2*Math.PI*246.94*i/rate);
  const original=Core.convolve(reference,h),echo=Float32Array.from(original,(_,i)=>Delay.sample(original,i-(i<rate*3?0:i<rate*5?288:-288)));
  const options={sampleRate:rate,startAt:1,regions:[[1.6,7.7]],noiseRms:0};
  const control=replay(reference,echo,h,options);
  const cases=[];
  for(const amplitude of [.005,.03])for(const phase of [0,Math.PI/3,Math.PI]){
    const voice=Float32Array.from({length:n},(_,i)=>i>=rate*1.5&&i<rate*7.8?amplitude*Math.sin(2*Math.PI*220*i/rate+phase):0);
    const mic=Float32Array.from(echo,(v,i)=>v+voice[i]),result=replay(reference,mic,h,options);
    assert.ok(result.report.events.some(e=>Math.abs(e.offsetFrames-288)<=.125),JSON.stringify(result.report.events));
    assert.ok(result.report.events.some(e=>Math.abs(e.offsetFrames+288)<=.125),JSON.stringify(result.report.events));
    let vv=0,cross=0;
    for(let i=rate*6;i<rate*7;i++){
      const difference=mic[i]-result.tracked[i]-(echo[i]-control.tracked[i]);vv+=voice[i]**2;cross+=difference*voice[i];
    }
    assert.ok(Math.abs(20*Math.log10(cross/vv))<=.5,'Voice component changed');
    const errors=[],oldErrors=[];let falseNegatives=0,oldFalseNegatives=0,introducedFalseNegatives=0,frames=0;
    for(let at=Math.round(1.6*rate);at+2048<7.7*rate;at+=1024){
      const corrected=Float32Array.from(mic.subarray(at,at+2048),(v,i)=>v-result.tracked[at+i]);
      const fixed=Float32Array.from(mic.subarray(at,at+2048),(v,i)=>v-result.frozen[at+i]);
      const settings={rmsThreshold:.002,yinThreshold:.18,minHz:65,maxHz:800};
      const detected=Pitch.detectPitch(corrected,rate,settings),old=Pitch.detectPitch(fixed,rate,settings);
      frames++;
      if(!old.hz)oldFalseNegatives++;else oldErrors.push(Math.abs(1200*Math.log2(old.hz/220)));
      if(old.hz&&!detected.hz)introducedFalseNegatives++;
      if(!detected.hz)falseNegatives++;else errors.push(Math.abs(1200*Math.log2(detected.hz/220)));
    }
    errors.sort((a,b)=>a-b);
    oldErrors.sort((a,b)=>a-b);
    cases.push({amplitude,phase,frames,falseNegatives,oldFalseNegatives,introducedFalseNegatives,voiceGainDb:20*Math.log10(cross/vv),
      medianCents:errors[Math.floor(errors.length*.5)],p95Cents:errors[Math.floor(errors.length*.95)],
      oldMedianCents:oldErrors[Math.floor(oldErrors.length*.5)],oldP95Cents:oldErrors[Math.floor(oldErrors.length*.95)],
      events:result.report.events});
    assert.ok(falseNegatives<=oldFalseNegatives,'Tracking introduced false negatives');
    assert.equal(introducedFalseNegatives,0,'A frame admitted by the baseline was lost');
    assert.ok(errors[Math.floor(errors.length*.5)]<=10,'Median F0 error exceeds 10 cents');
    assert.ok(errors[Math.floor(errors.length*.95)]<=30,'P95 F0 error exceeds 30 cents');
  }
  if(process.env.ECHO_DELAY_REPORT)require('node:fs').writeFileSync(process.env.ECHO_DELAY_REPORT,JSON.stringify({kind:'synthetic-known-voice-fixed-frame-mask',sampleRate:rate,cases},null,2));
});
