(function personalRecordingModule(global) {
  'use strict';

  async function api(path, options) {
    const response = await global.ChoirAuthFetch(path, { cache: 'no-store', ...options });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const error = new Error(payload?.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  async function save(metadata, audio, pitchDocument) {
    const form = new FormData();
    Object.entries(metadata).forEach(([key, value]) => form.set(key, String(value)));
    form.set('audio', audio, audio.type.startsWith('audio/mp4') ? 'voce.m4a'
      : audio.type.startsWith('audio/ogg') ? 'voce.ogg' : 'voce.webm');
    form.set('pitch', new Blob([JSON.stringify(pitchDocument)], { type: 'application/json' }), 'pitch.json');
    return api('/api/recordings', { method: 'POST', body: form });
  }

  global.PersonalRecordings = Object.freeze({
    saveEchoDiagnostic: (id, metadata, blob) => {
      const query = new URLSearchParams({ id, pieceId: metadata.pieceId, scoreVersionId: metadata.scoreVersion, partId: metadata.partId });
      return api(`/api/echo-diagnostics?${query}`, { method: 'POST', headers: {
        'Content-Type': 'audio/wav', 'X-Diagnostic-Consent': 'capture-store-share-v1',
      }, body: blob, signal: AbortSignal.timeout(180000) });
    },
    echoDiagnostics: pieceId => api(`/api/echo-diagnostics?pieceId=${encodeURIComponent(pieceId)}`),
    deleteEchoDiagnostic: id => api(`/api/echo-diagnostics/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    mine: pieceId => api(`/api/recordings/mine?pieceId=${encodeURIComponent(pieceId)}`),
    automaticBest: () => api('/api/recordings/automatic-best'),
    setAutomaticBest: enabled => api('/api/recordings/automatic-best', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    }),
    pitch: recording => api(recording.pitchUrl),
    save,
    setSharing: (id, sharedForAnalysis) => api(`/api/recordings/${encodeURIComponent(id)}/sharing`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sharedForAnalysis }),
    }),
    delete: id => api(`/api/recordings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  });
})(window);
