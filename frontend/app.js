const { NormalizedScoreRuntime, MediaPlaybackClock } = window.ChoirScore;
const { centsBetween, pitchToHz, pitchToName, pitchToY, timeToX, measureSeekState, rhythmGridLines, smoothPitchBounds } = window.PracticeMath;
const { detectPitch, PitchSmoother } = window.ChoirPitch;

const UI_CONFIG = Object.freeze({
  historyBeats: 4.5,
  futureBeats: 7.5,
  centeredCents: 12,
  acceptableCents: 30,
  targetToleranceCents: 25,
  pitchViewportResponseMs: 180,
});

const els = Object.fromEntries([
  'piece-title', 'part-selector', 'playback-speed', 'accompaniment-mode', 'score-mode', 'settings',
  'score-part-label', 'score-measure-label', 'score-viewport', 'score-sheet', 'score-image', 'score-cursor',
  'score-loading', 'pitch-lane', 'intonation-readout', 'live-note', 'live-cents', 'live-state',
  'measure-counter', 'scoring-cue', 'previous-measure', 'toggle-playback', 'next-measure', 'volume', 'metronome-toggle', 'metronome-volume', 'backing-audio', 'toast', 'asset-status', 'microphone',
].map((id) => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), document.getElementById(id)]));

const state = {
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
  bundleManifest: null,
  bundleApproved: false,
  scoreGeometry: new Map(),
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
  microphoneAnalyser: null,
  microphoneBuffer: null,
  pitchSmoother: new PitchSmoother(),
  livePitch: null,
  pitchSamples: [],
};

