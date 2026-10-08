(function initChoirMedia(global) {
  'use strict';

  function clampLevel(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
  }

  function buildMediaPlaybackPlan({
    mixFile = null,
    accompanimentFile = null,
    accompanimentEnabled = true,
    voiceStems = {},
    selectedVoiceIds = [],
    preferFullMix = true,
  } = {}) {
    const availableStems = Object.entries(voiceStems ?? {})
      .filter(([partId, file]) => Boolean(partId) && Boolean(file));
    const selected = new Set(selectedVoiceIds ?? []);
    const selectedStems = availableStems
      .filter(([partId]) => selected.has(partId))
      .map(([partId, file]) => ({ partId, file }));
    const enabledAccompaniment = accompanimentEnabled ? accompanimentFile : null;
    const useFullMix = Boolean(mixFile) && preferFullMix && (!accompanimentFile || accompanimentEnabled)
      && availableStems.length > 0
      && selectedStems.length === availableStems.length;

    if (useFullMix) {
      return {
        kind: 'full-mix',
        masterFile: mixFile,
        masterPartId: null,
        silentMaster: false,
        voiceStems: [],
      };
    }

    if (availableStems.length > 0 && selectedStems.length === 0 && !enabledAccompaniment) {
      return { kind: 'muted', masterFile: null, masterPartId: null, silentMaster: true, voiceStems: [] };
    }

    // With no accompaniment, use an isolated voice as the clock. A muted
    // full-score master can leak the complete mix on some media/Web Audio
    // implementations, so it must not be loaded for an audible voice mix.
    const masterVoice = !enabledAccompaniment ? selectedStems[0] : null;

    return {
      kind: 'stem-mix',
      masterFile: enabledAccompaniment || masterVoice?.file || mixFile || null,
      masterPartId: masterVoice?.partId ?? null,
      silentMaster: !enabledAccompaniment && !masterVoice && availableStems.length > 0,
      voiceStems: masterVoice ? selectedStems.slice(1) : selectedStems,
    };
  }

  class MediaElementMixer {
    constructor({
      AudioContextClass = global.AudioContext || global.webkitAudioContext,
      AudioWorkletNodeClass = global.AudioWorkletNode,
      pitchWorkletUrl = null,
    } = {}) {
      this.AudioContextClass = AudioContextClass;
      this.AudioWorkletNodeClass = AudioWorkletNodeClass;
      this.pitchWorkletUrl = pitchWorkletUrl;
      this.context = null;
      this.channels = new Map();
      this.levels = new WeakMap();
      this.unroutable = new WeakSet();
      this.transposeSemitones = 0;
      this.workletReady = false;
      this.workletPromise = null;
    }

    async _ensureContext() {
      if (!this.context && this.AudioContextClass) this.context = new this.AudioContextClass();
      if (!this.context || !this.pitchWorkletUrl || !this.context.audioWorklet || !this.AudioWorkletNodeClass) return;
      if (!this.workletPromise) {
        this.workletPromise = this.context.audioWorklet.addModule(this.pitchWorkletUrl)
          .then(() => { this.workletReady = true; })
          .catch((error) => { console.warn('Pitch shifter unavailable; audio remains in the original key', error); });
      }
      await this.workletPromise;
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
        let pitch = null;
        if (this.workletReady && this.AudioWorkletNodeClass) {
          pitch = new this.AudioWorkletNodeClass(this.context, 'choir-pitch-shifter', {
            parameterData: { ratio: 2 ** (this.transposeSemitones / 12) },
          });
          source.connect(pitch);
          pitch.connect(gain);
        } else source.connect(gain);
        gain.connect(this.context.destination);
        const channel = { source, pitch, gain };
        this.channels.set(media, channel);
        media.volume = 1;
        const level = this.levels.get(media) ?? 1;
        media.muted = level <= 0;
        this._setGain(channel, level);
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
        media.muted = level <= 0;
        this._setGain(channel, level);
      } else {
        this._applyFallback(media, level);
      }
    }

    async resume(mediaElements = []) {
      await this._ensureContext();
      if (!this.context) return false;
      if (this.transposeSemitones && !this.workletReady) {
        throw new Error('Pitch-preserving transposition is unavailable in this browser');
      }
      for (const media of mediaElements) this._attach(media);
      if (this.context.state === 'suspended' && typeof this.context.resume === 'function') {
        await this.context.resume();
      }
      // AudioParams created while the context was suspended can still report
      // their default value for the first render quantum. Reapply on resume.
      this.setTranspose(this.transposeSemitones);
      return this.context.state !== 'suspended';
    }

    setTranspose(semitones) {
      const numeric = Number(semitones);
      this.transposeSemitones = Number.isFinite(numeric) ? Math.max(-12, Math.min(12, numeric)) : 0;
      const ratio = 2 ** (this.transposeSemitones / 12);
      for (const channel of this.channels.values()) {
        const parameter = channel.pitch?.parameters?.get?.('ratio');
        if (!parameter) continue;
        if (typeof parameter.setValueAtTime === 'function') parameter.setValueAtTime(ratio, this.context?.currentTime ?? 0);
        else parameter.value = ratio;
      }
      return this.transposeSemitones;
    }

    release(media) {
      if (!media) return;
      media.pause();
      const channel = this.channels.get(media);
      if (channel) {
        try { channel.source.disconnect(); } catch (_) { /* Already disconnected. */ }
        try { channel.pitch?.disconnect(); } catch (_) { /* Already disconnected. */ }
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
