(function exposeChoirUiPreferences(global) {
  'use strict';

  const KEY = 'choir-ui-preferences:v1';
  const DEFAULT_LYRIC_SCALE = 1.5;
  const clampLyricScale = value => Math.max(1, Math.min(2, Number(value) || DEFAULT_LYRIC_SCALE));

  function read(storage = global.localStorage) {
    try {
      const saved = JSON.parse(storage.getItem(KEY));
      // `textScale` was briefly used for the whole interface. Keep it as a
      // migration source, but from now on the preference affects lyrics only.
      return clampLyricScale(saved?.lyricScale ?? saved?.textScale);
    } catch (_) { return DEFAULT_LYRIC_SCALE; }
  }

  function apply(lyricScale) {
    const scale = clampLyricScale(lyricScale);
    const root = global.document?.documentElement;
    if (root) {
      root.style.removeProperty('--ui-text-scale');
      root.style.removeProperty('font-size');
      root.style.setProperty('--lyric-text-scale', String(scale));
    }
    return scale;
  }

  function write(lyricScale, storage = global.localStorage) {
    const scale = apply(lyricScale);
    try { storage.setItem(KEY, JSON.stringify({ lyricScale: scale })); } catch (_) { /* Storage is optional. */ }
    return scale;
  }

  const api = { KEY, DEFAULT_LYRIC_SCALE, clampLyricScale, read, apply, write };
  global.ChoirUiPreferences = api;
  apply(read());
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
