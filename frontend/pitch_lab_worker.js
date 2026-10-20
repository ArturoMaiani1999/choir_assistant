'use strict';

importScripts('pitch_lab_core.js');

self.onmessage = event => {
  const { type, requestId, audioBuffer, sampleRate, config, configs, metadata, acousticTruth } = event.data || {};
  if (!['analyze', 'analyze-batch', 'tune'].includes(type) || !audioBuffer) return;
  const progress = (value, phase) => self.postMessage({ type: 'progress', requestId, value, phase });
  try {
    const audio = new Float32Array(audioBuffer);
    const hooks = { progress, metadata: metadata || {} };
    if (type === 'analyze-batch' || type === 'tune') {
      const batch = self.PitchLabCore.analyzeBatch(audio, sampleRate,
        type === 'tune' ? self.PitchLabCore.tuningConfigs(config) : configs, hooks);
      if (type === 'tune') batch.tuning = self.PitchLabCore.rankExperiments(batch.results, acousticTruth || []);
      self.postMessage({ type: 'batch-result', requestId, batch });
      return;
    }
    const result = config?.algorithm === 'pyin'
      ? self.PitchLabCore.analyzePyin(audio, sampleRate, config, hooks)
      : self.PitchLabCore.analyzeYin(audio, sampleRate, config, hooks);
    self.postMessage({ type: 'result', requestId, result });
  } catch (error) {
    self.postMessage({ type: 'error', requestId, error: error?.message || String(error) });
  }
};
