const assert = require('node:assert/strict');

global.window = global;
require('./pitch_detector.js');

const { PitchSmoother } = global.ChoirPitch;
const estimate = (hz, clarity = 0.9, confidence = 0.9) => ({ hz, rms: 0.08, clarity, confidence });
const cents = (hz, reference) => 1200 * Math.log2(hz / reference);
const frame = (smoother, hz, index) => smoother.update(estimate(hz), index * 20);

{
  const smoother = new PitchSmoother();
  const frames = [440, 440, 440].map((hz, index) => frame(smoother, hz, index));
  assert.equal(frames.at(-1).accepted, true, 'stable pitch is accepted after warm-up');
}

{
  const smoother = new PitchSmoother();
  [440, 440, 440].forEach((hz, index) => frame(smoother, hz, index));
  const spike = frame(smoother, 880, 3);
  const recovered = frame(smoother, 440, 4);
  assert.equal(spike.accepted, false, 'isolated high octave spike is held');
  assert.equal(spike.rejectionReason, 'octave-transition');
  assert.ok(Math.abs(cents(spike.hz, 440)) < 25, 'held display remains near prior pitch');
  assert.equal(recovered.accepted, true, 'return to stable pitch resumes immediately');
}

{
  const smoother = new PitchSmoother();
  [440, 440, 440].forEach((hz, index) => frame(smoother, hz, index));
  const spike = frame(smoother, 220, 3);
  const recovered = frame(smoother, 440, 4);
  assert.equal(spike.accepted, false, 'isolated low octave spike is held');
  assert.equal(recovered.accepted, true, 'low octave recovery resumes immediately');
}

{
  const smoother = new PitchSmoother();
  [440, 440, 440].forEach((hz, index) => frame(smoother, hz, index));
  const changes = [880, 880, 880, 880, 880].map((hz, index) => frame(smoother, hz, index + 3));
  assert.equal(changes.slice(0, -1).every((result) => !result.accepted), true, 'octave waits for coherent frames');
  assert.equal(changes.at(-1).accepted, true, 'real octave is eventually accepted');
  assert.ok(Math.abs(cents(changes.at(-1).hz, 880)) < 15, 'accepted octave has expected pitch');
}

{
  const smoother = new PitchSmoother();
  [440, 440, 440].forEach((hz, index) => frame(smoother, hz, index));
  const step = frame(smoother, 493.883, 3);
  assert.equal(step.accepted, true, 'small melodic movement is accepted without delay');
}

{
  const smoother = new PitchSmoother();
  [440, 440, 440].forEach((hz, index) => frame(smoother, hz, index));
  const uncertain = smoother.update(estimate(440, 0.3, 0.2), 80);
  assert.equal(uncertain.accepted, false, 'low confidence is not published');
  assert.equal(uncertain.rejectionReason, 'low-confidence');
}

console.log('pitch_detector: octave robustness assertions passed');
