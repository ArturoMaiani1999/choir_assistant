(function performanceSharingModule(global) {
  'use strict';

  const PROFILE = 'pitch-v1-original-100-complete-c60';
  const MIN_COVERAGE = 60;

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Esportazione PNG non riuscita')),
      'image/png', 0.92));
  }

  function renderPianoRoll({ title, partName, scoreVersionId, scoringProfile, score, coverage, totalBeats, targetEvents, pitchSamples, measures }) {
    const width = Math.min(4096, Math.max(1600, Math.ceil(totalBeats * 20)));
    const height = 760;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const plot = { left: 72, right: width - 28, top: 126, bottom: height - 66 };
    const pitches = [
      ...targetEvents.map(event => event.midiPitch),
      ...pitchSamples.map(sample => sample.displayPitch),
    ].filter(Number.isFinite);
    const minPitch = Math.floor(Math.min(...pitches, 48)) - 2;
    const maxPitch = Math.ceil(Math.max(...pitches, 72)) + 2;
    const x = beat => plot.left + Math.max(0, Math.min(totalBeats, beat)) / Math.max(1, totalBeats) * (plot.right - plot.left);
    const y = pitch => plot.bottom - (pitch - minPitch) / Math.max(1, maxPitch - minPitch) * (plot.bottom - plot.top);

    ctx.fillStyle = '#071419'; ctx.fillRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, 'rgba(26,67,72,.48)'); gradient.addColorStop(1, 'rgba(5,18,24,.1)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#f0e8d8'; ctx.font = '700 28px Inter, sans-serif'; ctx.fillText(title || 'Brano', 28, 40);
    ctx.fillStyle = '#9db4b3'; ctx.font = '16px Inter, sans-serif'; ctx.fillText(`${partName || 'Parte'} · best score condiviso`, 28, 70);
    ctx.fillStyle = '#e7bb72'; ctx.font = '700 24px Inter, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(`${score}%`, width - 28, 40);
    ctx.fillStyle = '#9db4b3'; ctx.font = '14px Inter, sans-serif'; ctx.fillText(`copertura ${coverage.toFixed(1)}%`, width - 28, 68);

    for (let pitch = minPitch; pitch <= maxPitch; pitch += 1) {
      const py = y(pitch), dark = ![0, 2, 4, 5, 7, 9, 11].includes(((pitch % 12) + 12) % 12);
      ctx.fillStyle = dark ? 'rgba(0,5,9,.26)' : 'rgba(180,213,207,.045)';
      ctx.fillRect(plot.left, y(pitch + .5), plot.right - plot.left, Math.abs(y(pitch - .5) - y(pitch + .5)));
      if (pitch % 12 === 0) {
        ctx.fillStyle = '#829a99'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(`Do ${Math.floor(pitch / 12) - 1}`, plot.left - 8, py + 4);
      }
    }
    for (const measure of measures || []) {
      const px = x(measure.startBeat);
      ctx.strokeStyle = 'rgba(226,180,101,.30)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, plot.top); ctx.lineTo(px, plot.bottom); ctx.stroke();
      ctx.fillStyle = '#a88a5d'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(String(measure.number ?? ''), px + 3, plot.top - 8);
    }
    for (const event of targetEvents) {
      const px = x(event.onsetBeat), end = x(event.onsetBeat + event.durationBeats), py = y(event.midiPitch);
      const lane = Math.max(4, (plot.bottom - plot.top) / Math.max(1, maxPitch - minPitch));
      ctx.fillStyle = '#c49450'; ctx.fillRect(px, py - lane * .42, Math.max(2, end - px - 1), lane * .84);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top); ctx.clip();
    ctx.strokeStyle = '#70ddd1'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); let previous = null;
    for (const sample of [...pitchSamples].sort((a, b) => a.beat - b.beat)) {
      if (!Number.isFinite(sample.displayPitch) || !Number.isFinite(sample.beat)) { previous = null; continue; }
      const point = { beat: sample.beat, pitch: sample.displayPitch };
      if (!previous || point.beat - previous.beat > .3 || Math.abs(point.pitch - previous.pitch) > 12) ctx.moveTo(x(point.beat), y(point.pitch));
      else ctx.lineTo(x(point.beat), y(point.pitch));
      previous = point;
    }
    ctx.stroke(); ctx.restore();
    ctx.strokeStyle = 'rgba(202,224,219,.32)'; ctx.strokeRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
    ctx.fillStyle = '#78908f'; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('La tua voce', plot.left, height - 28); ctx.fillStyle = '#70ddd1'; ctx.fillRect(plot.left + 82, height - 38, 34, 4);
    ctx.fillStyle = '#78908f'; ctx.fillText('Melodia', plot.left + 146, height - 28); ctx.fillStyle = '#c49450'; ctx.fillRect(plot.left + 206, height - 40, 34, 8);
    ctx.fillStyle = '#607a79'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(`${scoreVersionId} · ${scoringProfile}`, plot.right, height - 28);
    return canvasBlob(canvas);
  }

  async function api(path, options) {
    const response = await fetch(path, { cache: 'no-store', ...options });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  async function submitBest(metadata, image) {
    const form = new FormData();
    Object.entries(metadata).forEach(([key, value]) => form.set(key, String(value)));
    form.set('image', image, 'piano-roll.png');
    return api('/api/performances/best', { method: 'POST', body: form });
  }

  global.PerformanceSharing = Object.freeze({
    PROFILE, MIN_COVERAGE, renderPianoRoll, submitBest,
    me: () => api('/api/me'),
    mine: () => api('/api/performances/mine'),
    groups: () => api('/api/groups'),
    group: id => api(`/api/groups/${encodeURIComponent(id)}/performances`),
    delete: id => api(`/api/performances/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  });
})(window);