function normalizeSlug(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function vocalParts(runtime, glyphMap) {
  return runtime.parts.filter((part) => Object.keys(glyphMap).some((key) => key.startsWith(`${part.id}-`)));
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
      };
    });
  }
  let beat = 0;
  return runtime.measures.map((measure) => {
    const duration = measure.timeSignatureNumerator * (4 / measure.timeSignatureDenominator);
    const item = { id: measure.id, number: measure.number, startBeat: beat, endBeat: beat + duration, timeSignatureNumerator: measure.timeSignatureNumerator, timeSignatureDenominator: measure.timeSignatureDenominator };
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
    : state.bundleManifest.assets.score_pages[state.runtime.selectedPartId];
  const source = pages?.[Math.max(0, Math.min(pages.length - 1, page - 1))];
  if (!source) { els.scoreLoading.hidden = false; els.scoreLoading.textContent = 'Pagina spartito non disponibile'; return; }
  if (els.scoreImage.getAttribute('src') === source) return;
  els.scoreLoading.hidden = false;
  state.activeScoreSegment = null;
  els.scoreImage.src = source;
  els.scoreImage.alt = state.fullScore ? 'Partitura completa' : `Spartito: ${part?.name ?? 'parte selezionata'}`;
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
  state.usesPreRenderedSpeed = Boolean(speedFile);
  els.backingAudio.src = `${state.bundleManifest.assets.audio_root}/${speedFile ?? mix.file}`;
  els.togglePlayback.disabled = false;
  els.backingAudio.volume = Number(els.volume.value) / 100;
  els.backingAudio.playbackRate = state.usesPreRenderedSpeed ? 1 : speed;
  els.backingAudio.preservesPitch = true;
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

function renderScore(beat) {
  const event = closestScoreEvent(beat);
  const glyph = sourceGlyph(event);
  const page = glyph?.page ?? Math.min(3, Math.floor(measureIndexAt(beat) / 7) + 1);
  if (page !== state.scorePage) state.scorePage = page;
  loadScoreImage(page);
  if (state.fullScore) { els.scoreSheet.style.transform = 'translate(0, 0)'; return; }
  if (!glyph) return;

  const nextEvent = state.runtime.targetEvents.find((candidate) => {
    const candidateGlyph = sourceGlyph(candidate);
    return candidate.onsetBeat >= event.onsetBeat + event.durationBeats - 0.001 && candidateGlyph?.systemId === glyph.systemId;
  });
  const candidateNextGlyph = sourceGlyph(nextEvent);
  const nextGlyph = candidateNextGlyph?.x_percent >= glyph.x_percent ? candidateNextGlyph : null;
  const progress = Math.max(0, Math.min(1, (beat - event.onsetBeat) / Math.max(event.durationBeats, .01)));
  const x = nextGlyph ? glyph.x_percent + (nextGlyph.x_percent - glyph.x_percent) * progress : glyph.x_percent;
  els.scoreCursor.style.left = `${x}%`;
  els.scoreCursor.style.top = `${glyph.y_percent}%`;

  const imageHeight = els.scoreImage.getBoundingClientRect().height;
  const viewportHeight = els.scoreViewport.clientHeight;
  const sheetWidth = els.scoreSheet.getBoundingClientRect().width;
  const viewportWidth = els.scoreViewport.clientWidth;
  if (!imageHeight || !sheetWidth || !viewportWidth) return;
  const systemY = imageHeight * glyph.systemCenterY / 100;
  const panelCount = Math.max(1, Math.ceil(sheetWidth / viewportWidth));
  const panelIndex = Math.min(panelCount - 1, Math.floor(x / 100 * panelCount));
  const segmentKey = `${glyph.systemId}-panel${panelIndex}`;
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
      .map((event) => event.midiPitch).filter(Number.isFinite);
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
  if (state.microphoneStatus !== 'active') { state.livePitch = null; return; }
  state.microphoneAnalyser.getFloatTimeDomainData(state.microphoneBuffer);
  const estimate = state.pitchSmoother.update(
    detectPitch(state.microphoneBuffer, state.microphoneContext.sampleRate),
    performance.now(),
  );
  state.livePitch = estimate.stable && estimate.clarity >= .7 && estimate.hz
    ? 69 + 12 * Math.log2(estimate.hz / 440)
    : null;
  if (running && state.livePitch != null) {
    const previous = state.pitchSamples.at(-1);
    if (!previous || beat - previous.beat >= .025) state.pitchSamples.push({ beat, pitch: state.livePitch, confidence: estimate.confidence });
  }
  const oldest = beat - UI_CONFIG.historyBeats - 1;
  state.pitchSamples = state.pitchSamples.filter((sample) => sample.beat >= oldest && sample.beat <= beat + .1).slice(-900);
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, r);
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
  const bounds = pitchBounds(beat);
  const rowHeight = (plot.bottom - plot.top) / (bounds.max - bounds.min);
  const nowX = timeToX(beat, beat, plot.left, plot.right, UI_CONFIG.historyBeats, UI_CONFIG.futureBeats);

  ctx.textBaseline = 'middle';
  ctx.font = `${rect.width < 700 ? 9 : 10}px Inter, sans-serif`;
  for (let pitch = Math.ceil(bounds.min); pitch <= Math.floor(bounds.max); pitch += 1) {
    const y = pitchToY(pitch, bounds.min, bounds.max, plot.top, plot.bottom);
    const isNaturalC = ((pitch % 12) + 12) % 12 === 0;
    ctx.strokeStyle = isNaturalC ? 'rgba(190,215,211,.19)' : 'rgba(190,215,211,.09)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plot.left, Math.round(y) + .5); ctx.lineTo(plot.right, Math.round(y) + .5); ctx.stroke();
    ctx.fillStyle = isNaturalC ? '#c9d5d1' : '#7f9695';
    ctx.textAlign = 'right'; ctx.fillText(pitchToName(pitch), plot.left - 8, y);
  }

  const visibleStart = beat - UI_CONFIG.historyBeats - 1;
  const visibleEnd = beat + UI_CONFIG.futureBeats + 1;
  ctx.save();
  ctx.beginPath(); ctx.rect(plot.left, 0, plot.right - plot.left, plot.bottom); ctx.clip();
  rhythmGridLines(state.occurrenceMeasures, visibleStart, visibleEnd).forEach((line) => {
    const x = timeToX(line.beat, beat, plot.left, plot.right, UI_CONFIG.historyBeats, UI_CONFIG.futureBeats);
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
    const x = timeToX(event.onsetBeat, beat, plot.left, plot.right, UI_CONFIG.historyBeats, UI_CONFIG.futureBeats);
    const endX = timeToX(event.onsetBeat + event.durationBeats, beat, plot.left, plot.right, UI_CONFIG.historyBeats, UI_CONFIG.futureBeats);
    const y = pitchToY(event.midiPitch, bounds.min, bounds.max, plot.top, plot.bottom);
    const blockHeight = Math.max(7, rowHeight * .43);
    const toleranceHeight = rowHeight * (UI_CONFIG.targetToleranceCents / 50);
    ctx.fillStyle = 'rgba(217,168,91,.10)';
    roundedRect(ctx, x, y - toleranceHeight / 2, endX - x, toleranceHeight, 3); ctx.fill();
    ctx.fillStyle = event.onsetBeat <= beat && beat < event.onsetBeat + event.durationBeats ? '#e4b665' : '#bd8e4c';
    roundedRect(ctx, x, y - blockHeight / 2, Math.max(2, endX - x - 2), blockHeight, 3); ctx.fill();
    const graceEnd = timeToX(event.onsetBeat + event.attackGraceBeats, beat, plot.left, plot.right, UI_CONFIG.historyBeats, UI_CONFIG.futureBeats);
    ctx.fillStyle = 'rgba(7,19,25,.24)'; ctx.fillRect(x, y - blockHeight / 2, Math.max(0, graceEnd - x), blockHeight);
    const lyric = event.lyric ?? '';
    if (lyric && endX - x > 18) { ctx.fillStyle = '#d6cbb6'; ctx.textAlign = 'left'; ctx.font = `${rect.width < 700 ? 9 : 11}px Georgia, serif`; ctx.fillText(lyric, x + 2, y - Math.max(9, blockHeight)); }
  });

  ctx.save();
  ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top); ctx.clip();
  ctx.strokeStyle = '#68d1cb'; ctx.lineWidth = rect.width < 700 ? 2.2 : 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(99,200,194,.3)'; ctx.shadowBlur = 6; ctx.beginPath();
  let drawing = false;
  for (const sample of state.pitchSamples) {
    if (sample.beat < visibleStart || sample.beat > Math.min(beat, visibleEnd)) { drawing = false; continue; }
    const x = timeToX(sample.beat, beat, plot.left, plot.right, UI_CONFIG.historyBeats, UI_CONFIG.futureBeats);
    const y = pitchToY(sample.pitch, bounds.min, bounds.max, plot.top, plot.bottom);
    if (drawing) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    drawing = true;
  }
  ctx.stroke(); ctx.restore(); ctx.shadowBlur = 0;

  ctx.strokeStyle = '#f0cf8f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(Math.round(nowX) + .5, plot.top); ctx.lineTo(Math.round(nowX) + .5, plot.bottom); ctx.stroke();
  ctx.fillStyle = '#f0cf8f'; ctx.font = '700 9px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('ORA', nowX, 1);
  ctx.fillStyle = '#718788'; ctx.font = '9px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('PASSATO', plot.left + 3, plot.bottom + 8); ctx.textAlign = 'right'; ctx.fillText('PROSSIME NOTE', plot.right - 3, plot.bottom + 8);
}

