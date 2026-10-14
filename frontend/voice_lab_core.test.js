const assert = require('node:assert/strict');
const lab = require('./voice_lab_core.js');

assert.deepEqual(lab.TEMPOS, [60, 80, 100]);
assert.equal(lab.COUNT_IN_BEATS, 4);
assert.equal(lab.midiToHz(69), 440);
assert.equal(lab.midiToName(65), 'Fa4');
assert.equal(lab.pattern('scale-major').degreeLabels.join(','), '1,2,3,4,5,4,3,2,1');
assert.deepEqual(lab.pattern('scale-major').semitoneOffsets, [0, 2, 4, 5, 7, 5, 4, 2, 0]);
assert.deepEqual(lab.pattern('triad-major-root').semitoneOffsets, [0, 4, 7, 4, 0]);
assert.deepEqual(lab.pattern('triad-minor-root').semitoneOffsets, [0, 3, 7, 3, 0]);
assert.deepEqual(lab.pattern('triad-major-root').degreeLabels, ['1', '3M', '5', '3M', '1']);
assert.deepEqual(lab.pattern('triad-minor-root').degreeLabels, ['1', '3m', '5', '3m', '1']);
assert.deepEqual(lab.pattern('triad-major-first').semitoneOffsets, [4, 7, 12, 7, 4]);
assert.deepEqual(lab.pattern('triad-minor-second').semitoneOffsets, [7, 12, 15, 12, 7]);
assert.equal(lab.pattern('triad-major-first').bassDegree, 3);
assert.equal(lab.pattern('triad-minor-second').inversion, 'second');
assert.deepEqual(lab.TRIAD_INVERSIONS, ['root', 'first', 'second']);
assert.equal(lab.INVERSION_LABELS.first, 'primo rivolto');
assert.deepEqual(lab.DEGREE_LEVELS.base, ['2', '3', '4', '5']);
assert.equal(lab.DEGREE_TARGETS.length, 12);
assert.equal(lab.pattern('degree-sharp4-flat5').degreeLabels[0], '♯4 / ♭5');
assert.deepEqual(lab.pattern('degree-8').semitoneOffsets, [12]);
assert.deepEqual(lab.pattern('degree-2').durationBeats, [4]);
assert.throws(() => lab.pattern('unknown'), /sconosciuto/);
assert.equal(lab.validateRange({ lowMidi: 48, highMidi: 67 }), true);
assert.equal(lab.validateRange({ lowMidi: 70, highMidi: 60 }), false);

const scale60 = lab.buildExercise({ patternId: 'scale-major', rootMidi: 53, bpm: 60, mode: 'model' });
assert.equal(scale60.rootName, 'Fa3');
assert.equal(scale60.previewBpm, 60);
assert.equal(scale60.previewSeconds, 9);
assert.equal(scale60.countInSeconds, 4);
assert.equal(scale60.durationSeconds, 9);
assert.equal(scale60.events.length, 9);
assert.deepEqual(scale60.events.map((event) => event.midi), [53, 55, 57, 58, 60, 58, 57, 55, 53]);
assert.equal(scale60.events.at(-1).beat, 8);
assert.equal(scale60.targetVisibleDuringTake, true);

const inner = lab.buildExercise({ patternId: 'triad-minor-root', rootMidi: 53, bpm: 80, mode: 'inner-ear' });
assert.equal(inner.previewSeconds, 1.5);
assert.equal(inner.durationSeconds, 3.75);
assert.equal(inner.targetVisibleDuringTake, false);
assert.deepEqual(inner.events.map((event) => event.degree), ['1', '3m', '5', '3m', '1']);

for (const [role, range] of Object.entries(lab.ROLE_RANGES)) {
  for (const bpm of lab.TEMPOS) {
    const routine = lab.buildRoutine({ family: 'scale', bpm, mode: 'model', range });
    assert.equal(routine.exercises.length, 1, `${role} ${bpm} starts with one user-controlled take`);
    const base = routine.exercises[0];
    assert.equal(base.rootMidi % 12, 5);
    for (let step = 1; step <= lab.MAX_ASCENT_SEMITONES; step += 1) {
      const transposed = lab.transposeExercise(base, step, range);
      assert.ok(transposed, `${role} ${bpm} supports +${step}`);
      assert.equal(transposed.rootMidi, base.rootMidi + step);
      assert.ok(transposed.events.every((event) => event.midi >= range.lowMidi && event.midi <= range.highMidi));
    }
  }
}
assert.equal(lab.transposeExercise(scale60, 1, { lowMidi: 53, highMidi: 60 }), null);

