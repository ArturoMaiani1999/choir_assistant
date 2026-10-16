(function personalRecordingModule(global) {
  'use strict';

  async function api(path, options) {
    const response = await fetch(path, { cache: 'no-store', ...options });
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
    mine: pieceId => api(`/api/recordings/mine?pieceId=${encodeURIComponent(pieceId)}`),
    pitch: recording => api(recording.pitchUrl),
    save,
    delete: id => api(`/api/recordings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  });
})(window);
