const assert = require('node:assert/strict');
const feedback = require('./vocal_feedback.js');

const note = { id: 'n1', onsetBeat: 0, durationBeats: 2, targetHz: 440 };
function frames(centsAt, count = 41, confidence = .9) {
  return Array.from({ length: count }, (_, index) => {
    const time = index / (count - 1);
    const cents = centsAt(time, index);
    return { beat: time * 2, time, confidence, hz: 440 * 2 ** (cents / 1200) };
  });
}
const analyse = (fn, options) => feedback.analyseNote(note, frames(fn), options);

let result = analyse(() => 0);
assert.ok(Math.abs(result.metrics.medianCents) < .01 && Math.abs(result.metrics.driftCents) < .01);
assert.equal(result.category, 'in-tune');
result = analyse(() => -30);
assert.ok(Math.abs(result.metrics.medianCents + 30) < .1 && Math.abs(result.metrics.driftCents) < .1);
assert.equal(result.category, 'stable-low');
assert.equal(analyse((time) => -40 * time).category, 'drifting-low');
assert.equal(analyse((time) => 40 * time).category, 'drifting-high');
result = analyse((time) => 25 * Math.sin(time * Math.PI * 12));
assert.ok(Math.abs(result.metrics.driftCents) < 8, 'regular vibrato is not drift');
result = analyse((time, index) => index < 5 ? 150 - index * 20 : 0);
assert.ok(Math.abs(result.metrics.medianCents) < 5, 'unstable attack is trimmed/robust');
result = feedback.analyseNote(note, frames(() => 0, 41, .1));
assert.equal(result.category, 'uncertain'); assert.equal(result.series.length, 0);
result = analyse(() => -1200);
assert.ok(result.metrics.medianCents < -1199, 'a real octave-low performance is preserved');
assert.equal(result.correctionAvailable, false, 'extreme shifts are not exposed as usable audio');
const repeated = feedback.analyseTake([
  { ...note, id: 'same-1', durationBeats: 1 },
  { ...note, id: 'same-2', onsetBeat: 1, durationBeats: 1 },
], frames((time) => time < .5 ? -25 : 25));
assert.ok(repeated[0].metrics.medianCents < 0 && repeated[1].metrics.medianCents > 0, 'same-pitch notes remain separate');
const shortNote = { ...note, id: 'short', durationBeats: .4 };
const shortFrames = Array.from({ length: 9 }, (_, index) => ({ beat: index * .045, time: index * .025, confidence: .9,
  hz: 440 * 2 ** ((index < 2 ? -90 : index > 6 ? 70 : 12) / 1200) }));
result = feedback.analyseNote(shortNote, shortFrames);
assert.equal(result.metrics.analysisMode, 'short');
assert.equal(result.metrics.driftCents, null, 'short notes never claim drift');
assert.equal(result.category, 'in-tune', 'a coherent attained pitch outweighs short transitions');
const sustainedResult = analyse((time) => -45 * time);
assert.equal(sustainedResult.metrics.analysisMode, 'sustained');
assert.ok(sustainedResult.metrics.driftReliability > 0, 'sustained notes expose conclusion-specific drift reliability');
const phraseNotes = Array.from({ length: 6 }, (_, index) => ({ ...note, id: `p${index}`, onsetBeat: index * 2, measureNumber: index + 1 }));
const phraseResults = phraseNotes.map((item, index) => ({ noteId: item.id, note: item, category: 'stable-low', severity: 30,
  metrics: { judgementReliable: true, medianCents: -index * 12 } }));
const phraseInsights = feedback.analysePhrases(phraseResults);
assert.equal(phraseInsights[0].category, 'phrase-drifting-low');
assert.equal(feedback.prioritise(phraseResults, phraseInsights, 3).length, 3, 'overview limits attention to three priorities');

const rate = 16000, length = rate, source = Float32Array.from({ length }, (_, i) => .4 * Math.sin(2 * Math.PI * 220 * i / rate));
const correctionRatio = 2 ** (30 / 1200);
const shifted = feedback.pitchShiftPcm(source, rate, () => correctionRatio);
assert.equal(shifted.length, source.length, 'duration is preserved');
assert.ok(Math.max(...shifted) <= 1 && Math.min(...shifted) >= -1, 'no clipping');
const silent = new Float32Array(rate / 4), silentOut = feedback.pitchShiftPcm(silent, rate, () => 1.2);
assert.ok(silentOut.every((sample) => sample === 0), 'silence remains silence');
let crossings = 0; for (let i = 1; i < shifted.length; i += 1) if (shifted[i - 1] <= 0 && shifted[i] > 0) crossings += 1;
assert.ok(crossings >= 222 && crossings <= 226, `pitch was shifted by about 30 cent (${crossings} crossings)`);
const regionShifted = feedback.pitchShiftRegion(source, rate / 4, rate * 3 / 4, correctionRatio, { fadeSamples: 320 });
assert.equal(regionShifted.length, source.length, 'WSOLA region keeps take duration');
assert.deepEqual(regionShifted.slice(0, rate / 4), source.slice(0, rate / 4), 'audio outside the note is bit-identical');
let regionCrossings = 0; for (let i = rate * .32; i < rate * .68; i += 1) if (regionShifted[i - 1] <= 0 && regionShifted[i] > 0) regionCrossings += 1;
assert.ok(regionCrossings >= 79 && regionCrossings <= 82, `WSOLA correction changes pitch without changing duration (${regionCrossings} crossings)`);
const multi = feedback.pitchShiftRegions(source, [
  { startSample: rate * .1, endSample: rate * .3, ratio: correctionRatio },
  { startSample: rate * .6, endSample: rate * .8, ratio: 1 / correctionRatio },
], { fadeSamples: 160 });
assert.equal(multi.length, source.length, 'whole-take correction preserves duration');
assert.deepEqual(multi.slice(rate * .4, rate * .5), source.slice(rate * .4, rate * .5), 'gaps between corrected notes remain original');
console.log('vocal_feedback: 29 assertions passed');
