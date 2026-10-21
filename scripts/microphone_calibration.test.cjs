const { test } = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../frontend/pitch_detector.js');
const Core = require('../frontend/microphone_calibration.js');
const detector = global.ChoirPitch;
const base = Core.settings();
const tracker = { fastAlpha: .65, slowAlpha: .65, medianWindowFrames: 3 };

function features(options = {}) {
  return Array.from({ length: Core.DURATION_SEC * 50 }, (_, index) => {
    const timeSec = index * .02, stage = Core.STAGES.find(s => timeSec >= s.start && timeSec < s.end);
    const voiced = stage.voiced;
    return { timeSec, rms: voiced ? options.voiceRms ?? .01 : options.noiseRms ?? .00001,
      hz: voiced ? 277.183 : options.noiseHz ?? null,
      clarity: voiced ? options.clarity ?? .7 : .95, clippedFraction: 0 };
  });
}

test('unified 22-second voice guide keeps independent soft-voice and quiet validation',()=>{
  const frames=Array.from({length:1100},(_,i)=>{
    const timeSec=i*.02,stage=Core.AUDIO_STAGES.find(s=>timeSec>=s.start&&timeSec<s.end);
    return {timeSec,rms:stage.voiced?(stage.split==='train'?.08:.04):.00001,
      hz:stage.voiced?246.94:null,clarity:.99,clippedFraction:0};
  });
  const result=Core.evaluate(frames,base,tracker,detector,true);
  assert.ok(result.selected);
  assert.equal(result.evaluations[result.selectedIndex].validation.recall,1);
  assert.equal(Core.evaluate(frames.filter(f=>f.timeSec<15||f.timeSec>=19),base,tracker,detector,true).reason,'capture-incomplete');
  assert.equal(Core.evaluate(frames.map(f=>({...f,hz:null})),base,tracker,detector,true).selected,null);
});

test('fits a quality gate on train and verifies a second independent guided interval', () => {
  const result = Core.evaluate(features(), base, tracker, detector);
  assert.equal(result.status, 'candidate');
  assert.equal(result.selected.minConfidence, .2);
  assert.equal(result.evaluations[0].train.recall, 0);
  assert.equal(result.evaluations[result.selectedIndex].validation.recall, 1);
  assert.equal(result.evaluations[result.selectedIndex].validation.specificity, 1);
  assert.equal(result.selected.yinThreshold, base.yinThreshold);
  assert.equal(result.selected.weakSignalHoldFrames, base.weakSignalHoldFrames);
  assert.equal(result.selected.smallJumpCents, undefined);
  assert.equal(result.reference, 'guided-weak-labels');
});

test('retains an already good baseline instead of choosing needless changes', () => {
  const result = Core.evaluate(features({ clarity: .99 }), base, tracker, detector);
  assert.equal(result.status, 'baseline');
  assert.equal(result.selectedIndex, 0);
  assert.deepEqual(result.selected, base);
});

test('does not tune to validation or choose a runner-up after validation failure', () => {
  const frames = features(), good = Core.evaluate(frames, base, tracker, detector);
  const failed = Core.evaluate(frames.map(f => Core.labelAt(f.timeSec)?.voiced && Core.labelAt(f.timeSec)?.split === 'validation' ? { ...f, hz: null } : f), base, tracker, detector);
  assert.equal(failed.status, 'retry');
  assert.equal(failed.selected, null);
  assert.deepEqual(failed.evaluations.map(e => e.settings), good.evaluations.map(e => e.settings));
});

test('raises the energy gate to reject periodic environmental interference', () => {
  const result = Core.evaluate(features({ noiseRms: .001, noiseHz: 110, voiceRms: .01, clarity: .99 }), base, tracker, detector);
  assert.equal(result.status, 'candidate');
  assert.equal(result.selectedIndex, 1);
  assert.equal(result.selected.rmsThreshold, .002);
  assert.equal(result.evaluations[0].train.specificity, 0);
  assert.equal(result.evaluations[1].validation.specificity, 1);
});

test('refuses silence, poor separation, clipping, missing phases and interrupted cadence', () => {
  assert.equal(Core.evaluate(features({ voiceRms: 0, noiseRms: 0 }), base, tracker, detector).selected, null);
  assert.equal(Core.evaluate(features({ voiceRms: .001, noiseRms: .001 }), base, tracker, detector).reason, 'insufficient-separation');
  assert.equal(Core.evaluate(features().map(f => ({ ...f, clippedFraction: .02 })), base, tracker, detector).reason, 'clipping');
  assert.equal(Core.evaluate(features().filter(f => f.timeSec < 6), base, tracker, detector).reason, 'capture-incomplete');
  assert.equal(Core.evaluate(features().filter(f => f.timeSec < 3 || f.timeSec > 3.5), base, tracker, detector).reason, 'capture-incomplete');
});

test('treats boundaries as unknown and preserves vibrato or a freely chosen note', () => {
  assert.equal(Core.labelAt(11.1), null); assert.equal(Core.labelAt(16.1), null);
  const f = features({ clarity: .99 }).map(f => ({ ...f, hz: f.hz ? 220 * 2 ** (.5 * Math.sin(f.timeSec * 30) / 12) : null }));
  const result = Core.evaluate(f, base, tracker, detector);
  assert.equal(result.status, 'baseline');
  assert.equal(result.evaluations[0].validation.recall, 1);
});

