const { NormalizedScoreRuntime, MediaPlaybackClock } = window.ChoirScore;
const { centsBetween, pitchToHz, pitchToName, pitchToY, timeToX, adjacentMelodicIntervals, measureSeekState, attemptResumeState, metronomePerformanceTime, delayedVisualBeat, rhythmGridLines, limitTimelineWindowToMeasures, smoothPitchBounds } = window.PracticeMath;
const { detectPitch, PitchSmoother, OctaveAwarePitchTracker, yinCandidates, decodeYinCandidatePath, mpmCandidates, decodeCrepeProbabilities } = window.ChoirPitch;
const PitchShared = window.ChoirPitchShared;
const FluidPitchTrail = window.ChoirFluidPitchTrail;
const { OneEuroFilter } = window.ChoirOneEuro;
const UiPreferences = window.ChoirUiPreferences;
const VocalFeedback = window.VocalFeedback;
const { MediaElementMixer, buildMediaPlaybackPlan } = window.ChoirMedia;
const RUNTIME_CONFIG = window.ChoirRuntimeConfig ?? Object.freeze({});
let microphoneCalibrationUI = null;
let echoCancellationUI = null;
let echoDiagnosticsUI = null;
const calibrationMediaLoops = new Map();
function restoreCalibrationMediaLoops() {
  for (const [media, loop] of calibrationMediaLoops) media.loop = loop;
  calibrationMediaLoops.clear();
}

function releaseAssetUrl(path) {
  if (!path || !RUNTIME_CONFIG.buildVersion) return path;
  const url = new URL(path, location.href);
  url.searchParams.set('v', RUNTIME_CONFIG.buildVersion);
  return url.href;
}

function libraryBundleUrl(pieceId) {
  const template = RUNTIME_CONFIG.bundleUrlTemplate;
  if (!template) throw new Error('Configurazione della libreria incompleta');
  return releaseAssetUrl(template.replace('{pieceId}', encodeURIComponent(pieceId)));
}

const bundleCache = new Map();
const pieceDataCache = new Map();
let practiceLoadGeneration = 0;
let controlsBound = false;
let prefetchedScoreKey = null;
let audioOutputControlsBound = false;

async function loadBundleManifest(pieceId) {
  if (!bundleCache.has(pieceId)) {
    bundleCache.set(pieceId, fetch(libraryBundleUrl(pieceId), { cache: 'force-cache' }).then((response) => {
      if (!response.ok) throw new Error('Manifest del brano non disponibile');
      return response.json();
    }).catch((error) => {
      bundleCache.delete(pieceId);
      throw error;
    }));
  }
  return bundleCache.get(pieceId);
}

async function loadPieceData(pieceId, bundleManifest) {
  const key = `${pieceId}:${bundleManifest.score_version_id}:${RUNTIME_CONFIG.buildVersion ?? ''}`;
  if (!pieceDataCache.has(key)) {
    const promise = Promise.all([
      fetch(releaseAssetUrl(bundleManifest.assets.score), { cache: 'force-cache' }),
      fetch(releaseAssetUrl(bundleManifest.assets.glyph_map), { cache: 'force-cache' }),
      fetch(releaseAssetUrl(bundleManifest.assets.audio_manifest), { cache: 'force-cache' }),
    ]).then(async ([scoreResponse, glyphResponse, backingResponse]) => {
      if (!scoreResponse.ok || !glyphResponse.ok || !backingResponse.ok) {
        throw new Error('Asset di prova non disponibili');
      }
      return Promise.all([scoreResponse.json(), glyphResponse.json(), backingResponse.json()]);
    }).catch((error) => {
      pieceDataCache.delete(key);
      throw error;
    });
    pieceDataCache.set(key, promise);
    while (pieceDataCache.size > 2) pieceDataCache.delete(pieceDataCache.keys().next().value);
  }
  return pieceDataCache.get(key);
}

function prefetchSelectedScore(bundleManifest, partId) {
  const source = bundleManifest.assets.continuous_scores?.[partId]
    ?? bundleManifest.assets.score_pages?.[partId]?.[0];
  const key = `${bundleManifest.piece_id}:${partId}:${RUNTIME_CONFIG.buildVersion ?? ''}`;
  if (!source || key === prefetchedScoreKey) return;
  prefetchedScoreKey = key;
  void fetch(releaseAssetUrl(source), { cache: 'force-cache', priority: 'low' })
    .then((response) => response.ok ? response.arrayBuffer() : null)
    .catch(() => { /* Prefetch is optional; normal loading remains authoritative. */ });
}

async function warmSelectedPiece(piece, partId) {
  if (!piece?.piece_id || !partId || piece.piece_id === state.bundleManifest?.piece_id) return;
  try {
    const bundleManifest = await loadBundleManifest(piece.piece_id);
    piece.bundleManifest = bundleManifest;
    prefetchSelectedScore(bundleManifest, partId);
    await loadPieceData(piece.piece_id, bundleManifest);
  } catch (_) { /* Opening the piece will surface actionable loading errors. */ }
}

const UI_CONFIG = Object.freeze({
  historyBeats: 4.5,
  futureBeats: 7.5,
  mobileHistoryBeats: 1.5,
  mobileFutureBeats: 2.5,
  centeredCents: 12,
  acceptableCents: 30,
  targetToleranceCents: 25,
  pitchNoteLabelOffsetPx: 44,
  pitchHeadGapPx: 12,
  pitchViewportResponseMs: 180,
  // Analysis follows a 60 Hz ceiling, but runs off the rendering thread.
  // On slower devices the one-in-flight rule naturally applies backpressure.
  pitchAnalysisIntervalMs: 1000 / 60,
});

const AUDIO_OUTPUT_SESSION_KEY = 'choir-audio-output:v1';
const PIANO_ROLL_DELAY_MAX_MS = 600;
const PIANO_ROLL_DELAY_DEFAULT_MS = 270;
const STANDARD_PLUME_ADVANCE_MS = 270;
const BLUETOOTH_PLUME_ADVANCE_MS = 320;
// With the default 270 ms piano-roll delay, leave a 110 ms audible lead.
const METRONOME_OFFSET_MS = 160;
const DEFAULT_METRONOME_VOLUME = 30;
const MIXER_DEFAULTS_VERSION = 2;
let practiceOrigin = new URLSearchParams(location.search).get('from') === 'repertorio' ? 'repertorio' : null;
const DEFAULT_OWN_VOICE_LEVEL = 1;
const DEFAULT_OTHER_VOICE_LEVEL = .5;
const DEFAULT_ACCOMPANIMENT_LEVEL = .4;

const els = Object.fromEntries([
  'transpose', 'transpose-value', 'settings-text-scale', 'settings-text-scale-value', 'settings-show-intervals',
  'voice-mixer-dialog', 'voice-mixer-options', 'voice-mixer-accompaniment', 'voice-mixer-accompaniment-enabled', 'voice-mixer-accompaniment-level', 'voice-mixer-accompaniment-value', 'voice-mixer-own', 'voice-mixer-all', 'voice-mixer-close',
  'settings-menu-wrap', 'settings-menu', 'settings-menu-repertoire', 'settings-menu-mixer', 'settings-menu-profile', 'settings-menu-recording', 'settings-menu-basic', 'settings-menu-advanced', 'settings-dialog', 'settings-heading', 'settings-basic-panel', 'settings-advanced-panel', 'settings-audio-output-standard', 'settings-audio-output-bluetooth', 'settings-audio-output-status', 'settings-audio-output-description', 'settings-v1-rms', 'settings-v1-rms-value', 'settings-v1-rms-description', 'settings-weak-voice-mode', 'settings-v1-fast-alpha', 'settings-v1-fast-alpha-value', 'settings-v1-slow-alpha', 'settings-v1-slow-alpha-value', 'settings-v1-median-frames', 'settings-v1-median-frames-value', 'settings-v1-plume-width', 'settings-v1-plume-width-value', 'settings-v1-plume-intensity', 'settings-v1-plume-intensity-value', 'settings-v1-plume-advance', 'settings-v1-plume-advance-value', 'settings-piano-roll-delay', 'settings-piano-roll-delay-value', 'settings-reset',
  'result-dialog', 'result-heading', 'result-text', 'result-progress', 'retry', 'result-resume', 'result-close',
  'cockpit-link', 'performance-section', 'performance-heading', 'performance-identity', 'performance-tabs', 'performance-status', 'performance-list',
  'personal-recording-dialog', 'personal-recording-current', 'personal-recording-current-summary', 'personal-recording-sharing', 'personal-recording-auto-best', 'personal-recording-auto-best-status', 'personal-recording-consent', 'personal-recording-headphones', 'personal-recording-storage-consent', 'personal-recording-analysis-consent', 'personal-recording-status', 'personal-recording-review', 'personal-recording-review-summary', 'personal-recording-preview', 'personal-recording-actions', 'personal-recording-start', 'personal-recording-replay', 'personal-recording-delete', 'personal-recording-save', 'personal-recording-discard', 'personal-recording-close', 'personal-recording-live', 'personal-recording-live-title', 'personal-recording-live-detail', 'personal-recording-stop-live', 'personal-recording-replay-audio',
  'monitoring-consent-dialog', 'monitoring-consent-check', 'monitoring-consent-status', 'monitoring-consent-accept', 'monitoring-consent-decline',
  'member-profile-dialog', 'member-profile-form', 'member-profile-first-name', 'member-profile-last-name', 'member-profile-status', 'member-profile-save', 'member-profile-cancel',
  'note-names',
  'piece-title', 'piece-picker', 'piece-picker-dialog', 'library-piece', 'library-part', 'library-note', 'library-open', 'library-score', 'library', 'restart-practice', 'restart-transport', 'ground-truth', 'ground-truth-dialog', 'ground-truth-status', 'ground-truth-count', 'ground-truth-start', 'ground-truth-approve', 'ground-truth-close', 'benchmark', 'benchmark-dialog', 'benchmark-scenario', 'benchmark-repeat', 'benchmark-setup', 'benchmark-setup-section', 'benchmark-status', 'benchmark-count', 'benchmark-primary-actions', 'benchmark-review-actions', 'benchmark-start', 'benchmark-listen', 'benchmark-accept', 'benchmark-discard', 'benchmark-close', 'benchmark-archive', 'benchmark-algorithm-label', 'benchmark-take-list', 'benchmark-take-summary', 'benchmark-open-analysis', 'benchmark-analysis', 'benchmark-analysis-back', 'benchmark-analysis-take', 'benchmark-analysis-name', 'benchmark-analysis-meta', 'benchmark-analysis-audio', 'benchmark-analysis-metrics', 'benchmark-analysis-v3-status', 'benchmark-analysis-v4-status', 'benchmark-analysis-v5-status', 'benchmark-analysis-roll', 'benchmark-analysis-time', 'benchmark-analysis-selection', 'benchmark-analysis-play-selection', 'benchmark-analysis-inspect', 'benchmark-analysis-help', 'benchmark-analysis-reset', 'benchmark-analysis-layer-v1', 'benchmark-analysis-layer-display', 'benchmark-analysis-layer-raw', 'benchmark-analysis-layer-audio', 'benchmark-analysis-layer-score', 'benchmark-recording', 'benchmark-live-scenario', 'benchmark-stop-live', 'neural-live', 'neural-live-status', 'neural-live-note', 'neural-live-timing', 'part-selector', 'playback-speed', 'accompaniment-mode', 'score-viewer-link', 'settings',
  'score-part-label', 'score-measure-label', 'score-viewport', 'score-sheet', 'score-image', 'score-cursor',
  'score-loading', 'score-pitch-divider', 'pitch-lane', 'pitch-fluid-layer', 'intonation-readout', 'live-note', 'live-cents', 'live-state', 'pitch-layer-v1', 'pitch-layer-crepe',
  'feedback-analyse', 'feedback-status', 'feedback-priorities', 'feedback-priority-list', 'feedback-score-image', 'feedback-note-card', 'feedback-note-name', 'feedback-note-meta', 'feedback-cent-chart', 'feedback-note-metrics', 'feedback-message', 'feedback-previous', 'feedback-next', 'feedback-original', 'feedback-corrected', 'feedback-strength', 'feedback-strength-value', 'feedback-playback-kind',
  'measure-counter', 'scoring-cue', 'previous-measure', 'toggle-playback', 'next-measure', 'show-feedback', 'volume', 'metronome-toggle', 'metronome-volume', 'backing-audio', 'toast', 'asset-status',
  'practice-shell', 'practice-toolbar', 'practice-transport', 'mobile-toolbar-toggle', 'mobile-transport-toggle',
].map((id) => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), document.getElementById(id)]));

const state = {
  lyricTextScale: UiPreferences.read(),
  showIntervals: false,
  transpose: 0,
  noteNames: 'italian',
  attemptActive: false,
  attemptStartedFromBeginning: true,
  attempt: { voicedMs: 0, insideMs: 0 },
  lastSampleMs: null,
  pendingAudioTime: null,
  runtime: null,
  clock: null,
  glyphMap: {},
  occurrenceMeasures: [],
  selectedMeasureIndex: 0,
  scoringStartBeat: 0,
  resumeCheckpointBeat: null,
  scorePage: 1,
  rafId: null,
  lastAnnouncedState: '',
  backingManifest: null,
  playbackPlan: null,
  voiceMixChangeToken: 0,
  voiceMixResumeRequested: false,
  transportSeekToken: 0,
  transportSeekResumeRequested: false,
  playbackMixer: new MediaElementMixer({ pitchWorkletUrl: 'pitch_shifter_worklet.js' }),
  voiceStemAudio: new Map(),
  selectedVoiceIds: new Set(),
  voiceLevels: new Map(),
  accompanimentEnabled: true,
  accompanimentLevel: 1,
  bundleManifest: null,
  bundleApproved: false,
  scoreGeometry: new Map(),
  fallbackScoreSlots: [],
  scoreLayout: 'paged',
  activeScoreSegment: null,
  pitchViewport: null,
  lastSnapshot: null,
  metronomeContext: null,
  lastMetronomeBeat: null,
  metronomeOffsetMs: METRONOME_OFFSET_MS,
  pianoRollDelayMs: PIANO_ROLL_DELAY_DEFAULT_MS,
  pianoRollVisualTime: new window.PracticeMath.VisualPlaybackTime(),
  pianoRollWaiting: false,
  lastPianoRollTime: null,
  audioOutputType: null,
  rememberedMetronomeVolume: DEFAULT_METRONOME_VOLUME,
  syncDebug: new URLSearchParams(window.location.search).has('syncDebug'),
  microphoneStatus: 'idle',
  microphoneFailureMessage: null,
  microphoneRequestGeneration: 0,
  ignoreAudioDeviceChangesUntil: 0,
  microphoneStream: null,
  microphoneContext: null,
  microphoneSource: null,
  microphoneAnalyser: null,
  microphoneSilencer: null,
  microphoneBuffer: null,
  pitchWorker: null,
  pitchWorkerInFlight: false,
  pitchWorkerTimeout: null,
  pitchWorkerDisabled: false,
  pitchAnalysisGeneration: 0,
  pitchAnalysisTimer: null,
  microphoneRms: 0,
  pitchSmoother: new window.ChoirPitch.HarmonicPitchSmoother(),
  displayPitchFilter: new OneEuroFilter(),
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
  performanceMe: null,
  monitoringConsent: null,
  monitoringConsentPromise: null,
  progressSubmitted: new Set(),
  personalRecording: { capture: null, pending: null, previewUrl: null, current: null,
    loading: false, saving: false, replay: null },
  automaticBestRecording: { enabled: null, loading: false, error: null, capture: null },
};

const V1_RMS_THRESHOLD = Object.freeze({ default: .000002, min: .000001, max: .01 });
const V1_TRACKER_DEFAULTS = Object.freeze({ fastAlpha: .65, slowAlpha: .65, medianWindowFrames: 3 });
const fluidTrailRenderer = new FluidPitchTrail.Renderer(els.pitchFluidLayer);
const mobileChrome = { mode: null, topCollapsed: false, bottomCollapsed: false };
let libraryMode = 'sing';
let libraryStep = 'mode';
let pendingVoiceAction = null;
const VOICE_NAMES = { soprano: 'Soprano', contralto: 'Contralto', tenore: 'Tenore', basso: 'Basso' };

function preferredVoice() {
  if (VOICE_NAMES[state.performanceMe?.preferredVoicePart]) return state.performanceMe.preferredVoicePart;
  try {
    const saved = localStorage.getItem(`choir-preferred-voice:${state.performanceMe?.member?.id || 'local'}`);
    return VOICE_NAMES[saved] ? saved : null;
  } catch (_) { return null; }
}

async function savePreferredVoice(voice) {
  if (!VOICE_NAMES[voice]) throw new Error('Scegli una parte vocale.');
  if (RUNTIME_CONFIG.mode === 'production') {
    const result = await PerformanceSharing.updateProfile({ preferredVoicePart: voice });
    state.performanceMe = { ...state.performanceMe, ...result };
  }
  try { localStorage.setItem(`choir-preferred-voice:${state.performanceMe?.member?.id || 'local'}`, voice); } catch (_) {}
}

function showLibraryStep(step) {
  libraryStep = step;
  const copy = { mode: ['Menù', ''], source: ['Scegli brano', ''],
    piece: [libraryMode === 'read' ? 'Mostra partiture' : 'Tutti i brani', 'Scegli dal catalogo.'], part: ['Qual è la tua parte?', 'Sceglila una volta, la ricorderemo.'] }[step];
  els.piecePickerDialog.dataset.step = step;
  for (const name of ['mode', 'source', 'piece', 'part']) document.getElementById(`library-${name}-step`).hidden = name !== step;
  document.getElementById('piece-picker-heading').textContent = copy[0];
  document.getElementById('library-step-hint').textContent = copy[1];
  document.getElementById('library-back').hidden = step === 'mode';
  document.querySelector('.home-brand').hidden = step !== 'mode';
  els.libraryOpen.hidden = libraryMode !== 'sing'; els.libraryScore.hidden = libraryMode !== 'read';
  document.getElementById('library-status').textContent = '';
  document.getElementById('piece-picker-heading').focus({ preventScroll: true });
  if (step === 'piece' || step === 'part') void updateLibraryParts();
}

function requirePreferredVoice(action) {
  if (preferredVoice()) { void action(); return; }
  pendingVoiceAction = action;
  if (!els.piecePickerDialog.open) openLibraryPicker('part');
  else showLibraryStep('part');
}

function preferredPartId(piece, fallback = null) {
  const voice = preferredVoice();
  return piece?.parts?.find(part => canonicalVoicePart(part.name, part.id) === voice)?.id || fallback;
}

function mobilePracticeMode() {
  if (!window.matchMedia('(max-width: 960px)').matches) return 'desktop';
  return window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
}

function updateMobileChrome() {
  const mode = mobilePracticeMode();
  if (mode !== mobileChrome.mode) {
    mobileChrome.mode = mode;
    mobileChrome.topCollapsed = false;
    mobileChrome.bottomCollapsed = mode === 'landscape';
  }
  els.practiceShell.classList.toggle('mobile-top-collapsed', mobileChrome.topCollapsed);
  els.practiceShell.classList.toggle('mobile-bottom-collapsed', mobileChrome.bottomCollapsed);
  els.mobileToolbarToggle.hidden = mode === 'desktop';
  els.mobileTransportToggle.hidden = mode !== 'landscape';
  els.mobileToolbarToggle.setAttribute('aria-expanded', String(!mobileChrome.topCollapsed));
  els.mobileTransportToggle.setAttribute('aria-expanded', String(!mobileChrome.bottomCollapsed));
  els.mobileToolbarToggle.setAttribute('aria-label', mobileChrome.topCollapsed ? 'Mostra i comandi superiori' : 'Nascondi i comandi superiori');
  els.mobileTransportToggle.setAttribute('aria-label', mobileChrome.bottomCollapsed ? 'Mostra i controlli di riproduzione' : 'Nascondi i controlli di riproduzione');
  els.mobileToolbarToggle.title = els.mobileToolbarToggle.getAttribute('aria-label');
  els.mobileTransportToggle.title = els.mobileTransportToggle.getAttribute('aria-label');
  els.mobileToolbarToggle.firstElementChild.classList.toggle('is-down', mobileChrome.topCollapsed);
  els.mobileTransportToggle.firstElementChild.classList.toggle('is-down', !mobileChrome.bottomCollapsed);
}

function redrawAfterChromeChange() {
  state.activeScoreSegment = null;
  requestAnimationFrame(() => {
    if (state.runtime) render();
  });
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
  return Number(value).toFixed(value < .00001 ? 6 : value < .0001 ? 5 : 4).replace('.', ',');
}

function readAudioOutputPreference() {
  try {
    const preference = JSON.parse(sessionStorage.getItem(AUDIO_OUTPUT_SESSION_KEY));
    const validType = preference?.type === 'bluetooth' || preference?.type === 'standard';
    const confirmedAt = Number(preference?.confirmedAt);
    if (!validType || !Number.isFinite(confirmedAt)) return null;
    return { type: preference.type, confirmedAt };
  } catch (_) { return null; }
}

function restoreAudioOutputPreference() {
  const preference = readAudioOutputPreference();
  state.audioOutputType = preference?.type ?? 'standard';
  return true;
}

function saveAudioOutputPreference(type) {
  const preference = { type, confirmedAt: Date.now() };
  try { sessionStorage.setItem(AUDIO_OUTPUT_SESSION_KEY, JSON.stringify(preference)); } catch (_) {}
  state.audioOutputType = type;
}

function updateDetectorSettingsUi() {
  updateListeningSettingsUi();
  const calibration = microphoneCalibrationUI?.activeSettings();
  const effectiveNote = document.getElementById('settings-calibration-effective');
  effectiveNote.hidden = !calibration;
  effectiveNote.textContent = calibration ? `Calibrazione attiva: ${formatRmsThreshold(calibration.rmsThreshold)} RMS. Una modifica manuale la disattiva.` : '';
  els.settingsAudioOutputStandard.checked = state.audioOutputType === 'standard';
  els.settingsAudioOutputBluetooth.checked = state.audioOutputType === 'bluetooth';
  els.settingsAudioOutputStatus.textContent = state.audioOutputType === 'bluetooth'
    ? 'Bluetooth' : 'Cavo o dispositivo';
  els.settingsTextScale.value = String(Math.round(state.lyricTextScale * 100));
  els.settingsTextScaleValue.textContent = `${Math.round(state.lyricTextScale * 100)}%`;
  els.settingsShowIntervals.checked = state.showIntervals;
  const threshold = state.detectorSettings.rmsThreshold;
  els.settingsV1Rms.value = String(rmsSliderFromThreshold(threshold));
  els.settingsV1RmsValue.textContent = `${formatRmsThreshold(threshold)} RMS`;
  els.settingsWeakVoiceMode.checked = state.detectorSettings.weakVoiceMode;
  els.settingsV1RmsDescription.textContent = state.detectorSettings.weakVoiceMode
    ? 'Voce debole: questa è l’unica soglia legata al volume; periodicità e confidenza usano limiti più permissivi.'
    : threshold < V1_RMS_THRESHOLD.default
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
  els.settingsV1PlumeIntensity.value = String(Math.round(state.plumeSettings.intensity * 100));
  els.settingsV1PlumeIntensityValue.textContent = `${Math.round(state.plumeSettings.intensity * 100)}%`;
  els.settingsV1PlumeAdvance.value = String(state.plumeSettings.timeAdvanceMs);
  els.settingsV1PlumeAdvanceValue.textContent = `${state.plumeSettings.timeAdvanceMs} ms`;
  els.settingsPianoRollDelay.value = String(state.pianoRollDelayMs);
  els.settingsPianoRollDelayValue.textContent = `${state.pianoRollDelayMs} ms`;
}

function updateListeningSettingsUi() {
  const speakers = document.getElementById('echo-enabled').checked;
  document.getElementById('settings-listening-headphones').checked = !speakers;
  document.getElementById('settings-listening-speakers').checked = speakers;
  document.getElementById('settings-listening-hint').textContent = speakers
    ? 'Volume del dispositivo consigliato: 50%. Usa i tasti del dispositivo.'
    : 'Indossa le cuffie prima di calibrare.';
  document.getElementById('settings-calibration-hint').textContent = speakers
    ? 'Circa 30 secondi per voce e riduzione del rientro.'
    : 'Una guida di circa 25 secondi, poi puoi cantare.';
  microphoneCalibrationUI?.refresh();
}

function applyLiveTrackerSettings() {
  const recognition = activeRecognitionSettings();
  state.pitchSmoother.configure({ ...state.detectorSettings, ...recognition });
}

function activeRecognitionSettings() {
  const recognition = { ...PitchShared.recognitionSettings(state.detectorSettings), ...microphoneCalibrationUI?.activeSettings() };
  const residualFloor = echoCancellationUI?.detectionFloor() || 0;
  if (residualFloor > recognition.rmsThreshold) {
    recognition.levelConfidenceFloor ??= recognition.rmsThreshold < .001 ? .36 : 0;
    recognition.rmsThreshold = residualFloor;
  }
  return recognition;
}

function closeSettingsMenu() {
  els.settingsMenu.hidden = true;
  els.settings.setAttribute('aria-expanded', 'false');
}

function updatePracticeReturn() {
  const label = practiceOrigin === 'repertorio' ? 'Repertorio' : 'Menù';
  document.getElementById('exit-practice').textContent = label;
  document.getElementById('practice-return').textContent = label;
}

function practiceReturnQuery() {
  const query = new URLSearchParams({ piece: state.bundleManifest.piece_id, part: state.runtime.selectedPartId });
  const beat = playbackSnapshot().beat;
  query.set('resume', String(Math.round(beat * 1000) / 1000));
  query.set('entry', String(state.scoringStartBeat || 0));
  if (practiceOrigin) query.set('from', practiceOrigin);
  return query;
}

function restorePracticePosition(query) {
  if (!query.has('resume')) return;
  const value = Number(query.get('resume'));
  if (!Number.isFinite(value) || value < 0) return;
  const beat = Math.min(totalBeats(), value);
  const entryValue = query.has('entry') ? Number(query.get('entry')) : beat;
  state.scoringStartBeat = Number.isFinite(entryValue) ? Math.max(0, Math.min(totalBeats(), entryValue)) : beat;
  state.selectedMeasureIndex = measureIndexAt(state.scoringStartBeat);
  state.attemptStartedFromBeginning = beat === 0;
  state.attemptActive = false;
  queueAudioSeek(state.runtime.secondsAtBeat(beat));
  els.scoringCue.textContent = `In pausa · battuta ${state.occurrenceMeasures[measureIndexAt(beat)]?.number ?? 1}`;
  updatePlaybackButton(); render();
}

