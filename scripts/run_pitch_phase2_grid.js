const assert = require('node:assert/strict');

global.window = global;
require('../frontend/pitch_detector.js');
require('../frontend/one_euro_filter.js');
const { createHarness, fixtures } = require('../frontend/pitch_test_harness.js');

const frequencies = [165, 196, 220, 330, 440];
const noises = [0, .002, .006];
const rows = [];

function evaluate(fixture) {
  const harness = createHarness(global.ChoirPitch);
  const takeId = harness.loadSyntheticTake(fixture.pcm, fixture.sampleRate, fixture.groundTruth, fixture.metadata);
  const baseline = harness.runAlgorithm(takeId, 'v1');
  const displayFilter = process.env.ONE_EURO
    ? Object.fromEntries(process.env.ONE_EURO.split(',').map(pair => pair.split('=')).map(([key, value]) => [key, Number(value)]))
    : undefined;
  const candidate = harness.runAlgorithm(takeId, 'v1 + display-filter', { displayFilter });
  assert.deepEqual(candidate.trackedPitch, baseline.trackedPitch, 'display filtering leaked into TrackedPitch');
  return {
    baseline: harness.getMetrics(takeId, 'v1', 'trackedPitch'),
    candidate: harness.getMetrics(takeId, 'v1 + display-filter', 'displayPitch'),
    result: candidate,
  };
}

function vibratoAmplitude(stream, centerHz) {
  const cents = stream.filter(item => item.voiced && Number.isFinite(item.hz))
    .map(item => 1200 * Math.log2(item.hz / centerHz)).sort((a, b) => a - b);
  if (!cents.length) return 0;
  return (cents[Math.floor(cents.length * .95)] - cents[Math.floor(cents.length * .05)]) / 2;
}

for (const hz of frequencies) for (const noiseAmplitude of noises) {
  const common = { sampleRate: 16000, noiseAmplitude };
  const steady = evaluate(fixtures.steadyTone({ ...common, hz }));
  rows.push({ hz, noiseAmplitude, metric: 'jitter', baseline: steady.baseline.jitterCents, candidate: steady.candidate.jitterCents,
    pass: steady.candidate.jitterCents <= steady.baseline.jitterCents * .7 });
  for (const [metric, cents] of [['settling-small', 200], ['settling-medium', 700], ['settling-octave', 1200]]) {
    const step = evaluate(fixtures.stepChange({ ...common, fromHz: hz, toHz: hz * 2 ** (cents / 1200) }));
    rows.push({ hz, noiseAmplitude, metric, baseline: step.baseline.settlingTimeMs, candidate: step.candidate.settlingTimeMs,
      pass: step.candidate.settlingTimeMs <= step.baseline.settlingTimeMs });
    rows.push({ hz, noiseAmplitude, metric: `overshoot-${cents}`, baseline: step.baseline.overshootCents, candidate: step.candidate.overshootCents,
      pass: step.candidate.overshootCents <= step.baseline.overshootCents + 1e-9 });
  }
  const vibrato = evaluate(fixtures.vibratoTone({ ...common, hz, depthCents: 50 }));
  const baselineVibrato = vibratoAmplitude(vibrato.result.trackedPitch, hz);
  const residual = vibratoAmplitude(vibrato.result.displayPitch, hz);
  rows.push({ hz, noiseAmplitude, metric: 'vibrato', baseline: baselineVibrato, candidate: residual,
    pass: residual >= baselineVibrato * .7 });
  const harmonic = evaluate(fixtures.harmonicRichTone({ ...common, hz }));
  rows.push({ hz, noiseAmplitude, metric: 'octave-error', baseline: harmonic.baseline.octaveErrorRate,
    candidate: harmonic.candidate.octaveErrorRate, pass: harmonic.candidate.octaveErrorRate <= harmonic.baseline.octaveErrorRate });
}

const failures = rows.filter(row => !row.pass);
const grouped = Object.fromEntries([...new Set(rows.map(row => row.metric))].map(metric => {
  const selected = rows.filter(row => row.metric === metric);
  return [metric, { cases: selected.length, passed: selected.filter(row => row.pass).length,
    medianRatio: (() => { const ratios = selected.filter(row => row.baseline > 0).map(row => row.candidate / row.baseline).sort((a, b) => a - b); return ratios[Math.floor(ratios.length / 2)] ?? null; })() }];
}));
console.log(JSON.stringify({ grid: { frequencies, noises }, grouped, failures: failures.slice(0, 20) }, null, 2));
if (failures.length) process.exitCode = 1;
