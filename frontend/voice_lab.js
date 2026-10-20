(function () {
  'use strict';

  const Core = window.VoiceLabCore;
  const { detectPitch, PitchSmoother } = window.ChoirPitch;
  const { OneEuroFilter } = window.ChoirOneEuro;
  const PitchShared = window.ChoirPitchShared;
  const FluidPitchTrail = window.ChoirFluidPitchTrail;
  const $ = (id) => document.getElementById(id);
  const ids = ['lab-settings', 'lab-settings-dialog', 'lab-role', 'lab-low', 'lab-high', 'lab-range-keyboard',
    'lab-range-preview', 'lab-range-error', 'lab-settings-save', 'lab-settings-close', 'lab-voice-volume',
    'lab-pad-enabled',
    'lab-voice-volume-value', 'lab-score', 'lab-score-image', 'lab-roll', 'lab-fluid-layer', 'lab-state', 'lab-level',
    'warmup-mode-copy', 'warmup-inversions', 'warmup-degree-levels', 'warmup-plan-kicker', 'warmup-plan-title', 'warmup-plan-detail', 'warmup-start',
    'warmup-kind', 'warmup-title', 'warmup-instruction', 'warmup-quality', 'warmup-progress', 'warmup-phase',
    'warmup-phase-kicker', 'warmup-phase-title', 'warmup-beats', 'warmup-time', 'warmup-score-caption',
    'warmup-roll-caption', 'warmup-cancel', 'warmup-main-action', 'warmup-replay', 'warmup-feedback',
    'warmup-feedback-title', 'warmup-feedback-message', 'warmup-feedback-summary', 'warmup-segments',
    'warmup-retry', 'warmup-step-up', 'warmup-next', 'warmup-choose', 'warmup-prepare', 'warmup-workspace',
    'warmup-back-choose', 'warmup-ear-exercises', 'warmup-prepare-kicker', 'warmup-prepare-title',
    'warmup-feedback-details', 'warmup-navigation', 'warmup-location',
    'warmup-back-prepare', 'warmup-lesson-intro',
    'warmup-lesson-score', 'warmup-lesson-key', 'warmup-lesson-notes',
    'warmup-instructions', 'warmup-instructions-dialog', 'warmup-demo-close', 'warmup-demo-replay',
    'warmup-demo-step', 'warmup-demo-title', 'warmup-demo-copy', 'warmup-demo-score',
    'warmup-demo-beats', 'warmup-demo-caption', 'warmup-demo-tempo',
    'warmup-position-options', 'warmup-level-options'];
  const els = Object.fromEntries(ids.map((id) => [id.replaceAll('-', '_'), $(id)]));
  const STORE = 'choir-voice-lab:v2';
  const MAX_RESULTS = 300;
  const sharedPitch = PitchShared.readPreferences();
  const fluidTrailRenderer = new FluidPitchTrail.Renderer(els.lab_fluid_layer);
  function freshRoutineSeed() {
    try { const value = new Uint32Array(1); crypto.getRandomValues(value); return value[0] || 1; }
    catch (_) { return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0 || 1; }
  }
  const state = {
    screen: 'choose', path: 'scale', mode: 'model', family: 'scale', inversion: 'root', degreeLevel: 'base', degreeSeed: freshRoutineSeed(),
    bpm: 60, role: 'tenor', range: { ...Core.ROLE_RANGES.tenor },
    routine: null, routineIndex: 0, exercise: null, pendingExercise: null, ascentSteps: 0,
    analysis: null, phase: 'idle', running: false,
    reviewing: false, generation: 0, audio: null, voiceOutput: null, voiceRoom: null,
    voiceVolume: 1, ambienceEnabled: true, voiceBuffers: new Map(), phraseBuffers: new Map(), padBuffers: new Map(),
    sources: [], timers: [], animationFrame: null, stream: null, input: null, analyser: null, microphoneGeneration: 0,
    monitorFrame: null, monitorBuffer: null, monitorSmoother: null, monitorFilter: new OneEuroFilter(),
    detectorSettings: sharedPitch.detector, plumeSettings: sharedPitch.plume, frames: [], visualFrames: [],
    livePitch: null, elapsedSeconds: 0, previewAt: 0, countInAt: 0, takeAt: 0, endAt: 0,
    mediaRecorder: null, chunks: [], audioUrl: null, recordingStarted: false,
  };
  let needsRoleSetup = true;
  let pendingStart = false;
  let voiceProfileReady = Promise.resolve();
  try {
    const role = localStorage.getItem(`${STORE}:role`) || localStorage.getItem('choir-voice-lab:v1:role');
    if (role && Core.ROLE_RANGES[role]) { state.role = role; needsRoleSetup = false; }
    state.range = { ...Core.ROLE_RANGES[state.role] };
    const savedRange = JSON.parse(localStorage.getItem(`${STORE}:range`) || localStorage.getItem('choir-voice-lab:v1:range'));
    if (Core.validateRange(savedRange)) state.range = savedRange;
    const savedVolumeValue = localStorage.getItem(`${STORE}:voice-volume`);
    if (savedVolumeValue !== null && Number.isFinite(Number(savedVolumeValue)))
      state.voiceVolume = Math.max(0, Math.min(2, Number(savedVolumeValue)));
    const savedInversion = localStorage.getItem(`${STORE}:inversion`);
    if ([...Core.TRIAD_INVERSIONS, 'all'].includes(savedInversion)) state.inversion = savedInversion;
    const savedDegreeLevel = localStorage.getItem(`${STORE}:degree-level`);
    if (Object.hasOwn(Core.DEGREE_LEVELS, savedDegreeLevel)) state.degreeLevel = savedDegreeLevel;
    const savedAmbience = localStorage.getItem(`${STORE}:ambience`);
    if (savedAmbience !== null) state.ambienceEnabled = savedAmbience === 'true';
  } catch (_) {}

  function activeRecognitionSettings() { return PitchShared.recognitionSettings(state.detectorSettings); }
  function audioContext() { return state.audio ??= new (window.AudioContext || window.webkitAudioContext)(); }
  function roomImpulse(context) {
    const duration = 1.05, length = Math.round(context.sampleRate * duration);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    let seed = 0x51f15e;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const reflections = [[.019, .42], [.033, .3], [.052, .23], [.078, .15]];
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = impulse.getChannelData(channel); let smoothed = 0;
      for (let index = 0; index < length; index += 1) {
        const white = random() * 2 - 1; smoothed = smoothed * .78 + white * .22;
        const time = index / context.sampleRate, decay = Math.exp(-time * 5.8);
        samples[index] = (white * .18 + smoothed * .82) * decay * .19;
      }
      reflections.forEach(([seconds, level], index) => {
        const position = Math.min(length - 1, Math.round((seconds + channel * .0017 + index * .0004) * context.sampleRate));
        samples[position] += level;
      });
    }
    return impulse;
  }
  function voiceOutput() {
    if (!state.voiceOutput) {
      const context = audioContext(), dry = context.createGain(), convolver = context.createConvolver();
      const damping = context.createBiquadFilter(), wet = context.createGain();
      state.voiceOutput = context.createGain();
      state.voiceOutput.gain.value = state.voiceVolume;
      dry.gain.value = .96; wet.gain.value = .075; damping.type = 'lowpass'; damping.frequency.value = 4200;
      convolver.buffer = roomImpulse(context); convolver.normalize = true;
      state.voiceOutput.connect(dry).connect(context.destination);
      state.voiceOutput.connect(convolver).connect(damping).connect(wet).connect(context.destination);
      state.voiceRoom = { dry, convolver, damping, wet };
    }
    return state.voiceOutput;
  }
  function reportAudioEvent(kind, at, details = {}) {
    window.dispatchEvent(new CustomEvent('voice-lab-audio-event', { detail: { kind, at, ...details } }));
  }
  function visuallyAdvancedPitchTime(time) {
    const advanceMs = Math.max(0, Math.min(PitchShared.PLUME_ADVANCE_MAX_MS,
      Number(state.plumeSettings.timeAdvanceMs) || 0));
    return time - advanceMs / 1000;
  }
  function secondsLabel(value) { return Number.isFinite(value) ? value.toFixed(1).replace('.', ',') : '—'; }
  function canvasContext(canvas, fallbackHeight = 220) {
    const ratio = devicePixelRatio || 1, width = canvas.clientWidth || 640, height = canvas.clientHeight || fallbackHeight;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width, height, ratio };
  }

  function choirAnchor(midi, role = state.role) {
    const anchors = Core.CHOIR_ANCHORS[role] ?? Core.CHOIR_ANCHORS.tenor;
    return anchors.reduce((best, value) => Math.abs(value - midi) < Math.abs(best - midi) ? value : best, anchors[0]);
  }

  async function loadVoiceSample(midi, role = state.role) {
    const anchor = choirAnchor(midi, role), key = `${role}-${anchor}`;
    if (state.voiceBuffers.has(key)) return state.voiceBuffers.get(key);
    const pending = fetch(`voice-lab-assets/choir/${role}-${anchor}.flac`).then((response) => {
      if (!response.ok) throw new Error(`Muse Choir ${role} non disponibile`);
      return response.arrayBuffer();
    }).then((data) => audioContext().decodeAudioData(data)).then((buffer) => {
      let squares = 0, samples = 0, peak = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const values = buffer.getChannelData(channel);
        for (let index = 0; index < values.length; index += 1) {
          squares += values[index] ** 2; samples += 1; peak = Math.max(peak, Math.abs(values[index]));
        }
      }
      const rms = samples ? Math.sqrt(squares / samples) : 0;
      if (rms < .0001) throw new Error(`Campione Muse Choir ${role} silenzioso`);
      return { buffer, anchor, role, rms, peak, normalizationGain: Core.referenceNormalizationGain(rms, peak) };
    });
    state.voiceBuffers.set(key, pending);
    try { const asset = await pending; state.voiceBuffers.set(key, asset); return asset; }
    catch (error) { state.voiceBuffers.delete(key); throw error; }
  }

  function measureBuffer(buffer, label, normalizationOptions = {}) {
    let squares = 0, samples = 0, peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const values = buffer.getChannelData(channel);
      for (let index = 0; index < values.length; index += 1) {
        squares += values[index] ** 2; samples += 1; peak = Math.max(peak, Math.abs(values[index]));
      }
    }
    const rms = samples ? Math.sqrt(squares / samples) : 0;
    if (rms < .0001) throw new Error(`${label} silenzioso`);
    return { buffer, rms, peak, normalizationGain: Core.referenceNormalizationGain(rms, peak, normalizationOptions) };
  }

  function loadAudioAsset(cache, key, url, label, normalizationOptions = {}) {
    if (cache.has(key)) return cache.get(key);
    const pending = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${label} non disponibile`);
      return response.arrayBuffer();
    }).then((data) => audioContext().decodeAudioData(data))
      .then((buffer) => measureBuffer(buffer, label, normalizationOptions));
    cache.set(key, pending);
    return pending.then((asset) => { cache.set(key, asset); return asset; })
      .catch((error) => { cache.delete(key); throw error; });
  }

  function phraseKey(exercise) {
    return `${exercise.patternId}-r${exercise.rootMidi}-p${exercise.previewBpm}-${state.role}`;
  }

  function loadGuidePhrase(exercise) {
    const key = phraseKey(exercise);
    return loadAudioAsset(state.phraseBuffers, key, `voice-lab-assets/phrases/${key}.flac`, 'Frase Muse Choir');
  }

  function supportsRenderedPhrase(exercise) {
    return exercise.mode === 'model' && (exercise.patternId === 'scale-major' || exercise.patternId.startsWith('triad-'));
  }

  function padKey(exercise) {
    const quality = exercise.quality === 'minor' ? 'minor' : 'major';
    return `${quality}-pc${((exercise.rootMidi % 12) + 12) % 12}`;
  }
  function loadPad(exercise) {
    const key = padKey(exercise);
    return loadAudioAsset(state.padBuffers, key, `voice-lab-assets/pads/${key}.flac`, 'Pad armonico',
      { targetRms: .1, loudestCueGain: .05 });
  }

  async function preloadExercise(exercise) {
    let phrase = null;
    if (supportsRenderedPhrase(exercise)) {
      try { phrase = await loadGuidePhrase(exercise); }
      catch (_) { throw new Error('La voce guida non è disponibile. Premi Comincia per riprovare.'); }
    }
    const pitches = phrase ? [exercise.rootMidi] : [exercise.rootMidi, ...exercise.events.map((event) => event.midi)];
    await Promise.all([...new Set(pitches)].map((midi) => loadVoiceSample(midi)));
    if (state.ambienceEnabled && supportsRenderedPhrase(exercise)) {
      try { await loadPad(exercise); }
      catch (_) { throw new Error('L’accompagnamento non è disponibile. Riprova o disattivalo in Impostazioni.'); }
    }
  }

  function playChoirNote(midi, at, duration, gainValue, kind = 'model') {
    const anchor = choirAnchor(midi), asset = state.voiceBuffers.get(`${state.role}-${anchor}`);
    if (!asset || typeof asset.then === 'function') throw new Error('Campione Muse Choir non ancora pronto');
    const context = audioContext(), source = context.createBufferSource(), gain = context.createGain();
    source.buffer = asset.buffer; source.playbackRate.value = 2 ** ((midi - anchor) / 12);
    const available = asset.buffer.duration / source.playbackRate.value;
    if (available < duration) throw new Error('Campione Muse Choir troppo corto');
    const isDrone = kind === 'root-drone';
    const normalizedGain = gainValue * asset.normalizationGain;
    const attack = Math.min(isDrone ? .34 : .055, duration * .22), release = Math.min(isDrone ? .5 : .17, duration * .3);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, normalizedGain), at + attack);
    gain.gain.setValueAtTime(Math.max(.0002, normalizedGain), Math.max(at + attack, at + duration - release));
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(gain).connect(voiceOutput()); source.start(at); source.stop(at + duration + .03);
    state.sources.push(source);
    reportAudioEvent(kind, at, { midi, end: at + duration, anchor, role: state.role, gain: gainValue });
    return source;
  }

  function playInnerEarRoot(exercise, previewAt, countInAt, endAt) {
    const midi = exercise.rootMidi, anchor = choirAnchor(midi);
    const asset = state.voiceBuffers.get(`${state.role}-${anchor}`);
    if (!asset || typeof asset.then === 'function') throw new Error('Campione Muse Choir non ancora pronto');
    const context = audioContext(), source = context.createBufferSource(), gain = context.createGain();
    source.buffer = asset.buffer; source.playbackRate.value = 2 ** ((midi - anchor) / 12);
    const stopAt = endAt + .16, available = asset.buffer.duration / source.playbackRate.value;
    if (available < stopAt - previewAt) throw new Error('Campione Muse Choir troppo corto');
    const foreground = .075 * asset.normalizationGain, background = .025 * asset.normalizationGain;
    const fadeStart = previewAt + Math.min(.7, exercise.previewSeconds * .42);
    gain.gain.setValueAtTime(.0001, previewAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, foreground), previewAt + .075);
    gain.gain.setValueAtTime(Math.max(.0002, foreground), fadeStart);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, background), countInAt);
    gain.gain.setValueAtTime(Math.max(.0002, background), Math.max(countInAt, endAt - .45));
    gain.gain.exponentialRampToValueAtTime(.0001, stopAt);
    source.connect(gain).connect(voiceOutput()); source.start(previewAt); source.stop(stopAt + .03);
    state.sources.push(source);
    reportAudioEvent('root-reference', previewAt, { midi, end: countInAt, anchor, role: state.role,
      gain: .075, continuousFade: true, fadeStart });
    reportAudioEvent('root-drone', countInAt, { midi, end: stopAt, anchor, role: state.role,
      gain: .025, continuousFade: true, fadeStart });
    return source;
  }

  function playGuidePhrase(exercise, at) {
    const key = phraseKey(exercise), asset = state.phraseBuffers.get(key);
    if (!asset || typeof asset.then === 'function') return false;
    const context = audioContext(), source = context.createBufferSource(), gain = context.createGain();
    const bodyEnd = at + exercise.previewSeconds, stopAt = Math.min(at + asset.buffer.duration, bodyEnd + .9);
    source.buffer = asset.buffer;
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, .15 * asset.normalizationGain), at + .045);
    gain.gain.setValueAtTime(Math.max(.0002, .15 * asset.normalizationGain), Math.min(bodyEnd + .55, stopAt - .12));
    gain.gain.exponentialRampToValueAtTime(.0001, stopAt);
    source.connect(gain).connect(voiceOutput()); source.start(at); source.stop(stopAt + .03);
    state.sources.push(source);
    reportAudioEvent('model-phrase', at, { key, role: state.role, rootMidi: exercise.rootMidi,
      previewBpm: exercise.previewBpm, end: stopAt });
    return true;
  }

  function playPad(exercise, at, endAt) {
    if (!state.ambienceEnabled) return false;
    const key = padKey(exercise), asset = state.padBuffers.get(key);
    if (!asset || typeof asset.then === 'function') return false;
    const context = audioContext(), source = context.createBufferSource(), gain = context.createGain();
    const stopAt = Math.min(at + asset.buffer.duration, endAt + .18), level = .038 * asset.normalizationGain;
    source.buffer = asset.buffer;
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, level), at + .75);
    gain.gain.setValueAtTime(Math.max(.0002, level), Math.max(at + .75, endAt - .8));
    gain.gain.exponentialRampToValueAtTime(.0001, stopAt);
    source.connect(gain).connect(voiceOutput()); source.start(at); source.stop(stopAt + .03);
    state.sources.push(source);
    reportAudioEvent('harmonic-pad', at, { key, rootMidi: exercise.rootMidi, end: stopAt });
    return true;
  }

  function metronomeClick(at, accented = false) {
    const context = audioContext(), oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(accented ? 1320 : 920, at);
    gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(accented ? .14 : .085, at + .006);
    gain.gain.exponentialRampToValueAtTime(.0001, at + .072);
    oscillator.connect(gain).connect(context.destination); oscillator.start(at); oscillator.stop(at + .085);
    state.sources.push(oscillator); reportAudioEvent('metronome', at, { accented }); return oscillator;
  }

  function releaseMicrophone() {
    state.microphoneGeneration += 1;
    if (state.monitorFrame) cancelAnimationFrame(state.monitorFrame);
    state.monitorFrame = null; state.monitorBuffer = null; state.monitorSmoother = null; state.livePitch = null;
    state.stream?.getTracks().forEach((track) => track.stop());
    state.input?.disconnect(); state.analyser?.disconnect();
    state.stream = null; state.input = null; state.analyser = null;
    els.lab_level.value = 0;
  }

  async function ensureMicrophone() {
    if (state.stream?.active) { startPitchMonitor(); return; }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error('Il microfono richiede una connessione sicura.');
    const generation = ++state.microphoneGeneration;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false,
      noiseSuppression: false, autoGainControl: true, channelCount: 1 }, video: false });
    if (generation !== state.microphoneGeneration || document.visibilityState === 'hidden') {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException('Pagina non visibile', 'AbortError');
    }
    const context = audioContext(); await context.resume();
    if (generation !== state.microphoneGeneration || document.visibilityState === 'hidden') {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException('Pagina non visibile', 'AbortError');
    }
    state.stream = stream; state.input = context.createMediaStreamSource(stream); state.analyser = context.createAnalyser();
    state.analyser.fftSize = 2048; state.input.connect(state.analyser); startPitchMonitor();
  }

  function suspendVoiceLabForBackground() {
    if (document.visibilityState !== 'hidden') return;
    if (els.warmup_instructions_dialog.open) closeDemo();
    const wasRunning = state.running;
    state.generation += 1; stopRecorder(false); stopScheduledAudio(); setRunning(false); releaseMicrophone();
    void state.audio?.suspend().catch(() => {});
    if (wasRunning) {
      state.phase = 'idle'; state.reviewing = false;
      setPhase('idle', 'Prova sospesa');
      els.warmup_instruction.textContent = 'La prova è stata interrotta e il microfono è stato disattivato.';
      showScreen('prepare');
    }
  }

  function startPitchMonitor() {
    if (state.monitorFrame || !state.analyser) return;
    state.monitorBuffer = new Float32Array(state.analyser.fftSize); state.monitorSmoother = new PitchSmoother();
    state.monitorSmoother.configure({ ...state.detectorSettings, ...activeRecognitionSettings() });
    let lastSampleAt = 0;
    const tick = (now) => {
      if (!state.stream?.active) { state.monitorFrame = null; state.livePitch = null; return; }
      state.monitorFrame = requestAnimationFrame(tick);
      if (state.phase === 'take' || now - lastSampleAt < 50) return;
      lastSampleAt = now; state.analyser.getFloatTimeDomainData(state.monitorBuffer);
      const raw = detectPitch(state.monitorBuffer, audioContext().sampleRate, activeRecognitionSettings());
      const estimate = state.monitorSmoother.update(raw, now), provisional = ['octave-transition', 'large-jump-transition'].includes(estimate.rejectionReason);
      const hz = provisional ? estimate.rawHz : estimate.stable && estimate.accepted ? estimate.hz : null;
      if (Number.isFinite(hz) && hz > 0) state.livePitch = state.monitorFilter.filter(Core.hzToMidi(hz), now / 1000);
      else { state.livePitch = null; state.monitorFilter.reset(); }
      els.lab_level.value = raw.rms || 0;
    };
    state.monitorFrame = requestAnimationFrame(tick);
  }

  function startRecorder() {
    if (state.recordingStarted) return;
    state.recordingStarted = true; state.frames = []; state.visualFrames = []; state.elapsedSeconds = 0;
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = null; els.warmup_replay.disabled = true;
    if (!window.MediaRecorder) return;
    state.chunks = [];
    const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined;
    state.mediaRecorder = new MediaRecorder(state.stream, options);
    state.mediaRecorder.ondataavailable = (event) => { if (event.data.size) state.chunks.push(event.data); };
    state.mediaRecorder.onstop = () => {
      if (!state.chunks.length) return;
      state.audioUrl = URL.createObjectURL(new Blob(state.chunks, { type: state.mediaRecorder.mimeType || 'audio/webm' }));
      els.warmup_replay.disabled = false;
    };
    state.mediaRecorder.start(250);
  }

  function stopRecorder(keep = true) {
    if (state.mediaRecorder?.state === 'recording') {
      if (!keep) state.mediaRecorder.onstop = null;
      state.mediaRecorder.stop();
    }
    if (!keep) state.chunks = [];
    state.recordingStarted = false;
  }

  function stopScheduledAudio() {
    state.sources.forEach((source) => { try { source.stop(); } catch (_) {} }); state.sources = [];
    state.timers.forEach(clearTimeout); state.timers = [];
    if (state.animationFrame != null) cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }

  function setRunning(running) {
    state.running = running; document.body.dataset.running = String(running);
    els.warmup_cancel.disabled = !running; els.warmup_start.disabled = running;
    els.warmup_main_action.disabled = running;
  }

  const SCREEN_ORDER = ['choose', 'prepare', 'session', 'review'];
  const PATH_ORDER = ['scale', 'chords', 'ear'];
  const PATH_NAMES = ['Scala', 'Accordi', 'Orecchio'];
  let historyDepth = Number(history.state?.voiceLabDepth) || 0;
  let restoringHistory = false;
  let pendingNavigationPath = null;
  function navigationConfig() {
    return { path: state.path, family: state.family, mode: state.mode, bpm: state.bpm,
      inversion: state.inversion, degreeLevel: state.degreeLevel, degreeSeed: state.degreeSeed };
  }
  function showScreen(screen, { historyMode = 'replace' } = {}) {
    if (historyMode === 'push' && state.screen === 'prepare' && !restoringHistory) {
      history.replaceState({ ...history.state, voiceLabConfig: navigationConfig() }, '', location.href);
    }
    state.screen = screen;
    document.body.dataset.screen = screen;
    els.warmup_choose.hidden = screen !== 'choose';
    els.warmup_prepare.hidden = screen !== 'prepare';
    els.warmup_workspace.hidden = !['session', 'review'].includes(screen);
    els.warmup_navigation.hidden = screen === 'choose';
    els.warmup_back_prepare.hidden = !['session', 'review'].includes(screen);
    document.querySelector('.warmup-back').hidden = screen !== 'choose';
    const pathIndex = PATH_ORDER.indexOf(state.path);
    els.warmup_location.textContent = `${pathIndex + 1} / ${PATH_ORDER.length} · ${PATH_NAMES[pathIndex]}`;
    document.querySelector('[data-journey="prepare"]').disabled = screen === 'choose';
    const activeIndex = SCREEN_ORDER.indexOf(screen);
    document.querySelectorAll('[data-journey]').forEach((item) => {
      const itemIndex = SCREEN_ORDER.indexOf(item.dataset.journey);
      item.classList.toggle('active', itemIndex === activeIndex);
      item.classList.toggle('done', itemIndex < activeIndex);
      if (itemIndex === activeIndex) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    const route = { choose: 'scegli', prepare: 'prepara', session: 'canta', review: 'risultato' }[screen];
    if (route && !restoringHistory) {
      if (historyMode === 'push') historyDepth += 1;
      const navigation = { voiceLabScreen: screen, voiceLabDepth: historyDepth,
        voiceLabConfig: navigationConfig() };
      history[historyMode === 'push' ? 'pushState' : 'replaceState'](navigation, '', `#${route}`);
    }
    if (screen === 'session' || screen === 'review') requestAnimationFrame(drawViews);
    if (screen === 'choose' || screen === 'prepare') document.querySelector('.warmup-shell')?.scrollTo({ top: 0 });
  }

  function setPhase(phase, title, time = '—') {
    state.phase = phase; els.warmup_phase_kicker.textContent = phase === 'preview' ? 'ASCOLTA'
      : phase === 'count-in' ? 'PREPARATI' : phase === 'take' ? 'CANTA' : phase === 'review' ? 'CONFRONTA' : 'PRONTO';
    els.warmup_phase_title.textContent = title; els.warmup_time.textContent = time;
    els.lab_state.textContent = els.warmup_phase_kicker.textContent;
  }

  function updateBeatDots(activeBeat = -1) {
    [...els.warmup_beats.children].forEach((dot, index) => {
      dot.classList.toggle('active', index === activeBeat); dot.classList.toggle('done', activeBeat > index);
    });
  }

  function currentDegree(elapsed) {
    if (!state.exercise) return null;
    const beat = elapsed / (60 / state.exercise.bpm);
    return state.exercise.events.find((event) => beat >= event.beat && beat < event.beat + event.durationBeats) ?? state.exercise.events.at(-1);
  }

  function scheduleTrial(exercise) {
    const context = audioContext(), previewAt = context.currentTime + .12;
    state.previewAt = previewAt; state.countInAt = previewAt + exercise.previewSeconds + .12;
    state.takeAt = state.countInAt + exercise.countInSeconds; state.endAt = state.takeAt + exercise.durationSeconds;
    if (exercise.mode === 'model') {
      const previewBeat = 60 / exercise.previewBpm;
      if (supportsRenderedPhrase(exercise)) {
        if (!playGuidePhrase(exercise, previewAt)) throw new Error('La voce guida non è pronta. Riprova.');
        playPad(exercise, previewAt, state.takeAt - .08);
      } else exercise.events.forEach((event) => playChoirNote(event.midi, previewAt + event.beat * previewBeat,
        event.durationBeats * previewBeat * 1.06, .14, 'model-note'));
      playChoirNote(exercise.rootMidi, state.countInAt, exercise.countInSeconds + exercise.durationSeconds + .08, .025, 'root-drone');
    } else playInnerEarRoot(exercise, previewAt, state.countInAt, state.endAt);
    const beatSeconds = 60 / exercise.bpm;
    for (let beat = 0; beat < exercise.countInBeats; beat += 1) metronomeClick(state.countInAt + beat * beatSeconds, beat === 0);
    for (let beat = 0; beat <= exercise.totalBeats; beat += 1) metronomeClick(state.takeAt + beat * beatSeconds, beat % 4 === 0);
    reportAudioEvent('exercise', previewAt, { exercise, countInAt: state.countInAt, takeAt: state.takeAt, endAt: state.endAt });
  }

  async function beginTrial() {
    if (state.running || !state.routine) return;
    showScreen('session', { historyMode: state.screen === 'prepare' && historyDepth < 2 ? 'push' : 'replace' });
    state.exercise = state.pendingExercise || state.routine.exercises[state.routineIndex]; state.pendingExercise = null;
    state.reviewing = false; state.analysis = null;
    els.warmup_plan_detail.parentElement.classList.remove('has-error');
    els.warmup_feedback.hidden = true; state.frames = []; state.visualFrames = []; state.elapsedSeconds = 0;
    renderExerciseHeader(); drawViews();
    setRunning(true); setPhase('loading', 'Preparo audio e microfono');
    const generation = ++state.generation;
    try {
      await Promise.all([ensureMicrophone(), preloadExercise(state.exercise)]); await audioContext().resume();
      if (generation !== state.generation) return;
      scheduleTrial(state.exercise); animateTrial(generation);
    } catch (error) {
      if (generation !== state.generation) return;
      releaseMicrophone();
      setRunning(false); setPhase('idle', 'Impossibile iniziare');
      els.warmup_instruction.textContent = error.message;
      els.warmup_plan_detail.textContent = error.message;
      els.warmup_plan_detail.parentElement.classList.add('has-error');
      showScreen('prepare');
    }
  }

  function captureFrame(smoother, displayFilter, buffer, nowMs) {
    state.analyser.getFloatTimeDomainData(buffer);
    const recognition = activeRecognitionSettings(), raw = detectPitch(buffer, audioContext().sampleRate, recognition);
    const estimate = smoother.update(raw, nowMs), elapsed = Math.max(0, audioContext().currentTime - state.takeAt);
    const tracked = estimate.stable && estimate.accepted && Number.isFinite(estimate.hz) ? Core.hzToMidi(estimate.hz) : null;
    const rawPitch = Number.isFinite(estimate.rawHz) ? Core.hzToMidi(estimate.rawHz) : null;
    const provisional = ['octave-transition', 'large-jump-transition'].includes(estimate.rejectionReason);
    let displayPitch = null;
    if (provisional) { displayFilter.reset(); displayPitch = rawPitch; }
    else if (tracked == null) displayFilter.reset();
    else displayPitch = displayFilter.filter(tracked, nowMs / 1000);
    const frame = { time: elapsed, hz: estimate.hz, displayPitch, confidence: estimate.confidence ?? 0,
      clarity: estimate.clarity ?? 0, confirmationState: provisional ? 'provisional' : tracked != null ? 'confirmed' : null };
    state.livePitch = displayPitch; state.frames.push(frame);
    if (!state.visualFrames.length || elapsed - state.visualFrames.at(-1).time >= .025) state.visualFrames.push(frame);
    state.elapsedSeconds = elapsed; els.lab_level.value = raw.rms || 0;
  }

  function animateTrial(generation) {
    const context = audioContext(), buffer = new Float32Array(state.analyser.fftSize), smoother = new PitchSmoother();
    smoother.configure({ ...state.detectorSettings, ...activeRecognitionSettings() });
    const displayFilter = new OneEuroFilter();
    const tick = (nowMs) => {
      if (!state.running || generation !== state.generation) return;
      const now = context.currentTime;
      if (now < state.countInAt) {
        const remaining = Math.max(0, state.countInAt - now);
        setPhase('preview', state.exercise.mode === 'model' ? `Modello a ${state.exercise.previewBpm} BPM` : `Ascolta la fondamentale ${state.exercise.rootName}`, `${secondsLabel(remaining)} s`);
        updateBeatDots(-1);
      } else if (now < state.takeAt) {
        const beat = Math.min(3, Math.floor((now - state.countInAt) / (60 / state.exercise.bpm)));
        setPhase('count-in', `Quattro pulsazioni a ${state.exercise.bpm} BPM`, `${beat + 1} / 4`); updateBeatDots(beat);
      } else if (now < state.endAt) {
        if (!state.recordingStarted) startRecorder();
        captureFrame(smoother, displayFilter, buffer, nowMs);
        const elapsed = Math.max(0, now - state.takeAt), event = currentDegree(elapsed);
        setPhase('take', event ? `Canta · ${event.degree}` : 'Canta', `${secondsLabel(state.exercise.durationSeconds - elapsed)} s`);
        updateBeatDots(-1); drawViews();
      } else { finishTrial(generation); return; }
      state.animationFrame = requestAnimationFrame(tick);
    };
    state.animationFrame = requestAnimationFrame(tick);
  }

  function finishTrial(generation) {
    if (!state.running || generation !== state.generation) return;
    stopRecorder(true); stopScheduledAudio(); releaseMicrophone(); setRunning(false); state.reviewing = true; state.phase = 'review';
    state.elapsedSeconds = state.exercise.durationSeconds;
    state.analysis = Core.analyseSequence(state.exercise, state.frames, { minConfidence: activeRecognitionSettings().minConfidence });
    saveResult(Core.result({ exercise: state.exercise, analysis: state.analysis, role: state.role,
      range: state.range, durationSeconds: state.exercise.durationSeconds,
      deviceAndLatencyConfig: { detector: { ...state.detectorSettings },
        minConfidence: activeRecognitionSettings().minConfidence,
        plumeAdvanceMs: state.plumeSettings.timeAdvanceMs } }));
    setPhase('review', 'Confronta la tua voce', 'Fine'); renderExerciseHeader(); renderFeedback(); showScreen('review'); drawViews();
  }

  function cancelRoutine() {
    state.generation += 1; stopRecorder(false); stopScheduledAudio(); releaseMicrophone(); setRunning(false); state.phase = 'idle';
    state.reviewing = false; state.routineIndex = 0; state.pendingExercise = null; state.ascentSteps = 0;
    state.frames = []; state.visualFrames = []; state.elapsedSeconds = 0;
    els.warmup_feedback.hidden = true; setPhase('idle', 'Routine interrotta'); updateBeatDots(-1); showScreen('prepare');
  }

  function retryTrial() {
    els.warmup_feedback.hidden = true; state.frames = []; state.visualFrames = []; state.reviewing = false;
    state.pendingExercise = state.exercise; showScreen('session'); void beginTrial();
  }

  function nextSemitone() {
    if (state.running || state.exercise?.family !== 'scale' || state.ascentSteps >= Core.MAX_ASCENT_SEMITONES) return;
    const next = Core.transposeExercise(state.exercise, 1, state.range);
    if (!next) return;
    state.ascentSteps += 1; state.pendingExercise = next;
    els.warmup_feedback.hidden = true; showScreen('session'); void beginTrial();
  }

  function nextTrial() {
    els.warmup_feedback.hidden = true;
    if (state.routineIndex < state.routine.exercises.length - 1) { state.routineIndex += 1; showScreen('session'); void beginTrial(); return; }
    state.routineIndex = 0; state.reviewing = false; state.frames = []; state.visualFrames = []; state.analysis = null;
    if (state.family === 'degree') { state.degreeSeed = freshRoutineSeed(); renderPlan(); }
    setPhase('idle', 'Routine completata'); renderExerciseHeader(); showScreen('choose');
  }

  function saveResult(item) {
    try {
      const items = JSON.parse(localStorage.getItem(`${STORE}:results`)) || [];
      items.push(item); localStorage.setItem(`${STORE}:results`, JSON.stringify(items.slice(-MAX_RESULTS)));
    } catch (_) {}
  }

  function renderFeedback() {
    const analysis = state.analysis, last = state.routineIndex === state.routine.exercises.length - 1;
    els.warmup_feedback.hidden = false; els.warmup_feedback_details.open = false;
    els.warmup_feedback_title.textContent = state.exercise.family === 'scale'
      ? `${state.exercise.rootName.replace(/\d+$/, '')} · scala completata`
      : last ? 'Routine completata' : `${state.exercise.name} completato`;
    els.warmup_feedback_message.textContent = analysis.message;
    const offset = !Number.isFinite(analysis.globalOffsetCents) ? '—'
      : Math.abs(analysis.globalOffsetCents) <= 35 ? 'Centrata' : analysis.globalOffsetCents > 0 ? 'Crescente' : 'Calante';
    els.warmup_feedback_summary.innerHTML = [
      ['Note centrate', `${analysis.centeredSegments} / ${analysis.totalSegments}`],
      ['Segnale affidabile', `${analysis.reliableSegments} / ${analysis.totalSegments}`],
      ['Tendenza', offset],
    ].map(([label, value]) => `<div><small>${label}</small><strong>${value}</strong></div>`).join('');
    const statusLabels = { centered: 'Centrata', close: 'Vicina', sharp: 'Crescente', flat: 'Calante', unstable: 'Instabile', uncertain: 'Incerta' };
    els.warmup_segments.classList.toggle('single', state.exercise.family === 'degree');
    els.warmup_segments.innerHTML = analysis.segments.map((segment) => `<span class="${segment.status}"><strong>${segment.degree}</strong><small>${statusLabels[segment.status]}</small></span>`).join('');
    const manualScale = state.exercise.family === 'scale';
    els.warmup_step_up.hidden = !manualScale;
    if (manualScale) {
      const next = state.ascentSteps < Core.MAX_ASCENT_SEMITONES ? Core.transposeExercise(state.exercise, 1, state.range) : null;
      els.warmup_step_up.disabled = !next;
      els.warmup_step_up.textContent = next ? 'Sali di un semitono' : state.ascentSteps >= Core.MAX_ASCENT_SEMITONES ? 'Limite +3 raggiunto' : 'Limite vocale raggiunto';
    }
    els.warmup_next.textContent = manualScale || last ? 'Termina' : `Continua · ${state.routineIndex + 2} di ${state.routine.exercises.length}`;
  }

  function renderPlan() {
    if (state.screen === 'prepare' && !restoringHistory && history.state?.voiceLabScreen === 'prepare') {
      history.replaceState({ ...history.state, voiceLabConfig: navigationConfig() }, '', location.href);
    }
    document.body.dataset.family = state.family;
    els.warmup_plan_detail.parentElement.classList.remove('has-error');
    state.reviewing = false; state.analysis = null; state.frames = []; state.visualFrames = []; state.elapsedSeconds = 0;
    state.pendingExercise = null; state.ascentSteps = 0;
    els.warmup_feedback.hidden = true;
    if (state.audioUrl) { URL.revokeObjectURL(state.audioUrl); state.audioUrl = null; }
    els.warmup_replay.disabled = true;
    try {
      state.routine = Core.buildRoutine({ family: state.family, bpm: state.bpm, mode: state.mode,
        range: state.range, inversion: state.inversion, degreeLevel: state.degreeLevel, seed: state.degreeSeed });
      state.routineIndex = 0; state.exercise = state.routine.exercises[0];
      els.warmup_start.disabled = false; els.warmup_main_action.disabled = false;
      els.warmup_plan_kicker.textContent = `${state.routine.exercises.length} ${state.routine.exercises.length === 1 ? 'ESERCIZIO' : 'ESERCIZI'}`;
      els.warmup_plan_title.textContent = state.routine.label;
      const preview = state.mode === 'model' ? 'Ascolta, poi canta' : 'Canta senza voce guida';
      const route = state.family === 'scale' ? 'Alla fine puoi scegliere se salire di un semitono'
        : state.family === 'arpeggio' ? `Maggiore e minore alternati · ${state.routine.positionLabel}`
          : state.family === 'degree' ? state.degreeLevel === 'base' ? 'Quattro gradi diatonici in ordine casuale' : 'Dodici suoni cromatici in ordine casuale'
            : 'Una tonalità di riferimento';
      els.warmup_plan_detail.textContent = `${preview}. ${route}.`;
      renderExerciseHeader(); drawViews();
    } catch (error) {
      state.routine = null; state.exercise = null; els.warmup_start.disabled = true; els.warmup_main_action.disabled = true;
      els.warmup_plan_kicker.textContent = 'ESTENSIONE NON COMPATIBILE'; els.warmup_plan_title.textContent = 'Modifica il profilo vocale';
      els.warmup_plan_detail.textContent = error.message; els.warmup_instruction.textContent = error.message; drawViews();
      els.warmup_plan_detail.parentElement.classList.add('has-error');
    }
  }

  function renderExerciseHeader() {
    if (!state.exercise || !state.routine) return;
    const modeName = state.mode === 'model' ? 'RISCALDAMENTO' : 'ORECCHIO INTERNO';
    const familyName = state.exercise.family === 'scale' ? 'SCALA 1–5'
      : state.exercise.family === 'degree' ? 'GRADO SINGOLO' : 'ARPEGGI';
    els.warmup_kind.textContent = `${modeName} · ${familyName}`;
    const inversionName = Core.INVERSION_LABELS[state.exercise.inversion];
    els.warmup_title.textContent = state.exercise.family === 'scale' ? `${state.exercise.rootName.replace(/\d+$/, '')} maggiore`
      : state.exercise.family === 'degree' ? `Canta ${state.exercise.events[0].degree} da ${state.exercise.rootName.replace(/\d+$/, '')}`
        : `${state.exercise.rootName.replace(/\d+$/, '')} ${state.exercise.quality === 'major' ? 'maggiore' : 'minore'} · ${inversionName}`;
    els.warmup_quality.textContent = state.exercise.family === 'scale' ? 'MAGGIORE'
      : state.exercise.family === 'degree' ? `LIVELLO ${state.degreeLevel === 'base' ? 'BASE' : 'AVANZATO'}`
        : `${state.exercise.quality === 'major' ? 'MAGGIORE' : 'MINORE'} · ${inversionName.toUpperCase()}`;
    els.warmup_progress.textContent = state.exercise.family === 'scale'
      ? `${state.exercise.rootName.replace(/\d+$/, '')} · ${state.exercise.bpm} BPM`
      : `${state.routineIndex + 1} di ${state.routine.exercises.length} · ${state.exercise.bpm} BPM`;
    const root = state.exercise.rootName.replace(/\d+$/, '');
    els.warmup_instruction.textContent = `${root} è la nota 1. ${state.exercise.family === 'degree'
      ? `Raggiungi ${state.exercise.events[0].degree} e tienilo per quattro battiti.`
      : state.exercise.family === 'triad'
        ? `Parti da ${Core.midiToName(state.exercise.events[0].midi).replace(/\d+$/, '')} (${state.exercise.events[0].degree}) e canta una nota per battito.`
        : 'Segui le note e canta una nota per battito.'}`;
    els.warmup_score_caption.textContent = 'Note e numeri da cantare';
    els.warmup_roll_caption.textContent = state.mode === 'inner-ear' && !state.reviewing ? 'Solo la tua voce · confronto alla fine' : 'Note da cantare e tua voce';
    renderLesson();
  }

  function renderLesson() {
    const exercise = state.exercise, root = exercise.rootName.replace(/\d+$/, '');
    const names = exercise.events.map(event => Core.midiToName(event.midi).replace(/\d+$/, ''));
    const first = exercise.events[0];
    els.warmup_lesson_intro.textContent = exercise.family === 'scale'
      ? `Parti da ${root}: è la nota 1 della scala. Sali fino a 5, poi torna a 1.`
      : exercise.family === 'degree'
        ? `${root} è la nota 1. Ascoltala, poi trova la nota ${first.degree} e tienila per quattro battiti.`
        : `${root} è la nota 1. Canta le note dell’accordo una alla volta, salendo e tornando indietro.`;
    const key = `${exercise.patternId}-r${exercise.rootMidi}-${state.role}`;
    els.warmup_lesson_score.src = `voice-lab-assets/scores/${key}.svg`;
    const sequence = exercise.events.map((event, index) => `${event.degree}: ${names[index]}`).join(', ');
    els.warmup_lesson_score.alt = `${exercise.name}. Note da cantare: ${sequence}.`;
    els.lab_score_image.alt = els.warmup_lesson_score.alt;
    els.lab_score.setAttribute('aria-label', els.warmup_lesson_score.alt);
    els.warmup_lesson_key.textContent = `${root} · ${exercise.family === 'degree' ? 'Una nota' : exercise.quality === 'minor' ? 'Minore' : 'Maggiore'}`;
    els.warmup_lesson_notes.textContent = names.join(' · ');

  }

  // The demonstration shares the score assets, guide and AudioContext clock with
  // practice, but never enters a trial or requests microphone access.
  const demo = { generation: 0, frame: null, svg: null, notes: [], stems: [], phase: '', active: -1, exercise: null, caption: '' };
  const reducedDemoMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function stopDemo() {
    demo.generation += 1;
    if (demo.frame !== null) cancelAnimationFrame(demo.frame);
    demo.frame = null;
    stopScheduledAudio();
  }

  function closeDemo() {
    stopDemo();
    els.warmup_instructions_dialog.close();
  }

  function demoStatus(phase, step, title, copy) {
    if (demo.phase === phase) return;
    demo.phase = phase;
    els.warmup_instructions_dialog.dataset.phase = phase;
    els.warmup_demo_step.textContent = step;
    els.warmup_demo_title.textContent = title;
    els.warmup_demo_copy.textContent = copy;
  }

  function highlightDemoNote(index) {
    if (index === demo.active) return;
    demo.active = index;
    demo.notes.forEach((note, i) => note.classList.toggle('demo-note-active', i === index));
    demo.stems.forEach((stem, i) => stem.classList.toggle('demo-note-active', i === index));
    const event = demo.exercise?.events[index];
    els.warmup_demo_caption.textContent = event
      ? `${index + 1} / ${demo.notes.length} · ${Core.midiToName(event.midi).replace(/\d+$/, '')}` : demo.caption;
  }

  function bounceDemoSymbol(selector, elapsed, beatSeconds, enabled) {
    // Ballistic flight at 0.75 × 9.8 m/s², rendered at 32 CSS px per metre.
    // Converting CSS pixels to score units keeps the jump small on every screen.
    const flight = ((Math.max(0, elapsed) % beatSeconds) + beatSeconds) % beatSeconds;
    const pixels = enabled && !reducedDemoMotion.matches
      ? -.5 * (.75 * 9.8) * flight * (beatSeconds - flight) * 32 : 0;
    const units = demo.svg.viewBox.baseVal.width / Math.max(1, demo.svg.getBoundingClientRect().width);
    demo.svg.querySelectorAll(selector).forEach(symbol => {
      symbol.setAttribute('transform', `translate(0 ${pixels * units})`);
    });
  }

  async function playDemo() {
    stopDemo();
    const generation = demo.generation, exercise = state.exercise;
    if (!exercise) return;
    demo.exercise = exercise;
    demo.phase = ''; demo.active = -1;
    demo.svg = null; demo.notes = []; demo.stems = [];
    els.warmup_demo_score.replaceChildren();
    els.warmup_demo_replay.disabled = true;
    els.warmup_demo_replay.textContent = 'Rivedi';
    els.warmup_demo_tempo.textContent = `${exercise.bpm} BPM`;
    demo.caption = els.warmup_lesson_key.textContent;
    els.warmup_demo_caption.textContent = demo.caption;
    els.warmup_demo_score.setAttribute('aria-label', els.warmup_lesson_score.alt);
    [...els.warmup_demo_beats.children].forEach(dot => { dot.className = ''; });
    demoStatus('loading', 'ISTRUZIONI', 'Un momento…', 'Preparo la dimostrazione.');
    try {
      const context = audioContext();
      // Resume inside the button gesture, before any downloads (mobile Safari).
      const resumed = context.resume();
      const score = fetch(els.warmup_lesson_score.src).then(response => {
        if (!response.ok) throw new Error('Spartito non disponibile. Riprova.');
        return response.text();
      });
      const guide = exercise.mode === 'model' ? loadGuidePhrase(exercise) : loadVoiceSample(exercise.rootMidi);
      const [markup] = await Promise.all([score, guide, resumed]);
      if (generation !== demo.generation || !els.warmup_instructions_dialog.open) return;
      const documentSvg = new DOMParser().parseFromString(markup, 'image/svg+xml');
      if (documentSvg.querySelector('parsererror') || documentSvg.documentElement.localName !== 'svg')
        throw new Error('Spartito non disponibile. Riprova.');
      const svg = document.importNode(documentSvg.documentElement, true);
      svg.querySelectorAll('script, foreignObject, image, use, a').forEach(node => node.remove());
      svg.querySelectorAll('*').forEach(node => [...node.attributes].forEach(attribute => {
        if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
      }));
      svg.setAttribute('aria-hidden', 'true');
      els.warmup_demo_score.replaceChildren(svg); demo.svg = svg;
      const byX = (a, b) => a.getBBox().x - b.getBBox().x;
      demo.notes = [...svg.querySelectorAll('.Note')].sort(byX);
      demo.stems = [...svg.querySelectorAll('.Stem')].sort(byX);
      const beatSeconds = 60 / exercise.bpm;
      const previewAt = context.currentTime + .12;
      // Leave room for the rendered phrase's natural release before the count-in.
      const countInAt = previewAt + exercise.previewSeconds + (exercise.mode === 'model' ? 1 : .12);
      const takeAt = countInAt + exercise.countInSeconds;
      const endAt = takeAt + exercise.durationSeconds + (exercise.mode === 'model' ? 1 : 0);
      if (exercise.mode === 'model') {
        if (!playGuidePhrase(exercise, previewAt) || !playGuidePhrase(exercise, takeAt))
          throw new Error('Voce guida non disponibile. Riprova.');
      } else {
        playChoirNote(exercise.rootMidi, previewAt, exercise.previewSeconds, .075, 'demo-root');
      }
      for (let beat = 0; beat < exercise.countInBeats; beat += 1)
        metronomeClick(countInAt + beat * beatSeconds, beat === 0);
      for (let beat = 0; beat < exercise.totalBeats; beat += 1)
        metronomeClick(takeAt + beat * beatSeconds, beat % 4 === 0);
      reportAudioEvent('demonstration', previewAt, { exercise, countInAt, takeAt, endAt });
      function animateDemo() {
        if (generation !== demo.generation || !els.warmup_instructions_dialog.open) return;
        const now = context.currentTime;
        const preview = now < countInAt, countIn = !preview && now < takeAt, finished = now >= endAt;
        const elapsed = now - takeAt;
        let noteIndex = -1;
        if (!finished && now >= takeAt) {
          const beat = elapsed / beatSeconds;
          noteIndex = exercise.events.findIndex(event => beat >= event.beat && beat < event.beat + event.durationBeats);
        }
        highlightDemoNote(noteIndex);
        bounceDemoSymbol('.Clef', now - previewAt, beatSeconds, preview && now >= previewAt);
        bounceDemoSymbol('.TimeSig', now - countInAt, beatSeconds, countIn);
        const countBeat = countIn ? Math.floor((now - countInAt) / beatSeconds) : -1;
        [...els.warmup_demo_beats.children].forEach((dot, index) => {
          dot.classList.toggle('active', index === countBeat);
          dot.classList.toggle('done', countIn && index < countBeat);
        });
        if (finished) {
          demoStatus('finished', '3 / 3', 'Ora tocca a te', 'Chiudi le istruzioni e premi Comincia.');
          stopScheduledAudio(); demo.frame = null;
          els.warmup_demo_replay.disabled = false;
          return;
        }
        if (preview) demoStatus('preview', '1 / 3', exercise.mode === 'model' ? 'Ascolta la melodia' : 'Ascolta la nota 1',
          exercise.mode === 'model' ? 'Ascolta la voce guida.' : `${exercise.rootName.replace(/\d+$/, '')} è il tuo riferimento. Tienilo a mente.`);
        else if (countIn) demoStatus('count-in', '2 / 3', 'Aspetta 4 battiti', 'Entra sul battito successivo.');
        else demoStatus('take', '3 / 3', 'Segui le note', exercise.family === 'degree'
          ? `Trova la nota ${exercise.events[0].degree} e tienila per quattro battiti.`
          : exercise.mode === 'inner-ear' ? 'Immagina il suono delle note. Una per battito.' : 'Ascolta melodia e metronomo. Una nota per battito.');
        demo.frame = requestAnimationFrame(animateDemo);
      }
      animateDemo();
    } catch (_) {
      if (generation !== demo.generation || !els.warmup_instructions_dialog.open) return;
      stopDemo();
      demoStatus('error', 'ISTRUZIONI', 'Dimostrazione non disponibile', 'Controlla la connessione e riprova.');
      els.warmup_demo_replay.disabled = false; els.warmup_demo_replay.textContent = 'Riprova';
    }
  }

  els.warmup_instructions.addEventListener('click', () => {
    if (!state.exercise || state.running) return;
    els.warmup_instructions_dialog.showModal();
    void playDemo();
  });
  els.warmup_demo_replay.addEventListener('click', () => { void playDemo(); });
  els.warmup_demo_close.addEventListener('click', closeDemo);
  els.warmup_instructions_dialog.addEventListener('close', () => {
    // Native close events are queued. A quick reopen must keep its new clock.
    if (els.warmup_instructions_dialog.open) return;
    if (!state.running) stopDemo();
    els.warmup_instructions.focus({ preventScroll: true });
  });
  els.warmup_instructions_dialog.addEventListener('cancel', stopDemo);
  els.warmup_instructions_dialog.addEventListener('click', event => {
    if (event.target !== els.warmup_instructions_dialog) return;
    const bounds = els.warmup_instructions_dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)
      closeDemo();
  });

  function drawScore() {
    const scoreKey = state.exercise ? `${state.exercise.patternId}-r${state.exercise.rootMidi}-${state.role}` : '';
    const officialAvailable = scoreKey && els.lab_score_image.dataset.failedFor !== scoreKey;
    if (officialAvailable) {
      els.lab_score.hidden = true; els.lab_score_image.hidden = false;
      if (els.lab_score_image.dataset.scoreKey !== scoreKey) {
        els.lab_score_image.dataset.scoreKey = scoreKey;
        els.lab_score_image.src = `voice-lab-assets/scores/${scoreKey}.svg`;
      }
      return;
    }
    els.lab_score_image.hidden = true; els.lab_score.hidden = false;
    const { context: ctx, width, height } = canvasContext(els.lab_score, 190);
    ctx.fillStyle = '#eee8dc'; ctx.fillRect(0, 0, width, height);
    if (!state.exercise) return;
    const left = 54, right = width - 22, events = state.exercise.events, slot = (right - left) / events.length;
    const staffTop = Math.max(48, height * .31), lineGap = Math.min(13, height * .075);
    ctx.strokeStyle = '#7b7a70'; ctx.lineWidth = 1;
    for (let line = 0; line < 5; line += 1) { const y = staffTop + line * lineGap; ctx.beginPath(); ctx.moveTo(left - 14, y); ctx.lineTo(right, y); ctx.stroke(); }
    ctx.fillStyle = '#26322e'; ctx.font = `${Math.min(46, height * .25)}px Georgia`; ctx.fillText('𝄞', 11, staffTop + lineGap * 3.7);
    const pitchStep = [0, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
    const diatonic = (midi) => (Math.floor(midi / 12) - 1) * 7 + pitchStep[((midi % 12) + 12) % 12];
    const centerStep = Core.median(events.map((event) => diatonic(event.midi))), centerY = staffTop + lineGap * 2;
    events.forEach((event, index) => {
      const x = left + slot * (index + .5), y = centerY - (diatonic(event.midi) - centerStep) * lineGap / 2;
      const active = state.phase === 'take' && currentDegree(state.elapsedSeconds)?.index === index;
      ctx.fillStyle = active ? '#b27d2c' : '#26322e'; ctx.beginPath(); ctx.ellipse(x, y, 8, 5.5, -.22, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 7, y); ctx.lineTo(x + 7, y - 28); ctx.stroke();
      ctx.fillStyle = '#27352f'; ctx.textAlign = 'center'; ctx.font = `${slot < 55 ? 9 : 11}px system-ui`; ctx.fillText(event.degree, x, staffTop + lineGap * 5.7);
      if (state.reviewing && state.analysis?.segments[index]) {
        const segment = state.analysis.segments[index]; ctx.fillStyle = segment.status === 'centered' ? '#2d7d67' : segment.status === 'uncertain' ? '#7d837e' : '#ad762c';
        ctx.beginPath(); ctx.arc(x, staffTop - 20, 4, 0, Math.PI * 2); ctx.fill();
      }
    });
    ctx.textAlign = 'left';
  }

  function drawRoll() {
    const { context: ctx, width, height, ratio } = canvasContext(els.lab_roll, 280);
    ctx.fillStyle = '#08171c'; ctx.fillRect(0, 0, width, height);
    fluidTrailRenderer.resize(width, height, ratio); fluidTrailRenderer.clear();
    if (!state.exercise) return;
    const keyboardRight = 48, right = width - 12, top = 20, bottom = height - 18;
    const hidden = state.mode === 'inner-ear' && !state.reviewing;
    const bounds = hidden || state.mode === 'inner-ear' ? { min: state.range.lowMidi, max: state.range.highMidi }
      : Core.rollPitchBounds(state.exercise.events, { padding: 2, minSpan: 9 });
    const yAt = (midi) => top + (bounds.max - midi) / Math.max(1, bounds.max - bounds.min) * (bottom - top);
    const rowHeight = (bottom - top) / Math.max(1, bounds.max - bounds.min);
    for (let midi = Math.floor(bounds.max); midi >= Math.ceil(bounds.min); midi -= 1) {
      const y = yAt(midi), pitchClass = ((midi % 12) + 12) % 12, black = [1, 3, 6, 8, 10].includes(pitchClass);
      ctx.fillStyle = black ? 'rgba(2,10,13,.72)' : 'rgba(119,151,153,.10)'; ctx.fillRect(keyboardRight, y - rowHeight / 2, right - keyboardRight, rowHeight);
      ctx.fillStyle = black ? '#17272c' : '#d5ddd8'; ctx.fillRect(0, y - rowHeight / 2, black ? 31 : keyboardRight, rowHeight);
      ctx.strokeStyle = '#294047'; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(0, y + rowHeight / 2); ctx.lineTo(right, y + rowHeight / 2); ctx.stroke();
      if (pitchClass === 0 || pitchClass === 5) { ctx.fillStyle = black ? '#adc0bf' : '#34484b'; ctx.font = '9px system-ui'; ctx.fillText(Core.midiToName(midi), 3, y + 3); }
    }
    const duration = state.exercise.durationSeconds, xAt = (time) => keyboardRight + time / duration * (right - keyboardRight);
    const beatSeconds = 60 / state.exercise.bpm;
    for (let beat = 0; beat <= state.exercise.totalBeats; beat += 1) {
      const x = xAt(beat * beatSeconds); ctx.strokeStyle = beat % 4 === 0 ? '#d9b46e66' : '#ffffff1d'; ctx.setLineDash(beat % 4 ? [3, 5] : []);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    }
    ctx.setLineDash([]);
    if (!hidden) {
      state.exercise.events.forEach((event) => {
        const start = event.beat * beatSeconds, end = start + event.durationBeats * beatSeconds;
        const x = xAt(start), w = Math.max(2, xAt(end) - x - 1), y = yAt(event.midi) - rowHeight * .43;
        ctx.fillStyle = 'rgba(205,157,81,.72)'; ctx.fillRect(x, y, w, rowHeight * .86);
        if (w > 25) { ctx.fillStyle = '#172326'; ctx.font = `${w < 48 ? 8 : 10}px system-ui`; ctx.textAlign = 'center'; ctx.fillText(event.degree, x + w / 2, y + rowHeight * .58); }
      });
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = '#9eb0ae'; ctx.font = '650 10px system-ui'; ctx.textAlign = 'center';
      state.exercise.events.forEach((event) => { const x = xAt((event.beat + event.durationBeats / 2) * beatSeconds); ctx.fillText(event.degree, x, top + 10); });
      ctx.textAlign = 'left';
    }
    if (state.visualFrames.length) {
      const xAtFrame = (frame) => xAt(visuallyAdvancedPitchTime(frame.time)), settings = { ...state.plumeSettings,
        dpr: ratio, width, height, ribbonScale: state.plumeSettings.width, intensity: state.plumeSettings.intensity,
        currentTime: state.elapsedSeconds, timeAt: (frame) => frame.time,
        minConfidence: activeRecognitionSettings().minConfidence, viewportLeft: keyboardRight, viewportRight: right,
        trailStartX: keyboardRight, nowX: right, sortedTimeline: true, retainHistory: true,
        mode: state.reviewing ? 'review' : 'live',
        clip: { left: keyboardRight, top, right, bottom }, animationTime: state.reviewing ? state.elapsedSeconds : performance.now() / 1000 };
      if (!fluidTrailRenderer.render(state.visualFrames, xAtFrame, yAt, settings))
        FluidPitchTrail.drawFallback(ctx, state.visualFrames, xAtFrame, yAt, settings);
    }
    if (state.phase === 'take' || state.reviewing) {
      const cursorTime = state.reviewing ? duration : Math.min(duration, state.elapsedSeconds), cursorX = xAt(cursorTime);
      ctx.strokeStyle = '#82ddd3'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cursorX, 0); ctx.lineTo(cursorX, height); ctx.stroke();
    }
  }

  function drawViews() { drawScore(); drawRoll(); }

  function renderRangeKeyboard() {
    const low = Number(els.lab_low.value), high = Number(els.lab_high.value), valid = Core.validateRange({ lowMidi: low, highMidi: high });
    const whitePitchClasses = new Set([0, 2, 4, 5, 7, 9, 11]);
    const whiteMidis = Array.from({ length: 49 }, (_, index) => 36 + index).filter((midi) => whitePitchClasses.has(midi % 12));
    const whites = document.createElement('div'); whites.className = 'lab-piano-white-keys'; const blackKeys = [];
    for (let midi = 36; midi <= 84; midi += 1) {
      const key = document.createElement('span'), isWhite = whitePitchClasses.has(midi % 12);
      key.className = `lab-piano-key ${isWhite ? 'white' : 'black'}`; const selected = valid && midi >= low && midi <= high;
      key.classList.toggle('is-selected', selected);
      if (selected && (midi === low || midi === high)) { key.classList.add('is-boundary'); key.dataset.note = Core.midiToName(midi); }
      key.setAttribute('aria-hidden', 'true');
      if (isWhite) whites.append(key); else { key.style.setProperty('--key-position', whiteMidis.filter((value) => value < midi).length); blackKeys.push(key); }
    }
    els.lab_range_keyboard.replaceChildren(whites, ...blackKeys); els.lab_range_keyboard.style.setProperty('--white-key-count', whiteMidis.length);
    els.lab_range_preview.textContent = valid ? `${Core.midiToName(low)} — ${Core.midiToName(high)} · ${high - low + 1} tasti` : 'Intervallo non valido';
    els.lab_range_error.hidden = valid; els.lab_settings_save.disabled = !valid;
  }

  function syncSetupChoices() {
    document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.mode));
    document.querySelectorAll('[data-family]').forEach((button) => button.classList.toggle('active', button.dataset.family === state.family));
    document.querySelectorAll('[data-inversion]').forEach((button) => button.classList.toggle('active', button.dataset.inversion === state.inversion));
    document.querySelectorAll('[data-degree-level]').forEach((button) => button.classList.toggle('active', button.dataset.degreeLevel === state.degreeLevel));
    els.warmup_ear_exercises.hidden = state.path !== 'ear';
    els.warmup_inversions.hidden = state.family !== 'arpeggio';
    els.warmup_position_options.hidden = state.family !== 'arpeggio';
    els.warmup_degree_levels.hidden = state.family !== 'degree';
    els.warmup_level_options.hidden = state.family !== 'degree';
    els.warmup_mode_copy.textContent = state.mode === 'model'
      ? 'La voce guida ti fa sentire la melodia prima del tuo turno.'
      : 'Ascolterai solo la nota 1. Lo spartito ti aiuta, la melodia la immagini tu.';
    const content = state.path === 'scale'
      ? ['SCALDA LA VOCE', 'La tua prima scala']
      : state.path === 'chords'
        ? ['ACCORDI E ARPEGGI', 'Scegli il tuo arpeggio']
        : ['ORECCHIO INTERNO', state.family === 'degree' ? 'Trova la nota dentro di te' : 'Canta senza la voce guida'];
    els.warmup_prepare_kicker.textContent = content[0];
    els.warmup_prepare_title.textContent = content[1];

  }

  function selectPath(path) {
    if (!PATH_ORDER.includes(path)) return;
    const fromMenu = state.screen === 'choose';
    if (state.running) cancelRoutine();
    if (!fromMenu && historyDepth > 1) {
      pendingNavigationPath = path;
      history.go(1 - historyDepth);
      return;
    }
    state.path = path;
    if (path === 'scale') { state.mode = 'model'; state.family = 'scale'; }
    else if (path === 'chords') { state.mode = 'model'; state.family = 'arpeggio'; }
    else { state.mode = 'inner-ear'; state.family = 'scale'; }
    syncSetupChoices(); renderPlan(); showScreen('prepare', { historyMode: fromMenu ? 'push' : 'replace' });
    els.warmup_prepare_title.focus({ preventScroll: true });
  }

  function navigateTo(screen) {
    if (state.running) cancelRoutine();
    const targetDepth = screen === 'choose' ? 0 : 1;
    if (historyDepth > targetDepth) { history.go(targetDepth - historyDepth); return; }
    if (screen === 'prepare') renderPlan();
    showScreen(screen);
    const title = screen === 'choose' ? $('warmup-choose-title') : els.warmup_prepare_title;
    title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true });
  }

  function openSettings(firstUse = false) {
    if (state.running) cancelRoutine();
    else releaseMicrophone();
    els.lab_role.value = state.role; els.lab_low.value = state.range.lowMidi; els.lab_high.value = state.range.highMidi;
    els.lab_pad_enabled.checked = state.ambienceEnabled;
    const heading = els.lab_settings_dialog.querySelector('.lab-range-dialog-heading');
    heading.querySelector('span').textContent = firstUse ? 'PRIMA DI CANTARE' : 'VOCE E AUDIO';
    heading.querySelector('h2').textContent = firstUse ? 'Qual è la tua voce?' : 'Impostazioni';
    renderRangeKeyboard(); els.lab_settings_dialog.showModal();
  }

  async function requestStart() {
    await voiceProfileReady;
    if (needsRoleSetup) { pendingStart = true; openSettings(true); return; }
    state.routineIndex = 0; state.pendingExercise = null; state.ascentSteps = 0; void beginTrial();
  }

  function selectMode(mode) {
    if (state.running) return;
    state.mode = mode;
    if (mode === 'model' && state.family === 'degree') state.family = 'scale';
    syncSetupChoices();
    renderPlan();
  }

  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => selectMode(button.dataset.mode)));
  document.querySelectorAll('[data-path]').forEach((button) => button.addEventListener('click', () => selectPath(button.dataset.path)));
  els.warmup_back_choose.addEventListener('click', () => navigateTo('choose'));
  els.warmup_back_prepare.addEventListener('click', () => navigateTo('prepare'));
  document.querySelectorAll('button[data-journey]').forEach(button => button.addEventListener('click', () => navigateTo(button.dataset.journey)));
  document.querySelectorAll('[data-family]').forEach((button) => button.addEventListener('click', () => {
    if (state.running) return;
    state.family = button.dataset.family;
    if (state.family === 'degree') { state.mode = 'inner-ear'; state.degreeSeed = freshRoutineSeed(); }
    syncSetupChoices(); renderPlan();
  }));
  document.querySelectorAll('[data-inversion]').forEach((button) => button.addEventListener('click', () => {
    if (state.running) return; state.inversion = button.dataset.inversion;
    document.querySelectorAll('[data-inversion]').forEach((item) => item.classList.toggle('active', item === button));
    try { localStorage.setItem(`${STORE}:inversion`, state.inversion); } catch (_) {}
    renderPlan();
  }));
  document.querySelectorAll('[data-degree-level]').forEach((button) => button.addEventListener('click', () => {
    if (state.running) return; state.degreeLevel = button.dataset.degreeLevel; state.degreeSeed = freshRoutineSeed();
    document.querySelectorAll('[data-degree-level]').forEach((item) => item.classList.toggle('active', item === button));
    try { localStorage.setItem(`${STORE}:degree-level`, state.degreeLevel); } catch (_) {}
    renderPlan();
  }));
  document.querySelectorAll('[data-bpm]').forEach((button) => button.addEventListener('click', () => {
    if (state.running) return; state.bpm = Number(button.dataset.bpm);
    document.querySelectorAll('[data-bpm]').forEach((item) => item.classList.toggle('active', item === button)); renderPlan();
  }));
  els.warmup_start.addEventListener('click', requestStart);
  els.warmup_main_action.addEventListener('click', requestStart);
  els.warmup_cancel.addEventListener('click', () => { cancelRoutine(); navigateTo('prepare'); });
  els.warmup_retry.addEventListener('click', retryTrial); els.warmup_step_up.addEventListener('click', nextSemitone);
  els.warmup_next.addEventListener('click', nextTrial);
  els.warmup_replay.addEventListener('click', () => { if (state.audioUrl) void new Audio(state.audioUrl).play(); });
  els.lab_score_image.addEventListener('load', () => { delete els.lab_score_image.dataset.failedFor; });
  els.lab_score_image.addEventListener('error', () => {
    els.lab_score_image.dataset.failedFor = els.lab_score_image.dataset.scoreKey || '';
    drawScore();
  });
  els.lab_voice_volume.value = String(Math.round(state.voiceVolume * 100)); els.lab_voice_volume_value.textContent = `${els.lab_voice_volume.value}%`;
  els.lab_voice_volume.addEventListener('input', () => {
    state.voiceVolume = Number(els.lab_voice_volume.value) / 100; els.lab_voice_volume_value.textContent = `${els.lab_voice_volume.value}%`;
    if (state.voiceOutput) state.voiceOutput.gain.setTargetAtTime(state.voiceVolume, audioContext().currentTime, .015);
    try { localStorage.setItem(`${STORE}:voice-volume`, String(state.voiceVolume)); } catch (_) {}
  });
  for (let midi = 36; midi <= 84; midi += 1) { els.lab_low.add(new Option(Core.midiToName(midi), midi)); els.lab_high.add(new Option(Core.midiToName(midi), midi)); }
  els.lab_settings.addEventListener('click', () => openSettings(false));
  document.getElementById('lab-relax').addEventListener('click', event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    pendingStart = false;
    els.lab_settings_dialog.close();
    const returnPath = location.pathname + location.search + location.hash;
    location.assign(`relax.html?return=${encodeURIComponent(returnPath)}`);
  });
  els.lab_settings_close.addEventListener('click', () => { pendingStart = false; els.lab_settings_dialog.close(); });
  els.lab_settings_dialog.addEventListener('cancel', () => { pendingStart = false; });
  els.lab_settings_dialog.addEventListener('click', event => {
    if (event.target !== els.lab_settings_dialog) return;
    const bounds = els.lab_settings_dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      pendingStart = false; els.lab_settings_dialog.close();
    }
  });
  els.lab_role.addEventListener('change', () => {
    const preset = Core.ROLE_RANGES[els.lab_role.value]; els.lab_low.value = preset.lowMidi; els.lab_high.value = preset.highMidi; renderRangeKeyboard();
  });
  els.lab_low.addEventListener('change', renderRangeKeyboard); els.lab_high.addEventListener('change', renderRangeKeyboard);
  els.lab_settings_save.addEventListener('click', () => {
    const range = { lowMidi: Number(els.lab_low.value), highMidi: Number(els.lab_high.value) };
    if (!Core.validateRange(range)) { renderRangeKeyboard(); return; }
    state.role = els.lab_role.value; state.range = range; state.ambienceEnabled = els.lab_pad_enabled.checked;
    needsRoleSetup = false;
    try { localStorage.setItem(`${STORE}:role`, state.role); localStorage.setItem(`${STORE}:range`, JSON.stringify(range));
      localStorage.setItem(`${STORE}:ambience`, String(state.ambienceEnabled)); } catch (_) {}
    els.lab_settings_dialog.close(); renderPlan();
    if (pendingStart) { pendingStart = false; state.routineIndex = 0; void beginTrial(); }
  });
  window.addEventListener('resize', drawViews);
  window.addEventListener('popstate', event => {
    if (!event.state?.voiceLabScreen) return;
    if (els.warmup_instructions_dialog.open) closeDemo();
    restoringHistory = true;
    if (state.running) cancelRoutine();
    historyDepth = Number(event.state.voiceLabDepth) || 0;
    restoreNavigationConfig(event.state.voiceLabConfig);
    syncSetupChoices(); renderPlan();
    const screen = event.state.voiceLabScreen === 'choose' ? 'choose' : 'prepare';
    showScreen(screen);
    restoringHistory = false;
    // Forward navigation restores preparation, never a microphone or a take.
    showScreen(screen);
    if (pendingNavigationPath) {
      const path = pendingNavigationPath;
      pendingNavigationPath = null;
      selectPath(path);
      return;
    }
    const heading = $(screen === 'choose' ? 'warmup-choose-title' : 'warmup-prepare-title');
    heading.tabIndex = -1; heading.focus({ preventScroll: true });
  });
  document.addEventListener('visibilitychange', suspendVoiceLabForBackground);
  window.addEventListener('pagehide', () => {
    if (els.warmup_instructions_dialog.open) closeDemo();
    state.generation += 1; stopRecorder(false); stopScheduledAudio(); setRunning(false); releaseMicrophone();
    void state.audio?.suspend().catch(() => {});
  });
  window.addEventListener('beforeunload', () => {
    if (els.warmup_instructions_dialog.open) closeDemo();
    state.generation += 1; stopRecorder(false); stopScheduledAudio(); releaseMicrophone();
  });

  function restoreNavigationConfig(config) {
    if (!config || !PATH_ORDER.includes(config.path)) return;
    state.path = config.path;
    state.family = ['scale', 'arpeggio', 'degree'].includes(config.family) ? config.family : 'scale';
    state.mode = config.path === 'ear' ? 'inner-ear' : 'model';
    if (Core.TEMPOS.includes(config.bpm)) state.bpm = config.bpm;
    if ([...Core.TRIAD_INVERSIONS, 'all'].includes(config.inversion)) state.inversion = config.inversion;
    if (Object.hasOwn(Core.DEGREE_LEVELS, config.degreeLevel)) state.degreeLevel = config.degreeLevel;
    if (Number.isInteger(config.degreeSeed)) state.degreeSeed = config.degreeSeed;
    document.querySelectorAll('[data-bpm]').forEach(button => button.classList.toggle('active', Number(button.dataset.bpm) === state.bpm));
  }
  const savedNavigation = history.state;
  restoreNavigationConfig(savedNavigation?.voiceLabConfig);
  syncSetupChoices();
  renderPlan(); setPhase('idle', 'Configura e inizia'); updateBeatDots(-1);
  showScreen(savedNavigation?.voiceLabScreen && savedNavigation.voiceLabScreen !== 'choose' ? 'prepare' : 'choose');
  if (window.ChoirRuntimeConfig?.mode === 'production') {
    voiceProfileReady = (window.ChoirAuthFetch || fetch)('/api/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : null).then(me => {
        const role = { soprano: 'soprano', contralto: 'alto', tenore: 'tenor', basso: 'bass' }[me?.preferredVoicePart];
        if (!role || state.running) return;
        if (state.role !== role) state.range = { ...Core.ROLE_RANGES[role] };
        state.role = role; needsRoleSetup = false; renderPlan();
      }).catch(() => {});
  }
})();