function renderReadout(beat, running) {
  const target = state.runtime.targetAt(beat);
  const singerPitch = state.livePitch;
  if (!target || singerPitch == null) {
    els.liveNote.textContent = target?.noteName ?? '—';
    els.liveCents.textContent = '— ¢';
    els.liveNote.textContent = '—';
    els.liveState.textContent = state.microphoneStatus === 'active'
      ? (running ? 'in ascolto' : 'microfono pronto')
      : state.microphoneStatus === 'denied' ? 'permesso negato' : 'attiva il microfono';
    els.intonationReadout.dataset.state = '';
    return;
  }
  const cents = centsBetween(pitchToHz(singerPitch), target.frequencyHz);
  const rounded = Math.round(cents);
  const abs = Math.abs(rounded);
  const label = abs <= UI_CONFIG.centeredCents ? 'centrato' : rounded > 0 ? 'leggermente crescente' : 'leggermente calante';
  els.liveNote.textContent = pitchToName(singerPitch);
  els.liveCents.textContent = `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)} ¢`;
  els.liveState.textContent = label;
  els.intonationReadout.dataset.state = abs > UI_CONFIG.acceptableCents ? 'outside' : 'inside';
  if (label !== state.lastAnnouncedState) state.lastAnnouncedState = label;
}

