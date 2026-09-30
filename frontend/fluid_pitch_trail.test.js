const assert = require('node:assert/strict');
const fluid = require('./fluid_pitch_trail.js');

const samples = Array.from({ length: 121 }, (_, index) => ({
  time: index * .025,
  displayPitch: 60 + .25 * Math.sin(index * .025 * Math.PI * 5),
  confidence: .9,
  takeId: 1,
}));
const geometry = fluid.trailGeometry(samples, sample => sample.time * 200, pitch => 100 - (pitch - 60) * 20,
  { currentTime: 3, nowX: 600, trailStartX: 0, sortedTimeline: true });
assert.ok(geometry.vertexCount > 100, 'continuous strip contains the voiced trajectory');
assert.equal(geometry.vertices.length, geometry.vertexCount * 8);
assert.ok([...geometry.vertices].every(Number.isFinite), 'GPU attributes are finite');
assert.equal(geometry.strips, 1);

const firstTop = geometry.vertices.slice(0, 8), firstBottom = geometry.vertices.slice(8, 16);
assert.ok(Math.abs(Math.hypot(firstTop[0] - firstBottom[0], firstTop[1] - firstBottom[1]) - fluid.CONFIG.ribbonWidth * .45) < .01,
  'the transparent cap narrows before it joins the full ribbon');
assert.equal(firstTop[2], 1); assert.equal(firstBottom[2], -1);
assert.ok(firstTop[4] < geometry.vertices.at(-3), 'fluid energy fades continuously toward the past');
assert.ok(firstTop[5] >= firstTop[4], 'centerline survives at least as long as the fluid interior');
assert.equal(firstTop[7], 0, 'the ribbon starts transparent instead of with a cut edge');
assert.ok(geometry.vertices[16 * 40 + 7] > .9, 'the middle of a long ribbon is fully visible');
assert.equal(geometry.vertices.at(-1), 1, 'the live head stays visible');
const corner = fluid.smoothPoints([{x:0,y:0,time:0,confidence:1},{x:10,y:10,time:1,confidence:1},{x:20,y:0,time:2,confidence:1}], 1);
assert.ok(corner.every(point => point.y >= 0 && point.y <= 10), 'smoothing cannot overshoot detected pitch geometry');
const rightAngle = [{x:0,y:20},{x:20,y:20},{x:20,y:0}];
const join = fluid.joinOffset(rightAngle, 1, 7, 1.5);
assert.ok(Math.hypot(join.x, join.y) <= 7 * 1.5 + 1e-9, 'acute joins obey the miter limit');
assert.ok(join.x > 0 && join.y > 0, 'join bisects both adjacent segment normals');

const abruptSamples = [
  {time:0,displayPitch:55,confidence:.9,takeId:1}, {time:.1,displayPitch:58,confidence:.9,takeId:1},
  {time:.2,displayPitch:60,confidence:.9,takeId:1}, {time:.3,displayPitch:60.05,confidence:.9,takeId:1},
  {time:.4,displayPitch:60,confidence:.9,takeId:1},
];
const abrupt = fluid.trailGeometry(abruptSamples, sample => sample.time * 300, pitch => 160 - pitch * 2,
  { currentTime: .4, nowX: 120, trailStartX: 0, sortedTimeline: true });
for (let index = 0; index < abrupt.vertices.length; index += 16) {
  const width = Math.hypot(abrupt.vertices[index] - abrupt.vertices[index + 8], abrupt.vertices[index + 1] - abrupt.vertices[index + 9]);
  assert.ok(width <= fluid.CONFIG.ribbonWidth * fluid.CONFIG.joinLimit + .01, 'sharp transition cannot create a ribbon spike');
}

const glitch = [
  {time:0,displayPitch:60,confidence:.9,takeId:1},
  {time:.05,displayPitch:60,confidence:.9,takeId:1},
  {time:.1,displayPitch:61.5,confidence:.9,takeId:1},
  {time:.15,displayPitch:60,confidence:.9,takeId:1},
  {time:.2,displayPitch:60,confidence:.9,takeId:1},
];
const softened = fluid.trailGeometry(glitch, sample => sample.time * 400, pitch => 200 - pitch * 2,
  { currentTime: .2, nowX: 80, trailStartX: 0, sortedTimeline: true });
const centerY = [];
for (let index = 0; index < softened.vertices.length; index += 16)
  centerY.push((softened.vertices[index + 1] + softened.vertices[index + 9]) / 2);
assert.ok(Math.max(...centerY) - Math.min(...centerY) < .2, 'one-frame return spike is softened visually');
const splitBySpike = glitch.map((sample, index) => index === 2 ? { ...sample, displayPitch: 64 } : sample);
const rejoinedSpike = fluid.trailGeometry(splitBySpike, sample => sample.time * 400, pitch => 200 - pitch * 2,
  { currentTime: .2, nowX: 80, trailStartX: 0, sortedTimeline: true });
assert.equal(rejoinedSpike.strips, 1, 'a single extreme reading does not leave two chopped ends');

const brieflyLost = [...glitch.slice(0, 2), {time:.1,displayPitch:null,confidence:0,takeId:1},
  ...glitch.slice(3)];
const joined = fluid.trailGeometry(brieflyLost, sample => sample.time * 400, pitch => 200 - pitch * 2,
  { currentTime: .2, nowX: 80, trailStartX: 0, sortedTimeline: true });
assert.equal(joined.strips, 1, 'a short detector dropout at the same pitch reconnects smoothly');
const review = fluid.trailGeometry(samples, sample => sample.time * 200, pitch => 100 - (pitch - 60) * 20,
  { currentTime: 3, nowX: 600, trailStartX: 0, sortedTimeline: true, mode: 'review' });
assert.equal(review.vertices.at(-1), 0, 'an old segment ends transparently in review');

const gapped = [...samples.slice(0, 30), ...samples.slice(80)];
const split = fluid.trailGeometry(gapped, sample => sample.time * 200, pitch => 100 - (pitch - 60) * 20,
  { currentTime: 3, nowX: 600, trailStartX: 0, sortedTimeline: true });
assert.equal(split.strips, 2, 'silence is never bridged by ribbon geometry');

const stale = fluid.trailGeometry(samples, sample => sample.time * 200, pitch => pitch,
  { currentTime: 20, nowX: 600, trailStartX: 0, sortedTimeline: true });
assert.equal(stale.vertexCount, 0, 'live history is bounded');
assert.equal(fluid.CONFIG.enabled, true);
assert.equal(fluid.CONFIG.filamentCount, 3);
console.log('fluid pitch trail: geometry, local coordinates, fade and gaps passed');