function canNavigatePractice() {
  if (state.personalRecording.capture || state.personalRecording.pending
    || state.benchmark.capture || state.groundTruth.capture
    || echoDiagnosticsUI?.isBusy() || echoDiagnosticsUI?.hasPending()
    || microphoneCalibrationUI?.isBusy() || echoCancellationUI?.isBusy()) {
    showToast('Termina la registrazione o scegli se salvarla o scartarla prima di uscire.');
    return false;
  }
  return true;
}

async function navigatePractice(href) {
  if (!canNavigatePractice()) return;
  if (state.automaticBestRecording.capture) await stopAutomaticBestCapture({ discard: true });
  await pausePracticeForNonExercise();
  savePitchHistory();
  window.location.assign(href);
}

function returnFromPractice() {
  if (practiceOrigin === 'repertorio') void navigatePractice('repertorio.html');
  else openLibraryPicker();
}

function toggleSettingsMenu() {
  const opening = els.settingsMenu.hidden;
  if (opening) void pausePracticeForNonExercise({ preserveCalibration: true });
  els.settingsMenu.hidden = !opening;
  els.settings.setAttribute('aria-expanded', String(opening));
  if (opening) els.settingsMenu.querySelector('[role="menuitem"]').focus();
}

function openDetectorSettings(mode = 'basic') {
  echoCancellationUI?.checkpoint('settings-open');
  void pausePracticeForNonExercise({ preserveCalibration: true });
  const advanced = mode === 'advanced';
  closeSettingsMenu();
  restoreAudioOutputPreference();
  updateDetectorSettingsUi();
  microphoneCalibrationUI?.refresh(); echoCancellationUI?.refresh();
  els.settingsBasicPanel.hidden = advanced;
  els.settingsAdvancedPanel.hidden = !advanced;
  els.settingsHeading.textContent = advanced ? 'Impostazioni avanzate' : 'Impostazioni';
  if (!els.settingsDialog.open) els.settingsDialog.showModal();
}

function requestAudioOutputForEntry(action) {
  restoreAudioOutputPreference();
  void action();
}

function bindAudioOutputControls() {
  if (audioOutputControlsBound) return;
  audioOutputControlsBound = true;
  for (const mode of ['headphones', 'speakers']) {
    document.getElementById(`settings-listening-${mode}`).addEventListener('change', event => {
      if (!event.target.checked) return;
      const toggle = document.getElementById('echo-enabled');
      if (toggle.checked !== (mode === 'speakers')) toggle.click();
      updateListeningSettingsUi();
    });
  }
  document.getElementById('echo-enabled').addEventListener('change', updateListeningSettingsUi);
  for (const control of [els.settingsAudioOutputStandard, els.settingsAudioOutputBluetooth]) {
    control.addEventListener('change', () => {
      if (!control.checked) return;
      saveAudioOutputPreference(control.value);
      state.plumeSettings.timeAdvanceMs = control.value === 'bluetooth'
        ? BLUETOOTH_PLUME_ADVANCE_MS : STANDARD_PLUME_ADVANCE_MS;
      updateDetectorSettingsUi();
      if (state.runtime) savePreferences();
      else { try { saveGlobalDetectorPreferences(); } catch (_) {} }
      if (state.runtime) render();
      showToast(control.value === 'bluetooth'
        ? 'Connessione Bluetooth selezionata.'
        : 'Connessione via cavo o dispositivo selezionata.');
    });
  }
  els.settingsDialog.addEventListener('click', (event) => {
    const selected = event.target.closest('.setting-info');
    const shouldOpen = selected && !selected.classList.contains('is-open');
    els.settingsDialog.querySelectorAll('.setting-info.is-open').forEach((button) => button.classList.remove('is-open'));
    if (shouldOpen) selected.classList.add('is-open');
  });
  els.settingsDialog.addEventListener('close', () => {
    els.settingsDialog.querySelectorAll('.setting-info.is-open').forEach((button) => button.classList.remove('is-open'));
  });
  els.settingsDialog.addEventListener('click', closeSettingsFromBackdrop);
  navigator.mediaDevices?.addEventListener('devicechange', () => {
    if (Date.now() < state.ignoreAudioDeviceChangesUntil) return;
    microphoneCalibrationUI?.inputChanged();
    echoCancellationUI?.invalidate('devicechange');
    restoreAudioOutputPreference();
    updateDetectorSettingsUi();
    showToast('Dispositivo audio cambiato: controlla la connessione e ripeti Calibra audio.');
  });
}

function closeDialogFromBackdrop(dialog, event) {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  const outsideDialog = event.clientX < rect.left || event.clientX > rect.right
    || event.clientY < rect.top || event.clientY > rect.bottom;
  if (outsideDialog) dialog.close();
}

function closeSettingsFromBackdrop(event) {
  closeDialogFromBackdrop(els.settingsDialog, event);
}

function closeVoiceMixerFromBackdrop(event) {
  closeDialogFromBackdrop(els.voiceMixerDialog, event);
}

function normalizeSlug(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

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
  return proposedPieceTitle(piece);
}

function populateLibraryPieces(selectedPieceId) {
  const sortedPieces = [...state.library].sort((left, right) => pieceDisplayTitle(left)
    .localeCompare(pieceDisplayTitle(right), 'it', { sensitivity: 'base' }));
  els.libraryPiece.replaceChildren(...sortedPieces.map((piece) => new Option(pieceDisplayTitle(piece), piece.piece_id)));
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

const TONAL_ROLE_COLOURS = Object.freeze({ tonic: '#a8b98b', fifth: '#4f86b5' });

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
        writtenMeasureId: occurrence.writtenMeasureId,
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
    const item = { id: measure.id, writtenMeasureId: measure.id, number: measure.number, startBeat: beat, endBeat: beat + duration, timeSignatureNumerator: measure.timeSignatureNumerator, timeSignatureDenominator: measure.timeSignatureDenominator, beatOffset: measure.beatOffset ?? 0 };
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
  if (state.scoreLayout === 'continuous') return null;
  return event ? state.scoreGeometry.get(event.sourceEventId) ?? null : null;
}

function fallbackScorePosition(beat) {
  const occurrenceIndex = measureIndexAt(beat);
  const measure = state.occurrenceMeasures[occurrenceIndex];
  const writtenIndex = measure?.writtenMeasureId
    ? state.runtime.measures.findIndex((candidate) => candidate.id === measure.writtenMeasureId)
    : occurrenceIndex;
  const slotIndex = writtenIndex >= 0 ? writtenIndex : occurrenceIndex;
  const defaultMeasureWidths = [[13, 32], [32, 55], [55, 73], [73, 93]];
  const pages = state.bundleManifest?.assets?.score_pages?.[state.runtime.selectedPartId] ?? [];
  const slot = state.fallbackScoreSlots[slotIndex] ?? (pages.length ? (() => {
    const [startX, endX] = defaultMeasureWidths[slotIndex % defaultMeasureWidths.length];
    return { page: Math.min(pages.length, Math.floor(slotIndex / defaultMeasureWidths.length) + 1),
      systemId: `estimated-p${Math.floor(slotIndex / defaultMeasureWidths.length) + 1}`, startX, endX,
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
  const continuousSource = state.bundleManifest.assets.continuous_scores?.[state.runtime.selectedPartId];
  const pages = state.bundleManifest.assets.score_pages?.[state.runtime.selectedPartId] ?? [];
  const rawSource = continuousSource ?? pages?.[Math.max(0, Math.min(pages.length - 1, page - 1))];
  if (!rawSource) { els.scoreLoading.hidden = false; els.scoreLoading.textContent = 'Pagina spartito non disponibile'; return; }
  const source = releaseAssetUrl(rawSource);
  const layout = continuousSource ? 'continuous' : 'paged';
  if (state.scoreLayout !== layout) state.activeScoreSegment = null;
  state.scoreLayout = layout;
  els.scoreSheet.classList.toggle('is-continuous', layout === 'continuous');
  els.scoreImage.dataset.layout = layout;
  if (els.scoreImage.getAttribute('src') === source) return;
  els.scoreLoading.hidden = false;
  state.activeScoreSegment = null;
  els.scoreImage.src = source;
  els.scoreImage.alt = `Spartito: ${part?.name ?? 'parte selezionata'}`;
}

function voiceStemUrl(filename) {
  const path = `${state.bundleManifest.assets.audio_root}/${filename}`;
  return releaseAssetUrl(path);
}

function pauseVoiceStems() {
  for (const audio of state.voiceStemAudio.values()) audio.pause();
}

function discardVoiceStems() {
  for (const audio of state.voiceStemAudio.values()) state.playbackMixer.release(audio);
  state.voiceStemAudio.clear();
}

function voiceLevel(partId) {
  const level = state.voiceLevels.get(partId);
  return Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 1;
}

function mixNormalization() {
  if (state.playbackPlan?.kind === 'full-mix') return 1;
  const accompanimentCount = state.accompanimentEnabled && state.backingManifest?.accompaniment_file ? 1 : 0;
  const voiceCount = (state.playbackPlan?.voiceStems?.length ?? state.voiceStemAudio.size)
    + (state.playbackPlan?.masterPartId ? 1 : 0);
  return 1 / Math.sqrt(Math.max(1, voiceCount + accompanimentCount));
}

function syncVoiceStemLevels() {
  const masterLevel = Number(els.volume.value) / 100;
  const normalization = mixNormalization();
  for (const [partId, audio] of state.voiceStemAudio.entries()) {
    state.playbackMixer.setLevel(audio, masterLevel * voiceLevel(partId) * normalization);
    audio.playbackRate = Number(els.playbackSpeed.value);
    audio.preservesPitch = true;
    audio.webkitPreservesPitch = true;
  }
}

function syncBackingLevel() {
  const silentClock = state.playbackPlan?.silentMaster ?? (Object.keys(state.backingManifest?.voice_stems ?? {}).length > 0
    && !state.backingManifest?.accompaniment_file);
  const fullMix = state.playbackPlan?.kind === 'full-mix';
  const masterPartId = state.playbackPlan?.masterPartId;
  const channelLevel = fullMix ? 1 : masterPartId ? voiceLevel(masterPartId) : state.accompanimentLevel;
  const level = Number(els.volume.value) / 100 * channelLevel * mixNormalization();
  state.playbackMixer.setLevel(els.backingAudio, level, {
    forceMuted: silentClock || (!fullMix && !masterPartId && !state.accompanimentEnabled),
  });
}

function canUseFullMix() {
  const ids = Object.keys(state.backingManifest?.voice_stems ?? {});
  const hasAccompaniment = Boolean(state.backingManifest?.accompaniment_file);
  return Boolean(state.backingManifest?.full_mix_file)
    && (!hasAccompaniment || (state.accompanimentEnabled && state.accompanimentLevel >= .999))
    && ids.length > 0 && ids.every((partId) => state.selectedVoiceIds.has(partId) && voiceLevel(partId) >= .999);
}

function configureVoiceStems() {
  discardVoiceStems();
  const stems = state.backingManifest?.voice_stems ?? {};
  const mixerAvailable = Object.keys(stems).length > 0;
  els.accompanimentMode.disabled = !mixerAvailable;
  const plannedStems = state.playbackPlan?.voiceStems
    ?? [...state.selectedVoiceIds].filter((partId) => stems[partId]).map((partId) => ({ partId, file: stems[partId] }));
  for (const { partId, file } of plannedStems) {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = voiceStemUrl(file);
    audio.playsInline = true;
    state.voiceStemAudio.set(partId, audio);
  }
  syncVoiceStemLevels();
  els.accompanimentMode.textContent = 'Mixer';
  els.accompanimentMode.title = mixerAvailable
    ? 'Scegli quali parti vocali ascoltare' : 'Questo brano dispone soltanto del mix audio completo';
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
  const hasAccompaniment = Boolean(state.backingManifest?.accompaniment_file);
  const accompanimentActive = hasAccompaniment && state.accompanimentEnabled;
  els.voiceMixerAccompaniment.hidden = !hasAccompaniment;
  els.voiceMixerAccompanimentEnabled.disabled = !hasAccompaniment;
  els.voiceMixerAccompanimentEnabled.textContent = accompanimentActive ? 'Mute' : 'Unmute';
  els.voiceMixerAccompanimentEnabled.setAttribute('aria-pressed', String(!accompanimentActive));
  els.voiceMixerAccompaniment.classList.toggle('is-muted', !accompanimentActive);
  els.voiceMixerAccompanimentLevel.value = String(Math.round(state.accompanimentLevel * 100));
  els.voiceMixerAccompanimentLevel.disabled = !accompanimentActive;
  els.voiceMixerAccompanimentValue.value = `${Math.round(state.accompanimentLevel * 100)}%`;
  els.voiceMixerOptions.replaceChildren(...parts.map((part) => {
    const active = state.selectedVoiceIds.has(part.id);
    const row = document.createElement('section'); row.className = 'mixer-channel';
    row.classList.toggle('is-muted', !active);
    row.setAttribute('aria-label', `Canale ${part.name}`);
    const heading = document.createElement('div'); heading.className = 'mixer-channel-heading';
    const name = document.createElement('strong'); name.textContent = part.name;
    const detail = document.createElement('span'); detail.textContent = part.id === state.runtime.selectedPartId ? 'mia parte' : 'voce';
    heading.append(name, detail);
    const output = document.createElement('output');
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = String(Math.round(voiceLevel(part.id) * 100));
    slider.setAttribute('aria-label', `Volume ${part.name}`); slider.disabled = !active;
    output.value = `${slider.value}%`;
    const fader = document.createElement('div'); fader.className = 'mixer-fader'; fader.append(slider);
    const mute = document.createElement('button'); mute.type = 'button'; mute.className = 'mixer-mute';
    mute.textContent = active ? 'Mute' : 'Unmute'; mute.setAttribute('aria-pressed', String(!active));
    mute.setAttribute('aria-label', `${active ? 'Silenzia' : 'Riattiva'} ${part.name}`);
    mute.addEventListener('click', () => {
      const next = new Set(state.selectedVoiceIds);
      if (next.has(part.id)) next.delete(part.id); else next.add(part.id);
      void applyVoiceSelection(next);
      savePreferences();
    });
    slider.addEventListener('input', () => {
      state.voiceLevels.set(part.id, Number(slider.value) / 100); output.value = `${slider.value}%`;
      if (state.playbackPlan?.kind !== 'full-mix') {
        syncVoiceStemLevels();
        if (state.playbackPlan?.masterPartId === part.id) syncBackingLevel();
      }
    });
    slider.addEventListener('change', () => { void applyVoiceSelection(state.selectedVoiceIds); savePreferences(); });
    row.append(heading, output, fader, mute);
    return row;
  }));
}

function openVoiceMixer() {
  closeSettingsMenu();
  // Opening the mixer is an intentional pause point. Keep this flag so
  // applying a new routing resumes the same musical instant afterwards.
  if (state.clock.running) {
    state.voiceMixResumeRequested = true;
    state.clock.pause();
    void stopAutomaticBestCapture({ discard: true });
    void releaseMicrophoneIfUnused();
    updatePlaybackButton();
    render();
  }
  renderVoiceMixer();
  if (!els.voiceMixerDialog.open) els.voiceMixerDialog.showModal();
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
  state.playbackPlan = buildMediaPlaybackPlan({
    mixFile: speedFile ?? state.backingManifest.full_mix_file ?? mix.file,
    accompanimentFile: state.backingManifest.accompaniment_file,
    accompanimentEnabled: state.accompanimentEnabled,
    voiceStems: state.backingManifest.voice_stems,
    selectedVoiceIds: state.selectedVoiceIds,
    preferFullMix: canUseFullMix(),
  });
  const baseFile = state.playbackPlan.masterFile;
  if (!baseFile) {
    discardVoiceStems();
    els.backingAudio.pause();
    els.backingAudio.removeAttribute('src');
    els.backingAudio.load();
    els.togglePlayback.disabled = true;
    return;
  }
  const source = voiceStemUrl(baseFile);
  if (els.backingAudio.getAttribute('src') !== source) {
    els.backingAudio.src = source;
    els.backingAudio.load();
  }
  els.togglePlayback.disabled = false;
  syncBackingLevel();
  els.backingAudio.playbackRate = state.usesPreRenderedSpeed ? 1 : speed;
  els.backingAudio.preservesPitch = true;
  els.backingAudio.webkitPreservesPitch = true;
  state.playbackMixer.setTranspose(state.transpose);
  configureVoiceStems();
}

function waitForMediaReady(media, minimumReadyState = 1, timeoutMs = 8000) {
  if (!media || !media.getAttribute('src') || media.readyState >= minimumReadyState || media.error) return Promise.resolve();
  return new Promise((resolve) => {
    const eventName = minimumReadyState >= 3 ? 'canplay' : 'loadedmetadata';
    let timeout;
    const finish = () => {
      clearTimeout(timeout);
      media.removeEventListener(eventName, finish);
      media.removeEventListener('error', finish);
      resolve();
    };
    media.addEventListener(eventName, finish, { once: true });
    media.addEventListener('error', finish, { once: true });
    timeout = setTimeout(finish, timeoutMs);
    media.load();
  });
}

function waitForMediaSeek(media, timeoutMs = 2000) {
  if (!media?.seeking) return Promise.resolve();
  return new Promise((resolve) => {
    let timeout;
    const finish = () => {
      clearTimeout(timeout);
      media.removeEventListener('seeked', finish);
      media.removeEventListener('error', finish);
      resolve();
    };
    media.addEventListener('seeked', finish, { once: true });
    media.addEventListener('error', finish, { once: true });
    timeout = setTimeout(finish, timeoutMs);
  });
}

async function applyVoiceSelection(selectedVoiceIds) {
  const changeToken = ++state.voiceMixChangeToken;
  const snapshot = playbackSnapshot();
  const shouldResume = state.clock.running || state.voiceMixResumeRequested;
  state.voiceMixResumeRequested = shouldResume;
  if (state.clock.running) {
    state.clock.pause();
    void stopAutomaticBestCapture({ discard: true });
    updatePlaybackButton();
    await releaseMicrophoneIfUnused();
  }
  state.selectedVoiceIds = new Set(selectedVoiceIds);
  configureBacking();
  renderVoiceMixer();
  if (state.usesPreRenderedSpeed) state.clock.setPreRenderedSpeed(Number(els.playbackSpeed.value));
  else state.clock.setSpeed(Number(els.playbackSpeed.value));

  const media = [els.backingAudio, ...state.voiceStemAudio.values()];
  await Promise.all(media.map((item) => waitForMediaReady(item, shouldResume ? 3 : 1)));
  if (changeToken !== state.voiceMixChangeToken) return;
  if (els.backingAudio.readyState >= 1) {
    state.clock.seekPerformanceTime(snapshot.performanceTime);
    await waitForMediaSeek(els.backingAudio);
    state.pendingAudioTime = null;
  } else {
    state.pendingAudioTime = snapshot.performanceTime;
  }
  for (const audio of state.voiceStemAudio.values()) {
    if (audio.readyState >= 1) audio.currentTime = els.backingAudio.currentTime;
  }

  if (shouldResume) {
    try {
      if (state.microphoneStatus !== 'active') await toggleMicrophone();
      await state.playbackMixer.resume(media);
      syncBackingLevel();
      syncVoiceStemLevels();
      await state.clock.play();
    } catch (error) {
      console.error('Voice mix change failed', error);
      showToast('Cambio del mix non riuscito. Riprova.');
    }
  }
  state.voiceMixResumeRequested = false;
  updatePlaybackButton();
  render();
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
    return { x: points[0], y1: points[1], y2: points[3], strokeWidth: Number(line.getAttribute('stroke-width')) || 0 };
  }).filter((line) => line.x != null && line.y1 != null && line.y2 != null);
  const musicalSymbols = [...document.querySelectorAll('.Note, .Rest')].map((symbol) => {
    const match = (symbol.getAttribute('d') ?? '').match(/^\s*M\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)/);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
  }).filter((symbol) => symbol && Number.isFinite(symbol.x) && Number.isFinite(symbol.y));
  // MuseScore draws repeat/final boundaries as multiple nearby polylines. Treat
  // those strokes as one semantic boundary before deriving measure slots.
  const collapseBarlineComponents = (lines) => {
    const boundaries = [];
    lines.sort((a, b) => a.x - b.x).forEach((line) => {
      const previous = boundaries.at(-1);
      const componentGap = previous
        ? Math.max(40, Math.max(previous.strokeWidth, line.strokeWidth) * 2)
        : 0;
      if (previous && line.x - previous.x <= componentGap) {
        previous.x = Math.max(previous.x, line.x);
        previous.strokeWidth = Math.max(previous.strokeWidth, line.strokeWidth);
      } else {
        boundaries.push({ ...line });
      }
    });
    return boundaries.map((line) => line.x);
  };
  const minimumMeasureWidth = Math.max(40, width * .001);
  const slots = [];
  for (let offset = 0, systemIndex = 0; offset + 4 < staffLines.length; offset += 5, systemIndex += 1) {
    const lines = staffLines.slice(offset, offset + 5);
    const startX = Math.min(...lines.map((line) => line.x1));
    const endX = Math.max(...lines.map((line) => line.x2));
    const centerY = lines.reduce((sum, line) => sum + line.y, 0) / lines.length;
    const barXs = collapseBarlineComponents(barLines.filter(
      (line) => Math.abs((line.y1 + line.y2) / 2 - centerY) < 420
        && line.x > startX + 20 && line.x <= endX + 25,
    ));
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
      if (right - visualLeft > minimumMeasureWidth) slots.push({ page, systemId: `fallback-p${page}-s${systemIndex}`, startX: visualLeft / width * 100,
        endX: right / width * 100, y_percent: centerY / height * 100, systemCenterY: centerY / height * 100 });
      left = right;
    }
  }
  return slots;
}