function render() {
  if (!state.runtime) return;
  let snapshot = state.clock.snapshot();
  if (snapshot.beat >= totalBeats()) {
    state.clock.pause(); state.clock.seekBeat(totalBeats()); snapshot = state.clock.snapshot(); updatePlaybackButton();
  }
  state.lastSnapshot = snapshot;
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
  const beatToken = `${measureIndex}:${beatInMeasure}`;
  if (state.lastMetronomeBeat == null) {
    state.lastMetronomeBeat = beatToken;
    const nearestPulse = (measure?.startBeat ?? 0) + Math.round((snapshot.beat - (measure?.startBeat ?? 0)) / metronomeBeatLength) * metronomeBeatLength;
    if (Math.abs(snapshot.beat - nearestPulse) < 0.06) {
      playMetronomeClick(beatInMeasure === 0);
    }
    return;
  }
  if (beatToken === state.lastMetronomeBeat) return;
  state.lastMetronomeBeat = beatToken;
  playMetronomeClick(beatInMeasure === 0);
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
  const seek = measureSeekState(state.occurrenceMeasures, index);
  state.selectedMeasureIndex = seek.selectedIndex;
  state.scoringStartBeat = seek.scoringStart;
  state.clock.seekBeat(seek.playbackStart);
  state.lastMetronomeBeat = null;
  state.pitchSamples = [];
  const playbackNumber = state.occurrenceMeasures[Math.max(0, seek.selectedIndex - 1)]?.number ?? 1;
  const scoringNumber = state.occurrenceMeasures[seek.selectedIndex]?.number ?? 1;
  els.scoringCue.textContent = seek.playbackStart === seek.scoringStart ? `Ingresso da ${scoringNumber}` : `Preascolto ${playbackNumber} · ingresso ${scoringNumber}`;
  if (autoPlay && !state.clock.running) state.clock.play().then(() => { updatePlaybackButton(); requestAnimationFrame(render); });
  updatePlaybackButton(); render();
}

async function togglePlayback() {
  if (state.fullScore) { showToast('Torna a “Mia parte” per avviare la prova.'); return; }
  if (!state.bundleApproved) { showToast('Serve l’approvazione admin di questo bundle.'); return; }
  if (els.accompanimentMode.value !== 'guide') { showToast('Questa modalità audio non è ancora disponibile.'); return; }
  if (state.clock.snapshot().beat >= totalBeats()) state.clock.seekBeat(0);
  if (state.clock.running) {
    state.clock.pause();
  } else {
    try { await state.clock.play(); }
    catch (error) { console.error('Audio playback failed', error, els.backingAudio.error); showToast(`Audio non avviato: ${error?.message || 'sorgente non disponibile'}`); }
  }
  updatePlaybackButton();
  if (state.clock.running && !state.rafId) state.rafId = requestAnimationFrame(render); else render();
}

function showToast(message) {
  els.toast.textContent = message; els.toast.hidden = false;
  clearTimeout(showToast.timeout); showToast.timeout = setTimeout(() => { els.toast.hidden = true; }, 2400);
}

