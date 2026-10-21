const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VisualPlaybackTime } = require('../frontend/practice_math.js');
const { acquireMicrophone } = require('../frontend/media_mixer.js');

test('100 ms media steps produce continuous bounded presentation at both speeds', () => {
  for (const speed of [1, .8]) {
    const visual = new VisualPlaybackTime(), positions = [], errors = [];
    for (let frame = 0; frame <= 360; frame++) {
      const elapsed = frame / 60;
      const time = 5 + Math.floor((elapsed + 1e-8) * 10) / 10 * speed;
      const snapshot = Object.freeze({ performanceTime: time, running: true, speed });
      const value = visual.update(snapshot, elapsed * 1000);
      positions.push(value); errors.push(value - time);
      assert.equal(snapshot.performanceTime, time, 'canonical sample time is untouched');
    }
    const steps = positions.slice(1).map((value, i) => value - positions[i]);
    assert.ok(steps.every(step => step > .014 * speed && step < .019 * speed), `${speed}: ${Math.min(...steps)}, ${Math.max(...steps)}`);
    assert.ok(Math.max(...errors) <= .120001 * speed);
    assert.ok(Math.abs(positions.at(-1) - 11 * speed - 5 * (1 - speed)) < .12);
  }
});

test('pause, seek, buffering, rate change, epoch reset and background reanchor', () => {
  const c = new VisualPlaybackTime();
  const s = (time, running = true, speed = 1) => ({ performanceTime: time, running, speed });
  c.update(s(4), 0); assert.ok(c.update(s(4), 16) > 4);
  assert.equal(c.update(s(4.01, false), 32), 4.01);
  assert.equal(c.update(s(4.01), 48), 4.01, 'resume starts at actual media time');
  assert.equal(c.update(s(9), 64), 9, 'large forward discontinuity');
  assert.equal(c.update(s(2), 80), 2, 'backward discontinuity');
  assert.equal(c.update(s(2.01), 96, true), 2.01, 'buffering freezes immediately');
  assert.equal(c.update(s(2.01), 112), 2.01);
  assert.equal(c.update(s(2.02, true, .8), 128), 2.02);
  c.reset(); assert.equal(c.update(s(2.03), 144), 2.03, 'small seek resets through media events');
  assert.equal(c.update(s(8), 3000), 8, 'no prediction across background gaps');
});

test('a silent media stall can never make presentation run freely', () => {
  const c = new VisualPlaybackTime(); const values = [];
  for (let frame = 0; frame < 120; frame++) values.push(c.update({ performanceTime: 5, running: true, speed: 1 }, frame * 1000 / 60));
  assert.ok(values.at(-1) <= 5.12);
  assert.equal(values[20], values.at(-1));
});

const phone = { kind: 'audioinput', label: 'Speakerphone', deviceId: 'phone' };
const bluetooth = { kind: 'audioinput', label: 'Bluetooth headset', deviceId: 'bt' };
const constraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 }, video: false };
function fixture(lists) {
  const calls = [], streams = [];
  return { calls, streams, media: {
    async enumerateDevices() { return lists.length > 1 ? lists.shift() : lists[0]; },
    async getUserMedia(value) {
      calls.push(value);
      const track = { stopped: false, stop() { this.stopped = true; } };
      const stream = { getTracks: () => [track] }; streams.push(stream); return stream;
    },
  } };
}
test('Android headphone route opens the phone directly with no Bluetooth capture', async () => {
  const f = fixture([[bluetooth, phone]]);
  await acquireMicrophone(f.media, constraints, { preferPhone: true });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].audio.deviceId, { exact: 'phone' });
  for (const field of ['autoGainControl', 'noiseSuppression', 'echoCancellation']) assert.deepEqual(f.calls[0].audio[field], { exact: false });
  assert.equal(constraints.audio.autoGainControl, true);
});
test('first permission reveals devices: old capture stops before reopening the phone', async () => {
  const f = fixture([[{ kind: 'audioinput', label: '', deviceId: '' }], [bluetooth, phone]]);
  const acquire = f.media.getUserMedia;
  f.media.getUserMedia = async value => {
    if (f.calls.length) assert.equal(f.streams[0].getTracks()[0].stopped, true);
    return acquire(value);
  };
  await acquireMicrophone(f.media, constraints, { preferPhone: true });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].audio.deviceId, { exact: 'phone' });
});
test('speaker/desktop paths and unnamed devices preserve the requested input', async () => {
  for (const preferPhone of [false, true]) {
    const f = fixture([[phone]]);
    await acquireMicrophone(f.media, constraints, { preferPhone });
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0], constraints);
  }
});
test('cancellation after permission releases capture and never reopens a device', async () => {
  const f = fixture([[], [phone, bluetooth]]); let reads = 0;
  const stream = await acquireMicrophone(f.media, constraints, { preferPhone: true, isCurrent: () => ++reads < 2 });
  assert.equal(stream, null); assert.equal(f.calls.length, 1);
  assert.equal(f.streams[0].getTracks()[0].stopped, true);
});
test('unavailable explicit phone fails rather than silently reopening SCO', async () => {
  const f = fixture([[phone, bluetooth]]);
  f.media.getUserMedia = async () => { throw Object.assign(Error('disconnected'), { name: 'OverconstrainedError' }); };
  await assert.rejects(acquireMicrophone(f.media, constraints, { preferPhone: true }), /disconnected/);
});
