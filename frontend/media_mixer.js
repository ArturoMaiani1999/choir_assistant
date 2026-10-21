(function initChoirMedia(global) {
  'use strict';

  function clampLevel(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
  }

  // Android's default Bluetooth input opens SCO and can pull music off A2DP.
  // Select the phone only when Chrome exposes both named routes; never guess
  // from device order or change the speaker/AEC path.
  function phoneMicrophone(devices) {
    const inputs = devices.filter(device => device.kind === 'audioinput');
    if (!inputs.some(device => /bluetooth/i.test(device.label))) return null;
    return inputs.find(device => /^(speakerphone|microfono (del )?(telefono|dispositivo)|built-in mic(?:rophone)?)$/i.test(device.label)) ?? null;
  }

  async function acquireMicrophone(mediaDevices, constraints, { preferPhone = false, isCurrent = () => true } = {}) {
    const acquire = device => mediaDevices.getUserMedia(device ? { ...constraints, audio: {
      ...constraints.audio, deviceId: { exact: device.deviceId },
      echoCancellation: { exact: false }, noiseSuppression: { exact: false }, autoGainControl: { exact: false },
    } } : constraints);
    if (!preferPhone) return acquire(null);
    const enumerate = async () => {
      try { return phoneMicrophone(await mediaDevices.enumerateDevices()); } catch (_) { return null; }
    };
    let device = await enumerate();
    if (!isCurrent()) return null;
    if (device) return acquire(device);
    // Labels can remain hidden until permission is granted. Retire that first
    // input before selecting the phone; never keep two captures alive.
    const initial = await acquire(null);
    if (!isCurrent()) { initial.getTracks().forEach(track => track.stop()); return null; }
    device = await enumerate();
    if (!isCurrent()) { initial.getTracks().forEach(track => track.stop()); return null; }
    if (!device) return initial;
    initial.getTracks().forEach(track => track.stop());
    return acquire(device);
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
      this.referenceOutput = null;
      this.calibrationMuted = false;
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
      const audible = this.calibrationMuted ? 0 : level;
      if (typeof gain.setValueAtTime === 'function') gain.setValueAtTime(audible, now);
      else gain.value = audible;
    }

    _setPitchRatio(parameter, ratio) {
      const now = this.context?.currentTime ?? 0;
      if (typeof parameter.cancelScheduledValues === 'function') parameter.cancelScheduledValues(now);
      // Keep the intrinsic value in sync as well as the automation timeline.
      // Chromium can otherwise expose the worklet parameter's default value
      // until the next render quantum, even though an event was scheduled at
      // the current context time.
      parameter.value = ratio;
      if (typeof parameter.setValueAtTime === 'function') parameter.setValueAtTime(ratio, now);
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
        gain.connect(this.referenceOutput || this.context.destination);
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

    muteForCalibration(muted) {
      this.calibrationMuted = Boolean(muted);
      for (const [media, channel] of this.channels) this._setGain(channel, this.levels.get(media) ?? 1);
    }

    async setReferenceOutput(enabled) {
      if (!enabled && !this.referenceOutput) return;
      await this._ensureContext();
      if (!this.context) throw new Error('Elaborazione audio non disponibile.');
      if (!this.referenceOutput) {
        this.referenceOutput = this.context.createGain();
        this.referenceOutput.connect(this.context.destination);
        for (const channel of this.channels.values()) {
          channel.gain.disconnect(); channel.gain.connect(this.referenceOutput);
        }
      }
      // A single acoustic reference is identifiable using a mono loudspeaker
      // feed. Headphone mode restores the normal stereo channel negotiation.
      this.referenceOutput.channelCount = enabled ? 1 : 2;
      this.referenceOutput.channelCountMode = enabled ? 'explicit' : 'max';
    }

    referenceCovers(mediaElements) {
      return Boolean(this.referenceOutput) && mediaElements.every(media =>
        (this.levels.get(media) ?? 1) <= 0 || this.channels.has(media));
    }

    setTranspose(semitones) {
      const numeric = Number(semitones);
      this.transposeSemitones = Number.isFinite(numeric) ? Math.max(-12, Math.min(12, numeric)) : 0;
      const ratio = 2 ** (this.transposeSemitones / 12);
      for (const channel of this.channels.values()) {
        const parameter = channel.pitch?.parameters?.get?.('ratio');
        if (!parameter) continue;
        this._setPitchRatio(parameter, ratio);
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

  const api = { MediaElementMixer, clampLevel, buildMediaPlaybackPlan, acquireMicrophone, phoneMicrophone };
  global.ChoirMedia = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