test('extracts the actual live detector on identical PCM without an amplitude gate', () => {
  const pcm = Float32Array.from({ length: 2048 }, (_, i) => .01 * Math.sin(2 * Math.PI * 246.94 * i / 48000));
  const extracted = Core.extractFrames([{ timeSec: 2.5, pcm }], 48000, base, detector);
  assert.ok(Math.abs(1200 * Math.log2(extracted[0].hz / 246.94)) < 10);
  assert.ok(extracted[0].rms > .006);
  assert.throws(() => Core.extractFrames([{ timeSec: 0, pcm: new Float32Array([NaN]) }], 48000, base, detector));
});

test('isolates profiles by user, input/chain and version without a calendar expiry', () => {
  const now = 1000000, profile = { version: Core.VERSION, detectorVersion: Core.DETECTOR_VERSION,
    scope: 'user-A', chain: 'input-A', createdAt: now, quality: { noise95: .001 }, settings: base };
  assert.ok(Core.validProfile(profile, 'user-A', 'input-A', now));
  assert.equal(Core.validProfile(profile, 'user-B', 'input-A', now), false);
  assert.equal(Core.validProfile(profile, 'user-A', 'input-B', now), false);
  assert.equal(Core.validProfile(profile, 'user-A', 'input-A', now + 365 * 86400000), true);
  assert.equal(Core.validProfile(profile, 'user-A', 'input-A', now - 1), false);
  assert.equal(Core.validProfile({ ...profile, version: Core.VERSION - 1 }, 'user-A', 'input-A', now), false);
  assert.equal(Core.validProfile({ ...profile, settings: { minConfidence: NaN } }, 'user-A', 'input-A', now), false);
  assert.equal(Core.chainSettings({ deviceId: 'private', groupId: 'private' }, 48000).deviceId, undefined);
});

test('reuse requires a fresh complete quiet sample with compatible noise', () => {
  const quiet = features({ noiseRms: .00001 }).filter(f => f.timeSec < Core.REUSE_DURATION_SEC);
  const profile = { quality: { noise95: .00001 }, settings: base };
  assert.equal(Core.verifyNoise(quiet, profile, detector), true);
  assert.equal(Core.verifyNoise(quiet.slice(0, 20), profile, detector), false);
  assert.equal(Core.verifyNoise(quiet.map(f => ({ ...f, rms: .001 })), profile, detector), false);
});

test('end-to-end synthetic PCM separates a periodic background from a free sung note', () => {
  const sampleRate = 48000;
  const captured = Array.from({ length: Core.DURATION_SEC * 50 }, (_, index) => {
    const timeSec = index * .02;
    const pcm = Float32Array.from({ length: 2048 }, (_, i) => {
      const t = timeSec + (i - 1024) / sampleRate;
      const amplitude = t >= 11 && t < 16 ? .02 : t >= 23 && t < 27 ? .01 : 0;
      return .0008 * Math.sin(2 * Math.PI * 100 * t) + amplitude * Math.sin(2 * Math.PI * 220 * t);
    });
    return { timeSec, pcm };
  });
  const extracted = Core.extractFrames(captured, sampleRate, base, detector);
  const result = Core.evaluate(extracted, base, tracker, detector);
  assert.equal(result.status, 'candidate');
  assert.ok(result.selected.rmsThreshold > base.rmsThreshold);
  assert.ok(result.evaluations[result.selectedIndex].validation.balancedAccuracy >= .98);
  assert.ok(result.evaluations[0].validation.balancedAccuracy < .6);
});

test('gives every action a countdown and excludes preparation from fitting and validation', () => {
  assert.equal(Core.DURATION_SEC, 30);
  assert.equal(Core.REUSE_DURATION_SEC, 8);
  Core.STAGES.forEach((stage, i) => {
    assert.equal(stage.start, i ? Core.STAGES[i - 1].end : 0);
    assert.ok(stage.end - stage.start >= 3);
    assert.ok(stage.instruction && stage.hint);
    if (stage.voiced === null) assert.equal(Core.labelAt((stage.start + stage.end) / 2), null);
  });
  const initial = features({ clarity: .99 });
  const breathing = initial.map(f => Core.STAGES.find(s => f.timeSec >= s.start && f.timeSec < s.end).voiced === null
    ? { ...f, rms: .1, hz: 440 } : f);
  const clean = Core.evaluate(initial, base, tracker, detector), noisy = Core.evaluate(breathing, base, tracker, detector);
  assert.equal(clean.status, noisy.status);
  assert.deepEqual(clean.quality, noisy.quality);
  assert.deepEqual(clean.selected, noisy.selected);
  assert.deepEqual(clean.evaluations.map(e => e.train), noisy.evaluations.map(e => e.train));
  const missingQuiet = features().filter(f => f.timeSec < 4.5 || f.timeSec >= 7.5);
  assert.equal(Core.verifyNoise(missingQuiet.filter(f => f.timeSec < 8), { quality: { noise95: .00001 }, settings: base }, detector), false);
});
