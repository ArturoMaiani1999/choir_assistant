'use strict';

const Lab = require('../frontend/pitch_lab_core.js');
const sampleRate = 16000;

function synth(duration, frequencyAt, harmonics = [1]) {
  const output = new Float32Array(Math.round(duration * sampleRate));
  const phases = harmonics.map(() => 0);
  const normalizer = harmonics.reduce((sum, value) => sum + Math.abs(value), 0) || 1;
  for (let index = 0; index < output.length; index += 1) {
    const hz = frequencyAt(index / sampleRate); let sample = 0;
    harmonics.forEach((gain, harmonic) => {
      phases[harmonic] += 2 * Math.PI * hz * (harmonic + 1) / sampleRate;
      sample += gain * Math.sin(phases[harmonic]);
    });
    output[index] = .2 * sample / normalizer;
  }
  return output;
}

const fixtures = {
  steady220: synth(1.6, () => 220),
  vibrato: synth(1.8, time => 220 * 2 ** (45 * Math.sin(2 * Math.PI * 5 * time) / 1200)),
  octave: synth(1.8, time => time < .9 ? 220 : 440),
  weakFundamental: synth(1.6, () => 220, [.12, 1, .7, .35]),
};
const config = { ...Lab.DEFAULTS, algorithm: 'pyin', analysisSampleRate: sampleRate, frameLength: 2048,
  hopLength: 512, removeDc: false };
const output = { _meta: { algorithmVersion: Lab.ALGORITHM_VERSION } };
for (const [name, audio] of Object.entries(fixtures)) {
  const result = Lab.analyzePyin(audio, sampleRate, config);
  output[name] = { f0: result.frames.map(frame => frame.trackedHz), voicedProbability: result.frames.map(frame => frame.voicedProbability) };
}
process.stdout.write(JSON.stringify(output));
