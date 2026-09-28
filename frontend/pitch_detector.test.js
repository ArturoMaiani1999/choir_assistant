const assert = require('node:assert/strict');

global.window = global;
require('./pitch_detector.js');

const { PitchSmoother, OctaveAwarePitchTracker, yinCandidates, decodeYinCandidatePath, mpmCandidates, decodeCrepeProbabilities } = global.ChoirPitch;
const estimate = (hz, clarity = 0.9, confidence = 0.9) => ({ hz, rms: 0.08, clarity, confidence });
const cents = (hz, reference) => 1200 * Math.log2(hz / reference);
const frame = (smoother, hz, index) => smoother.update(estimate(hz), index * 20);

{
  const smoother = new PitchSmoother();
  const frames = [440, 440, 440].map((hz, index) => frame(smoother, hz, index));
  assert.equal(frames.at(-1).accepted, true, 'stable pitch is accepted after warm-up');
}

{
  const tracker = new OctaveAwarePitchTracker();
  [440, 440, 440].forEach((hz, index) => frame(tracker, hz, index));
  frame(tracker, null, 3);
  const octaveAttack = frame(tracker, 220, 4);
  const recovered = frame(tracker, 440, 5);
  assert.ok(Math.abs(cents(octaveAttack.hz, 440)) < 20, 'v2 retains the prior through a short unvoiced attack gap');
  assert.equal(octaveAttack.rejectionReason, 'octave-held', 'v2 labels a held octave candidate');
  assert.ok(Math.abs(cents(recovered.hz, 440)) < 20, 'v2 returns to the stable pitch without an octave flip');
}

{
  const sampleRate = 8000;
  const buffer = Float32Array.from({ length: 1024 }, (_, index) => (
    .38 * Math.sin(2 * Math.PI * 220 * index / sampleRate)
    + .72 * Math.sin(2 * Math.PI * 440 * index / sampleRate)
  ));
  const result = yinCandidates(buffer, sampleRate);
  assert.ok(result.candidates.length >= 2, 'multi-candidate YIN retains more than one periodic hypothesis');
  assert.ok(result.candidates.some((candidate) => Math.abs(cents(candidate.hz, 220)) < 80), 'fundamental remains available among harmonic candidates');
}

{
  const sampleRate = 8000;
  const quietTone = Float32Array.from({ length: 1024 }, (_, index) => .0008 * Math.sin(2 * Math.PI * 220 * index / sampleRate));
  assert.equal(global.ChoirPitch.detectPitch(quietTone, sampleRate).hz, null, 'default RMS threshold rejects a very quiet input');
  assert.ok(Number.isFinite(global.ChoirPitch.detectPitch(quietTone, sampleRate, { rmsThreshold: .0001 }).hz), 'configurable RMS threshold can admit a quiet periodic input');
  const whisperedTone = Float32Array.from({ length: 1024 }, (_, index) => .00008 * Math.sin(2 * Math.PI * 220 * index / sampleRate));
  const whispered = global.ChoirPitch.detectPitch(whisperedTone, sampleRate, { rmsThreshold: .00001 });
  assert.ok(Number.isFinite(whispered.hz) && whispered.confidence >= .3, 'extended sensitivity admits a periodic whisper-level input to the tracker');
  const smoother = new PitchSmoother();
  const tracked = [0, 1, 2].map(index => smoother.update(whispered, index * 20));
  assert.equal(tracked.at(-1).accepted, true, 'whisper-level pitch survives detector and tracker gates');
}

{
  const probabilities = new Float32Array(360);
  probabilities[228] = .94;
  probabilities[227] = .5;
  probabilities[229] = .5;
  const result = decodeCrepeProbabilities(probabilities);
  assert.ok(Math.abs(result.confidence - .94) < 1e-6, 'CREPE decoder preserves the peak activation as confidence');
  assert.ok(result.hz > 430 && result.hz < 450, 'CREPE decoder maps the 20-cent bin grid to an A4-range frequency');
}

{
  const sampleRate = 8000;
  const buffer = Float32Array.from({ length: 1024 }, (_, index) => (
    .55 * Math.sin(2 * Math.PI * 196 * index / sampleRate)
    + .12 * Math.sin(2 * Math.PI * 392 * index / sampleRate)
  ));
  const result = mpmCandidates(buffer, sampleRate);
  assert.ok(result.candidates.length > 0, 'MPM produces a voiced candidate for a periodic tenor-range signal');
  assert.ok(Math.abs(cents(result.candidates[0].hz, 196)) < 25, 'MPM estimates the fundamental from an NSDF peak');
}

{
  const candidateFrames = [
    [{ hz: 440, cmnd: .02 }, { hz: 220, cmnd: .25 }],
    [{ hz: 440, cmnd: .02 }, { hz: 220, cmnd: .25 }],
    [{ hz: 440, cmnd: .18 }, { hz: 220, cmnd: .08 }],
    [{ hz: 440, cmnd: .18 }, { hz: 220, cmnd: .08 }],
    [{ hz: 440, cmnd: .02 }, { hz: 220, cmnd: .25 }],
    [{ hz: 440, cmnd: .02 }, { hz: 220, cmnd: .25 }],
  ].map((candidates) => ({ candidates }));
  const path = decodeYinCandidatePath(candidateFrames);
  assert.ok(path.every((candidate) => candidate.hz === 440), 'decoder rejects a brief lower harmonic excursion when the continuous path wins');
}

{
  const tracker = new OctaveAwarePitchTracker();
  [440, 440, 440].forEach((hz, index) => frame(tracker, hz, index));
  const octave = [220, 220, 220, 220, 220, 220].map((hz, index) => frame(tracker, hz, index + 3));
  assert.ok(octave.slice(0, -1).every((result) => Math.abs(cents(result.hz, 440)) < 20), 'v2 holds isolated or brief octave alternatives');
  assert.ok(Math.abs(cents(octave.at(-1).hz, 220)) < 20, 'v2 accepts a sustained genuine octave change');
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
  smoother.configure({ fastAlpha: .9, slowAlpha: .8, medianWindowFrames: 1 });
  assert.equal(smoother.fastAlpha, .9, 'tracker accepts a live-configured attack reactivity');
  assert.equal(smoother.slowAlpha, .8, 'tracker accepts a live-configured sustained reactivity');
  assert.equal(smoother.medianWindowFrames, 1, 'tracker accepts a live-configured median window');
}

{
  const smoother = new PitchSmoother();
  [440, 440, 440].forEach((hz, index) => frame(smoother, hz, index));
  const uncertain = smoother.update(estimate(440, 0.3, 0.2), 80);
  assert.equal(uncertain.accepted, false, 'low confidence is not published');
  assert.equal(uncertain.rejectionReason, 'low-confidence');
}

console.log('pitch_detector: octave robustness assertions passed');
