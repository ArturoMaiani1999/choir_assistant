const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const workers = [], timers = new Map(), estimates = [];
  let now = 0, nextTimer = 0;
  const pcm = Float32Array.from({ length: 2048 }, (_, i) => .1 * Math.sin(2 * Math.PI * 220 * i / 48000));
  const settings = { rmsThreshold: .000002, yinThreshold: .42, minClarity: .45, minConfidence: .3 };
  const state = {
    microphoneStatus: 'active', microphoneContext: { sampleRate: 48000 },
    microphoneAnalyser: { fftSize: pcm.length, getFloatTimeDomainData: a => a.set(pcm) },
    microphoneBuffer: new Float32Array(pcm.length), pitchWorker: null,
    pitchWorkerInFlight: false, pitchWorkerTimeout: null, pitchWorkerDisabled: false,
    pitchAnalysisGeneration: 0,
  };
  class Worker {
    constructor() { workers.push(this); }
    postMessage(message, transfer) { this.message = structuredClone(message, { transfer }); }
    terminate() { this.terminated = true; }
  }
  const sandbox = {
    window: { Worker }, Worker, state, Float32Array, performance: { now: () => now },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    activeRecognitionSettings: () => settings, queueNeuralLiveInference() {},
    applyPitchEstimate: estimate => estimates.push(estimate),
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('frontend/pitch_detector.js', 'utf8'), sandbox);
  sandbox.detectPitch = sandbox.window.ChoirPitch.detectPitch;
  const source = fs.readFileSync('frontend/app.js', 'utf8');
  vm.runInContext(source.slice(source.indexOf('function stopPitchWorker()'), source.indexOf('function stopPitchAnalysisLoop()')), sandbox);
  return {
    state, workers, timers, estimates,
    analyse: () => sandbox.analyseMicrophone(2, true, now), stop: () => sandbox.stopPitchWorker(),
    expected: () => sandbox.detectPitch(pcm, 48000, { ...settings, resolveHarmonics: true }),
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
    },
    reply(worker = workers.at(-1), extra = {}) {
      const data = worker.message;
      worker.onmessage({ data: { ...data, estimate: { hz: 220 }, ...extra } });
    },
  };
}

test('a stalled Worker releases its transferred buffer and resumes the identical detector', () => {
  const f = fixture(); f.analyse();
  assert.equal(f.state.microphoneBuffer, null);
  assert.equal(f.state.pitchWorkerInFlight, true);
  f.advance(1499); assert.equal(f.state.pitchWorkerDisabled, false);
  f.advance(1);
  assert.equal(f.workers[0].terminated, true);
  assert.equal(f.state.pitchWorkerDisabled, true);
  assert.equal(f.state.pitchWorkerInFlight, false);
  assert.equal(f.state.microphoneBuffer.length, 2048);
  f.analyse();
  assert.equal(f.workers.length, 1);
  assert.deepEqual(f.estimates[0], f.expected());
  assert.ok(Math.abs(f.estimates[0].hz - 220) < 1);
});

test('normal responses cancel the deadline; the next request has its own deadline', () => {
  const f = fixture(); f.analyse(); f.advance(100); f.reply();
  assert.equal(f.timers.size, 0);
  assert.equal(f.state.pitchWorkerInFlight, false);
  f.advance(1500); assert.equal(f.state.pitchWorkerDisabled, false);
  f.analyse(); f.advance(1500);
  assert.equal(f.state.pitchWorkerDisabled, true);
});

test('stop cancels the deadline; late old messages and errors cannot affect a replacement', () => {
  const f = fixture(); f.analyse(); const old = f.workers[0]; f.stop();
  assert.equal(f.timers.size, 0);
  f.state.microphoneBuffer = new Float32Array(2048);
  f.analyse(); const current = f.workers[1], deadline = f.state.pitchWorkerTimeout;
  f.reply(old); old.onerror(); old.onmessageerror();
  assert.equal(f.state.pitchWorker, current);
  assert.equal(f.state.pitchWorkerTimeout, deadline);
  assert.equal(f.state.pitchWorkerInFlight, true);
  assert.equal(f.state.microphoneBuffer, null);
  assert.equal(f.estimates.length, 0);
  f.reply(); assert.equal(f.estimates.length, 1);
});

for (const failure of ['onerror', 'onmessageerror', 'reported-error', 'postMessage']) {
  test(`${failure} releases the Worker and allows fallback`, () => {
    const f = fixture(); f.analyse();
    if (failure === 'reported-error') f.reply(undefined, { error: 'failed' });
    else if (failure === 'postMessage') {
      f.reply(); f.workers[0].postMessage = () => { throw Error('cannot transfer'); }; f.analyse();
    } else f.workers[0][failure]();
    assert.equal(f.timers.size, 0);
    assert.equal(f.state.pitchWorkerInFlight, false);
    assert.equal(f.state.pitchWorkerDisabled, true);
    f.analyse(); assert.deepEqual(f.estimates.at(-1), f.expected());
  });
}

test('a response after timeout cannot overwrite the pitch or buffer used by fallback', () => {
  const f = fixture(); f.analyse(); const old = f.workers[0];
  f.advance(1500); f.analyse(); const buffer = f.state.microphoneBuffer;
  f.reply(old, { estimate: { hz: 880 } });
  assert.equal(f.estimates.length, 1);
  assert.equal(f.state.microphoneBuffer, buffer);
  assert.ok(Math.abs(f.estimates[0].hz - 220) < 1);
});
