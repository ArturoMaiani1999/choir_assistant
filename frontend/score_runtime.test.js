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
console.log('score_runtime clock: 4 assertions passed');

const tempoRuntime = new ChoirScore.NormalizedScoreRuntime({
  title: 'Tempo test', tempoBpm: 120, tempoMap: [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 60 }],
  beatsPerMeasure: 4, targetEvents: [],
});
assert.equal(tempoRuntime.secondsAtBeat(6), 4);
assert.equal(tempoRuntime.beatAtSeconds(4), 6);

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
  mediaClock.setPreRenderedSpeed(.5);
  mediaClock.seekBeat(12);
  assert.equal(media.currentTime, 12, 'pre-rendered 50% audio maps canonical time to the longer media file');
  assert.equal(mediaClock.snapshot().performanceTime, 6);
  assert.equal(mediaClock.snapshot().speed, .5);
  mediaClock.pause();
  assert.equal(mediaClock.running, false);
  console.log('media playback clock: 5 assertions passed');
})();
