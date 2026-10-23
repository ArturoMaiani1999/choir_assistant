const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MediaElementMixer}=require('../frontend/media_mixer.js');

class Media extends EventTarget {
  constructor(ready=3){super();this.readyState=ready;this.currentTime=2;this.paused=true;this.seeking=false;this.plays=0;}
  play(){this.plays++;this.paused=false;return Promise.resolve();}
  pause(){this.paused=true;}
  load(){}
}
function fixture(){const m=new MediaElementMixer();m.resume=async()=>true;return m;}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('no SATB channel starts before the accompaniment can play',async()=>{
  const m=fixture(),organ=new Media(1),voice=new Media();
  voice.currentTime=0;
  const play=m.playTogether([organ,voice]);await tick();
  assert.equal(organ.plays,0);assert.equal(voice.plays,0);assert.equal(m.startingGroup,true);
  organ.readyState=3;organ.dispatchEvent(new Event('canplay'));await play;
  assert.equal(organ.plays,1);assert.equal(voice.plays,1);assert.equal(voice.currentTime,2);
  assert.equal(m.startingGroup,false);
});
test('cancelled preparation cannot start audio when a late canplay arrives',async()=>{
  const m=fixture(),organ=new Media(1),voice=new Media();
  const play=m.playTogether([organ,voice]);await tick();m.cancelGroupStart();
  organ.readyState=3;organ.dispatchEvent(new Event('canplay'));await play;
  assert.equal(organ.plays,0);assert.equal(voice.plays,0);
});
test('decoder failure leaves all channels paused',async()=>{
  const m=fixture(),organ=new Media(1),voice=new Media();
  const play=m.playTogether([organ,voice]);await tick();organ.dispatchEvent(new Event('error'));
  await assert.rejects(play,/traccia audio/);assert.equal(voice.plays,0);assert.equal(m.startingGroup,false);
});
test('clock jitter cannot trigger destructive seeks on a voice stem',()=>{
  const m=fixture(),organ=new Media(),voice=new Media();organ.paused=voice.paused=false;
  for(let i=0;i<20;i++){
    voice.currentTime=organ.currentTime+(i%2?.11:-.11);m.synchronize(organ,[voice],i*150);
    assert.ok(Math.abs(voice.currentTime-organ.currentTime)>.1);
  }
  voice.currentTime=2.02;m.synchronize(organ,[voice],3100);assert.equal(voice.currentTime,2.02);
});
test('confirmed same-direction drift is corrected after three spaced observations',()=>{
  const m=fixture(),organ=new Media(),voice=new Media();organ.paused=voice.paused=false;
  voice.currentTime=2.06;m.synchronize(organ,[voice],0);m.synchronize(organ,[voice],150);
  assert.equal(voice.currentTime,2.06);m.synchronize(organ,[voice],301);assert.equal(voice.currentTime,2);
});
