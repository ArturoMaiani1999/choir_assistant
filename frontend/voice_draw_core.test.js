const assert = require('node:assert/strict');
const test = require('node:test');
const Draw = require('./voice_draw_core.js');

test('square and diamond paths can be completed with confident pitch', () => {
  for (const name of Object.keys(Draw.SHAPES)) {
    const session = Draw.create(name, 60);
    const points = Draw.SHAPES[name].points;
    for (let edge = 0; edge < points.length - 1; edge += 1) {
      for (let step = 0; step <= 24; step += 1) {
        const fraction = step / 24;
        session.x = points[edge][0] + (points[edge + 1][0] - points[edge][0]) * fraction;
        Draw.update(session, { midi: 60 + points[edge][1] + (points[edge + 1][1] - points[edge][1]) * fraction, confidence: .9, seconds: .08 });
      }
    }
    assert.equal(session.finished, true, `${name} must finish on returning to its start`);
    assert.equal(Draw.score(session).completed, true, name);
    assert.equal(Draw.score(session).success, true, name);
  }
});

test('a pitched rectangle uses two exact chord notes for its horizontal sides', () => {
  const session = Draw.create('square', 60, { lowMidi: 58, highMidi: 62 });
  assert.deepEqual(session.noteMidis, [58, 62]);
  assert.deepEqual(session.points.map((point) => point[1]), [2, 2, -2, -2, 2]);
  assert.equal(Draw.SHAPES.square.label, 'Rettangolo');
});

test('coverage and score do not finish the level before returning to the start', () => {
  const session = Draw.create('square', 60);
  const points = Draw.SHAPES.square.points;
  for (let edge = 0; edge < 3; edge += 1) {
    for (let step = 0; step <= 24; step += 1) {
      const fraction = step / 24;
      session.x = points[edge][0] + (points[edge + 1][0] - points[edge][0]) * fraction;
      Draw.update(session, { midi: 60 + points[edge][1] + (points[edge + 1][1] - points[edge][1]) * fraction, confidence: .9, seconds: .08 });
    }
  }
  const result = Draw.score(session);
  assert.ok(result.coverage >= .75);
  assert.ok(result.score > Draw.SCORE_THRESHOLD);
  assert.equal(result.completed, false);
  assert.equal(result.success, false);
  assert.equal(session.finished, false);
});

test('returning to the start completes the figure but only a score above the threshold passes it', () => {
  const session = Draw.create('square', 60);
  session.leftStart = true;
  session.insideSeconds = 5;
  session.outsideSeconds = 5;
  session.bins = new Set(Array.from({ length: 24 }, (_, index) => index));
  session.x = Draw.SHAPES.square.points[0][0];
  const result = Draw.update(session, { midi: 60 + Draw.SHAPES.square.points[0][1], confidence: .9, seconds: 0 });
  assert.equal(result.completed, true);
  assert.equal(result.score, .5);
  assert.equal(result.success, false, 'the score must be strictly above the threshold');
  assert.equal(result.finished, true);
});

test('standing still cannot complete a drawing; unreliable or distant pitch is outside', () => {
  const session = Draw.create('square', 60);
  for (let i = 0; i < 600; i += 1) Draw.update(session, { midi: 62.7, confidence: .9, seconds: .1 });
  assert.equal(Draw.score(session).success, false);
  assert.ok(Draw.score(session).coverage < .75);
  const other = Draw.create('diamond', 60);
  Draw.update(other, { midi: 63.2, confidence: .1, seconds: .1 });
  Draw.update(other, { midi: 74, confidence: .9, seconds: .1 });
  assert.equal(other.outsideSeconds, .2);
});

test('time ratio is inside divided by outside, strictly above one half', () => {
  const session = Draw.create('square', 60);
  session.insideSeconds = 4; session.outsideSeconds = 8;
  assert.equal(Draw.score(session).ratio, .5);
  assert.equal(Draw.score(session).success, false);
});
