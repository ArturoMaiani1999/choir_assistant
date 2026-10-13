const assert = require('node:assert/strict');
const Draw = require('./voice_draw_core.js');

function place(session, x, offset, seconds = .05) {
  session.x = x;
  return Draw.update(session, { midi: session.centerMidi + offset, confidence: .95, seconds });
}

const incomplete = Draw.create('square', 60, { lowMidi: 58, highMidi: 62 });
place(incomplete, .22, 2);
for (let step = 0; step <= 10; step += 1) place(incomplete, .22, 2 - step * .4);
for (let step = 0; step <= 10; step += 1) place(incomplete, .22, -2 + step * .4);
assert.equal(incomplete.completed, false, 'returning along one side cannot close the figure');
assert.equal(incomplete.currentEdge, 0, 'the ordered path still expects the first side');

const complete = Draw.create('square', 60, { lowMidi: 58, highMidi: 62 });
const points = complete.points;
for (let edge = 0; edge < points.length - 1; edge += 1) {
  const [ax, ay] = points[edge], [bx, by] = points[edge + 1];
  for (let step = 0; step <= 10; step += 1) {
    const fraction = step / 10;
    place(complete, ax + (bx - ax) * fraction, ay + (by - ay) * fraction);
  }
}
const result = Draw.score(complete);
assert.equal(result.completed, true, 'all four sides in order close the figure');
assert.ok(result.coverage >= Draw.COMPLETION_COVERAGE);
assert.equal(result.verticesReached, 5, 'start, three intermediate vertices and the closing vertex are reached');

const timeline = Draw.createGuideTimeline(complete.points);
assert.equal(timeline.segments.length, 4, 'the square guide stops at four destination vertices');
assert.equal(timeline.profile, 'smootherstep-stop');
const first = timeline.segments[0];
assert.equal(Draw.guidePosition(timeline, first.moveStart).fraction, 0);
assert.equal(Draw.guidePosition(timeline, first.moveEnd).fraction, 1);
assert.equal(Draw.guidePosition(timeline, first.moveEnd + .1).stopped, true);
assert.ok(Draw.smootherstep(.001) < .00001, 'the guide starts with effectively zero velocity');
assert.ok(1 - Draw.smootherstep(.999) < .00001, 'the guide reaches each stop with effectively zero velocity');

console.log('voice_draw_core: assertions passed');
