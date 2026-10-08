(function initChoirMedia(global) {
  'use strict';

  function clampLevel(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
  }

  function buildMediaPlaybackPlan({
    mixFile = null,
    accompanimentFile = null,
    voiceStems = {},
    selectedVoiceIds = [],
  } = {}) {
    const availableStems = Object.entries(voiceStems ?? {})
      .filter(([partId, file]) => Boolean(partId) && Boolean(file));
    const selected = new Set(selectedVoiceIds ?? []);
    const selectedStems = availableStems
      .filter(([partId]) => selected.has(partId))
      .map(([partId, file]) => ({ partId, file }));
    const useFullMix = Boolean(mixFile)
      && availableStems.length > 0
      && selectedStems.length === availableStems.length;

    if (useFullMix) {
      return {
        kind: 'full-mix',
        masterFile: mixFile,
        silentMaster: false,
        voiceStems: [],
      };
    }

    return {
      kind: 'stem-mix',
      masterFile: accompanimentFile || mixFile || null,
      // Without accompaniment, the full score is only the media clock while
      // the selected stems provide the audible output.
      silentMaster: !accompanimentFile && availableStems.length > 0,
      voiceStems: selectedStems,
    };
  }

  class MediaElementMixer {
    constructor({ AudioContextClass = global.AudioContext || global.webkitAudioContext } = {}) {
      this.AudioContextClass = AudioContextClass;
      this.context = null;
      this.channels = new Map();
      this.levels = new WeakMap();
      this.unroutable = new WeakSet();
    }

    _applyFallback(media, level) {
      // iPadOS may ignore programmatic volume changes, but it does honour muted.
      media.volume = level;
      media.muted = level <= 0;
    }

    _setGain(channel, level) {
      const gain = channel.gain.gain;
      const now = this.context?.currentTime ?? 0;
      if (typeof gain.cancelScheduledValues === 'function') gain.cancelScheduledValues(now);
      if (typeof gain.setValueAtTime === 'function') gain.setValueAtTime(level, now);
      else gain.value = level;
    }

    _attach(media) {
      if (!this.context || this.channels.has(media) || this.unroutable.has(media)) {
        return this.channels.get(media) ?? null;
      }
      try {
        const source = this.context.createMediaElementSource(media);
        const gain = this.context.createGain();
        source.connect(gain);
        gain.connect(this.context.destination);
        const channel = { source, gain };
        this.channels.set(media, channel);
        media.volume = 1;
        media.muted = false;
        this._setGain(channel, this.levels.get(media) ?? 1);
        return channel;
      } catch (error) {
        // Keep ordinary media playback usable if Web Audio is unavailable.
        this.unroutable.add(media);
        this._applyFallback(media, this.levels.get(media) ?? 1);
        console.warn('Web Audio mixer unavailable for media element', error);
        return null;
      }
    }

    setLevel(media, value, { forceMuted = false } = {}) {
      if (!media) return;
      const level = forceMuted ? 0 : clampLevel(value);
      this.levels.set(media, level);
      const channel = this._attach(media);
      if (channel) {
        media.volume = 1;
        media.muted = false;
        this._setGain(channel, level);
      } else {
        this._applyFallback(media, level);
      }
    }

    async resume(mediaElements = []) {
      if (!this.context && this.AudioContextClass) this.context = new this.AudioContextClass();
      if (!this.context) return false;
      for (const media of mediaElements) this._attach(media);
      if (this.context.state === 'suspended' && typeof this.context.resume === 'function') {
        await this.context.resume();
      }
      return this.context.state !== 'suspended';
    }

    release(media) {
      if (!media) return;
      media.pause();
      const channel = this.channels.get(media);
      if (channel) {
        try { channel.source.disconnect(); } catch (_) { /* Already disconnected. */ }
        try { channel.gain.disconnect(); } catch (_) { /* Already disconnected. */ }
        this.channels.delete(media);
      }
      this.levels.delete(media);
      this.unroutable.delete(media);
      media.removeAttribute('src');
      media.load();
    }
  }

  const api = { MediaElementMixer, clampLevel, buildMediaPlaybackPlan };
  global.ChoirMedia = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
