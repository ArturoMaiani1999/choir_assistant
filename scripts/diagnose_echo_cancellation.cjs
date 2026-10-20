// Reproduce failure modes of the frozen speaker model. No user audio or network.
// node scripts/diagnose_echo_cancellation.cjs [report.json]
// These are controlled examples, NOT measurements of Arturo's phone or Santo.
const fs = require('node:fs');
const nodePath = require('node:path');
const assert = require('node:assert/strict');
const Echo = require('../frontend/echo_cancellation.js');
const Shared = require('../frontend/pitch_shared.js');
global.window = {};
require('../frontend/pitch_detector.js');
const Pitch = window.ChoirPitch;
const sr = 48000, length = sr * 3, frameSize = 2048, hop = 800;
const path = [[721, .45], [1185, -.12], [5700, .08]];
const impulse = new Float32Array(6000);
for (const [delay, gain] of path) impulse[delay] = gain;
const reference = new Float32Array(sr * 14);
reference.set(Echo.noise(sr * 6, .08, 173), sr * 4);
reference.set(Echo.noise(sr * 2, .08, 957), sr * 11);
function room(input, gain = 1, shift = 0) {
  const output = new Float32Array(input.length);
  for (const [delay, coefficient] of path) {
    for (let i = delay + shift; i < output.length; i++) output[i] += input[i - delay - shift] * coefficient * gain;
  }
  return output;
}
const profile = Echo.fit(reference, room(reference), sr);
assert.ok(profile.usable, 'The baseline calibration must pass before testing drift.');
// A fixed level-dependent speaker is present during BOTH calibration and play.
// The weak probe can pass while louder notes/clicks operate in a different regime.
const limiter = .08;
const limitedProfile = Echo.fit(reference, room(Float32Array.from(reference, v => limiter * Math.tanh(v / limiter))), sr);
assert.ok(limitedProfile.usable, 'The nonlinear example must genuinely pass its own weak calibration.');
const rms = x => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const rounded = n => Math.round(n * 1e5) / 1e5;
function metronome() {
  const output = new Float32Array(length);
  // Same frequency and gain envelopes as playMetronomeClick(), volume 100%.
  for (let pulse = 0; pulse < 6; pulse++) {
    const accented = pulse % 4 === 0, f0 = accented ? 1120 : 820, f1 = accented ? 760 : 570;
    const peak = accented ? .5 : .34, duration = accented ? .075 : .055;
    const k = Math.log(f1 / f0) / .045;
    for (let i = 0; i < .08 * sr; i++) {
      const t = i / sr;
      const phase = t <= .045 ? f0 * Math.expm1(k * t) / k
        : f0 * Math.expm1(k * .045) / k + f1 * (t - .045);
      const gain = peak * Math.exp(Math.log(.0001 / peak) * Math.min(t / duration, 1));
      output[pulse * sr / 2 + i] += gain * Math.sin(2 * Math.PI * phase);
    }
  }
  return output;
}
const tone = Float32Array.from({ length }, (_, i) => .12 * Math.sin(2 * Math.PI * 220 * i / sr));
const click = metronome();
const music = Float32Array.from({ length }, (_, i) => {
  const f = [220, 246.94165, 293.66477, 261.62557][Math.floor(i / (sr * .75))];
  return .12 * Math.sin(2 * Math.PI * f * i / sr);
});
function evaluate(name, signal, { gain = 1, shift = 0, limit = null, voice = 0 } = {}) {
  const model = limit ? limitedProfile : profile;
  const driven = limit ? Float32Array.from(signal, v => limit * Math.tanh(v / limit)) : signal;
  const echo = room(driven, gain, shift), prediction = Echo.convolve(signal, model.impulse);
  const cleaned = Float32Array.from(echo, (v, i) => v - prediction[i] + voice * Math.sin(2 * Math.PI * 220 * i / sr + .7));
  const tracker = new Pitch.PitchSmoother(Shared.DETECTOR_DEFAULTS);
  tracker.configure(Shared.recognitionSettings());
  let held = 0, heldAt = 0, frames = 0, rawVoiced = 0, accepted = 0, wrong = 0;
  const pitches = [];
  for (let end = frameSize; end <= length; end += hop) {
    const now = end / sr * 1000, predictedRms = rms(prediction.subarray(end - frameSize, end));
    const next = 2 * predictedRms * 10 ** (-model.validationDb / 20);
    if (next >= held || now - heldAt > 300) { held = next; heldAt = now; }
    // Same scalar gate as activeRecognitionSettings(); ideal time alignment.
    const settings = { ...Shared.recognitionSettings() };
    if (Math.min(.01, held) > settings.rmsThreshold) {
      settings.levelConfidenceFloor = .36;
      settings.rmsThreshold = Math.min(.01, held);
    }
    const estimate = Pitch.detectPitch(cleaned.subarray(end - frameSize, end), sr, settings);
    const tracked = tracker.update(estimate, now); frames++;
    if (estimate.hz) rawVoiced++;
    if (tracked.accepted && tracked.hz) {
      accepted++;
      const cents = 1200 * Math.log2(tracked.hz / 220);
      if (voice && Math.abs(cents) > 100) wrong++;
      pitches.push(tracked.hz);
    }
  }
  return { name, calibrationValidationDb: rounded(model.validationDb), gain, shiftSamples: shift, shiftMs: shift / sr * 1000, limiter: limit, voiceAmplitude: voice,
    reductionDb: rounded(Echo.reduction(echo, prediction)), residualRms: rounded(rms(Float32Array.from(echo, (v, i) => v - prediction[i]))),
    frames, rawVoiced, accepted, wrongVoiceFramesOver100c: voice ? wrong : null,
    acceptedHzRange: pitches.length ? [rounded(Math.min(...pitches)), rounded(Math.max(...pitches))] : null };
}
const scenarios = [];
for (const [label, signal] of [['tone', tone], ['metronome', click], ['changing-notes', music]]) {
  for (const [change, options] of [['unchanged', {}], ['gain-x2', { gain: 2 }],
    ['delay-1-sample', { shift: 1 }], ['delay-128-samples', { shift: 128 }], ['soft-limiter', { limit: limiter }]]) {
    scenarios.push(evaluate(`${label}/${change}`, signal, options));
  }
}
// A fixed singer plus a stronger whole-tone-above residual can change the YIN minimum.
const upperNote = Float32Array.from({ length }, (_, i) => .12 * Math.sin(2 * Math.PI * 246.94165 * i / sr));
scenarios.push(evaluate('steady-voice/same-F0-unchanged', tone, { voice: .03 }));
scenarios.push(evaluate('steady-voice/upper-note-gain-x2', upperNote, { gain: 2, voice: .03 }));
scenarios.push(evaluate('steady-voice/metronome-delay-128', click, { shift: 128, voice: .03 }));
function trackerExcursion(spikeFrames, medianWindowFrames = 3) {
  const tracker = new Pitch.PitchSmoother({ ...Shared.DETECTOR_DEFAULTS, medianWindowFrames });
  tracker.configure(Shared.recognitionSettings());
  const estimates = [];
  for (let i = 0; i < 40; i++) {
    const hz = i >= 10 && i < 10 + spikeFrames ? 220 * 2 ** (2 / 12) : 220;
    const out = tracker.update({ hz, rms: .04, clarity: .99, confidence: .99 }, i * 1000 / 60);
    estimates.push(out.accepted ? 1200 * Math.log2(out.hz / 220) : null);
  }
  return { spikeFrames, medianWindowFrames,
    maxAcceptedDeviationCents: rounded(Math.max(...estimates.filter(Number.isFinite))),
    framesOver50c: estimates.filter(v => v != null && Math.abs(v) > 50).length };
}
const report = { kind: 'synthetic-diagnosis-not-user-measurements', sampleRate: sr, frameSize, hop,
  calibration: { trainDb: profile.trainDb, validationDb: profile.validationDb, peakDelayMs: profile.peakDelayMs },
  assumptions: ['Fixed linear room; ideal frame alignment for the scalar residual gate.',
    'System gain and delay changes happen AFTER calibration.',
    'Soft limiter models level dependence even without changing volume after calibration.',
    'Metronome uses the app envelopes at maximum metronome slider.',
    'No score, expected note, saved take, phone model or actual Santo audio is used.'],
  scenarios, tracker: [trackerExcursion(1), trackerExcursion(2), trackerExcursion(3), trackerExcursion(1, 1)] };
assert.equal(scenarios.find(s => s.name === 'tone/unchanged').accepted, 0);
assert.ok(scenarios.find(s => s.name === 'tone/gain-x2').accepted > 0);
assert.ok(scenarios.find(s => s.name === 'tone/soft-limiter').accepted > 0);
assert.equal(scenarios.find(s => s.name === 'metronome/unchanged').accepted, 0);
assert.ok(scenarios.find(s => s.name === 'steady-voice/same-F0-unchanged').accepted > 0);
assert.equal(report.tracker[0].maxAcceptedDeviationCents, 0);
assert.ok(report.tracker[1].maxAcceptedDeviationCents > 100);
const json = JSON.stringify(report, null, 2) + '\n';
if (process.argv[2]) {
  fs.mkdirSync(nodePath.dirname(process.argv[2]), { recursive: true });
  fs.writeFileSync(process.argv[2], json);
}
console.log(json);
