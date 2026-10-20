'use strict';

// Reproducible local CPU benchmark and bounded tuning. No score or network.
// node scripts/pitch_research.js --synthetic --out artifacts/pitch-research/synthetic.json
// node scripts/pitch_research.js --manifest local-manifest.json --out report.json
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const Lab = require('../frontend/pitch_lab_core.js');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function syntheticFixture(id, split, seed, baseHz, noise) {
  const rate = 16000, duration = 3, hop = 512 / rate, audio = new Float32Array(rate * duration);
  let phase = 0;
  const voicedAt = t => t >= .3 && t < 1.35 || t >= 1.65 && t < 2.65;
  // Deliberate off-note + vibrato: the reference is the oscillator, never a score.
  const hzAt = t => baseHz * 2 ** ((37 + 45 * Math.sin(2 * Math.PI * 5.2 * t)) / 1200);
  for (let i = 0; i < audio.length; i += 1) {
    const t = i / rate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    phase += 2 * Math.PI * hzAt(t) / rate;
    audio[i] = (voicedAt(t) ? .12 * (Math.sin(phase) + .3 * Math.sin(2 * phase)) : 0) + noise * (seed / 2 ** 31 - 1);
  }
  const truth = [];
  for (let startSec = 0; startSec < duration; startSec += hop) {
    const endSec = Math.min(duration, startSec + hop), center = (startSec + endSec) / 2;
    // Exclude windows spanning synthetic onset/offset; there is no unique F0
    // for a mixed frame. Excluded spans remain unknown, not false silence.
    if ([.3, 1.35, 1.65, 2.65].some(edge => Math.abs(center - edge) < .08)) continue;
    truth.push({ startSec, endSec, hz: voicedAt(center) ? hzAt(center) : null });
  }
  return { id, groupId: id, split, audio, sampleRate: rate, truth, referenceKind: 'synthetic-oscillator' };
}

function syntheticCorpus() {
  return [syntheticFixture('train-low', 'train', 11, 110, .04),
    syntheticFixture('train-tenor', 'train', 19, 220, .05), syntheticFixture('train-high', 'train', 31, 440, .03),
    syntheticFixture('validation', 'validation', 113, 293.665, .05),
    syntheticFixture('test-low', 'test', 137, 146.832, .045), syntheticFixture('test-high', 'test', 173, 880, .04)];
}

function loadManifest(filename) {
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!Array.isArray(manifest.recordings) || !manifest.recordings.length) throw new Error('Manifest requires recordings');
  const root = path.dirname(path.resolve(filename));
  const entries = manifest.recordings.map(entry => {
    if (!entry.id || !entry.groupId || !['train', 'validation', 'test', 'diagnostic'].includes(entry.split)) throw new Error('id, groupId and split required');
    const bytes = fs.readFileSync(path.resolve(root, entry.pcm));
    if (bytes.length % 4 || !(entry.sampleRate > 0)) throw new Error('Expected mono float32le PCM and sampleRate');
    const audio = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (!audio.every(Number.isFinite)) throw new Error('Nonfinite PCM');
    const annotation = entry.truth ? JSON.parse(fs.readFileSync(path.resolve(root, entry.truth), 'utf8')) : null;
    if (annotation?.audioSha256 && annotation.audioSha256 !== sha(bytes)) throw new Error('Annotation belongs to another PCM');
    const truth = annotation ? Lab.normalizeTruth(Array.isArray(annotation) ? annotation : annotation.frames) : [];
    if (truth.length && !['manual-acoustic', 'independent-instrument', 'synthetic-oscillator'].includes(entry.referenceKind)) throw new Error('Declare an independent acoustic referenceKind');
    return { ...entry, audio, truth, sampleRate: Number(entry.sampleRate) };
  });
  return { entries, config: manifest.config };
}

