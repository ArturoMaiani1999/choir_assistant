const { NormalizedScoreRuntime, MediaPlaybackClock } = window.ChoirScore;
const { centsBetween, pitchToHz, pitchToName, pitchToY, timeToX, measureSeekState, rhythmGridLines, smoothPitchBounds } = window.PracticeMath;
const { detectPitch, PitchSmoother, OctaveAwarePitchTracker, yinCandidates, decodeYinCandidatePath, mpmCandidates, decodeCrepeProbabilities } = window.ChoirPitch;
const PitchShared = window.ChoirPitchShared;
const { OneEuroFilter } = window.ChoirOneEuro;
const VocalFeedback = window.VocalFeedback;
const RUNTIME_CONFIG = window.ChoirRuntimeConfig ?? Object.freeze({});

function libraryBundleUrl(pieceId) {
  const template = RUNTIME_CONFIG.bundleUrlTemplate;
  if (!template) throw new Error('Configurazione della libreria incompleta');
  return template.replace('{pieceId}', encodeURIComponent(pieceId));
}

/** @typedef {number|null} TrackedPitch MIDI pitch consumed only by scoring. */
/** @typedef {number|null} DisplayPitch MIDI pitch consumed only by presentation. */
/** @param {TrackedPitch} trackedPitch @returns {DisplayPitch} */
function displayPitchFromTracked(trackedPitch) { return trackedPitch; }

const UI_CONFIG = Object.freeze({
  historyBeats: 4.5,
  futureBeats: 7.5,
  centeredCents: 12,
  acceptableCents: 30,
  targetToleranceCents: 25,
  pitchViewportResponseMs: 180,
});

const els = Object.fromEntries([
  'transpose', 'settings-display-pitch-algorithm',
  'voice-mixer-dialog', 'voice-mixer-options', 'voice-mixer-own', 'voice-mixer-close',
  'exercise', 'exercise-dialog', 'phrase-start', 'phrase-end', 'phrase-apply', 'phrase-clear', 'exercise-close', 'settings-dialog', 'settings-v1-rms', 'settings-v1-rms-value', 'settings-v1-rms-description', 'settings-v1-fast-alpha', 'settings-v1-fast-alpha-value', 'settings-v1-slow-alpha', 'settings-v1-slow-alpha-value', 'settings-v1-median-frames', 'settings-v1-median-frames-value', 'settings-v1-plume-width', 'settings-v1-plume-width-value', 'settings-target-color', 'settings-v1-plume-present-color', 'settings-v1-plume-past-color', 'settings-v1-plume-intensity', 'settings-v1-plume-intensity-value', 'settings-v1-plume-advance', 'settings-v1-plume-advance-value', 'settings-reset', 'settings-close',
  'result-dialog', 'result-text', 'result-progress', 'retry', 'next-phrase', 'result-close',
  'phrase-loop', 'note-names',
  'piece-title', 'piece-picker', 'piece-picker-dialog', 'library-piece', 'library-title', 'library-title-save', 'library-part', 'library-note', 'library-open', 'library', 'restart-practice', 'restart-transport', 'ground-truth', 'ground-truth-dialog', 'ground-truth-status', 'ground-truth-count', 'ground-truth-start', 'ground-truth-approve', 'ground-truth-close', 'benchmark', 'benchmark-dialog', 'benchmark-scenario', 'benchmark-repeat', 'benchmark-setup', 'benchmark-setup-section', 'benchmark-status', 'benchmark-count', 'benchmark-primary-actions', 'benchmark-review-actions', 'benchmark-start', 'benchmark-listen', 'benchmark-accept', 'benchmark-discard', 'benchmark-close', 'benchmark-archive', 'benchmark-algorithm-label', 'benchmark-take-list', 'benchmark-take-summary', 'benchmark-open-analysis', 'benchmark-analysis', 'benchmark-analysis-back', 'benchmark-analysis-take', 'benchmark-analysis-name', 'benchmark-analysis-meta', 'benchmark-analysis-audio', 'benchmark-analysis-metrics', 'benchmark-analysis-v3-status', 'benchmark-analysis-v4-status', 'benchmark-analysis-v5-status', 'benchmark-analysis-roll', 'benchmark-analysis-time', 'benchmark-analysis-selection', 'benchmark-analysis-play-selection', 'benchmark-analysis-inspect', 'benchmark-analysis-help', 'benchmark-analysis-reset', 'benchmark-analysis-layer-v1', 'benchmark-analysis-layer-display', 'benchmark-analysis-layer-raw', 'benchmark-analysis-layer-audio', 'benchmark-analysis-layer-score', 'benchmark-recording', 'benchmark-live-scenario', 'benchmark-stop-live', 'neural-live', 'neural-live-status', 'neural-live-note', 'neural-live-timing', 'part-selector', 'playback-speed', 'accompaniment-mode', 'score-mode', 'settings',
  'score-part-label', 'score-measure-label', 'score-viewport', 'score-sheet', 'score-image', 'score-cursor',
  'score-loading', 'score-pitch-divider', 'pitch-lane', 'intonation-readout', 'live-note', 'live-cents', 'live-state', 'pitch-layer-v1', 'pitch-layer-crepe',
  'feedback-analyse', 'feedback-status', 'feedback-priorities', 'feedback-priority-list', 'feedback-score-image', 'feedback-note-card', 'feedback-note-name', 'feedback-note-meta', 'feedback-cent-chart', 'feedback-note-metrics', 'feedback-message', 'feedback-previous', 'feedback-next', 'feedback-original', 'feedback-corrected', 'feedback-strength', 'feedback-strength-value', 'feedback-playback-kind',
  'measure-counter', 'scoring-cue', 'previous-measure', 'toggle-playback', 'next-measure', 'volume', 'metronome-toggle', 'metronome-volume', 'backing-audio', 'toast', 'asset-status',
].map((id) => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), document.getElementById(id)]));

const state = {
  transpose: 0,
  phrase: null,
  autoLoop: false,
  noteNames: 'italian',
  attemptActive: false,
  attempt: { voicedMs: 0, insideMs: 0 },
  lastSampleMs: null,
  pendingAudioTime: null,
  runtime: null,
  clock: null,
  glyphMap: {},
  occurrenceMeasures: [],
  selectedMeasureIndex: 0,
  scoringStartBeat: 0,
  scorePage: 1,
  fullScore: false,
  rafId: null,
  lastAnnouncedState: '',
  backingManifest: null,
  voiceStemAudio: new Map(),
  selectedVoiceIds: new Set(),
  bundleManifest: null,
  bundleApproved: false,
  scoreGeometry: new Map(),
  fallbackScoreSlots: [],
  activeScoreSegment: null,
  pitchViewport: null,
  lastSnapshot: null,
  metronomeContext: null,
  lastMetronomeBeat: null,
  rememberedMetronomeVolume: 34,
  syncDebug: new URLSearchParams(window.location.search).has('syncDebug'),
  microphoneStatus: 'idle',
  microphoneStream: null,
  microphoneContext: null,
  microphoneSource: null,
  microphoneAnalyser: null,
  microphoneSilencer: null,
  microphoneBuffer: null,
  microphoneRms: 0,
  pitchSmoother: new PitchSmoother(),
  displayPitchFilter: new OneEuroFilter(),
  displayPitchAlgorithm: 'v1+display-filter',
  detectorSettings: { ...PitchShared.DETECTOR_DEFAULTS },
  plumeSettings: { ...PitchShared.PLUME_DEFAULTS },
  pitchLayers: { v1: true, crepe: true },
  trackedPitch: null,
  displayPitch: null,
  pitchConfirmationState: null,
  neuralLive: { enabled: false, loading: false, inFlight: false, generation: 0, lastStartedMs: -Infinity, latestPitch: null, samples: [], durationsMs: [], v1DurationsMs: [], lastLatencyMs: null, error: null },
  pitchSamples: [],
  pitchTakeId: 1,
  groundTruth: { capture: null },
  benchmark: { capture: null, pending: null, previewUrl: null, sessionId: null, savedTakes: [], selectedTakeId: null, analysisAudioUrl: null, correctedAudioUrl: null, correctedAudioKey: null, audioVariant: 'original', analysisPlaybackRaf: null, feedbackSource: null, analysisLayers: { v1: false, display: true, raw: false, audio: false, score: false },
    analysisView: { timeZoom: 1, pitchZoom: 1, centerBeat: null, pitchOffset: 0, pointer: null, inspectBeat: null, selectedBeat: null } },
  gridInspect: { active: false, viewBeat: 0, pitchOffset: 0, timeZoom: 1, pitchZoom: 1, pointer: null },
};

const V1_RMS_THRESHOLD = Object.freeze({ default: .001, min: .00001, max: .01 });
const V1_TRACKER_DEFAULTS = Object.freeze({ fastAlpha: .65, slowAlpha: .3, medianWindowFrames: 3 });
const validHexColor = value => /^#[0-9a-f]{6}$/i.test(value || '');

function colorWithAlpha(color, alpha) {
  const value = validHexColor(color) ? color : '#ffffff';
  return `rgba(${Number.parseInt(value.slice(1,3),16)},${Number.parseInt(value.slice(3,5),16)},${Number.parseInt(value.slice(5,7),16)},${alpha})`;
}

function rmsThresholdFromSlider(value) {
  const ratio = Math.max(0, Math.min(1, Number(value) / 100));
  return 10 ** (Math.log10(V1_RMS_THRESHOLD.min) + ratio * (Math.log10(V1_RMS_THRESHOLD.max) - Math.log10(V1_RMS_THRESHOLD.min)));
}

function rmsSliderFromThreshold(value) {
  const threshold = Math.max(V1_RMS_THRESHOLD.min, Math.min(V1_RMS_THRESHOLD.max, value));
  return Math.round((Math.log10(threshold) - Math.log10(V1_RMS_THRESHOLD.min))
    / (Math.log10(V1_RMS_THRESHOLD.max) - Math.log10(V1_RMS_THRESHOLD.min)) * 100);
}

function formatRmsThreshold(value) {
  return Number(value).toFixed(value < .0001 ? 5 : 4).replace('.', ',');
}

function updateDetectorSettingsUi() {
  const threshold = state.detectorSettings.rmsThreshold;
  els.settingsV1Rms.value = String(rmsSliderFromThreshold(threshold));
  els.settingsV1RmsValue.textContent = `${formatRmsThreshold(threshold)} RMS`;
  els.settingsV1RmsDescription.textContent = threshold < V1_RMS_THRESHOLD.default
    ? 'Più sensibile: ammette segnali deboli; verifica che non compaiano pitch sul rumore.'
    : threshold > V1_RMS_THRESHOLD.default
      ? 'Più selettiva: richiede una voce più presente e filtra meglio il rumore debole.'
      : 'Valore predefinito: filtra silenzio e rumore debole.';
  els.settingsV1FastAlpha.value = String(Math.round(state.detectorSettings.fastAlpha * 100));
  els.settingsV1FastAlphaValue.textContent = `${Math.round(state.detectorSettings.fastAlpha * 100)}%`;
  els.settingsV1SlowAlpha.value = String(Math.round(state.detectorSettings.slowAlpha * 100));
  els.settingsV1SlowAlphaValue.textContent = `${Math.round(state.detectorSettings.slowAlpha * 100)}%`;
  els.settingsV1MedianFrames.value = String(state.detectorSettings.medianWindowFrames);
  els.settingsV1MedianFramesValue.textContent = `${state.detectorSettings.medianWindowFrames} frame`;
  els.settingsV1PlumeWidth.value = String(Math.round(state.plumeSettings.width * 100));
  els.settingsV1PlumeWidthValue.textContent = `${Math.round(state.plumeSettings.width * 100)}%`;
  els.settingsTargetColor.value = state.plumeSettings.targetColor;
  els.settingsV1PlumePresentColor.value = state.plumeSettings.presentColor;
  els.settingsV1PlumePastColor.value = state.plumeSettings.pastColor;
  document.documentElement.style.setProperty('--pitch-target-color', state.plumeSettings.targetColor);
  document.documentElement.style.setProperty('--pitch-voice-present-color', state.plumeSettings.presentColor);
  els.settingsV1PlumeIntensity.value = String(Math.round(state.plumeSettings.intensity * 100));
  els.settingsV1PlumeIntensityValue.textContent = `${Math.round(state.plumeSettings.intensity * 100)}%`;
  els.settingsV1PlumeAdvance.value = String(state.plumeSettings.timeAdvanceMs);
  els.settingsV1PlumeAdvanceValue.textContent = `${state.plumeSettings.timeAdvanceMs} ms`;
  els.settingsDisplayPitchAlgorithm.value = state.displayPitchAlgorithm;
}

function applyLiveTrackerSettings() {
  state.pitchSmoother.configure(state.detectorSettings);
}

function openDetectorSettings() {
  updateDetectorSettingsUi();
  if (!els.settingsDialog.open) els.settingsDialog.showModal();
}

function normalizeSlug(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function pieceTitleKey(pieceId) { return `choir-piece-title:${pieceId}`; }

function proposedPieceTitle(piece) {
  const duplicate = state.library.filter((item) => item.title.trim().toLowerCase() === piece.title.trim().toLowerCase()).length > 1;
  if (!duplicate) return piece.title;
  const knownVariants = { animachristi: 'SATB', 'animachristi-strofa-monodico': 'Strofe monodiche' };
  const inferredVariant = piece.piece_id.replace(normalizeSlug(piece.title), '').replace(/^-+|-+$/g, '').replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const variant = (knownVariants[piece.piece_id] ?? inferredVariant) || 'Versione alternativa';
  return `${piece.title} — ${variant}`;
}

function pieceDisplayTitle(piece) {
  try { return localStorage.getItem(pieceTitleKey(piece.piece_id))?.trim() || proposedPieceTitle(piece); }
  catch (_) { return proposedPieceTitle(piece); }
}

function populateLibraryPieces(selectedPieceId) {
  els.libraryPiece.replaceChildren(...state.library.map((piece) => new Option(pieceDisplayTitle(piece), piece.piece_id)));
  els.libraryPiece.value = state.library.some((piece) => piece.piece_id === selectedPieceId) ? selectedPieceId : state.library[0].piece_id;
}

function noteLabel(pitch, beat = state.clock?.snapshot().beat ?? 0) {
  if (!Number.isFinite(pitch)) return '—';
  const midi = Math.round(pitch);
  const flatKey = state.runtime?.keyFifthsAt(beat) < 0;
  const names = state.noteNames === 'italian'
    ? flatKey
      ? ['Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si']
      : ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si']
    : flatKey
      ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
      : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

function vocalParts(runtime) {
  return runtime.parts.filter((part) => !/(^|[-\s])(organo|organ|piano|accompagnamento|accompaniment)([-\s]|$)/i.test(part.name));
}

function monodicPracticePayload(payload) {
  const writtenPart = payload.parts.find((part) => !/(^|[-\s])(organo|organ|piano|accompagnamento|accompaniment)([-\s]|$)/i.test(part.name));
  if (!writtenPart) throw new Error('La melodia monodica non contiene una parte vocale');
  const parts = [
    ['Soprano', 0], ['Contralto', 0], ['Tenore', -12], ['Basso', -12],
  ].map(([name, transpose]) => ({ id: `mono-${normalizeSlug(name)}`, name, kind: 'vocal', transpose }));
  const targetEvents = parts.flatMap((part) => payload.target_events
    .filter((event) => event.part_id === writtenPart.id)
    .map((event) => ({ ...event, id: `${part.id}-${event.id}`, part_id: part.id,
      midi_pitch: Number.isFinite(event.midi_pitch) ? event.midi_pitch + part.transpose : event.midi_pitch })));
  return { ...payload, parts, target_events: targetEvents };
}

function buildOccurrenceMeasures(runtime) {
  if (runtime.performanceOccurrences.length) {
    return runtime.performanceOccurrences.map((occurrence) => {
      const written = runtime.measures.find((measure) => measure.id === occurrence.writtenMeasureId);
      return {
        id: occurrence.id,
        number: written?.number ?? '?',
        startBeat: occurrence.startBeat,
        endBeat: occurrence.endBeat,
        timeSignatureNumerator: written?.timeSignatureNumerator ?? 4,
        timeSignatureDenominator: written?.timeSignatureDenominator ?? 4,
        beatOffset: written?.beatOffset ?? 0,
      };
    });
  }
  let beat = 0;
  return runtime.measures.map((measure) => {
    const duration = measure.timeSignatureNumerator * (4 / measure.timeSignatureDenominator);
    const item = { id: measure.id, number: measure.number, startBeat: beat, endBeat: beat + duration, timeSignatureNumerator: measure.timeSignatureNumerator, timeSignatureDenominator: measure.timeSignatureDenominator, beatOffset: measure.beatOffset ?? 0 };
    beat += duration;
    return item;
  });
}

function totalBeats() {
  return state.occurrenceMeasures.at(-1)?.endBeat ?? Math.max(0, ...state.runtime.targetEvents.map((event) => event.onsetBeat + event.durationBeats));
}

function measureIndexAt(beat) {
  const index = state.occurrenceMeasures.findIndex((measure) => measure.startBeat <= beat && beat < measure.endBeat);
  return index < 0 ? Math.max(0, state.occurrenceMeasures.length - 1) : index;
}

function sourceGlyph(event) {
  return event ? state.scoreGeometry.get(event.sourceEventId) ?? null : null;
}

function fallbackScorePosition(beat) {
  const index = measureIndexAt(beat);
  const measure = state.occurrenceMeasures[index];
  const defaultMeasureWidths = [[13, 32], [32, 55], [55, 73], [73, 93]];
  const pages = state.bundleManifest?.assets?.score_pages?.[state.runtime.selectedPartId]
    ?? state.bundleManifest?.assets?.full_score_pages ?? [];
  const slot = state.fallbackScoreSlots[index] ?? (pages.length ? (() => {
    const [startX, endX] = defaultMeasureWidths[index % defaultMeasureWidths.length];
    return { page: Math.min(pages.length, Math.floor(index / defaultMeasureWidths.length) + 1),
      systemId: `estimated-p${Math.floor(index / defaultMeasureWidths.length) + 1}`, startX, endX,
      y_percent: 17.4, systemCenterY: 17.4 };
  })() : null);
  if (!measure || !slot) return null;
  const progress = Math.max(0, Math.min(1, (beat - measure.startBeat) / Math.max(.01, measure.endBeat - measure.startBeat)));
  return { ...slot, x_percent: slot.startX + (slot.endX - slot.startX) * progress };
}

function closestScoreEvent(beat) {
  const events = state.runtime.targetEvents;
  return events.find((event) => event.onsetBeat <= beat && beat < event.onsetBeat + event.durationBeats)
    ?? events.find((event) => event.onsetBeat > beat)
    ?? events.at(-1);
}

function loadScoreImage(page = 1) {
  const part = state.runtime.parts.find((item) => item.id === state.runtime.selectedPartId);
  const pages = state.fullScore
    ? state.bundleManifest.assets.full_score_pages
    : (state.bundleManifest.assets.score_pages[state.runtime.selectedPartId] ?? state.bundleManifest.assets.full_score_pages);
  const source = pages?.[Math.max(0, Math.min(pages.length - 1, page - 1))];
  if (!source) { els.scoreLoading.hidden = false; els.scoreLoading.textContent = 'Pagina spartito non disponibile'; return; }
  if (els.scoreImage.getAttribute('src') === source) return;
  els.scoreLoading.hidden = false;
  state.activeScoreSegment = null;
  els.scoreImage.src = source;
  els.scoreImage.alt = state.fullScore ? 'Partitura completa' : `Spartito: ${part?.name ?? 'parte selezionata'}`;
}

function voiceStemUrl(filename) {
  return `${state.bundleManifest.assets.audio_root}/${filename}`;
}

function pauseVoiceStems() {
  for (const audio of state.voiceStemAudio.values()) audio.pause();
}

function syncVoiceStemLevels() {
  const count = Math.max(1, state.voiceStemAudio.size);
  const level = Math.min(1, Number(els.volume.value) / 100 * .9 / Math.sqrt(count));
  for (const audio of state.voiceStemAudio.values()) {
    audio.volume = level;
    audio.playbackRate = Number(els.playbackSpeed.value);
    audio.preservesPitch = true;
  }
}

function syncBackingLevel() {
  const silentClock = Object.keys(state.backingManifest?.voice_stems ?? {}).length > 0
    && !state.backingManifest?.accompaniment_file;
  els.backingAudio.volume = silentClock ? 0 : Number(els.volume.value) / 100;
}

function configureVoiceStems() {
  pauseVoiceStems();
  state.voiceStemAudio.clear();
  const stems = state.backingManifest?.voice_stems ?? {};
  const mixerAvailable = Object.keys(stems).length > 0;
  els.accompanimentMode.disabled = !mixerAvailable;
  for (const partId of state.selectedVoiceIds) {
    if (!stems[partId]) continue;
    const audio = new Audio(voiceStemUrl(stems[partId]));
    audio.preload = 'auto';
    state.voiceStemAudio.set(partId, audio);
  }
  syncVoiceStemLevels();
  els.accompanimentMode.textContent = !mixerAvailable ? 'Mix completo'
    : state.voiceStemAudio.size ? `Voci · ${state.voiceStemAudio.size}` : 'Solo base';
}

async function playVoiceStems() {
  const time = els.backingAudio.currentTime;
  syncVoiceStemLevels();
  await Promise.all([...state.voiceStemAudio.values()].map(async (audio) => {
    if (Math.abs(audio.currentTime - time) > .04) audio.currentTime = time;
    try { await audio.play(); } catch (_) { /* Master audio reports actionable playback errors. */ }
  }));
}

function renderVoiceMixer() {
  const stems = state.backingManifest?.voice_stems ?? {};
  const parts = vocalParts(state.runtime).filter((part) => stems[part.id]);
  els.voiceMixerOptions.replaceChildren(...parts.map((part) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.value = part.id; input.checked = state.selectedVoiceIds.has(part.id);
    input.addEventListener('change', () => {
      if (input.checked) state.selectedVoiceIds.add(part.id); else state.selectedVoiceIds.delete(part.id);
      configureVoiceStems();
      if (state.clock.running) void playVoiceStems();
    });
    label.append(input, document.createTextNode(part.id === state.runtime.selectedPartId ? `${part.name} · mia parte` : part.name));
    return label;
  }));
}

function configureBacking() {
  if (!state.bundleApproved || !state.bundleManifest?.integrity?.consistent
      || state.backingManifest?.score_version_id !== state.runtime.scoreVersionId
      || state.backingManifest?.timeline_hash !== state.bundleManifest.integrity.hashes.timeline) {
    els.backingAudio.removeAttribute('src');
    els.togglePlayback.disabled = true;
    return;
  }
  const mix = state.backingManifest?.mixes?.[state.runtime.selectedPartId];
  if (!mix) { els.backingAudio.removeAttribute('src'); return; }
  const speed = Number(els.playbackSpeed.value);
  const speedFile = mix.files_by_speed?.[String(speed)];
  state.usesPreRenderedSpeed = Boolean(speedFile) && !state.backingManifest.accompaniment_file;
  const baseFile = state.backingManifest.accompaniment_file ?? speedFile ?? mix.file;
  const file = `${state.bundleManifest.assets.audio_root}/${baseFile}`;
  els.backingAudio.src = state.transpose && RUNTIME_CONFIG.transposeUrlTemplate
    ? RUNTIME_CONFIG.transposeUrlTemplate
      .replace('{file}', encodeURIComponent(file))
      .replace('{semitones}', encodeURIComponent(state.transpose))
    : file;
  els.togglePlayback.disabled = false;
  syncBackingLevel();
  els.backingAudio.playbackRate = state.usesPreRenderedSpeed ? 1 : speed;
  els.backingAudio.preservesPitch = true;
  configureVoiceStems();
}

function buildScoreGeometry(partId) {
  const entries = Object.entries(state.glyphMap)
    .filter(([eventId]) => eventId.startsWith(`${partId}-`))
    .map(([eventId, glyph]) => ({ eventId, ...glyph }))
    .sort((a, b) => a.page - b.page || a.y_percent - b.y_percent || a.x_percent - b.x_percent);
  const systems = [];
  entries.forEach((entry) => {
    let system = systems.at(-1);
    if (!system || system.page !== entry.page || (entry.system_id && entry.system_id !== system.sourceSystemId) || (!entry.system_id && entry.y_percent - system.maxY > 16)) {
      const sequence = systems.filter((item) => item.page === entry.page).length + 1;
      system = { id: `${partId}-p${entry.page}-s${sequence}`, sourceSystemId: entry.system_id, page: entry.page, minY: entry.y_percent, maxY: entry.y_percent, events: [] };
      systems.push(system);
    }
    system.minY = Math.min(system.minY, entry.y_percent);
    system.maxY = Math.max(system.maxY, entry.y_percent);
    system.events.push(entry);
  });
  const geometry = new Map();
  systems.forEach((system) => {
    const centerY = (system.minY + system.maxY) / 2;
    system.events.forEach((entry) => geometry.set(entry.eventId, { ...entry, systemId: system.id, systemCenterY: centerY }));
  });
  state.scoreGeometry = geometry;
  state.activeScoreSegment = null;
}

function scorePageFallbackSlots(svg, page) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const [, , width = 0, height = 0] = (document.documentElement.getAttribute('viewBox') ?? '').trim().split(/\s+/).map(Number);
  if (!width || !height) return [];
  const staffLines = [...document.querySelectorAll('.StaffLines')].map((line) => {
    const points = (line.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
    return { x1: points[0], y: points[1], x2: points[2] };
  }).filter((line) => line.x1 != null && line.y != null && line.x2 != null).sort((a, b) => a.y - b.y);
  const barLines = [...document.querySelectorAll('.BarLine')].map((line) => {
    const points = (line.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
    return { x: points[0], y1: points[1], y2: points[3] };
  }).filter((line) => line.x != null && line.y1 != null && line.y2 != null);
  const musicalSymbols = [...document.querySelectorAll('.Note, .Rest')].map((symbol) => {
    const match = (symbol.getAttribute('d') ?? '').match(/^\s*M\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)/);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
  }).filter((symbol) => symbol && Number.isFinite(symbol.x) && Number.isFinite(symbol.y));
  const slots = [];
  for (let offset = 0, systemIndex = 0; offset + 4 < staffLines.length; offset += 5, systemIndex += 1) {
    const lines = staffLines.slice(offset, offset + 5);
    const startX = Math.min(...lines.map((line) => line.x1));
    const endX = Math.max(...lines.map((line) => line.x2));
    const centerY = lines.reduce((sum, line) => sum + line.y, 0) / lines.length;
    const barXs = [...new Set(barLines.filter((line) => Math.abs((line.y1 + line.y2) / 2 - centerY) < 420
      && line.x > startX + 20 && line.x <= endX + 25).map((line) => Math.round(line.x)).sort((a, b) => a - b))];
    let left = startX;
    for (let barIndex = 0; barIndex < barXs.length; barIndex += 1) {
      const right = barXs[barIndex];
      // On a new system the staff begins before clef, key and time signature.
      // Anchor its first measure to the first actual note/rest instead.
      const firstSymbolX = barIndex === 0
        ? Math.min(...musicalSymbols.filter((symbol) => Math.abs(symbol.y - centerY) < 500
          && symbol.x > left + 20 && symbol.x < right).map((symbol) => symbol.x))
        : Number.POSITIVE_INFINITY;
      const visualLeft = Number.isFinite(firstSymbolX) ? firstSymbolX : left;
      if (right - visualLeft > 40) slots.push({ page, systemId: `fallback-p${page}-s${systemIndex}`, startX: visualLeft / width * 100,
        endX: right / width * 100, y_percent: centerY / height * 100, systemCenterY: centerY / height * 100 });
      left = right;
    }
  }
  return slots;
}

async function buildFallbackScoreGeometry(partId) {
  const pages = state.bundleManifest.assets.score_pages[partId] ?? state.bundleManifest.assets.full_score_pages;
  if (!pages?.length) { state.fallbackScoreSlots = []; return; }
  try {
    const contents = await Promise.all(pages.map(async (page) => {
      const response = await fetch(page, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`pagina spartito non disponibile (${response.status})`);
      return response.text();
    }));
    if (state.runtime.selectedPartId !== partId) return;
    state.fallbackScoreSlots = contents.flatMap((svg, index) => scorePageFallbackSlots(svg, index + 1));
    if (!state.scoreGeometry.size && state.fallbackScoreSlots.length !== state.occurrenceMeasures.length) {
      console.warn('Mappa di fallback spartito incompleta', { slots: state.fallbackScoreSlots.length, measures: state.occurrenceMeasures.length });
    }
  } catch (error) {
    state.fallbackScoreSlots = [];
    console.warn('Impossibile costruire il cursore di fallback dello spartito', error);
    return;
  }
  render();
}

function renderScore(beat) {
  const event = closestScoreEvent(beat);
  const glyph = sourceGlyph(event);
  const fallback = glyph ? null : fallbackScorePosition(beat);
  const activeGlyph = glyph ?? fallback;
  const page = activeGlyph?.page ?? Math.min(3, Math.floor(measureIndexAt(beat) / 7) + 1);
  if (page !== state.scorePage) state.scorePage = page;
  loadScoreImage(page);
  if (state.fullScore) { els.scoreSheet.style.transform = 'translate(0, 0)'; return; }
  if (!activeGlyph) {
    // Library MSCZ exports currently use complete-score SVG pages.  There is
    // no per-note SVG map yet, so expose the first staff system rather than
    // the large blank top margin of an A4 MuseScore page.
    els.scoreSheet.style.transform = 'translate(0, -13%)';
    els.scoreCursor.style.display = 'none';
    return;
  }
  els.scoreCursor.style.display = '';

  const nextEvent = glyph && state.runtime.targetEvents.find((candidate) => {
    const candidateGlyph = sourceGlyph(candidate);
    return candidate.onsetBeat >= event.onsetBeat + event.durationBeats - 0.001 && candidateGlyph?.systemId === glyph.systemId;
  });
  const candidateNextGlyph = sourceGlyph(nextEvent);
  const nextGlyph = glyph && candidateNextGlyph?.x_percent >= glyph.x_percent ? candidateNextGlyph : null;
  const progress = Math.max(0, Math.min(1, (beat - event.onsetBeat) / Math.max(event.durationBeats, .01)));
  const x = glyph ? (nextGlyph ? glyph.x_percent + (nextGlyph.x_percent - glyph.x_percent) * progress : glyph.x_percent) : fallback.x_percent;
  els.scoreCursor.style.left = `${x}%`;
  els.scoreCursor.style.top = `${activeGlyph.y_percent}%`;

  const imageHeight = els.scoreImage.getBoundingClientRect().height;
  const viewportHeight = els.scoreViewport.clientHeight;
  const sheetWidth = els.scoreSheet.getBoundingClientRect().width;
  const viewportWidth = els.scoreViewport.clientWidth;
  if (!imageHeight || !sheetWidth || !viewportWidth) return;
  // Keep the current-time bar visible across the whole score window, rather
  // than limiting it to a small marker around the active note.
  els.scoreCursor.style.height = `${Math.max(86, viewportHeight)}px`;
  const systemY = imageHeight * activeGlyph.systemCenterY / 100;
  const panelCount = Math.max(1, Math.ceil(sheetWidth / viewportWidth));
  const panelIndex = Math.min(panelCount - 1, Math.floor(x / 100 * panelCount));
  const segmentKey = `${activeGlyph.systemId}-panel${panelIndex}`;
  if (segmentKey !== state.activeScoreSegment) {
    const offsetY = Math.max(viewportHeight - imageHeight, Math.min(0, viewportHeight * .52 - systemY));
    const offsetX = panelCount > 1 ? -panelIndex * (sheetWidth - viewportWidth) / (panelCount - 1) : 0;
    els.scoreSheet.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    state.activeScoreSegment = segmentKey;
  }
  state.lastScoreEvent = { eventId: event.id, sourceEventId: event.sourceEventId, measureNumber: event.measureNumber, beat };
}

function pitchBounds(beat) {
  const measureIndex = measureIndexAt(beat);
  const key = `${state.runtime.selectedPartId}:${measureIndex}`;
  if (!state.pitchViewport || state.pitchViewport.key !== key) {
    const firstIndex = Math.max(0, measureIndex - 1);
    const lastIndex = Math.min(state.occurrenceMeasures.length - 1, measureIndex + 2);
    const startBeat = state.occurrenceMeasures[firstIndex]?.startBeat ?? beat - UI_CONFIG.historyBeats;
    const endBeat = state.occurrenceMeasures[lastIndex]?.endBeat ?? beat + UI_CONFIG.futureBeats;
    const pitches = state.runtime.targetEvents
      .filter((event) => event.onsetBeat + event.durationBeats >= startBeat && event.onsetBeat <= endBeat)
      .map((event) => event.midiPitch + state.transpose).filter(Number.isFinite);
    let target = { min: 55, max: 67 };
    if (pitches.length) {
      let min = Math.floor(Math.min(...pitches)) - 2;
      let max = Math.ceil(Math.max(...pitches)) + 2;
      if (max - min < 9) { const pad = (9 - (max - min)) / 2; min -= pad; max += pad; }
      target = { min: Math.floor(min), max: Math.ceil(max) };
    }
    const current = state.pitchViewport?.bounds ?? { ...target };
    state.pitchViewport = { key, bounds: current, target, lastFrameMs: performance.now(), animating: current.min !== target.min || current.max !== target.max };
  }
  const viewport = state.pitchViewport;
  const now = performance.now();
  const elapsed = Math.min(64, Math.max(0, now - viewport.lastFrameMs));
  const transition = smoothPitchBounds(viewport.bounds, viewport.target, elapsed, UI_CONFIG.pitchViewportResponseMs);
  viewport.bounds = transition.bounds;
  viewport.lastFrameMs = now;
  viewport.animating = transition.animating;
  return viewport.bounds;
}

function sampleMicrophone(beat, running) {
  const now = performance.now();
  const elapsed = state.lastSampleMs == null ? 0 : Math.min(64, now - state.lastSampleMs);
  state.lastSampleMs = now;
  if (state.microphoneStatus !== 'active') { state.trackedPitch = null; state.displayPitch = null; state.pitchConfirmationState = null; state.displayPitchFilter.reset(); state.microphoneRms = 0; return; }
  state.microphoneAnalyser.getFloatTimeDomainData(state.microphoneBuffer);
  const v1StartedMs = performance.now();
  const rawEstimate = detectPitch(state.microphoneBuffer, state.microphoneContext.sampleRate, state.detectorSettings);
  if (state.neuralLive.enabled || state.neuralLive.loading) {
    state.neuralLive.v1DurationsMs.push(performance.now() - v1StartedMs);
    if (state.neuralLive.v1DurationsMs.length > 80) state.neuralLive.v1DurationsMs.shift();
  }
  const estimate = state.pitchSmoother.update(rawEstimate, performance.now());
  queueNeuralLiveInference(state.microphoneBuffer, state.microphoneContext.sampleRate, beat);
  appendBenchmarkFrame(estimate, beat);
  state.microphoneRms = estimate.rms;
  document.getElementById('microphone-level').value = state.microphoneRms;
  document.getElementById('test-microphone-level').value = state.microphoneRms;
  document.getElementById('microphone-help').textContent = state.trackedPitch == null
    ? state.microphoneRms < .001 ? 'Microfono aperto: segnale troppo debole. Controlla ingresso e volume in Windows.' : 'Il segnale arriva. Tieni una nota per riconoscerla.'
    : `Nota riconosciuta: ${noteLabel(state.trackedPitch)}. Sei pronto per iniziare.`;
  state.trackedPitch = estimate.stable && estimate.accepted && estimate.hz
    ? 69 + 12 * Math.log2(estimate.hz / 440)
    : null;
  const rawPitch = Number.isFinite(estimate.rawHz) ? 69 + 12 * Math.log2(estimate.rawHz / 440) : null;
  const provisional = ['octave-transition', 'large-jump-transition'].includes(estimate.rejectionReason);
  state.pitchConfirmationState = provisional ? 'provisional' : (state.trackedPitch != null ? 'confirmed' : null);
  if (provisional) {
    state.displayPitchFilter.reset();
    state.displayPitch = rawPitch;
  } else if (state.trackedPitch == null) {
    state.displayPitchFilter.reset();
    state.displayPitch = null;
  } else if (state.displayPitchAlgorithm === 'v1') state.displayPitch = displayPitchFromTracked(state.trackedPitch);
  else state.displayPitch = state.displayPitchFilter.filter(state.trackedPitch, performance.now() / 1000);
  if (running && state.trackedPitch != null) {
    const target = state.runtime.targetAt(beat);
    if (state.attemptActive && target && beat >= state.scoringStartBeat && beat >= target.onsetBeat + target.attackGraceBeats) {
      state.attempt.voicedMs += elapsed;
      if (Math.abs((state.trackedPitch - target.midiPitch - state.transpose) * 100) <= UI_CONFIG.acceptableCents) state.attempt.insideMs += elapsed;
    }
  }
  // Retain invalid observations too: the renderer must see silence boundaries.
  if (running || state.displayPitch != null || rawPitch != null) {
    const previous = state.pitchSamples.at(-1);
    const sample = { beat, trackedPitch: state.trackedPitch, displayPitch: state.displayPitch, rawPitch,
      confirmationState: state.pitchConfirmationState,
      confidence: estimate.confidence, clarity: estimate.clarity, takeId: state.pitchTakeId };
    if (!running && previous?.takeId === state.pitchTakeId && Math.abs(beat - previous.beat) < .025) state.pitchSamples[state.pitchSamples.length - 1] = sample;
    else if (!previous || previous.takeId !== state.pitchTakeId || beat - previous.beat >= .025) state.pitchSamples.push(sample);
  }
  // Keep a bounded session history: the director can pan back over earlier
  // takes instead of losing the trace whenever playback is repositioned.
  if (state.pitchSamples.length > 12000) state.pitchSamples.splice(0, state.pitchSamples.length - 12000);
}

function medianOf(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentileOf(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * percentile))];
}

