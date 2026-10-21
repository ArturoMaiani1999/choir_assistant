const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

const YAW_SPEED=.0225*5/3*1.3, YAW_START=.67+20.8*(.0225-YAW_SPEED);
const TARGET=(Math.PI-Math.atan(1/3)-YAW_START)/YAW_SPEED;
const REVOLUTION=2*Math.PI/YAW_SPEED;

function fixture(options={home:true}) {
  const raf=new Map(), listeners=new Map();let id=0,now=0,eyes=0;
  const listen={addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);}};
  const motion={...listen,matches:false};
  const strokes=[];let lines=0,pathStart,pathEnd;
  const ctx=new Proxy({quadraticCurveTo(){eyes++;},createLinearGradient:()=>({addColorStop(){}}),
    beginPath(){lines=0;},moveTo(x,y){pathStart=[x,y];},lineTo(x,y){lines++;pathEnd=[x,y];},
    stroke(){strokes.push({lines,cap:ctx.lineCap,start:pathStart,end:pathEnd});}},
    {get:(target,key)=>target[key]||(()=>{})});
  const canvas={dataset:{},getContext:()=>ctx,getBoundingClientRect:()=>({width:400,height:400})};
  const glow={...canvas,dataset:{}};
  const sandbox={window:{...listen},document:{...listen,hidden:false,createElement:()=>({...canvas,dataset:{}})},matchMedia:()=>motion,
    getComputedStyle:()=>({getPropertyValue:name=>name==='--home-voice'?'#71cddc':'#efc277'}),
    devicePixelRatio:1,innerWidth:1366,
    requestAnimationFrame:fn=>{raf.set(++id,fn);return id;},cancelAnimationFrame:n=>raf.delete(n),
    ResizeObserver:class{observe(){}disconnect(){}},IntersectionObserver:class{observe(){}disconnect(){}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/lissajous.js'),'utf8'),sandbox);
  const scene=sandbox.window.Lissajous.create(canvas,glow,options);
  function step(ms) {now+=ms;const pending=[...raf.values()];raf.clear();for(const fn of pending)fn(now);}
  step(0);
  return {scene,step,raf,motion,listeners,sandbox,canvas,strokes,eyes:()=>eyes,
    nearTrigger(){scene.state.time=TARGET-.3;step(100);step(400);}};
}

test('calibrated yaw has upright cyan/ochre lobes sharing their central tangent',()=>{
  const yaw=YAW_START+TARGET*YAW_SPEED;
  assert.ok(Math.abs(Math.cos(yaw)+3*Math.sin(yaw))<1e-14);
  for(let i=1;i<100;i++) {
    const t=i/100*Math.PI;
    const x=Math.sin(t)*Math.cos(yaw)+Math.sin(3*t)*Math.sin(yaw);
    const opposite=Math.sin(t+Math.PI)*Math.cos(yaw)+Math.sin(3*(t+Math.PI))*Math.sin(yaw);
    assert.ok(x<0 && opposite>0);
  }
});

test('tangent configuration holds every temporal phase for 5000 ms, then resumes smoothly',()=>{
  const f=fixture(),s=f.scene.state;
  f.step(34690);assert.equal(s.duet.phase,'ROTATING');
  f.step(10);assert.equal(s.duet.phase,'DUET');assert.equal(s.time,TARGET);
  assert.equal(s.duet.count,1);
  assert.ok(s.duet.elapsedMs<1);
  const startEyes=f.eyes();f.step(1000-s.duet.elapsedMs);
  assert.equal(s.time,TARGET);assert.ok(f.eyes()>startEyes);
  f.step(3999);assert.equal(s.duet.phase,'DUET');assert.equal(s.time,TARGET);
  f.step(1.001);assert.equal(s.duet.phase,'RESUMING');assert.ok(Math.abs(s.time-TARGET)<1e-9);
  f.step(10);assert.ok(s.time>TARGET && s.time-TARGET<.0001);
  f.step(490);assert.equal(s.duet.phase,'ROTATING');
  const resumed=s.time;f.step(1000);assert.ok(Math.abs(s.time-resumed-1)<1e-9);
  assert.equal(s.duet.count,1);
});

test('dropped frames cross boundaries once and rearm only on the next full turn',()=>{
  const f=fixture(),s=f.scene.state;
  s.time=TARGET-.3;f.step(3000);
  assert.equal(s.duet.phase,'DUET');assert.equal(s.duet.count,1);assert.equal(s.time,TARGET);
  f.step(6000);assert.equal(s.duet.phase,'ROTATING');assert.equal(s.duet.count,1);
  f.step((TARGET+REVOLUTION-s.time)*1000+201);
  assert.equal(s.duet.phase,'DUET');assert.equal(s.duet.count,2);
  assert.ok(Math.abs(s.time-TARGET-REVOLUTION)<1e-9);
});

test('frame rate does not change the duet clock',()=>{
  function run(steps) {
    const f=fixture();f.scene.state.time=TARGET-.3;
    for(const ms of steps)f.step(ms);
    return [f.scene.state.time,f.scene.state.duet.phase,f.scene.state.duet.elapsedMs];
  }
  const slow=run([1743]),fast=run(Array(249).fill(7));
  assert.equal(slow[0],fast[0]);assert.equal(slow[1],fast[1]);
  assert.ok(Math.abs(slow[2]-fast[2])<1e-8);
});

test('pause, inactive view and background preserve the duet and discard suspended time',()=>{
  const f=fixture(),s=f.scene.state;f.nearTrigger();f.step(1200);
  const held=s.duet.elapsedMs;
  f.scene.setPaused(true);f.step(10000);assert.equal(s.duet.elapsedMs,held);
  f.scene.setPaused(false);f.step(10000);assert.equal(s.duet.elapsedMs,held);
  f.scene.setActive(false);f.step(10000);assert.equal(s.duet.elapsedMs,held);
  f.scene.setActive(true);f.step(10000);assert.equal(s.duet.elapsedMs,held);
  f.sandbox.document.hidden=true;f.listeners.get('visibilitychange')();f.step(10000);
  f.sandbox.document.hidden=false;f.listeners.get('visibilitychange')();f.step(10000);
  assert.equal(s.duet.elapsedMs,held);f.step(100);assert.equal(s.duet.elapsedMs,held+100);
  f.scene.destroy();assert.equal(f.raf.size,0);assert.equal(f.listeners.size,0);
});

test('reduced motion clears faces and explicit resume still skips all added motion',()=>{
  const f=fixture(),s=f.scene.state;f.nearTrigger();f.step(1000);
  f.motion.matches=true;f.listeners.get('change')({matches:true});
  assert.equal(s.paused,true);assert.equal(s.duet.phase,'ROTATING');
  const before=f.eyes();f.scene.setPaused(false);f.step(0);f.step(10000);
  assert.equal(f.eyes(),before);assert.equal(s.duet.count,1);assert.equal(s.time,TARGET+10);
});

test('leaving reduced motion after a skipped crossing never rewinds the curve',()=>{
  const f=fixture(),s=f.scene.state;
  s.time=TARGET-1;f.motion.matches=true;f.listeners.get('change')({matches:true});
  f.scene.setPaused(false);f.step(0);f.step(10000);
  const current=s.time;assert.ok(current>TARGET);
  f.motion.matches=false;f.listeners.get('change')({matches:false});f.step(1000);
  assert.ok(Math.abs(s.time-current-1)<1e-9);assert.equal(s.duet.count,0);
});

test('Relax and the opt-out keep their original uninterrupted clock',()=>{
  for(const options of [{home:false},{home:true,duet:{duetEnabled:false}}]) {
    const f=fixture(options);f.scene.state.time=TARGET-.3;f.step(10000);
    assert.equal(f.scene.state.time,TARGET+9.7);assert.equal(f.scene.state.duet.count,0);
    assert.equal(f.eyes(),0);
  }
});

test('point advances at half the former rate while the camera rotates 30% faster',()=>{
  for(const home of [true,false]) {
    const f=fixture({home}),beforePoint=Number(f.canvas.dataset.headParameter),beforeYaw=Number(f.canvas.dataset.cameraYaw);
    f.step(1000);
    const pointDelta=Number(f.canvas.dataset.headParameter)-beforePoint;
    const yawDelta=Number(f.canvas.dataset.cameraYaw)-beforeYaw;
    assert.ok(Math.abs(pointDelta-(.5*2*Math.PI/6.4)*.5)<2e-6);
    assert.ok(Math.abs(yawDelta-(.0225*(home?5/3:1))*1.3)<2e-6);
    assert.equal(f.scene.state.time-Number(f.canvas.dataset.oldestTime),40);
  }
});

test('each filament spans a complete lobe without internal stroke boundaries',()=>{
  const f=fixture();f.strokes.length=0;f.scene.render();
  assert.equal(f.strokes.length,14);
  assert.ok(f.strokes.every(s=>s.lines===512));
  // The travelling highlight is filled separately and cannot split a stroke.
  f.step(97);assert.equal(f.strokes.length,28);
  assert.ok(f.strokes.every(s=>s.lines===512));
});

test('supersampling improves 1x desktop and native 3x mobile without unbounded memory',()=>{
  const f=fixture({home:true,compact:true});f.sandbox.devicePixelRatio=3;f.sandbox.innerWidth=390;
  f.scene.resize();assert.equal(f.canvas.width,1200);assert.equal(f.scene.state.ratio,3.75);
  f.sandbox.devicePixelRatio=1;f.scene.resize();assert.equal(f.canvas.width,400);assert.equal(f.scene.state.ratio,2);
  f.canvas.getBoundingClientRect=()=>({width:3840,height:2160});
  f.sandbox.devicePixelRatio=3;f.scene.resize();
  assert.ok(f.canvas.width*f.canvas.height<=8_010_000);
});
