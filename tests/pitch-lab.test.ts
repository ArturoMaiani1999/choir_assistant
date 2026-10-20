import { describe, expect, it } from "vitest";

import "../frontend/pitch_lab_core.js";
const Lab = (globalThis as any).PitchLabCore;

const sampleRate = 16_000;

function synth(duration: number, frequencyAt: (time: number) => number | null, options: {
  amplitude?: number; harmonics?: number[]; noise?: number; seed?: number;
} = {}) {
  const audio = new Float32Array(Math.round(duration * sampleRate));
  const phases = (options.harmonics ?? [1]).map(() => 0);
  const harmonics = options.harmonics ?? [1];
  const norm = harmonics.reduce((sum, value) => sum + Math.abs(value), 0) || 1;
  let random = options.seed ?? 7;
  const rng = () => { random = Math.imul(random ^ random >>> 15, 1 | random); random ^= random + Math.imul(random ^ random >>> 7, 61 | random); return ((random ^ random >>> 14) >>> 0) / 4294967296; };
  for (let index = 0; index < audio.length; index += 1) {
    const hz = frequencyAt(index / sampleRate); let value = 0;
    if (hz != null) harmonics.forEach((gain, harmonic) => {
      phases[harmonic] += 2 * Math.PI * hz * (harmonic + 1) / sampleRate;
      value += gain * Math.sin(phases[harmonic]);
    });
    audio[index] = value * (options.amplitude ?? .18) / norm + (options.noise ?? 0) * (rng() * 2 - 1);
  }
  return audio;
}

