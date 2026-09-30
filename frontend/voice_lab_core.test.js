const assert = require('node:assert/strict');
const lab = require('./voice_lab_core.js');

assert.equal(lab.midiToHz(69), 440);
assert.equal(lab.INTERVAL_TIMING.countInBeats, 4);
assert.equal(lab.INTERVAL_TIMING.bpm, 100);
assert.equal(lab.INTERVAL_TIMING.noteSeconds * 2, 4.8);
assert.equal(lab.INTERVAL_TIMING.countInBeats * 60 / lab.INTERVAL_TIMING.bpm, lab.INTERVAL_TIMING.noteSeconds,
  'the empty preparatory measure and each sung interval measure last equally long');
assert.equal(lab.ROLL_VISIBLE_MEASURES, 3.5);
assert.equal(lab.rollPixelsPerSecond(1400, 100), 1000 / 6,
  '3.5 four-beat measures at 100 BPM fill exactly 1400 pixels');
assert.equal(lab.rollPixelsPerSecond(700, 100), lab.rollPixelsPerSecond(1400, 100) / 2,
  'time spacing scales with the viewport, not with exercise duration');
const majorThirdHarmony = lab.planHarmony(60, { quality: 'major', targetDegree: 3 });
assert.equal(majorThirdHarmony.rootPitchClass, 8);
assert.deepEqual(majorThirdHarmony.notes.map((midi) => midi % 12), [8, 0, 3]);
assert.ok(majorThirdHarmony.notes.every((midi) => midi >= 36 && midi <= 60));
const minorFifthHarmony = lab.planHarmony(67, { quality: 'minor', targetDegree: 5 });
assert.equal(minorFifthHarmony.rootPitchClass, 0);
assert.deepEqual(new Set(minorFifthHarmony.notes.map((midi) => midi % 12)), new Set([0, 3, 7]));
assert.throws(() => lab.planHarmony(60, { quality: 'diminished' }), /Qualit/);
assert.equal(lab.generateInterval({ range: { lowMidi: 60, highMidi: 72 }, level: 2, semitones: 4, direction: 'ascending', random: () => 0 }).signedSemitones, 4);
assert.equal(lab.generateInterval({ range: { lowMidi: 48, highMidi: 72 }, level: 2, semitones: 7, direction: 'ascending', random: () => 0 }).signedSemitones, 7);
const descending = lab.generateInterval({ range: { lowMidi: 60, highMidi: 76 }, level: 2, semitones: 4, direction: 'descending', random: () => 0 });
assert.equal(descending.direction, 'descending'); assert.equal(descending.semitones, 4);
const scored = lab.generateScoredInterval({ range: { lowMidi: 48, highMidi: 67 }, role: 'tenor', level: 2, semitones: 7, direction: 'descending' });
assert.deepEqual([scored.first.midi, scored.second.midi, scored.scoreKey], [58, 51, '58-51']);
const customScored = lab.generateScoredInterval({ range: { lowMidi: 64, highMidi: 69 }, role: 'soprano', semitones: 5, direction: 'ascending' });
assert.deepEqual([customScored.first.midi, customScored.second.midi], [64, 69]);
const frameSeries = (firstCents, secondCents) => Array.from({ length: 40 }, (_, index) => {
  const first = index < 20, target = first ? 261.625565 : 329.627557, cents = first ? firstCents : secondCents;
  return { time: index * .05, hz: target * 2 ** (cents / 1200), confidence: .9 };
});
const interval = { first: { frequencyHz: 261.625565 }, second: { frequencyHz: 329.627557 }, signedSemitones: 4 };
let result = lab.analyseSungInterval(interval, frameSeries(-30, -30), 1, 2);
assert.equal(result.relativeCorrect, true); assert.ok(Math.abs(result.relativeErrorCents) < .01);
assert.equal(result.firstAbsoluteCorrect, true); assert.equal(result.secondAbsoluteCorrect, true);
assert.deepEqual(result.regions, { first: { start: .25, end: .8 }, second: { start: 1.25, end: 2 } });
result = lab.analyseSungInterval(interval, frameSeries(0, -50), 1, 2);
assert.ok(Math.abs(result.relativeErrorCents + 50) < .01);
const sustained = Array.from({ length: 41 }, (_, i) => ({ time: i / 20, hz: 440 * 2 ** ((-35 * i / 40) / 1200), confidence: .9 }));
assert.equal(lab.analyseSustained({ frequencyHz: 440 }, sustained, 2).category, 'drifting-low');
const vibrato = Array.from({ length: 81 }, (_, i) => ({ time: i / 40, hz: 440 * 2 ** ((22 * Math.sin(i / 40 * Math.PI * 10)) / 1200), confidence: .9 }));
assert.notEqual(lab.analyseSustained({ frequencyHz: 440 }, vibrato, 2).category, 'drifting-low');
assert.equal(lab.analyseSustained({ frequencyHz: 440 }, sustained.map((f) => ({ ...f, confidence: .1 })), 2).category, 'uncertain');
assert.throws(() => lab.randomNote({ lowMidi: 70, highMidi: 60 }), /non valida/);
const exercise = lab.definition({ id: 'repeat', type: 'listen-repeat', music: { midi: 60 }, expectedTimeline: [] });
assert.equal(exercise.music.midi, 60, 'same exercise keeps its musical configuration');
const session = lab.buildInitialPitchSession({ lowMidi: 48, highMidi: 67 }, () => .5);
assert.equal(session.length, 4); assert.ok(session.every((item) => item.midi >= 50 && item.midi <= 65));
const stableFrames = Array.from({ length: 45 }, (_, index) => ({ time: index * .05, hz: 440 * 2 ** ((index < 12 ? 45 : 5) / 1200), confidence: .9 }));
let progress = lab.evaluatePitchProgress({ frequencyHz: 440 }, stableFrames, 2.2);
assert.equal(progress.completed, true); assert.equal(progress.status, 'reached-with-correction');
const crossingFrames = Array.from({ length: 45 }, (_, index) => ({ time: index * .05, hz: 440 * 2 ** (((index - 22) * 8) / 1200), confidence: .9 }));
progress = lab.evaluatePitchProgress({ frequencyHz: 440 }, crossingFrames, 2.2);
assert.equal(progress.completed, false, 'crossing the target once is not stable success');
progress = lab.evaluatePitchProgress({ frequencyHz: 440 }, stableFrames.map((frame) => ({ ...frame, confidence: .1 })), 2.2);
assert.equal(progress.status, 'waiting');
const earlyOutcome = lab.pitchTrialOutcome('reached', { metrics: { reliable: false }, incrementalProgress: { completed: true, reliable: true, status: 'reached' } });
assert.equal(earlyOutcome.reliable, true, 'early completion must advance even when 30-second aggregate coverage is low');
assert.equal(earlyOutcome.acquired, true);
const uncertainOutcome = lab.pitchTrialOutcome('timeout', { metrics: { reliable: false }, incrementalProgress: { reliable: false, status: 'searching' } });
assert.equal(uncertainOutcome.reliable, false, 'an uncertain timeout must repeat the current trial');
const directionBlock = lab.buildEarTrainingBlock({ range: { lowMidi: 48, highMidi: 72 }, level: 1, random: () => .4 });
assert.equal(directionBlock.length, 6); assert.deepEqual(new Set(directionBlock.map((trial) => trial.direction)), new Set(['ascending', 'descending', 'same']));
const referenceBlock = lab.buildEarTrainingBlock({ range: { lowMidi: 48, highMidi: 72 }, level: 2, random: () => .4 });
assert.equal(referenceBlock.length, 8); assert.ok(referenceBlock.every((trial) => trial.direction === 'ascending' || trial.semitones === 0));
const mixedBlock = lab.buildEarTrainingBlock({ range: { lowMidi: 48, highMidi: 72 }, level: 3, random: () => .4 });
assert.ok(mixedBlock.some((trial) => trial.direction === 'ascending') && mixedBlock.some((trial) => trial.direction === 'descending'));
const advancedBlock = lab.buildEarTrainingBlock({ range: { lowMidi: 48, highMidi: 72 }, level: 4, random: () => .4 });
assert.equal(advancedBlock.length, 12); assert.ok(advancedBlock.every((trial) => trial.mode === 'melodic'));
const harmonicBlock = lab.buildEarTrainingBlock({ range: { lowMidi: 48, highMidi: 72 }, level: 5, random: () => .4 });
assert.equal(harmonicBlock.length, 12); assert.ok(harmonicBlock.every((trial) => trial.mode === 'harmonic'));
const withRetry = lab.scheduleEarRetry(directionBlock, 0, 3);
assert.equal(withRetry.length, 7); assert.equal(withRetry[3].retryOf, directionBlock[0].id);
const singingBlock = lab.buildSingingIntervalBlock({ range: { lowMidi: 48, highMidi: 72 }, level: 2, mode: 'construction', random: () => .4 });
assert.equal(singingBlock.length, 4); assert.ok(singingBlock.every((trial) => trial.mode === 'construction'));
assert.deepEqual(new Set(singingBlock.map((trial) => trial.interval.direction)), new Set(['ascending', 'descending']));
assert.throws(() => lab.buildSingingIntervalBlock({ range: { lowMidi: 48, highMidi: 72 }, mode: 'unknown' }), /Modalità/);
const competenceResults = Array.from({ length: 8 }, (_, index) => ({ completed: true, exerciseType: 'ear', analysis: { answerKind: 'direction', expected: ['ascending', 'descending', 'same'][index % 3], correct: index < 7, mode: 'melodic' } }));
let competencies = lab.deriveCompetencies(competenceResults);
assert.equal(competencies.melodicDirection.status, 'stabile'); assert.equal(competencies.intervalRecognition.status, 'non_iniziata');
assert.equal(lab.categoriesConsolidated(competencies.melodicDirection), true);
const sparse = lab.deriveCompetencies([{ completed: true, exerciseType: 'repeat', analysis: { completionReason: 'reached', metrics: { reliable: true, driftCents: 5 } } }]);
assert.equal(sparse.noteReproduction.status, 'in_esplorazione', 'one take cannot establish a stable competence');
const recommendation = lab.buildRecommendedSession(competenceResults, { pieceId: 'o-sacrum', partId: 'tenor' });
assert.equal(recommendation.blocks[0].activity, 'repeat'); assert.ok(recommendation.blocks.some((block) => block.activity === 'repertoire'));
const phraseScore = { parts: [{ id: 'P3', kind: 'vocal' }], measures: [{ id: 'm1', number: '7' }, { id: 'm2', number: '8' }], target_events: [
  { part_id: 'P3', written_measure_id: 'm1', onset_beats: 10, duration_beats: 1, midi_pitch: 55, lyric: 'O' },
  { part_id: 'P3', written_measure_id: 'm1', onset_beats: 11, duration_beats: 1, midi_pitch: 62, lyric: 'sa' },
  { part_id: 'P3', written_measure_id: 'm2', onset_beats: 12, duration_beats: 1, midi_pitch: 60, lyric: 'crum' },
  { part_id: 'P3', written_measure_id: 'm2', onset_beats: 13, duration_beats: 2, midi_pitch: 55, lyric: 'est.' },
] };
const phrase = lab.extractRepertoirePhrase(phraseScore, { pieceId: 'o-sacrum', partId: 'P3' });
assert.deepEqual([phrase.startMeasureIndex, phrase.endMeasureIndex, phrase.lyrics], [0, 1, 'O sa crum est.']);
assert.deepEqual(phrase.intervals, [7, -2, -5]);
const repertoireReady = [...competenceResults, ...Array.from({ length: 3 }, () => ({ completed: true, exerciseType: 'repeat', analysis: { completionReason: 'reached', metrics: { reliable: true, driftCents: 0 } } }))];
const phraseRecommendation = lab.buildRecommendedSession(repertoireReady, { pieceId: 'o-sacrum', partId: 'P3', phrase });
assert.match(phraseRecommendation.blocks.at(-1).label, /O sa crum est/);
assert.equal(phraseRecommendation.blocks[0].activity, 'sing-interval', 'repertoire relevance affects block priority');
const recentPriority = lab.competencePriority({ successRate: .5, reliableObservations: 8, lastObservedAt: Date.now() });
const stalePriority = lab.competencePriority({ successRate: .5, reliableObservations: 8, lastObservedAt: Date.now() - 30 * 86400000 });
assert.ok(stalePriority > recentPriority, 'distributed review increases with age');
const earRows = (difficulty, count, mode = 'melodic') => Array.from({ length: count }, (_, index) => ({ completed: true, exerciseType: 'ear',
  actualConfig: { difficulty }, analysis: { answerKind: 'interval', semitones: [0, 2, 3, 4, 5, 7][index % 6], correct: true, mode } }));
