'use strict';
self.window = self;
importScripts('pitch_detector.js', 'microphone_calibration.js');
self.onmessage = ({ data }) => {
  if (data.mode === 'ready') { self.postMessage({ type: 'ready' }); return; }
  const startedAt = performance.now();
  try {
    const Core = self.ChoirMicrophoneCalibration;
    const frames = Core.extractFrames(data.frames, data.sampleRate, data.baseline, self.ChoirPitch,
      value => self.postMessage({ type: 'progress', value }));
    const result = data.mode === 'reuse' ? { verified: Core.verifyNoise(frames, data.profile, self.ChoirPitch) }
      : Core.evaluate(frames, data.baseline, data.trackerSettings, self.ChoirPitch, data.unified === true);
    result.processingMs = performance.now() - startedAt;
    result.sampleRate = data.sampleRate;
    result.frameCount = frames.length;
    self.postMessage({ type: 'result', result });
  } catch (error) { self.postMessage({ type: 'error', error: error?.message || String(error) }); }
};
