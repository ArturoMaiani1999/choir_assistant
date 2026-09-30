(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChoirPitchShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PREFERENCE_KEY = 'choir-detector-settings:v1';
  const DETECTOR_DEFAULTS = Object.freeze({ rmsThreshold: .001, weakVoiceMode: false, fastAlpha: .65, slowAlpha: .3, medianWindowFrames: 3 });
  const PLUME_DEFAULTS = Object.freeze({ width: 1, intensity: 1, color: '#72e0d2', timeAdvanceMs: 200 });
  // Visual density, NOT a calibrated F0 posterior or confidence interval.
  const AURORA = Object.freeze({ trailSeconds: 2.8, historyOpacity: .08, sigmaSemitones: .16,
    palette: Object.freeze([[114,224,210], [114,224,210], [114,224,210]]) });
  const surfaces = new WeakMap();
  const smoothstep = (value) => { const v = Math.max(0, Math.min(1, value)); return v * v * (3 - 2 * v); };
  function readPreferences(storage = globalThis.localStorage) {
    let saved = {};
    try { saved = JSON.parse(storage?.getItem(PREFERENCE_KEY)) || {}; } catch (_) {}
    return {
      detector: {
        rmsThreshold: Number.isFinite(Number(saved.v1RmsThreshold)) ? Number(saved.v1RmsThreshold) : DETECTOR_DEFAULTS.rmsThreshold,
        weakVoiceMode: saved.v1WeakVoiceMode === true,
        fastAlpha: Number.isFinite(Number(saved.v1FastAlpha)) ? Number(saved.v1FastAlpha) : DETECTOR_DEFAULTS.fastAlpha,
        slowAlpha: Number.isFinite(Number(saved.v1SlowAlpha)) ? Number(saved.v1SlowAlpha) : DETECTOR_DEFAULTS.slowAlpha,
        medianWindowFrames: Number.isFinite(Number(saved.v1MedianWindowFrames)) ? Number(saved.v1MedianWindowFrames) : DETECTOR_DEFAULTS.medianWindowFrames,
      },
      plume: {
        width: Number.isFinite(Number(saved.v1PlumeWidth)) ? Number(saved.v1PlumeWidth) : PLUME_DEFAULTS.width,
        intensity: Number.isFinite(Number(saved.v1PlumeIntensity)) ? Number(saved.v1PlumeIntensity) : PLUME_DEFAULTS.intensity,
        color: '#72e0d2',
        timeAdvanceMs: Number.isFinite(Number(saved.v1PlumeAdvanceMs)) ? Number(saved.v1PlumeAdvanceMs) : PLUME_DEFAULTS.timeAdvanceMs,
      },
    };
  }
  function plumeSegments(samples, xAt, settings = {}) {
    const timeAt = settings.timeAt || (sample => sample.time ?? sample.audioTimeSec);
    const now = settings.currentTime ?? timeAt(samples.at(-1) || {});
    const review = settings.mode === 'review';
    // Infer actual observation cadence; ignore silence gaps when estimating it.
    const deltas = [];
    for (let i = Math.max(1, samples.length - 96); i < samples.length; i++) {
      const dt = timeAt(samples[i]) - timeAt(samples[i - 1]);
      if (dt > 0 && dt < .5) deltas.push(dt);
    }
    deltas.sort((a,b) => a-b);
    const cadence = deltas[Math.floor(deltas.length / 2)] ?? .05;
    const gap = Math.min(.3, Math.max(.075, cadence * 2.5));
    const segments = []; let points = [];
    const close = () => { if (points.length) segments.push(points); points = []; };
    let start = 0, end = samples.length;
    if (settings.sortedTimeline) {
      const lowerBound = (value, coordinate) => {
        let low = 0, high = samples.length;
        while (low < high) { const mid = (low+high) >>> 1; if (coordinate(samples[mid]) < value) low = mid+1; else high = mid; }
        return low;
      };
      // Keep all visible history; crop by viewport, never by the colour window.
      start = Math.max(0, lowerBound(settings.viewportLeft ?? -Infinity, xAt)-1);
      end = Math.min(samples.length, lowerBound(settings.viewportRight ?? Infinity, xAt)+1);
      if (!review) end = Math.min(end, lowerBound(now+1e-9, timeAt));
    }
    const minConfidence = Number.isFinite(settings.minConfidence) ? settings.minConfidence : .3;
    for (let index = start; index < end; index++) {
      const sample = samples[index];
      const time = timeAt(sample), pitch = sample.displayPitch, confidence = sample.confidence ?? 0;
      if (!Number.isFinite(time) || !Number.isFinite(pitch) || !Number.isFinite(confidence) || confidence < minConfidence
          || sample.confirmationState === 'provisional' || (!review && time > now)) { close(); continue; }
      const x = xAt(sample);
      if (!Number.isFinite(x)) { close(); continue; }
      const previous = points.at(-1);
      if (previous && (x <= previous.x || time <= previous.time || time - previous.time > gap
          || sample.takeId !== previous.takeId || Math.abs(pitch - previous.pitch) > 3.2)) close();
      points.push({ x, time, pitch, confidence: Math.min(1, confidence), takeId: sample.takeId });
    }
    close();
    return { segments, now, cadence, gap, inspectedSamples: end-start };
  }
  function auroraStyle(age, confidence, settings = {}) {
    const review = settings.mode === 'review', trail = settings.trailSeconds ?? AURORA.trailSeconds;
    const fraction = review ? .5 : Math.max(0, Math.min(1, age / trail));
    const palette = settings.palette || AURORA.palette, phase = Math.min(1.999999, fraction * 2);
    const index = Math.floor(phase), mix = smoothstep(phase - index);
    return { color: palette[index].map((v,i) => Math.round(v + (palette[index+1][i]-v)*mix)),
      alpha: Math.min(1, confidence * (settings.intensity ?? 1)) * (review ? 1
        : 1 - (1 - (settings.historyOpacity ?? AURORA.historyOpacity)) * smoothstep(fraction)) };
  }
  // Linear interpolation per physical pixel column: no overshoot, no DSP smoothing.
  function visitPlumeColumns(model, left, right, step, settings, visit) {
    for (const points of model.segments) {
      if (points.length < 2) continue; // One isolated detection is not a trajectory.
      const first = points[0], last = points.at(-1); let pair = 1;
      for (let x = Math.max(left, Math.ceil(first.x / step) * step); x <= Math.min(right, last.x); x += step) {
        while (pair < points.length - 1 && points[pair].x < x) pair++;
        const a = points[pair-1], b = points[pair], t = (x-a.x)/(b.x-a.x);
        const time = a.time + (b.time-a.time)*t, pitch = a.pitch+(b.pitch-a.pitch)*t;
        const style = auroraStyle(model.now-time, a.confidence+(b.confidence-a.confidence)*t, settings);
        // Attack/release stay strictly inside observed data, never bridge silence.
        const edge = Math.min(smoothstep((time-first.time)/.045),
          last.time < model.now - model.cadence * 1.5 ? smoothstep((last.time-time)/.06) : 1);
        visit(x, pitch, style.color, style.alpha * edge);
      }
    }
  }
  function drawConfidencePlume(context, samples, xAt, yAt, minPitch, maxPitch, settings = PLUME_DEFAULTS) {
    const transform = context.getTransform(), ratio = Math.max(1, Math.abs(transform.a));
    const left = Math.max(0, settings.trailStartX ?? 0);
    const right = Math.min(context.canvas.width / ratio, settings.nowX ?? context.canvas.width / ratio);
    const top = Math.max(0, Math.min(yAt(minPitch), yAt(maxPitch)));
    const bottom = Math.min(context.canvas.height / ratio, Math.max(yAt(minPitch), yAt(maxPitch)));
    const width = Math.ceil((right-left)*ratio), height = Math.ceil((bottom-top)*ratio);
    if (width <= 0 || height <= 0) return;
    const model = plumeSegments(samples, xAt, { ...settings, viewportLeft: left, viewportRight: right });
    let surface = surfaces.get(context.canvas);
    if (!surface) {
      const canvas = context.canvas.ownerDocument.createElement('canvas');
      surface = { canvas, ctx: canvas.getContext('2d') }; surfaces.set(context.canvas, surface);
    }
    if (!surface.pixels || surface.canvas.width !== width || surface.canvas.height !== height) {
      surface.canvas.width = width; surface.canvas.height = height;
      surface.pixels = surface.ctx.createImageData(width, height);
    }
    const data = surface.pixels.data; data.fill(0);
    const sigma = Math.max(1.25, Math.abs(yAt(minPitch + AURORA.sigmaSemitones)-yAt(minPitch)) * Math.max(.4, Math.min(3, settings.width ?? 1))) * ratio;
    visitPlumeColumns(model, left, right - 1/ratio, 1/ratio, settings, (x,pitch,color,alpha) => {
      const col = Math.min(width-1, Math.max(0, Math.round((x-left)*ratio))), center = (yAt(pitch)-top)*ratio;
      for (let row = Math.max(0, Math.floor(center-3.5*sigma)); row <= Math.min(height-1, Math.ceil(center+3.5*sigma)); row++) {
        const d = (row+.5-center)/sigma;
        const density = .76*Math.exp(-.5*d*d) + .24*Math.exp(-.5*(d/.48)**2);
        const offset = (row*width+col)*4, opacity = Math.round(255*alpha*density);
        if (opacity <= data[offset+3]) continue;
        data[offset] = color[0]; data[offset+1] = color[1]; data[offset+2] = color[2]; data[offset+3] = opacity;
      }
    });
    surface.ctx.putImageData(surface.pixels, 0, 0);
    context.save(); context.globalCompositeOperation = 'source-over';
    context.drawImage(surface.canvas, left, top, width/ratio, height/ratio); context.restore();
  }
  return { PREFERENCE_KEY, DETECTOR_DEFAULTS, PLUME_DEFAULTS, AURORA, readPreferences,
    plumeSegments, auroraStyle, visitPlumeColumns, drawConfidencePlume };
});
