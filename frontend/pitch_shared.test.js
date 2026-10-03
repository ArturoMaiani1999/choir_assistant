const assert = require('node:assert/strict');
const shared = require('./pitch_shared.js');

assert.equal(shared.PREFERENCE_KEY, 'choir-detector-settings:v1');
const preferences = shared.readPreferences({ getItem: () => JSON.stringify({
  v1RmsThreshold: .002, v1WeakVoiceMode: true, v1FastAlpha: .7, v1SlowAlpha: .25, v1MedianWindowFrames: 5,
  v1PlumeWidth: 1.4, v1PlumeIntensity: .8, v1PlumeColor: '#abcdef', v1PlumeAdvanceMs: 120,
}) });
assert.deepEqual(preferences.detector, { rmsThreshold: .002, weakVoiceMode: true, fastAlpha: .7, slowAlpha: .25, medianWindowFrames: 5 });
assert.deepEqual(preferences.plume, { width: 1.4, intensity: .8, color: '#72e0d2', timeAdvanceMs: 120 });
const weakRecognition = shared.recognitionSettings(preferences.detector);
assert.equal(weakRecognition.rmsThreshold, .00003, 'weak voice caps the amplitude gate even when the saved slider is more selective');
assert.equal(weakRecognition.levelConfidenceFloor, .68, 'weak voice does not charge quiet input a second amplitude penalty');
assert.equal(weakRecognition.minClarity, .32, 'weak voice admits moderately periodic vocal input');
assert.equal(weakRecognition.weakSignalHoldFrames, 6, 'weak voice bridges about one tenth of a second at 60 Hz');
assert.equal(shared.recognitionSettings({ rmsThreshold: .002, weakVoiceMode: false }).rmsThreshold, .002,
  'normal mode preserves the user-selected RMS gate');
const frame = (time, pitch = 60, confidence = .9, takeId = 1) => ({ time, displayPitch: pitch, confidence, takeId });
const signal = (fn, count = 121, dt = .025) => Array.from({length: count}, (_,i) => frame(i*dt, fn(i*dt)));
function columns(samples, options = {}) {
  const settings = {currentTime: 3, ...options};
  const model = shared.plumeSegments(samples, p => p.time*200, settings), result = [];
  shared.visitPlumeColumns(model, 0, 600, 1, settings, (x,pitch,color,alpha) => result.push({x,pitch,color,alpha}));
  return {model, result};
}
const stable = signal(() => 60), original = JSON.stringify(stable);
const full = columns(stable);
assert.ok(full.result.length > 500);
assert.ok(full.result.every(p => p.pitch === 60));
assert.equal(JSON.stringify(stable), original, 'rendering never mutates tracker observations');
const sparse = columns(stable.filter((_,i) => i%3 === 0));
const visible = result => result.filter(p => p.alpha > .0001).map(p => ({...p,alpha:Math.round(p.alpha*255)}));
assert.deepEqual(visible(sparse.result), visible(full.result), 'moderate downsampling does not create stripes or change density');
for (const fn of [t => 60 + .35*Math.sin(t*2*Math.PI*5), t => 58 + 2*t]) {
  const samples = signal(fn), { result } = columns(samples);
  assert.ok(result.length > 500);
  for (const p of result) {
    const i = Math.min(samples.length-2, Math.floor(p.x/5)), a = samples[i].displayPitch, b = samples[i+1].displayPitch;
    assert.ok(p.pitch >= Math.min(a,b)-1e-9 && p.pitch <= Math.max(a,b)+1e-9, 'no interpolation overshoot');
  }
}
const silence = [frame(0),frame(.05),frame(.075,null),frame(.1),frame(.15)];
assert.equal(columns(silence, {mode:'review'}).model.segments.length, 2);
assert.ok(!columns(silence,{mode:'review'}).result.some(p => p.x > 10 && p.x < 20));
assert.equal(columns([frame(0),frame(.05),frame(1),frame(1.05)],{mode:'review'}).model.segments.length, 2);
assert.equal(columns([frame(0),frame(.05),frame(.1,72),frame(.15,72)],{mode:'review'}).model.segments.length, 2, 'octave jump is not a fabricated glissando');
assert.equal(columns([frame(0),frame(.05),{...frame(.075),confirmationState:'provisional'},frame(.1),frame(.15)],{mode:'review'}).model.segments.length, 2);
assert.equal(columns([frame(0),frame(.05),frame(.1,60,.1),frame(.15),frame(.2)],{mode:'review'}).model.segments.length, 2);
assert.ok(columns([frame(0,60,.14),frame(.05,60,.14)],{mode:'review',minConfidence:.12}).result.length > 0,
  'weak-voice rendering uses the configured confidence gate');