function updateNeuralLiveUi() {
  const neural = state.neuralLive;
  const running = neural.enabled || neural.loading;
  els.neuralLive.setAttribute('aria-pressed', String(running));
  els.neuralLive.disabled = neural.loading;
  const medianMs = medianOf(neural.durationsMs);
  els.neuralLive.textContent = neural.loading ? 'Neurale…' : neural.enabled
    ? `Neurale ${medianMs == null ? 'live' : `${Math.round(medianMs)} ms`}`
    : 'Neurale live';
  els.neuralLiveStatus.hidden = !running;
  if (!running) return;
  els.neuralLiveNote.textContent = Number.isFinite(neural.latestPitch) ? noteLabel(neural.latestPitch) : '—';
  if (neural.loading) els.neuralLiveTiming.textContent = 'carico modello locale…';
  else if (neural.error) els.neuralLiveTiming.textContent = neural.error;
  else {
    const p50 = medianOf(neural.durationsMs), p95 = percentileOf(neural.durationsMs, .95), v1p50 = medianOf(neural.v1DurationsMs);
    els.neuralLiveTiming.textContent = p50 == null ? 'attendo voce…' : `v1 p50 ${Math.round(v1p50)} ms · v5 p50 ${Math.round(p50)} / p95 ${Math.round(p95)} ms`;
  }
}

function resampleLiveCrepeFrame(samples, sourceRate) {
  const output = new Float32Array(1024);
  const sourceSpan = 1024 / 16000 * sourceRate;
  const start = samples.length - sourceSpan;
  for (let index = 0; index < output.length; index += 1) {
    const sourcePosition = start + index / (output.length - 1) * (sourceSpan - 1);
    const left = Math.floor(sourcePosition), fraction = sourcePosition - left;
    if (left < 0 || left + 1 >= samples.length) continue;
    output[index] = samples[left] * (1 - fraction) + samples[left + 1] * fraction;
  }
  return output;
}

function queueNeuralLiveInference(samples, sourceRate, beat) {
  const neural = state.neuralLive;
  const now = performance.now();
  if (!neural.enabled || neural.inFlight || now - neural.lastStartedMs < 50) return;
  neural.inFlight = true; neural.lastStartedMs = now;
  const frame = normaliseCrepeFrame(resampleLiveCrepeFrame(samples, sourceRate));
  const generation = neural.generation;
  void (async () => {
    try {
      const session = await crepeSession();
      const ort = window.ort;
      const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', frame, [1, 1024]) });
      if (generation !== state.neuralLive.generation) return;
      const probabilities = results[session.outputNames[0]]?.data;
      if (!probabilities || probabilities.length < 360) throw new Error('output CREPE non valido');
      const result = decodeCrepeProbabilities(probabilities?.subarray(0, 360));
      const elapsedMs = performance.now() - now;
      neural.durationsMs.push(elapsedMs);
      if (neural.durationsMs.length > 80) neural.durationsMs.shift();
      neural.lastLatencyMs = elapsedMs;
      neural.latestPitch = Number.isFinite(result.hz) ? 69 + 12 * Math.log2(result.hz / 440) : null;
      neural.samples.push({ beat, pitch: neural.latestPitch, takeId: state.pitchTakeId, salience: Float32Array.from(probabilities.subarray(0, 360)) });
      if (neural.samples.length > 12000) neural.samples.splice(0, neural.samples.length - 12000);
    } catch (error) {
      if (generation === state.neuralLive.generation) {
        neural.error = 'inferenza non disponibile';
        neural.enabled = false;
        showToast(`CREPE live non disponibile: ${error.message ?? 'errore runtime'}`);
      }
    } finally {
      if (generation === state.neuralLive.generation) {
        neural.inFlight = false;
        updateNeuralLiveUi();
      }
    }
  })();
}

async function toggleNeuralLive() {
  const neural = state.neuralLive;
  if (neural.enabled || neural.loading) {
    neural.generation += 1; neural.enabled = false; neural.loading = false; neural.inFlight = false; neural.latestPitch = null; neural.samples = [];
    updateNeuralLiveUi(); showToast('Confronto CREPE live fermato. V1 resta attivo.'); render(); return;
  }
  if (state.microphoneStatus !== 'active') await toggleMicrophone();
  if (state.microphoneStatus !== 'active') return;
  neural.loading = true; neural.error = null; neural.samples = []; neural.durationsMs = []; neural.v1DurationsMs = []; neural.latestPitch = null;
  const generation = ++neural.generation;
  updateNeuralLiveUi();
  try {
    await crepeSession();
    if (generation !== neural.generation) return;
    neural.loading = false; neural.enabled = true;
    showToast('Seconda analisi live attiva: traccia secondaria, score invariato.');
  } catch (error) {
    if (generation !== neural.generation) return;
    neural.loading = false; neural.enabled = false; neural.error = 'runtime non caricato';
    showToast(`CREPE live non disponibile: ${error.message ?? 'errore runtime'}`);
  }
  updateNeuralLiveUi(); render();
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, r);
}

// A piano roll should never imply a continuous glissando merely because two
// estimates happened to be consecutive.  We keep stable local runs, but break
// the ink over silence and unvalidated leaps.  The omitted micro-runs are
// still present in the recorded data and in the numerical benchmark metrics.
function stableVisualPitchSegments(frames, {
  pitchAt,
  timeAt,
  maxJumpCents = 320,
  maxGap = Infinity,
  minimumFrames = 3,
} = {}) {
  const complete = [];
  let current = [];
  const close = () => {
    if (current.length) complete.push(current);
    current = [];
  };
  for (const frame of frames) {
    const pitch = pitchAt(frame), time = timeAt(frame);
    if (!Number.isFinite(pitch) || !Number.isFinite(time)) { close(); continue; }
    const previous = current.at(-1);
    if (previous && (time - previous.time > maxGap || Math.abs(pitch - previous.pitch) * 100 > maxJumpCents)) close();
    current.push({ frame, pitch, time });
  }
  close();
  return complete.filter((segment) => segment.length >= minimumFrames);
}

function drawStablePitchSegments(context, segments, xAt, yAt) {
  for (const segment of segments) {
    context.beginPath();
    segment.forEach((point, index) => {
      const x = xAt(point.frame), y = yAt(point.pitch);
      if (index) context.lineTo(x, y); else context.moveTo(x, y);
    });
    context.stroke();
  }
}

function livePlumeSettings(displayBeat, inspecting, nowX, trailStartX) {
  const speed = Math.max(.1, Number(els.playbackSpeed.value) || 1);
  return { ...state.plumeSettings, nowX, trailStartX,
    mode: inspecting ? 'review' : 'live', sortedTimeline: !inspecting,
    currentTime: state.runtime.secondsAtBeat(displayBeat) / speed,
    timeAt: sample => state.runtime.secondsAtBeat(sample.beat) / speed };
}

function visuallyAdvancedPitchBeat(beat) {
  const advanceMs = Math.max(0, Math.min(200, Number(state.plumeSettings.timeAdvanceMs) || 0));
  if (!advanceMs || !state.runtime) return beat;
  const playbackSpeed = Math.max(.1, Number(els.playbackSpeed.value) || 1);
  const scoreSeconds = state.runtime.secondsAtBeat(beat) - advanceMs / 1000 * playbackSpeed;
  return state.runtime.beatAtSeconds(Math.max(0, scoreSeconds));
}

