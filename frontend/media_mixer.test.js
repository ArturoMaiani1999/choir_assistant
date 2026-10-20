const assert = require('node:assert/strict');
const { MediaElementMixer, buildMediaPlaybackPlan } = require('./media_mixer.js');

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

class FakeAudioWorkletNode {
  constructor(_context, _name, options) {
    const ratio = {
      value: 1, cancelledAt: null, setAt: null,
      cancelScheduledValues(time) { this.cancelledAt = time; },
      setValueAtTime(value, time) { this.value = value; this.setAt = time; },
    };
    ratio.value = options.parameterData.ratio;
    this.parameters = new Map([['ratio', ratio]]);
  }

  connect() {}
  disconnect() {}
}

async function run() {
  const manifest = {
    mixFile: 'score.mp3',
    accompanimentFile: 'accompaniment.mp3',
    voiceStems: { P1: 'voice-P1.mp3', P2: 'voice-P2.mp3', P3: 'voice-P3.mp3', P4: 'voice-P4.mp3' },
  };
  assert.deepEqual(buildMediaPlaybackPlan({ ...manifest, selectedVoiceIds: ['P1'] }), {
    kind: 'stem-mix', masterFile: 'accompaniment.mp3', masterPartId: null, silentMaster: false,
    voiceStems: [{ partId: 'P1', file: 'voice-P1.mp3' }],
  });
  assert.deepEqual(buildMediaPlaybackPlan({ ...manifest, selectedVoiceIds: ['P1', 'P2', 'P3', 'P4'] }), {
    kind: 'full-mix', masterFile: 'score.mp3', masterPartId: null, silentMaster: false, voiceStems: [],
  }, 'all voices must use one pre-rendered stream on every device');
  assert.deepEqual(buildMediaPlaybackPlan({
    ...manifest, accompanimentEnabled: false, selectedVoiceIds: ['P1', 'P3'],
  }), {
    kind: 'stem-mix', masterFile: 'voice-P1.mp3', masterPartId: 'P1', silentMaster: false,
    voiceStems: [{ partId: 'P3', file: 'voice-P3.mp3' }],
  }, 'disabling the accompaniment uses an isolated voice as the clock');
  assert.deepEqual(buildMediaPlaybackPlan({
    ...manifest, accompanimentEnabled: false, selectedVoiceIds: [],
  }), {
    kind: 'muted', masterFile: null, masterPartId: null, silentMaster: true, voiceStems: [],
  }, 'when all tracks are muted the full score must not be loaded');
  assert.deepEqual(buildMediaPlaybackPlan({
    ...manifest, preferFullMix: false, selectedVoiceIds: ['P1', 'P2', 'P3', 'P4'],
  }), {
    kind: 'stem-mix', masterFile: 'accompaniment.mp3', masterPartId: null, silentMaster: false,
    voiceStems: [
      { partId: 'P1', file: 'voice-P1.mp3' }, { partId: 'P2', file: 'voice-P2.mp3' },
      { partId: 'P3', file: 'voice-P3.mp3' }, { partId: 'P4', file: 'voice-P4.mp3' },
    ],
  }, 'a custom all-voices mix keeps independently controllable stems');
  assert.deepEqual(buildMediaPlaybackPlan({
    mixFile: 'score.mp3', voiceStems: { P1: 'voice-P1.mp3', P2: 'voice-P2.mp3' }, selectedVoiceIds: ['P2'],
  }), {
    kind: 'stem-mix', masterFile: 'voice-P2.mp3', masterPartId: 'P2', silentMaster: false,
    voiceStems: [],
  });
  assert.deepEqual(buildMediaPlaybackPlan({
    mixFile: 'score.mp3', voiceStems: { P1: 'voice-P1.mp3' }, selectedVoiceIds: ['P1'],
  }), {
    kind: 'full-mix', masterFile: 'score.mp3', masterPartId: null, silentMaster: false, voiceStems: [],
  }, 'a monodic full selection must not keep a muted master plus a second decoder');
  assert.deepEqual(buildMediaPlaybackPlan({ mixFile: 'score.mp3', selectedVoiceIds: [] }), {
    kind: 'stem-mix', masterFile: 'score.mp3', masterPartId: null, silentMaster: false, voiceStems: [],
  }, 'a non-separable score remains ordinary single-stream playback');

  const media = fakeMedia();
  const mixer = new MediaElementMixer({ AudioContextClass: FakeAudioContext });
  assert.equal(mixer.setTranspose(7), 7);
  assert.equal(mixer.transposeSemitones, 7);
  mixer.setTranspose(0);

  mixer.setLevel(media, 0);
  assert.equal(media.volume, 0, 'fallback volume should reach zero');
  assert.equal(media.muted, true, 'zero must also use muted for iPadOS');

  assert.equal(await mixer.resume([media]), true);
  assert.equal(media.volume, 1, 'Web Audio owns the level once attached');
  assert.equal(media.muted, true, 'a zero-level media element must remain muted after Web Audio attaches');
  assert.equal(mixer.context.gains[0].gain.value, 0);

  await mixer.setReferenceOutput(true);
  assert.equal(mixer.channels.get(media).gain.target, mixer.referenceOutput, 'reference must include channel gain');
  assert.equal(mixer.referenceOutput.target, mixer.context.destination, 'reference must be the actual speaker feed');
  assert.equal(mixer.referenceOutput.channelCount, 1);
  assert.equal(mixer.referenceCovers([media]), true);
  assert.equal(mixer.referenceCovers([fakeMedia()]), false, 'unrouted audio must fail the speaker-mode gate');
  await mixer.setReferenceOutput(false);
  assert.equal(mixer.referenceOutput.channelCountMode, 'max');

  mixer.setLevel(media, 0.5);
  assert.equal(media.muted, false);
  assert.equal(mixer.context.gains[0].gain.value, 0.5);
  mixer.muteForCalibration(true);
  mixer.setLevel(media,.6);
  assert.equal(mixer.context.gains[0].gain.value,0,'gain changes cannot leak music during warmup');
  assert.equal(media.muted,false,'the media decoder remains active');
  mixer.muteForCalibration(false);
  assert.equal(mixer.context.gains[0].gain.value,.6,'restore the chosen mixer level');
  mixer.setLevel(media, 0.8, { forceMuted: true });
  assert.equal(media.muted, true);
  assert.equal(mixer.context.gains[0].gain.value, 0);

  const unsupportedTranspose = new MediaElementMixer({ AudioContextClass: FakeAudioContext });
  unsupportedTranspose.setTranspose(3);
  await assert.rejects(() => unsupportedTranspose.resume([fakeMedia()]), /transposition is unavailable/);

  const transposedMedia = fakeMedia();
  const transposedMixer = new MediaElementMixer({
    AudioContextClass: FakeAudioContext,
    AudioWorkletNodeClass: FakeAudioWorkletNode,
  });
  transposedMixer.context = new FakeAudioContext();
  transposedMixer.workletReady = true;
  transposedMixer.setTranspose(3);
  transposedMixer.setLevel(transposedMedia, 1);
  const ratio = transposedMixer.channels.get(transposedMedia).pitch.parameters.get('ratio');
  transposedMixer.setTranspose(7);
  assert.ok(Math.abs(ratio.value - 2 ** (7 / 12)) < 1e-12);
  assert.equal(ratio.cancelledAt, transposedMixer.context.currentTime);
  assert.equal(ratio.setAt, transposedMixer.context.currentTime);

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