function updateMicrophoneButton() {
  const active = state.microphoneStatus === 'active';
  els.microphone.setAttribute('aria-pressed', String(active));
  els.microphone.disabled = state.microphoneStatus === 'requesting';
  els.microphone.textContent = state.microphoneStatus === 'requesting' ? 'Connessione…' : active ? 'Mic attivo' : 'Microfono';
}

async function stopMicrophone() {
  state.microphoneStream?.getTracks().forEach((track) => track.stop());
  if (state.microphoneContext && state.microphoneContext.state !== 'closed') await state.microphoneContext.close();
  state.microphoneStream = null; state.microphoneContext = null; state.microphoneAnalyser = null; state.microphoneBuffer = null;
  state.microphoneStatus = 'idle'; state.livePitch = null; state.pitchSmoother.reset();
  updateMicrophoneButton(); render();
}

async function toggleMicrophone() {
  if (state.microphoneStatus === 'active') { await stopMicrophone(); return; }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    state.microphoneStatus = 'error'; updateMicrophoneButton();
    showToast('Il microfono richiede localhost o HTTPS e un browser compatibile.'); render(); return;
  }
  state.microphoneStatus = 'requesting'; updateMicrophoneButton();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass({ latencyHint: 'interactive' }); await context.resume();
    const analyser = context.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0;
    context.createMediaStreamSource(stream).connect(analyser);
    state.microphoneStream = stream; state.microphoneContext = context; state.microphoneAnalyser = analyser;
    state.microphoneBuffer = new Float32Array(analyser.fftSize); state.pitchSmoother.reset(); state.pitchSamples = [];
    state.microphoneStatus = 'active'; updateMicrophoneButton();
    showToast('Microfono attivo. Per risultati migliori usa le cuffie.');
    if (!state.rafId) state.rafId = requestAnimationFrame(render);
  } catch (error) {
    state.microphoneStatus = error?.name === 'NotAllowedError' ? 'denied' : 'error';
    updateMicrophoneButton(); showToast(state.microphoneStatus === 'denied' ? 'Permesso microfono negato.' : 'Impossibile avviare il microfono.'); render();
  }
}

function changePart(partId) {
  if (state.clock.running) state.clock.pause();
  state.runtime.selectPart(partId);
  const part = state.runtime.parts.find((item) => item.id === partId);
  els.scorePartLabel.textContent = part?.name ?? 'Parte';
  state.scorePage = 0;
  state.pitchViewport = null;
  buildScoreGeometry(partId);
  configureBacking();
  seekToMeasure(0);
}

