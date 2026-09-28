// Adoption gate for pitch variants. Synthetic checks always run; --ci also
// requires the independently referenced real corpus introduced in phase 4.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = global;
require('../frontend/pitch_detector.js');
require('../frontend/one_euro_filter.js');
const { createHarness, fixtures } = require('../frontend/pitch_test_harness.js');

const root = path.resolve(__dirname, '..');
const algorithms = ['v1', 'v1 + display-filter'];
const frequencies = [165, 196, 220, 330, 440];
const noises = [0, .002, .006];

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function displayDifference(tracked, display) {
  const cents = tracked.map((item, index) => {
    const candidate = display[index];
    return item?.voiced && candidate?.voiced && Number.isFinite(item.hz) && Number.isFinite(candidate.hz)
      ? Math.abs(1200 * Math.log2(candidate.hz / item.hz)) : null;
  }).filter(Number.isFinite);
  const medianAbsDiffCents = percentile(cents, .5), p95AbsDiffCents = percentile(cents, .95);
  return { comparableFrames: cents.length, medianAbsDiffCents, p95AbsDiffCents,
    nonTrivial: medianAbsDiffCents >= .05 || p95AbsDiffCents >= 1 };
}

function evaluateFixture(fixture) {
  const harness = createHarness(global.ChoirPitch);
  const id = harness.loadSyntheticTake(fixture.pcm, fixture.sampleRate, fixture.groundTruth, fixture.metadata);
  const output = {};
  for (const algorithm of algorithms) {
    const result = harness.runAlgorithm(id, algorithm);
    output[algorithm] = {
      result,
      tracked: harness.getMetrics(id, algorithm, 'trackedPitch'),
      display: harness.getMetrics(id, algorithm, 'displayPitch'),
    };
  }
  assert.deepEqual(output['v1 + display-filter'].result.trackedPitch, output.v1.result.trackedPitch,
    'candidate changed scoring input');
  return output;
}

const steadyJitter = { v1: [], candidate: [] };
const settlement = { v1: [], candidate: [] };
let baselineOctaveErrors = 0, candidateOctaveErrors = 0;
let baselineLargeJumps = 0, candidateLargeJumps = 0;
for (const hz of frequencies) for (const noiseAmplitude of noises) {
  const common = { hz, noiseAmplitude, sampleRate: 16000 };
  const steady = evaluateFixture(fixtures.steadyTone(common));
  steadyJitter.v1.push(steady.v1.tracked.jitterCents);
  steadyJitter.candidate.push(steady['v1 + display-filter'].display.jitterCents);
  for (const cents of [200, 700, 1200]) {
    const step = evaluateFixture(fixtures.stepChange({ ...common, fromHz: hz, toHz: hz * 2 ** (cents / 1200) }));
    settlement.v1.push(step.v1.tracked.settlingTimeMs);
    settlement.candidate.push(step['v1 + display-filter'].display.settlingTimeMs);
    baselineLargeJumps += step.v1.tracked.largeJumpsOver700Cents;
    candidateLargeJumps += step['v1 + display-filter'].display.largeJumpsOver700Cents;
  }
  const harmonic = evaluateFixture(fixtures.harmonicRichTone(common));
  baselineOctaveErrors += harmonic.v1.tracked.octaveErrorRate;
  candidateOctaveErrors += harmonic['v1 + display-filter'].display.octaveErrorRate;
}

const syntheticSummary = {
  baseline: { jitterMedianCents: percentile(steadyJitter.v1, .5), settlingP50Ms: percentile(settlement.v1, .5),
    settlingP95Ms: percentile(settlement.v1, .95), octaveErrorRateSum: baselineOctaveErrors, largeJumps: baselineLargeJumps },
  candidate: { jitterMedianCents: percentile(steadyJitter.candidate, .5), settlingP50Ms: percentile(settlement.candidate, .5),
    settlingP95Ms: percentile(settlement.candidate, .95), octaveErrorRateSum: candidateOctaveErrors, largeJumps: candidateLargeJumps },
};
assert.ok(syntheticSummary.candidate.jitterMedianCents <= syntheticSummary.baseline.jitterMedianCents, 'jitter regressed');
assert.ok(syntheticSummary.candidate.settlingP95Ms <= syntheticSummary.baseline.settlingP95Ms, 'transition p95 regressed');
assert.ok(candidateOctaveErrors <= baselineOctaveErrors, 'octave-error rate regressed');
assert.ok(candidateLargeJumps <= baselineLargeJumps, 'large jumps regressed');

// Executable form of the non-bypassable E01/E02 rule. These signals are
// synthetic sentinels until independently referenced real recordings arrive.
const intentionalErrors = [
  ['E01', 220, 220 * 2 ** (200 / 1200)],
  ['E02', 220, 110],
].map(([id, expectedHz, sungHz]) => {
  const fixture = fixtures.steadyTone({ hz: sungHz });
  fixture.groundTruth = [{ tSec: 0, hz: expectedHz }, { tSec: fixture.pcm.length / fixture.sampleRate, hz: expectedHz }];
  const evaluated = evaluateFixture(fixture);
  const errors = algorithms.map(algorithm => ({ algorithm,
    medianErrorCents: evaluated[algorithm].tracked.medianErrorCents }));
  assert.ok(errors.every(item => item.medianErrorCents > 80), `${id}: intentional scoring error was hidden`);
  return { id, errors };
});

