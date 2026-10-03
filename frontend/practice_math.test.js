const assert = require('node:assert/strict');
const math = require('./practice_math.js');

assert.ok(Math.abs(math.hzToPitch(440) - 69) < 1e-10, 'A4 maps to MIDI 69');
assert.ok(Math.abs(math.hzToPitch(880) - 81) < 1e-10, 'octave is 12 semitones');
assert.equal(math.pitchToName(69), 'A4');
assert.equal(math.pitchToName(66), 'F♯4');
assert.ok(Math.abs(math.centsBetween(440 * Math.pow(2, 20 / 1200), 440) - 20) < 1e-9);

const yA = math.pitchToY(69, 60, 72, 10, 250);
const yASharp = math.pitchToY(70, 60, 72, 10, 250);
const yHighA = math.pitchToY(81, 72, 84, 10, 250);
const yHighASharp = math.pitchToY(82, 72, 84, 10, 250);
assert.ok(Math.abs((yA - yASharp) - (yHighA - yHighASharp)) < 1e-9, 'all semitones use equal distance');

const nowX = math.timeToX(12, 12, 50, 1250, 4.5, 7.5);
assert.equal(nowX, 500, 'NOW is 37.5% of plot width');
assert.equal(math.timeToX(13, 12, 50, 1250, 4.5, 7.5) - nowX, 100, 'one beat has stable width');

assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(math.melodicIntervalLabel), [null, '2', '3m', '3M', '4', null, '5']);
assert.equal(math.melodicIntervalLabel(-3), '3m', 'descending intervals use the same label');
const intervalEvents = [
  { onsetBeat: 0, durationBeats: 1, midiPitch: 60 },
  { onsetBeat: 1, durationBeats: 1, midiPitch: 61 },
  { onsetBeat: 2, durationBeats: 1, midiPitch: 64 },
  { onsetBeat: 3.5, durationBeats: .5, midiPitch: 59 },
  { onsetBeat: 4, durationBeats: 1, midiPitch: 64 },
];
assert.deepEqual(math.adjacentMelodicIntervals(intervalEvents).map(({ label, direction }) => ({ label, direction })), [
  { label: '3m', direction: 1 },
  { label: '4', direction: 1 },
], 'only supported intervals between notes without a rest are annotated');

const measures = [
  { startBeat: 0, endBeat: 3 },
  { startBeat: 3, endBeat: 6 },
  { startBeat: 6, endBeat: 9 },
];
assert.deepEqual(math.measureSeekState(measures, 2), { selectedIndex: 2, playbackStart: 3, scoringStart: 6 });
assert.deepEqual(math.measureSeekState(measures, 0), { selectedIndex: 0, playbackStart: 0, scoringStart: 0 });

const twoTwoGrid = math.rhythmGridLines([
  { number: 1, startBeat: 0, endBeat: 4, timeSignatureDenominator: 2 },
  { number: 2, startBeat: 4, endBeat: 8, timeSignatureDenominator: 2 },
], 0, 8);
assert.deepEqual(twoTwoGrid.filter((line) => line.kind === 'measure').map((line) => line.beat), [0, 4, 8]);
assert.deepEqual(twoTwoGrid.filter((line) => line.kind === 'beat').map((line) => line.beat), [2, 6]);
assert.deepEqual(twoTwoGrid.filter((line) => line.kind === 'subdivision').map((line) => line.beat), [1, 3, 5, 7]);
const pickupGrid = math.rhythmGridLines([
  { number: 1, startBeat: 0, endBeat: 1, timeSignatureDenominator: 4, beatOffset: 5 },
], 0, 1);
assert.equal(pickupGrid.find((line) => line.kind === 'measure').label, 'B. 1 · 6');
const smooth = math.smoothPitchBounds({ min: 50, max: 60 }, { min: 60, max: 70 }, 90, 180);
assert.ok(smooth.bounds.min > 50 && smooth.bounds.min < 60 && smooth.animating, 'pitch viewport interpolates without jumping');

console.log('practice_math: rhythmic grid assertions passed');
