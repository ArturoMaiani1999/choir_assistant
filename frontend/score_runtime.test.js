global.window = global;
require('./score_runtime.js');
const assert = require('node:assert/strict');

const clock = new ChoirScore.PerformanceClock({ tempoBpm: 120, speed: 1 });
clock.start(1000);
assert.equal(clock.beatAt(2000), 2);
clock.setSpeed(.5, 2000);
assert.equal(clock.beatAt(3000), 3, 'speed change preserves position and changes rate');
clock.stop(3000);
assert.equal(clock.snapshot(9000).beat, 3, 'paused clock remains stationary');
clock.seek(7, 9000);
assert.equal(clock.snapshot(9000).beat, 7);
console.log('score_runtime clock: 6 assertions passed');

const tempoRuntime = new ChoirScore.NormalizedScoreRuntime({
  title: 'Tempo test', tempoBpm: 120, tempoMap: [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 60 }],
  beatsPerMeasure: 4, targetEvents: [],
});
assert.equal(tempoRuntime.secondsAtBeat(6), 4);
assert.equal(tempoRuntime.beatAtSeconds(4), 6);

const pickupRuntime = ChoirScore.NormalizedScoreRuntime.fromNormalizedScore({
  title: '6/4 pickup', tempo_map: [{ beat: 0, bpm: 60 }],
  measures: [
    { id: 'm1', number: '1', time_signature_numerator: 6, time_signature_denominator: 4, beat_offset: 5 },
    { id: 'm2', number: '2', time_signature_numerator: 6, time_signature_denominator: 4 },
  ],
  performance_occurrences: [
    { id: 'o1', written_measure_id: 'm1', occurrence_index: 1, start_beat: 0, end_beat: 1 },
    { id: 'o2', written_measure_id: 'm2', occurrence_index: 1, start_beat: 1, end_beat: 7 },
  ],
  parts: [], target_events: [],
});
assert.equal(pickupRuntime.measureAt(0).beatInMeasure, 6, 'the pickup begins on metrical beat 6');
assert.equal(pickupRuntime.measureAt(1).beatInMeasure, 1, 'the next full measure begins immediately after the pickup');

const tonalRuntime = ChoirScore.NormalizedScoreRuntime.fromNormalizedScore({
  title: 'Tonal test', tempo_map: [{ beat: 0, bpm: 60 }],
  measures: [
    { id: 'major', number: '1', time_signature_numerator: 4, time_signature_denominator: 4, key_fifths: 2, key_mode: 'major' },
    { id: 'minor', number: '2', time_signature_numerator: 4, time_signature_denominator: 4, key_fifths: 2, key_mode: 'minor' },
  ],
  performance_occurrences: [
    { id: 'major-occ', written_measure_id: 'major', occurrence_index: 1, start_beat: 0, end_beat: 4 },
    { id: 'minor-occ', written_measure_id: 'minor', occurrence_index: 1, start_beat: 4, end_beat: 8 },
  ],
  parts: [], target_events: [],
});
assert.deepEqual(tonalRuntime.keyAt(1), { fifths: 2, mode: 'major' });
assert.equal(tonalRuntime.tonicPitchClassAt(1), 2, 'two sharps major resolves to D');
assert.equal(tonalRuntime.tonicPitchClassAt(5), 11, 'two sharps minor resolves to B');
assert.equal(tonalRuntime.tonicPitchClassAt(5, 2), 1, 'the displayed tonic follows transposition');

const listeners = new Map();
const media = {
  currentTime: 0,
  duration: 40,
  playbackRate: 1,
  paused: true,
  ended: false,
  preservesPitch: false,
  addEventListener(name, callback) { listeners.set(name, callback); },
  async play() { this.paused = false; queueMicrotask(() => listeners.get('playing')?.()); },
  pause() { this.paused = true; },
};
const scoreRuntime = {
  secondsAtBeat: (beat) => beat / 2,
  beatAtSeconds: (seconds) => seconds * 2,
};
const mediaClock = new ChoirScore.MediaPlaybackClock({ mediaElement: media, scoreRuntime });
(async () => {
  await mediaClock.play();
  media.currentTime = 2.5;
  assert.deepEqual(mediaClock.snapshot(), { mediaTime: 2.5, performanceTime: 2.5, beat: 5, running: true, speed: 1 });
  mediaClock.setSpeed(.5);
  assert.equal(media.currentTime, 2.5, 'rate change preserves canonical position');
  assert.equal(mediaClock.speed, .5);
  mediaClock.seekBeat(12);
  assert.equal(media.currentTime, 6);
  media.duration = 0;
  mediaClock.seekBeat(8);
  assert.equal(media.currentTime, 4, 'a transient zero duration must not clamp a measure seek to the start');
  media.duration = 40;
  mediaClock.setPreRenderedSpeed(.5);
  mediaClock.seekBeat(12);
  assert.equal(media.currentTime, 12, 'pre-rendered 50% audio maps canonical time to the longer media file');
  assert.equal(mediaClock.snapshot().performanceTime, 6);
  assert.equal(mediaClock.snapshot().speed, .5);
  mediaClock.pause();
  assert.equal(mediaClock.running, false);
  mediaClock.beginWarmup();
  await media.play();
  media.currentTime = 30;
  assert.equal(mediaClock.running, false, 'silent media warmup is not an attempt');
  assert.equal(mediaClock.snapshot().mediaTime, 12, 'warmup cannot move score position');
  mediaClock.finishWarmup();
  assert.equal(media.currentTime, 12, 'rehearsal resumes at the selected position');
  assert.equal(media.paused, false, 'release warmup without reopening the media pipeline');
  mediaClock.beginWarmup();
  mediaClock.pause();
  assert.equal(media.paused, true, 'cancellation stops warmed playback');
  assert.equal(mediaClock.warmupTime, null);
  console.log('media playback clock: 6 assertions passed');
})();
