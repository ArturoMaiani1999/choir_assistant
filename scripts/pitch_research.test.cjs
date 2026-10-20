'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { benchmark, syntheticFixture } = require('./pitch_research.js');
const Lab = require('../frontend/pitch_lab_core.js');

test('rejects shared PCM and session groups across train/test', () => {
  const train = syntheticFixture('one', 'train', 7, 220, .04);
  assert.throws(() => benchmark([train, { ...train, id: 'two', groupId: 'other', split: 'test' }]), /leakage/);
  const test = syntheticFixture('two', 'test', 8, 330, .03);
  assert.throws(() => benchmark([train, { ...test, groupId: train.groupId }]), /leakage/);
});

test('all-voiced output loses to correct voicing, even with perfect F0 on voiced frames', () => {
  const config = Lab.preset('pyin-default');
  const result = tracked => ({ config, configHash: Lab.configHash(config), durationSec: 1,
    hopLength: 512, analysisSampleRate: 16000, processingMs: 1,
    frames: tracked.map((hz, i) => ({ timeSec: .1 + i * .1, rawHz: hz, trackedHz: hz })) });
  const truth = [{ startSec: 0, endSec: .35, hz: 220 }, { startSec: .35, endSec: 1, hz: null }];
  const ranking = Lab.rankExperiments([result([220,220,220,220,220]), result([220,220,220,null,null])], truth);
  assert.equal(ranking.selectedIndex, 1);
  assert.equal(ranking.evaluations[0].metrics.acousticAccuracy.voicingRecall, 1);
  assert.ok(ranking.evaluations[0].metrics.acousticAccuracy.voicingPrecision < 1);
});

test('selection uses train only and retains unseen recording metrics', () => {
  const train = syntheticFixture('train', 'train', 19, 220, .05);
  const heldOut = syntheticFixture('unseen', 'test', 137, 146.832, .045);
  const report = benchmark([train, heldOut]);
  const changed = benchmark([train, { ...heldOut, truth: heldOut.truth.map(t => ({ ...t, hz: null })) }]);
  assert.equal(report.selectedIndex, changed.selectedIndex);
  assert.equal(report.selectionSplit, 'train');
  assert.equal(report.recordings[1].split, 'test');
  assert.ok(report.testComparison);
});

test('unannotated recordings have diagnostics but never an acoustic winner', () => {
  const fixture = syntheticFixture('private', 'diagnostic', 31, 220, .05);
  const report = benchmark([{ ...fixture, truth: [] }]);
  assert.equal(report.selectedIndex, null);
  assert.equal(report.recordings[0].status, 'diagnostic-only');
  assert.ok(report.recordings[0].evaluations.every(e => e.metrics.acousticAccuracy === null));
});

test('noise-only controls contribute to pooled split metrics', () => {
  const train = syntheticFixture('voice', 'train', 11, 110, .04);
  const noise = syntheticFixture('noise', 'train', 101, 220, .05);
  // Keep only the independent noise from a deterministic synthetic source.
  let seed = 101;
  noise.audio = Float32Array.from(noise.audio, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return .05 * (seed / 2 ** 31 - 1); });
  noise.truth = [{ startSec: 0, endSec: 3, hz: null }];
  const report = benchmark([train, noise]);
  assert.notEqual(report.selectedIndex, null);
  assert.equal(report.train[1].recordingCount, 2);
  assert.ok(report.train[1].acousticAccuracy.falsePositiveFrames > report.train[2].acousticAccuracy.falsePositiveFrames);
  assert.ok(report.train[2].objective > report.train[1].objective);
});
