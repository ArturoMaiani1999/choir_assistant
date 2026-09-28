// Prints the versioned v1 synthetic baseline. Redirecting is intentionally left
// to CI/review tooling so updating the checked-in JSON remains an explicit act.
global.window = global;
require('../frontend/pitch_detector.js');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, fixtures, DEFAULT_ANALYSIS, METRIC_POLICY } = require('../frontend/pitch_test_harness.js');

const definitions = [
  ['steady-220', fixtures.steadyTone({ hz: 220 })],
  ['step-small-200c', fixtures.stepChange({ fromHz: 220, toHz: 220 * 2 ** (200 / 1200) })],
  ['step-medium-700c', fixtures.stepChange({ fromHz: 220, toHz: 220 * 2 ** (700 / 1200) })],
  ['step-octave-1200c', fixtures.stepChange({ fromHz: 220, toHz: 440 })],
  ['vibrato-220', fixtures.vibratoTone({ hz: 220, depthCents: 50, rateHz: 5 })],
  ['harmonic-rich-220', fixtures.harmonicRichTone({ hz: 220 })],
  ['silence-gap-220', fixtures.silenceGap({ hz: 220 })],
];

const synthetic = {};
for (const [id, fixture] of definitions) {
  const harness = createHarness(global.ChoirPitch);
  const takeId = harness.loadSyntheticTake(fixture.pcm, fixture.sampleRate, fixture.groundTruth, fixture.metadata);
  const result = harness.runAlgorithm(takeId, 'v1');
  synthetic[id] = {
    sampleRate: fixture.sampleRate,
    durationSec: fixture.pcm.length / fixture.sampleRate,
    trackedPitch: harness.getMetrics(takeId, 'v1', 'trackedPitch'),
    streamSha256: createHash('sha256').update(JSON.stringify(result.trackedPitch)).digest('hex'),
  };
}

const baselinePath = path.resolve(__dirname, '..', 'baseline_v1_metrics.json');
let existingReal = {};
if (fs.existsSync(baselinePath)) existingReal = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).real ?? {};
const baseline = {
  schemaVersion: 1,
  generatedAt: '2026-09-27',
  algorithm: 'v1',
  analysis: DEFAULT_ANALYSIS,
  metricPolicy: METRIC_POLICY,
  synthetic,
  real: existingReal,
};
if (process.argv.includes('--verify')) {
  const expected = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  if (JSON.stringify(expected.synthetic) !== JSON.stringify(baseline.synthetic)) throw new Error('Synthetic v1 baseline changed');
  if (!Object.keys(expected.real ?? {}).length) throw new Error('Real v1 baseline missing');
  console.log('pitch v1 baseline verified');
} else console.log(JSON.stringify(baseline, null, 2));