function bindControls() {
  els.togglePlayback.addEventListener('click', togglePlayback);
  els.microphone.addEventListener('click', toggleMicrophone);
  els.previousMeasure.addEventListener('click', () => seekToMeasure(Math.max(0, measureIndexAt(state.clock.snapshot().beat) - 1)));
  els.nextMeasure.addEventListener('click', () => seekToMeasure(Math.min(state.occurrenceMeasures.length - 1, measureIndexAt(state.clock.snapshot().beat) + 1)));
  els.partSelector.addEventListener('change', () => changePart(els.partSelector.value));
  els.playbackSpeed.addEventListener('change', async () => {
    const speed = Number(els.playbackSpeed.value);
    const snapshot = state.clock.snapshot();
    const wasRunning = state.clock.running;
    state.clock.pause();
    configureBacking();
    if (state.usesPreRenderedSpeed) state.clock.setPreRenderedSpeed(speed); else state.clock.setSpeed(speed);
    state.clock.seekPerformanceTime(snapshot.performanceTime);
    state.lastMetronomeBeat = null;
    if (wasRunning) await state.clock.play();
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
  els.volume.addEventListener('input', () => { els.backingAudio.volume = Number(els.volume.value) / 100; });
  els.metronomeVolume.addEventListener('input', () => {
    const value = Number(els.metronomeVolume.value);
    if (value > 0) state.rememberedMetronomeVolume = value;
    updateMetronomeControl();
  });
  els.metronomeToggle.addEventListener('click', () => {
    els.metronomeVolume.value = Number(els.metronomeVolume.value) > 0 ? 0 : state.rememberedMetronomeVolume;
    state.lastMetronomeBeat = null;
    updateMetronomeControl();
  });
  els.backingAudio.addEventListener('ended', () => { updatePlaybackButton(); render(); });
  els.backingAudio.addEventListener('pause', () => { updatePlaybackButton(); if (!state.clock.running) render(); });
  els.backingAudio.addEventListener('error', () => showToast(`Errore audio (${els.backingAudio.error?.code ?? 'sconosciuto'}).`));
  els.settings.addEventListener('click', () => window.open('admin-review.html', 'choir-admin-review'));
  document.getElementById('exit-practice').addEventListener('click', () => showToast('Nessuna schermata repertorio collegata.'));
  window.addEventListener('resize', () => { state.activeScoreSegment = null; render(); });
  window.addEventListener('beforeunload', () => state.microphoneStream?.getTracks().forEach((track) => track.stop()));
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !['SELECT', 'INPUT', 'BUTTON'].includes(document.activeElement?.tagName)) { event.preventDefault(); togglePlayback(); }
    if (event.code === 'ArrowLeft' && event.altKey) seekToMeasure(measureIndexAt(state.clock.snapshot().beat) - 1);
    if (event.code === 'ArrowRight' && event.altKey) seekToMeasure(measureIndexAt(state.clock.snapshot().beat) + 1);
  });
  els.scoreImage.addEventListener('load', () => { state.activeScoreSegment = null; els.scoreLoading.hidden = true; render(); });
  els.scoreImage.addEventListener('error', () => { els.scoreLoading.hidden = false; els.scoreLoading.textContent = 'Spartito non disponibile'; });
}

async function initialize() {
  const bundleResponse = await fetch('practice-piece.json', { cache: 'no-store' });
  if (!bundleResponse.ok) throw new Error('Manifest del brano non disponibile');
  const bundleManifest = await bundleResponse.json();
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
  state.runtime = NormalizedScoreRuntime.fromNormalizedScore(payload);
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
  els.assetStatus.textContent = state.bundleApproved
    ? 'APPROVATO LOCALMENTE · bundle coerente'
    : 'PENDING REVIEW · apri la revisione admin dal menu ⋯';
  const parts = vocalParts(state.runtime, glyphMap);
  els.partSelector.replaceChildren(...parts.map((part) => new Option(part.name, part.id)));
  state.runtime.selectPart(parts.find((part) => part.name.toLowerCase().includes('tenor'))?.id ?? parts[0]?.id);
  els.partSelector.value = state.runtime.selectedPartId;
  state.occurrenceMeasures = buildOccurrenceMeasures(state.runtime);
  configureBacking();
  state.clock = new MediaPlaybackClock({ mediaElement: els.backingAudio, scoreRuntime: state.runtime });
  if (state.usesPreRenderedSpeed) state.clock.setPreRenderedSpeed(Number(els.playbackSpeed.value));
  else state.clock.setSpeed(Number(els.playbackSpeed.value));
  buildScoreGeometry(state.runtime.selectedPartId);
  if (state.syncDebug) {
    els.syncDebugPanel = document.createElement('aside');
    els.syncDebugPanel.className = 'sync-debug';
    els.syncDebugPanel.setAttribute('aria-label', 'Diagnostica sincronizzazione');
    document.body.append(els.syncDebugPanel);
  }
  const titleParts = state.runtime.title.split('·');
  els.pieceTitle.textContent = titleParts[0].trim();
  els.scorePartLabel.textContent = parts.find((part) => part.id === state.runtime.selectedPartId)?.name ?? 'Parte';
  bindControls(); updateMicrophoneButton(); updateMetronomeControl(); seekToMeasure(0); updatePlaybackButton();
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