const advancedListening = [...repertoireReady, ...earRows(2, 8), ...earRows(3, 8), ...earRows(4, 8)];
assert.equal(lab.buildRecommendedSession(advancedListening).blocks.find((block) => block.activity === 'ear').level, 5);
const harmonicEleven = lab.deriveCompetencies([...advancedListening, ...earRows(5, 11, 'harmonic')]);
assert.notEqual(harmonicEleven.harmonicRecognition.status, 'stabile', 'harmonic mode needs twelve reliable observations');
const stableSinging = Array.from({ length: 8 }, () => ({ completed: true, exerciseType: 'sing-interval', actualConfig: { mode: 'imitation' }, analysis: { reliable: true, relativeCorrect: true } }));
assert.equal(lab.buildRecommendedSession([...repertoireReady, ...stableSinging]).blocks.find((block) => block.activity === 'sing-interval').mode, 'memory');
const stableMemory = Array.from({ length: 8 }, () => ({ completed: true, exerciseType: 'sing-interval', actualConfig: { mode: 'memory' }, analysis: { reliable: true, relativeCorrect: true } }));
assert.equal(lab.buildRecommendedSession([...repertoireReady, ...stableSinging, ...stableMemory]).blocks.find((block) => block.activity === 'sing-interval').mode, 'construction');
console.log('voice_lab_core: 63 assertions passed');
