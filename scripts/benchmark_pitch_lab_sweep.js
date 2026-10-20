'use strict';

const Lab = require('../frontend/pitch_lab_core.js');

const sampleRate = 16_000;
const durationSec = Number(process.argv[2] || 120);
const audio = new Float32Array(Math.round(sampleRate * durationSec));
let phase = 0;
for (let index = 0; index < audio.length; index += 1) {
  const time = index / sampleRate;
  const hz = 170 * 2 ** ((320 * Math.sin(2 * Math.PI * .17 * time) + 120 * Math.sin(2 * Math.PI * 4.8 * time)) / 1200);
  phase += 2 * Math.PI * hz / sampleRate;
  audio[index] = .16 * Math.sin(phase) + .035 * Math.sin(2 * phase) + .015 * Math.sin(3 * phase);
}

const base = { ...Lab.DEFAULTS, algorithm: 'yin', analysisSampleRate: sampleRate,
  frameLength: 2048, hopLength: 512 };
const configs = [.2, .3, .42, .55].map(yinThreshold => ({ ...base, yinThreshold }));

const sequentialStarted = performance.now();
const sequential = configs.map(config => Lab.analyzeYin(audio, sampleRate, config));
const sequentialMs = performance.now() - sequentialStarted;
const batchStarted = performance.now();
const batch = Lab.analyzeBatch(audio, sampleRate, configs);
const batchMs = performance.now() - batchStarted;

const equivalent = batch.results.every((result, resultIndex) => result.frames.every((frame, frameIndex) => {
  const reference = sequential[resultIndex].frames[frameIndex];
  return frame.rawHz === reference.rawHz && frame.trackedHz === reference.trackedHz
    && frame.rejectionReason === reference.rejectionReason;
}));

process.stdout.write(`${JSON.stringify({ durationSec, configurations: configs.length,
  framesPerConfiguration: batch.performance.cmndFrameCount, sequentialMs, batchMs,
  speedup: sequentialMs / batchMs, equivalent }, null, 2)}\n`);