function drawPitchLane(beat) {
  const canvas = els.pitchLane;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const plot = { left: rect.width < 700 ? 48 : 58, right: rect.width - 8, top: rect.width < 700 ? 28 : 32, bottom: rect.height - 24 };
  const inspect = state.gridInspect;
  const inspecting = !state.clock.running && inspect.active;
  const displayBeat = inspecting ? inspect.viewBeat : beat;
  const baseBounds = pitchBounds(displayBeat);
  const baseCenter = (baseBounds.min + baseBounds.max) / 2 + (inspecting ? inspect.pitchOffset : 0);
  const baseSpan = baseBounds.max - baseBounds.min;
  const pitchSpan = baseSpan / (inspecting ? inspect.pitchZoom : 1);
  const bounds = { min: baseCenter - pitchSpan / 2, max: baseCenter + pitchSpan / 2 };
  const historyBeats = UI_CONFIG.historyBeats / (inspecting ? inspect.timeZoom : 1);
  const futureBeats = UI_CONFIG.futureBeats / (inspecting ? inspect.timeZoom : 1);
  const rowHeight = (plot.bottom - plot.top) / (bounds.max - bounds.min);
  const nowX = timeToX(displayBeat, displayBeat, plot.left, plot.right, historyBeats, futureBeats);
  els.intonationReadout.style.left = `${nowX + 12}px`;
  els.intonationReadout.style.right = 'auto';

  ctx.textBaseline = 'middle';
  ctx.font = `${rect.width < 700 ? 9 : 10}px Inter, sans-serif`;
  for (let pitch = Math.ceil(bounds.min); pitch <= Math.floor(bounds.max); pitch += 1) {
    const y = pitchToY(pitch, bounds.min, bounds.max, plot.top, plot.bottom);
    const pitchClass = ((pitch % 12) + 12) % 12;
    const isWhiteKey = [0, 2, 4, 5, 7, 9, 11].includes(pitchClass);
    // Alternating white-key and black-key lanes make the vertical axis read
    // like a piano keyboard instead of a uniform scientific graph.
    ctx.fillStyle = isWhiteKey ? 'rgba(166,198,193,.075)' : 'rgba(2,10,14,.27)';
    ctx.fillRect(plot.left, y - rowHeight / 2, plot.right - plot.left, rowHeight);
    // The only continuous horizontal dividers are where adjacent white keys
    // touch on a piano: Si–Do and Mi–Fa. Draw the lower edge of Do/Fa, since
    // higher MIDI pitches are rendered above lower ones.
    if (pitchClass === 0 || pitchClass === 5) {
      ctx.strokeStyle = 'rgba(190,215,211,.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.left, Math.round(y + rowHeight / 2) + .5);
      ctx.lineTo(plot.right, Math.round(y + rowHeight / 2) + .5);
      ctx.stroke();
    }
  }

  const visibleStart = displayBeat - historyBeats - 1;
  const visibleEnd = displayBeat + futureBeats + 1;
  ctx.save();
  ctx.beginPath(); ctx.rect(plot.left, 0, plot.right - plot.left, plot.bottom); ctx.clip();
  rhythmGridLines(state.occurrenceMeasures, visibleStart, visibleEnd).forEach((line) => {
    const x = timeToX(line.beat, displayBeat, plot.left, plot.right, historyBeats, futureBeats);
    if (line.kind === 'measure') {
      ctx.strokeStyle = 'rgba(226,180,101,.48)'; ctx.lineWidth = 1.4; ctx.setLineDash([]);
    } else if (line.kind === 'beat') {
      ctx.strokeStyle = 'rgba(180,207,203,.25)'; ctx.lineWidth = 1; ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = 'rgba(180,207,203,.12)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    }
    ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, line.kind === 'subdivision' ? plot.top : 18); ctx.lineTo(Math.round(x) + .5, plot.bottom); ctx.stroke();
    if (line.label && Math.abs(x - nowX) > 34) {
      ctx.fillStyle = line.kind === 'measure' ? '#d9ad67' : '#829a99';
      ctx.font = `${line.kind === 'measure' ? '700 ' : ''}${rect.width < 700 ? 8 : 9}px Inter, sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(line.label, x + 4, line.kind === 'measure' ? 4 : 19);
    }
  });
  ctx.restore(); ctx.setLineDash([]);
  state.runtime.targetEvents.forEach((event) => {
    if (event.onsetBeat + event.durationBeats < visibleStart || event.onsetBeat > visibleEnd) return;
    const x = timeToX(event.onsetBeat, displayBeat, plot.left, plot.right, historyBeats, futureBeats);
    const endX = timeToX(event.onsetBeat + event.durationBeats, displayBeat, plot.left, plot.right, historyBeats, futureBeats);
    const y = pitchToY(event.midiPitch + state.transpose, bounds.min, bounds.max, plot.top, plot.bottom);
    // A target occupies its complete chromatic lane. Keeping it narrower than
    // the lane makes it look like a thin indicator rather than the note's
    // actual pitch region, especially on a tall piano roll.
    const blockHeight = rowHeight;
    const toleranceHeight = rowHeight * (UI_CONFIG.targetToleranceCents / 50);
    ctx.fillStyle = colorWithAlpha(state.plumeSettings.targetColor, .12);
    roundedRect(ctx, x, y - toleranceHeight / 2, endX - x, toleranceHeight, 3); ctx.fill();
    ctx.fillStyle = event.onsetBeat <= beat && beat < event.onsetBeat + event.durationBeats
      ? state.plumeSettings.targetColor : colorWithAlpha(state.plumeSettings.targetColor, .76);
    roundedRect(ctx, x, y - blockHeight / 2, Math.max(2, endX - x - 2), blockHeight, 3); ctx.fill();
    const graceEnd = timeToX(event.onsetBeat + event.attackGraceBeats, displayBeat, plot.left, plot.right, historyBeats, futureBeats);
    ctx.fillStyle = 'rgba(7,19,25,.24)'; ctx.fillRect(x, y - blockHeight / 2, Math.max(0, graceEnd - x), blockHeight);
    const lyric = event.lyric ?? '';
    if (lyric && endX - x > 18) { ctx.fillStyle = '#d6cbb6'; ctx.textAlign = 'left'; ctx.font = `${rect.width < 700 ? 9 : 11}px Georgia, serif`; ctx.fillText(lyric, x + 2, y - Math.max(9, blockHeight)); }
  });

  ctx.save();
  ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top); ctx.clip();
  if (state.pitchLayers.v1) {
    const v1PlumeSamples = state.pitchSamples.filter((sample) => (inspecting || sample.takeId === state.pitchTakeId) && sample.beat >= visibleStart && sample.beat <= visibleEnd);
    PitchShared.drawConfidencePlume(ctx, v1PlumeSamples,
      (sample) => inspecting ? timeToX(sample.beat, displayBeat, plot.left, plot.right, historyBeats, futureBeats)
        : Math.min(nowX, timeToX(visuallyAdvancedPitchBeat(sample.beat), displayBeat, plot.left, plot.right, historyBeats, futureBeats)),
      (pitch) => pitchToY(pitch, bounds.min, bounds.max, plot.top, plot.bottom), bounds.min, bounds.max,
      livePlumeSettings(displayBeat, inspecting, inspecting ? plot.right : nowX, plot.left));
  }
  if (state.pitchLayers.crepe && (state.neuralLive.enabled || state.neuralLive.samples.length)) {
    // CREPE salience is not a calibrated posterior. Keep its F0 trace separate
    // and secondary, using the same density renderer rather than bin sprites.
    const plumeSamples = state.neuralLive.samples.filter((sample) => (inspecting || sample.takeId === state.pitchTakeId) && sample.beat >= visibleStart && sample.beat <= visibleEnd)
      .map(sample => ({ ...sample, displayPitch: sample.pitch, confidence: sample.salience?.length ? Math.max(...sample.salience) : 0 }));
    PitchShared.drawConfidencePlume(ctx, plumeSamples,
      (sample) => timeToX(sample.beat, displayBeat, plot.left, plot.right, historyBeats, futureBeats),
      (pitch) => pitchToY(pitch, bounds.min, bounds.max, plot.top, plot.bottom), bounds.min, bounds.max,
      { ...livePlumeSettings(displayBeat, inspecting, inspecting ? plot.right : nowX, plot.left), intensity: state.plumeSettings.intensity * .55,
        palette: [[147,207,211], [113,153,183], [83,104,137]] });
  }
  ctx.restore(); ctx.shadowBlur = 0;

  const currentTarget = state.runtime.targetAt(beat);
  ctx.fillStyle = '#0a181e'; ctx.fillRect(nowX - 48, plot.top - 8, 43, plot.bottom - plot.top + 16);
  for (let pitch = Math.ceil(bounds.min); pitch <= Math.floor(bounds.max); pitch += 1) {
    const y = pitchToY(pitch, bounds.min, bounds.max, plot.top, plot.bottom);
    const active = currentTarget && pitch === currentTarget.midiPitch + state.transpose;
    ctx.fillStyle = active ? state.plumeSettings.targetColor : '#93a9a8';
    ctx.font = `${active ? '700 ' : ''}${Math.max(8, Math.min(12, rowHeight * .8))}px Inter, sans-serif`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(noteLabel(pitch, beat), nowX - 8, y);
  }
  if (Number.isFinite(state.displayPitch) && (state.displayPitch < bounds.min || state.displayPitch > bounds.max)) {
    ctx.fillStyle = '#68d1cb'; ctx.textAlign = 'left';
    ctx.fillText(`${state.displayPitch < bounds.min ? '↓' : '↑'} ${noteLabel(state.displayPitch)} fuori scala`, nowX + 10,
      state.displayPitch < bounds.min ? plot.bottom - 10 : plot.top + 10);
  }

  ctx.strokeStyle = '#f0cf8f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(Math.round(nowX) + .5, plot.top); ctx.lineTo(Math.round(nowX) + .5, plot.bottom); ctx.stroke();
  ctx.fillStyle = '#718788'; ctx.font = '9px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('PASSATO', plot.left + 3, plot.bottom + 8); ctx.textAlign = 'right'; ctx.fillText('PROSSIME NOTE', plot.right - 3, plot.bottom + 8);
}

function renderReadout(beat, running) {
  const target = state.runtime.targetAt(beat);
  const singerPitch = state.displayPitch;
  if (!target && singerPitch != null) {
    els.liveNote.textContent = noteLabel(singerPitch); els.liveCents.textContent = '— ¢';
    els.liveState.textContent = 'voce rilevata · nessun target'; els.intonationReadout.dataset.state = ''; return;
  }
  if (!target || singerPitch == null) {
    els.liveNote.textContent = target?.noteName ?? '—';
    els.liveCents.textContent = '— ¢';
    els.liveNote.textContent = '—';
    els.liveState.textContent = state.microphoneStatus === 'active'
      ? state.microphoneRms < .001
        ? 'nessun segnale dal microfono'
        : 'segnale ricevuto: nota non riconosciuta'
      : state.microphoneStatus === 'denied' ? 'permesso negato' : 'attiva il microfono';
    els.intonationReadout.dataset.state = '';
    return;
  }
  if (state.pitchConfirmationState === 'provisional') {
    els.liveNote.textContent = noteLabel(singerPitch);
    els.liveCents.textContent = '— ¢';
    els.liveState.textContent = 'transizione in verifica';
    els.intonationReadout.dataset.state = 'provisional';
    return;
  }
  const cents = centsBetween(pitchToHz(singerPitch), pitchToHz(target.midiPitch + state.transpose));
  const rounded = Math.round(cents);
  const abs = Math.abs(rounded);
  const octaves = Math.round(rounded / 1200);
  const label = abs <= UI_CONFIG.centeredCents ? 'centrato'
    : octaves && Math.abs(rounded - octaves * 1200) < 150
      ? `${Math.abs(octaves)} ottav${Math.abs(octaves) === 1 ? 'a' : 'e'} ${octaves > 0 ? 'sopra' : 'sotto'}`
      : `${abs <= UI_CONFIG.acceptableCents ? 'leggermente ' : ''}${rounded > 0 ? 'crescente' : 'calante'}`;
  els.liveNote.textContent = noteLabel(singerPitch);
  els.liveCents.textContent = `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)} ¢`;
  els.liveState.textContent = label;
  els.intonationReadout.dataset.state = abs > UI_CONFIG.acceptableCents ? 'outside' : 'inside';
  if (label !== state.lastAnnouncedState) state.lastAnnouncedState = label;
}

function render() {
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  if (!state.runtime) return;
  let snapshot = state.clock.snapshot();
  const endBeat = state.phrase ? state.occurrenceMeasures[state.phrase.end].endBeat : totalBeats();
  if (state.attemptActive && snapshot.beat >= endBeat - .01) {
    state.clock.pause(); state.clock.seekBeat(endBeat); snapshot = state.clock.snapshot();
    finishAttempt(); updatePlaybackButton();
    if (state.autoLoop && state.phrase) {
      els.resultDialog.close(); seekToMeasure(state.phrase.start); togglePlayback(); return;
    }
  }
  if (snapshot.beat >= totalBeats()) {
    state.clock.pause(); state.clock.seekBeat(totalBeats()); snapshot = state.clock.snapshot(); updatePlaybackButton();
  }
  state.lastSnapshot = snapshot;
  document.getElementById('score-transpose-label').hidden = state.transpose === 0;
  renderMetronome(snapshot);
  sampleMicrophone(snapshot.beat, snapshot.running);
  const index = measureIndexAt(snapshot.beat);
  const measure = state.occurrenceMeasures[index];
  els.scoreMeasureLabel.textContent = `Battuta ${measure?.number ?? '—'}`;
  els.measureCounter.textContent = `Battuta ${measure?.number ?? '—'} / ${state.occurrenceMeasures.length}`;
  renderScore(snapshot.beat);
  drawPitchLane(snapshot.beat);
  renderReadout(snapshot.beat, snapshot.running);
  renderSyncDebug(snapshot);
  if (snapshot.running || state.microphoneStatus === 'active' || state.pitchViewport?.animating) state.rafId = requestAnimationFrame(render); else state.rafId = null;
}

function updateMetronomeControl() {
  const active = Number(els.metronomeVolume.value) > 0;
  els.metronomeToggle.setAttribute('aria-pressed', String(active));
  els.metronomeToggle.setAttribute('aria-label', active ? 'Disattiva metronomo' : 'Attiva metronomo');
}

function playMetronomeClick(accented) {
  const volume = Number(els.metronomeVolume.value) / 100;
  if (volume <= 0) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  state.metronomeContext ??= new AudioContextClass({ latencyHint: 'interactive' });
  const context = state.metronomeContext;
  if (context.state === 'suspended') context.resume();
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(accented ? 1120 : 820, now);
  oscillator.frequency.exponentialRampToValueAtTime(accented ? 760 : 570, now + 0.045);
  gain.gain.setValueAtTime(Math.max(0.0001, volume * (accented ? 0.5 : 0.34)), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (accented ? 0.075 : 0.055));
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now); oscillator.stop(now + 0.08);
}

function renderMetronome(snapshot) {
  if (!snapshot.running) { state.lastMetronomeBeat = null; return; }
  const measureIndex = measureIndexAt(snapshot.beat);
  const measure = state.occurrenceMeasures[measureIndex];
  const metronomeBeatLength = 4 / (measure?.timeSignatureDenominator ?? 4);
  const beatInMeasure = Math.max(0, Math.floor(((snapshot.beat - (measure?.startBeat ?? 0)) / metronomeBeatLength) + 0.015));
  const metricalBeatIndex = (measure?.beatOffset ?? 0) + beatInMeasure;
  const beatToken = `${measureIndex}:${metricalBeatIndex}`;
  if (state.lastMetronomeBeat == null) {
    state.lastMetronomeBeat = beatToken;
    const nearestPulse = (measure?.startBeat ?? 0) + Math.round((snapshot.beat - (measure?.startBeat ?? 0)) / metronomeBeatLength) * metronomeBeatLength;
    if (Math.abs(snapshot.beat - nearestPulse) < 0.06) {
      playMetronomeClick(metricalBeatIndex === 0);
    }
    return;
  }
  if (beatToken === state.lastMetronomeBeat) return;
  state.lastMetronomeBeat = beatToken;
  playMetronomeClick(metricalBeatIndex === 0);
}

function renderSyncDebug(snapshot) {
  if (!state.syncDebug || !els.syncDebugPanel) return;
  const position = state.runtime.measureAt(snapshot.beat);
  const target = state.runtime.targetAt(snapshot.beat);
  const drift = snapshot.performanceTime - snapshot.mediaTime;
  els.syncDebugPanel.innerHTML = [
    `<span>AUDIO/MEDIA</span><b>${snapshot.mediaTime.toFixed(3)} s</b>`,
    `<span>PERFORMANCE</span><b>${snapshot.performanceTime.toFixed(3)} s</b>`,
    `<span>NOW</span><b>${snapshot.performanceTime.toFixed(3)} s</b>`,
    `<span>TARGET</span><b>m. ${target?.measureNumber ?? position.number} · beat ${position.beatInMeasure.toFixed(2)}</b>`,
    `<span>SCORE CURSOR</span><b>m. ${state.lastScoreEvent?.measureNumber ?? position.number} · beat ${position.beatInMeasure.toFixed(2)}</b>`,
    `<span>DRIFT</span><b>${drift >= 0 ? '+' : ''}${drift.toFixed(3)} s</b>`,
    `<span>RATE</span><b>${snapshot.speed.toFixed(2)}x</b>`,
  ].join('');
}

function updatePlaybackButton() {
  const running = state.clock?.running ?? false;
  els.togglePlayback.querySelector('span').textContent = running ? 'Ⅱ' : '▶';
  els.togglePlayback.setAttribute('aria-label', running ? 'Metti in pausa' : 'Avvia la prova');
  els.togglePlayback.setAttribute('aria-pressed', String(running));
}

function seekToMeasure(index, autoPlay = false) {
  state.attempt = { voicedMs: 0, insideMs: 0 }; state.lastSampleMs = null;
  const seek = measureSeekState(state.occurrenceMeasures, index);
  state.selectedMeasureIndex = seek.selectedIndex;
  state.scoringStartBeat = seek.scoringStart;
  state.clock.seekBeat(seek.playbackStart);
  if (els.backingAudio.readyState === 0) state.pendingAudioTime = state.runtime.secondsAtBeat(seek.playbackStart);
  state.lastMetronomeBeat = null;
  beginPitchTake();
  const playbackNumber = state.occurrenceMeasures[Math.max(0, seek.selectedIndex - 1)]?.number ?? 1;
  const scoringNumber = state.occurrenceMeasures[seek.selectedIndex]?.number ?? 1;
  els.scoringCue.textContent = seek.playbackStart === seek.scoringStart ? `Ingresso da ${scoringNumber}` : `Preascolto ${playbackNumber} · ingresso ${scoringNumber}`;
  if (autoPlay && !state.clock.running) state.clock.play().then(() => { updatePlaybackButton(); requestAnimationFrame(render); });
  updatePlaybackButton(); render();
}

async function togglePlayback() {
  if (state.fullScore) { showToast('Torna a “Mia parte” per avviare la prova.'); return; }
  if (!state.bundleApproved) { showToast('Serve l’approvazione admin di questo bundle.'); return; }
  if (state.clock.snapshot().beat >= totalBeats()) state.clock.seekBeat(0);
  if (state.clock.running) {
    state.clock.pause();
    savePitchHistory();
  } else {
    state.gridInspect.active = false;
    if (state.microphoneStatus !== 'active') await toggleMicrophone();
    if (!state.attemptActive) {
      state.attempt = { voicedMs: 0, insideMs: 0 }; state.lastSampleMs = null;
      if (state.phrase && state.clock.snapshot().beat >= state.occurrenceMeasures[state.phrase.end].endBeat) seekToMeasure(state.phrase.start);
    }
    try { await state.clock.play(); }
    catch (error) { console.error('Audio playback failed', error, els.backingAudio.error); showToast(`Audio non avviato: ${error?.message || 'sorgente non disponibile'}`); }
    state.attemptActive = state.clock.running;
  }
  updatePlaybackButton();
  if (state.clock.running && !state.rafId) state.rafId = requestAnimationFrame(render); else render();
}

function bindGridInspection() {
  const canvas = els.pitchLane;
  canvas.title = 'In pausa: trascina per esplorare; rotella = altezza; Shift+rotella = tempo; Ctrl/Cmd+rotella = zoom; doppio clic = ripristina.';
  const reset = () => {
    state.gridInspect = { active: false, viewBeat: state.clock.snapshot().beat, pitchOffset: 0, timeZoom: 1, pitchZoom: 1, pointer: null };
    render();
  };
  canvas.addEventListener('dblclick', () => { if (!state.clock.running) reset(); });
  canvas.addEventListener('wheel', (event) => {
    if (state.clock.running) return;
    event.preventDefault();
    const view = state.gridInspect;
    if (!view.active) { view.active = true; view.viewBeat = state.clock.snapshot().beat; }
    const span = (state.pitchViewport?.bounds.max ?? 67) - (state.pitchViewport?.bounds.min ?? 55);
    if (event.ctrlKey || event.metaKey) {
      const zoom = Math.exp(-event.deltaY * .0025);
      view.timeZoom = Math.max(.55, Math.min(5, view.timeZoom * zoom));
      view.pitchZoom = Math.max(.55, Math.min(5, view.pitchZoom * zoom));
    } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      view.viewBeat = Math.max(0, Math.min(totalBeats(), view.viewBeat + (event.deltaX || event.deltaY) * .015 / view.timeZoom));
    } else {
      view.pitchOffset += event.deltaY * span / Math.max(1, canvas.clientHeight) * .7 / view.pitchZoom;
    }
    render();
  }, { passive: false });
  canvas.addEventListener('pointerdown', (event) => {
    if (state.clock.running || event.button !== 0) return;
    const view = state.gridInspect;
    if (!view.active) { view.active = true; view.viewBeat = state.clock.snapshot().beat; }
    view.pointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-panning');
  });
  canvas.addEventListener('pointermove', (event) => {
    const view = state.gridInspect;
    if (!view.pointer || state.clock.running) return;
    const dx = event.clientX - view.pointer.x;
    const dy = event.clientY - view.pointer.y;
    view.pointer = { x: event.clientX, y: event.clientY };
    const timeSpan = (UI_CONFIG.historyBeats + UI_CONFIG.futureBeats) / view.timeZoom;
    const pitchSpan = ((state.pitchViewport?.bounds.max ?? 67) - (state.pitchViewport?.bounds.min ?? 55)) / view.pitchZoom;
    view.viewBeat = Math.max(0, Math.min(totalBeats(), view.viewBeat - dx * timeSpan / Math.max(1, canvas.clientWidth)));
    view.pitchOffset += dy * pitchSpan / Math.max(1, canvas.clientHeight);
    render();
  });
  const finishPan = () => { state.gridInspect.pointer = null; canvas.classList.remove('is-panning'); };
  canvas.addEventListener('pointerup', finishPan);
  canvas.addEventListener('pointercancel', finishPan);
}

function showToast(message) {
  els.toast.textContent = message; els.toast.hidden = false;
  clearTimeout(showToast.timeout); showToast.timeout = setTimeout(() => { els.toast.hidden = true; }, 2400);
}

function updateMicrophoneButton() {
  els.togglePlayback.disabled = state.microphoneStatus === 'requesting';
}

async function stopMicrophone() {
  document.getElementById('microphone-level').value = 0;
  document.getElementById('test-microphone-level').value = 0;
  document.getElementById('microphone-help').textContent = 'Attiva il microfono e canta una nota per verificare il segnale.';
  state.microphoneStream?.getTracks().forEach((track) => track.stop());
  state.microphoneSource?.disconnect();
  state.microphoneAnalyser?.disconnect();
  state.microphoneSilencer?.disconnect();
  if (state.microphoneContext && state.microphoneContext.state !== 'closed') await state.microphoneContext.close();
  state.microphoneStream = null; state.microphoneContext = null; state.microphoneSource = null; state.microphoneAnalyser = null; state.microphoneSilencer = null; state.microphoneBuffer = null;
  state.microphoneStatus = 'idle'; state.trackedPitch = null; state.displayPitch = null; state.pitchConfirmationState = null; state.microphoneRms = 0; state.pitchSmoother.reset(); state.displayPitchFilter.reset();
  state.neuralLive.generation += 1; state.neuralLive.enabled = false; state.neuralLive.loading = false; state.neuralLive.inFlight = false; state.neuralLive.latestPitch = null; state.neuralLive.samples = [];
  updateMicrophoneButton(); updateNeuralLiveUi(); render();
}

async function toggleMicrophone() {
  if (state.microphoneStatus === 'active') { await stopMicrophone(); return; }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    state.microphoneStatus = 'error'; updateMicrophoneButton();
    showToast('Il microfono richiede un contesto sicuro (HTTPS) e un browser compatibile.'); render(); return;
  }
  state.microphoneStatus = 'requesting'; updateMicrophoneButton();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 }, video: false });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass({ latencyHint: 'interactive' }); await context.resume();
    const analyser = context.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0;
    const source = context.createMediaStreamSource(stream);
    // Audio nodes are pull-driven. Route the analyser to a muted sink so the
    // browser processes the microphone graph without feeding it back to the room.
    const silencer = context.createGain(); silencer.gain.value = 0;
    source.connect(analyser); analyser.connect(silencer); silencer.connect(context.destination);
    state.microphoneStream = stream; state.microphoneContext = context; state.microphoneSource = source; state.microphoneAnalyser = analyser; state.microphoneSilencer = silencer;
    state.microphoneBuffer = new Float32Array(analyser.fftSize); state.pitchSmoother.reset(); beginPitchTake();
    state.microphoneStatus = 'active'; updateMicrophoneButton();
    showToast('Microfono attivo. Per risultati migliori usa le cuffie.');
    if (!state.rafId) state.rafId = requestAnimationFrame(render);
  } catch (error) {
    state.microphoneStatus = error?.name === 'NotAllowedError' ? 'denied' : 'error';
    updateMicrophoneButton(); showToast(state.microphoneStatus === 'denied' ? 'Permesso microfono negato.' : 'Impossibile avviare il microfono.'); render();
  }
}

function preferenceKey() {
  return `choir-practice:${state.bundleManifest.piece_id ?? state.runtime.title}:${state.runtime.selectedPartId}`;
}

const LAST_PRACTICE_PIECE_KEY = 'choir-last-practice-piece';
const GLOBAL_DETECTOR_PREFERENCES_KEY = PitchShared.PREFERENCE_KEY;

function pitchHistoryKey() { return `${preferenceKey()}:pitch-history`; }

function savePitchHistory() {
  try {
    const samples = state.pitchSamples.slice(-12000).map((sample) => ({
      beat: Number(sample.beat.toFixed(3)), trackedPitch: Number.isFinite(sample.trackedPitch) ? Number(sample.trackedPitch.toFixed(2)) : null,
      displayPitch: Number.isFinite(sample.displayPitch) ? Number(sample.displayPitch.toFixed(2)) : null,
      confirmationState: sample.confirmationState === 'provisional' ? 'provisional' : 'confirmed',
      confidence: Number((sample.confidence ?? 0).toFixed(2)), takeId: sample.takeId,
    }));
    localStorage.setItem(pitchHistoryKey(), JSON.stringify({ samples, pitchTakeId: state.pitchTakeId }));
  } catch (_) { /* Storage is optional; the current-session history remains available. */ }
}

function restorePitchHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(pitchHistoryKey()));
    const samples = Array.isArray(saved?.samples) ? saved.samples.map((sample) => ({ ...sample,
      trackedPitch: Number.isFinite(sample.trackedPitch) ? sample.trackedPitch : sample.pitch,
      displayPitch: Number.isFinite(sample.displayPitch) ? sample.displayPitch : sample.pitch,
    })).filter((sample) => Number.isFinite(sample.beat)
      && Number.isInteger(sample.takeId)).slice(-12000) : [];
    state.pitchSamples = samples;
    state.pitchTakeId = Math.max(1, Number.isInteger(saved?.pitchTakeId) ? saved.pitchTakeId : 1,
      ...samples.map((sample) => sample.takeId + 1));
  } catch (_) { state.pitchSamples = []; state.pitchTakeId = 1; }
}

function beginPitchTake() {
  savePitchHistory();
  state.pitchTakeId += 1;
  state.lastSampleMs = null;
}

function clearPitchHistory() {
  state.pitchSamples = [];
  state.pitchTakeId = 1;
  state.lastSampleMs = null;
  // Benchmark/restart is a clean acquisition boundary for both estimators.
  // CREPE samples are transient by design and must never visually bleed into
  // the following run.
  state.neuralLive.samples = [];
  state.neuralLive.latestPitch = null;
  state.neuralLive.durationsMs = [];
  state.neuralLive.v1DurationsMs = [];
  state.neuralLive.lastLatencyMs = null;
  updateNeuralLiveUi();
  try { localStorage.removeItem(pitchHistoryKey()); } catch (_) { /* Storage is optional. */ }
}

function recordingStore(storeName, mode = 'readonly') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('choir-ground-truth', 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('takes')) database.createObjectStore('takes', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('benchmark-takes')) database.createObjectStore('benchmark-takes', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('benchmark-sessions')) database.createObjectStore('benchmark-sessions', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result.transaction(storeName, mode).objectStore(storeName));
  });
}

function groundTruthStore(mode = 'readonly') { return recordingStore('takes', mode); }
function benchmarkStore(mode = 'readonly') { return recordingStore('benchmark-takes', mode); }
function benchmarkSessionStore(mode = 'readonly') { return recordingStore('benchmark-sessions', mode); }

async function refreshGroundTruthCount() {
  try {
    const store = await groundTruthStore();
    const count = await new Promise((resolve, reject) => { const request = store.count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    els.groundTruthCount.textContent = `${count} campion${count === 1 ? 'e' : 'i'} approvat${count === 1 ? 'o' : 'i'} in questo browser.`;
  } catch (_) { els.groundTruthCount.textContent = 'Database locale non disponibile.'; }
}

async function openGroundTruthDialog() {
  await refreshGroundTruthCount();
  els.groundTruthStatus.textContent = 'Posizionati all’inizio della porzione, poi avvia l’acquisizione e il playback.';
  if (!els.groundTruthDialog.open) els.groundTruthDialog.showModal();
}

async function startGroundTruthCapture() {
  if (state.microphoneStatus !== 'active') await toggleMicrophone();
  if (state.microphoneStatus !== 'active' || !state.microphoneStream) {
    els.groundTruthStatus.textContent = 'Serve l’autorizzazione al microfono per registrare il campione.';
    return;
  }
  if (!window.MediaRecorder) { els.groundTruthStatus.textContent = 'Questo browser non supporta la registrazione audio.'; return; }
  beginPitchTake();
  const chunks = [];
  const recorder = new MediaRecorder(state.microphoneStream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined);
  state.groundTruth.capture = { recorder, chunks, startBeat: state.clock.snapshot().beat, startIndex: state.pitchSamples.length, startedAt: new Date().toISOString() };
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.start(500);
  els.groundTruthStart.disabled = true; els.groundTruthApprove.disabled = false;
  els.groundTruthStatus.textContent = 'Acquisizione attiva: avvia o continua il brano, poi premi “Interrompi e approva”.';
}

async function approveGroundTruthCapture() {
  const capture = state.groundTruth.capture;
  if (!capture) return;
  if (state.clock.running) state.clock.pause();
  const endBeat = state.clock.snapshot().beat;
  const save = async () => {
    const audio = new Blob(capture.chunks, { type: capture.recorder.mimeType || 'audio/webm' });
    const expected = state.runtime.targetEvents.filter((event) => event.onsetBeat + event.durationBeats >= capture.startBeat && event.onsetBeat <= endBeat);
    const take = {
      id: crypto.randomUUID(), kind: 'self-approved-ground-truth', approvedAt: new Date().toISOString(), startedAt: capture.startedAt,
      pieceId: state.bundleManifest.piece_id, scoreVersionId: state.runtime.scoreVersionId, partId: state.runtime.selectedPartId,
      startBeat: capture.startBeat, endBeat, expected, detected: state.pitchSamples.slice(capture.startIndex), audio,
    };
    const store = await groundTruthStore('readwrite');
    await new Promise((resolve, reject) => { const request = store.put(take); request.onsuccess = resolve; request.onerror = () => reject(request.error); });
    savePitchHistory(); state.groundTruth.capture = null;
    els.groundTruthStart.disabled = false; els.groundTruthApprove.disabled = true;
    els.groundTruthStatus.textContent = `Campione approvato: battute/beat ${capture.startBeat.toFixed(2)}–${endBeat.toFixed(2)}.`;
    await refreshGroundTruthCount(); showToast('Campione ground truth salvato localmente.');
  };
  capture.recorder.onstop = () => save().catch((error) => { els.groundTruthStatus.textContent = `Salvataggio non riuscito: ${error.message}`; });
  capture.recorder.stop();
}

const BENCHMARK_SCENARIOS = [
  ['T01', 'Note tenute — vocali nel registro tenore'],
  ['T02', 'Scala/gradi congiunti — legato o staccato'],
  ['T03', 'Intervalli reali dal repertorio'],
  ['T04', 'Salti reali di ottava'],
  ['T05', 'Note brevi, testo e consonanti'],
  ['T06', 'Nota sostenuta con vibrato naturale'],
  ['T07', 'Pause e respirazioni'],
  ['E01', 'Errore intenzionale — ±1 o ±2 semitoni'],
  ['E02', 'Errore intenzionale — ottava sbagliata'],
  ['E03', 'Intonazione controllata — ±20 / ±35 / ±60 cent'],
  ['N01', 'Condizione annotata — rumore o leakage'],
];

function putLocalRecord(store, value) {
  return new Promise((resolve, reject) => {
    const request = store.put(value);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

async function refreshBenchmarkCount() {
  try {
    const store = await benchmarkStore();
    const count = await new Promise((resolve, reject) => {
      const request = store.count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    els.benchmarkCount.textContent = `${count} take benchmark salvati in questo browser.`;
  } catch (_) { els.benchmarkCount.textContent = 'Database locale non disponibile.'; }
}

function selectedBenchmarkTake() {
  return state.benchmark.savedTakes.find((take) => take.id === state.benchmark.selectedTakeId) ?? null;
}

function benchmarkScenarioLabel(id) {
  return BENCHMARK_SCENARIOS.find(([scenarioId]) => scenarioId === id)?.[1] ?? id;
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function benchmarkPitchBounds(take) {
  const targets = (take.targetEvents ?? []).filter((event) => Number.isFinite(event.midiPitch));
  const targetPitches = targets.map((event) => event.midiPitch + (take.transpose ?? 0));
  const targetMin = Math.min(...targetPitches, 57), targetMax = Math.max(...targetPitches, 62);
  const observed = benchmarkDisplayFilteredFrames(take.frames ?? []).map((frame) => Number.isFinite(frame.displayHz) ? 69 + 12 * Math.log2(frame.displayHz / 440) : null)
    .filter((pitch) => Number.isFinite(pitch) && pitch >= targetMin - 2 && pitch <= targetMax + 2);
  const pitches = [...targetPitches, ...observed];
  return {
    min: Math.floor(Math.min(...pitches)) - 1,
    max: Math.ceil(Math.max(...pitches)) + 1,
  };
}

function benchmarkV2Frames(take) {
  if (take._v2Frames) return take._v2Frames;
  const tracker = new OctaveAwarePitchTracker();
  let fallbackTimestampMs = 0;
  take._v2Frames = (take.frames ?? []).map((frame) => {
    const recordedTimestampMs = Number(frame.audioTimeSec) * 1000;
    const timestampMs = Number.isFinite(recordedTimestampMs) ? recordedTimestampMs : fallbackTimestampMs;
    fallbackTimestampMs = timestampMs + 1000 / 60;
    const result = tracker.update({
      hz: frame.rawHz,
      rms: frame.rms,
      clarity: frame.clarity,
      confidence: Math.max(0, Math.min(1, (frame.clarity ?? 0) * Math.min(1, (frame.rms ?? 0) / .08))),
    }, timestampMs);
    return { ...frame, v2Hz: result.accepted && Number.isFinite(result.hz) ? result.hz : null, v2Reason: result.rejectionReason };
  });
  return take._v2Frames;
}

function benchmarkTargetAt(take, beat) {
  const target = (take.targetEvents ?? []).find((event) => event.onsetBeat <= beat && beat < event.onsetBeat + event.durationBeats);
  return target?.midiPitch == null ? null : target.midiPitch + (take.transpose ?? 0);
}

function benchmarkBeatAtAudioTime(take, audioTimeSec) {
  const frames = take.frames ?? [];
  if (!frames.length) return Number(take.startBeat) || 0;
  let low = 0, high = frames.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((frames[middle].audioTimeSec ?? -Infinity) < audioTimeSec) low = middle + 1; else high = middle;
  }
  const after = frames[low], before = frames[Math.max(0, low - 1)];
  const span = (after.audioTimeSec ?? 0) - (before.audioTimeSec ?? 0);
  if (span <= 0) return after.beat ?? before.beat ?? (Number(take.startBeat) || 0);
  const ratio = Math.max(0, Math.min(1, (audioTimeSec - before.audioTimeSec) / span));
  return (before.beat ?? 0) + ((after.beat ?? before.beat ?? 0) - (before.beat ?? 0)) * ratio;
}

function resampledMonoWindow(audio, centerSeconds, sampleRate = 8000, windowSize = 1024) {
  const output = new Float32Array(windowSize);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  const startSeconds = centerSeconds - windowSize / sampleRate / 2;
  for (let index = 0; index < windowSize; index += 1) {
    const sourcePosition = (startSeconds + index / sampleRate) * audio.sampleRate;
    const leftIndex = Math.floor(sourcePosition), fraction = sourcePosition - leftIndex;
    if (leftIndex < 0 || leftIndex + 1 >= audio.length) continue;
    let mixed = 0;
    for (const channel of channels) mixed += channel[leftIndex] * (1 - fraction) + channel[leftIndex + 1] * fraction;
    output[index] = mixed / channels.length;
  }
  return output;
}

async function resampleAudioForV3(audio, sampleRate) {
  const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineContextClass || audio.sampleRate === sampleRate) return audio;
  const context = new OfflineContextClass(1, Math.ceil(audio.duration * sampleRate), sampleRate);
  const source = context.createBufferSource();
  source.buffer = audio; source.connect(context.destination); source.start();
  return context.startRendering();
}

function setBenchmarkV3Status(take, message) {
  take._v3Status = message;
  if (selectedBenchmarkTake()?.id === take.id) els.benchmarkAnalysisV3Status.textContent = message;
}

async function calculateBenchmarkV3(take) {
  if (!take.audio) throw new Error('Audio della take non disponibile');
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Decodifica audio non supportata dal browser');
  const context = new AudioContextClass();
  try {
    const decodedAudio = await context.decodeAudioData(await take.audio.arrayBuffer());
    const hopSeconds = .05, analysisRate = 8000, windowSize = 1024;
    const audio = await resampleAudioForV3(decodedAudio, analysisRate);
    const totalFrames = Math.max(1, Math.floor(audio.duration / hopSeconds));
    const candidateFrames = [];
    for (let index = 0; index < totalFrames; index += 1) {
      const relativeTimeSec = Math.min(audio.duration, index * hopSeconds + hopSeconds / 2);
      const absoluteAudioTimeSec = (take.startAudioTimeSec ?? 0) + relativeTimeSec;
      const beat = benchmarkBeatAtAudioTime(take, absoluteAudioTimeSec);
      const window = resampledMonoWindow(audio, relativeTimeSec, analysisRate, windowSize);
      const result = yinCandidates(window, analysisRate);
      candidateFrames.push({ ...result, beat, audioTimeSec: absoluteAudioTimeSec });
      if (index % 12 === 0) {
        setBenchmarkV3Status(take, `V3: analisi multi-candidata ${Math.round((index + 1) / totalFrames * 100)}%`);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
    const path = decodeYinCandidatePath(candidateFrames);
    take._v3Frames = candidateFrames.map((frame, index) => ({
      beat: frame.beat,
      audioTimeSec: frame.audioTimeSec,
      targetMidiPitch: benchmarkTargetAt(take, frame.beat),
      v3Hz: path[index]?.unvoiced ? null : path[index]?.hz ?? null,
      v3Clarity: path[index]?.clarity ?? 0,
    }));
    setBenchmarkV3Status(take, 'V3 pronta · YIN multi-candidato + decoder temporale');
  } finally {
    await context.close();
  }
}

function ensureBenchmarkV3(take) {
  if (take._v3Frames) return Promise.resolve(take._v3Frames);
  if (take._v3Promise) return take._v3Promise;
  setBenchmarkV3Status(take, 'V3: preparo l’analisi audio…');
  take._v3Promise = calculateBenchmarkV3(take).catch((error) => {
    setBenchmarkV3Status(take, `V3 non disponibile: ${error.message ?? 'errore di analisi'}`);
  }).finally(() => {
    take._v3Promise = null;
    if (selectedBenchmarkTake()?.id === take.id) {
      renderBenchmarkAnalysisMetrics(take);
      drawBenchmarkAnalysisRoll(take);
    }
  });
  return take._v3Promise;
}

function setBenchmarkV4Status(take, message) {
  take._v4Status = message;
  if (selectedBenchmarkTake()?.id === take.id) els.benchmarkAnalysisV4Status.textContent = message;
}

async function calculateBenchmarkV4(take) {
  if (!take.audio) throw new Error('Audio della take non disponibile');
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Decodifica audio non supportata dal browser');
  const context = new AudioContextClass();
  try {
    const decodedAudio = await context.decodeAudioData(await take.audio.arrayBuffer());
    const hopSeconds = .05, analysisRate = 8000, windowSize = 1024;
    const audio = await resampleAudioForV3(decodedAudio, analysisRate);
    const totalFrames = Math.max(1, Math.floor(audio.duration / hopSeconds));
    const output = [];
    for (let index = 0; index < totalFrames; index += 1) {
      const relativeTimeSec = Math.min(audio.duration, index * hopSeconds + hopSeconds / 2);
      const absoluteAudioTimeSec = (take.startAudioTimeSec ?? 0) + relativeTimeSec;
      const beat = benchmarkBeatAtAudioTime(take, absoluteAudioTimeSec);
      const window = resampledMonoWindow(audio, relativeTimeSec, analysisRate, windowSize);
      const result = mpmCandidates(window, analysisRate, { maxCandidates: 1, minClarity: .78 });
      output.push({
        beat, audioTimeSec: absoluteAudioTimeSec,
        targetMidiPitch: benchmarkTargetAt(take, beat),
        v4Hz: result.candidates[0]?.hz ?? null,
        v4Clarity: result.candidates[0]?.clarity ?? 0,
      });
      if (index % 12 === 0) {
        setBenchmarkV4Status(take, `V4: analisi MPM ${Math.round((index + 1) / totalFrames * 100)}%`);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
    take._v4Frames = output;
    setBenchmarkV4Status(take, 'V4 pronta · MPM/NSDF con soglia voicing 0,78');
  } finally {
    await context.close();
  }
}

function ensureBenchmarkV4(take) {
  if (take._v4Frames) return Promise.resolve(take._v4Frames);
  if (take._v4Promise) return take._v4Promise;
  setBenchmarkV4Status(take, 'V4: preparo l’analisi audio…');
  take._v4Promise = calculateBenchmarkV4(take).catch((error) => {
    setBenchmarkV4Status(take, `V4 non disponibile: ${error.message ?? 'errore di analisi'}`);
  }).finally(() => {
    take._v4Promise = null;
    if (selectedBenchmarkTake()?.id === take.id) {
      renderBenchmarkAnalysisMetrics(take);
      drawBenchmarkAnalysisRoll(take);
    }
  });
  return take._v4Promise;
}

// v5 is deliberately an acoustic comparison, not a score-aware correction.
// The model file is served with the app; ONNX Runtime is a pinned browser
// dependency. Audio samples and derived frames remain in this browser.
const CREPE_TINY_MODEL_URL = RUNTIME_CONFIG.crepeModelUrl;
const CREPE_RUNTIME_BASE_URL = RUNTIME_CONFIG.crepeRuntimeBaseUrl;
let crepeSessionPromise = null;
let crepeRuntimePromise = null;

function loadCrepeRuntime() {
  if (window.ort) return Promise.resolve();
  if (!RUNTIME_CONFIG.crepeRuntimeScriptUrl) return Promise.reject(new Error('runtime ONNX non disponibile'));
  if (!crepeRuntimePromise) {
    crepeRuntimePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = RUNTIME_CONFIG.crepeRuntimeScriptUrl;
      script.onload = resolve;
      script.onerror = () => reject(new Error('runtime ONNX non caricato: controlla la connessione'));
      document.head.append(script);
    });
  }
  return crepeRuntimePromise;
}

function normaliseCrepeFrame(samples) {
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;
  let variance = 0;
  for (const sample of samples) variance += (sample - mean) ** 2;
  const deviation = Math.sqrt(variance / samples.length);
  const output = new Float32Array(samples.length);
  if (deviation < 1e-5) return output;
  for (let index = 0; index < samples.length; index += 1) output[index] = (samples[index] - mean) / deviation;
  return output;
}

async function crepeSession() {
  await loadCrepeRuntime();
  const ort = window.ort;
  if (!ort?.InferenceSession || !ort?.Tensor) {
    throw new Error('runtime ONNX non caricato: controlla la connessione e ricarica la pagina');
  }
  if (!crepeSessionPromise) {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = CREPE_RUNTIME_BASE_URL;
    crepeSessionPromise = ort.InferenceSession.create(CREPE_TINY_MODEL_URL, { executionProviders: ['wasm'] });
  }
  return crepeSessionPromise;
}

function setBenchmarkV5Status(take, message) {
  take._v5Status = message;
  if (selectedBenchmarkTake()?.id === take.id && els.benchmarkAnalysisV5Status) els.benchmarkAnalysisV5Status.textContent = message;
}

// This tracker exists only in the offline analysis page. Its state is a
// distribution over pitch bins plus an implicit unvoiced state; it never feeds
// the live v1 scorer. A 20-cent grid preserves CREPE's native bin resolution.
const MUSIC_TRACKER_CONFIG = Object.freeze({
  centsStep: 20,
  contextSemitones: 18,
  minMidi: 36,
  maxMidi: 84,
  localTransitionSemitones: .65,
  unexpectedTransitionMass: .0015,
  scorePriorMaximum: .24,
  scoreBoundaryToleranceBeats: .45,
  scoreDestinationSemitones: .35,
});

function crepeBinMidi(index) {
  const cents = 1997.3794084376191 + index * (7180 / 359);
  const hz = 10 * Math.pow(2, cents / 1200);
  return 69 + 12 * Math.log2(hz / 440);
}

function crepeSalienceAtMidi(salience, midi) {
  if (!salience?.length) return 0;
  const cents = 1200 * Math.log2((440 * Math.pow(2, (midi - 69) / 12)) / 10);
  const position = (cents - 1997.3794084376191) / (7180 / 359);
  const left = Math.floor(position), fraction = position - left;
  if (left < 0 || left + 1 >= salience.length) return 0;
  return Math.max(0, salience[left] * (1 - fraction) + salience[left + 1] * fraction);
}

function makeMusicTrackerGrid(take, frames) {
  const targets = (take.targetEvents ?? []).map((event) => event.midiPitch + (take.transpose ?? 0)).filter(Number.isFinite);
  const observed = frames.map((frame) => Number.isFinite(frame.v5Hz) ? 69 + 12 * Math.log2(frame.v5Hz / 440) : null).filter(Number.isFinite);
  const source = [...targets, ...observed];
  const low = Math.max(MUSIC_TRACKER_CONFIG.minMidi, Math.floor(Math.min(...source, 50) - MUSIC_TRACKER_CONFIG.contextSemitones));
  const high = Math.min(MUSIC_TRACKER_CONFIG.maxMidi, Math.ceil(Math.max(...source, 65) + MUSIC_TRACKER_CONFIG.contextSemitones));
  const step = MUSIC_TRACKER_CONFIG.centsStep / 100;
  const count = Math.max(2, Math.round((high - low) / step) + 1);
  return Float32Array.from({ length: count }, (_, index) => low + index * step);
}

function normalizedCrepeSalience(frame, grid) {
  const output = new Float32Array(grid.length);
  let maximum = 0;
  for (let index = 0; index < grid.length; index += 1) {
    const value = crepeSalienceAtMidi(frame.v5Salience, grid[index]);
    output[index] = value; maximum = Math.max(maximum, value);
  }
  if (maximum > 0) for (let index = 0; index < output.length; index += 1) output[index] /= maximum;
  return output;
}

function scoreBoundaryWeight(take, frame) {
  const tolerance = MUSIC_TRACKER_CONFIG.scoreBoundaryToleranceBeats;
  let closest = Infinity;
  for (const event of take.targetEvents ?? []) {
    if (!Number.isFinite(event.onsetBeat) || event.onsetBeat <= (take.startBeat ?? 0) + .001) continue;
    closest = Math.min(closest, Math.abs(frame.beat - event.onsetBeat));
  }
  if (closest > tolerance) return 0;
  return MUSIC_TRACKER_CONFIG.scorePriorMaximum * Math.exp(-.5 * (closest / tolerance) ** 2);
}

function scoreDestinationDistribution(grid, targetMidi) {
  const output = new Float32Array(grid.length);
  if (!Number.isFinite(targetMidi)) { output.fill(1 / grid.length); return output; }
  let total = 0;
  for (let index = 0; index < grid.length; index += 1) {
    const z = (grid[index] - targetMidi) / MUSIC_TRACKER_CONFIG.scoreDestinationSemitones;
    output[index] = Math.exp(-.5 * z * z); total += output[index];
  }
  for (let index = 0; index < grid.length; index += 1) output[index] = .75 * output[index] / total + .25 / grid.length;
  return output;
}

async function calculateMusicInformedPosteriors(take) {
  const frames = take._v5Frames ?? [];
  if (!frames.length || !frames[0].v5Salience) return;
  const grid = makeMusicTrackerGrid(take, frames), count = grid.length;
  const kernel = new Float32Array(count * count);
  for (let previous = 0; previous < count; previous += 1) {
    let total = 0;
    for (let current = 0; current < count; current += 1) {
      const value = Math.exp(-Math.abs(grid[current] - grid[previous]) / MUSIC_TRACKER_CONFIG.localTransitionSemitones)
        + MUSIC_TRACKER_CONFIG.unexpectedTransitionMass;
      kernel[current * count + previous] = value; total += value;
    }
    for (let current = 0; current < count; current += 1) kernel[current * count + previous] /= total;
  }
  const raw = [], audio = [], score = [];
  let audioPrevious = Float32Array.from({ length: count }, () => 1 / count), scorePrevious = Float32Array.from(audioPrevious);
  let audioUnvoiced = .5, scoreUnvoiced = .5;
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex], salience = normalizedCrepeSalience(frame, grid);
    raw.push(salience);
    const confidence = Math.max(0, Math.min(1, frame.v5Confidence ?? 0));
    const update = (previous, previousUnvoiced, useScore) => {
      const predicted = new Float32Array(count);
      for (let current = 0; current < count; current += 1) {
        let transitionSum = 0;
        for (let previousIndex = 0; previousIndex < count; previousIndex += 1) transitionSum += previous[previousIndex] * kernel[current * count + previousIndex];
        predicted[current] = .91 * transitionSum + previousUnvoiced * .09 / count;
      }
      let predictedUnvoiced = previousUnvoiced * .86 + .06;
      if (useScore) {
        const lambda = scoreBoundaryWeight(take, frame);
        if (lambda > 0) {
          const destination = scoreDestinationDistribution(grid, benchmarkTargetAt(take, frame.beat));
          for (let index = 0; index < count; index += 1) predicted[index] = (1 - lambda) * predicted[index] + lambda * destination[index];
          predictedUnvoiced *= 1 - lambda;
        }
      }
      const posterior = new Float32Array(count);
      let total = 0;
      for (let index = 0; index < count; index += 1) {
        posterior[index] = predicted[index] * (.015 + salience[index]); total += posterior[index];
      }
      let unvoiced = predictedUnvoiced * (.03 + 1 - confidence); total += unvoiced;
      if (total <= 0 || !Number.isFinite(total)) { posterior.fill(1 / count); return { posterior, unvoiced: .5 }; }
      for (let index = 0; index < count; index += 1) posterior[index] /= total;
      unvoiced /= total;
      return { posterior, unvoiced };
    };
    const audioResult = update(audioPrevious, audioUnvoiced, false);
    const scoreResult = update(scorePrevious, scoreUnvoiced, true);
    audio.push(audioResult.posterior); score.push(scoreResult.posterior);
    audioPrevious = audioResult.posterior; audioUnvoiced = audioResult.unvoiced;
    scorePrevious = scoreResult.posterior; scoreUnvoiced = scoreResult.unvoiced;
    if (frameIndex % 18 === 0) {
      setBenchmarkV5Status(take, `V5: posterior probabilistico ${Math.round((frameIndex + 1) / frames.length * 100)}%`);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }
  take._v5Posteriors = { grid, raw, audio, score };
}

async function calculateBenchmarkV5(take) {
  if (!take.audio) throw new Error('Audio della take non disponibile');
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Decodifica audio non supportata dal browser');
  setBenchmarkV5Status(take, 'V5: carico CREPE tiny locale…');
  const [session, context] = await Promise.all([crepeSession(), Promise.resolve(new AudioContextClass())]);
  try {
    const decodedAudio = await context.decodeAudioData(await take.audio.arrayBuffer());
    const hopSeconds = .05, analysisRate = 16000, windowSize = 1024, batchSize = 48;
    const audio = await resampleAudioForV3(decodedAudio, analysisRate);
    const totalFrames = Math.max(1, Math.floor(audio.duration / hopSeconds));
    const output = [];
    const inputName = session.inputNames[0], outputName = session.outputNames[0];
    for (let start = 0; start < totalFrames; start += batchSize) {
      const count = Math.min(batchSize, totalFrames - start);
      const batch = new Float32Array(count * windowSize);
      const metadata = [];
      for (let offset = 0; offset < count; offset += 1) {
        const index = start + offset;
        const relativeTimeSec = Math.min(audio.duration, index * hopSeconds + hopSeconds / 2);
        const absoluteAudioTimeSec = (take.startAudioTimeSec ?? 0) + relativeTimeSec;
        const beat = benchmarkBeatAtAudioTime(take, absoluteAudioTimeSec);
        batch.set(normaliseCrepeFrame(resampledMonoWindow(audio, relativeTimeSec, analysisRate, windowSize)), offset * windowSize);
        metadata.push({ beat, audioTimeSec: absoluteAudioTimeSec });
      }
      const ort = window.ort;
      const results = await session.run({ [inputName]: new ort.Tensor('float32', batch, [count, windowSize]) });
      const probabilities = results[outputName]?.data;
      if (!probabilities || probabilities.length < count * 360) throw new Error('output CREPE non valido');
      for (let offset = 0; offset < count; offset += 1) {
        const decoded = decodeCrepeProbabilities(probabilities.subarray(offset * 360, (offset + 1) * 360));
        const frame = metadata[offset];
        output.push({
          ...frame,
          targetMidiPitch: benchmarkTargetAt(take, frame.beat),
          v5Hz: decoded.hz,
          v5Confidence: decoded.confidence,
          v5Salience: Float32Array.from(probabilities.subarray(offset * 360, (offset + 1) * 360)),
        });
      }
      setBenchmarkV5Status(take, `V5: inferenza CREPE tiny ${Math.round((start + count) / totalFrames * 100)}%`);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    take._v5Frames = output;
    await calculateMusicInformedPosteriors(take);
    setBenchmarkV5Status(take, 'V5 pronta · salience, posterior audio e score-aware');
  } finally {
    await context.close();
  }
}

function ensureBenchmarkV5(take) {
  if (take._v5Frames) return Promise.resolve(take._v5Frames);
  if (take._v5Promise) return take._v5Promise;
  setBenchmarkV5Status(take, 'V5: preparo l’analisi audio…');
  take._v5Promise = calculateBenchmarkV5(take).catch((error) => {
    setBenchmarkV5Status(take, `V5 non disponibile: ${error.message ?? 'errore di analisi'}`);
  }).finally(() => {
    take._v5Promise = null;
    if (selectedBenchmarkTake()?.id === take.id) {
      renderBenchmarkAnalysisMetrics(take);
      drawBenchmarkAnalysisRoll(take);
    }
  });
  return take._v5Promise;
}

// The blur radius below is a constant display kernel, deliberately separate
// from posterior entropy. Statistical uncertainty is carried by the vertical
// spread of probability mass itself, not by this cosmetic glow.
function drawProbabilityPlume(context, frames, distributions, grid, xAt, yAt, viewStartBeat, viewEndBeat, rgb, maximumAlpha) {
  if (!distributions?.length || !grid?.length) return;
  context.save(); context.globalCompositeOperation = 'screen';
  for (let frameIndex = 0; frameIndex < Math.min(frames.length, distributions.length); frameIndex += 1) {
    const frame = frames[frameIndex];
    if (frame.beat < viewStartBeat || frame.beat > viewEndBeat) continue;
    const distribution = distributions[frameIndex];
    let peak = 0;
    for (let index = 0; index < distribution.length; index += 1) peak = Math.max(peak, distribution[index]);
    if (peak <= 0) continue;
    const x = xAt(frame.beat), next = frames[frameIndex + 1];
    const halfWidth = Math.max(1, Math.min(5, next ? Math.abs(xAt(next.beat) - x) / 2 : 2));
    for (let index = 0; index < distribution.length; index += 1) {
      const relative = distribution[index] / peak;
      if (relative < .13) continue;
      const alpha = maximumAlpha * Math.pow(relative, .7);
      const y = yAt(grid[index]);
      context.fillStyle = `rgba(${rgb},${alpha})`;
      context.fillRect(x - halfWidth, y - 3, halfWidth * 2, 6);
    }
  }
  context.restore();
}

function benchmarkAnalysisDuration(take) {
  const reported = els.benchmarkAnalysisAudio.duration;
  const fallback = Math.max(0, (take?.endAudioTimeSec ?? 0) - (take?.startAudioTimeSec ?? 0));
  return Number.isFinite(reported) && reported > 0 ? reported : fallback;
}

function benchmarkAnalysisTimeline(take) {
  if (take?._analysisTimeline) return take._analysisTimeline;
  const source = (take?.frames ?? []).filter((frame) => Number.isFinite(frame.beat) && Number.isFinite(frame.audioTimeSec));
  const origin = Number.isFinite(take?.startAudioTimeSec) ? take.startAudioTimeSec : (source[0]?.audioTimeSec ?? 0);
  const timeline = source.map((frame) => ({ beat: frame.beat, seconds: Math.max(0, frame.audioTimeSec - origin) }));
  if (take) take._analysisTimeline = timeline;
  return timeline;
}

function interpolateTimeline(timeline, value, inputKey, outputKey) {
  if (!timeline.length) return null;
  if (value <= timeline[0][inputKey]) return timeline[0][outputKey];
  const last = timeline[timeline.length - 1];
  if (value >= last[inputKey]) return last[outputKey];
  let low = 0, high = timeline.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (timeline[middle][inputKey] <= value) low = middle; else high = middle;
  }
  const left = timeline[low], right = timeline[high];
  const inputSpan = right[inputKey] - left[inputKey];
  const ratio = inputSpan > 0 ? (value - left[inputKey]) / inputSpan : 0;
  return left[outputKey] + ratio * (right[outputKey] - left[outputKey]);
}

function benchmarkAudioTimeForBeat(take, beat) {
  const duration = benchmarkAnalysisDuration(take);
  const timeline = benchmarkAnalysisTimeline(take);
  const seconds = interpolateTimeline(timeline, beat, 'beat', 'seconds');
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(duration, seconds));
  const start = Number(take?.startBeat) || 0, end = Math.max(start + .001, Number(take?.endBeat) || start + 1);
  return duration * Math.max(0, Math.min(1, (beat - start) / (end - start)));
}

function benchmarkBeatForAudioTime(take, seconds) {
  const timeline = benchmarkAnalysisTimeline(take);
  const beat = interpolateTimeline(timeline, seconds, 'seconds', 'beat');
  if (Number.isFinite(beat)) return beat;
  const start = Number(take?.startBeat) || 0, end = Math.max(start + .001, Number(take?.endBeat) || start + 1);
  const duration = benchmarkAnalysisDuration(take);
  return start + (duration > 0 ? Math.max(0, Math.min(1, seconds / duration)) : 0) * (end - start);
}

function drawBenchmarkAnalysisRoll(take) {
  const canvas = els.benchmarkAnalysisRoll;
  const rect = canvas.getBoundingClientRect();
  if (!take || rect.width < 2 || rect.height < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width, height = rect.height;
  const plot = { left: 52, right: width - 14, top: 16, bottom: height - 31 };
  ctx.clearRect(0, 0, width, height);
  const frames = (take.frames ?? []).filter((frame) => Number.isFinite(frame.beat));
  const displayFrames = benchmarkDisplayFilteredFrames(frames);
  const v5Frames = take._v5Frames ?? [];
  const targets = (take.targetEvents ?? []).filter((event) => Number.isFinite(event.midiPitch));
  const baseBounds = benchmarkPitchBounds(take);
  const baseMinPitch = baseBounds.min, baseMaxPitch = baseBounds.max;
  const startBeat = Number(take.startBeat) || 0, endBeat = Math.max(startBeat + .001, Number(take.endBeat) || startBeat + 1);
  const view = state.benchmark.analysisView;
  view.centerBeat ??= (startBeat + endBeat) / 2;
  const totalBeatSpan = endBeat - startBeat;
  const beatSpan = Math.max(.15, totalBeatSpan / view.timeZoom);
  const viewStartBeat = Math.max(startBeat, Math.min(endBeat - beatSpan, view.centerBeat - beatSpan / 2));
  const viewEndBeat = viewStartBeat + beatSpan;
  const basePitchSpan = Math.max(2, baseMaxPitch - baseMinPitch);
  const pitchSpan = Math.max(2, basePitchSpan / view.pitchZoom);
  const baseCenterPitch = (baseMinPitch + baseMaxPitch) / 2 + view.pitchOffset;
  const minPitch = baseCenterPitch - pitchSpan / 2, maxPitch = baseCenterPitch + pitchSpan / 2;
  const span = maxPitch - minPitch;
  const xAt = (beat) => plot.left + (beat - viewStartBeat) / beatSpan * (plot.right - plot.left);
  const yAt = (pitch) => plot.bottom - (pitch - minPitch) / span * (plot.bottom - plot.top);
  for (let pitch = Math.ceil(minPitch); pitch <= Math.floor(maxPitch); pitch += 1) {
    const y = yAt(pitch);
    const pitchClass = ((pitch % 12) + 12) % 12;
    const isWhite = [0, 2, 4, 5, 7, 9, 11].includes(pitchClass);
    const laneHeight = (plot.bottom - plot.top) / span;
    ctx.fillStyle = isWhite ? 'rgba(166,198,193,.055)' : 'rgba(2,10,14,.32)';
    ctx.fillRect(plot.left, y - laneHeight / 2, plot.right - plot.left, laneHeight);
    if (pitchClass === 0 || pitchClass === 5) { ctx.strokeStyle = 'rgba(190,215,211,.24)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(plot.left, Math.round(y + laneHeight / 2) + .5); ctx.lineTo(plot.right, Math.round(y + laneHeight / 2) + .5); ctx.stroke(); }
    if (pitchClass === 0 || pitch === Math.round((minPitch + maxPitch) / 2)) { ctx.fillStyle = '#9cb1b0'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(noteLabel(pitch), plot.left - 8, y + 4); }
  }
  const posterior = take._v5Posteriors;
  if (posterior) {
    const layers = state.benchmark.analysisLayers;
    if (layers.raw) drawProbabilityPlume(ctx, v5Frames, posterior.raw, posterior.grid, xAt, yAt, viewStartBeat, viewEndBeat, '243,166,208', .13);
    if (layers.audio) drawProbabilityPlume(ctx, v5Frames, posterior.audio, posterior.grid, xAt, yAt, viewStartBeat, viewEndBeat, '99,200,194', .22);
    if (layers.score) drawProbabilityPlume(ctx, v5Frames, posterior.score, posterior.grid, xAt, yAt, viewStartBeat, viewEndBeat, '190,165,255', .18);
  }
  for (const event of targets) {
    const eventStart = Math.max(viewStartBeat, event.onsetBeat), eventEnd = Math.min(viewEndBeat, event.onsetBeat + event.durationBeats);
    if (eventEnd <= eventStart) continue;
    const y = yAt(event.midiPitch + (take.transpose ?? 0));
    const laneHeight = (plot.bottom - plot.top) / span;
    ctx.fillStyle = 'rgba(217,168,91,.72)'; ctx.fillRect(xAt(eventStart), y - laneHeight / 2 + 1, Math.max(1, xAt(eventEnd) - xAt(eventStart) - 1), Math.max(4, laneHeight - 2));
    const feedback = take._vocalFeedback?.results?.find((item) => item.note.onsetBeat === event.onsetBeat && item.note.midiPitch === event.midiPitch);
    if (feedback && feedback.category !== 'in-tune') {
      const colours = { 'in-tune': '#91e6a7', 'stable-low': '#6faee8', 'stable-high': '#e8a56f', 'drifting-low': '#8d8be8', 'drifting-high': '#e88787', irregular: '#d7a2e8', uncertain: '#87999c' };
      const icons = { 'in-tune': '✓', 'stable-low': '−', 'stable-high': '+', 'drifting-low': '↓', 'drifting-high': '↑', irregular: '≈', uncertain: '?' };
      const colour = colours[feedback.category] ?? '#87999c', left = xAt(eventStart), noteWidth = Math.max(2, xAt(eventEnd) - left - 1), noteTop = y - laneHeight / 2 + 1, noteHeight = Math.max(4, laneHeight - 2);
      ctx.fillStyle = `${colour}32`; ctx.fillRect(left, noteTop, noteWidth, noteHeight); ctx.strokeStyle = colour; ctx.lineWidth = 1.7; ctx.strokeRect(left + .5, noteTop + .5, Math.max(1, noteWidth - 1), Math.max(3, noteHeight - 1));
      ctx.fillStyle = colour; ctx.fillRect(left, noteTop + noteHeight - 4, noteWidth, 4);
      if (noteWidth >= 18) { ctx.fillStyle = '#071419'; ctx.font = '800 10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icons[feedback.category], left + noteWidth / 2, y); ctx.textBaseline = 'alphabetic'; }
      if (event.onsetBeat <= view.selectedBeat && view.selectedBeat < event.onsetBeat + event.durationBeats) { ctx.strokeStyle = '#f4f7f3'; ctx.lineWidth = 1.5; ctx.strokeRect(xAt(eventStart), y - laneHeight / 2, Math.max(2, xAt(eventEnd) - xAt(eventStart)), Math.max(5, laneHeight)); }
    }
  }
  for (let beat = Math.ceil(viewStartBeat); beat < viewEndBeat; beat += 1) { ctx.strokeStyle = 'rgba(180,207,203,.12)'; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(Math.round(xAt(beat)) + .5, plot.top); ctx.lineTo(Math.round(xAt(beat)) + .5, plot.bottom); ctx.stroke(); }
  const measures = [...new Map(targets.filter((event) => event.onsetBeat >= viewStartBeat && event.onsetBeat <= viewEndBeat)
    .map((event) => [event.measureNumber ?? '?', event])).values()];
  for (const event of measures) { const x = xAt(event.onsetBeat); ctx.strokeStyle = 'rgba(226,180,101,.5)'; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, plot.top); ctx.lineTo(Math.round(x) + .5, plot.bottom); ctx.stroke(); ctx.fillStyle = '#d9ad67'; ctx.font = '700 10px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`Batt. ${event.measureNumber ?? '?'}`, x + 4, plot.top + 12); }
  // The raw estimate stays visible separately from the tracker. This is what
  // lets an inspection distinguish an onset error of YIN itself from a
  // transition introduced by the continuity/smoothing heuristic.
  if (state.benchmark.analysisLayers.raw) {
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(159,180,200,.74)'; ctx.lineWidth = 1.15;
    drawStablePitchSegments(ctx, stableVisualPitchSegments(frames.filter((frame) => frame.beat >= viewStartBeat && frame.beat <= viewEndBeat), {
      pitchAt: (frame) => Number.isFinite(frame.rawHz) ? 69 + 12 * Math.log2(frame.rawHz / 440) : null,
      timeAt: (frame) => frame.audioTimeSec,
      maxGap: .12,
      minimumFrames: 2,
    }), (frame) => xAt(frame.beat), (pitch) => yAt(pitch));
  }
  if (state.benchmark.analysisLayers.v1) {
    ctx.setLineDash([]); ctx.strokeStyle = '#63c8c2'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(99,200,194,.32)'; ctx.shadowBlur = 5;
    drawStablePitchSegments(ctx, stableVisualPitchSegments(frames.filter((frame) => frame.beat >= viewStartBeat && frame.beat <= viewEndBeat && frame.voicing === 'voiced'), {
      pitchAt: (frame) => Number.isFinite(frame.trackedHz) ? 69 + 12 * Math.log2(frame.trackedHz / 440) : null,
      timeAt: (frame) => frame.audioTimeSec,
      maxGap: .12,
      minimumFrames: 3,
    }), (frame) => xAt(frame.beat), (pitch) => yAt(pitch)); ctx.shadowBlur = 0;
  }
  if (state.benchmark.analysisLayers.display) {
    ctx.setLineDash([]); ctx.strokeStyle = '#91e6a7'; ctx.lineWidth = 1.45; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(145,230,167,.42)'; ctx.shadowBlur = 3;
    drawStablePitchSegments(ctx, stableVisualPitchSegments(displayFrames.filter((frame) => frame.beat >= viewStartBeat && frame.beat <= viewEndBeat && Number.isFinite(frame.displayHz)), {
      pitchAt: (frame) => 69 + 12 * Math.log2(frame.displayHz / 440),
      timeAt: (frame) => frame.audioTimeSec,
      maxGap: .12,
      minimumFrames: 3,
    }), (frame) => xAt(frame.beat), (pitch) => yAt(pitch)); ctx.shadowBlur = 0;
  }
  if (state.benchmark.analysisLayers.raw && !take._v5Posteriors) {
    ctx.strokeStyle = '#f3a6d0'; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(243,166,208,.25)'; ctx.shadowBlur = 4;
    drawStablePitchSegments(ctx, stableVisualPitchSegments(v5Frames.filter((frame) => frame.beat >= viewStartBeat && frame.beat <= viewEndBeat), {
      pitchAt: (frame) => Number.isFinite(frame.v5Hz) ? 69 + 12 * Math.log2(frame.v5Hz / 440) : null,
      timeAt: (frame) => frame.audioTimeSec,
      maxGap: .12,
      minimumFrames: 3,
    }), (frame) => xAt(frame.beat), (pitch) => yAt(pitch));
  }
  ctx.shadowBlur = 0;
  const audio = els.benchmarkAnalysisAudio;
  const playheadBeat = benchmarkBeatForAudioTime(take, audio.currentTime);
  if (playheadBeat >= viewStartBeat && playheadBeat <= viewEndBeat) { const playhead = xAt(playheadBeat); ctx.strokeStyle = '#f0cf8f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(Math.round(playhead) + .5, plot.top); ctx.lineTo(Math.round(playhead) + .5, plot.bottom); ctx.stroke(); }
  const selectedBeat = view.selectedBeat;
  if (Number.isFinite(selectedBeat) && selectedBeat >= viewStartBeat && selectedBeat <= viewEndBeat) {
    const x = xAt(selectedBeat); ctx.strokeStyle = '#f4f7f3'; ctx.lineWidth = 1.25; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, plot.top); ctx.lineTo(Math.round(x) + .5, plot.bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#f4f7f3'; ctx.beginPath(); ctx.moveTo(x - 5, plot.top); ctx.lineTo(x + 5, plot.top); ctx.lineTo(x, plot.top + 7); ctx.closePath(); ctx.fill();
  }
  const inspectedBeat = view.inspectBeat;
  if (Number.isFinite(inspectedBeat) && inspectedBeat >= viewStartBeat && inspectedBeat <= viewEndBeat && Math.abs(inspectedBeat - selectedBeat) > .001) { const x = xAt(inspectedBeat); ctx.strokeStyle = 'rgba(241,244,241,.52)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, plot.top); ctx.lineTo(Math.round(x) + .5, plot.bottom); ctx.stroke(); ctx.setLineDash([]); }
  ctx.fillStyle = '#718788'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('inizio', plot.left, height - 9); ctx.textAlign = 'right'; ctx.fillText('fine', plot.right, height - 9);
}

function benchmarkTrackStats(frames, hzKey, accepted) {
  const voiced = frames.filter((frame) => accepted(frame) && Number.isFinite(frame[hzKey]));
  const cents = voiced.map((frame) => frame.targetMidiPitch == null ? null
    : 1200 * Math.log2(frame[hzKey] / pitchToHz(frame.targetMidiPitch))).filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b);
  let largeJumps = 0;
  for (let index = 1; index < voiced.length; index += 1) {
    const previous = voiced[index - 1], current = voiced[index];
    const elapsed = Math.abs((current.audioTimeSec ?? 0) - (previous.audioTimeSec ?? 0));
    if (elapsed <= .12 && Math.abs(1200 * Math.log2(current[hzKey] / previous[hzKey])) > 700) largeJumps += 1;
  }
  return { voiced, cents, largeJumps };
}

function benchmarkV1OnComparisonGrid(take, comparisonFrames) {
  const source = take.frames ?? [];
  let sourceIndex = 0;
  return comparisonFrames.map((frame) => {
    while (sourceIndex + 1 < source.length
      && Math.abs((source[sourceIndex + 1].audioTimeSec ?? 0) - frame.audioTimeSec) <= Math.abs((source[sourceIndex].audioTimeSec ?? 0) - frame.audioTimeSec)) sourceIndex += 1;
    const nearest = source[sourceIndex] ?? {};
    return { ...frame, trackedHz: nearest.voicing === 'voiced' ? nearest.trackedHz : null };
  });
}

function benchmarkDisplayFilteredFrames(frames) {
  const filter = new OneEuroFilter();
  const origin = Number(frames[0]?.audioTimeSec) || 0;
  return frames.map((frame) => {
    if (frame.voicing !== 'voiced' || !Number.isFinite(frame.trackedHz)) {
      filter.reset(); return { ...frame, displayHz: null };
    }
    const midi = 69 + 12 * Math.log2(frame.trackedHz / 440);
    const filteredMidi = filter.filter(midi, Math.max(0, (Number(frame.audioTimeSec) || 0) - origin));
    return { ...frame, displayHz: 440 * Math.pow(2, (filteredMidi - 69) / 12) };
  });
}

function medianRelativePitchError(leftFrames, leftKey, rightFrames, rightKey) {
  const errors = [];
  for (let index = 0; index < Math.min(leftFrames.length, rightFrames.length); index += 1) {
    const left = leftFrames[index]?.[leftKey], right = rightFrames[index]?.[rightKey];
    if (Number.isFinite(left) && Number.isFinite(right)) errors.push(Math.abs(1200 * Math.log2(left / right)));
  }
  return medianOf(errors);
}

function benchmarkMetrics(take) {
  const frames = take.frames ?? [];
  const displayFrames = benchmarkDisplayFilteredFrames(frames);
  const duration = Math.max(0, (take.endAudioTimeSec ?? 0) - (take.startAudioTimeSec ?? 0));
  const median = (stats) => stats.cents.length ? stats.cents[Math.floor(stats.cents.length / 2)] : null;
  if (!take._v5Frames) {
    const v1 = benchmarkTrackStats(frames, 'trackedHz', (frame) => frame.voicing === 'voiced');
    const display = benchmarkTrackStats(displayFrames, 'displayHz', (frame) => Number.isFinite(frame.displayHz));
    return [['Durata', formatClock(duration)], ['Frame acquisiti', String(frames.length)],
      ['V1 · voce tracciata', `${frames.length ? Math.round(v1.voiced.length / frames.length * 100) : 0}%`],
      ['V1 · errore mediano', median(v1) == null ? 'n/d' : `${Math.round(median(v1))} ¢`],
      ['V1 · salti >700¢', String(v1.largeJumps)],
      ['V1+ display · errore mediano', median(display) == null ? 'n/d' : `${Math.round(median(display))} ¢`],
      ['V1+ display · salti >700¢', String(display.largeJumps)], ['V5 · stato', take._v5Status ?? 'in elaborazione']];
  }
  const v1Frames = benchmarkV1OnComparisonGrid(take, take._v5Frames);
  const displayGrid = benchmarkV1OnComparisonGrid({ ...take, frames: displayFrames.map((frame) => ({ ...frame,
    trackedHz: frame.displayHz, voicing: Number.isFinite(frame.displayHz) ? 'voiced' : frame.voicing })) }, take._v5Frames);
  const v1 = benchmarkTrackStats(v1Frames, 'trackedHz', () => true);
  const display = benchmarkTrackStats(displayGrid, 'trackedHz', () => true);
  const v5 = benchmarkTrackStats(take._v5Frames, 'v5Hz', () => true);
  const summary = [['Durata', formatClock(duration)], ['Frame confronto', String(take._v5Frames.length)],
    ['V1 · voce tracciata', `${v1Frames.length ? Math.round(v1.voiced.length / v1Frames.length * 100) : 0}%`],
    ['V1 · errore mediano', median(v1) == null ? 'n/d' : `${Math.round(median(v1))} ¢`],
    ['V1 · salti >700¢', String(v1.largeJumps)],
    ['V1+ display · errore mediano', median(display) == null ? 'n/d' : `${Math.round(median(display))} ¢`],
    ['V1+ display · salti >700¢', String(display.largeJumps)],
    ['V1 · scarto mediano da CREPE', `${Math.round(medianRelativePitchError(v1Frames, 'trackedHz', take._v5Frames, 'v5Hz') ?? 0)} ¢`],
    ['V1+ display · scarto mediano da CREPE', `${Math.round(medianRelativePitchError(displayGrid, 'trackedHz', take._v5Frames, 'v5Hz') ?? 0)} ¢`]];
  return [...summary,
    ['V5 · voce tracciata', `${take._v5Frames.length ? Math.round(v5.voiced.length / take._v5Frames.length * 100) : 0}%`],
    ['V5 · errore mediano', median(v5) == null ? 'n/d' : `${Math.round(median(v5))} ¢`],
    ['V5 · salti >700¢', String(v5.largeJumps)]];
}

function renderBenchmarkAnalysisMetrics(take) {
  els.benchmarkAnalysisMetrics.replaceChildren(...benchmarkMetrics(take).flatMap(([label, value]) => {
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); detail.textContent = value;
    return [term, detail];
  }));
  if (els.benchmarkAnalysisV5Status) els.benchmarkAnalysisV5Status.textContent = take._v5Status ?? 'V5: analisi neurale in attesa';
}

function resetBenchmarkAnalysisView(preserveSelection = true) {
  const selectedBeat = preserveSelection ? state.benchmark.analysisView.selectedBeat : null;
  state.benchmark.analysisView = { timeZoom: 1, pitchZoom: 1, centerBeat: null, pitchOffset: 0, pointer: null, inspectBeat: null, selectedBeat };
  const take = selectedBenchmarkTake();
  if (take) drawBenchmarkAnalysisRoll(take);
  els.benchmarkAnalysisInspect.textContent = 'Panoramica completa';
}

function benchmarkBeatAtCanvasX(take, clientX) {
  const canvas = els.benchmarkAnalysisRoll, rect = canvas.getBoundingClientRect();
  const startBeat = Number(take.startBeat) || 0, endBeat = Math.max(startBeat + .001, Number(take.endBeat) || startBeat + 1);
  const view = state.benchmark.analysisView, totalSpan = endBeat - startBeat, visibleSpan = totalSpan / view.timeZoom;
  const centerBeat = view.centerBeat ?? (startBeat + endBeat) / 2;
  const viewStart = Math.max(startBeat, Math.min(endBeat - visibleSpan, centerBeat - visibleSpan / 2));
  const localX = Math.max(0, Math.min(1, (clientX - rect.left - 52) / Math.max(1, rect.width - 66)));
  return viewStart + localX * visibleSpan;
}

function updateBenchmarkSelectionLabel(take) {
  const beat = state.benchmark.analysisView.selectedBeat;
  if (!Number.isFinite(beat)) { els.benchmarkAnalysisSelection.textContent = 'Cursore: inizio'; return; }
  const seconds = benchmarkAudioTimeForBeat(take, beat);
  const active = (take.targetEvents ?? []).find((target) => target.onsetBeat <= beat && beat < target.onsetBeat + target.durationBeats);
  const measure = active?.measureNumber == null ? '' : ` · batt. ${active.measureNumber}`;
  els.benchmarkAnalysisSelection.textContent = `Cursore ${formatClock(seconds)}${measure}`;
}

function selectBenchmarkAnalysisBeat(take, beat) {
  const startBeat = Number(take.startBeat) || 0, endBeat = Math.max(startBeat + .001, Number(take.endBeat) || startBeat + 1);
  const selectedBeat = Math.max(startBeat, Math.min(endBeat, beat));
  state.benchmark.analysisView.selectedBeat = selectedBeat;
  els.benchmarkAnalysisAudio.currentTime = benchmarkAudioTimeForBeat(take, selectedBeat);
  updateBenchmarkSelectionLabel(take);
  renderFeedbackNote(take);
  drawBenchmarkAnalysisRoll(take);
}

function updateBenchmarkAnalysisPlayButton() {
  const playing = !els.benchmarkAnalysisAudio.paused && !els.benchmarkAnalysisAudio.ended;
  els.benchmarkAnalysisPlaySelection.textContent = playing ? '❚❚ Pausa' : '▶ Riproduci da qui';
  els.benchmarkAnalysisPlaySelection.classList.toggle('is-playing', playing);
  els.benchmarkAnalysisPlaySelection.setAttribute('aria-pressed', String(playing));
}

function stopBenchmarkPlaybackAnimation() {
  if (state.benchmark.analysisPlaybackRaf != null) cancelAnimationFrame(state.benchmark.analysisPlaybackRaf);
  state.benchmark.analysisPlaybackRaf = null;
}

function startBenchmarkPlaybackAnimation() {
  stopBenchmarkPlaybackAnimation();
  const tick = () => {
    const take = selectedBenchmarkTake(), audio = els.benchmarkAnalysisAudio;
    if (!take || audio.paused || audio.ended || els.benchmarkAnalysis.hidden) { stopBenchmarkPlaybackAnimation(); return; }
    const view = state.benchmark.analysisView;
    if (view.timeZoom > 1) {
      const start = Number(take.startBeat) || 0, end = Math.max(start + .001, Number(take.endBeat) || start + 1);
      const visibleSpan = (end - start) / view.timeZoom;
      const viewStart = Math.max(start, Math.min(end - visibleSpan, view.centerBeat - visibleSpan / 2));
      const playhead = benchmarkBeatForAudioTime(take, audio.currentTime);
      if (playhead > viewStart + visibleSpan * .86 || playhead < viewStart + visibleSpan * .08)
        view.centerBeat = Math.max(start + visibleSpan / 2, Math.min(end - visibleSpan / 2, playhead));
    }
    drawBenchmarkAnalysisRoll(take);
    state.benchmark.analysisPlaybackRaf = requestAnimationFrame(tick);
  };
  state.benchmark.analysisPlaybackRaf = requestAnimationFrame(tick);
}

async function toggleBenchmarkPlaybackFromSelection() {
  const take = selectedBenchmarkTake(), audio = els.benchmarkAnalysisAudio;
  if (!take) return;
  if (!audio.paused && !audio.ended) { audio.pause(); return; }
  const selectedBeat = state.benchmark.analysisView.selectedBeat ?? benchmarkBeatForAudioTime(take, audio.currentTime);
  selectBenchmarkAnalysisBeat(take, selectedBeat);
  try { await audio.play(); } catch (_) { /* The native player remains available if autoplay is denied. */ }
}

function updateBenchmarkInspection(take, event) {
  const beat = benchmarkBeatAtCanvasX(take, event.clientX);
  state.benchmark.analysisView.inspectBeat = beat;
  const active = (take.targetEvents ?? []).find((target) => target.onsetBeat <= beat && beat < target.onsetBeat + target.durationBeats);
  const feedback = active && take._vocalFeedback?.results?.find((item) => item.note.onsetBeat === active.onsetBeat && item.note.midiPitch === active.midiPitch);
  const feedbackDetail = feedback ? ` · ${feedback.message} · scarto ${Number.isFinite(feedback.metrics.medianCents) ? `${Math.round(feedback.metrics.medianCents)} cent` : 'incerto'}` : '';
  els.benchmarkAnalysisInspect.textContent = active
    ? `Batt. ${active.measureNumber ?? '?'} · ${active.noteName ?? noteLabel(active.midiPitch + (take.transpose ?? 0))}${feedbackDetail}`
    : `Beat ${beat.toFixed(2)} · nessun target`;
  return beat;
}

function bindBenchmarkAnalysisCanvas() {
  const canvas = els.benchmarkAnalysisRoll;
  canvas.addEventListener('wheel', (event) => {
    const take = selectedBenchmarkTake(); if (!take) return;
    event.preventDefault();
    const view = state.benchmark.analysisView;
    const rect = canvas.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.22 : 1 / 1.22;
    const xRatio = Math.max(0, Math.min(1, (event.clientX - rect.left - 52) / Math.max(1, rect.width - 66)));
    const yRatio = Math.max(0, Math.min(1, (event.clientY - rect.top - 16) / Math.max(1, rect.height - 47)));
    const startBeat = Number(take.startBeat) || 0;
    const endBeat = Math.max(startBeat + .001, Number(take.endBeat) || startBeat + 1);
    const totalBeatSpan = endBeat - startBeat;
    view.centerBeat ??= (startBeat + endBeat) / 2;
    if (event.shiftKey) {
      const bounds = benchmarkPitchBounds(take);
      const basePitchSpan = Math.max(2, bounds.max - bounds.min);
      const oldSpan = Math.max(2, basePitchSpan / view.pitchZoom);
      const oldCenter = (bounds.min + bounds.max) / 2 + view.pitchOffset;
      const anchorPitch = oldCenter + oldSpan / 2 - yRatio * oldSpan;
      view.pitchZoom = Math.max(.65, Math.min(8, view.pitchZoom * factor));
      const newSpan = Math.max(2, basePitchSpan / view.pitchZoom);
      view.pitchOffset = anchorPitch - (bounds.min + bounds.max) / 2 - newSpan / 2 + yRatio * newSpan;
    } else {
      const oldSpan = totalBeatSpan / view.timeZoom;
      const oldStart = Math.max(startBeat, Math.min(endBeat - oldSpan, view.centerBeat - oldSpan / 2));
      const anchorBeat = oldStart + xRatio * oldSpan;
      view.timeZoom = Math.max(1, Math.min(20, view.timeZoom * factor));
      const newSpan = totalBeatSpan / view.timeZoom;
      const newStart = Math.max(startBeat, Math.min(endBeat - newSpan, anchorBeat - xRatio * newSpan));
      view.centerBeat = newStart + newSpan / 2;
    }
    updateBenchmarkInspection(take, event); drawBenchmarkAnalysisRoll(take);
  }, { passive: false });
  canvas.addEventListener('pointerdown', (event) => {
    const take = selectedBenchmarkTake(); if (!take) return;
    const view = state.benchmark.analysisView;
    view.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, centerBeat: view.centerBeat, pitchOffset: view.pitchOffset, moved: false };
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('is-panning'); updateBenchmarkInspection(take, event); drawBenchmarkAnalysisRoll(take);
  });
  canvas.addEventListener('pointermove', (event) => {
    const take = selectedBenchmarkTake(), view = state.benchmark.analysisView; if (!take) return;
    if (!view.pointer || view.pointer.id !== event.pointerId) { updateBenchmarkInspection(take, event); drawBenchmarkAnalysisRoll(take); return; }
    if (Math.hypot(event.clientX - view.pointer.x, event.clientY - view.pointer.y) > 5) view.pointer.moved = true;
    const rect = canvas.getBoundingClientRect(); const total = (take.endBeat ?? 1) - (take.startBeat ?? 0);
    view.centerBeat = view.pointer.centerBeat - (event.clientX - view.pointer.x) * (total / view.timeZoom) / Math.max(1, rect.width - 66);
    const pitchRange = Math.max(2, 12 / view.pitchZoom);
    view.pitchOffset = view.pointer.pitchOffset + (event.clientY - view.pointer.y) * pitchRange / Math.max(1, rect.height - 47);
    updateBenchmarkInspection(take, event); drawBenchmarkAnalysisRoll(take);
  });
  const finish = (event, cancelled = false) => {
    const view = state.benchmark.analysisView, pointer = view.pointer;
    if (pointer?.id !== event.pointerId) return;
    canvas.releasePointerCapture?.(event.pointerId); view.pointer = null; canvas.classList.remove('is-panning');
    if (!cancelled && !pointer.moved) { const take = selectedBenchmarkTake(); if (take) selectBenchmarkAnalysisBeat(take, benchmarkBeatAtCanvasX(take, event.clientX)); }
  };
  canvas.addEventListener('pointerup', (event) => finish(event));
  canvas.addEventListener('pointercancel', (event) => finish(event, true));
  canvas.addEventListener('dblclick', () => { void toggleBenchmarkPlaybackFromSelection(); });
  canvas.addEventListener('keydown', (event) => {
    if (event.code !== 'Space') return;
    event.preventDefault(); void toggleBenchmarkPlaybackFromSelection();
  });
  canvas.addEventListener('pointerleave', () => { if (!state.benchmark.analysisView.pointer) { state.benchmark.analysisView.inspectBeat = null; els.benchmarkAnalysisInspect.textContent = 'Panoramica completa'; drawBenchmarkAnalysisRoll(selectedBenchmarkTake()); } });
}

function feedbackSignature(take) { return ['feedback-v3-musical', take.id, take.frames?.length ?? 0, take.targetEvents?.length ?? 0, take.stoppedAt ?? ''].join(':'); }
function feedbackNotes(take) { return (take.targetEvents ?? []).filter((event) => Number.isFinite(event.midiPitch)).map((event, index) => ({ ...event, id: event.id ?? event.sourceEventId ?? `note-${index}`, targetHz: pitchToHz(event.midiPitch + (take.transpose ?? 0)) })); }
function feedbackFrames(take) { const frames = benchmarkDisplayFilteredFrames(take.frames ?? []), origin = Number.isFinite(take.startAudioTimeSec) ? take.startAudioTimeSec : (frames[0]?.audioTimeSec ?? 0); return frames.map((frame) => ({ beat: frame.beat, time: (frame.audioTimeSec ?? origin) - origin, hz: Number.isFinite(frame.displayHz) ? frame.displayHz : null, confidence: frame.confidence ?? frame.clarity ?? 0 })); }
function selectedFeedbackResult(take) { const beat = state.benchmark.analysisView.selectedBeat; return take?._vocalFeedback?.results?.find((result) => result.note.onsetBeat <= beat && beat < result.note.onsetBeat + result.note.durationBeats) ?? null; }
function drawFeedbackCentChart(result) {
  const canvas = els.feedbackCentChart, rect = canvas.getBoundingClientRect(); if (!result || rect.width < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2), width = rect.width, height = rect.height || 150; canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d'), plot = { left: 36, right: width - 9, top: 10, bottom: height - 22 }, series = result.series; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  const extent = Math.max(40, Math.min(200, Math.ceil(Math.max(20, ...series.map((point) => Math.abs(point.cents))) / 20) * 20));
  const x = (time) => plot.left + (time - (series[0]?.time ?? 0)) / Math.max(.01, (series.at(-1)?.time ?? 1) - (series[0]?.time ?? 0)) * (plot.right - plot.left), y = (cents) => plot.top + (extent - cents) / (extent * 2) * (plot.bottom - plot.top);
  for (const cents of [-extent, 0, extent]) { ctx.strokeStyle = cents ? 'rgba(180,207,203,.12)' : 'rgba(217,168,91,.75)'; ctx.lineWidth = cents ? 1 : 1.5; ctx.beginPath(); ctx.moveTo(plot.left, y(cents)); ctx.lineTo(plot.right, y(cents)); ctx.stroke(); ctx.fillStyle = '#8da2a2'; ctx.font = '10px Inter'; ctx.textAlign = 'right'; ctx.fillText(`${cents > 0 ? '+' : ''}${cents}`, plot.left - 4, y(cents) + 3); }
  const line = (key, colour, lineWidth) => { ctx.beginPath(); let active = false; for (const point of series) { if (!active) { ctx.moveTo(x(point.time), y(point[key])); active = true; } else ctx.lineTo(x(point.time), y(point[key])); } ctx.strokeStyle = colour; ctx.lineWidth = lineWidth; ctx.stroke(); }; line('cents', 'rgba(99,200,194,.55)', 1); line('centerCents', '#91e6a7', 2.2);
}
function renderFeedbackNote(take) {
  els.feedbackNoteCard.hidden = true;
  els.feedbackCorrected.disabled = !take?.audio || !(take._vocalFeedback?.results ?? []).some((item) => item.correctionAvailable);
}
function renderFeedbackPriorities(take) {
  const analysis = take?._vocalFeedback?.signature === feedbackSignature(take) ? take._vocalFeedback : null;
  const priorities = analysis?.priorities ?? []; els.feedbackPriorities.hidden = !analysis;
  if (!priorities.length) { els.feedbackPriorityList.innerHTML = '<p class="analysis-empty">Non emergono passaggi che richiedano attenzione prioritaria.</p>'; return; }
  els.feedbackPriorityList.replaceChildren(...priorities.map((priority, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'feedback-priority'; button.dataset.startBeat = priority.startBeat;
    const measures = priority.measureEnd && priority.measureEnd !== priority.measureStart ? `Battute ${priority.measureStart}–${priority.measureEnd}` : `Battuta ${priority.measureStart ?? '?'}`;
    button.innerHTML = `<small>${index + 1} · ${priority.kind === 'phrase' ? 'Frase musicale' : 'Passaggio'}</small><strong>${priority.title}</strong><span>${measures} · ${priority.message}</span>`;
    return button;
  }));
}
async function analyseBenchmarkFeedback() {
  const take = selectedBenchmarkTake(); if (!take || !VocalFeedback) return; const signature = feedbackSignature(take); if (take._vocalFeedback?.signature === signature) { els.feedbackStatus.textContent = 'Analisi già disponibile per questa registrazione.'; renderFeedbackNote(take); renderFeedbackPriorities(take); return; }
  els.feedbackAnalyse.disabled = true; els.feedbackStatus.textContent = 'Analisi della tenuta in corso…'; await new Promise((resolve) => setTimeout(resolve, 0));
  try { const performance = VocalFeedback.analysePerformance(feedbackNotes(take), feedbackFrames(take)); take._vocalFeedback = { signature, ...performance }; els.feedbackStatus.textContent = performance.priorities.length ? `${performance.priorities.length} passaggi meritano un riascolto. Le piccole oscillazioni naturali non sono segnalate.` : 'Nessuna difficoltà prioritaria rilevata con sufficiente affidabilità.'; renderFeedbackNote(take); renderFeedbackPriorities(take); drawBenchmarkAnalysisRoll(take); } catch (error) { els.feedbackStatus.textContent = `Analisi non riuscita: ${error.message}`; } finally { els.feedbackAnalyse.disabled = false; }
}
function selectAdjacentFeedbackNote(direction) { const take = selectedBenchmarkTake(), results = take?._vocalFeedback?.results ?? []; if (!results.length) return; const index = Math.max(0, results.indexOf(selectedFeedbackResult(take))), next = results[Math.max(0, Math.min(results.length - 1, index + direction))]; selectBenchmarkAnalysisBeat(take, next.note.onsetBeat + Math.min(next.note.durationBeats / 2, .05)); renderFeedbackNote(take); }
function audioBufferWavBlob(buffer) {
  const channels = buffer.numberOfChannels, frames = buffer.length, bytesPerSample = 2, blockAlign = channels * bytesPerSample;
  const data = new ArrayBuffer(44 + frames * blockAlign), view = new DataView(data), write = (offset, text) => { for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + frames * blockAlign, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, frames * blockAlign, true);
  const samples = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel)); let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) for (let channel = 0; channel < channels; channel += 1) { const sample = Math.max(-1, Math.min(1, samples[channel][frame])); view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2; }
  return new Blob([data], { type: 'audio/wav' });
}
async function switchFeedbackPlayback(url, variant) {
  const take = selectedBenchmarkTake(), audio = els.benchmarkAnalysisAudio; if (!take || !url) return;
  const position = audio.ended ? 0 : audio.currentTime; state.benchmark.analysisView.selectedBeat = benchmarkBeatForAudioTime(take, position); audio.pause(); audio.src = url; audio.load();
  if (audio.readyState < 1) await new Promise((resolve) => audio.addEventListener('loadedmetadata', resolve, { once: true }));
  audio.currentTime = Math.min(position, Math.max(0, audio.duration - .01)); state.benchmark.audioVariant = variant; els.feedbackPlaybackKind.textContent = variant === 'corrected' ? 'Versione corretta' : 'Registrazione originale'; updateBenchmarkSelectionLabel(take); await audio.play();
}
function playFeedbackOriginal() { const take = selectedBenchmarkTake(); if (!take?.audio) return; void switchFeedbackPlayback(state.benchmark.analysisAudioUrl, 'original'); els.feedbackStatus.textContent = 'Riproduzione della registrazione originale dalla posizione del cursore.'; }
async function playFeedbackCorrected() {
  const take = selectedBenchmarkTake(), results = take?._vocalFeedback?.results?.filter((result) => result.correctionAvailable) ?? []; if (!take?.audio || !results.length) return; els.feedbackCorrected.disabled = true; els.feedbackStatus.textContent = 'Preparazione dell’intera take corretta…';
  try { const strength = Number(els.feedbackStrength.value) / 100, key = `${feedbackSignature(take)}:${strength}`;
    if (state.benchmark.correctedAudioKey !== key || !state.benchmark.correctedAudioUrl) { const context = new AudioContext(), decoded = await context.decodeAudioData(await take.audio.arrayBuffer()), output = context.createBuffer(decoded.numberOfChannels, decoded.length, decoded.sampleRate), regions = results.map((result) => ({ startSample: benchmarkAudioTimeForBeat(take, result.note.onsetBeat) * decoded.sampleRate, endSample: benchmarkAudioTimeForBeat(take, result.note.onsetBeat + result.note.durationBeats) * decoded.sampleRate, ratio: 2 ** (-(result.metrics.medianCents ?? 0) * strength / 1200) }));
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) output.copyToChannel(VocalFeedback.pitchShiftRegions(decoded.getChannelData(channel), regions, { fadeSamples: Math.round(decoded.sampleRate * .04) }), channel);
      if (state.benchmark.correctedAudioUrl) URL.revokeObjectURL(state.benchmark.correctedAudioUrl); state.benchmark.correctedAudioUrl = URL.createObjectURL(audioBufferWavBlob(output)); state.benchmark.correctedAudioKey = key; await context.close();
    }
    await switchFeedbackPlayback(state.benchmark.correctedAudioUrl, 'corrected'); els.feedbackStatus.textContent = `Versione corretta al ${Math.round(strength * 100)}% · ${results.length} note elaborate; le altre regioni sono originali.`;
  } catch (error) { els.feedbackStatus.textContent = `Audio corretto non disponibile: ${error.message}`; } finally { els.feedbackCorrected.disabled = false; }
}

function renderBenchmarkArchive() {
  const takes = state.benchmark.savedTakes;
  els.benchmarkArchive.hidden = takes.length === 0;
  if (!takes.length) return;
  if (!takes.some((take) => take.id === state.benchmark.selectedTakeId)) state.benchmark.selectedTakeId = takes[0].id;
  els.benchmarkTakeList.replaceChildren(...takes.map((take, index) => {
    const date = new Date(take.acceptedAt ?? take.stoppedAt ?? take.startedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    return new Option(`${index + 1}. ${take.scenarioId} · take ${take.repetition} · ${date}`, take.id);
  }));
  els.benchmarkTakeList.value = state.benchmark.selectedTakeId;
  const take = selectedBenchmarkTake();
  if (!take) return;
  const seconds = Math.max(0, (take.endAudioTimeSec ?? 0) - (take.startAudioTimeSec ?? 0));
  els.benchmarkTakeSummary.textContent = `${benchmarkScenarioLabel(take.scenarioId)} · ${take.frames?.length ?? 0} frame · ${seconds.toFixed(1)} s · ${take.partId ?? 'parte non disponibile'}.`;
  els.benchmarkAlgorithmLabel.textContent = 'Analisi vocale';
}

function renderBenchmarkAnalysis() {
  const take = selectedBenchmarkTake();
  if (!take) return;
  els.benchmarkAnalysisAudio.pause();
  stopBenchmarkPlaybackAnimation();
  els.benchmarkAnalysisTake.replaceChildren(...state.benchmark.savedTakes.map((item, index) => {
    const date = new Date(item.acceptedAt ?? item.startedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    return new Option(`${index + 1}. ${item.scenarioId} · take ${item.repetition} · ${date}`, item.id);
  }));
  els.benchmarkAnalysisTake.value = take.id;
  els.benchmarkAnalysisName.textContent = `${take.scenarioId} · take ${take.repetition}`;
  els.benchmarkAnalysisMeta.textContent = `${benchmarkScenarioLabel(take.scenarioId)} · ${take.partId ?? 'parte'} · ${new Date(take.acceptedAt ?? take.startedAt).toLocaleString('it-IT')}`;
  renderBenchmarkAnalysisMetrics(take);
  if (state.benchmark.analysisAudioUrl) URL.revokeObjectURL(state.benchmark.analysisAudioUrl);
  if (state.benchmark.correctedAudioUrl) URL.revokeObjectURL(state.benchmark.correctedAudioUrl);
  state.benchmark.correctedAudioUrl = null; state.benchmark.correctedAudioKey = null; state.benchmark.audioVariant = 'original';
  state.benchmark.analysisAudioUrl = take.audio ? URL.createObjectURL(take.audio) : null;
  els.benchmarkAnalysisAudio.src = state.benchmark.analysisAudioUrl ?? '';
  els.feedbackPlaybackKind.textContent = 'Registrazione originale';
  els.feedbackScoreImage.src = els.scoreImage.currentSrc || els.scoreImage.src || '';
  const duration = Math.max(0, (take.endAudioTimeSec ?? 0) - (take.startAudioTimeSec ?? 0));
  els.benchmarkAnalysisTime.textContent = `${formatClock(0)} / ${formatClock(duration)}`;
  state.benchmark.analysisView.selectedBeat ??= Number(take.startBeat) || 0;
  updateBenchmarkSelectionLabel(take);
  updateBenchmarkAnalysisPlayButton();
  els.feedbackNoteCard.hidden = true;
  renderFeedbackPriorities(take);
  els.feedbackStatus.textContent = take._vocalFeedback?.signature === feedbackSignature(take) ? 'Analisi disponibile: colori e simboli sono mostrati direttamente sulle note.' : 'Premi “Analizza esecuzione” per visualizzare il feedback sulla traccia.';
  if (take._vocalFeedback?.signature === feedbackSignature(take)) renderFeedbackNote(take);
  requestAnimationFrame(() => drawBenchmarkAnalysisRoll(take));
}

function openBenchmarkAnalysis() {
  if (!selectedBenchmarkTake()) return;
  if (els.benchmarkDialog.open) els.benchmarkDialog.close();
  state.benchmark.analysisView = { timeZoom: 1, pitchZoom: 1, centerBeat: null, pitchOffset: 0, pointer: null, inspectBeat: null, selectedBeat: Number(selectedBenchmarkTake().startBeat) || 0 };
  els.benchmarkAnalysis.hidden = false;
  renderBenchmarkAnalysis();
}

function closeBenchmarkAnalysis() {
  els.benchmarkAnalysisAudio.pause();
  stopBenchmarkPlaybackAnimation();
  els.benchmarkAnalysis.hidden = true;
}

async function refreshBenchmarkArchive() {
  try {
    const store = await benchmarkStore();
    const takes = await new Promise((resolve, reject) => {
      const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    state.benchmark.savedTakes = takes.sort((a, b) => String(b.acceptedAt ?? b.startedAt).localeCompare(String(a.acceptedAt ?? a.startedAt)));
    renderBenchmarkArchive();
  } catch (_) { state.benchmark.savedTakes = []; els.benchmarkArchive.hidden = true; }
  await refreshBenchmarkCount();
}

function updateBenchmarkControls() {
  const recording = Boolean(state.benchmark.capture);
  const pending = Boolean(state.benchmark.pending);
  els.benchmarkSetupSection.hidden = pending;
  els.benchmarkPrimaryActions.hidden = pending;
  els.benchmarkReviewActions.hidden = !pending;
  els.benchmarkClose.textContent = pending ? 'Chiudi' : 'Annulla';
  els.benchmarkStart.disabled = recording || pending || !els.benchmarkSetup.checked;
  els.benchmarkListen.disabled = !pending;
  els.benchmarkAccept.disabled = !pending;
  els.benchmarkDiscard.disabled = !recording && !pending;
  els.benchmark.textContent = recording ? 'Interrompi benchmark' : 'Benchmark';
  els.benchmark.setAttribute('aria-pressed', String(recording));
}

async function openBenchmarkDialog() {
  if (!els.benchmarkScenario.options.length) {
    els.benchmarkScenario.replaceChildren(...BENCHMARK_SCENARIOS.map(([id, label]) => new Option(`${id} · ${label}`, id)));
  }
  state.benchmark.sessionId ??= crypto.randomUUID();
  if (state.clock.running) state.clock.pause();
  if (state.fullScore) {
    state.fullScore = false;
    els.scoreMode.setAttribute('aria-pressed', 'false');
    els.scoreMode.textContent = 'Partitura';
    document.querySelector('.score-region').classList.remove('full-score');
  }
  // A benchmark take must start from an empty pitch lane. This only clears
  // transient Practice history for the selected part; accepted recordings in
  // IndexedDB are not touched.
  clearPitchHistory();
  seekToMeasure(0);
  await refreshBenchmarkArchive();
  els.benchmarkStatus.textContent = state.benchmark.pending
    ? 'Take pronto: ascolta, accetta oppure scarta.'
    : 'Sei all’inizio del brano. Conferma la checklist: il pulsante avvia registrazione e playback, poi torna automaticamente alla prova.';
  updateBenchmarkControls();
  if (!els.benchmarkDialog.open) els.benchmarkDialog.showModal();
}

async function armBenchmarkMicrophone() {
  if (state.microphoneStatus !== 'active') await toggleMicrophone();
  els.benchmarkStatus.textContent = state.microphoneStatus === 'active'
    ? 'Microfono pronto. Conferma la checklist e avvia il take.'
    : 'Non è stato possibile armare il microfono.';
  updateBenchmarkControls();
}

function appendBenchmarkFrame(estimate, beat) {
  const capture = state.benchmark.capture;
  if (!capture || !state.microphoneContext) return;
  const target = state.runtime.targetAt(beat);
  capture.frames.push({
    audioTimeSec: Number(state.microphoneContext.currentTime.toFixed(6)),
    beat: Number(beat.toFixed(5)), rms: Number((estimate.rms ?? 0).toFixed(7)),
    rawHz: Number.isFinite(estimate.rawHz) ? Number(estimate.rawHz.toFixed(5)) : null,
    trackedHz: Number.isFinite(estimate.hz) ? Number(estimate.hz.toFixed(5)) : null,
    clarity: Number((estimate.clarity ?? 0).toFixed(5)), confidence: Number((estimate.confidence ?? 0).toFixed(5)),
    voicing: estimate.accepted ? 'voiced' : (estimate.rawHz == null ? 'unvoiced' : 'uncertain'),
    rejectionReason: estimate.rejectionReason ?? null,
    targetMidiPitch: target ? target.midiPitch + state.transpose : null,
    targetEventId: target?.sourceEventId ?? null,
  });
}

function reportBenchmarkEvent(action, details = {}) {
  if (!RUNTIME_CONFIG.benchmarkEventUrl) return;
  fetch(RUNTIME_CONFIG.benchmarkEventUrl, {
    method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, at: new Date().toISOString(), ...details }),
  }).catch(() => { /* The diagnostic endpoint is optional and never blocks recording. */ });
}

async function startBenchmarkCapture() {
  if (!els.benchmarkSetup.checked) { els.benchmarkStatus.textContent = 'Conferma prima la checklist di ambiente e microfono.'; return; }
  if (state.microphoneStatus !== 'active') { await armBenchmarkMicrophone(); if (state.microphoneStatus !== 'active') return; }
  if (!window.MediaRecorder) { els.benchmarkStatus.textContent = 'Questo browser non supporta la registrazione audio.'; return; }
  const chunks = [];
  const recorder = new MediaRecorder(state.microphoneStream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined);
  beginPitchTake();
  state.benchmark.capture = {
    recorder, chunks, frames: [], startBeat: state.clock.snapshot().beat,
    startAudioTimeSec: state.microphoneContext.currentTime, startedAt: new Date().toISOString(),
    scenarioId: els.benchmarkScenario.value, repetition: Number(els.benchmarkRepeat.value) || 1,
  };
  const capture = state.benchmark.capture;
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.start(250);
  reportBenchmarkEvent('started', { recorderState: recorder.state, pieceId: state.bundleManifest.piece_id, partId: state.runtime.selectedPartId });
  const scenario = BENCHMARK_SCENARIOS.find(([id]) => id === state.benchmark.capture.scenarioId)?.[1] ?? state.benchmark.capture.scenarioId;
  els.benchmarkLiveScenario.textContent = `${state.benchmark.capture.scenarioId} · ${scenario}`;
  els.benchmarkRecording.hidden = false;
  els.benchmarkDialog.close();
  if (!state.rafId) state.rafId = requestAnimationFrame(render);
  els.benchmarkStatus.textContent = 'Registrazione attiva: canta e interrompi quando hai finito.';
  updateBenchmarkControls();
  // Do not await media.play(): some browsers leave that promise pending while
  // decoding/loading. Recording controls must become usable immediately.
  if (!state.clock.running) {
    state.clock.play().then(() => { updatePlaybackButton(); render(); }).catch((error) => {
      if (state.benchmark.capture !== capture) return;
      els.benchmarkStatus.textContent = `Registrazione attiva, ma il playback non è partito: ${error.message ?? 'errore sconosciuto'}.`;
    });
  } else updatePlaybackButton();
}

function benchmarkConfiguration() {
  return {
    estimator: { id: 'yin-style-js', minHz: 70, maxHz: 1000, cmndThreshold: 0.42 },
    tracker: { id: 'PitchSmoother', minClarity: 0.45, minConfidence: 0.30,
      fastAlpha: state.detectorSettings.fastAlpha, slowAlpha: state.detectorSettings.slowAlpha,
      medianWindowFrames: state.detectorSettings.medianWindowFrames },
    capture: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    browser: navigator.userAgent, sampleRate: state.microphoneContext?.sampleRate ?? null,
  };
}

function finalizeBenchmarkCapture(capture) {
  if (capture.finalized) return;
  capture.finalized = true;
  reportBenchmarkEvent('stopped', { recorderState: capture.recorder.state, frames: capture.frames.length });
  const audio = new Blob(capture.chunks, { type: capture.recorder.mimeType || 'audio/webm' });
  state.benchmark.pending = {
    id: crypto.randomUUID(), kind: 'tenor-benchmark-take-v1', status: 'pending-review',
    sessionId: state.benchmark.sessionId, scenarioId: capture.scenarioId, repetition: capture.repetition,
    startedAt: capture.startedAt, stoppedAt: new Date().toISOString(), pieceId: state.bundleManifest.piece_id,
    scoreVersionId: state.runtime.scoreVersionId, timelineHash: state.bundleManifest.integrity?.hashes?.timeline ?? null,
    partId: state.runtime.selectedPartId, transpose: state.transpose, startBeat: capture.startBeat, endBeat: capture.endBeat,
    startAudioTimeSec: capture.startAudioTimeSec, endAudioTimeSec: capture.endAudioTimeSec,
    targetEvents: state.runtime.targetEvents.filter((event) => event.onsetBeat + event.durationBeats >= capture.startBeat && event.onsetBeat <= capture.endBeat),
    configuration: benchmarkConfiguration(), frames: capture.frames, audio,
  };
  state.benchmark.capture = null;
  state.benchmark.previewUrl && URL.revokeObjectURL(state.benchmark.previewUrl);
  state.benchmark.previewUrl = URL.createObjectURL(audio);
  els.benchmarkStatus.textContent = `${capture.frames.length} frame acquisiti. Ascolta, accetta oppure scarta il take.`;
  updateBenchmarkControls();
  if (!els.benchmarkDialog.open) els.benchmarkDialog.showModal();
}

function stopBenchmarkCapture() {
  const capture = state.benchmark.capture;
  reportBenchmarkEvent('stop-requested', { hasCapture: Boolean(capture), recorderState: capture?.recorder?.state ?? 'none' });
  if (!capture) {
    els.benchmarkRecording.hidden = true;
    updateBenchmarkControls();
    showToast('La registrazione benchmark non è più attiva.');
    return;
  }
  if (capture.stopping) return;
  capture.stopping = true;
  if (state.clock.running) state.clock.pause();
  updatePlaybackButton();
  els.benchmarkRecording.hidden = true;
  capture.endBeat = state.clock.snapshot().beat;
  capture.endAudioTimeSec = state.microphoneContext?.currentTime ?? null;
  capture.recorder.onstop = () => finalizeBenchmarkCapture(capture);
  els.benchmarkStatus.textContent = 'Finalizzazione del take in corso…';
  updateBenchmarkControls();
  try {
    if (capture.recorder.state === 'inactive') finalizeBenchmarkCapture(capture);
    else capture.recorder.stop();
  } catch (error) {
    console.warn('Impossibile arrestare MediaRecorder; finalizzo comunque il take.', error);
    finalizeBenchmarkCapture(capture);
  }
}

// Direct handler used by the visible recording control. The delegated listener
// remains as a second path for pointer devices and overlays.
window.ChoirBenchmarkStop = stopBenchmarkCapture;

async function acceptBenchmarkTake() {
  const take = state.benchmark.pending;
  if (!take) return;
  try {
    take.status = 'accepted'; take.acceptedAt = new Date().toISOString();
    await putLocalRecord(await benchmarkStore('readwrite'), take);
    const session = { id: state.benchmark.sessionId, kind: 'tenor-benchmark-session-v1', updatedAt: take.acceptedAt,
      pieceId: take.pieceId, partId: take.partId, configuration: take.configuration };
    await putLocalRecord(await benchmarkSessionStore('readwrite'), session);
    state.benchmark.pending = null;
    state.benchmark.previewUrl && URL.revokeObjectURL(state.benchmark.previewUrl); state.benchmark.previewUrl = null;
    els.benchmarkStatus.textContent = 'Take benchmark accettato e salvato localmente.';
    await refreshBenchmarkArchive(); updateBenchmarkControls(); showToast('Take benchmark salvato localmente.');
  } catch (error) { els.benchmarkStatus.textContent = `Salvataggio non riuscito: ${error.message}`; }
}

function discardBenchmarkTake() {
  const capture = state.benchmark.capture;
  if (capture) { capture.recorder.onstop = () => {}; capture.recorder.stop(); state.benchmark.capture = null; }
  els.benchmarkRecording.hidden = true;
  state.benchmark.pending = null;
  if (state.benchmark.previewUrl) URL.revokeObjectURL(state.benchmark.previewUrl);
  state.benchmark.previewUrl = null;
  els.benchmarkStatus.textContent = 'Take scartato: nessun audio o frame benchmark è stato salvato.';
  updateBenchmarkControls();
}

function listenToBenchmarkTake(take = state.benchmark.pending) {
  const isPendingTake = take === state.benchmark.pending;
  const url = isPendingTake ? state.benchmark.previewUrl : (take?.audio ? URL.createObjectURL(take.audio) : null);
  if (!url) return;
  const audio = new Audio(url);
  audio.addEventListener('ended', () => { if (!isPendingTake) URL.revokeObjectURL(url); }, { once: true });
  audio.play().catch(() => {
    if (!isPendingTake) URL.revokeObjectURL(url);
    els.benchmarkStatus.textContent = 'Riproduzione non disponibile.';
  });
}

function finishAttempt() {
  state.attemptActive = false;
  els.nextPhrase.disabled = !state.phrase || state.phrase.end >= state.occurrenceMeasures.length - 1;
  els.resultProgress.textContent = '';
  if (state.attempt.voicedMs < 1000) {
    els.resultText.textContent = 'Voce riconosciuta per meno di un secondo: dati insufficienti per valutare questa prova.';
  } else {
    const score = Math.round(state.attempt.insideMs / state.attempt.voicedMs * 100);
    els.resultText.textContent = `${score}% del tempo di voce riconosciuta entro ±${UI_CONFIG.acceptableCents} cent dal target. Silenzio e segnale incerto sono esclusi.`;
    const key = `${preferenceKey()}:result:${state.runtime.scoreVersionId}:${state.phrase?.start ?? 0}:${state.phrase?.end ?? 'all'}:${state.transpose}:${els.playbackSpeed.value}`;
    try {
      const previous = JSON.parse(localStorage.getItem(key));
      if (previous && Number.isFinite(previous.score)) {
        const delta = score - previous.score;
        els.resultProgress.textContent = delta === 0 ? 'Stesso risultato del tentativo precedente.' : `${delta > 0 ? '+' : ''}${delta} punti percentuali rispetto al tentativo precedente.`;
      }
      localStorage.setItem(key, JSON.stringify({ score }));
    } catch (_) {}
  }
  if (!els.resultDialog.open) els.resultDialog.showModal();
}

function globalDetectorPreferences() {
  return {
    v1RmsThreshold: state.detectorSettings.rmsThreshold,
    v1FastAlpha: state.detectorSettings.fastAlpha,
    v1SlowAlpha: state.detectorSettings.slowAlpha,
    v1MedianWindowFrames: state.detectorSettings.medianWindowFrames,
    v1PlumeWidth: state.plumeSettings.width,
    v1PlumeIntensity: state.plumeSettings.intensity,
    pitchTargetColor: state.plumeSettings.targetColor,
    v1PlumePresentColor: state.plumeSettings.presentColor,
    v1PlumePastColor: state.plumeSettings.pastColor,
    v1PlumeAdvanceMs: state.plumeSettings.timeAdvanceMs,
    displayPitchAlgorithm: state.displayPitchAlgorithm,
    pitchLayerV1: state.pitchLayers.v1,
    pitchLayerCrepe: state.pitchLayers.crepe,
  };
}

function saveGlobalDetectorPreferences() {
  localStorage.setItem(GLOBAL_DETECTOR_PREFERENCES_KEY, JSON.stringify(globalDetectorPreferences()));
}

function savePreferences() {
  try {
    localStorage.setItem(preferenceKey(), JSON.stringify({ transpose: state.transpose,
      speed: els.playbackSpeed.value, volume: els.volume.value, metronome: els.metronomeVolume.value,
      measure: measureIndexAt(state.clock.snapshot().beat),
      noteNames: state.noteNames, noteNamesPreferenceVersion: 2,
      scoreHeight: Math.round(els.scoreViewport.clientHeight), v1RmsThreshold: state.detectorSettings.rmsThreshold,
      v1FastAlpha: state.detectorSettings.fastAlpha, v1SlowAlpha: state.detectorSettings.slowAlpha,
      v1MedianWindowFrames: state.detectorSettings.medianWindowFrames,
      v1PlumeWidth: state.plumeSettings.width, v1PlumeIntensity: state.plumeSettings.intensity,
      pitchTargetColor: state.plumeSettings.targetColor, v1PlumePresentColor: state.plumeSettings.presentColor,
      v1PlumePastColor: state.plumeSettings.pastColor, v1PlumeAdvanceMs: state.plumeSettings.timeAdvanceMs,
      displayPitchAlgorithm: state.displayPitchAlgorithm, pitchLayerV1: state.pitchLayers.v1,
      pitchLayerCrepe: state.pitchLayers.crepe }));
    saveGlobalDetectorPreferences();
    localStorage.setItem(`choir-part:${state.bundleManifest.piece_id ?? state.runtime.title}`, state.runtime.selectedPartId);
  } catch (_) { /* Practice remains usable when storage is unavailable. */ }
}

function restorePreferences() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(preferenceKey())) ?? {}; } catch (_) {}
  let detectorSaved = null;
  try { detectorSaved = JSON.parse(localStorage.getItem(GLOBAL_DETECTOR_PREFERENCES_KEY)); } catch (_) {}
  // Migrate existing per-piece detector settings once, then use the global
  // record for every piece and voice part.
  detectorSaved = detectorSaved && typeof detectorSaved === 'object' ? detectorSaved : saved;
  state.transpose = Number.isInteger(saved.transpose) && Math.abs(saved.transpose) <= 12 ? saved.transpose : 0;
  els.transpose.value = String(state.transpose);
  // The current practice session must start on the complete piece.  A saved
  // one-measure exercise is especially misleading: it can finish before a
  // singer has had a full second of scoreable notes.  Phrase exercises are
  // deliberately transient; only an explicit URL deep link may set one.
  state.autoLoop = false; els.phraseLoop.checked = false;
  // Existing preferences used English as the implicit default. Migrate those
  // users to Italian while preserving any deliberate choice made from now on.
  state.noteNames = saved.noteNamesPreferenceVersion === 2 && saved.noteNames === 'international' ? 'international' : 'italian';
  els.noteNames.value = state.noteNames;
  const measures = buildOccurrenceMeasures(state.runtime);
  state.selectedMeasureIndex = Number.isInteger(saved.measure) ? Math.max(0, Math.min(measures.length - 1, saved.measure)) : 0;
  state.phrase = null;
  els.playbackSpeed.value = ['0.5', '0.75', '1'].includes(saved.speed) ? saved.speed : '1';
  els.volume.value = Number.isFinite(Number(saved.volume)) ? Math.max(0, Math.min(100, Number(saved.volume))) : 62;
  els.metronomeVolume.value = Number.isFinite(Number(saved.metronome)) ? Math.max(0, Math.min(100, Number(saved.metronome))) : 0;
  state.detectorSettings.rmsThreshold = Number.isFinite(Number(detectorSaved.v1RmsThreshold))
    ? Math.max(V1_RMS_THRESHOLD.min, Math.min(V1_RMS_THRESHOLD.max, Number(detectorSaved.v1RmsThreshold)))
    : V1_RMS_THRESHOLD.default;
  state.detectorSettings.fastAlpha = Number.isFinite(Number(detectorSaved.v1FastAlpha))
    ? Math.max(.05, Math.min(.95, Number(detectorSaved.v1FastAlpha))) : V1_TRACKER_DEFAULTS.fastAlpha;
  state.detectorSettings.slowAlpha = Number.isFinite(Number(detectorSaved.v1SlowAlpha))
    ? Math.max(.05, Math.min(.95, Number(detectorSaved.v1SlowAlpha))) : V1_TRACKER_DEFAULTS.slowAlpha;
  const savedMedian = Number(detectorSaved.v1MedianWindowFrames);
  state.detectorSettings.medianWindowFrames = Number.isFinite(savedMedian)
    ? Math.max(1, Math.min(7, Math.round(savedMedian / 2) * 2 - 1)) : V1_TRACKER_DEFAULTS.medianWindowFrames;
  state.plumeSettings.width = Number.isFinite(Number(detectorSaved.v1PlumeWidth))
    ? Math.max(.35, Math.min(2.2, Number(detectorSaved.v1PlumeWidth))) : 1;
  state.plumeSettings.intensity = Number.isFinite(Number(detectorSaved.v1PlumeIntensity))
    ? Math.max(.15, Math.min(2, Number(detectorSaved.v1PlumeIntensity))) : 1;
  state.plumeSettings.targetColor = validHexColor(detectorSaved.pitchTargetColor)
    ? detectorSaved.pitchTargetColor : PitchShared.PLUME_DEFAULTS.targetColor;
  state.plumeSettings.presentColor = validHexColor(detectorSaved.v1PlumePresentColor)
    ? detectorSaved.v1PlumePresentColor
    : validHexColor(detectorSaved.v1PlumeColor) ? detectorSaved.v1PlumeColor : PitchShared.PLUME_DEFAULTS.presentColor;
  state.plumeSettings.pastColor = validHexColor(detectorSaved.v1PlumePastColor)
    ? detectorSaved.v1PlumePastColor : PitchShared.PLUME_DEFAULTS.pastColor;
  state.plumeSettings.timeAdvanceMs = Number.isFinite(Number(detectorSaved.v1PlumeAdvanceMs))
    ? Math.round(Math.max(0, Math.min(200, Number(detectorSaved.v1PlumeAdvanceMs))) / 10) * 10 : 200;
  state.displayPitchAlgorithm = detectorSaved.displayPitchAlgorithm === 'v1' ? 'v1' : 'v1+display-filter';
  state.displayPitchFilter.reset();
  state.pitchLayers.v1 = detectorSaved.pitchLayerV1 !== false;
  state.pitchLayers.crepe = detectorSaved.pitchLayerCrepe !== false;
  els.pitchLayerV1.checked = state.pitchLayers.v1;
  els.pitchLayerCrepe.checked = state.pitchLayers.crepe;
  applyLiveTrackerSettings();
  updateDetectorSettingsUi();
  try { saveGlobalDetectorPreferences(); } catch (_) { /* Storage is optional. */ }
  if (Number.isFinite(saved.scoreHeight)) setScoreHeight(saved.scoreHeight);
}

function scoreHeightLimits() {
  const shell = document.querySelector('.practice-shell');
  const scoreRegion = document.querySelector('.score-region');
  const transportHeight = document.querySelector('.practice-transport').offsetHeight;
  const minimum = 96;
  const maximum = Math.max(minimum, shell.clientHeight - scoreRegion.offsetTop - transportHeight - 172);
  return { minimum, maximum };
}

function setScoreHeight(height) {
  const { minimum, maximum } = scoreHeightLimits();
  const value = Math.round(Math.max(minimum, Math.min(maximum, height)));
  document.documentElement.style.setProperty('--score-h', `${value}px`);
  els.scorePitchDivider.setAttribute('aria-valuemax', String(Math.round(maximum)));
  els.scorePitchDivider.setAttribute('aria-valuenow', String(value));
}

function bindScorePitchDivider() {
  let drag = null;
  setScoreHeight(els.scoreViewport.clientHeight);
  const finish = () => {
    if (!drag) return;
    els.scorePitchDivider.releasePointerCapture?.(drag.pointerId);
    els.scorePitchDivider.classList.remove('is-resizing');
    drag = null;
    savePreferences();
  };
  els.scorePitchDivider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { pointerId: event.pointerId, startY: event.clientY, startHeight: els.scoreViewport.clientHeight };
    els.scorePitchDivider.setPointerCapture(event.pointerId);
    els.scorePitchDivider.classList.add('is-resizing');
    event.preventDefault();
  });
  els.scorePitchDivider.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    setScoreHeight(drag.startHeight + event.clientY - drag.startY);
  });
  els.scorePitchDivider.addEventListener('pointerup', finish);
  els.scorePitchDivider.addEventListener('pointercancel', finish);
  els.scorePitchDivider.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 32 : 12;
    if (event.key === 'ArrowUp') setScoreHeight(els.scoreViewport.clientHeight - step);
    else if (event.key === 'ArrowDown') setScoreHeight(els.scoreViewport.clientHeight + step);
    else return;
    event.preventDefault();
    savePreferences();
  });
  window.addEventListener('resize', () => setScoreHeight(els.scoreViewport.clientHeight));
}

function changePart(partId) {
  state.attemptActive = false;
  if (state.clock.running) state.clock.pause();
  savePitchHistory();
  state.runtime.selectPart(partId);
  state.selectedVoiceIds = new Set([partId]);
  restorePreferences();
  restorePitchHistory();
  const part = state.runtime.parts.find((item) => item.id === partId);
  els.scorePartLabel.textContent = part?.name ?? 'Parte';
  state.scorePage = 0;
  state.pitchViewport = null;
  buildScoreGeometry(partId);
  buildFallbackScoreGeometry(partId);
  configureBacking();
  if (state.usesPreRenderedSpeed) state.clock.setPreRenderedSpeed(Number(els.playbackSpeed.value));
  else state.clock.setSpeed(Number(els.playbackSpeed.value));
  seekToMeasure(0);
}

function bindControls() {
  bindGridInspection();
  bindScorePitchDivider();
  bindBenchmarkAnalysisCanvas();
  document.querySelector('.toolbar-more').addEventListener('click', (event) => {
    if (event.target.closest('button')) event.currentTarget.removeAttribute('open');
  });
  document.getElementById('test-microphone').addEventListener('click', toggleMicrophone);
  els.accompanimentMode.addEventListener('click', () => {
    renderVoiceMixer();
    if (!els.voiceMixerDialog.open) els.voiceMixerDialog.showModal();
  });
  els.voiceMixerClose.addEventListener('click', () => els.voiceMixerDialog.close());
  els.voiceMixerOwn.addEventListener('click', () => {
    state.selectedVoiceIds = new Set([state.runtime.selectedPartId]);
    configureVoiceStems(); renderVoiceMixer();
    if (state.clock.running) void playVoiceStems();
  });
  window.addEventListener('pagehide', savePreferences);
  els.exercise.addEventListener('click', () => {
    state.clock.pause(); updatePlaybackButton();
    const options = () => state.occurrenceMeasures.map((measure, index) => new Option(`${index + 1} · battuta ${measure.number}`, String(index)));
    els.phraseStart.replaceChildren(...options()); els.phraseEnd.replaceChildren(...options());
    els.phraseStart.value = String(state.phrase?.start ?? measureIndexAt(state.clock.snapshot().beat));
    els.phraseEnd.value = String(state.phrase?.end ?? Math.min(state.occurrenceMeasures.length - 1, Number(els.phraseStart.value) + 3));
    els.exerciseDialog.showModal();
  });
  els.exerciseClose.addEventListener('click', () => els.exerciseDialog.close());
  els.phraseApply.addEventListener('click', () => {
    const start = Number(els.phraseStart.value), end = Number(els.phraseEnd.value);
    if (end < start) { showToast('La battuta finale deve seguire quella iniziale.'); return; }
    state.phrase = { start, end }; state.autoLoop = els.phraseLoop.checked; state.attemptActive = false;
    seekToMeasure(start); savePreferences(); els.exerciseDialog.close();
  });
  els.phraseClear.addEventListener('click', () => { state.phrase = null; state.attemptActive = false; savePreferences(); els.exerciseDialog.close(); });
  els.resultClose.addEventListener('click', () => els.resultDialog.close());
  els.noteNames.addEventListener('change', () => { state.noteNames = els.noteNames.value; savePreferences(); render(); });
  els.retry.addEventListener('click', () => { els.resultDialog.close(); seekToMeasure(state.phrase?.start ?? 0); togglePlayback(); });
  els.nextPhrase.addEventListener('click', () => {
    if (!state.phrase) return;
    const length = state.phrase.end - state.phrase.start + 1, start = state.phrase.end + 1;
    state.phrase = { start, end: Math.min(state.occurrenceMeasures.length - 1, start + length - 1) };
    els.resultDialog.close(); seekToMeasure(start); savePreferences(); togglePlayback();
  });
  els.backingAudio.addEventListener('loadedmetadata', () => {
    if (state.pendingAudioTime != null) { state.clock.seekPerformanceTime(state.pendingAudioTime); state.pendingAudioTime = null; render(); }
  });
  els.backingAudio.addEventListener('play', () => { void playVoiceStems(); });
  els.backingAudio.addEventListener('pause', pauseVoiceStems);
  els.backingAudio.addEventListener('seeking', () => {
    for (const audio of state.voiceStemAudio.values()) audio.currentTime = els.backingAudio.currentTime;
  });
  els.backingAudio.addEventListener('timeupdate', () => {
    for (const audio of state.voiceStemAudio.values()) {
      if (Math.abs(audio.currentTime - els.backingAudio.currentTime) > .08) audio.currentTime = els.backingAudio.currentTime;
    }
  });
  els.transpose.addEventListener('change', () => {
    const snapshot = state.clock.snapshot();
    state.clock.pause();
    state.transpose = Number(els.transpose.value);
    state.attemptActive = false;
    state.pitchViewport = null; beginPitchTake();
    configureBacking();
    state.pendingAudioTime = snapshot.performanceTime;
    state.clock.seekPerformanceTime(snapshot.performanceTime);
    savePreferences(); updatePlaybackButton(); render();
    showToast(state.transpose ? `Trasposizione ${state.transpose > 0 ? '+' : ''}${state.transpose} semitoni. Spartito originale.` : 'Tonalità originale');
  });
  for (const control of [els.playbackSpeed, els.volume, els.metronomeVolume]) {
    control.addEventListener('change', savePreferences);
  }
  els.volume.addEventListener('input', syncVoiceStemLevels);
  [['v1', els.pitchLayerV1], ['crepe', els.pitchLayerCrepe]].forEach(([layer, control]) => {
    control.addEventListener('change', () => {
      state.pitchLayers[layer] = control.checked;
      savePreferences(); render();
    });
  });
  els.togglePlayback.addEventListener('click', togglePlayback);
  els.restartPractice.addEventListener('click', restartPractice);
  els.restartTransport.addEventListener('click', restartPractice);
  els.groundTruth.addEventListener('click', openGroundTruthDialog);
  els.groundTruthStart.addEventListener('click', startGroundTruthCapture);
  els.groundTruthApprove.addEventListener('click', approveGroundTruthCapture);
  els.groundTruthClose.addEventListener('click', () => els.groundTruthDialog.close());
  els.benchmark.addEventListener('click', () => {
    if (state.benchmark.capture) stopBenchmarkCapture(); else openBenchmarkDialog();
  });
  els.benchmarkStart.addEventListener('click', startBenchmarkCapture);
  // Capture-phase delegation bypasses any canvas/overlay event handling.
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest?.('#benchmark-stop-live')) return;
    event.preventDefault();
    stopBenchmarkCapture();
  }, true);
  els.benchmarkListen.addEventListener('click', listenToBenchmarkTake);
  els.benchmarkAccept.addEventListener('click', acceptBenchmarkTake);
  els.benchmarkDiscard.addEventListener('click', discardBenchmarkTake);
  els.benchmarkTakeList.addEventListener('change', () => {
    state.benchmark.selectedTakeId = els.benchmarkTakeList.value;
    renderBenchmarkArchive();
  });
  els.benchmarkOpenAnalysis.addEventListener('click', openBenchmarkAnalysis);
  els.benchmarkAnalysisBack.addEventListener('click', closeBenchmarkAnalysis);
  els.benchmarkAnalysisTake.addEventListener('change', () => {
    state.benchmark.selectedTakeId = els.benchmarkAnalysisTake.value;
    resetBenchmarkAnalysisView(false);
    renderBenchmarkArchive(); renderBenchmarkAnalysis();
  });
  els.benchmarkAnalysisReset.addEventListener('click', () => resetBenchmarkAnalysisView());
  els.benchmarkAnalysisPlaySelection.addEventListener('click', () => { void toggleBenchmarkPlaybackFromSelection(); });
  els.feedbackAnalyse.addEventListener('click', () => { void analyseBenchmarkFeedback(); });
  els.feedbackPrevious.addEventListener('click', () => selectAdjacentFeedbackNote(-1));
  els.feedbackNext.addEventListener('click', () => selectAdjacentFeedbackNote(1));
  els.feedbackOriginal.addEventListener('click', playFeedbackOriginal);
  els.feedbackCorrected.addEventListener('click', () => { void playFeedbackCorrected(); });
  els.feedbackStrength.addEventListener('input', () => { els.feedbackStrengthValue.value = `${els.feedbackStrength.value}%`; });
  els.feedbackPriorityList.addEventListener('click', (event) => {
    const item = event.target.closest('.feedback-priority'); const take = selectedBenchmarkTake(), beat = Number(item?.dataset.startBeat);
    if (!take || !Number.isFinite(beat)) return; selectBenchmarkAnalysisBeat(take, beat); state.benchmark.analysisView.centerBeat = beat; state.benchmark.analysisView.timeZoom = Math.max(2, state.benchmark.analysisView.timeZoom); drawBenchmarkAnalysisRoll(take);
  });
  [['v1', els.benchmarkAnalysisLayerV1], ['display', els.benchmarkAnalysisLayerDisplay], ['raw', els.benchmarkAnalysisLayerRaw], ['audio', els.benchmarkAnalysisLayerAudio], ['score', els.benchmarkAnalysisLayerScore]].forEach(([layer, control]) => {
    control.addEventListener('change', () => {
      state.benchmark.analysisLayers[layer] = control.checked;
      drawBenchmarkAnalysisRoll(selectedBenchmarkTake());
    });
  });
  els.benchmarkAnalysisAudio.addEventListener('timeupdate', () => {
    const take = selectedBenchmarkTake();
    const duration = benchmarkAnalysisDuration(take);
    els.benchmarkAnalysisTime.textContent = `${formatClock(els.benchmarkAnalysisAudio.currentTime)} / ${formatClock(duration)}`;
    drawBenchmarkAnalysisRoll(take);
  });
  els.benchmarkAnalysisAudio.addEventListener('loadedmetadata', () => {
    const take = selectedBenchmarkTake();
    const duration = benchmarkAnalysisDuration(take);
    els.benchmarkAnalysisTime.textContent = `${formatClock(els.benchmarkAnalysisAudio.currentTime)} / ${formatClock(duration)}`;
    if (Number.isFinite(state.benchmark.analysisView.selectedBeat))
      els.benchmarkAnalysisAudio.currentTime = benchmarkAudioTimeForBeat(take, state.benchmark.analysisView.selectedBeat);
    drawBenchmarkAnalysisRoll(take);
  });
  els.benchmarkAnalysisAudio.addEventListener('seeking', () => {
    const take = selectedBenchmarkTake(); if (!take) return;
    state.benchmark.analysisView.selectedBeat = benchmarkBeatForAudioTime(take, els.benchmarkAnalysisAudio.currentTime);
    updateBenchmarkSelectionLabel(take);
    drawBenchmarkAnalysisRoll(take);
  });
  els.benchmarkAnalysisAudio.addEventListener('play', () => { updateBenchmarkAnalysisPlayButton(); startBenchmarkPlaybackAnimation(); });
  els.benchmarkAnalysisAudio.addEventListener('pause', () => { updateBenchmarkAnalysisPlayButton(); stopBenchmarkPlaybackAnimation(); drawBenchmarkAnalysisRoll(selectedBenchmarkTake()); });
  els.benchmarkAnalysisAudio.addEventListener('ended', () => { updateBenchmarkAnalysisPlayButton(); stopBenchmarkPlaybackAnimation(); drawBenchmarkAnalysisRoll(selectedBenchmarkTake()); });
  els.benchmarkSetup.addEventListener('change', updateBenchmarkControls);
  els.benchmarkClose.addEventListener('click', () => {
    if (state.benchmark.capture) { els.benchmarkStatus.textContent = 'Interrompi o scarta prima la registrazione attiva.'; return; }
    els.benchmarkDialog.close();
  });
  els.benchmarkDialog.addEventListener('cancel', (event) => {
    if (state.benchmark.capture) { event.preventDefault(); els.benchmarkStatus.textContent = 'Interrompi o scarta prima la registrazione attiva.'; }
  });
  els.neuralLive.addEventListener('click', toggleNeuralLive);
  els.previousMeasure.addEventListener('click', () => seekToMeasure(Math.max(0, measureIndexAt(state.clock.snapshot().beat) - 1)));
  els.nextMeasure.addEventListener('click', () => seekToMeasure(Math.min(state.occurrenceMeasures.length - 1, measureIndexAt(state.clock.snapshot().beat) + 1)));
  els.partSelector.addEventListener('change', () => changePart(els.partSelector.value));
  els.playbackSpeed.addEventListener('change', async () => {
    const speed = Number(els.playbackSpeed.value);
    const snapshot = state.clock.snapshot();
    const wasRunning = state.clock.running;
    state.attemptActive = false; state.attempt = { voicedMs: 0, insideMs: 0 }; state.lastSampleMs = null;
    state.clock.pause();
    configureBacking();
    if (state.usesPreRenderedSpeed) state.clock.setPreRenderedSpeed(speed); else state.clock.setSpeed(speed);
    state.clock.seekPerformanceTime(snapshot.performanceTime);
    state.pendingAudioTime = snapshot.performanceTime;
    state.lastMetronomeBeat = null;
    if (wasRunning) await state.clock.play();
    state.attemptActive = state.clock.running;
    updatePlaybackButton();
    render();
  });
  els.scoreMode.addEventListener('click', () => {
    if (state.clock.running) { showToast('Metti in pausa per consultare la partitura completa.'); return; }
    state.fullScore = !state.fullScore;
    els.scoreMode.setAttribute('aria-pressed', String(state.fullScore));
    els.scoreMode.textContent = state.fullScore ? 'Mia parte' : 'Partitura';
    document.querySelector('.score-region').classList.toggle('full-score', state.fullScore);
    state.scorePage = 0; render();
  });
  els.accompanimentMode.addEventListener('change', () => {
    if (state.clock.running) { state.clock.pause(); updatePlaybackButton(); }
    showToast('Guida melodica derivata dallo score selezionato.');
    render();
  });
  els.volume.addEventListener('input', syncBackingLevel);
  els.metronomeVolume.addEventListener('input', () => {
    const value = Number(els.metronomeVolume.value);
    if (value > 0) state.rememberedMetronomeVolume = value;
    updateMetronomeControl();
  });
  els.metronomeToggle.addEventListener('click', () => {
    els.metronomeVolume.value = Number(els.metronomeVolume.value) > 0 ? 0 : state.rememberedMetronomeVolume;
    state.lastMetronomeBeat = null;
    updateMetronomeControl();
    savePreferences();
  });
  els.backingAudio.addEventListener('ended', () => { updatePlaybackButton(); render(); });
  els.backingAudio.addEventListener('pause', () => { updatePlaybackButton(); if (!state.clock.running) render(); });
  els.backingAudio.addEventListener('error', () => showToast(`Errore audio (${els.backingAudio.error?.code ?? 'sconosciuto'}).`));
  els.settings.addEventListener('click', openDetectorSettings);
  els.settingsDisplayPitchAlgorithm.addEventListener('change', () => {
    state.displayPitchAlgorithm = els.settingsDisplayPitchAlgorithm.value === 'v1' ? 'v1' : 'v1+display-filter';
    state.displayPitchFilter.reset(); savePreferences(); render();
    showToast(state.displayPitchAlgorithm === 'v1' ? 'Visualizzazione v1 pura.' : 'Filtro adattivo attivo solo sulla visualizzazione.');
  });
  els.settingsV1Rms.addEventListener('input', () => {
    state.detectorSettings.rmsThreshold = rmsThresholdFromSlider(els.settingsV1Rms.value);
    updateDetectorSettingsUi();
  });
  els.settingsV1Rms.addEventListener('change', () => {
    savePreferences();
    showToast(`Soglia v1 aggiornata: ${formatRmsThreshold(state.detectorSettings.rmsThreshold)} RMS.`);
  });
  const updateTrackerSettings = () => {
    state.detectorSettings.fastAlpha = Number(els.settingsV1FastAlpha.value) / 100;
    state.detectorSettings.slowAlpha = Number(els.settingsV1SlowAlpha.value) / 100;
    state.detectorSettings.medianWindowFrames = Number(els.settingsV1MedianFrames.value);
    applyLiveTrackerSettings(); updateDetectorSettingsUi();
  };
  for (const control of [els.settingsV1FastAlpha, els.settingsV1SlowAlpha, els.settingsV1MedianFrames]) {
    control.addEventListener('input', updateTrackerSettings);
    control.addEventListener('change', () => {
      savePreferences();
      showToast('Memoria del tracker v1 aggiornata.');
    });
  }
  const updatePlumeSettings = () => {
    state.plumeSettings.width = Number(els.settingsV1PlumeWidth.value) / 100;
    state.plumeSettings.intensity = Number(els.settingsV1PlumeIntensity.value) / 100;
    state.plumeSettings.targetColor = els.settingsTargetColor.value;
    state.plumeSettings.presentColor = els.settingsV1PlumePresentColor.value;
    state.plumeSettings.pastColor = els.settingsV1PlumePastColor.value;
    state.plumeSettings.timeAdvanceMs = Number(els.settingsV1PlumeAdvance.value);
    updateDetectorSettingsUi(); render();
  };
  for (const control of [els.settingsV1PlumeWidth, els.settingsV1PlumeIntensity, els.settingsTargetColor,
    els.settingsV1PlumePresentColor, els.settingsV1PlumePastColor, els.settingsV1PlumeAdvance]) {
    control.addEventListener('input', updatePlumeSettings);
    control.addEventListener('change', () => {
      savePreferences();
      showToast('Aspetto della plume v1 salvato.');
    });
  }
  els.settingsReset.addEventListener('click', () => {
    state.detectorSettings.rmsThreshold = V1_RMS_THRESHOLD.default;
    Object.assign(state.detectorSettings, V1_TRACKER_DEFAULTS);
    state.plumeSettings = { ...PitchShared.PLUME_DEFAULTS };
    state.displayPitchAlgorithm = 'v1+display-filter'; state.displayPitchFilter.reset();
    applyLiveTrackerSettings(); updateDetectorSettingsUi(); savePreferences();
    render(); showToast('Impostazioni v1 ripristinate ai valori predefiniti.');
  });
  els.settingsClose.addEventListener('click', () => els.settingsDialog.close());
  document.getElementById('admin-review').addEventListener('click', () => window.open('admin-review.html', 'choir-admin-review'));
  document.getElementById('exit-practice').addEventListener('click', openLibraryPicker);
  window.addEventListener('resize', () => { state.activeScoreSegment = null; render(); });
  window.addEventListener('resize', () => { if (!els.benchmarkAnalysis.hidden) drawBenchmarkAnalysisRoll(selectedBenchmarkTake()); });
  window.addEventListener('beforeunload', () => { savePitchHistory(); state.microphoneStream?.getTracks().forEach((track) => track.stop()); });
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !['SELECT', 'INPUT', 'BUTTON'].includes(document.activeElement?.tagName)) { event.preventDefault(); togglePlayback(); }
    if (event.code === 'ArrowLeft' && event.altKey) seekToMeasure(measureIndexAt(state.clock.snapshot().beat) - 1);
    if (event.code === 'ArrowRight' && event.altKey) seekToMeasure(measureIndexAt(state.clock.snapshot().beat) + 1);
  });
  els.scoreImage.addEventListener('load', () => { state.activeScoreSegment = null; els.scoreLoading.hidden = true; render(); });
  els.scoreImage.addEventListener('error', () => { els.scoreLoading.hidden = false; els.scoreLoading.textContent = 'Spartito non disponibile'; });
}

async function initialize() {
  const diagnosticsEnabled = RUNTIME_CONFIG.features?.diagnostics !== false;
  const crepeEnabled = diagnosticsEnabled && RUNTIME_CONFIG.features?.crepe !== false;
  for (const element of [els.benchmark, document.getElementById('admin-review')]) {
    if (element) element.hidden = !diagnosticsEnabled;
  }
  for (const element of [els.neuralLive, document.querySelector('.plume-key')]) {
    if (element) element.hidden = !crepeEnabled;
  }
  const buildVersion = document.getElementById('build-version');
  if (RUNTIME_CONFIG.buildVersion && buildVersion) {
    buildVersion.textContent = `Build ${RUNTIME_CONFIG.buildVersion}`;
    buildVersion.hidden = false;
  }
  const libraryResponse = await fetch(RUNTIME_CONFIG.libraryUrl, { cache: 'no-store' });
  if (!libraryResponse.ok) throw new Error('Libreria dei brani non disponibile');
  state.library = (await libraryResponse.json()).pieces ?? [];
  if (!state.library.length) throw new Error('Non ci sono brani MuseScore nella cartella sheets');
  bindLibraryPicker();
  const requestedPiece = new URLSearchParams(window.location.search).get('piece');
  let rememberedPiece = null;
  try { rememberedPiece = localStorage.getItem(LAST_PRACTICE_PIECE_KEY); } catch (_) { /* Optional convenience only. */ }
  const selectedPiece = [requestedPiece, rememberedPiece, state.library[0]?.piece_id]
    .find((pieceId) => pieceId && state.library.some((piece) => piece.piece_id === pieceId));
  await loadPracticePiece(selectedPiece);
}

function openLibraryPicker() {
  if (state.clock?.running) state.clock.pause();
  if (state.clock) updatePlaybackButton();
  const requested = new URLSearchParams(window.location.search).get('piece');
  populateLibraryPieces(requested);
  updateLibraryParts();
  if (!els.piecePickerDialog.open) els.piecePickerDialog.showModal();
}

async function updateLibraryParts() {
  const piece = state.library.find((item) => item.piece_id === els.libraryPiece.value);
  els.libraryTitle.value = piece ? pieceDisplayTitle(piece) : '';
  if (piece && !piece.parts?.length && !piece.loading) {
    piece.loading = true;
    els.libraryOpen.disabled = true;
    els.libraryPart.replaceChildren(new Option('Preparazione parti…', ''));
    els.libraryNote.hidden = false;
    els.libraryNote.textContent = 'Preparo le parti vocali…';
    try {
      const response = await fetch(libraryBundleUrl(piece.piece_id), { cache: 'no-store' });
      if (!response.ok) throw new Error('Impossibile leggere il brano selezionato');
      const bundle = await response.json();
      piece.parts = bundle.parts ?? [];
      piece.monodic = Boolean(bundle.monodic);
    } catch (error) {
      els.libraryNote.textContent = error.message;
      return;
    } finally { piece.loading = false; els.libraryOpen.disabled = false; }
  }
  if (els.libraryPiece.value !== piece?.piece_id) return;
  const parts = piece?.parts?.length ? piece.parts : [];
  els.libraryPart.replaceChildren(...parts.map((part) => new Option(part.name, part.id)));
  let rememberedPart;
  try { rememberedPart = localStorage.getItem(`choir-part:${piece?.piece_id}`); } catch (_) {}
  const preferredPart = parts.find(part => part.id === rememberedPart)
    ?? parts.find(part => part.id === state.runtime?.selectedPartId);
  if (preferredPart) els.libraryPart.value = preferredPart.id;
  const message = piece?.monodic ? 'Brano monodico: Soprano e Contralto usano la melodia scritta; Tenore e Basso la cantano un’ottava sotto.' : (!parts.length ? 'Nessuna parte vocale disponibile nel file MuseScore.' : '');
  els.libraryNote.hidden = !message;
  els.libraryNote.textContent = message;
}

function bindLibraryPicker() {
  els.piecePicker.addEventListener('click', openLibraryPicker);
  els.library.addEventListener('click', openLibraryPicker);
  els.libraryPiece.addEventListener('change', updateLibraryParts);
  els.libraryTitleSave.addEventListener('click', () => {
    const piece = state.library.find((item) => item.piece_id === els.libraryPiece.value);
    if (!piece) return;
    const title = els.libraryTitle.value.trim();
    try {
      if (title) localStorage.setItem(pieceTitleKey(piece.piece_id), title);
      else localStorage.removeItem(pieceTitleKey(piece.piece_id));
    } catch (_) { showToast('Il browser non può salvare il nome del brano.'); return; }
    populateLibraryPieces(piece.piece_id);
    els.libraryTitle.value = pieceDisplayTitle(piece);
    if (state.bundleManifest?.piece_id === piece.piece_id) els.pieceTitle.textContent = pieceDisplayTitle(piece);
    showToast(title ? 'Nome del brano salvato.' : 'Nome del brano ripristinato.');
  });
  els.libraryOpen.addEventListener('click', () => {
    const query = new URLSearchParams({ piece: els.libraryPiece.value });
    if (els.libraryPart.value) query.set('part', els.libraryPart.value);
    window.location.search = query.toString();
  });
}

function restartPractice() {
  state.clock.pause();
  clearPitchHistory();
  state.attemptActive = false;
  state.attempt = { voicedMs: 0, insideMs: 0 };
  state.lastSampleMs = null;
  if (els.resultDialog.open) els.resultDialog.close();
  seekToMeasure(0);
  updatePlaybackButton();
  render();
  showToast('Brano riportato all’inizio.');
}

async function loadPracticePiece(pieceId) {
  const bundleResponse = await fetch(libraryBundleUrl(pieceId), { cache: 'no-store' });
  if (!bundleResponse.ok) throw new Error('Manifest del brano non disponibile');
  const bundleManifest = await bundleResponse.json();
  try { localStorage.setItem(LAST_PRACTICE_PIECE_KEY, pieceId); } catch (_) { /* Optional convenience only. */ }
  const [scoreResponse, glyphResponse, backingResponse] = await Promise.all([
    fetch(bundleManifest.assets.score),
    fetch(bundleManifest.assets.glyph_map),
    fetch(bundleManifest.assets.audio_manifest),
  ]);
  if (!scoreResponse.ok || !glyphResponse.ok || !backingResponse.ok) throw new Error('Asset di prova non disponibili');
  const [payload, glyphMap, backingManifest] = await Promise.all([scoreResponse.json(), glyphResponse.json(), backingResponse.json()]);
  state.glyphMap = glyphMap;
  state.backingManifest = backingManifest;
  state.bundleManifest = bundleManifest;
  state.runtime = NormalizedScoreRuntime.fromNormalizedScore(bundleManifest.monodic ? monodicPracticePayload(payload) : payload);
  if (!bundleManifest || bundleManifest.score_version_id !== state.runtime.scoreVersionId) {
    throw new Error('Bundle musicale incoerente: versione score/runtime non corrispondente');
  }
  const approvalKey = `choir-approval:${bundleManifest.bundle_fingerprint}`;
  try {
    const approval = JSON.parse(localStorage.getItem(approvalKey));
    state.bundleApproved = approval?.bundleFingerprint === bundleManifest.bundle_fingerprint
      && approval?.scoreVersionId === bundleManifest.score_version_id
      && Boolean(approval?.reviewer)
      && bundleManifest.checks.every((check) => approval?.checks?.includes(check.id));
  } catch (_) { state.bundleApproved = false; }
  if (bundleManifest.published) state.bundleApproved = true;
  els.assetStatus.textContent = state.bundleApproved
    ? 'APPROVATO LOCALMENTE · bundle coerente'
    : 'PENDING REVIEW · apri la revisione admin dal menu ⋯';
  if (bundleManifest.local_source) state.bundleApproved = true;
  els.assetStatus.textContent = bundleManifest.local_source
    ? 'SORGENTE MUSESCORE LOCALE · derivati pronti per la prova'
    : els.assetStatus.textContent;
  if (bundleManifest.published) els.assetStatus.textContent = 'VERSIONE PUBBLICATA · bundle verificato';
  els.assetStatus.hidden = state.bundleApproved;
  if (!state.bundleApproved) els.assetStatus.textContent = 'Questo spartito è ancora in revisione.';
  const parts = vocalParts(state.runtime);
  els.partSelector.replaceChildren(...parts.map((part) => new Option(part.name, part.id)));
  let savedPart;
  try { savedPart = new URLSearchParams(window.location.search).get('part') ?? localStorage.getItem(`choir-part:${bundleManifest.piece_id ?? state.runtime.title}`); } catch (_) {}
  state.runtime.selectPart(parts.find((part) => part.id === savedPart)?.id ?? parts.find((part) => part.name.toLowerCase().includes('tenor'))?.id ?? parts[0]?.id);
  state.selectedVoiceIds = new Set([state.runtime.selectedPartId]);
  els.partSelector.value = state.runtime.selectedPartId;
  const transposeValues = RUNTIME_CONFIG.features?.transpose === false
    ? [0] : Array.from({ length: 25 }, (_, index) => index - 12);
  els.transpose.replaceChildren(...transposeValues.map((offset) => {
    const label = offset === 0 ? 'Originale' : Math.abs(offset) === 12
      ? `${offset > 0 ? '+' : '−'}1 ottava` : `${offset > 0 ? '+' : ''}${offset} semitoni`;
    return new Option(label, String(offset));
  }));
  restorePreferences();
  // Transposition is an in-session rehearsal choice.  Never carry it into a
  // newly opened piece, even if that piece has older saved preferences.
  state.transpose = 0;
  els.transpose.value = '0';
  restorePitchHistory();
  state.occurrenceMeasures = buildOccurrenceMeasures(state.runtime);
  const deepLink = new URLSearchParams(window.location.search), phraseStart = Number(deepLink.get('phraseStart') ?? NaN),
    phraseEnd = Number(deepLink.get('phraseEnd') ?? NaN);
  if (Number.isInteger(phraseStart) && Number.isInteger(phraseEnd) && phraseStart >= 0 && phraseEnd >= phraseStart
      && phraseEnd < state.occurrenceMeasures.length) {
    state.phrase = { start: phraseStart, end: phraseEnd }; state.autoLoop = true; state.attemptActive = false;
  }
  configureBacking();
  state.clock = new MediaPlaybackClock({ mediaElement: els.backingAudio, scoreRuntime: state.runtime });
  if (state.usesPreRenderedSpeed) state.clock.setPreRenderedSpeed(Number(els.playbackSpeed.value));
  else state.clock.setSpeed(Number(els.playbackSpeed.value));
  buildScoreGeometry(state.runtime.selectedPartId);
  buildFallbackScoreGeometry(state.runtime.selectedPartId);
  if (state.syncDebug) {
    els.syncDebugPanel = document.createElement('aside');
    els.syncDebugPanel.className = 'sync-debug';
    els.syncDebugPanel.setAttribute('aria-label', 'Diagnostica sincronizzazione');
    document.body.append(els.syncDebugPanel);
  }
  const libraryPiece = state.library.find((piece) => piece.piece_id === bundleManifest.piece_id);
  els.pieceTitle.textContent = libraryPiece ? pieceDisplayTitle(libraryPiece) : state.runtime.title.split('·')[0].trim();
  els.scorePartLabel.textContent = parts.find((part) => part.id === state.runtime.selectedPartId)?.name ?? 'Parte';
  const restoredMeasure = state.phrase?.start ?? state.selectedMeasureIndex;
  bindControls(); updateMicrophoneButton(); updateMetronomeControl(); seekToMeasure(restoredMeasure); updatePlaybackButton();
  if (state.phrase && deepLink.get('autoplayPhrase') === '1') setTimeout(() => { if (!state.clock.running) togglePlayback(); }, 250);
  window.addEventListener('message', (event) => {
    if (event.origin === location.origin && event.data?.type === 'choir-bundle-approval') location.reload();
  });
}

initialize().catch((error) => {
  els.pieceTitle.textContent = 'Prova non disponibile';
  els.scoreLoading.hidden = false;
  els.scoreLoading.textContent = error.message;
  console.error(error);
});