function config(algorithm: "yin" | "pyin") {
  return { ...Lab.DEFAULTS, algorithm, analysisSampleRate: sampleRate, frameLength: 2048, hopLength: 512,
    removeDc: algorithm === "yin" };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function analyze(audio: Float32Array, algorithm: "yin" | "pyin") {
  return algorithm === "yin" ? Lab.analyzeYin(audio, sampleRate, config(algorithm)) : Lab.analyzePyin(audio, sampleRate, config(algorithm));
}

describe("Pitch Detection Ablation Lab DSP", () => {
  for (const hz of [110, 220, 440, 880]) {
    it(`tracks a stable ${hz} Hz sine with YIN and pYIN`, () => {
      const audio = synth(1.2, () => hz);
      for (const algorithm of ["yin", "pyin"] as const) {
        const result = analyze(audio, algorithm);
        const pitches = result.frames.map((frame: any) => frame.trackedHz).filter(Number.isFinite);
        expect(pitches.length / result.frames.length).toBeGreaterThan(.75);
        expect(Math.abs(Lab.centsBetween(median(pitches), hz))).toBeLessThan(12);
      }
    });
  }

  it("follows deterministic vibrato without flattening it to one bin", () => {
    const audio = synth(1.6, time => 220 * 2 ** (55 * Math.sin(2 * Math.PI * 5 * time) / 1200));
    const result = analyze(audio, "pyin");
    const midis = result.frames.map((frame: any) => frame.trackedMidi).filter(Number.isFinite);
    expect(Math.max(...midis) - Math.min(...midis)).toBeGreaterThan(.45);
    expect(Math.abs(Lab.centsBetween(Lab.midiToHz(median(midis)), 220))).toBeLessThan(25);
  });

  it("decodes an octave transition", () => {
    const result = analyze(synth(1.8, time => time < .9 ? 220 : 440), "pyin");
    const before = result.frames.filter((frame: any) => frame.timeSec > .3 && frame.timeSec < .75 && frame.trackedHz).map((frame: any) => frame.trackedHz);
    const after = result.frames.filter((frame: any) => frame.timeSec > 1.15 && frame.timeSec < 1.65 && frame.trackedHz).map((frame: any) => frame.trackedHz);
    expect(Math.abs(Lab.centsBetween(median(before), 220))).toBeLessThan(20);
    expect(Math.abs(Lab.centsBetween(median(after), 440))).toBeLessThan(20);
  });

  it("keeps short-note timestamps aligned to the shared center-frame clock", () => {
    const sequence = [220, 246.94165, 261.62557, 293.66477];
    const result = analyze(synth(1.6, time => sequence[Math.min(3, Math.floor(time / .4))]), "yin");
    expect(result.frames[0].timeSec).toBeCloseTo(2048 / 2 / sampleRate, 8);
    expect(result.frames[1].timeSec - result.frames[0].timeSec).toBeCloseTo(512 / sampleRate, 8);
  });

  it("rejects silence and exposes the reason instead of fabricating F0", () => {
    const result = analyze(new Float32Array(sampleRate), "yin");
    expect(result.frames.every((frame: any) => frame.rawHz == null && frame.trackedHz == null)).toBe(true);
    expect(result.metrics.rejectionReasons.unvoiced).toBe(result.frames.length);
  });

  it("does not present noisy target proximity as acoustic accuracy", () => {
    const result = analyze(synth(1.2, () => null, { noise: .08, seed: 11 }), "pyin");
    expect(result.metrics.acousticAccuracy).toBeNull();
    expect(result.metrics.scientificNote).toContain("non accuratezza acustica");
  });

  it("retains the weak fundamental when upper harmonics dominate", () => {
    const result = analyze(synth(1.3, () => 220, { harmonics: [.12, 1, .7, .35], amplitude: .25 }), "pyin");
    const pitches = result.frames.map((frame: any) => frame.trackedHz).filter(Number.isFinite);
    expect(Math.abs(Lab.centsBetween(median(pitches), 220))).toBeLessThan(50);
  });

  it("is reproducible and invalidates cache identity on relevant config changes", () => {
    const first = config("yin"), second = { ...first, minConfidence: .2 };
    expect(Lab.configHash(first)).toBe(Lab.configHash({ ...first }));
    expect(Lab.configHash(first)).not.toBe(Lab.configHash(second));
    const audio = synth(.8, () => 220);
    expect(Lab.audioFingerprint(audio, sampleRate)).toBe(Lab.audioFingerprint(audio.slice(), sampleRate));
  });

  it("reuses one CMND pass across a YIN sweep without changing its results", () => {
    const audio = synth(1.2, time => time < .6 ? 220 : 440);
    const configs = [.1, .3, .6].map(minConfidence => ({ ...config("yin"), minConfidence }));
    const batch = Lab.analyzeBatch(audio, sampleRate, configs);
    expect(batch.results).toHaveLength(configs.length);
    expect(batch.performance.cmndFrameCount).toBe(batch.results[0].frames.length);
    expect(batch.results[0].performance.batchConfigurationCount).toBe(3);
    configs.forEach((candidate, index) => {
      const standalone = Lab.analyzeYin(audio, sampleRate, candidate);
      expect(batch.results[index].frames).toEqual(standalone.frames);
    });
  });

  it("reuses CMND across probabilistic-threshold pYIN ablations", () => {
    const audio = synth(.9, () => 220, { harmonics: [.3, 1, .4] });
    const configs = [40, 100].map(nThresholds => ({ ...config("pyin"), nThresholds }));
    const batch = Lab.analyzeBatch(audio, sampleRate, configs);
    configs.forEach((candidate, index) => {
      const standalone = Lab.analyzePyin(audio, sampleRate, candidate);
      expect(batch.results[index].frames).toEqual(standalone.frames);
    });
  });

  it("finds pYIN-present/live-missing segments without claiming they are correct", () => {
    const offline = [{ timeSec: .1, trackedHz: 220 }, { timeSec: .13, trackedHz: 220 }];
    const live = [{ timeSec: .1, trackedHz: null }, { timeSec: .13, trackedHz: null }];
    const segments = Lab.falseNegativeSegments(live, offline);
    expect(segments).toEqual([{ kind: "offline-f0-live-gap", startSec: .1, endSec: .13, frameCount: 2 }]);
  });

  it("isolates the sparse decoder bias on exactly the same noisy PCM and probabilities", () => {
    const audio = synth(1.6, () => 220, { amplitude: .12, noise: .045, seed: 3 });
    const original = Lab.analyzePyin(audio, sampleRate, { ...config('pyin'), decoder: 'legacy-sparse' });
    const corrected = Lab.analyzePyin(audio, sampleRate, config('pyin'));
    expect(corrected.frames.map((f: any) => f.voicedProbability)).toEqual(original.frames.map((f: any) => f.voicedProbability));
    expect(corrected.frames.map((f: any) => f.candidates)).toEqual(original.frames.map((f: any) => f.candidates));
    expect(original.metrics.detectedPercent).toBeLessThan(10);
    expect(corrected.metrics.detectedPercent).toBeGreaterThan(90);
    expect(Math.abs(Lab.centsBetween(median(corrected.frames.map((f: any) => f.trackedHz).filter(Number.isFinite)), 220))).toBeLessThan(15);
    expect(original.frames.some((f: any) => f.rawHz > 0 && f.trackedHz == null && f.candidateCount > 0)).toBe(true);
  });

  it("rejects unperiodic noise with the explicit experimental gate and keeps silence distinct", () => {
    for (const decoder of ['normalized-grid', 'legacy-sparse']) {
      const result = Lab.analyzePyin(synth(1.2, () => null, { noise: .05, seed: 101 }), sampleRate, { ...config('pyin'), decoder, minVoicedProbability: .05 });
      expect(result.metrics.detectedPercent).toBeLessThan(5);
    }
    const silence = analyze(new Float32Array(sampleRate), 'pyin');
    expect(silence.frames.every((f: any) => f.candidateCount === 0 && f.rejectionReason === 'pyin-no-candidate')).toBe(true);
  });

  it("does not snap an intentionally wrong sung note to the score", () => {
    const audio = synth(1.4, () => 220 * 2 ** (73 / 1200));
    const result = Lab.analyzePyin(audio, sampleRate, config('pyin'), { metadata: { targets: [{ startSec: 0, endSec: 2, midi: 57 }] } });
    expect(Math.abs(result.metrics.targetMedianAbsoluteCents - 73)).toBeLessThan(12);
    expect(result.metrics.acousticAccuracy).toBeNull();
  });

  it("excludes unannotated time from both false alarms and overall accuracy", () => {
    const frames = [{ timeSec: .1, trackedHz: 220 }, { timeSec: .2, trackedHz: 440 },
      { timeSec: .3, trackedHz: 220 }, { timeSec: .4, trackedHz: null }];
    const m = Lab.acousticMetrics(frames, [{ startSec: .05, endSec: .15, hz: 220 },
      { startSec: .35, endSec: .45, hz: null }], .1);
    expect(m.evaluatedFrames).toBe(2); expect(m.unknownFrames).toBe(2);
    expect(m.voicingPrecision).toBe(1); expect(m.voicingFalseAlarmRate).toBe(0);
    expect(m.overallAccuracy30).toBe(1); expect(m.evaluatedSec).toBeCloseTo(.2);
  });

  it("computes positive/negative voicing metrics, octave errors, dropouts and error quantiles", () => {
    const frames = [220, null, 440, 220, null].map((trackedHz, i) => ({ timeSec: .1 + i * .1, trackedHz }));
    const m = Lab.acousticMetrics(frames, [{ startSec: 0, endSec: .35, hz: 220 }, { startSec: .35, endSec: .6, hz: null }], .1);
    expect(m.voicingRecall).toBeCloseTo(2 / 3); expect(m.voicingPrecision).toBeCloseTo(2 / 3);
    expect(m.voicingF1).toBeCloseTo(2 / 3); expect(m.voicingFalseAlarmRate).toBe(.5);
    expect(m.grossPitchErrorRate).toBe(.5); expect(m.octaveErrorRate).toBe(.5);
    expect(m.medianAbsoluteCents).toBe(600); expect(m.p95AbsoluteCents).toBe(1140);
    expect(m.dropoutCount).toBe(1); expect(m.dropoutDurationSec).toBeCloseTo(.1);
  });

  it("supports voicing-only annotations without inventing reference F0", () => {
    const truth = Lab.normalizeTruth([{ startSec: 0, endSec: 1, voiced: true }]);
    const m = Lab.acousticMetrics([{ timeSec: .2, trackedHz: 220 }], truth, .1);
    expect(m.voicingRecall).toBe(1); expect(m.rawPitchAccuracy50).toBeNull();
    expect(m.maeCents).toBeNull(); expect(m.overallAccuracy30).toBeNull();
  });

  it("rejects overlapping/invalid acoustic labels and nonfinite detector parameters", () => {
    expect(() => Lab.normalizeTruth([{ startSec: 0, endSec: 1, hz: 0 }])).toThrow();
    expect(() => Lab.normalizeTruth([{ startSec: 0, endSec: 1, hz: 220 }, { startSec: .5, endSec: 2, hz: null }])).toThrow();
    for (const invalid of [{ minConfidence: NaN }, { switchProb: 0 }, { fmax: Infinity }, { weakSignalHoldFrames: -1 }])
      expect(() => Lab.validateConfig(invalid)).toThrow();
    expect(() => Lab.decodePyin([{ candidates: [], voicedProbability: 0 }], { ...config('pyin'), resolution: .001 }, sampleRate)).toThrow(/memoria/);
  });

  it("never ranks unannotated, positive-only or score-only experiments", () => {
    const result = analyze(synth(.6, () => 220), 'pyin');
    expect(Lab.tuningConfigs(config('pyin'))).toHaveLength(6);
    expect(Lab.tuningConfigs(config('pyin'))[0].decoder).toBe('legacy-sparse');
    expect(Lab.rankExperiments([result], []).selectedIndex).toBeNull();
    expect(Lab.rankExperiments([result], [{ startSec: 0, endSec: 1, hz: 220 }]).selectedIndex).toBeNull();
  });
});