function benchmark(entries, config = Lab.preset('pyin-default'), options = {}) {
  const hashes = new Map(), groups = new Map(), ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error('Duplicate recording id'); ids.add(entry.id);
    const hash = sha(Buffer.from(entry.audio.buffer, entry.audio.byteOffset, entry.audio.byteLength));
    entry.audioSha256 = hash;
    for (const [map, key] of [[hashes, hash], [groups, entry.groupId]]) {
      if (map.has(key) && map.get(key) !== entry.split) throw new Error('Train/held-out leakage: PCM or recording group crosses splits');
      map.set(key, entry.split);
    }
  }
  const configs = Lab.tuningConfigs(config);
  const started = performance.now();
  const recordings = entries.map(entry => {
    const batch = Lab.analyzeBatch(entry.audio, entry.sampleRate, configs, { metadata: { audioHash: `sha256:${entry.audioSha256}` } });
    options.resultSink?.(entry, batch.results);
    return { id: entry.id, groupId: entry.groupId, split: entry.split, referenceKind: entry.referenceKind || null,
      audioSha256: entry.audioSha256, sampleRate: entry.sampleRate, sampleCount: entry.audio.length,
      durationSec: entry.audio.length / entry.sampleRate, annotatedIntervals: entry.truth.length,
      performance: batch.performance, ...Lab.rankExperiments(batch.results, entry.truth) };
  });
  const meanScores = split => configs.map((_, index) => {
    const rows = recordings.filter(row => row.split === split), scores = rows.map(row => row.evaluations[index].metrics);
    const complete = scores.length > 0 && scores.every(metric => metric.acousticAccuracy?.evaluatedFrames > 0);
    if (!complete) return { index, recordingCount: rows.length, quality: null, objective: null };
    // Pool acoustic counts: noise-only control recordings must contribute
    // false positives, even though they cannot individually define recall/F0.
    const sum = key => scores.reduce((total, metric) => total + (metric.acousticAccuracy[key] || 0), 0);
    const tp = sum('truePositiveFrames'), fp = sum('falsePositiveFrames'), fn = sum('falseNegativeFrames');
    const pitched = sum('pitchReferenceFrames'), matched = sum('pitchDetectedFrames');
    const weighted = (key, denominatorKey) => scores.reduce((total, metric) => total
      + (metric.acousticAccuracy[key] || 0) * (metric.acousticAccuracy[denominatorKey] || 0), 0);
    const acoustic = { voicedReferenceFrames: sum('voicedReferenceFrames'), unvoicedReferenceFrames: sum('unvoicedReferenceFrames'),
      pitchReferenceFrames: pitched, truePositiveFrames: tp, falsePositiveFrames: fp, falseNegativeFrames: fn,
      voicingF1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null,
      rawPitchAccuracy50: pitched ? weighted('rawPitchAccuracy50', 'pitchReferenceFrames') / pitched : null,
      grossPitchErrorRate: matched ? weighted('grossPitchErrorRate', 'pitchDetectedFrames') / matched : null,
      octaveErrorRate: matched ? weighted('octaveErrorRate', 'pitchDetectedFrames') / matched : null };
    const realtimeFactor = scores.reduce((total, metric) => total + metric.processingMs, 0)
      / (1000 * rows.reduce((total, row) => total + row.durationSec, 0));
    const evaluation = Lab.evaluateObjective({ acousticAccuracy: acoustic, realtimeFactor });
    return { index, recordingCount: rows.length, acousticAccuracy: acoustic, realtimeFactor,
      quality: evaluation.quality, objective: evaluation.eligible && scores.every(metric => metric.realtimeFactor <= 1) ? evaluation.objective : null };
  });
  const train = meanScores('train'), validation = meanScores('validation'), test = meanScores('test');
  const winner = train.filter(row => row.objective != null).sort((a, b) => b.objective - a.objective)[0];
  const compare = scores => winner && scores[winner.index]?.objective != null ? {
    baselineIndex: 0, selectedIndex: winner.index, baseline: scores[0], selected: scores[winner.index],
    qualityDelta: scores[winner.index].quality - scores[0].quality } : null;
  return { schemaVersion: 1, algorithmVersion: Lab.ALGORITHM_VERSION, createdAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model },
    processingMs: performance.now() - started, configs, objectiveDefinition: Lab.TUNING_OBJECTIVE,
    selectedIndex: winner?.index ?? null, selectionSplit: 'train', train, validation, test,
    validationComparison: compare(validation), testComparison: compare(test), recordings,
    conclusion: winner ? 'Candidate chosen on train only; inspect validation/test and reference provenance before adoption.'
      : 'Diagnostic only: no independent positive/negative/F0 training reference; no winner selected.' };
}

function main() {
  const args = process.argv.slice(2), arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  const manifest = arg('--manifest');
  if (!manifest && !args.includes('--synthetic')) throw new Error('Use --synthetic or --manifest FILE, and --out FILE');
  const corpus = manifest ? loadManifest(manifest) : { entries: syntheticCorpus() };
  const framesOut = arg('--frames-out');
  if (framesOut) fs.mkdirSync(path.resolve(framesOut), { recursive: true });
  const report = benchmark(corpus.entries, corpus.config, { resultSink: framesOut ? (entry, results) => {
    const safeId = entry.id.replace(/[^a-z0-9_-]/gi, '_');
    results.forEach((result, index) => fs.writeFileSync(path.join(path.resolve(framesOut), `${safeId}-${index}.json`), JSON.stringify(result)));
  } : null });
  const destination = arg('--out');
  if (!destination) throw new Error('--out FILE required');
  fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: destination, selectedIndex: report.selectedIndex,
    validation: report.validationComparison, heldOut: report.testComparison, conclusion: report.conclusion }, null, 2));
}

module.exports = { syntheticFixture, syntheticCorpus, loadManifest, benchmark };
if (require.main === module) main();