const corpusDirectory = path.join(root, 'pitch_corpus');
const realFiles = fs.existsSync(corpusDirectory)
  ? fs.readdirSync(corpusDirectory).filter(name => name.endsWith('.json')) : [];
const realReports = realFiles.map(name => {
  const payload = JSON.parse(fs.readFileSync(path.join(corpusDirectory, name), 'utf8'));
  assert.equal(payload.independentlyReferenced, true, `${name}: independent reference declaration missing`);
  assert.ok(Array.isArray(payload.frames) && payload.frames.length, `${name}: frames missing`);
  const record = { id: payload.id, startAudioTimeSec: 0, frames: payload.frames.map(frame => ({
    audioTimeSec: frame.tSec, trackedHz: frame.trackedHz, rawHz: frame.rawHz ?? frame.trackedHz,
    clarity: frame.clarity ?? 1, confidence: frame.confidence ?? 1,
    voicing: frame.voiced === false || !Number.isFinite(frame.trackedHz) ? 'unvoiced' : 'voiced',
    rejectionReason: frame.voiced === false ? 'unvoiced' : null,
    targetMidiPitch: Number.isFinite(frame.referenceHz) ? 69 + 12 * Math.log2(frame.referenceHz / 440) : null,
  })) };
  const harness = createHarness(global.ChoirPitch);
  const takeId = harness.loadRecordedTake(record);
  const outputs = Object.fromEntries(algorithms.map(algorithm => {
    const result = harness.runAlgorithm(takeId, algorithm);
    const stream = algorithm === 'v1' ? result.trackedPitch : result.displayPitch;
    let truePositive = 0, falsePositive = 0, falseNegative = 0, intentionalErrors = 0, intentionalCompared = 0;
    stream.forEach((item, index) => {
      const source = payload.frames[index], expectedVoiced = Number.isFinite(source.referenceHz), observedVoiced = item.voiced;
      if (expectedVoiced && observedVoiced) truePositive += 1;
      else if (!expectedVoiced && observedVoiced) falsePositive += 1;
      else if (expectedVoiced && !observedVoiced) falseNegative += 1;
      if (Number.isFinite(source.scoreTargetHz) && observedVoiced) {
        intentionalCompared += 1;
        if (Math.abs(1200 * Math.log2(item.hz / source.scoreTargetHz)) > 30) intentionalErrors += 1;
      }
    });
    return [algorithm, { ...harness.getMetrics(takeId, algorithm, algorithm === 'v1' ? 'trackedPitch' : 'displayPitch'),
      displayDifference: algorithm === 'v1 + display-filter' ? displayDifference(result.trackedPitch, result.displayPitch) : null,
      voicingPrecision: truePositive / Math.max(1, truePositive + falsePositive),
      voicingRecall: truePositive / Math.max(1, truePositive + falseNegative),
      scoringErrorRate: intentionalCompared ? intentionalErrors / intentionalCompared : null }];
  }));
  assert.ok(outputs['v1 + display-filter'].octaveErrorRate <= outputs.v1.octaveErrorRate, `${payload.id}: octave errors regressed`);
  assert.equal(outputs['v1 + display-filter'].displayDifference.nonTrivial, true,
    `${payload.id}: display filter is numerically present but substantively identical to TrackedPitch`);
  if (payload.intentionalError) assert.ok(algorithms.every(algorithm => outputs[algorithm].scoringErrorRate >= .5),
    `${payload.id}: intentional error hidden`);
  return { id: payload.id, intentionalError: Boolean(payload.intentionalError), outputs };
});
const realCorpusReady = realReports.length >= 3
  && ['E01', 'E02'].every(id => realReports.some(report => report.id.toUpperCase().includes(id)));

console.table(algorithms.map((algorithm, index) => ({ algorithm,
  jitterMedianCents: index ? syntheticSummary.candidate.jitterMedianCents : syntheticSummary.baseline.jitterMedianCents,
  settlingP50Ms: index ? syntheticSummary.candidate.settlingP50Ms : syntheticSummary.baseline.settlingP50Ms,
  settlingP95Ms: index ? syntheticSummary.candidate.settlingP95Ms : syntheticSummary.baseline.settlingP95Ms,
  largeJumps: index ? candidateLargeJumps : baselineLargeJumps })));
console.log(JSON.stringify({ intentionalErrors, realCorpus: { files: realFiles, ready: realCorpusReady, reports: realReports } }, null, 2));
if (process.argv.includes('--ci') && !realCorpusReady) {
  throw new Error('Phase 4 corpus incomplete: add at least 3 independently referenced real takes including E01 and E02');
}