assert.equal(columns([frame(0),frame(.05),frame(.1,60,.9,2),frame(.15,60,.9,2)],{mode:'review'}).model.segments.length, 2, 'never join takes');
assert.deepEqual(shared.auroraStyle(0,1).color,[114,224,210]);
assert.ok(Math.abs(shared.auroraStyle(3,1).alpha-shared.AURORA.historyOpacity) < 1e-9);
assert.ok(Math.abs(shared.auroraStyle(600,1).alpha-shared.AURORA.historyOpacity) < 1e-9, 'old live history remains faintly visible');
assert.deepEqual(shared.auroraStyle(600,1).color,[114,224,210]);
assert.deepEqual(shared.auroraStyle(0,1,{mode:'review'}).color,shared.auroraStyle(600,1,{mode:'review'}).color, 'review has a uniform colour');
assert.deepEqual(shared.auroraStyle(0,1,{mode:'review'}).color,[114,224,210], 'review keeps the single cyan hue');
assert.ok(columns(stable).result.some(p => p.x > 15 && p.x < 40 && p.alpha > .04), 'live trace dissolves continuously instead of being hard-clipped');
assert.ok(shared.auroraStyle(.5,.4).alpha < shared.auroraStyle(.5,.9).alpha);
assert.ok(shared.auroraStyle(30,1,{mode:'review'}).alpha > 0, 'review retains full history');
assert.ok(columns(stable,{currentTime:1}).result.every(p=>p.x<=200), 'seek clips future data');
assert.deepEqual(columns([]).result, [], 'reset clears the field');
assert.deepEqual(columns(stable).result,columns(stable).result,'paused musical time freezes fade');
const long = shared.plumeSegments(signal(() => 60,24001),p=>(p.time-597)*200,
  {currentTime:600,sortedTimeline:true,viewportLeft:0,viewportRight:600});
assert.ok(long.segments.flat().length <= 123,'long take limits density work to viewport');
assert.ok(long.inspectedSamples <= 123,'binary viewport crop avoids reprocessing invisible history');

let allocations = 0, painted = null;
const surfaceContext = { createImageData(w,h) { allocations++; return {data:new Uint8ClampedArray(w*h*4)}; }, putImageData(p) {painted=p.data;} };
const canvas = {width:600,height:200,ownerDocument:{createElement:()=>({width:0,height:0,getContext:()=>surfaceContext})}};
const context = {canvas,getTransform:()=>({a:1}),save(){},restore(){},drawImage(){}};
const draw = () => shared.drawConfidencePlume(context,stable,p=>p.time*200,p=>100-(p-60)*20,56,64,{currentTime:3,nowX:600});
draw(); assert.ok(painted.some((v,i)=>i%4===3 && v>0));
draw(); assert.equal(allocations,1,'ImageData buffer reused');
canvas.width=1200; canvas.height=400; context.getTransform=()=>({a:2});
draw(); assert.equal(allocations,2,'DPR resize rebuilds physical buffer');
shared.drawConfidencePlume(context,[],p=>p.time,p=>p,0,100,{currentTime:0});
assert.ok(painted.every(v=>v===0),'reset reuses a fully cleared surface');
console.log('pitch_shared: Aurora continuity, boundaries, palette, review, timeline, DPR and reuse passed');