async function buildFallbackScoreGeometry(partId) {
  const bundleManifest = state.bundleManifest;
  const continuousSource = state.bundleManifest.assets.continuous_scores?.[partId];
  const pages = state.bundleManifest.assets.score_pages?.[partId] ?? [];
  const sources = continuousSource ? [continuousSource] : pages;
  state.scoreLayout = continuousSource ? 'continuous' : 'paged';
  els.scoreSheet.classList.toggle('is-continuous', Boolean(continuousSource));
  if (!sources?.length) { state.fallbackScoreSlots = []; return; }
  try {
    const contents = await Promise.all(sources.map(async (page) => {
      const response = await fetch(releaseAssetUrl(page), { cache: 'force-cache' });
      if (!response.ok) throw new Error(`pagina spartito non disponibile (${response.status})`);
      return response.text();
    }));
    if (state.bundleManifest !== bundleManifest || state.runtime.selectedPartId !== partId) return;
    state.fallbackScoreSlots = contents.flatMap((svg, index) => scorePageFallbackSlots(svg, index + 1));
    if (!state.scoreGeometry.size && state.fallbackScoreSlots.length !== state.runtime.measures.length) {
      console.warn('Mappa di fallback spartito incompleta', { slots: state.fallbackScoreSlots.length, writtenMeasures: state.runtime.measures.length });
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
  const page = state.scoreLayout === 'continuous'
    ? 1 : activeGlyph?.page ?? Math.min(3, Math.floor(measureIndexAt(beat) / 7) + 1);
  if (page !== state.scorePage) state.scorePage = page;
  loadScoreImage(page);
  if (!activeGlyph) {
    // Without a per-note SVG map, expose the first staff system of the
    // selected vocal part rather than the large blank top margin of the page.
    els.scoreSheet.style.transform = 'translate(0, -13%)';
    els.scoreCursor.style.display = 'none';
    return;
  }
  const nextEvent = glyph && state.runtime.targetEvents.find((candidate) => {
    const candidateGlyph = sourceGlyph(candidate);
    return candidate.onsetBeat >= event.onsetBeat + event.durationBeats - 0.001 && candidateGlyph?.systemId === glyph.systemId;
  });
  const candidateNextGlyph = sourceGlyph(nextEvent);
  const nextGlyph = glyph && candidateNextGlyph?.x_percent >= glyph.x_percent ? candidateNextGlyph : null;
  const progress = Math.max(0, Math.min(1, (beat - event.onsetBeat) / Math.max(event.durationBeats, .01)));
  const x = glyph ? (nextGlyph ? glyph.x_percent + (nextGlyph.x_percent - glyph.x_percent) * progress : glyph.x_percent) : fallback.x_percent;
  // Read layout before mutating cursor styles. The previous order forced the
  // browser to synchronously recalculate layout on every animation frame.
  const imageHeight = els.scoreImage.getBoundingClientRect().height;
  const viewportHeight = els.scoreViewport.clientHeight;
  const sheetWidth = els.scoreSheet.getBoundingClientRect().width;
  const viewportWidth = els.scoreViewport.clientWidth;
  if (!imageHeight || !sheetWidth || !viewportWidth) return;
  els.scoreCursor.style.display = '';
  els.scoreCursor.style.left = `${x}%`;
  els.scoreCursor.style.top = `${activeGlyph.y_percent}%`;
  // Keep the current-time bar visible across the whole score window, rather
  // than limiting it to a small marker around the active note.
  els.scoreCursor.style.height = `${Math.max(86, viewportHeight)}px`;
  const systemY = imageHeight * activeGlyph.systemCenterY / 100;
  if (state.scoreLayout === 'continuous') {
    const cursorAnchor = Math.max(72, Math.min(viewportWidth - 48, viewportWidth * .38));
    const scoreX = sheetWidth * x / 100;
    const offsetX = Math.max(viewportWidth - sheetWidth, Math.min(0, cursorAnchor - scoreX));
    const offsetY = Math.max(viewportHeight - imageHeight, Math.min(0, viewportHeight * .52 - systemY));
    els.scoreSheet.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    state.activeScoreSegment = null;
    state.lastScoreEvent = { eventId: event.id, sourceEventId: event.sourceEventId, measureNumber: event.measureNumber, beat };
    return;
  }
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
  const key = `${state.runtime.selectedPartId}:${state.transpose}:${measureIndex}`;
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

function applyPitchEstimate(rawEstimate, beat, sampledAt, analysisMs, running) {
  if (state.microphoneStatus !== 'active') return;
  if ((state.neuralLive.enabled || state.neuralLive.loading) && Number.isFinite(analysisMs)) {
    state.neuralLive.v1DurationsMs.push(analysisMs);
    if (state.neuralLive.v1DurationsMs.length > 80) state.neuralLive.v1DurationsMs.shift();
  }
  const estimate = state.pitchSmoother.update(rawEstimate, sampledAt);
  appendBenchmarkFrame(estimate, beat);
  state.microphoneRms = estimate.rms;
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
  } else state.displayPitch = state.displayPitchFilter.filter(state.trackedPitch, sampledAt / 1000);
  echoDiagnosticsUI?.onPitchFrame({ beat, sampledAt, running, rawHz: estimate.rawHz,
    originalHz: rawEstimate.originalHz ?? rawEstimate.hz, harmonicResolved: Boolean(rawEstimate.harmonicResolved),
    trackedHz: state.trackedPitch == null ? null : estimate.hz, displayHz: state.displayPitch == null ? null : pitchToHz(state.displayPitch),
    accepted: estimate.accepted, rejectionReason: estimate.rejectionReason, confidence: estimate.confidence,
    rms: estimate.rms, clarity: estimate.clarity, settings: activeRecognitionSettings(), echo: echoCancellationUI?.diagnostics() });
  document.getElementById('microphone-level').value = state.microphoneRms;
  const microphoneHelp = state.trackedPitch == null
    ? state.microphoneRms < activeRecognitionSettings().rmsThreshold ? 'Microfono aperto: segnale troppo debole. Controlla ingresso e volume in Windows.' : 'Il segnale arriva. Tieni una nota per riconoscerla.'
    : `Nota riconosciuta: ${noteLabel(state.trackedPitch)}. Sei pronto per iniziare.`;
  const microphoneHelpElement = document.getElementById('microphone-help');
  if (microphoneHelpElement && microphoneHelpElement.textContent !== microphoneHelp) microphoneHelpElement.textContent = microphoneHelp;

  // Retain invalid observations too: the renderer must see silence boundaries.
  // Paused listening and the one-measure count-in remain visible in the live
  // readout, but must never become part of the recorded attempt.
  const recording = running && state.clock?.running && beat >= state.scoringStartBeat;
  if (recording) {
    const previous = state.pitchSamples.at(-1);
    const sample = { beat, trackedPitch: state.trackedPitch, displayPitch: state.displayPitch, rawPitch,
      confirmationState: state.pitchConfirmationState,
      confidence: estimate.confidence, clarity: estimate.clarity, takeId: state.pitchTakeId };
    if (!previous || previous.takeId !== state.pitchTakeId || beat - previous.beat >= .025) state.pitchSamples.push(sample);
  }
  if (state.pitchSamples.length > 12000) state.pitchSamples.splice(0, state.pitchSamples.length - 12000);
}

function stopPitchWorker() {
  clearTimeout(state.pitchWorkerTimeout);
  state.pitchWorkerTimeout = null;
  state.pitchAnalysisGeneration += 1;
  state.pitchWorker?.terminate();
  state.pitchWorker = null;
  state.pitchWorkerInFlight = false;
}

function failPitchWorker(worker) {
  if (state.pitchWorker !== worker) return;
  state.pitchWorkerDisabled = true;
  stopPitchWorker();
  if (state.microphoneStatus === 'active')
    state.microphoneBuffer = new Float32Array(state.microphoneAnalyser.fftSize);
}

function ensurePitchWorker() {
  if (state.pitchWorker || state.pitchWorkerDisabled || !window.Worker) return state.pitchWorker;
  try {
    const worker = new Worker('pitch_detector_worker.js');
    worker.onmessage = ({ data }) => {
      if (state.pitchWorker !== worker) return;
      clearTimeout(state.pitchWorkerTimeout);
      state.pitchWorkerTimeout = null;
      state.pitchWorkerInFlight = false;
      if (data.buffer && state.microphoneStatus === 'active') state.microphoneBuffer = new Float32Array(data.buffer);
      if (data.error) {
        failPitchWorker(worker);
        return;
      }
      if (data.generation !== state.pitchAnalysisGeneration) return;
      applyPitchEstimate(data.estimate, data.beat, data.sampledAt, data.analysisMs, data.running);
    };
    worker.onerror = worker.onmessageerror = () => failPitchWorker(worker);
    state.pitchWorker = worker;
  } catch (_) { state.pitchWorkerDisabled = true; }
  return state.pitchWorker;
}

function analyseMicrophone(beat, running, now) {
  if (!state.microphoneBuffer || state.pitchWorkerInFlight) return;
  state.microphoneAnalyser.getFloatTimeDomainData(state.microphoneBuffer);
  queueNeuralLiveInference(state.microphoneBuffer, state.microphoneContext.sampleRate, beat, running);
  const worker = ensurePitchWorker();
  if (worker) {
    const buffer = state.microphoneBuffer.buffer;
    state.microphoneBuffer = null;
    state.pitchWorkerInFlight = true;
    // A stalled script download need not raise onerror. Keep the existing
    // detector available on the main thread when no response arrives.
    state.pitchWorkerTimeout = setTimeout(() => failPitchWorker(worker), 1500);
    try {
      worker.postMessage({ buffer, sampleRate: state.microphoneContext.sampleRate,
        settings: activeRecognitionSettings(), beat, sampledAt: now, running,
        generation: state.pitchAnalysisGeneration }, [buffer]);
    } catch (_) {
      failPitchWorker(worker);
    }
    return;
  }
  const startedAt = performance.now();
  const estimate = detectPitch(state.microphoneBuffer, state.microphoneContext.sampleRate, { ...activeRecognitionSettings(), resolveHarmonics: true });
  applyPitchEstimate(estimate, beat, now, performance.now() - startedAt, running);
}

function stopPitchAnalysisLoop() {
  clearInterval(state.pitchAnalysisTimer);
  state.pitchAnalysisTimer = null;
}

function startPitchAnalysisLoop() {
  stopPitchAnalysisLoop();
  const tick = () => {
    if (state.microphoneStatus !== 'active' || state.pitchWorkerInFlight) return;
    const snapshot = state.clock?.snapshot() ?? { beat: 0, running: false };
    analyseMicrophone(snapshot.beat, snapshot.running, performance.now());
  };
  tick();
  state.pitchAnalysisTimer = setInterval(tick, UI_CONFIG.pitchAnalysisIntervalMs);
}

function sampleMicrophone(beat, running) {
  const now = performance.now();
  const elapsed = state.lastSampleMs == null ? 0 : Math.min(64, now - state.lastSampleMs);
  state.lastSampleMs = now;
  if (state.microphoneStatus !== 'active') {
    state.trackedPitch = null; state.displayPitch = null; state.pitchConfirmationState = null;
    state.displayPitchFilter.reset(); state.microphoneRms = 0; return;
  }
  if (running && state.trackedPitch != null) {
    const target = state.runtime.targetAt(beat);
    if (state.attemptActive && target && beat >= state.scoringStartBeat && beat >= target.onsetBeat + target.attackGraceBeats) {
      state.attempt.voicedMs += elapsed;
      if (Math.abs((state.trackedPitch - target.midiPitch - state.transpose) * 100) <= UI_CONFIG.acceptableCents) state.attempt.insideMs += elapsed;
    }
  }
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

function queueNeuralLiveInference(samples, sourceRate, beat, running) {
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
      if (running && state.clock?.running && beat >= state.scoringStartBeat) {
        neural.samples.push({ beat, pitch: neural.latestPitch, takeId: state.pitchTakeId, salience: Float32Array.from(probabilities.subarray(0, 360)) });
        if (neural.samples.length > 12000) neural.samples.splice(0, neural.samples.length - 12000);
      }
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
  if (!state.clock?.running) {
    showToast('Avvia la prova prima di attivare il confronto live.');
    return;
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

function drawMelodicIntervalArrows(context, events, xAtBeat, yAtPitch, rowHeight, clip) {
  const colour = '#438eaa';
  context.save();
  context.beginPath(); context.rect(clip.left, clip.top, clip.right - clip.left, clip.bottom - clip.top); context.clip();
  context.strokeStyle = colour; context.lineWidth = 2;
  context.lineCap = 'round'; context.lineJoin = 'round';
  for (const interval of adjacentMelodicIntervals(events)) {
    const x = Math.round(xAtBeat(interval.next.onsetBeat)) + .5;
    if (x < clip.left || x > clip.right) continue;
    const previousY = yAtPitch(interval.previous.midiPitch + state.transpose);
    const nextY = yAtPitch(interval.next.midiPitch + state.transpose);
    const startY = previousY - interval.direction * rowHeight / 2;
    const endY = nextY + interval.direction * rowHeight / 2;
    const canvasDirection = Math.sign(endY - startY);
    context.beginPath(); context.moveTo(x, startY); context.lineTo(x, endY); context.stroke();
    context.beginPath();
    context.moveTo(x - 4, endY - canvasDirection * 6);
    context.lineTo(x, endY);
    context.lineTo(x + 4, endY - canvasDirection * 6);
    context.stroke();

    context.font = '700 10px Inter, sans-serif';
    context.textAlign = 'left'; context.textBaseline = 'middle';
    const labelWidth = context.measureText(interval.label).width;
    // Syllables begin immediately to the right of a note onset, so prefer the
    // preceding side of the join and avoid merging labels such as “2” with text.
    const labelX = x - labelWidth - 12 >= clip.left ? x - labelWidth - 10 : x + 7;
    const labelY = (startY + endY) / 2;
    context.fillStyle = colour;
    roundedRect(context, labelX - 3, labelY - 7, labelWidth + 6, 14, 4); context.fill();
    context.fillStyle = '#071419'; context.fillText(interval.label, labelX, labelY + .5);
  }
  context.restore();
}

function livePlumeSettings(displayBeat, inspecting, nowX, trailStartX) {
  const speed = Math.max(.1, Number(els.playbackSpeed.value) || 1);
  return { ...state.plumeSettings, nowX, trailStartX,
    mode: inspecting ? 'review' : 'live', sortedTimeline: !inspecting,
    retainHistory: !inspecting,
    minConfidence: activeRecognitionSettings().minConfidence,
    currentTime: state.runtime.secondsAtBeat(displayBeat) / speed,
    timeAt: sample => state.runtime.secondsAtBeat(sample.beat) / speed };
}

function visuallyAdvancedPitchBeat(beat) {
  const advanceMs = Math.max(0, Math.min(PitchShared.PLUME_ADVANCE_MAX_MS, Number(state.plumeSettings.timeAdvanceMs) || 0));
  if (!advanceMs || !state.runtime) return beat;
  const playbackSpeed = Math.max(.1, Number(els.playbackSpeed.value) || 1);
  const scoreSeconds = state.runtime.secondsAtBeat(beat) - advanceMs / 1000 * playbackSpeed;
  return state.runtime.beatAtSeconds(Math.max(0, scoreSeconds));
}

function currentPianoRollBeat(snapshot = playbackSnapshot(), interpolate = false) {
  const blocked = state.pianoRollWaiting || els.backingAudio.seeking || els.backingAudio.readyState < 3
    || (state.playbackMixer.context && state.playbackMixer.context.state !== 'running');
  const time = interpolate ? state.pianoRollVisualTime.update(snapshot, performance.now(), blocked) : snapshot.performanceTime;
  if (interpolate) state.lastPianoRollTime = time;
  return delayedVisualBeat(state.runtime, time, snapshot.speed, state.pianoRollDelayMs);
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
  let fluidLayerDrawn = false;

  const plot = { left: rect.width < 700 ? 48 : 58, right: rect.width - 8, top: rect.width < 700 ? 28 : 32, bottom: rect.height - 24 };
  const inspect = state.gridInspect;
  const inspecting = !state.clock.running && inspect.active;
  const displayBeat = inspecting ? inspect.viewBeat : beat;
  const baseBounds = inspecting ? (inspect.baseBounds ??= { ...pitchBounds(beat) }) : pitchBounds(displayBeat);
  const baseCenter = (baseBounds.min + baseBounds.max) / 2 + (inspecting ? inspect.pitchOffset : 0);
  const baseSpan = baseBounds.max - baseBounds.min;
  const pitchSpan = baseSpan / (inspecting ? inspect.pitchZoom : 1);
  const bounds = { min: baseCenter - pitchSpan / 2, max: baseCenter + pitchSpan / 2 };
  const compactLayout = window.matchMedia('(max-width: 960px)').matches;
  const baseHistoryBeats = compactLayout ? UI_CONFIG.mobileHistoryBeats : UI_CONFIG.historyBeats;
  const baseFutureBeats = compactLayout ? UI_CONFIG.mobileFutureBeats : UI_CONFIG.futureBeats;
  let historyBeats = baseHistoryBeats / (inspecting ? inspect.timeZoom : 1);
  let futureBeats = baseFutureBeats / (inspecting ? inspect.timeZoom : 1);
  if (compactLayout && !inspecting) ({ historyBeats, futureBeats } = limitTimelineWindowToMeasures(
    state.occurrenceMeasures, displayBeat, historyBeats, futureBeats, 4));
  state.gridGeometry = { plot, bounds, historyBeats, futureBeats, timeZoom: inspecting ? inspect.timeZoom : 1,
    rowHeight: (plot.bottom - plot.top) / (bounds.max - bounds.min),
    viewStart: displayBeat - historyBeats, viewEnd: displayBeat + futureBeats,
    xAtBeat: value => timeToX(value, displayBeat, plot.left, plot.right, historyBeats, futureBeats),
    yAtPitch: value => pitchToY(value, bounds.min, bounds.max, plot.top, plot.bottom) };
  state.gridNavigation?.refresh();
  let rowHeight = (plot.bottom - plot.top) / (bounds.max - bounds.min);
  const nowX = timeToX(displayBeat, displayBeat, plot.left, plot.right, historyBeats, futureBeats);
  const noteLabelX = compactLayout ? 6 : nowX - UI_CONFIG.pitchNoteLabelOffsetPx;
  const melodyHeadX = compactLayout ? nowX - UI_CONFIG.pitchHeadGapPx : noteLabelX - UI_CONFIG.pitchHeadGapPx;
  const noteStripLeft = compactLayout ? 0 : noteLabelX - 4;
  const noteStripRight = compactLayout ? plot.left - 4 : nowX - 1;
  const voiceClipRight = compactLayout ? nowX - 2 : noteLabelX - 2;
  els.intonationReadout.style.left = `${nowX + 12}px`;
  els.intonationReadout.style.right = 'auto';
  const visibleStart = displayBeat - historyBeats - 1;
  const visibleEnd = displayBeat + futureBeats + 1;

  if (!window.PianoRoll) {
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

  ctx.save();
  ctx.beginPath(); ctx.rect(plot.left, 0, plot.right - plot.left, plot.bottom); ctx.clip();
  rhythmGridLines(state.occurrenceMeasures, visibleStart, visibleEnd).forEach((line) => {
    if (compactLayout && line.kind === 'subdivision') return;
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
    ctx.fillStyle = 'rgba(217,168,91,.10)';
    roundedRect(ctx, x, y - toleranceHeight / 2, endX - x, toleranceHeight, 3); ctx.fill();
    ctx.fillStyle = event.onsetBeat <= displayBeat && displayBeat < event.onsetBeat + event.durationBeats ? '#e4b665' : '#bd8e4c';
    roundedRect(ctx, x, y - blockHeight / 2, Math.max(2, endX - x - 2), blockHeight, 3); ctx.fill();
    const graceEnd = timeToX(event.onsetBeat + event.attackGraceBeats, displayBeat, plot.left, plot.right, historyBeats, futureBeats);
    ctx.fillStyle = 'rgba(7,19,25,.24)'; ctx.fillRect(x, y - blockHeight / 2, Math.max(0, graceEnd - x), blockHeight);
    const lyric = event.lyric ?? '';
    if (lyric && endX - x > 18) {
      const lyricFontSize = (rect.width < 700 ? 9 : 11) * state.lyricTextScale;
      ctx.fillStyle = '#d6cbb6';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.font = `${lyricFontSize}px Georgia, serif`;
      ctx.fillText(lyric, x + 2, y - blockHeight / 2 - 2);
    }
  });
  } else {
    const sharedBase = PianoRoll.drawBase(ctx, {
      width: rect.width, height: rect.height, plot, bounds,
      viewStart: displayBeat - historyBeats, viewEnd: displayBeat + futureBeats,
      gridLines: rhythmGridLines(state.occurrenceMeasures, visibleStart, visibleEnd).map(line => ({
        ...line,
        label: line.label && Math.abs(timeToX(line.beat, displayBeat, plot.left, plot.right, historyBeats, futureBeats) - nowX) > 34 ? line.label : '',
      })),
      measures: state.occurrenceMeasures, targetEvents: state.runtime.targetEvents,
      pitchOffset: state.transpose, activeBeat: displayBeat, lyricScale: state.lyricTextScale,
      compact: compactLayout, targetToleranceCents: UI_CONFIG.targetToleranceCents, showPitchLabels: false,
    });
    rowHeight = sharedBase.rowHeight;
  }
  if (state.showIntervals) {
    drawMelodicIntervalArrows(ctx, state.runtime.targetEvents,
      (eventBeat) => timeToX(eventBeat, displayBeat, plot.left, plot.right, historyBeats, futureBeats),
      (pitch) => pitchToY(pitch, bounds.min, bounds.max, plot.top, plot.bottom), rowHeight, plot);
  }

  ctx.save();
  ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top); ctx.clip();
  if (state.pitchLayers.v1) {
    const replaySamples = state.personalRecording.replay?.pitchSamples;
    const v1PlumeSamples = (replaySamples ?? state.pitchSamples)
      .filter((sample) => (replaySamples || inspecting || sample.takeId === state.pitchTakeId)
        && sample.beat >= visibleStart && sample.beat <= visibleEnd);
    const xAtVoice = (sample) => {
      // Keep the detector-latency correction when switching from the live
      // ribbon to the paused history view, including after zooming out.
      // Do not clamp several observations to the same live-head coordinate:
      // the renderer clips the single-valued graph at melodyHeadX instead.
      return timeToX(visuallyAdvancedPitchBeat(sample.beat), displayBeat, plot.left, plot.right, historyBeats, futureBeats);
    };
    const yAtVoice = (pitch) => pitchToY(pitch, bounds.min, bounds.max, plot.top, plot.bottom);
    const trailSettings = { ...livePlumeSettings(displayBeat, inspecting, inspecting ? plot.right : melodyHeadX, plot.left),
      ribbonScale: state.plumeSettings.width, intensity: state.plumeSettings.intensity, dpr, width: rect.width, height: rect.height,
      clip: { left: plot.left, top: plot.top, right: inspecting ? plot.right : voiceClipRight, bottom: plot.bottom },
      showHeadMarker: false,
      animationTime: state.clock.running ? performance.now() / 1000 : state.runtime.secondsAtBeat(displayBeat) };
    fluidLayerDrawn = fluidTrailRenderer.render(v1PlumeSamples, xAtVoice, yAtVoice, trailSettings);
    if (!fluidLayerDrawn)
      FluidPitchTrail.drawFallback(ctx, v1PlumeSamples, xAtVoice, yAtVoice, trailSettings);
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
  if (!fluidLayerDrawn) {
    // Clear a previously rendered WebGL ribbon when its layer is disabled.
    // Renderer.render already resizes and clears when the layer is active.
    fluidTrailRenderer.resize(rect.width, rect.height, dpr);
    fluidTrailRenderer.clear();
  }
  ctx.restore(); ctx.shadowBlur = 0;

  const currentTarget = state.runtime.targetAt(displayBeat);
  const tonicPitchClass = state.runtime.tonicPitchClassAt(displayBeat, state.transpose);
  const fifthPitchClass = tonicPitchClass == null ? null : (tonicPitchClass + 7) % 12;
  const noteStripWidth = Math.max(0, noteStripRight - noteStripLeft);
  ctx.fillStyle = '#0a181e'; ctx.fillRect(noteStripLeft, plot.top - 8, noteStripWidth, plot.bottom - plot.top + 16);
  for (let pitch = Math.ceil(bounds.min); pitch <= Math.floor(bounds.max); pitch += 1) {
    const y = pitchToY(pitch, bounds.min, bounds.max, plot.top, plot.bottom);
    const active = currentTarget && pitch === currentTarget.midiPitch + state.transpose;
    const pitchClass = ((pitch % 12) + 12) % 12;
    const tonalColour = pitchClass === tonicPitchClass ? TONAL_ROLE_COLOURS.tonic
      : pitchClass === fifthPitchClass ? TONAL_ROLE_COLOURS.fifth : null;
    if (tonalColour) {
      ctx.fillStyle = tonalColour;
      ctx.fillRect(noteStripLeft, y - rowHeight / 2, noteStripWidth, rowHeight);
    }
    ctx.fillStyle = tonalColour ? '#fff' : (active ? '#f0cf8f' : '#93a9a8');
    ctx.shadowColor = tonalColour ? 'rgba(0,0,0,.58)' : 'transparent';
    ctx.shadowBlur = tonalColour ? 2 : 0;
    ctx.shadowOffsetY = tonalColour ? 1 : 0;
    ctx.font = `${active || tonalColour ? '700 ' : ''}${Math.max(8, Math.min(12, rowHeight * .8))}px Inter, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(noteLabel(pitch, displayBeat), noteLabelX, y);
  }
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  if (Number.isFinite(state.displayPitch)) {
    const markerY = Math.max(plot.top + 4, Math.min(plot.bottom - 4,
      pitchToY(state.displayPitch, bounds.min, bounds.max, plot.top, plot.bottom)));
    FluidPitchTrail.drawPitchMarker(ctx, nowX, markerY);
  }
  if (Number.isFinite(state.displayPitch) && (state.displayPitch < bounds.min || state.displayPitch > bounds.max)) {
    ctx.fillStyle = '#68d1cb'; ctx.textAlign = 'left';
    ctx.fillText(`${state.displayPitch < bounds.min ? '↓' : '↑'} ${noteLabel(state.displayPitch)} fuori scala`, nowX + 10,
      state.displayPitch < bounds.min ? plot.bottom - 10 : plot.top + 10);
  }

  if (inspecting && Number.isFinite(state.resumeCheckpointBeat)) {
    const resumeX = timeToX(state.resumeCheckpointBeat, displayBeat, plot.left, plot.right, historyBeats, futureBeats);
    if (resumeX >= plot.left && resumeX <= plot.right) {
      ctx.strokeStyle = '#68d1cb'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(Math.round(resumeX) + .5, plot.top); ctx.lineTo(Math.round(resumeX) + .5, plot.bottom); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#68d1cb'; ctx.font = '700 9px Inter, sans-serif';
      ctx.textAlign = resumeX > plot.right - 70 ? 'right' : 'left'; ctx.textBaseline = 'top';
      ctx.fillText('RIPRESA', resumeX + (resumeX > plot.right - 70 ? -5 : 5), plot.top + 4);
    }
  }

  ctx.strokeStyle = '#f0cf8f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(Math.round(nowX) + .5, plot.top); ctx.lineTo(Math.round(nowX) + .5, plot.bottom); ctx.stroke();
}

function renderReadout(beat, running) {
  const update = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const updateState = (value) => { if (els.intonationReadout.dataset.state !== value) els.intonationReadout.dataset.state = value; };
  const target = state.runtime.targetAt(beat);
  const singerPitch = state.displayPitch;
  if (!target && singerPitch != null) {
    update(els.liveNote, noteLabel(singerPitch)); update(els.liveCents, '— ¢');
    update(els.liveState, 'voce rilevata · nessun target'); updateState(''); return;
  }
  if (!target || singerPitch == null) {
    update(els.liveCents, '— ¢');
    update(els.liveNote, '—');
    update(els.liveState, state.microphoneStatus === 'active'
      ? state.microphoneRms < .001
        ? 'nessun segnale dal microfono'
        : 'segnale ricevuto: nota non riconosciuta'
      : state.microphoneStatus === 'denied' ? 'permesso negato' : 'attiva il microfono');
    updateState('');
    return;
  }
  if (state.pitchConfirmationState === 'provisional') {
    update(els.liveNote, noteLabel(singerPitch));
    update(els.liveCents, '— ¢');
    update(els.liveState, 'transizione in verifica');
    updateState('provisional');
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
  update(els.liveNote, noteLabel(singerPitch));
  update(els.liveCents, `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)} ¢`);
  update(els.liveState, label);
  updateState(abs > UI_CONFIG.acceptableCents ? 'outside' : 'inside');
  if (label !== state.lastAnnouncedState) state.lastAnnouncedState = label;
}

function render() {
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  if (!state.runtime) return;
  let snapshot = playbackSnapshot();
  const endBeat = totalBeats();
  if (state.attemptActive && snapshot.beat >= endBeat - .01) {
    state.clock.pause(); state.clock.seekBeat(endBeat); snapshot = state.clock.snapshot();
    finishAttempt(); updatePlaybackButton();
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
  const scoreMeasureLabel = `Battuta ${measure?.number ?? '—'}`;
  const measureCounter = `${scoreMeasureLabel} / ${state.occurrenceMeasures.length}`;
  if (els.scoreMeasureLabel.textContent !== scoreMeasureLabel) els.scoreMeasureLabel.textContent = scoreMeasureLabel;
  if (els.measureCounter.textContent !== measureCounter) els.measureCounter.textContent = measureCounter;
  renderScore(snapshot.beat);
  // Delay only the pitch-lane timeline. Audio, metronome and scoring continue
  // to use the media clock; the plume advance remains relative to this lane.
  drawPitchLane(currentPianoRollBeat(snapshot, true));
  renderReadout(snapshot.beat, snapshot.running);
  renderSyncDebug(snapshot);
  if (snapshot.running || state.microphoneStatus === 'active' || (!state.gridInspect.active && state.pitchViewport?.animating)) state.rafId = requestAnimationFrame(render); else state.rafId = null;
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
  if (!echoCancellationUI?.enabled()) state.metronomeContext ??= new AudioContextClass({ latencyHint: 'interactive' });
  const context = echoCancellationUI?.enabled() ? state.playbackMixer.context : state.metronomeContext;
  if (!context) return;
  if (context.state === 'suspended') context.resume();
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(accented ? 1120 : 820, now);
  oscillator.frequency.exponentialRampToValueAtTime(accented ? 760 : 570, now + 0.045);
  gain.gain.setValueAtTime(Math.max(0.0001, volume * (accented ? 0.5 : 0.34)), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (accented ? 0.075 : 0.055));
  oscillator.connect(gain).connect(echoCancellationUI?.enabled() ? state.playbackMixer.referenceOutput : context.destination);
  oscillator.start(now); oscillator.stop(now + 0.08);
}

function renderMetronome(snapshot) {
  if (!snapshot.running) { state.lastMetronomeBeat = null; return; }
  const offsetScoreSeconds = state.metronomeOffsetMs / 1000 * Math.max(.1, snapshot.speed || 1);
  if (offsetScoreSeconds > 0 && snapshot.performanceTime < offsetScoreSeconds) return;
  const metronomeTime = metronomePerformanceTime(snapshot.performanceTime, snapshot.speed, state.metronomeOffsetMs);
  const metronomeBeat = Math.max(0, state.runtime.beatAtSeconds(metronomeTime));
  const measureIndex = measureIndexAt(metronomeBeat);
  const measure = state.occurrenceMeasures[measureIndex];
  const metronomeBeatLength = 4 / (measure?.timeSignatureDenominator ?? 4);
  const beatInMeasure = Math.max(0, Math.floor((metronomeBeat - (measure?.startBeat ?? 0)) / metronomeBeatLength));
  const metricalBeatIndex = (measure?.beatOffset ?? 0) + beatInMeasure;
  const beatToken = `${measureIndex}:${metricalBeatIndex}`;
  if (state.lastMetronomeBeat == null) {
    state.lastMetronomeBeat = beatToken;
    const nearestPulse = (measure?.startBeat ?? 0) + Math.round((metronomeBeat - (measure?.startBeat ?? 0)) / metronomeBeatLength) * metronomeBeatLength;
    if (Math.abs(metronomeBeat - nearestPulse) < 0.06) {
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
  els.showFeedback.hidden = running;
}

function updateTransposeControl() {
  const semitones = Number(state.transpose) || 0;
  els.transposeValue.textContent = semitones === 0 ? '±0' : `${semitones > 0 ? '+' : '−'}${Math.abs(semitones)}`;
  els.transposeValue.setAttribute('aria-label', semitones === 0
    ? 'Tonalità originale' : `${semitones > 0 ? 'Trasposto su' : 'Trasposto giù'} di ${Math.abs(semitones)} semitoni`);
}

function applyPendingAudioSeek() {
  const target = state.pendingAudioTime;
  if (target == null || !state.clock) return true;
  try {
    state.clock.seekPerformanceTime(target);
  } catch (_) {
    // Some mobile media stacks reject currentTime assignments until the MP3
    // has exposed metadata/seek ranges. Keep the destination queued for retry.
    return false;
  }
  const applied = Math.abs(state.clock.snapshot().performanceTime - target) < .05;
  if (applied) {
    state.pendingAudioTime = null;
    for (const audio of state.voiceStemAudio.values()) {
      if (audio.readyState < 1) continue;
      try { audio.currentTime = els.backingAudio.currentTime; } catch (_) { /* Retried after media readiness. */ }
    }
    render();
  }
  return applied;
}

function playbackSnapshot() {
  const snapshot = state.clock.snapshot();
  if (state.pendingAudioTime == null || snapshot.running) return snapshot;
  const performanceTime = state.pendingAudioTime;
  return { ...snapshot, performanceTime, beat: state.runtime.beatAtSeconds(performanceTime) };
}

function queueAudioSeek(performanceTime) {
  state.pendingAudioTime = Math.max(0, Number(performanceTime) || 0);
  const target = state.pendingAudioTime;
  applyPendingAudioSeek();
  // A freshly loaded MP3 may know its duration before it exposes a seekable
  // range. Keep the user's destination and retry while that range settles.
  [100, 300, 800, 1600].forEach((delay) => setTimeout(() => {
    if (state.pendingAudioTime === target) applyPendingAudioSeek();
  }, delay));
}

async function navigateToMeasure(index) {
  const seekToken = ++state.transportSeekToken;
  const shouldResume = state.clock.running || state.transportSeekResumeRequested;
  state.transportSeekResumeRequested = shouldResume;
  if (state.clock.running) {
    state.clock.pause();
    await releaseMicrophoneIfUnused();
  }
  pauseVoiceStems();
  seekToMeasure(index, false, false);
  const selectedMeasure = state.occurrenceMeasures[state.selectedMeasureIndex];
  const targetPerformanceTime = state.runtime.secondsAtBeat(selectedMeasure?.startBeat ?? 0);

  const media = [els.backingAudio, ...state.voiceStemAudio.values()];
  await Promise.all(media.map((item) => waitForMediaReady(item, 1)));
  if (seekToken !== state.transportSeekToken) return;

  applyPendingAudioSeek();
  await waitForMediaSeek(els.backingAudio);
  if (seekToken !== state.transportSeekToken) return;

  // A browser may accept currentTime before the underlying MP3 range is
  // actually seekable, then snap back to zero. Verify after `seeked` and retry
  // once with enough buffered data before resuming all channels.
  if (Math.abs(state.clock.snapshot().performanceTime - targetPerformanceTime) >= .05) {
    state.pendingAudioTime = targetPerformanceTime;
    await waitForMediaReady(els.backingAudio, 3);
    if (seekToken !== state.transportSeekToken) return;
    applyPendingAudioSeek();
    await waitForMediaSeek(els.backingAudio);
  }
  if (seekToken !== state.transportSeekToken) return;
  if (Math.abs(state.clock.snapshot().performanceTime - targetPerformanceTime) >= .08) {
    state.transportSeekResumeRequested = false;
    showToast('Audio non ancora pronto per il salto. Riprova.');
    updatePlaybackButton();
    render();
    return;
  }

  for (const audio of state.voiceStemAudio.values()) {
    if (audio.readyState < 1) continue;
    try { audio.currentTime = els.backingAudio.currentTime; } catch (_) { /* Playback can still use the master. */ }
  }

  const resume = state.transportSeekResumeRequested;
  state.transportSeekResumeRequested = false;
  if (resume) {
    try {
      if (state.microphoneStatus !== 'active') await toggleMicrophone();
      if (echoCancellationUI?.enabled() && state.microphoneStatus !== 'active') return;
      await state.playbackMixer.resume(media);
      syncBackingLevel();
      syncVoiceStemLevels();
      await state.clock.play();
    } catch (error) {
      console.error('Measure navigation failed', error);
      showToast('Salto alla battuta non riuscito. Riprova.');
    }
  }
  updatePlaybackButton();
  render();
}

function seekToMeasure(index, autoPlay = false, preRoll = true) {
  PianoRoll.stopPreview();
  if (state.automaticBestRecording.capture) void stopAutomaticBestCapture({ discard: true });
  state.attempt = { voicedMs: 0, insideMs: 0 }; state.lastSampleMs = null;
  state.resumeCheckpointBeat = null;
  state.gridInspect.active = false;
  const seek = measureSeekState(state.occurrenceMeasures, index, { preRoll });
  state.selectedMeasureIndex = seek.selectedIndex;
  state.attemptStartedFromBeginning = seek.selectedIndex === 0;
  state.scoringStartBeat = seek.scoringStart;
  queueAudioSeek(state.runtime.secondsAtBeat(seek.playbackStart));
  state.lastMetronomeBeat = null;
  beginPitchTake();
  const playbackNumber = state.occurrenceMeasures[Math.max(0, seek.selectedIndex - 1)]?.number ?? 1;
  const scoringNumber = state.occurrenceMeasures[seek.selectedIndex]?.number ?? 1;
  els.scoringCue.textContent = seek.playbackStart === seek.scoringStart ? `Ingresso da ${scoringNumber}` : `Preascolto ${playbackNumber} · ingresso ${scoringNumber}`;
  if (autoPlay && !state.clock.running) void togglePlayback();
  updatePlaybackButton(); render();
}

function rememberAttemptCheckpoint(beat) {
  if (!state.attemptActive) return;
  state.resumeCheckpointBeat = Math.max(0, Math.min(totalBeats(), Math.max(beat, state.scoringStartBeat)));
  const measure = state.occurrenceMeasures[measureIndexAt(state.resumeCheckpointBeat)];
  els.scoringCue.textContent = `In pausa · ripresa battuta ${measure?.number ?? 1}`;
}

function prepareAttemptResume() {
  if (!state.attemptActive || !Number.isFinite(state.resumeCheckpointBeat)) return false;
  const resume = attemptResumeState(state.occurrenceMeasures, state.resumeCheckpointBeat);
  state.selectedMeasureIndex = resume.resumeIndex;
  state.scoringStartBeat = resume.scoringStart;
  state.lastSampleMs = null;
  state.lastMetronomeBeat = null;
  queueAudioSeek(state.runtime.secondsAtBeat(resume.playbackStart));
  const playbackMeasure = state.occurrenceMeasures[Math.max(0, resume.resumeIndex - 1)];
  const resumeMeasure = state.occurrenceMeasures[resume.resumeIndex];
  els.scoringCue.textContent = resume.playbackStart === resume.scoringStart
    ? `Ripresa battuta ${resumeMeasure?.number ?? 1}`
    : `Preascolto ${playbackMeasure?.number ?? 1} · ripresa ${resumeMeasure?.number ?? 1}`;
  return true;
}

async function togglePlayback() {
  PianoRoll.stopPreview();
  state.gridNavigation?.cancel();
  if (state.personalRecording.capture) {
    showToast('Usa “Interrompi” per terminare la registrazione personale.');
    return;
  }
  if (state.personalRecording.replay) {
    await togglePersonalRecordingReplayPlayback();
    return;
  }
  if (!state.bundleApproved) { showToast('Serve l’approvazione admin di questo bundle.'); return; }
  if (state.playbackPlan?.kind === 'muted') { showToast('Attiva almeno una traccia nel Mixer.'); return; }
  if (!state.clock.running) restoreAudioOutputPreference();
  if (playbackSnapshot().beat >= totalBeats()) state.clock.seekBeat(0);
  echoCancellationUI?.checkpoint('playback-toggle');
  if (!state.clock.running && echoCancellationUI?.enabled() && !echoCancellationUI.ready()) {
    if (!echoDiagnosticsUI?.isBusy() && !await microphoneCalibrationUI.verifyPlayback()) return;
  }
  if (state.clock.running) {
    const checkpointBeat = playbackSnapshot().beat;
    state.clock.pause();
    void stopAutomaticBestCapture({ discard: true });
    rememberAttemptCheckpoint(checkpointBeat);
    savePitchHistory();
    await releaseMicrophoneIfUnused();
  } else {
    state.gridNavigation?.reset();
    prepareAttemptResume();
    if (state.pendingAudioTime != null) {
      await waitForMediaReady(els.backingAudio, 3);
      applyPendingAudioSeek();
    }
    try {
      await state.playbackMixer.resume([els.backingAudio, ...state.voiceStemAudio.values()]);
      syncBackingLevel();
      syncVoiceStemLevels();
    } catch (error) {
      console.warn('Unable to start Web Audio mixer; using media fallback', error);
      if (state.transpose) {
        showToast('La trasposizione non è supportata da questo browser. Torna alla tonalità originale.');
        updatePlaybackButton(); return;
      }
    }
    if (state.microphoneStatus !== 'active') await toggleMicrophone();
    if (echoCancellationUI?.enabled() && state.microphoneStatus !== 'active') return;
    if (echoCancellationUI?.enabled() && !state.playbackMixer.referenceCovers([els.backingAudio, ...state.voiceStemAudio.values()])) {
      await stopMicrophone(); echoCancellationUI.invalidate('reference-incomplete');
      showToast('Il browser non rende disponibile tutta la base per la cancellazione. Usa le cuffie.'); return;
    }
    await loadAutomaticBestPreference();
    if (!state.attemptActive) {
      state.attempt = { voicedMs: 0, insideMs: 0 }; state.lastSampleMs = null;
      startAutomaticBestCapture();
    }
    try {
      state.clock.finishWarmup();
      restoreCalibrationMediaLoops();
      state.playbackMixer.muteForCalibration(false);
      await state.clock.play();
      echoCancellationUI?.checkpoint('playback-started');
      applyPendingAudioSeek();
      markAutomaticBestPlaybackStarted();
    } catch (error) {
      void stopAutomaticBestCapture({ discard: true });
      console.error('Audio playback failed', error, els.backingAudio.error);
      showToast(`Audio non avviato: ${error?.message || 'sorgente non disponibile'}`);
    }
    state.attemptActive = state.clock.running;
  }
  updatePlaybackButton();
  if (state.clock.running && !state.rafId) state.rafId = requestAnimationFrame(render); else render();
}

function bindGridInspection() {
  const canvas = els.pitchLane;
  state.gridNavigation = PianoRoll.bindNavigation(canvas, {
    enabled: () => Boolean(state.clock && !state.clock.running && !state.personalRecording.capture),
    geometry: () => state.gridGeometry,
    activate: () => {
      if (!state.gridInspect.active) {
        state.gridInspect.active = true;
        state.gridInspect.viewBeat = currentPianoRollBeat();
        state.gridInspect.baseBounds = { ...pitchBounds(currentPianoRollBeat()) };
        render();
      }
    },
    minZoom: .25,
    view: () => ({ zoom: state.gridInspect.timeZoom, pitchZoom: state.gridInspect.pitchZoom, pitchOffset: state.gridInspect.pitchOffset }),
    change: values => {
      const view = state.gridInspect, g = state.gridGeometry;
      if (values.zoom != null) view.timeZoom = values.zoom;
      if (values.pitchZoom != null) view.pitchZoom = values.pitchZoom;
      if (values.pitchOffset != null) view.pitchOffset = Math.max(-128, Math.min(128, values.pitchOffset));
      if (values.centerBeat != null) {
        // The live NOW position is intentionally off-center. Convert the
        // geometric center back to its history/future reference position.
        view.viewBeat = Math.max(0, Math.min(totalBeats(), values.centerBeat
          - (g.futureBeats - g.historyBeats) / 2 * (g.timeZoom / view.timeZoom)));
      }
      render();
    },
    reset: () => {
      state.gridInspect = { active: false, viewBeat: currentPianoRollBeat(), pitchOffset: 0, timeZoom: 1, pitchZoom: 1, pointer: null };
      render();
    },
    notes: () => state.runtime?.targetEvents || [],
    pitchOffset: () => state.transpose,
    notePlayback: note => ({
      duration: (state.runtime.secondsAtBeat(note.onsetBeat + note.durationBeats) - state.runtime.secondsAtBeat(note.onsetBeat)) / Number(els.playbackSpeed.value),
      volume: Number(els.volume.value) / 100,
    }),
  });
}

function showToast(message) {
  els.toast.textContent = message; els.toast.hidden = false;
  clearTimeout(showToast.timeout); showToast.timeout = setTimeout(() => { els.toast.hidden = true; }, 2400);
}

function updateMicrophoneButton() {
  els.togglePlayback.disabled = state.microphoneStatus === 'requesting' || state.playbackPlan?.kind === 'muted'
    || Boolean(state.personalRecording.capture);
}

async function stopMicrophone() {
  echoCancellationUI?.checkpoint('microphone-stop-request');
  await echoDiagnosticsUI?.stop('microphone-stopped');
  if (state.clock?.warmupTime != null) {
    state.clock.pause(); pauseVoiceStems();
  }
  restoreCalibrationMediaLoops();
  state.playbackMixer.muteForCalibration(false);
  state.microphoneRequestGeneration += 1;
  document.getElementById('microphone-level').value = 0;
  const stream = state.microphoneStream;
  const context = state.microphoneContext;
  const source = state.microphoneSource;
  const analyser = state.microphoneAnalyser;
  const silencer = state.microphoneSilencer;
  echoCancellationUI?.detach();
  microphoneCalibrationUI?.refresh();
  state.microphoneStream = null; state.microphoneContext = null; state.microphoneSource = null; state.microphoneAnalyser = null; state.microphoneSilencer = null; state.microphoneBuffer = null;
  stream?.getTracks().forEach((track) => track.stop());
  source?.disconnect();
  analyser?.disconnect();
  silencer?.disconnect();
  stopPitchAnalysisLoop();
  stopPitchWorker();
  state.microphoneStatus = 'idle'; state.trackedPitch = null; state.displayPitch = null; state.pitchConfirmationState = null; state.microphoneRms = 0; state.pitchSmoother.reset(); state.displayPitchFilter.reset();
  state.neuralLive.generation += 1; state.neuralLive.enabled = false; state.neuralLive.loading = false; state.neuralLive.inFlight = false; state.neuralLive.latestPitch = null; state.neuralLive.samples = [];
  updateMicrophoneButton(); updateNeuralLiveUi(); render();
  if (context && context.state !== 'closed') {
    try { await context.close(); } catch (_) { /* Tracks are already stopped; context cleanup is best-effort. */ }
  }
}

function microphoneCaptureActive() {
  return Boolean(microphoneCalibrationUI?.isBusy() || echoCancellationUI?.isBusy() || state.groundTruth.capture || state.benchmark.capture || state.personalRecording.capture
    || state.automaticBestRecording.capture || echoDiagnosticsUI?.isBusy());
}

async function releaseMicrophoneIfUnused({ force = false } = {}) {
  if (!force && microphoneCaptureActive()) return false;
  if (state.microphoneStatus === 'idle' && !state.microphoneStream) return false;
  await stopMicrophone();
  return true;
}

async function pausePracticeForNonExercise({ preserveCalibration = false } = {}) {
  if (preserveCalibration && state.clock?.warmupTime != null && microphoneCalibrationUI?.activeSettings()) return;
  if (state.clock?.running && !microphoneCaptureActive()) {
    const checkpointBeat = playbackSnapshot().beat;
    state.clock.pause();
    rememberAttemptCheckpoint(checkpointBeat);
    savePitchHistory();
    updatePlaybackButton();
    render();
  }
  if (preserveCalibration && state.microphoneStatus === 'active' && microphoneCalibrationUI?.activeSettings()) return;
  await releaseMicrophoneIfUnused();
}

async function suspendPracticeForBackground() {
  await echoDiagnosticsUI?.stop('background');
  if (microphoneCalibrationUI?.isBusy()) microphoneCalibrationUI.cancel('Misura annullata perché la pagina non è più visibile.');
  if (echoCancellationUI?.isBusy()) echoCancellationUI.cancel('Controllo annullato perché la pagina non è più visibile.');
  if (state.clock?.running) {
    const checkpointBeat = playbackSnapshot().beat;
    state.clock.pause();
    void stopAutomaticBestCapture({ discard: true });
    rememberAttemptCheckpoint(checkpointBeat);
    updatePlaybackButton();
  }
  savePitchHistory();
  const groundTruthCapture = state.groundTruth.capture;
  if (groundTruthCapture) {
    groundTruthCapture.recorder.onstop = () => {};
    if (groundTruthCapture.recorder.state !== 'inactive') groundTruthCapture.recorder.stop();
    state.groundTruth.capture = null;
    els.groundTruthStart.disabled = false; els.groundTruthApprove.disabled = true;
    els.groundTruthStatus.textContent = 'Acquisizione annullata perché la pagina non è più visibile.';
  }
  if (state.benchmark.capture) discardBenchmarkTake();
  if (state.personalRecording.capture) {
    stopPersonalRecordingCapture({ discard: true });
    els.personalRecordingStatus.textContent = 'Registrazione annullata perché la pagina non è più visibile.';
  }
  if (state.automaticBestRecording.capture) await stopAutomaticBestCapture({ discard: true });
  if (state.personalRecording.replay) stopPersonalRecordingReplay();
  if (state.microphoneStatus !== 'idle' || state.microphoneStream) await stopMicrophone();
}

async function toggleMicrophone() {
  if (state.microphoneStatus === 'active') { await stopMicrophone(); return; }
  if (echoCancellationUI?.enabled() && !echoCancellationUI.ready() && !microphoneCalibrationUI?.isBusy()
    && !microphoneCalibrationUI?.isRestoring() && !echoDiagnosticsUI?.isBusy()) {
    await microphoneCalibrationUI.verifyPlayback(); return;
  }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    state.microphoneStatus = 'error'; updateMicrophoneButton();
    showToast('Il microfono richiede un contesto sicuro (HTTPS) e un browser compatibile.'); render(); return;
  }
  state.microphoneStatus = 'requesting'; updateMicrophoneButton();
  state.microphoneFailureMessage = null;
  const requestGeneration = ++state.microphoneRequestGeneration;
  // Granting microphone permission can itself change the devices exposed by
  // the browser. Do not mistake that privacy-related update for a real output
  // switch and immediately ask the user the same question again.
  state.ignoreAudioDeviceChangesUntil = Date.now() + 5000;
  try {
    const nativeAEC = echoCancellationUI?.enabled() && echoCancellationUI.isNative?.();
    const stream = await window.ChoirMedia.acquireMicrophone(navigator.mediaDevices, { audio: nativeAEC
      ? { echoCancellation: {exact:true}, noiseSuppression: {exact:false}, autoGainControl: {exact:false}, channelCount:1 }
      : { echoCancellation: false, noiseSuppression: false, autoGainControl: !echoCancellationUI?.enabled(), channelCount: 1 }, video: false }, {
      preferPhone: /Android/i.test(navigator.userAgent) && !echoCancellationUI?.enabled(),
      isCurrent: () => requestGeneration === state.microphoneRequestGeneration && document.visibilityState !== 'hidden',
    });
    if (!stream) {
      if (requestGeneration === state.microphoneRequestGeneration) { state.microphoneStatus = 'idle'; updateMicrophoneButton(); render(); }
      return;
    }
    if (requestGeneration !== state.microphoneRequestGeneration || document.visibilityState === 'hidden') {
      stream.getTracks().forEach((track) => track.stop());
      if (requestGeneration === state.microphoneRequestGeneration) {
        state.microphoneStatus = 'idle'; updateMicrophoneButton(); render();
      }
      return;
    }
    let analysisStream = stream;
    try { analysisStream = await echoCancellationUI?.attach(stream) || stream; }
    catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
    if (requestGeneration !== state.microphoneRequestGeneration) {
      stream.getTracks().forEach(track => track.stop()); echoCancellationUI?.detach(); return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass({ latencyHint: 'interactive' }); await context.resume();
    // A 2048-sample window covers the practical choir range down to D2/E2
    // while containing only ~43 ms of audio at 48 kHz. Combined with the
    // 60 Hz worker cadence this reacts faster than the former 4096-sample
    // main-thread detector and leaves ample CPU headroom for compositing.
    const analyser = context.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0;
    const source = context.createMediaStreamSource(analysisStream);
    // Audio nodes are pull-driven. Route the analyser to a muted sink so the
    // browser processes the microphone graph without feeding it back to the room.
    const silencer = context.createGain(); silencer.gain.value = 0;
    source.connect(analyser); analyser.connect(silencer); silencer.connect(context.destination);
    if (requestGeneration !== state.microphoneRequestGeneration || document.visibilityState === 'hidden') {
      stream.getTracks().forEach((track) => track.stop()); source.disconnect(); analyser.disconnect(); silencer.disconnect();
      echoCancellationUI?.detach();
      try { await context.close(); } catch (_) {}
      if (requestGeneration === state.microphoneRequestGeneration) {
        state.microphoneStatus = 'idle'; updateMicrophoneButton(); render();
      }
      return;
    }
    state.microphoneStream = stream; state.microphoneContext = context; state.microphoneSource = source; state.microphoneAnalyser = analyser; state.microphoneSilencer = silencer;
    state.pitchWorkerDisabled = false; state.pitchWorkerInFlight = false;
    state.microphoneBuffer = new Float32Array(analyser.fftSize); state.pitchSmoother.reset(); beginPitchTake();
    state.microphoneStatus = 'active'; updateMicrophoneButton();
    await microphoneCalibrationUI?.microphoneReady();
    if (requestGeneration !== state.microphoneRequestGeneration || state.microphoneStatus !== 'active') return;
    applyLiveTrackerSettings();
    startPitchAnalysisLoop();
    showToast('Microfono attivo.');
    if (!state.rafId) state.rafId = requestAnimationFrame(render);
  } catch (error) {
    if (requestGeneration !== state.microphoneRequestGeneration) return;
    state.microphoneStatus = error?.name === 'NotAllowedError' ? 'denied' : 'error';
    state.microphoneFailureMessage = error?.message || 'Microfono non disponibile.';
    updateMicrophoneButton(); showToast(state.microphoneStatus === 'denied' ? 'Permesso microfono negato.' : 'Impossibile avviare il microfono.'); render();
  }
}

function preferenceKey() {
  return `choir-practice:${state.bundleManifest.piece_id ?? state.runtime.title}:${state.runtime.selectedPartId}`;
}

const LAST_PRACTICE_PIECE_KEY = 'choir-last-practice-piece';
const GLOBAL_DETECTOR_PREFERENCES_KEY = PitchShared.PREFERENCE_KEY;
const INTERVAL_ARROWS_PREFERENCE_KEY = 'choir-interval-arrows:v1';

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
  state.pitchAnalysisGeneration += 1;
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
  await pausePracticeForNonExercise();
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
  capture.recorder.onstop = () => save()
    .catch((error) => { els.groundTruthStatus.textContent = `Salvataggio non riuscito: ${error.message}`; })
    .finally(() => {
      state.groundTruth.capture = null;
      void releaseMicrophoneIfUnused();
    });
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
  const pitchSpan = basePitchSpan / view.pitchZoom;
  const baseCenterPitch = (baseMinPitch + baseMaxPitch) / 2 + view.pitchOffset;
  const minPitch = baseCenterPitch - pitchSpan / 2, maxPitch = baseCenterPitch + pitchSpan / 2;
  const span = maxPitch - minPitch;
  const xAt = (beat) => plot.left + (beat - viewStartBeat) / beatSpan * (plot.right - plot.left);
  const yAt = (pitch) => plot.bottom - (pitch - minPitch) / span * (plot.bottom - plot.top);
  view.centerBeat = (viewStartBeat + viewEndBeat) / 2;
  state.benchmark.rollGeometry = { plot, bounds: { min: minPitch, max: maxPitch },
    viewStart: viewStartBeat, viewEnd: viewEndBeat, xAtBeat: xAt, yAtPitch: yAt,
    rowHeight: (plot.bottom - plot.top) / span };
  state.benchmark.navigation?.refresh();
  ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top); ctx.clip();
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
  ctx.restore();
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
  PianoRoll.stopPreview();
  state.benchmark.navigation?.cancel();
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
  const surface = document.createElement('div'); surface.className = 'analysis-roll-surface';
  canvas.before(surface); surface.append(canvas);
  state.benchmark.navigation = PianoRoll.bindNavigation(canvas, {
    enabled: () => Boolean(selectedBenchmarkTake() && !els.benchmarkAnalysis.hidden),
    geometry: () => state.benchmark.rollGeometry,
    view: () => ({ zoom: state.benchmark.analysisView.timeZoom, pitchZoom: state.benchmark.analysisView.pitchZoom, pitchOffset: state.benchmark.analysisView.pitchOffset }),
    change: values => {
      const view = state.benchmark.analysisView;
      if (values.zoom != null) view.timeZoom = values.zoom;
      if (values.pitchZoom != null) view.pitchZoom = values.pitchZoom;
      if (values.centerBeat != null) view.centerBeat = values.centerBeat;
      if (values.pitchOffset != null) view.pitchOffset = Math.max(-128, Math.min(128, values.pitchOffset));
      drawBenchmarkAnalysisRoll(selectedBenchmarkTake());
    },
    reset: () => resetBenchmarkAnalysisView(),
    notes: () => selectedBenchmarkTake()?.targetEvents || [],
    pitchOffset: () => selectedBenchmarkTake()?.transpose || 0,
    notePlayback: note => {
      // Preview is isolated from the original recording and its playhead.
      els.benchmarkAnalysisAudio.pause();
      return { volume: Number(els.volume.value) / 100 };
    },
    tap: (event, note) => {
      const take = selectedBenchmarkTake();
      if (take) selectBenchmarkAnalysisBeat(take, note?.onsetBeat ?? benchmarkBeatAtCanvasX(take, event.clientX));
    },
    hover: event => { const take = selectedBenchmarkTake(); if (take) updateBenchmarkInspection(take, event); },
  });
  canvas.addEventListener('keydown', event => {
    if (event.code !== 'Space') return;
    event.preventDefault(); PianoRoll.stopPreview(); void toggleBenchmarkPlaybackFromSelection();
  });
  els.benchmarkAnalysisAudio.addEventListener('play', () => PianoRoll.stopPreview());
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
  PianoRoll.stopPreview();
  state.benchmark.navigation?.cancel();
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
  await releaseMicrophoneIfUnused();
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
  const recognition = activeRecognitionSettings();
  return {
    estimator: { id: 'yin-style-js', minHz: 70, maxHz: 1000, cmndThreshold: recognition.yinThreshold,
      rmsThreshold: recognition.rmsThreshold },
    tracker: { id: 'PitchSmoother', minClarity: recognition.minClarity, minConfidence: recognition.minConfidence,
      weakSignalHoldFrames: recognition.weakSignalHoldFrames,
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
  void releaseMicrophoneIfUnused();
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
  void releaseMicrophoneIfUnused();
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

function personalRecordingDate(recording) {
  return new Date(recording.updatedAt ?? recording.createdAt).toLocaleString('it-IT', {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

function revokePersonalRecordingPreview() {
  els.personalRecordingPreview.pause();
  els.personalRecordingPreview.removeAttribute('src');
  els.personalRecordingPreview.load();
  if (state.personalRecording.previewUrl) URL.revokeObjectURL(state.personalRecording.previewUrl);
  state.personalRecording.previewUrl = null;
}

function automaticBestStatusText() {
  if (echoCancellationUI?.enabled()) return 'Sospeso con altoparlanti · si salva solo il grafico';
  if (state.automaticBestRecording.loading) return 'Aggiornamento…';
  if (state.automaticBestRecording.error) return state.automaticBestRecording.error;
  return state.automaticBestRecording.enabled
    ? 'Attivo · si aggiorna solo con un nuovo best'
    : 'Disattivo';
}

function renderAutomaticBestPreference() {
  els.personalRecordingAutoBest.checked = state.automaticBestRecording.enabled === true;
  els.personalRecordingAutoBest.disabled = state.automaticBestRecording.loading;
  els.personalRecordingAutoBestStatus.textContent = automaticBestStatusText();
}

async function loadAutomaticBestPreference(force = false) {
  const automatic = state.automaticBestRecording;
  if (!window.PersonalRecordings) return false;
  if (!force && automatic.enabled != null) return automatic.enabled;
  automatic.loading = true;
  automatic.error = null;
  renderAutomaticBestPreference();
  try {
    const result = await PersonalRecordings.automaticBest();
    automatic.enabled = Boolean(result.enabled);
  } catch (_) {
    automatic.enabled = false;
    automatic.error = 'Autorizzazione non disponibile. Riprova tra poco.';
  } finally {
    automatic.loading = false;
    renderAutomaticBestPreference();
  }
  return automatic.enabled;
}

async function updateAutomaticBestPreference() {
  const automatic = state.automaticBestRecording;
  if (!window.PersonalRecordings || automatic.loading) return;
  const enabled = els.personalRecordingAutoBest.checked;
  automatic.loading = true;
  automatic.error = null;
  renderAutomaticBestPreference();
  try {
    const result = await PersonalRecordings.setAutomaticBest(enabled);
    automatic.enabled = Boolean(result.enabled);
    showToast(automatic.enabled ? 'Best audio automatico attivato.' : 'Best audio automatico disattivato.');
  } catch (error) {
    automatic.error = `Aggiornamento non riuscito: ${error.message}`;
  } finally {
    automatic.loading = false;
    renderAutomaticBestPreference();
  }
}

function automaticBestAttemptEligible() {
  return state.automaticBestRecording.enabled === true
    && !echoCancellationUI?.enabled()
    && state.attemptStartedFromBeginning
    && state.transpose === 0
    && Number(els.playbackSpeed.value) === 1
    && Boolean(window.MediaRecorder && state.microphoneStream && state.runtime && state.bundleManifest);
}

function startAutomaticBestCapture() {
  if (state.automaticBestRecording.capture || !automaticBestAttemptEligible()) return;
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : '';
  const options = { audioBitsPerSecond: 48_000 };
  if (mimeType) options.mimeType = mimeType;
  const recorder = new MediaRecorder(state.microphoneStream, options);
  const capture = {
    recorder, chunks: [], takeId: state.pitchTakeId, startedAtMs: performance.now(),
    startAudioTimeSec: state.microphoneContext?.currentTime ?? 0, audioOffsetMs: 0,
    playbackStarted: false, stopping: false, discarded: false,
    pieceId: state.bundleManifest.piece_id, scoreVersionId: state.runtime.scoreVersionId,
    partId: state.runtime.selectedPartId, playbackRate: Number(els.playbackSpeed.value),
    transpose: state.transpose,
  };
  capture.promise = new Promise(resolve => { capture.resolve = resolve; });
  recorder.ondataavailable = event => { if (event.data.size) capture.chunks.push(event.data); };
  recorder.onstop = () => finalizeAutomaticBestCapture(capture);
  recorder.start(250);
  state.automaticBestRecording.capture = capture;
}

function markAutomaticBestPlaybackStarted() {
  const capture = state.automaticBestRecording.capture;
  if (!capture || capture.playbackStarted) return;
  capture.playbackStarted = true;
  capture.audioOffsetMs = Math.max(0, Math.round(
    ((state.microphoneContext?.currentTime ?? capture.startAudioTimeSec) - capture.startAudioTimeSec) * 1000));
}

function finalizeAutomaticBestCapture(capture) {
  if (capture.finalized) return;
  capture.finalized = true;
  if (state.automaticBestRecording.capture === capture) state.automaticBestRecording.capture = null;
  if (capture.discarded) { capture.resolve(null); return; }
  const samples = state.pitchSamples
    .filter(sample => sample.takeId === capture.takeId && Number.isFinite(sample.displayPitch))
    .map(sample => ({ beat: Number(sample.beat.toFixed(5)), displayPitch: Number(sample.displayPitch.toFixed(5)),
      confidence: Number(Math.max(0, Math.min(1, sample.confidence ?? 0)).toFixed(5)),
      confirmationState: sample.confirmationState ?? 'confirmed' }));
  const audio = new Blob(capture.chunks, { type: capture.recorder.mimeType || 'audio/webm' });
  if (!audio.size || !samples.length) { capture.resolve(null); return; }
  const durationMs = Math.max(1, Math.round(performance.now() - capture.startedAtMs));
  capture.resolve({ ...capture, recorder: null, chunks: null, audio, durationMs,
    pitchDocument: { version: 1, totalBeats: totalBeats(), durationMs,
      audioOffsetMs: capture.audioOffsetMs, playbackRate: capture.playbackRate,
      transpose: capture.transpose, samples } });
}

function stopAutomaticBestCapture({ discard = false } = {}) {
  const capture = state.automaticBestRecording.capture;
  if (!capture) return Promise.resolve(null);
  if (discard) capture.discarded = true;
  if (capture.stopping) return capture.promise;
  capture.stopping = true;
  try {
    if (capture.recorder.state === 'inactive') finalizeAutomaticBestCapture(capture);
    else capture.recorder.stop();
  } catch (_) { capture.discarded = true; finalizeAutomaticBestCapture(capture); }
  return capture.promise;
}

function updatePersonalRecordingControls() {
  const personal = state.personalRecording;
  const current = personal.current;
  const pending = personal.pending;
  const busy = personal.loading || personal.saving || Boolean(personal.capture);
  const ready = els.personalRecordingHeadphones.checked && els.personalRecordingStorageConsent.checked;
  els.personalRecordingCurrent.hidden = !current;
  if (current) {
    const part = state.runtime?.parts.find(item => item.id === current.partId)?.name ?? current.partId;
    const sharing = current.sharedForAnalysis ? 'condivisa con il direttore' : 'privata';
    els.personalRecordingCurrentSummary.textContent = `${part} · ${personalRecordingDate(current)} · ${Math.round(current.durationMs / 1000)} s · ${sharing}.`;
  }
  els.personalRecordingSharing.hidden = !current || Boolean(pending);
  els.personalRecordingSharing.disabled = busy;
  els.personalRecordingSharing.textContent = current?.sharedForAnalysis ? 'Revoca condivisione' : 'Condividi';
  els.personalRecordingReview.hidden = !pending;
  els.personalRecordingConsent.disabled = Boolean(pending) || busy;
  els.personalRecordingStart.hidden = Boolean(pending);
  els.personalRecordingStart.disabled = !ready || busy;
  els.personalRecordingStart.textContent = current ? 'Registra una nuova versione' : 'Registra dal principio';
  els.personalRecordingReplay.hidden = !current || Boolean(pending);
  els.personalRecordingReplay.disabled = busy;
  els.personalRecordingDelete.hidden = !current || Boolean(pending);
  els.personalRecordingDelete.disabled = busy;
  els.personalRecordingSave.disabled = !pending || personal.saving;
  els.personalRecordingDiscard.disabled = !pending || personal.saving;
  els.personalRecordingClose.disabled = Boolean(personal.capture) || personal.saving;
  if (pending) {
    els.personalRecordingSave.textContent = current ? 'Sostituisci la registrazione' : 'Salva nel profilo';
    els.personalRecordingReviewSummary.textContent = `${Math.round(pending.durationMs / 1000)} s · ${pending.pitchDocument.samples.length} campioni pitch. Ascolta e poi scegli se salvare o scartare.`;
  }
}

async function refreshPersonalRecording() {
  const personal = state.personalRecording;
  if (!window.PersonalRecordings || !state.bundleManifest?.piece_id) {
    personal.current = null;
    els.personalRecordingStatus.textContent = 'Il profilo registrazioni non è disponibile in questa modalità.';
    updatePersonalRecordingControls();
    return;
  }
  personal.loading = true; updatePersonalRecordingControls();
  try {
    const result = await PersonalRecordings.mine(state.bundleManifest.piece_id);
    personal.current = result.recordings?.[0] ?? null;
    if (personal.current) els.personalRecordingAnalysisConsent.checked = Boolean(personal.current.sharedForAnalysis);
    els.personalRecordingStatus.textContent = personal.current
      ? 'Puoi riascoltare la registrazione salvata oppure crearne una nuova e decidere se sostituirla.'
      : 'Nessuna registrazione salvata per questo brano.';
  } catch (error) {
    personal.current = null;
    els.personalRecordingStatus.textContent = `Profilo non disponibile: ${error.message}`;
  } finally { personal.loading = false; updatePersonalRecordingControls(); }
}

async function updatePersonalRecordingSharing() {
  const personal = state.personalRecording; const current = personal.current;
  if (!current || !window.PersonalRecordings) return;
  const sharedForAnalysis = !current.sharedForAnalysis;
  personal.loading = true; updatePersonalRecordingControls();
  try {
    const result = await PersonalRecordings.setSharing(current.id, sharedForAnalysis);
    personal.current = result.recording;
    els.personalRecordingAnalysisConsent.checked = sharedForAnalysis;
    if (!sharedForAnalysis && state.automaticBestRecording.enabled) {
      await PersonalRecordings.setAutomaticBest(false);
      state.automaticBestRecording.enabled = false;
      renderAutomaticBestPreference();
    }
    els.personalRecordingStatus.textContent = sharedForAnalysis
      ? 'Registrazione condivisa: il direttore può ora aprirla nel Pitch Detection Lab.'
      : 'Condivisione revocata: il direttore non può più accedere all’audio.';
    showToast(sharedForAnalysis ? 'Accesso al Pitch Lab abilitato.' : 'Accesso del direttore revocato.');
  } catch (error) { els.personalRecordingStatus.textContent = `Aggiornamento non riuscito: ${error.message}`; }
  finally { personal.loading = false; updatePersonalRecordingControls(); }
}

async function openPersonalRecordingDialog() {
  closeSettingsMenu();
  if (state.personalRecording.replay) stopPersonalRecordingReplay();
  if (state.clock?.running) state.clock.pause();
  await releaseMicrophoneIfUnused();
  updatePlaybackButton();
  if (!state.personalRecording.pending) {
    els.personalRecordingStatus.textContent = 'Caricamento della registrazione personale…';
    void refreshPersonalRecording();
  }
  void loadAutomaticBestPreference(true);
  updatePersonalRecordingControls();
  if (!els.personalRecordingDialog.open) els.personalRecordingDialog.showModal();
}

function closePersonalRecordingDialog() {
  if (state.personalRecording.capture || state.personalRecording.pending || state.personalRecording.saving) {
    els.personalRecordingStatus.textContent = 'Prima salva o scarta la nuova registrazione.';
    return false;
  }
  els.personalRecordingDialog.close();
  return true;
}

function handlePersonalRecordingDialogClick(event) {
  const selectedInfo = event.target.closest?.('.setting-info');
  const shouldOpenInfo = Boolean(selectedInfo && !selectedInfo.classList.contains('is-open'));
  els.personalRecordingDialog.querySelectorAll('.setting-info.is-open')
    .forEach(button => button.classList.remove('is-open'));
  if (shouldOpenInfo) {
    selectedInfo.classList.add('is-open');
    return;
  }
  if (event.target !== els.personalRecordingDialog) return;
  const rect = els.personalRecordingDialog.getBoundingClientRect();
  const outsideDialog = event.clientX < rect.left || event.clientX > rect.right
    || event.clientY < rect.top || event.clientY > rect.bottom;
  if (outsideDialog) closePersonalRecordingDialog();
}

async function startPersonalRecordingCapture() {
  if (echoCancellationUI?.enabled()) {
    els.personalRecordingStatus.textContent = 'Per registrare usa le cuffie e disattiva la modalità altoparlanti.';
    return;
  }
  const personal = state.personalRecording;
  if (!els.personalRecordingHeadphones.checked) {
    els.personalRecordingStatus.textContent = 'La registrazione è disponibile soltanto usando cuffie.';
    return;
  }
  if (!els.personalRecordingStorageConsent.checked) {
    els.personalRecordingStatus.textContent = 'Serve il consenso esplicito per registrare e salvare la voce nel profilo.';
    return;
  }
  if (!window.MediaRecorder || !window.PersonalRecordings) {
    els.personalRecordingStatus.textContent = 'Questo browser non supporta la registrazione personale.';
    return;
  }
  if (personal.pending) discardPersonalRecordingPending();
  if (personal.replay) stopPersonalRecordingReplay();
  if (state.clock.running) state.clock.pause();
  if (state.microphoneStatus !== 'active') await toggleMicrophone();
  if (state.microphoneStatus !== 'active' || !state.microphoneStream) {
    els.personalRecordingStatus.textContent = 'Autorizza il microfono per registrare la tua voce.';
    return;
  }
  clearPitchHistory();
  seekToMeasure(0, false, false);
  await waitForMediaReady(els.backingAudio, 2);
  applyPendingAudioSeek();
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : '';
  const recorderOptions = { audioBitsPerSecond: 48_000 };
  if (mimeType) recorderOptions.mimeType = mimeType;
  const recorder = new MediaRecorder(state.microphoneStream, recorderOptions);
  const capture = {
    recorder, chunks: [], takeId: state.pitchTakeId, startedAt: new Date().toISOString(),
    startedAtMs: performance.now(), startAudioTimeSec: state.microphoneContext.currentTime,
    audioOffsetMs: 0, stopping: false,
    pieceId: state.bundleManifest.piece_id, scoreVersionId: state.runtime.scoreVersionId,
    partId: state.runtime.selectedPartId, playbackRate: Number(els.playbackSpeed.value),
    transpose: state.transpose,
  };
  personal.capture = capture;
  updateMicrophoneButton();
  recorder.ondataavailable = event => { if (event.data.size) capture.chunks.push(event.data); };
  recorder.start(250);
  els.personalRecordingLive.hidden = false;
  els.personalRecordingLiveTitle.textContent = '● Registrazione personale';
  els.personalRecordingLiveDetail.textContent = 'Voce e pitch in acquisizione. Le cuffie devono restare collegate.';
  els.personalRecordingStopLive.textContent = 'Interrompi';
  els.personalRecordingDialog.close();
  try {
    await state.playbackMixer.resume([els.backingAudio, ...state.voiceStemAudio.values()]);
    syncBackingLevel(); syncVoiceStemLevels();
    await state.clock.play();
    capture.audioOffsetMs = Math.max(0, Math.round((state.microphoneContext.currentTime - capture.startAudioTimeSec) * 1000));
    state.attemptActive = false;
    updatePlaybackButton();
    if (!state.rafId) state.rafId = requestAnimationFrame(render);
  } catch (error) {
    els.personalRecordingStatus.textContent = `Il brano non è partito: ${error.message ?? 'errore audio'}.`;
    stopPersonalRecordingCapture({ discard: true });
    if (!els.personalRecordingDialog.open) els.personalRecordingDialog.showModal();
  }
}

function finalizePersonalRecordingCapture(capture) {
  if (capture.finalized) return;
  capture.finalized = true;
  const durationMs = Math.max(1, Math.round(performance.now() - capture.startedAtMs));
  const audio = new Blob(capture.chunks, { type: capture.recorder.mimeType || 'audio/webm' });
  const samples = state.pitchSamples
    .filter(sample => sample.takeId === capture.takeId && Number.isFinite(sample.displayPitch))
    .map(sample => ({ beat: Number(sample.beat.toFixed(5)), displayPitch: Number(sample.displayPitch.toFixed(5)),
      confidence: Number(Math.max(0, Math.min(1, sample.confidence ?? 0)).toFixed(5)),
      confirmationState: sample.confirmationState ?? 'confirmed' }));
  const pitchDocument = { version: 1, totalBeats: totalBeats(), durationMs,
    audioOffsetMs: capture.audioOffsetMs, playbackRate: capture.playbackRate,
    transpose: capture.transpose, samples };
  state.personalRecording.pending = { ...capture, recorder: null, chunks: null, durationMs, audio, pitchDocument };
  state.personalRecording.capture = null;
  updateMicrophoneButton();
  revokePersonalRecordingPreview();
  state.personalRecording.previewUrl = URL.createObjectURL(audio);
  els.personalRecordingPreview.src = state.personalRecording.previewUrl;
  els.personalRecordingStatus.textContent = samples.length
    ? 'Registrazione pronta: ascoltala e scegli se salvarla nel profilo o scartarla.'
    : 'La voce è stata registrata, ma non è stato rilevato pitch: conviene scartare e riprovare più vicino al microfono.';
  els.personalRecordingLive.hidden = true;
  updatePersonalRecordingControls();
  if (!els.personalRecordingDialog.open) els.personalRecordingDialog.showModal();
  void stopMicrophone();
}

function stopPersonalRecordingCapture({ discard = false } = {}) {
  const capture = state.personalRecording.capture;
  if (!capture || capture.stopping) return;
  capture.stopping = true;
  if (state.clock?.running) state.clock.pause();
  updatePlaybackButton();
  els.personalRecordingLive.hidden = true;
  if (discard) {
    capture.recorder.onstop = () => {};
    if (capture.recorder.state !== 'inactive') capture.recorder.stop();
    state.personalRecording.capture = null;
    updateMicrophoneButton();
    void stopMicrophone();
    return;
  }
  capture.recorder.onstop = () => finalizePersonalRecordingCapture(capture);
  if (capture.recorder.state === 'inactive') finalizePersonalRecordingCapture(capture);
  else capture.recorder.stop();
}

function discardPersonalRecordingPending() {
  state.personalRecording.pending = null;
  revokePersonalRecordingPreview();
  els.personalRecordingStatus.textContent = 'Nuova registrazione scartata. Quella già salvata, se presente, non è stata modificata.';
  updatePersonalRecordingControls();
}

async function savePersonalRecording() {
  const personal = state.personalRecording;
  const pending = personal.pending;
  if (!pending || personal.saving) return;
  if (!pending.pitchDocument.samples.length) {
    els.personalRecordingStatus.textContent = 'Non posso salvare un replay senza campioni pitch. Scarta e riprova.';
    return;
  }
  personal.saving = true;
  els.personalRecordingStatus.textContent = personal.current
    ? 'Sostituzione della registrazione nel profilo…' : 'Salvataggio nel profilo…';
  updatePersonalRecordingControls();
  try {
    const result = await PersonalRecordings.save({
      pieceId: pending.pieceId, scoreVersionId: pending.scoreVersionId, partId: pending.partId,
      durationMs: pending.durationMs, audioOffsetMs: pending.audioOffsetMs,
      playbackRate: pending.playbackRate, transpose: pending.transpose,
      consent: true, headphonesConfirmed: true,
      sharedForAnalysis: Boolean(els.personalRecordingAnalysisConsent.checked),
      replaceExisting: Boolean(personal.current),
    }, pending.audio, pending.pitchDocument);
    personal.current = result.recording;
    personal.pending = null;
    revokePersonalRecordingPreview();
    els.personalRecordingStatus.textContent = result.updated
      ? 'Registrazione precedente sostituita. Il nuovo replay è pronto.'
      : 'Registrazione salvata nel tuo profilo privato.';
    showToast(result.updated ? 'Registrazione sostituita.' : 'Registrazione salvata.');
  } catch (error) {
    if (error.status === 409 && error.payload?.recording) personal.current = error.payload.recording;
    els.personalRecordingStatus.textContent = error.status === 409
      ? 'Esiste già una registrazione: ricontrolla e premi di nuovo “Sostituisci”.'
      : `Salvataggio non riuscito: ${error.message}`;
  } finally { personal.saving = false; updatePersonalRecordingControls(); }
}

async function deletePersonalRecording() {
  const recording = state.personalRecording.current;
  if (!recording || !confirm('Eliminare definitivamente la registrazione personale di questo brano?')) return;
  state.personalRecording.loading = true; updatePersonalRecordingControls();
  try {
    await PersonalRecordings.delete(recording.id);
    state.personalRecording.current = null;
    els.personalRecordingStatus.textContent = 'Registrazione eliminata dal profilo.';
    showToast('Registrazione personale eliminata.');
  } catch (error) {
    els.personalRecordingStatus.textContent = `Eliminazione non riuscita: ${error.message}`;
  } finally { state.personalRecording.loading = false; updatePersonalRecordingControls(); }
}

function personalReplayAudioTime() {
  const replay = state.personalRecording.replay;
  if (!replay) return 0;
  return replay.audioOffsetMs / 1000 + playbackSnapshot().performanceTime / replay.playbackRate;
}

function syncPersonalRecordingReplayAudio(force = false) {
  const replay = state.personalRecording.replay;
  if (!replay || els.personalRecordingReplayAudio.readyState < 1) return;
  const target = Math.max(0, Math.min(els.personalRecordingReplayAudio.duration || Infinity, personalReplayAudioTime()));
  if (force || Math.abs(els.personalRecordingReplayAudio.currentTime - target) > .12) {
    try { els.personalRecordingReplayAudio.currentTime = target; } catch (_) {}
  }
}

async function startPersonalRecordingReplay() {
  const recording = state.personalRecording.current;
  if (!recording) return;
  if (recording.scoreVersionId !== state.runtime.scoreVersionId) {
    els.personalRecordingStatus.textContent = 'Questa registrazione usa una versione precedente dello spartito. Creane una nuova per mantenere il replay sincronizzato.';
    return;
  }
  state.personalRecording.loading = true; updatePersonalRecordingControls();
  try {
    const pitchDocument = await PersonalRecordings.pitch(recording);
    if (state.clock.running) state.clock.pause();
    if (state.microphoneStatus !== 'idle') await stopMicrophone();
    if (state.runtime.parts.some(part => part.id === recording.partId) && state.runtime.selectedPartId !== recording.partId) {
      changePart(recording.partId);
      els.partSelector.value = recording.partId;
    }
    state.transpose = recording.transpose;
    els.transpose.value = String(recording.transpose);
    updateTransposeControl();
    state.playbackMixer.setTranspose(state.transpose);
    els.playbackSpeed.value = String(recording.playbackRate);
    if (state.usesPreRenderedSpeed) state.clock.setPreRenderedSpeed(recording.playbackRate);
    else state.clock.setSpeed(recording.playbackRate);
    await applyVoiceSelection(state.selectedVoiceIds);
    seekToMeasure(0, false, false);
    els.personalRecordingReplayAudio.src = recording.audioUrl;
    els.personalRecordingReplayAudio.playbackRate = 1;
    await Promise.all([waitForMediaReady(els.backingAudio, 2), waitForMediaReady(els.personalRecordingReplayAudio, 1)]);
    applyPendingAudioSeek();
    state.personalRecording.replay = { ...recording, pitchSamples: pitchDocument.samples.map(sample => ({
      ...sample, takeId: -1, confirmationState: sample.confirmationState ?? 'confirmed',
    })) };
    syncPersonalRecordingReplayAudio(true);
    els.personalRecordingLive.hidden = false;
    els.personalRecordingLiveTitle.textContent = '▶ Replay della tua registrazione';
    els.personalRecordingLiveDetail.textContent = 'Ascolto della voce e pitch detection sul brano.';
    els.personalRecordingStopLive.textContent = 'Esci dal replay';
    els.personalRecordingDialog.close();
    await state.playbackMixer.resume([els.backingAudio, ...state.voiceStemAudio.values()]);
    syncBackingLevel(); syncVoiceStemLevels();
    await Promise.all([state.clock.play(), els.personalRecordingReplayAudio.play()]);
    state.attemptActive = false;
    updatePlaybackButton(); render();
  } catch (error) {
    stopPersonalRecordingReplay();
    els.personalRecordingStatus.textContent = `Replay non disponibile: ${error.message}`;
    if (!els.personalRecordingDialog.open) els.personalRecordingDialog.showModal();
  } finally { state.personalRecording.loading = false; updatePersonalRecordingControls(); }
}

function stopPersonalRecordingReplay() {
  const wasReplaying = Boolean(state.personalRecording.replay);
  if (wasReplaying && state.clock?.running) state.clock.pause();
  els.personalRecordingReplayAudio.pause();
  els.personalRecordingReplayAudio.removeAttribute('src');
  els.personalRecordingReplayAudio.load();
  state.personalRecording.replay = null;
  els.personalRecordingLive.hidden = true;
  if (wasReplaying) { updatePlaybackButton(); render(); }
}

async function togglePersonalRecordingReplayPlayback() {
  if (!state.personalRecording.replay) return;
  if (state.clock.running) {
    state.clock.pause();
    els.personalRecordingReplayAudio.pause();
  } else {
    if (playbackSnapshot().beat >= totalBeats()) seekToMeasure(0, false, false);
    syncPersonalRecordingReplayAudio(true);
    await state.playbackMixer.resume([els.backingAudio, ...state.voiceStemAudio.values()]);
    await Promise.all([state.clock.play(), els.personalRecordingReplayAudio.play()]);
  }
  updatePlaybackButton(); render();
}

function showAttemptResult({ preliminary = false } = {}) {
  void releaseMicrophoneIfUnused();
  els.resultDialog.dataset.preliminary = String(preliminary);
  els.resultHeading.textContent = preliminary ? 'Analisi preliminare' : 'Analisi della prova completata';
  els.retry.textContent = preliminary ? 'Ricomincia' : 'Riprova';
  els.resultResume.hidden = !preliminary;
  els.resultProgress.textContent = '';
  if (preliminary) {
    const measure = state.occurrenceMeasures[measureIndexAt(playbackSnapshot().beat)];
    els.resultProgress.textContent = `Calcolato fino alla battuta ${measure?.number ?? 'corrente'}. Puoi riprendere dallo stesso punto senza perdere i dati raccolti.`;
  }
  if (state.attempt.voicedMs < 1000) {
    els.resultText.textContent = 'Voce riconosciuta per meno di un secondo: dati insufficienti per valutare questa prova.';
  } else {
    const score = Math.round(state.attempt.insideMs / state.attempt.voicedMs * 100);
    const prefix = preliminary ? 'Finora, ' : '';
    els.resultText.textContent = `${prefix}${score}% del tempo di voce riconosciuta entro ±${UI_CONFIG.acceptableCents} cent dal target. Silenzio e segnale incerto sono esclusi.`;
    if (!preliminary) {
      const key = `${preferenceKey()}:result:${state.runtime.scoreVersionId}:complete:${state.transpose}:${els.playbackSpeed.value}`;
      try {
        const previous = JSON.parse(localStorage.getItem(key));
        if (previous && Number.isFinite(previous.score)) {
          const delta = score - previous.score;
          els.resultProgress.textContent = delta === 0 ? 'Stesso risultato del tentativo precedente.' : `${delta > 0 ? '+' : ''}${delta} punti percentuali rispetto al tentativo precedente.`;
        }
        localStorage.setItem(key, JSON.stringify({ score }));
      } catch (_) {}
    }
  }
  if (!els.resultDialog.open) els.resultDialog.showModal();
  if (RUNTIME_CONFIG.features?.performances) void loadPerformanceHub();
}

function attemptCoveragePercent() {
  if (!state.runtime) return 0;
  const targetMs = state.runtime.targetEvents.reduce((total, event) => {
    const start = event.onsetBeat + (event.attackGraceBeats || 0);
    const end = event.onsetBeat + event.durationBeats;
    return total + Math.max(0, state.runtime.secondsAtBeat(end) - state.runtime.secondsAtBeat(start)) * 1000;
  }, 0);
  return targetMs > 0 ? Math.min(100, state.attempt.voicedMs / targetMs * 100) : 0;
}

function canonicalVoicePart(name = '', id = '') {
  const value = `${name} ${id}`.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (value.includes('sopran')) return 'soprano';
  if (value.includes('contralt') || /\balto\b/.test(value)) return 'contralto';
  if (value.includes('tenor')) return 'tenore';
  if (value.includes('bass')) return 'basso';
  return null;
}

function monitoringAttemptSnapshot(completed) {
  if (!state.runtime || !state.bundleManifest || !state.performanceMe?.voicePart) return null;
  const part = state.runtime.parts.find(item => item.id === state.runtime.selectedPartId);
  if (canonicalVoicePart(part?.name, part?.id) !== state.performanceMe.voicePart) return null;
  const takeId = state.pitchTakeId;
  const samples = state.pitchSamples
    .filter(sample => sample.takeId === takeId && window.PianoRoll.isAcceptedObservation(sample))
    .map(sample => {
      const target = state.runtime.targetAt(sample.beat);
      if (!target || !Number.isFinite(target.midiPitch)) return null;
      return {
        beat: Number(sample.beat.toFixed(4)),
        displayPitch: Number(sample.displayPitch.toFixed(4)),
        targetPitch: Number(target.midiPitch.toFixed(4)),
        errorCents: Number(((sample.trackedPitch - target.midiPitch) * 100).toFixed(2)),
        confidence: Number(Math.max(0, Math.min(1, sample.confidence ?? 0)).toFixed(4)),
      };
    }).filter(Boolean);
  if (!samples.length) return null;
  const stride = Math.max(1, Math.ceil(samples.length / 2400));
  const sharedSamples = samples.filter((_, index) => index % stride === 0).slice(0, 2400);
  const segments = state.occurrenceMeasures.map((measure, occurrence) => {
    const segmentSamples = samples.filter(sample => sample.beat >= measure.startBeat && sample.beat < measure.endBeat);
    return {
      occurrence, measureNumber: String(measure.number), startBeat: Number(measure.startBeat.toFixed(4)),
      endBeat: Number(measure.endBeat.toFixed(4)), sampleCount: segmentSamples.length,
      outOfToleranceCount: segmentSamples.filter(sample => Math.abs(sample.errorCents) > 100).length,
    };
  });
  const coverage = attemptCoveragePercent();
  const score = Math.round(samples.filter(sample => Math.abs(sample.errorCents) <= 100).length / samples.length * 100);
  return {
    key: `${takeId}:${completed}:${Math.round(state.attempt.voicedMs / 1000)}`,
    payload: {
      pieceId: state.bundleManifest.piece_id, scoreVersionId: state.runtime.scoreVersionId,
      partId: state.runtime.selectedPartId, startedFromBeginning: state.attemptStartedFromBeginning,
      reachedEnd: completed, completed, score, coverage: Number(coverage.toFixed(3)),
      voicedMs: Math.round(state.attempt.voicedMs), playbackRate: Number(els.playbackSpeed.value),
      transpose: state.transpose,
      trace: { version: 1, totalBeats: totalBeats(), samples: sharedSamples, segments },
    },
  };
}

async function ensureMonitoringConsent() {
  if (!window.ProgressTracking) return false;
  if (state.monitoringConsent === true) return true;
  if (state.monitoringConsentPromise) return state.monitoringConsentPromise;
  const status = await ProgressTracking.consent();
  if (status.accepted) { state.monitoringConsent = true; return true; }
  const resultWasOpen = els.resultDialog.open;
  if (resultWasOpen) els.resultDialog.close();
  els.monitoringConsentCheck.checked = false;
  els.monitoringConsentAccept.disabled = true;
  els.monitoringConsentStatus.textContent = '';
  state.monitoringConsentPromise = new Promise(resolve => {
    const finish = accepted => {
      state.monitoringConsent = accepted;
      state.monitoringConsentPromise = null;
      if (els.monitoringConsentDialog.open) els.monitoringConsentDialog.close();
      if (resultWasOpen && !els.resultDialog.open) els.resultDialog.showModal();
      resolve(accepted);
    };
    els.monitoringConsentAccept.onclick = async () => {
      els.monitoringConsentAccept.disabled = true;
      els.monitoringConsentStatus.textContent = 'Salvataggio del consenso…';
      try { await ProgressTracking.accept(); finish(true); }
      catch (_) {
        els.monitoringConsentStatus.textContent = 'Non riesco a salvare il consenso. Riprova.';
        els.monitoringConsentAccept.disabled = false;
      }
    };
    els.monitoringConsentDecline.onclick = () => finish(false);
    els.monitoringConsentDialog.oncancel = event => { event.preventDefault(); finish(false); };
  });
  els.monitoringConsentDialog.showModal();
  return state.monitoringConsentPromise;
}

async function sharePracticeProgress({ completed }) {
  const snapshot = monitoringAttemptSnapshot(completed);
  if (!snapshot || state.progressSubmitted.has(snapshot.key)) return;
  if (!(await ensureMonitoringConsent())) return;
  state.progressSubmitted.add(snapshot.key);
  try {
    const result = await ProgressTracking.submit(snapshot.payload);
    if (!result.ignored && els.resultDialog.open) {
      const label = result.status === 'ready' ? 'Pronto' : result.completed ? 'Completato' : 'In esercizio';
      els.resultProgress.textContent += `${els.resultProgress.textContent ? ' ' : ''}Avanzamento aggiornato: ${label}.`;
    }
  } catch (error) {
    state.progressSubmitted.delete(snapshot.key);
    if (error.status !== 409 && els.resultDialog.open) {
      els.resultProgress.textContent += `${els.resultProgress.textContent ? ' ' : ''}Aggiornamento dell’avanzamento non riuscito.`;
    }
  }
}

async function shareCompletedAttempt(automaticCapture = Promise.resolve(null)) {
  if (!window.PerformanceSharing || !RUNTIME_CONFIG.features?.performances || state.attempt.voicedMs < 1000) return;
  const score = Math.round(state.attempt.insideMs / state.attempt.voicedMs * 100);
  const coverage = attemptCoveragePercent();
  if (!state.attemptStartedFromBeginning) {
    els.resultProgress.textContent += `${els.resultProgress.textContent ? ' ' : ''}Il best condiviso richiede una prova iniziata dalla prima battuta.`;
    return;
  }
  if (state.transpose !== 0 || Number(els.playbackSpeed.value) !== 1) {
    els.resultProgress.textContent += `${els.resultProgress.textContent ? ' ' : ''}Il best condiviso richiede tonalità originale e velocità 100%.`;
    return;
  }
  if (coverage < PerformanceSharing.MIN_COVERAGE) {
    els.resultProgress.textContent += `${els.resultProgress.textContent ? ' ' : ''}Copertura ${coverage.toFixed(1)}%: serve almeno ${PerformanceSharing.MIN_COVERAGE}% per il best condiviso.`;
    return;
  }
  const takeId = state.pitchTakeId;
  const targetEvents = state.runtime.targetEvents.map(event => ({
    onsetBeat: event.onsetBeat, durationBeats: event.durationBeats, midiPitch: event.midiPitch,
  }));
  const pitchSamples = state.pitchSamples.filter(sample => sample.takeId === takeId)
    .map(sample => ({ beat: sample.beat, displayPitch: sample.displayPitch, trackedPitch: sample.trackedPitch,
      confidence: sample.confidence, confirmationState: sample.confirmationState }));
  const part = state.runtime.parts.find(item => item.id === state.runtime.selectedPartId);
  const piece = state.library?.find(item => item.piece_id === state.bundleManifest?.piece_id);
  const pieceId = state.bundleManifest.piece_id;
  const scoreVersionId = state.runtime.scoreVersionId;
  const partId = state.runtime.selectedPartId;
  const image = await PerformanceSharing.renderPianoRoll({
    title: piece?.title ?? state.runtime.title,
    partName: part?.name, scoreVersionId, scoringProfile: PerformanceSharing.PROFILE,
    score, coverage, totalBeats: totalBeats(), targetEvents, pitchSamples,
    measures: state.occurrenceMeasures.map(measure => ({ startBeat: measure.startBeat, number: measure.number })),
  });
  const result = await PerformanceSharing.submitBest({
    pieceId, scoreVersionId, partId,
    scoringProfile: PerformanceSharing.PROFILE,
    score, coverage: coverage.toFixed(3), completed: true,
  }, image);
  let message = result.updated ? 'Nuovo best condiviso salvato.' : 'Il best condiviso precedente resta migliore.';
  const capture = await automaticCapture;
  if (result.updated && capture && window.PersonalRecordings) {
    try {
      const saved = await PersonalRecordings.save({
        pieceId: capture.pieceId, scoreVersionId: capture.scoreVersionId, partId: capture.partId,
        durationMs: capture.durationMs, audioOffsetMs: capture.audioOffsetMs,
        playbackRate: capture.playbackRate, transpose: capture.transpose,
        consent: true, headphonesConfirmed: true, sharedForAnalysis: true, replaceExisting: true,
      }, capture.audio, capture.pitchDocument);
      state.personalRecording.current = saved.recording;
      message += ' Audio Pitch Lab aggiornato automaticamente.';
    } catch (_) {
      message += ' Il best è salvo, ma l’audio Pitch Lab non è stato aggiornato.';
    }
  }
  els.resultProgress.textContent += `${els.resultProgress.textContent ? ' ' : ''}${message}`;
  if (els.resultDialog.open) void loadPerformanceHub();
}

function performancePieceTitle(pieceId) {
  return state.library?.find(piece => piece.piece_id === pieceId)?.title ?? pieceId.replaceAll('-', ' ');
}

async function openPerformanceAnalysis(performance) {
  if (!window.PerformanceReview) return;
  const returnFocus = document.activeElement;
  await pausePracticeForNonExercise();
  els.resultDialog.close();
  const analysisPromise = PerformanceSharing.analysis(performance.id).catch(() => null);
  const musicPromise = (async () => {
    const bundle = await loadBundleManifest(performance.pieceId);
    const [payload] = await loadPieceData(performance.pieceId, bundle);
    const runtime = NormalizedScoreRuntime.fromNormalizedScore(bundle.monodic ? monodicPracticePayload(payload) : payload);
    runtime.selectPart(performance.partId);
    const scoreSource = bundle.assets.continuous_scores?.[performance.partId]
      ?? bundle.assets.score_pages?.[performance.partId]?.[0] ?? null;
    const scoreUrl = scoreSource ? releaseAssetUrl(scoreSource) : '';
    let scoreSlots = [];
    if (scoreUrl) {
      try {
        const response = await fetch(scoreUrl, { cache: 'force-cache' });
        if (response.ok) scoreSlots = scorePageFallbackSlots(await response.text(), 1);
      } catch (_) { /* Linear synchronization remains available as a fallback. */ }
    }
    return {
      targetEvents: runtime.targetEvents,
      measures: buildOccurrenceMeasures(runtime),
      totalBeats: runtime.performanceOccurrences.at(-1)?.endBeat
        ?? Math.max(1, ...runtime.targetEvents.map(event => event.onsetBeat + event.durationBeats)),
      scoreUrl, scoreSlots,
    };
  })().catch(() => ({ targetEvents: [], measures: [], totalBeats: 1, scoreUrl: '', scoreSlots: [] }));
  const [analysis, music] = await Promise.all([analysisPromise, musicPromise]);
  PerformanceReview.open({
    performance, title: performancePieceTitle(performance.pieceId), analysis, returnFocus,
    targetEvents: music.targetEvents, measures: music.measures,
    totalBeats: music.totalBeats, scoreUrl: music.scoreUrl, scoreSlots: music.scoreSlots,
    backLabel: 'Risultati', onPractice: async ({ beat }) => {
      if (!canNavigatePractice()) return false;
      await loadPracticePiece(performance.pieceId, { partId: performance.partId, updateHistory: true });
      const target = Number.isFinite(beat) ? beat : 0;
      seekToMeasure(measureIndexAt(target), false, false);
      window.PerformanceReview.close({ notify: false });
      els.togglePlayback.focus();
      return true;
    }, onClose: () => {
      if (!els.resultDialog.open) els.resultDialog.showModal();
    },
  });
}

function renderPerformanceCards(performances, own = false) {
  els.performanceList.replaceChildren();
  els.performanceStatus.hidden = performances.length > 0;
  els.performanceStatus.textContent = performances.length ? '' : 'Nessun best score disponibile in questo ambito.';
  for (const performance of performances) {
    const card = document.createElement('article'); card.className = 'performance-card';
    const image = document.createElement('img'); image.src = performance.imageUrl;
    image.alt = `Piano roll di ${performance.owner.displayName}, ${performancePieceTitle(performance.pieceId)}, punteggio ${performance.score}%`;
    const body = document.createElement('div'); body.className = 'performance-card-body';
    const title = document.createElement('strong'); title.textContent = performancePieceTitle(performance.pieceId);
    const owner = document.createElement('small'); owner.textContent = `${performance.owner.displayName} · parte ${performance.partId} · copertura ${Number(performance.coverage).toFixed(1)}%`;
    const score = document.createElement('span'); score.className = 'performance-score'; score.textContent = `${performance.score}%`;
    body.append(title, score, owner); card.append(image, body);
    const open = document.createElement('button'); open.type = 'button'; open.className = 'performance-open'; open.textContent = 'Apri analisi';
    open.addEventListener('click', () => void openPerformanceAnalysis(performance));
    card.append(open);
    if (own) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'performance-delete'; remove.textContent = 'Elimina';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try { await PerformanceSharing.delete(performance.id); await loadOwnPerformances(); }
        catch (_) { els.performanceStatus.hidden = false; els.performanceStatus.textContent = 'Eliminazione non riuscita. Riprova.'; remove.disabled = false; }
      });
      card.append(remove);
    }
    els.performanceList.append(card);
  }
}

function selectPerformanceTab(button) {
  els.performanceTabs.querySelectorAll('button').forEach(item => item.classList.toggle('is-active', item === button));
}

async function loadOwnPerformances(button = els.performanceTabs.querySelector('[data-scope="mine"]')) {
  if (button) selectPerformanceTab(button);
  els.performanceStatus.hidden = false; els.performanceStatus.textContent = 'Caricamento…'; els.performanceList.replaceChildren();
  const result = await PerformanceSharing.mine(); renderPerformanceCards(result.performances, true);
}

async function loadGroupPerformances(group, button) {
  selectPerformanceTab(button); els.performanceStatus.hidden = false; els.performanceStatus.textContent = 'Caricamento…'; els.performanceList.replaceChildren();
  try { const result = await PerformanceSharing.group(group.id); renderPerformanceCards(result.performances, false); }
  catch (_) { els.performanceStatus.textContent = 'Risultati del settore non disponibili.'; }
}

async function loadOwnSectionAggregate(button) {
  selectPerformanceTab(button);
  els.performanceStatus.hidden = false;
  els.performanceStatus.textContent = 'Caricamento aggregato…';
  els.performanceList.replaceChildren();
  try {
    const result = await ProgressTracking.aggregate(state.bundleManifest.piece_id);
    const part = result.parts?.[0];
    if (!part) {
      els.performanceStatus.textContent = 'L’aggregato sarà visibile quando almeno due coristi della tua parte avranno completato il brano.';
      return;
    }
    els.performanceStatus.hidden = true;
    const card = document.createElement('article'); card.className = 'performance-card aggregate-performance-card';
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'Piano roll aggregato della mia parte');
    const body = document.createElement('div'); body.className = 'performance-card-body';
    const heading = document.createElement('strong'); heading.textContent = `Aggregato ${AggregatePitch.LABELS[part.voicePart]}`;
    const detail = document.createElement('small'); detail.textContent = `${part.memberCount} coristi · linea mediana e intervallo interquartile`;
    const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'performance-delete';
    revoke.textContent = 'Revoca i miei dati per questo brano';
    revoke.addEventListener('click', async () => {
      if (!confirm('Rimuovere dal cockpit i tuoi progressi, le metriche e il best condiviso per questo brano? La registrazione audio personale non verrà eliminata.')) return;
      revoke.disabled = true;
      try { await ProgressTracking.revoke(state.bundleManifest.piece_id); await loadOwnSectionAggregate(button); }
      catch (_) { revoke.disabled = false; els.performanceStatus.hidden = false; els.performanceStatus.textContent = 'Revoca non riuscita. Riprova.'; }
    });
    body.append(heading, detail); card.append(canvas, body, revoke); els.performanceList.append(card);
    AggregatePitch.draw(canvas, [part]);
  } catch (_) { els.performanceStatus.textContent = 'Aggregato non disponibile.'; }
}

async function loadPerformanceHub() {
  if (!window.PerformanceSharing) return;
  els.performanceTabs.replaceChildren(); els.performanceList.replaceChildren();
  els.performanceStatus.hidden = false; els.performanceStatus.textContent = 'Caricamento…';
  try {
    const [me, groups] = await Promise.all([PerformanceSharing.me(), PerformanceSharing.groups()]);
    state.performanceMe = me; els.performanceIdentity.textContent = me.member.displayName;
    const mine = document.createElement('button'); mine.type = 'button'; mine.dataset.scope = 'mine'; mine.textContent = 'I miei';
    mine.addEventListener('click', () => void loadOwnPerformances(mine)); els.performanceTabs.append(mine);
    if (window.ProgressTracking && me.voicePart && state.bundleManifest?.piece_id) {
      const aggregate = document.createElement('button'); aggregate.type = 'button'; aggregate.textContent = 'La mia sezione';
      aggregate.addEventListener('click', () => void loadOwnSectionAggregate(aggregate));
      els.performanceTabs.append(aggregate);
    }
    for (const group of groups.groups) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = group.name;
      button.addEventListener('click', () => void loadGroupPerformances(group, button)); els.performanceTabs.append(button);
    }
    await loadOwnPerformances(mine);
  } catch (_) { els.performanceStatus.textContent = 'Risultati non disponibili. Riprova più tardi.'; }
}

async function loadMemberProfile() {
  if (!window.PerformanceSharing || RUNTIME_CONFIG.mode !== 'production') return true;
  try {
    state.performanceMe = await PerformanceSharing.me();
    els.cockpitLink.hidden = !state.performanceMe.roles?.includes('director');
    if (!state.performanceMe.profileCompleted) {
      openMemberProfile(true);
      return false;
    }
    return true;
  } catch (error) {
    state.performanceMe = null;
    els.cockpitLink.hidden = true;
    throw error;
  }
}

let memberProfileReturnFocus = null;
function openMemberProfile(required = false) {
  memberProfileReturnFocus = document.activeElement?.closest('#settings-menu') ? els.settings : document.activeElement;
  closeSettingsMenu();
  let member = state.performanceMe?.member;
  if (!member && RUNTIME_CONFIG.mode !== 'production') {
    try { member = JSON.parse(localStorage.getItem('choir-local-profile')); } catch (_) {}
  }
  els.memberProfileDialog.dataset.required = required ? 'true' : 'false';
  els.memberProfileFirstName.value = member?.firstName || '';
  els.memberProfileLastName.value = member?.lastName || '';
  document.getElementById('member-profile-voice').value = preferredVoice() || '';
  els.memberProfileStatus.textContent = required ? 'Completa nome e cognome per proseguire.' : '';
  els.memberProfileSave.textContent = required ? 'Salva e continua' : 'Salva';
  els.memberProfileCancel.hidden = required;
  if (!els.memberProfileDialog.open) els.memberProfileDialog.showModal();
  requestAnimationFrame(() => (required ? els.memberProfileFirstName : document.getElementById('member-profile-voice')).focus());
}

async function saveMemberProfile(event) {
  event.preventDefault();
  els.memberProfileSave.disabled = true;
  els.memberProfileStatus.textContent = 'Salvataggio…';
  try {
    const wasRequired = els.memberProfileDialog.dataset.required === 'true';
    const profile = {
      firstName: els.memberProfileFirstName.value,
      lastName: els.memberProfileLastName.value,
      preferredVoicePart: document.getElementById('member-profile-voice').value || null,
    };
    const result = RUNTIME_CONFIG.mode === 'production' ? await PerformanceSharing.updateProfile(profile) : {
      member: { id: 'local', firstName: profile.firstName.trim(), lastName: profile.lastName.trim(),
        displayName: `${profile.firstName.trim()} ${profile.lastName.trim()}` },
      preferredVoicePart: profile.preferredVoicePart, profileCompleted: true,
    };
    if (RUNTIME_CONFIG.mode !== 'production') {
      try { localStorage.setItem('choir-local-profile', JSON.stringify(result.member)); } catch (_) {}
    }
    state.performanceMe = { ...state.performanceMe, ...result, member: result.member };
    try { localStorage.setItem(`choir-preferred-voice:${result.member.id}`, result.preferredVoicePart || ''); } catch (_) {}
    els.performanceIdentity.textContent = result.member.displayName;
    els.memberProfileDialog.dataset.required = 'false';
    els.memberProfileDialog.close();
    showToast('Profilo aggiornato.');
    if (wasRequired) location.reload();
  } catch (_) {
    els.memberProfileStatus.textContent = 'Inserisci un nome e un cognome validi.';
  } finally { els.memberProfileSave.disabled = false; }
}

let memberProfileControlsBound = false;
function bindMemberProfileControls() {
  if (memberProfileControlsBound) return;
  memberProfileControlsBound = true;
  els.memberProfileForm.addEventListener('submit', (event) => void saveMemberProfile(event));
  els.memberProfileCancel.addEventListener('click', () => els.memberProfileDialog.close());
  // Account actions are also available from Home before any score is loaded.
  document.getElementById('settings-menu-account').addEventListener('click', async () => {
    if (echoDiagnosticsUI?.hasPending()) {
      showToast('Scarica o scarta il test rientro prima di cambiare account.'); return;
    }
    if (state.personalRecording.pending) {
      showToast('Salva o scarta la registrazione prima di cambiare account.'); return;
    }
    if (microphoneCaptureActive()) {
      showToast('Termina la registrazione o il controllo prima di cambiare account.'); return;
    }
    closeSettingsMenu();
    await pausePracticeForNonExercise();
    savePitchHistory();
    const returnPath = state.runtime && document.body.dataset.view === 'practice'
      ? `${location.pathname}?${practiceReturnQuery()}` : '/index.html';
    window.location.assign(`/sign-out?return_url=${encodeURIComponent(returnPath)}`);
  });
  els.memberProfileDialog.addEventListener('close', () => {
    if (memberProfileReturnFocus?.isConnected && memberProfileReturnFocus.checkVisibility()) memberProfileReturnFocus.focus({ preventScroll: true });
  });
  els.memberProfileDialog.addEventListener('cancel', (event) => {
    if (els.memberProfileDialog.dataset.required === 'true') {
      event.preventDefault();
      els.memberProfileStatus.textContent = 'Completa nome e cognome per proseguire.';
    }
  });
  els.memberProfileDialog.addEventListener('click', event => {
    if (event.target !== els.memberProfileDialog) return;
    const bounds = els.memberProfileDialog.getBoundingClientRect();
    if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) return;
    if (els.memberProfileDialog.dataset.required === 'true') els.memberProfileStatus.textContent = 'Completa nome e cognome per proseguire.';
    else els.memberProfileDialog.close();
  });
}

function finishAttempt() {
  state.attemptActive = false;
  state.resumeCheckpointBeat = null;
  const automaticCapture = stopAutomaticBestCapture();
  void automaticCapture.finally(() => releaseMicrophoneIfUnused());
  showAttemptResult();
  void sharePracticeProgress({ completed: true });
  void shareCompletedAttempt(automaticCapture).catch(() => {
    els.resultProgress.textContent += `${els.resultProgress.textContent ? ' ' : ''}Salvataggio del best non riuscito; la prova resta disponibile solo localmente.`;
  });
}

function globalDetectorPreferences() {
  return {
    settingsDefaultsVersion: PitchShared.SETTINGS_DEFAULTS_VERSION,
    pianoRollDelayMs: state.pianoRollDelayMs,
    v1RmsThreshold: state.detectorSettings.rmsThreshold,
    v1WeakVoiceMode: state.detectorSettings.weakVoiceMode,
    v1FastAlpha: state.detectorSettings.fastAlpha,
    v1SlowAlpha: state.detectorSettings.slowAlpha,
    v1MedianWindowFrames: state.detectorSettings.medianWindowFrames,
    v1PlumeWidth: state.plumeSettings.width,
    plumeWidthPreferenceVersion: PitchShared.PLUME_WIDTH_PREFERENCE_VERSION,
    v1PlumeIntensity: state.plumeSettings.intensity,
    v1PlumeColor: state.plumeSettings.color,
    v1PlumeAdvanceMs: state.plumeSettings.timeAdvanceMs,
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
      settingsDefaultsVersion: PitchShared.SETTINGS_DEFAULTS_VERSION,
      mixerDefaultsVersion: MIXER_DEFAULTS_VERSION,
      pianoRollDelayMs: state.pianoRollDelayMs,
      selectedVoiceIds: [...state.selectedVoiceIds], voiceLevels: Object.fromEntries(state.voiceLevels),
      accompanimentEnabled: state.accompanimentEnabled, accompanimentLevel: state.accompanimentLevel,
      noteNames: state.noteNames, noteNamesPreferenceVersion: 2, showIntervals: state.showIntervals,
      scoreHeight: Math.round(els.scoreViewport.clientHeight), scoreHeightPreferenceVersion: 4,
      v1RmsThreshold: state.detectorSettings.rmsThreshold,
      v1WeakVoiceMode: state.detectorSettings.weakVoiceMode,
      v1FastAlpha: state.detectorSettings.fastAlpha, v1SlowAlpha: state.detectorSettings.slowAlpha,
      v1MedianWindowFrames: state.detectorSettings.medianWindowFrames,
      v1PlumeWidth: state.plumeSettings.width, plumeWidthPreferenceVersion: PitchShared.PLUME_WIDTH_PREFERENCE_VERSION,
      v1PlumeIntensity: state.plumeSettings.intensity,
      v1PlumeColor: state.plumeSettings.color, v1PlumeAdvanceMs: state.plumeSettings.timeAdvanceMs,
      pitchLayerV1: state.pitchLayers.v1,
      pitchLayerCrepe: state.pitchLayers.crepe }));
    localStorage.setItem(INTERVAL_ARROWS_PREFERENCE_KEY, String(state.showIntervals));
    saveGlobalDetectorPreferences();
    localStorage.setItem(`choir-part:${state.bundleManifest.piece_id ?? state.runtime.title}`, state.runtime.selectedPartId);
  } catch (_) { /* Practice remains usable when storage is unavailable. */ }
}

function restorePreferences() {
  state.lyricTextScale = UiPreferences.apply(UiPreferences.read());
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(preferenceKey())) ?? {}; } catch (_) {}
  let detectorSaved = null;
  try { detectorSaved = JSON.parse(localStorage.getItem(GLOBAL_DETECTOR_PREFERENCES_KEY)); } catch (_) {}
  // Migrate existing per-piece detector settings once, then use the global
  // record for every piece and voice part.
  detectorSaved = detectorSaved && typeof detectorSaved === 'object' ? detectorSaved : saved;
  state.transpose = Number.isInteger(saved.transpose) && Math.abs(saved.transpose) <= 12 ? saved.transpose : 0;
  els.transpose.value = String(state.transpose);
  const availableVoiceIds = Object.keys(state.backingManifest?.voice_stems ?? {});
  const legacyDefaultSelection = Array.isArray(saved.selectedVoiceIds)
    && saved.selectedVoiceIds.length === 1 && saved.selectedVoiceIds[0] === state.runtime.selectedPartId;
  const legacyDefaultVoiceLevels = availableVoiceIds.every((partId) => {
    const level = Number(saved.voiceLevels?.[partId]);
    return !Number.isFinite(level) || level >= .999;
  });
  const legacyDefaultAccompaniment = saved.accompanimentEnabled !== false
    && (!Number.isFinite(Number(saved.accompanimentLevel)) || Number(saved.accompanimentLevel) >= .999);
  const useNewMixerDefaults = saved.mixerDefaultsVersion !== MIXER_DEFAULTS_VERSION
    && (!Array.isArray(saved.selectedVoiceIds)
      || (legacyDefaultSelection && legacyDefaultVoiceLevels && legacyDefaultAccompaniment));
  if (useNewMixerDefaults) {
    state.selectedVoiceIds = new Set(availableVoiceIds);
  } else if (Array.isArray(saved.selectedVoiceIds)) {
    state.selectedVoiceIds = new Set(saved.selectedVoiceIds.filter((partId) => availableVoiceIds.includes(partId)));
  }
  state.voiceLevels = new Map(availableVoiceIds.map((partId) => {
    const level = Number(saved.voiceLevels?.[partId]);
    const defaultLevel = partId === state.runtime.selectedPartId ? DEFAULT_OWN_VOICE_LEVEL : DEFAULT_OTHER_VOICE_LEVEL;
    return [partId, !useNewMixerDefaults && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : defaultLevel];
  }));
  state.accompanimentEnabled = Boolean(state.backingManifest?.accompaniment_file) && saved.accompanimentEnabled !== false;
  state.accompanimentLevel = !useNewMixerDefaults && Number.isFinite(Number(saved.accompanimentLevel))
    ? Math.max(0, Math.min(1, Number(saved.accompanimentLevel))) : DEFAULT_ACCOMPANIMENT_LEVEL;
  // Note names follow the current Italian interface. Language selection will
  // return only as a single global application preference.
  state.noteNames = 'italian';
  els.noteNames.value = state.noteNames;
  try {
    const intervalArrows = localStorage.getItem(INTERVAL_ARROWS_PREFERENCE_KEY);
    state.showIntervals = intervalArrows == null ? saved.showIntervals === true : intervalArrows === 'true';
  } catch (_) { state.showIntervals = saved.showIntervals === true; }
  // Playback position is session-only. Opening a piece must always begin at
  // the first measure instead of restoring a stale position from localStorage.
  state.selectedMeasureIndex = 0;
  els.playbackSpeed.value = ['0.8', '0.9', '1'].includes(saved.speed) ? saved.speed : '1';
  els.volume.value = Number.isFinite(Number(saved.volume)) ? Math.max(0, Math.min(100, Number(saved.volume))) : 62;
  els.metronomeVolume.value = saved.metronome != null && Number.isFinite(Number(saved.metronome))
    ? Math.max(0, Math.min(100, Number(saved.metronome))) : DEFAULT_METRONOME_VOLUME;
  state.rememberedMetronomeVolume = Number(els.metronomeVolume.value) || DEFAULT_METRONOME_VOLUME;
  // The click timing is deliberately fixed: legacy saved values must not
  // override the application-wide 160 ms offset.
  state.metronomeOffsetMs = METRONOME_OFFSET_MS;
  const sharedPitchPreferences = PitchShared.readPreferences({
    getItem: () => JSON.stringify(detectorSaved),
  });
  const savedPianoRollDelay = Number(detectorSaved.pianoRollDelayMs ?? saved.pianoRollDelayMs);
  const previousPianoRollDefaults = detectorSaved.settingsDefaultsVersion === 2
    ? [330, 500] : detectorSaved.settingsDefaultsVersion === 1 ? [270] : [150];
  const legacyPianoRollDefault = detectorSaved.settingsDefaultsVersion !== PitchShared.SETTINGS_DEFAULTS_VERSION
    && previousPianoRollDefaults.some((value) => Math.abs(savedPianoRollDelay - value) < 1e-9);
  state.pianoRollDelayMs = Number.isFinite(savedPianoRollDelay) && !legacyPianoRollDefault
    ? Math.round(Math.max(0, Math.min(PIANO_ROLL_DELAY_MAX_MS, savedPianoRollDelay)) / 10) * 10
    : PIANO_ROLL_DELAY_DEFAULT_MS;
  state.detectorSettings.rmsThreshold = Math.max(V1_RMS_THRESHOLD.min,
    Math.min(V1_RMS_THRESHOLD.max, sharedPitchPreferences.detector.rmsThreshold));
  state.detectorSettings.weakVoiceMode = sharedPitchPreferences.detector.weakVoiceMode;
  state.detectorSettings.fastAlpha = Math.max(.05, Math.min(.95, sharedPitchPreferences.detector.fastAlpha));
  state.detectorSettings.slowAlpha = Math.max(.05, Math.min(.95, sharedPitchPreferences.detector.slowAlpha));
  const savedMedian = sharedPitchPreferences.detector.medianWindowFrames;
  state.detectorSettings.medianWindowFrames = Math.max(1, Math.min(7, Math.round(savedMedian / 2) * 2 - 1));
  state.plumeSettings.width = Math.max(.35, Math.min(2.5, sharedPitchPreferences.plume.width));
  state.plumeSettings.intensity = Math.max(.15, Math.min(2, sharedPitchPreferences.plume.intensity));
  state.plumeSettings.color = '#72e0d2';
  state.plumeSettings.timeAdvanceMs = Math.round(sharedPitchPreferences.plume.timeAdvanceMs / 10) * 10;
  state.displayPitchFilter.reset();
  state.pitchLayers.v1 = detectorSaved.pitchLayerV1 !== false;
  state.pitchLayers.crepe = detectorSaved.pitchLayerCrepe !== false;
  els.pitchLayerV1.checked = state.pitchLayers.v1;
  els.pitchLayerCrepe.checked = state.pitchLayers.crepe;
  applyLiveTrackerSettings();
  restoreAudioOutputPreference();
  state.plumeSettings.timeAdvanceMs = state.audioOutputType === 'bluetooth'
    ? BLUETOOTH_PLUME_ADVANCE_MS : STANDARD_PLUME_ADVANCE_MS;
  updateDetectorSettingsUi();
  try { saveGlobalDetectorPreferences(); } catch (_) { /* Storage is optional. */ }
  const mobileLayout = matchMedia('(max-width: 960px)').matches;
  const compatibleScoreHeight = saved.scoreHeightPreferenceVersion === 4
    || (!mobileLayout && [2, 3].includes(saved.scoreHeightPreferenceVersion));
  if (compatibleScoreHeight && Number.isFinite(saved.scoreHeight)) setScoreHeight(saved.scoreHeight);
  else if (mobileLayout) setScoreHeight(defaultMobileScoreHeight());
}

function defaultMobileScoreHeight() {
  if (matchMedia('(orientation: landscape)').matches) {
    return Math.max(105, Math.min(128, innerHeight * .3));
  }
  return innerHeight * .3;
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
  // The piano roll is a bitmap canvas. When its CSS height changes, redraw it
  // before the next paint so the browser never stretches the old frame and
  // deforms lyrics or note labels vertically while the divider is dragged.
  if (state.runtime && !state.rafId) state.rafId = requestAnimationFrame(render);
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
  void sharePracticeProgress({ completed: false });
  state.transportSeekToken += 1;
  state.transportSeekResumeRequested = false;
  state.attemptActive = false;
  state.resumeCheckpointBeat = null;
  if (state.clock.running) state.clock.pause();
  void releaseMicrophoneIfUnused();
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
  if (controlsBound) return;
  controlsBound = true;
  updateMobileChrome();
  els.mobileToolbarToggle.addEventListener('click', () => {
    mobileChrome.topCollapsed = !mobileChrome.topCollapsed;
    updateMobileChrome(); redrawAfterChromeChange();
  });
  els.mobileTransportToggle.addEventListener('click', () => {
    mobileChrome.bottomCollapsed = !mobileChrome.bottomCollapsed;
    updateMobileChrome(); redrawAfterChromeChange();
  });
  bindGridInspection();
  bindScorePitchDivider();
  bindBenchmarkAnalysisCanvas();
  els.performanceSection.hidden = !RUNTIME_CONFIG.features?.performances;
  els.monitoringConsentCheck.addEventListener('change', () => {
    els.monitoringConsentAccept.disabled = !els.monitoringConsentCheck.checked;
  });
  els.accompanimentMode.addEventListener('click', openVoiceMixer);
  els.voiceMixerClose.addEventListener('click', () => els.voiceMixerDialog.close());
  els.voiceMixerDialog.addEventListener('click', closeVoiceMixerFromBackdrop);
  els.voiceMixerAccompanimentEnabled.addEventListener('click', () => {
    state.accompanimentEnabled = !state.accompanimentEnabled;
    void applyVoiceSelection(state.selectedVoiceIds); savePreferences();
  });
  els.voiceMixerAccompanimentLevel.addEventListener('input', () => {
    state.accompanimentLevel = Number(els.voiceMixerAccompanimentLevel.value) / 100;
    els.voiceMixerAccompanimentValue.value = `${els.voiceMixerAccompanimentLevel.value}%`;
    if (state.playbackPlan?.kind !== 'full-mix') syncBackingLevel();
  });
  els.voiceMixerAccompanimentLevel.addEventListener('change', () => {
    void applyVoiceSelection(state.selectedVoiceIds); savePreferences();
  });
  els.voiceMixerOwn.addEventListener('click', () => {
    state.accompanimentEnabled = false;
    void applyVoiceSelection([state.runtime.selectedPartId]);
    savePreferences();
  });
  els.voiceMixerAll.addEventListener('click', () => {
    state.accompanimentEnabled = false;
    void applyVoiceSelection(Object.keys(state.backingManifest?.voice_stems ?? {}));
    savePreferences();
  });
  window.addEventListener('pagehide', () => { savePreferences(); void suspendPracticeForBackground(); });
  els.resultClose.addEventListener('click', () => els.resultDialog.close());
  els.resultResume.addEventListener('click', () => {
    els.resultDialog.close();
    if (!state.clock.running) void togglePlayback();
  });
  els.noteNames.addEventListener('change', () => { state.noteNames = els.noteNames.value; savePreferences(); render(); });
  els.retry.addEventListener('click', () => { state.attemptActive = false; els.resultDialog.close(); seekToMeasure(0); togglePlayback(); });
  for (const eventName of ['loadedmetadata', 'durationchange', 'canplay', 'progress', 'seeked']) {
    els.backingAudio.addEventListener(eventName, applyPendingAudioSeek);
  }
  for (const eventName of ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'emptied', 'ended']) {
    els.backingAudio.addEventListener(eventName, () => {
      state.pianoRollVisualTime.reset();
      if (['play', 'emptied', 'ended'].includes(eventName)) state.pianoRollWaiting = false;
    });
  }
  els.backingAudio.addEventListener('waiting', () => { state.pianoRollWaiting = true; state.pianoRollVisualTime.reset(); });
  els.backingAudio.addEventListener('playing', () => { state.pianoRollWaiting = false; state.pianoRollVisualTime.reset(); });
  els.backingAudio.addEventListener('play', () => {
    void playVoiceStems();
    if (state.personalRecording.replay) {
      syncPersonalRecordingReplayAudio(true);
      void els.personalRecordingReplayAudio.play().catch(() => {});
    }
  });
  els.backingAudio.addEventListener('pause', () => {
    pauseVoiceStems();
    if (state.personalRecording.replay) els.personalRecordingReplayAudio.pause();
  });
  els.backingAudio.addEventListener('seeking', () => {
    for (const audio of state.voiceStemAudio.values()) audio.currentTime = els.backingAudio.currentTime;
    syncPersonalRecordingReplayAudio(true);
  });
  els.backingAudio.addEventListener('timeupdate', () => {
    for (const audio of state.voiceStemAudio.values()) {
      if (Math.abs(audio.currentTime - els.backingAudio.currentTime) > .08) audio.currentTime = els.backingAudio.currentTime;
    }
    syncPersonalRecordingReplayAudio();
  });
  els.transpose.addEventListener('change', async () => {
    PianoRoll.stopPreview();
    state.gridInspect.baseBounds = null;
    state.transpose = Number(els.transpose.value);
    updateTransposeControl();
    state.attemptActive = false; state.resumeCheckpointBeat = null;
    state.pitchViewport = null; beginPitchTake();
    state.playbackMixer.setTranspose(state.transpose);
    await applyVoiceSelection(state.selectedVoiceIds);
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
  els.showFeedback.addEventListener('click', () => {
    showAttemptResult({ preliminary: true });
    void sharePracticeProgress({ completed: false });
  });
  els.restartPractice?.addEventListener('click', restartPractice);
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
  els.previousMeasure.addEventListener('click', () => void navigateToMeasure(Math.max(0, measureIndexAt(playbackSnapshot().beat) - 1)));
  els.nextMeasure.addEventListener('click', () => void navigateToMeasure(Math.min(state.occurrenceMeasures.length - 1, measureIndexAt(playbackSnapshot().beat) + 1)));
  els.partSelector.addEventListener('change', () => changePart(els.partSelector.value));
  els.playbackSpeed.addEventListener('change', async () => {
    void sharePracticeProgress({ completed: false });
    state.attemptActive = false; state.resumeCheckpointBeat = null; state.attempt = { voicedMs: 0, insideMs: 0 }; state.lastSampleMs = null;
    await applyVoiceSelection(state.selectedVoiceIds);
    state.lastMetronomeBeat = null;
    state.attemptActive = state.clock.running;
    savePreferences();
    updatePlaybackButton();
    render();
  });
  els.accompanimentMode.addEventListener('change', () => {
    if (state.clock.running) {
      state.clock.pause();
      void releaseMicrophoneIfUnused();
      updatePlaybackButton();
    }
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
  els.backingAudio.addEventListener('ended', () => {
    if (state.personalRecording.capture) stopPersonalRecordingCapture();
    else if (state.personalRecording.replay) stopPersonalRecordingReplay();
    else void releaseMicrophoneIfUnused();
    updatePlaybackButton(); render();
  });
  els.backingAudio.addEventListener('pause', () => { updatePlaybackButton(); if (!state.clock.running) render(); });
  els.backingAudio.addEventListener('error', () => {
    void releaseMicrophoneIfUnused();
    showToast(`Errore audio (${els.backingAudio.error?.code ?? 'sconosciuto'}).`);
  });
  els.settings.addEventListener('click', (event) => { event.stopPropagation(); toggleSettingsMenu(); });
  els.settingsMenuRepertoire.addEventListener('click', () => void navigatePractice('repertorio.html'));
  els.settingsMenuMixer.addEventListener('click', openVoiceMixer);
  els.settingsMenuProfile.addEventListener('click', () => openMemberProfile(false));
  document.getElementById('settings-menu-relax').addEventListener('click', () => {
    if (!canNavigatePractice()) return;
    const returnPath = state.runtime && document.body.dataset.view === 'practice'
      ? `${location.pathname}?${practiceReturnQuery()}` : '/index.html';
    // Back must also restore this point when the browser evicts the rehearsal.
    if (state.runtime && document.body.dataset.view === 'practice') history.replaceState(history.state, '', returnPath);
    closeSettingsMenu();
    void navigatePractice(`relax.html?return=${encodeURIComponent(returnPath)}`);
  });
  els.settingsMenuRecording.addEventListener('click', () => void openPersonalRecordingDialog());
  els.settingsMenuBasic.addEventListener('click', () => openDetectorSettings('basic'));
  els.settingsMenuAdvanced.addEventListener('click', () => openDetectorSettings('advanced'));
  for (const control of [els.personalRecordingHeadphones, els.personalRecordingStorageConsent]) {
    control.addEventListener('change', updatePersonalRecordingControls);
  }
  els.personalRecordingAutoBest.addEventListener('change', () => void updateAutomaticBestPreference());
  els.personalRecordingStart.addEventListener('click', () => void startPersonalRecordingCapture());
  els.personalRecordingStopLive.addEventListener('click', () => {
    if (state.personalRecording.capture) stopPersonalRecordingCapture();
    else if (state.personalRecording.replay) { stopPersonalRecordingReplay(); void openPersonalRecordingDialog(); }
  });
  els.personalRecordingSave.addEventListener('click', () => void savePersonalRecording());
  els.personalRecordingDiscard.addEventListener('click', discardPersonalRecordingPending);
  els.personalRecordingReplay.addEventListener('click', () => void startPersonalRecordingReplay());
  els.personalRecordingSharing.addEventListener('click', () => void updatePersonalRecordingSharing());
  els.personalRecordingDelete.addEventListener('click', () => void deletePersonalRecording());
  els.personalRecordingClose.addEventListener('click', closePersonalRecordingDialog);
  els.personalRecordingDialog.addEventListener('click', handlePersonalRecordingDialogClick);
  els.personalRecordingDialog.addEventListener('close', () => {
    els.personalRecordingDialog.querySelectorAll('.setting-info.is-open')
      .forEach(button => button.classList.remove('is-open'));
  });
  els.personalRecordingDialog.addEventListener('cancel', event => {
    if (state.personalRecording.capture || state.personalRecording.pending || state.personalRecording.saving) {
      event.preventDefault();
      els.personalRecordingStatus.textContent = 'Prima salva o scarta la nuova registrazione.';
    }
  });
  document.addEventListener('click', (event) => {
    if (!els.settingsMenuWrap.contains(event.target)) closeSettingsMenu();
  });
  els.settingsTextScale.addEventListener('input', () => {
    state.lyricTextScale = UiPreferences.apply(Number(els.settingsTextScale.value) / 100);
    els.settingsTextScaleValue.textContent = `${Math.round(state.lyricTextScale * 100)}%`;
    render();
  });
  els.settingsTextScale.addEventListener('change', () => {
    state.lyricTextScale = UiPreferences.write(Number(els.settingsTextScale.value) / 100);
    showToast(`Testo del piano roll: ${Math.round(state.lyricTextScale * 100)}%.`);
  });
  els.settingsShowIntervals.addEventListener('change', () => {
    state.showIntervals = els.settingsShowIntervals.checked;
    savePreferences(); render();
    showToast(state.showIntervals ? 'Frecce degli intervalli attive.' : 'Frecce degli intervalli nascoste.');
  });
  els.settingsV1Rms.addEventListener('input', () => {
    microphoneCalibrationUI?.disable();
    state.detectorSettings.rmsThreshold = rmsThresholdFromSlider(els.settingsV1Rms.value);
    updateDetectorSettingsUi();
  });
  els.settingsV1Rms.addEventListener('change', () => {
    savePreferences();
    showToast(`Soglia v1 aggiornata: ${formatRmsThreshold(state.detectorSettings.rmsThreshold)} RMS.`);
  });
  els.settingsWeakVoiceMode.addEventListener('change', () => {
    microphoneCalibrationUI?.disable();
    state.detectorSettings.weakVoiceMode = els.settingsWeakVoiceMode.checked;
    applyLiveTrackerSettings(); updateDetectorSettingsUi(); savePreferences();
    showToast(state.detectorSettings.weakVoiceMode
      ? 'Voce debole attiva: volume, periodicità e confidenza sono più permissivi.'
      : 'Modalità voce debole disattivata: confidence minima 30%.');
  });
  const updateTrackerSettings = () => {
    microphoneCalibrationUI?.disable();
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
    state.plumeSettings.color = '#72e0d2';
    state.plumeSettings.timeAdvanceMs = Number(els.settingsV1PlumeAdvance.value);
    updateDetectorSettingsUi(); render();
  };
  for (const control of [els.settingsV1PlumeWidth, els.settingsV1PlumeIntensity, els.settingsV1PlumeAdvance]) {
    control.addEventListener('input', updatePlumeSettings);
    control.addEventListener('change', () => {
      savePreferences();
      showToast('Aspetto della plume v1 salvato.');
    });
  }
  els.settingsPianoRollDelay.addEventListener('input', () => {
    state.pianoRollDelayMs = Number(els.settingsPianoRollDelay.value);
    updateDetectorSettingsUi(); render();
  });
  els.settingsPianoRollDelay.addEventListener('change', savePreferences);
  els.settingsReset.addEventListener('click', () => {
    microphoneCalibrationUI?.disable();
    state.lyricTextScale = UiPreferences.write(UiPreferences.DEFAULT_LYRIC_SCALE);
    state.showIntervals = false;
    state.metronomeOffsetMs = METRONOME_OFFSET_MS;
    state.pianoRollDelayMs = PIANO_ROLL_DELAY_DEFAULT_MS;
    state.detectorSettings.rmsThreshold = V1_RMS_THRESHOLD.default;
    state.detectorSettings.weakVoiceMode = false;
    Object.assign(state.detectorSettings, V1_TRACKER_DEFAULTS);
    state.plumeSettings = { ...PitchShared.PLUME_DEFAULTS,
      timeAdvanceMs: state.audioOutputType === 'bluetooth' ? BLUETOOTH_PLUME_ADVANCE_MS : STANDARD_PLUME_ADVANCE_MS };
    state.displayPitchFilter.reset();
    applyLiveTrackerSettings(); updateDetectorSettingsUi(); savePreferences();
    render(); showToast('Impostazioni v1 ripristinate ai valori predefiniti.');
  });
  document.getElementById('admin-review').addEventListener('click', () => window.open('admin-review.html', 'choir-admin-review'));
  document.getElementById('exit-practice').addEventListener('click', () => {
    returnFromPractice();
  });
  document.getElementById('practice-return').addEventListener('click', returnFromPractice);
  window.addEventListener('resize', () => { updateMobileChrome(); state.activeScoreSegment = null; render(); });
  window.addEventListener('resize', () => { if (!els.benchmarkAnalysis.hidden) drawBenchmarkAnalysisRoll(selectedBenchmarkTake()); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void suspendPracticeForBackground();
  });
  window.addEventListener('beforeunload', (event) => {
    savePitchHistory();
    if (state.personalRecording.capture || state.personalRecording.pending || echoDiagnosticsUI?.isBusy() || echoDiagnosticsUI?.hasPending()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('keydown', (event) => {
    if (document.getElementById('calibration-dialog')?.open || document.getElementById('echo-dialog')?.open || document.getElementById('echo-test-dialog')?.open) return;
    if (event.key === 'Escape' && !els.settingsMenu.hidden) {
      closeSettingsMenu(); els.settings.focus(); event.preventDefault(); return;
    }
    if (document.querySelector('dialog[open]') || document.body.classList.contains('performance-review-open')) return;
    const targetTag = event.target?.tagName;
    const editingText = event.target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(targetTag);
    if (event.code === 'Space' && !editingText) {
      event.preventDefault();
      event.stopPropagation();
      void togglePlayback();
      return;
    }
    if (event.code === 'ArrowLeft' && event.altKey) void navigateToMeasure(measureIndexAt(playbackSnapshot().beat) - 1);
    if (event.code === 'ArrowRight' && event.altKey) void navigateToMeasure(measureIndexAt(playbackSnapshot().beat) + 1);
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
  const libraryResponse = await fetch(releaseAssetUrl(RUNTIME_CONFIG.libraryUrl), { cache: 'force-cache' });
  if (!libraryResponse.ok) throw new Error('Libreria dei brani non disponibile');
  state.library = (await libraryResponse.json()).pieces ?? [];
  if (!state.library.length) throw new Error('Non ci sono brani MuseScore nella cartella sheets');
  bindMemberProfileControls();
  const profileReady = await loadMemberProfile();
  bindAudioOutputControls();
  document.getElementById('settings-close').addEventListener('click', () => els.settingsDialog.close());
  microphoneCalibrationUI = window.ChoirMicrophoneCalibrationUI.create({
    echo: () => echoCancellationUI,
    warmPlayback: async () => {
      const request = state.microphoneRequestGeneration;
      // Home exposes calibration before there is a score/player. The probes
      // still use the live mixer bus; only a loaded song needs decoder warmup.
      const clock = state.clock;
      const media = clock ? [els.backingAudio, ...state.voiceStemAudio.values()].filter(audio => audio.getAttribute('src')) : [];
      state.playbackMixer.muteForCalibration(true);
      try {
        clock?.beginWarmup();
        await state.playbackMixer.resume(media);
        if (clock) { syncBackingLevel(); syncVoiceStemLevels(); }
        if (request !== state.microphoneRequestGeneration || state.microphoneStatus !== 'active') throw new Error('Calibrazione annullata.');
        for (const audio of media) {
          if (!calibrationMediaLoops.has(audio)) calibrationMediaLoops.set(audio, audio.loop);
          audio.loop = true;
        }
        if (echoCancellationUI?.enabled() && !state.playbackMixer.referenceCovers(media)) throw new Error('La base non è disponibile per la riduzione del rientro. Usa le cuffie.');
        await Promise.all(media.filter(audio => audio.src).map(audio => audio.play()));
      } catch (error) {
        clock?.pause(); pauseVoiceStems(); restoreCalibrationMediaLoops(); state.playbackMixer.muteForCalibration(false); throw error;
      }
    },
    resumeAnalysis: () => { applyLiveTrackerSettings(); startPitchAnalysisLoop(); },
    userId: () => state.performanceMe?.member?.id ?? null,
    running: () => Boolean(state.clock?.running),
    baseline: () => PitchShared.recognitionSettings(state.detectorSettings),
    currentRecognition: activeRecognitionSettings,
    trackerSettings: () => ({ fastAlpha: state.detectorSettings.fastAlpha,
      slowAlpha: state.detectorSettings.slowAlpha, medianWindowFrames: state.detectorSettings.medianWindowFrames }),
    input: () => ({ track: state.microphoneStream?.getAudioTracks()[0], context: state.microphoneContext,
      analyser: state.microphoneAnalyser, sampleRate: state.microphoneContext?.sampleRate }),
    canOpen: () => {
      if (microphoneCaptureActive() || state.personalRecording.replay) {
        showToast('Termina prima la registrazione o il riascolto.'); return false;
      }
      return true;
    },
    pause: async () => { closeSettingsMenu(); els.settingsDialog.close(); await pausePracticeForNonExercise({ preserveCalibration: true }); },
    startMicrophone: async () => {
      if (state.microphoneStatus !== 'active') await toggleMicrophone();
      if (state.microphoneStatus !== 'active') throw new Error(state.microphoneFailureMessage || 'Consenti il microfono e riprova.');
      stopPitchAnalysisLoop(); stopPitchWorker();
      // Calibration frames never enter pitch history, attempts, or scoring.
      state.trackedPitch = null; state.displayPitch = null;
    },
    stopMicrophone, notify: showToast, returnFocus: () => {
      if (mobileChrome.topCollapsed) { mobileChrome.topCollapsed = false; updateMobileChrome(); redrawAfterChromeChange(); }
      els.settings.focus();
    },
    changed: () => {
      stopPitchWorker();
      if (state.microphoneAnalyser) state.microphoneBuffer = new Float32Array(state.microphoneAnalyser.fftSize);
      state.pitchSmoother.reset(); state.displayPitchFilter.reset(); applyLiveTrackerSettings();
      updateDetectorSettingsUi();
    },
  });
  document.getElementById('settings-calibrate').addEventListener('click', () => void microphoneCalibrationUI.open());
  echoCancellationUI = window.ChoirEchoCancellationUI.create({
    nativeAEC: RUNTIME_CONFIG.features.platformAEC !== false,
    openCalibration: () => microphoneCalibrationUI.open(),
    mixer: () => state.playbackMixer, stream: () => state.microphoneStream,
    volume: () => Number(els.volume.value) / 100,
    level: () => {
      if (!state.microphoneAnalyser) return 0;
      const buffer = new Float32Array(2048); state.microphoneAnalyser.getFloatTimeDomainData(buffer);
      return Math.sqrt(buffer.reduce((sum, v) => sum + v * v, 0) / buffer.length);
    },
    userId: () => state.performanceMe?.member?.id || 'local-only', running: () => Boolean(state.clock?.running),
    canOpen: () => !microphoneCaptureActive() && !state.personalRecording.replay,
    pause: async () => { closeSettingsMenu(); els.settingsDialog.close(); await pausePracticeForNonExercise(); },
    pauseForToggle: async () => { closeSettingsMenu(); await pausePracticeForNonExercise(); },
    startMicrophone: async () => {
      if (state.microphoneStatus !== 'active') await toggleMicrophone();
      if (state.microphoneStatus !== 'active') throw new Error(state.microphoneFailureMessage || 'Consenti il microfono e riprova.');
    },
    stopMicrophone, stopAnalysis: () => { stopPitchAnalysisLoop(); stopPitchWorker(); },
    changed: () => { microphoneCalibrationUI.inputChanged(); updateListeningSettingsUi(); renderAutomaticBestPreference(); }, notify: showToast,
    returnFocus: () => {
      if (mobileChrome.topCollapsed) { mobileChrome.topCollapsed = false; updateMobileChrome(); redrawAfterChromeChange(); }
      els.settings.focus();
    },
  });
  echoDiagnosticsUI = window.ChoirEchoDiagnostics.create({
    save: (id, metadata, blob) => PersonalRecordings.saveEchoDiagnostic(id, metadata, blob),
    latest: () => PersonalRecordings.echoDiagnostics(state.bundleManifest?.piece_id),
    remove: id => PersonalRecordings.deleteEchoDiagnostic(id),
    ready: () => Boolean(echoCancellationUI?.enabled() && state.runtime),
    calibrated: () => Boolean(echoCancellationUI?.ready()),
    graph: () => echoCancellationUI?.captureGraph(),
    lifecycle: () => echoCancellationUI?.lifecycle(),
    canOpen: () => !microphoneCaptureActive() && !state.personalRecording.pending && !state.personalRecording.replay,
    pause: async ({ keepMicrophone = false } = {}) => {
      closeSettingsMenu(); els.settingsDialog.close();
      if (keepMicrophone && echoCancellationUI.ready()) {
        if (state.clock.running) {
          const beat = playbackSnapshot().beat; state.clock.pause();
          rememberAttemptCheckpoint(beat); savePitchHistory(); updatePlaybackButton(); render();
        }
      } else await pausePracticeForNonExercise();
    },
    startMicrophone: async () => {
      echoCancellationUI.checkpoint('diagnostic-microphone-start');
      if (!echoCancellationUI.ready()) echoCancellationUI.prepare('diagnostic-unverified');
      if (state.microphoneStatus !== 'active') await toggleMicrophone();
      if (state.microphoneStatus !== 'active') throw new Error(state.microphoneFailureMessage || 'Consenti il microfono e riprova.');
    },
    play: togglePlayback, running: () => Boolean(state.clock?.running), focus: () => {
      if (mobileChrome.topCollapsed) { mobileChrome.topCollapsed = false; updateMobileChrome(); redrawAfterChromeChange(); }
      els.settings.focus();
    },
    metadata: () => {
      const settings = state.microphoneStream?.getAudioTracks()[0]?.getSettings() || {};
      return { pieceId: state.bundleManifest?.piece_id, scoreVersion: state.runtime?.scoreVersionId,
        partId: state.runtime?.selectedPartId, buildVersion: RUNTIME_CONFIG.buildVersion,
        memberId: state.performanceMe?.member?.id || null, userAgent: navigator.userAgent,
        beat: state.clock ? playbackSnapshot().beat : null, playbackRate: Number(els.playbackSpeed.value), transpose: state.transpose,
        mixer: { master: Number(els.volume.value)/100, organ: state.accompanimentLevel,
          organEnabled: state.accompanimentEnabled, voices: Object.fromEntries(state.voiceLevels),
          enabledVoices: Array.from(state.selectedVoiceIds), normalization: mixNormalization(), metronome: Number(els.metronomeVolume.value)/100 },
        input: { sampleRate: settings.sampleRate, channelCount: settings.channelCount,
          echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl } };
    },
  });
  bindLibraryPicker();
  updatePracticeReturn();
  if (!profileReady) return;
  window.addEventListener('message', (event) => {
    if (event.origin === location.origin && event.data?.type === 'choir-bundle-approval') location.reload();
  });
  window.addEventListener('popstate', () => {
    const query = new URLSearchParams(location.search);
    practiceOrigin = query.get('from') === 'repertorio' ? 'repertorio' : null;
    updatePracticeReturn();
    const pieceId = query.get('piece');
    if (!pieceId || !state.library.some((piece) => piece.piece_id === pieceId)) return;
    void loadPracticePiece(pieceId, { partId: query.get('part'), updateHistory: false }).then(() => restorePracticePosition(query))
      .catch((error) => showToast(error.message));
  });
  const requestedPiece = new URLSearchParams(window.location.search).get('piece');
  const requestedPieceExists = requestedPiece
    && state.library.some((piece) => piece.piece_id === requestedPiece);
  if (requestedPieceExists) {
    const query = new URLSearchParams(location.search);
    const hadPreferredVoice = Boolean(preferredVoice());
    const openRequested = async () => {
      const piece = state.library.find(item => item.piece_id === requestedPiece);
      await loadPracticePiece(requestedPiece, { partId: hadPreferredVoice ? query.get('part') || preferredPartId(piece) : preferredPartId(piece, query.get('part')), updateHistory: false });
      restorePracticePosition(query);
      if (els.piecePickerDialog.open) els.piecePickerDialog.close();
    };
    requirePreferredVoice(openRequested);
    return;
  }
  openLibraryPicker(new URLSearchParams(location.search).get('menu') === 'sing' ? 'source' : 'mode');
}

function openLibraryPicker(step = 'mode') {
  if (state.personalRecording.capture || state.personalRecording.pending) {
    els.personalRecordingStatus.textContent = 'Prima di cambiare brano interrompi la registrazione e scegli se salvarla o scartarla.';
    if (!els.personalRecordingDialog.open && !state.personalRecording.capture) els.personalRecordingDialog.showModal();
    showToast('Completa prima la registrazione personale.');
    return;
  }
  if (state.personalRecording.replay) stopPersonalRecordingReplay();
  document.body.dataset.view = 'home';
  if (state.clock?.running) state.clock.pause();
  void pausePracticeForNonExercise({ preserveCalibration: true });
  if (state.clock) updatePlaybackButton();
  const requested = new URLSearchParams(window.location.search).get('piece');
  let remembered = null;
  try { remembered = localStorage.getItem(LAST_PRACTICE_PIECE_KEY); } catch (_) { /* Optional convenience only. */ }
  const selectedPiece = [requested, state.bundleManifest?.piece_id, remembered, state.library[0]?.piece_id]
    .find((pieceId) => pieceId && state.library.some((piece) => piece.piece_id === pieceId));
  populateLibraryPieces(selectedPiece);
  const returnButton = document.getElementById('library-close');
  if (returnButton) returnButton.hidden = !state.runtime;
  showLibraryStep(['mode', 'source', 'piece', 'part'].includes(step) ? step : 'mode');
  if (!els.piecePickerDialog.open) els.piecePickerDialog.showModal();
}

async function updateLibraryParts() {
  const piece = state.library.find((item) => item.piece_id === els.libraryPiece.value);
  if (piece && !piece.parts?.length && !piece.loading) {
    piece.loading = true;
    els.libraryOpen.disabled = true;
    els.libraryPart.replaceChildren(new Option('Preparazione parti…', ''));
    els.libraryNote.hidden = false;
    els.libraryNote.textContent = 'Preparo le parti vocali…';
    try {
      const bundle = await loadBundleManifest(piece.piece_id);
      piece.bundleManifest = bundle;
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
  const preferredPart = parts.find(part => part.id === preferredPartId(piece)) ?? parts.find(part => part.id === rememberedPart)
    ?? parts.find(part => part.id === state.runtime?.selectedPartId);
  if (preferredPart) els.libraryPart.value = preferredPart.id;
  document.getElementById('library-voice-summary').textContent = preferredVoice() ? `La tua parte: ${VOICE_NAMES[preferredVoice()]}` : '';
  const message = piece?.monodic ? 'Brano monodico: Soprano e Contralto usano la melodia scritta; Tenore e Basso la cantano un’ottava sotto.' : (!parts.length ? 'Nessuna parte vocale disponibile nel file MuseScore.' : '');
  els.libraryNote.hidden = !message;
  els.libraryNote.textContent = message;
  void warmSelectedPiece(piece, els.libraryPart.value);
}

function bindLibraryPicker() {
  els.settingsDialog.addEventListener('close', () => {
    if (els.piecePickerDialog.open && !document.querySelector('dialog[open]:not(#piece-picker-dialog)')) {
      document.querySelector('#home-settings summary').focus();
    }
  });
  document.getElementById('home-basic').addEventListener('click', () => {
    document.getElementById('home-settings').open = false; openDetectorSettings('basic');
  });
  document.getElementById('home-advanced').addEventListener('click', () => {
    document.getElementById('home-settings').open = false; openDetectorSettings('advanced');
  });
  els.piecePicker.addEventListener('click', openLibraryPicker);
  els.library?.addEventListener('click', openLibraryPicker);
  els.piecePickerDialog.addEventListener('cancel', (event) => {
    if (!state.runtime) event.preventDefault();
  });
  els.piecePickerDialog.addEventListener('close', () => {
    if (state.runtime) document.body.dataset.view = 'practice';
  });
  els.piecePickerDialog.addEventListener('click', event => {
    if (event.target !== els.piecePickerDialog || !state.runtime) return;
    const bounds = els.piecePickerDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) els.piecePickerDialog.close();
  });
  document.getElementById('library-close').addEventListener('click', () => els.piecePickerDialog.close());
  document.getElementById('library-profile').addEventListener('click', () => openMemberProfile(false));
  document.getElementById('library-sing').addEventListener('click', () => { libraryMode = 'sing'; showLibraryStep('source'); });
  document.getElementById('library-read').addEventListener('click', () => { libraryMode = 'read'; showLibraryStep('piece'); });
  document.getElementById('library-custom').addEventListener('click', () => { libraryMode = 'sing'; showLibraryStep('piece'); });
  document.getElementById('library-back').addEventListener('click', () => {
    pendingVoiceAction = null;
    if (libraryStep === 'part' && practiceOrigin === 'repertorio' && !state.runtime) { void navigatePractice('repertorio.html'); return; }
    const previous = { source: 'mode', piece: libraryMode === 'read' ? 'mode' : 'source', part: 'piece' };
    showLibraryStep(previous[libraryStep] || 'mode');
  });
  document.querySelectorAll('[data-preferred-voice]').forEach(button => button.addEventListener('click', async () => {
    document.querySelectorAll('[data-preferred-voice]').forEach(item => { item.disabled = true; });
    try {
      await savePreferredVoice(button.dataset.preferredVoice);
      await updateLibraryParts();
      const action = pendingVoiceAction; pendingVoiceAction = null;
      if (action) await action();
    } catch (_) { document.getElementById('library-status').textContent = 'Salvataggio non riuscito. Riprova.'; }
    finally { document.querySelectorAll('[data-preferred-voice]').forEach(item => { item.disabled = false; }); }
  }));
  els.libraryPiece.addEventListener('change', updateLibraryParts);
  els.libraryPart.addEventListener('change', () => {
    const piece = state.library.find((item) => item.piece_id === els.libraryPiece.value);
    void warmSelectedPiece(piece, els.libraryPart.value);
  });
  const openSelectedPracticePiece = async () => {
    const pieceId = els.libraryPiece.value;
    const partId = els.libraryPart.value;
    const previousOrigin = practiceOrigin;
    practiceOrigin = null;
    els.libraryOpen.disabled = true;
    els.libraryNote.hidden = false;
    els.libraryNote.textContent = 'Apro il brano…';
    try {
      await loadPracticePiece(pieceId, { partId, updateHistory: true });
      if (els.piecePickerDialog.open) els.piecePickerDialog.close();
    } catch (error) {
      practiceOrigin = previousOrigin;
      els.libraryNote.textContent = error.message;
    } finally {
      els.libraryOpen.disabled = false;
    }
  };
  els.libraryOpen.addEventListener('click', () => requirePreferredVoice(() => {
    els.libraryPart.value = preferredPartId(state.library.find(piece => piece.piece_id === els.libraryPiece.value), els.libraryPart.value);
    return openSelectedPracticePiece();
  }));
  document.querySelectorAll('a[href="voice-lab.html"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      void navigatePractice(link.href);
    });
  });
  els.libraryScore.addEventListener('click', () => {
    void navigatePractice(`score-viewer.html?piece=${encodeURIComponent(els.libraryPiece.value)}&from=menu`);
  });
  els.scoreViewerLink.addEventListener('click', event => {
    if (!state.runtime) return;
    els.scoreViewerLink.href = `score-viewer.html?${practiceReturnQuery()}`;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void navigatePractice(els.scoreViewerLink.href);
  });
}

function restartPractice() {
  void sharePracticeProgress({ completed: false });
  state.transportSeekToken += 1;
  state.transportSeekResumeRequested = false;
  state.clock.pause();
  void releaseMicrophoneIfUnused();
  clearPitchHistory();
  state.attemptActive = false;
  state.resumeCheckpointBeat = null;
  state.attempt = { voicedMs: 0, insideMs: 0 };
  state.lastSampleMs = null;
  if (els.resultDialog.open) els.resultDialog.close();
  seekToMeasure(0);
  updatePlaybackButton();
  render();
  showToast('Brano riportato all’inizio.');
}

async function loadPracticePiece(pieceId, { partId = null, updateHistory = false } = {}) {
  PianoRoll.stopPreview();
  state.gridNavigation?.cancel();
  state.gridInspect.active = false;
  if (state.personalRecording.capture || state.personalRecording.pending) {
    throw new Error('Salva o scarta la registrazione personale prima di cambiare brano.');
  }
  if (state.personalRecording.replay) stopPersonalRecordingReplay();
  if (state.runtime) void sharePracticeProgress({ completed: false });
  const generation = ++practiceLoadGeneration;
  state.transportSeekToken += 1;
  state.transportSeekResumeRequested = false;
  if (state.runtime) savePitchHistory();
  if (state.clock?.running) state.clock.pause();
  pauseVoiceStems();
  els.backingAudio.pause();
  els.scoreLoading.hidden = false;
  els.scoreLoading.textContent = 'Preparazione spartito…';
  const preserveCalibratedInput = state.microphoneStatus === 'active' && Boolean(microphoneCalibrationUI?.activeSettings());
  const stopMicrophonePromise = state.microphoneStatus === 'idle' || preserveCalibratedInput ? Promise.resolve() : stopMicrophone();
  const bundleManifest = await loadBundleManifest(pieceId);
  const [payload, glyphMap, backingManifest] = await loadPieceData(pieceId, bundleManifest);
  await stopMicrophonePromise;
  if (generation !== practiceLoadGeneration) return;
  discardVoiceStems();
  try { localStorage.setItem(LAST_PRACTICE_PIECE_KEY, pieceId); } catch (_) { /* Optional convenience only. */ }
  state.glyphMap = glyphMap;
  state.backingManifest = backingManifest;
  state.bundleManifest = bundleManifest;
  state.personalRecording.current = null;
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
  try { savedPart = partId ?? new URLSearchParams(window.location.search).get('part') ?? localStorage.getItem(`choir-part:${bundleManifest.piece_id ?? state.runtime.title}`); } catch (_) {}
  state.runtime.selectPart(parts.find((part) => part.id === savedPart)?.id ?? parts.find((part) => part.name.toLowerCase().includes('tenor'))?.id ?? parts[0]?.id);
  state.selectedVoiceIds = new Set([state.runtime.selectedPartId]);
  els.partSelector.value = state.runtime.selectedPartId;
  const transposeValues = RUNTIME_CONFIG.features?.transpose === false
    ? [0] : Array.from({ length: 25 }, (_, index) => index - 12);
  els.transpose.replaceChildren(...transposeValues.map((offset) => {
    const label = offset === 0 ? '0' : `${offset > 0 ? '+' : '−'}${Math.abs(offset)}`;
    return new Option(label, String(offset));
  }));
  restorePreferences();
  // Transposition is an in-session rehearsal choice.  Never carry it into a
  // newly opened piece, even if that piece has older saved preferences.
  state.transpose = 0;
  els.transpose.value = '0';
  updateTransposeControl();
  restorePitchHistory();
  state.attemptActive = false;
  state.resumeCheckpointBeat = null;
  state.scorePage = 0;
  state.activeScoreSegment = null;
  state.fallbackScoreSlots = [];
  state.pitchViewport = null;
  state.lastScoreEvent = null;
  state.occurrenceMeasures = buildOccurrenceMeasures(state.runtime);
  configureBacking();
  state.clock = new MediaPlaybackClock({ mediaElement: els.backingAudio, scoreRuntime: state.runtime });
  state.pianoRollVisualTime.reset();
  state.pianoRollWaiting = false;
  // Media decoders can change the output route; retain the voice profile and
  // input, but verify the new route in silence before applying cancellation.
  if (preserveCalibratedInput && echoCancellationUI?.enabled()) echoCancellationUI.invalidate('piece-output-route');
  microphoneCalibrationUI?.refresh();
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
  document.title = `${els.pieceTitle.textContent} · Xynon`;
  els.scoreViewerLink.href = `score-viewer.html?piece=${encodeURIComponent(bundleManifest.piece_id)}`;
  els.scorePartLabel.textContent = parts.find((part) => part.id === state.runtime.selectedPartId)?.name ?? 'Parte';
  bindControls(); updateMicrophoneButton(); updateMetronomeControl(); seekToMeasure(0); updatePlaybackButton();
  mobileChrome.topCollapsed = false; updateMobileChrome(); updatePracticeReturn();
  if (!els.piecePickerDialog.open) document.body.dataset.view = 'practice';
  if (updateHistory) {
    const query = new URLSearchParams({ piece: bundleManifest.piece_id, part: state.runtime.selectedPartId });
    if (practiceOrigin) query.set('from', practiceOrigin);
    history.pushState(null, '', `?${query}`);
  }
}

initialize().then(() => window.ChoirStartup?.ready()).catch((error) => {
  window.ChoirStartup?.fail();
  els.pieceTitle.textContent = 'Prova non disponibile';
  els.scoreLoading.hidden = false;
  els.scoreLoading.textContent = error.message;
  console.error(error);
});
