(function progressTrackingModule(global) {
  'use strict';

  const TERMS_VERSION = '2026-10-16-v1';

  async function api(path, options = {}) {
    const response = await global.ChoirAuthFetch(path, { cache: 'no-store', ...options });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error || `HTTP ${response.status}`);
      error.status = response.status; error.payload = payload;
      throw error;
    }
    return payload;
  }

  global.ProgressTracking = Object.freeze({
    TERMS_VERSION,
    consent: () => api('/api/progress/consent'),
    accept: () => api('/api/progress/consent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: TERMS_VERSION, accepted: true }),
    }),
    assignments: () => api('/api/progress/assignments'),
    submit: attempt => api('/api/progress/attempts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(attempt),
    }),
    aggregate: pieceId => api(`/api/progress/pieces/${encodeURIComponent(pieceId)}/aggregate`),
    revoke: pieceId => api(`/api/progress/pieces/${encodeURIComponent(pieceId)}`, { method: 'DELETE' }),
  });
})(window);
