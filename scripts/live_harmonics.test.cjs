const {test}=require('node:test'),assert=require('node:assert/strict');global.window={};require('../frontend/pitch_detector.js');
const Pitch=window.ChoirPitch,sr=48000;
const frame=(hz,amplitude=.04,ratio=0,phase=0)=>Float32Array.from({length:2048},(_,i)=>amplitude*(Math.sin(2*Math.PI*hz*i/sr+phase)+ratio*Math.sin(4*Math.PI*hz*i/sr+phase)));
test('causal harmonic resolution preserves the original voiced mask, RMS, clarity and confidence',()=>{
  let corrected=0;
  for(const hz of [90,130,173,220,260,330,440])for(const amplitude of [.0005,.003,.01,.08])for(const ratio of [0,1,3,4,5,8]){
    const x=frame(hz,amplitude,ratio),settings={rmsThreshold:.002,yinThreshold:.18};
    const raw=Pitch.detectPitch(x,sr,settings),live=Pitch.detectPitch(x,sr,{...settings,resolveHarmonics:true});
    assert.equal(Boolean(raw.hz),Boolean(live.hz));assert.equal(raw.rms,live.rms);assert.equal(raw.clarity,live.clarity);assert.equal(raw.confidence,live.confidence);
    if(live.harmonicResolved){corrected++;assert.ok(Math.abs(1200*Math.log2(live.hz/hz))<15,JSON.stringify({hz,ratio,live}));}
  }
  assert.ok(corrected>10);
});
test('actual note and octave changes need neither a preceding note nor lookahead',()=>{
  for(const sequence of [[130,260,130,520,260],[220,233.08,246.94,261.63,220],[440,220,110,220,440]]){
    for(const hz of sequence){
      const r=Pitch.detectPitch(frame(hz,.03,0,.8),sr,{rmsThreshold:.002,yinThreshold:.18,resolveHarmonics:true});
      assert.ok(Math.abs(1200*Math.log2(r.hz/hz))<10,JSON.stringify({hz,r}));assert.equal(r.harmonicResolved,false);
    }
  }
});
test('vibrato, free onset glides and soft fundamentals are not snapped to a note',()=>{
  for(let i=0;i<60;i++){
    const hz=140+i*1.3+2*Math.sin(i/3),r=Pitch.detectPitch(frame(hz,.005,3,i),sr,{rmsThreshold:.002,yinThreshold:.18,resolveHarmonics:true});
    assert.ok(Math.abs(1200*Math.log2(r.hz/hz))<25,JSON.stringify({hz,r}));
  }
});

test('the live tracker preserves the original admission mask through harmonic and real note transitions',()=>{
  for(const weakSignalHoldFrames of [0,6]){
  const options={minClarity:.45,minConfidence:.3,slowAlpha:.65,weakSignalHoldFrames},old=new Pitch.PitchSmoother(options),live=new Pitch.HarmonicPitchSmoother(options);
  let at=0;
  for(const [hz,ratio] of [[220,0],[220,5],[440,0],[233.08,0],[233.08,4],[0,0],[130,0],[260,0]]){
    for(let i=0;i<12;i++,at++){
      const pcm=hz?frame(hz,.04,ratio,i/3):new Float32Array(2048),s={rmsThreshold:.002,yinThreshold:.42};
      const a=Pitch.detectPitch(pcm,sr,s),b=Pitch.detectPitch(pcm,sr,{...s,resolveHarmonics:true});
      const original=old.update(a,at*20),selected=live.update(b,at*20);
      assert.equal(selected.accepted,original.accepted);assert.equal(selected.stable,original.stable);assert.equal(selected.confidence,original.confidence);
      if(selected.accepted)assert.ok(selected.hz>0);
    }
  }
  old.reset();live.reset();const r=Pitch.detectPitch(frame(440),sr,{resolveHarmonics:true});
  assert.equal(live.update(r,2000).accepted,old.update({...r,hz:r.originalHz},2000).accepted);
  }
});
