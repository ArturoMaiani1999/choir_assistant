const assert = require('node:assert/strict');

global.window = global;
require('./pitch_detector.js');
const { createHarness, fixtures } = require('./pitch_test_harness.js');

const generated = [
  fixtures.steadyTone(),
  fixtures.stepChange({ toHz: 246.9416506 }),
  fixtures.stepChange({ toHz: 329.6275569 }),
  fixtures.stepChange({ toHz: 440 }),
  fixtures.vibratoTone(),
  fixtures.harmonicRichTone(),
  fixtures.silenceGap(),
];

for (const fixture of generated) {
  const harness = createHarness(global.ChoirPitch, { hopMs: 40 });
  const takeId = harness.loadSyntheticTake(fixture.pcm, fixture.sampleRate, fixture.groundTruth, fixture.metadata);
  const result = harness.runAlgorithm(takeId, 'v1');
  assert.ok(result.trackedPitch.length > 0, `${fixture.name}: tracked frames`);
  assert.equal(result.trackedPitch.length, result.displayPitch.length, `${fixture.name}: aligned display stream`);
  assert.equal(result.trackedPitch.length, result.confirmationStates.length, `${fixture.name}: aligned state stream`);
  assert.equal(result.trackedPitch.length, result.rawCandidates.length, `${fixture.name}: aligned raw stream`);
  assert.deepEqual(result.displayPitch, result.trackedPitch, `${fixture.name}: phase 0 passthrough is exact`);
  const metrics = harness.getMetrics(takeId, 'v1');
  for (const key of ['jitterCents', 'settlingTimeMs', 'overshootCents', 'octaveErrorRate']) {
    assert.ok(Object.hasOwn(metrics, key), `${fixture.name}: metric ${key}`);
  }
}

for (const [jumpCents, expectedProvisional] of [[200, 0], [700, 2], [1200, 4]]) {
  const fixture = fixtures.stepChange({ fromHz: 220, toHz: 220 * 2 ** (jumpCents / 1200) });
  const harness = createHarness(global.ChoirPitch, { frameSize: 1024 });
  const takeId = harness.loadSyntheticTake(fixture.pcm, fixture.sampleRate, fixture.groundTruth, fixture.metadata);
  const result = harness.runAlgorithm(takeId, 'v1');
  const provisional = result.confirmationStates.filter(item => item.state === 'provisional').length;
  assert.ok(Math.abs(provisional - expectedProvisional) <= 1,
    `${jumpCents} cents: ${provisional} provisional frames follows confirmation policy`);
}

console.log('pitch test harness tests passed');