const slow = lab.buildRoutine({ family: 'scale', bpm: 80, mode: 'inner-ear', range: lab.ROLE_RANGES.tenor });
assert.equal(slow.exercises.length, 1);
assert.equal(slow.exercises[0].rootMidi % 12, 5);
const arpeggios = lab.buildRoutine({ family: 'arpeggio', bpm: 100, mode: 'model', range: lab.ROLE_RANGES.alto });
assert.equal(arpeggios.exercises.length, 4);
assert.deepEqual(arpeggios.exercises.map((exercise) => exercise.quality), ['major', 'minor', 'major', 'minor']);
assert.ok(arpeggios.exercises.every((exercise) => exercise.rootMidi === arpeggios.exercises[0].rootMidi));
assert.ok(arpeggios.exercises.every((exercise) => exercise.inversion === 'root'));
for (const [role, range] of Object.entries(lab.ROLE_RANGES)) {
  for (const inversion of lab.TRIAD_INVERSIONS) {
    const routine = lab.buildRoutine({ family: 'arpeggio', bpm: 80, mode: 'inner-ear', range, inversion });
    assert.equal(routine.exercises.length, 4, `${role} ${inversion} has four alternating trials`);
    assert.deepEqual(routine.exercises.map((exercise) => exercise.quality), ['major', 'minor', 'major', 'minor']);
    assert.ok(routine.exercises.every((exercise) => exercise.inversion === inversion));
    assert.ok(routine.exercises.flatMap((exercise) => exercise.events)
      .every((event) => event.midi >= range.lowMidi && event.midi <= range.highMidi));
  }
  const complete = lab.buildRoutine({ family: 'arpeggio', bpm: 60, mode: 'model', range, inversion: 'all' });
  assert.equal(complete.exercises.length, 12, `${role} complete inversion routine`);
  assert.deepEqual([...new Set(complete.exercises.map((exercise) => exercise.inversion))], ['root', 'first', 'second']);
}
assert.throws(() => lab.buildRoutine({ family: 'arpeggio', inversion: 'third' }), /Rivolto/);
assert.throws(() => lab.buildRoutine({ family: 'degree', mode: 'model' }), /Orecchio interno/);
assert.throws(() => lab.buildRoutine({ family: 'degree', mode: 'inner-ear', degreeLevel: 'expert' }), /Livello/);
for (const [role, range] of Object.entries(lab.ROLE_RANGES)) {
  const base = lab.buildRoutine({ family: 'degree', bpm: 60, mode: 'inner-ear', range, degreeLevel: 'base', seed: 42 });
  const repeated = lab.buildRoutine({ family: 'degree', bpm: 60, mode: 'inner-ear', range, degreeLevel: 'base', seed: 42 });
  assert.equal(base.exercises.length, 4, `${role} base degree routine`);
  assert.deepEqual(base.exercises.map((exercise) => exercise.patternId), repeated.exercises.map((exercise) => exercise.patternId));
  assert.deepEqual(base.exercises.map((exercise) => exercise.events[0].semitoneOffset).sort((a, b) => a - b), [2, 4, 5, 7]);
  assert.ok(base.exercises.every((exercise) => exercise.mode === 'inner-ear' && exercise.level === 'base'
    && exercise.totalBeats === 4 && exercise.events[0].midi >= range.lowMidi && exercise.events[0].midi <= range.highMidi));
  const advanced = lab.buildRoutine({ family: 'degree', bpm: 100, mode: 'inner-ear', range, degreeLevel: 'advanced', seed: 7 });
  assert.equal(advanced.exercises.length, 12, `${role} chromatic degree routine`);
  assert.deepEqual(advanced.exercises.map((exercise) => exercise.events[0].semitoneOffset).sort((a, b) => a - b),
    Array.from({ length: 12 }, (_, index) => index + 1));
  assert.ok(advanced.exercises.every((exercise) => exercise.rootMidi % 12 === 5
    && exercise.events[0].midi >= range.lowMidi && exercise.events[0].midi <= range.highMidi));
}
assert.throws(() => lab.buildRoutine({ family: 'other' }), /Famiglia/);

function framesFor(exercise, errors, confidence = .9) {
  const frames = [];
  exercise.events.forEach((event, index) => {
    const bounds = lab.segmentBounds(event, exercise.bpm);
    for (let time = bounds.start; time < bounds.end; time += .025) {
      const cents = errors[index] ?? 0;
      frames.push({ time, hz: event.frequencyHz * 2 ** (cents / 1200), confidence });
    }
  });
  return frames;
}

let analysis = lab.analyseSequence(scale60, framesFor(scale60, Array(9).fill(0)));
assert.equal(analysis.reliable, true);
assert.equal(analysis.centeredSegments, 9);
assert.equal(analysis.segments.every((segment) => segment.status === 'centered'), true);
assert.match(analysis.message, /centrata/);

analysis = lab.analyseSequence(scale60, framesFor(scale60, Array(9).fill(-75)));
assert.equal(analysis.tendencies.flat, 9);
assert.ok(Math.abs(analysis.globalOffsetCents + 75) < .001);
assert.ok((analysis.relativeSpreadCents ?? 1) < .001);
assert.match(analysis.message, /calante/);

analysis = lab.analyseSequence(scale60, framesFor(scale60, Array(9).fill(0), .05));
assert.equal(analysis.reliable, false);
assert.equal(analysis.reliableSegments, 0);
assert.equal(analysis.segments.every((segment) => segment.status === 'uncertain'), true);

const saved = lab.result({ exercise: scale60, analysis: lab.analyseSequence(scale60, framesFor(scale60, Array(9).fill(0))),
  role: 'tenor', range: lab.ROLE_RANGES.tenor, durationSeconds: 9,
  deviceAndLatencyConfig: { detector: { fftSize: 4096 }, minConfidence: .7, plumeAdvanceMs: 80 } });
assert.equal(saved.schemaVersion, 2);
assert.equal(saved.exercise.patternId, 'scale-major');
assert.equal(saved.segmentResults.length, 9);
assert.equal(saved.completed, true);
assert.equal(saved.deviceAndLatencyConfig.plumeAdvanceMs, 80);

console.log('voice_lab_core: warm-up assertions passed');
