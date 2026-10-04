const assert = require('node:assert/strict');
const { MediaElementMixer } = require('./media_mixer.js');

function fakeMedia() {
  return {
    volume: 1,
    muted: false,
    paused: false,
    removed: [],
    loadCalls: 0,
    pause() { this.paused = true; },
    removeAttribute(name) { this.removed.push(name); },
    load() { this.loadCalls += 1; },
  };
}

class FakeAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 3;
    this.destination = {};
    this.sources = [];
    this.gains = [];
  }

  createMediaElementSource(media) {
    const node = { media, target: null, disconnected: false, connect(target) { this.target = target; }, disconnect() { this.disconnected = true; } };
    this.sources.push(node);
    return node;
  }

  createGain() {
    const param = {
      value: 1, cancelledAt: null, setAt: null,
      cancelScheduledValues(time) { this.cancelledAt = time; },
      setValueAtTime(value, time) { this.value = value; this.setAt = time; },
    };
    const node = { gain: param, target: null, disconnected: false, connect(target) { this.target = target; }, disconnect() { this.disconnected = true; } };
    this.gains.push(node);
    return node;
  }

  async resume() { this.state = 'running'; }
}

async function run() {
  const media = fakeMedia();
  const mixer = new MediaElementMixer({ AudioContextClass: FakeAudioContext });

  mixer.setLevel(media, 0);
  assert.equal(media.volume, 0, 'fallback volume should reach zero');
  assert.equal(media.muted, true, 'zero must also use muted for iPadOS');

  assert.equal(await mixer.resume([media]), true);
  assert.equal(media.volume, 1, 'Web Audio owns the level once attached');
  assert.equal(media.muted, false);
  assert.equal(mixer.context.gains[0].gain.value, 0);

  mixer.setLevel(media, 0.5);
  assert.equal(mixer.context.gains[0].gain.value, 0.5);
  mixer.setLevel(media, 0.8, { forceMuted: true });
  assert.equal(mixer.context.gains[0].gain.value, 0);

  const source = mixer.context.sources[0];
  const gain = mixer.context.gains[0];
  mixer.release(media);
  assert.equal(media.paused, true);
  assert.deepEqual(media.removed, ['src']);
  assert.equal(media.loadCalls, 1);
  assert.equal(source.disconnected, true);
  assert.equal(gain.disconnected, true);
  assert.equal(mixer.channels.has(media), false);
}

run().then(() => console.log('media_mixer tests passed'));
