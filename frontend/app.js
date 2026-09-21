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
  'transpose',
  'exercise', 'exercise-dialog', 'phrase-start', 'phrase-end', 'phrase-apply', 'phrase-clear', 'exercise-close',
  'result-dialog', 'result-text', 'result-progress', 'retry', 'next-phrase', 'result-close',
  'phrase-loop', 'note-names',
  'piece-title', 'piece-picker', 'piece-picker-dialog', 'library-piece', 'library-part', 'library-note', 'library-open', 'library', 'restart-practice', 'restart-transport', 'ground-truth', 'ground-truth-dialog', 'ground-truth-status', 'ground-truth-count', 'ground-truth-start', 'ground-truth-approve', 'ground-truth-close', 'part-selector', 'playback-speed', 'accompaniment-mode', 'score-mode', 'settings',
  'score-part-label', 'score-measure-label', 'score-viewport', 'score-sheet', 'score-image', 'score-cursor',
  'score-loading', 'pitch-lane', 'intonation-readout', 'live-note', 'live-cents', 'live-state',
  'measure-counter', 'scoring-cue', 'previous-measure', 'toggle-playback', 'next-measure', 'volume', 'metronome-toggle', 'metronome-volume', 'backing-audio', 'toast', 'asset-status', 'microphone',
].map((id) => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), document.getElementById(id)]));

const state = {
  transpose: 0,
  phrase: null,
  autoLoop: false,
  noteNames: 'international',
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
  microphoneSource: null,
  microphoneAnalyser: null,
  microphoneSilencer: null,
  microphoneBuffer: null,
  microphoneRms: 0,
  pitchSmoother: new PitchSmoother(),
  livePitch: null,
  pitchSamples: [],
  pitchTakeId: 1,
  groundTruth: { capture: null },
  gridInspect: { active: false, viewBeat: 0, pitchOffset: 0, timeZoom: 1, pitchZoom: 1, pointer: null },
};

function normalizeSlug(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function noteLabel(pitch) {
  if (state.noteNames !== 'italian') return pitchToName(pitch);
  if (!Number.isFinite(pitch)) return '—';
  const midi = Math.round(pitch);
  return ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'][((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
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
    : (state.bundleManifest.assets.score_pages[state.runtime.selectedPartId] ?? state.bundleManifest.assets.full_score_pages);
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
  const file = `${state.bundleManifest.assets.audio_root}/${speedFile ?? mix.file}`;
  els.backingAudio.src = state.transpose
    ? `/api/transpose?file=${encodeURIComponent(file)}&semitones=${state.transpose}`
    : file;
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
  if (!glyph) {
    // Library MSCZ exports currently use complete-score SVG pages.  There is
    // no per-note SVG map yet, so expose the first staff system rather than
    // the large blank top margin of an A4 MuseScore page.
    els.scoreSheet.style.transform = 'translate(0, -13%)';
    els.scoreCursor.style.display = 'none';
    return;
  }
  els.scoreCursor.style.display = '';

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
  if (state.microphoneStatus !== 'active') { state.livePitch = null; state.microphoneRms = 0; return; }
  state.microphoneAnalyser.getFloatTimeDomainData(state.microphoneBuffer);
  const estimate = state.pitchSmoother.update(
    detectPitch(state.microphoneBuffer, state.microphoneContext.sampleRate),
    performance.now(),
  );
  state.microphoneRms = estimate.rms;
  document.getElementById('microphone-level').value = state.microphoneRms;
  document.getElementById('test-microphone-level').value = state.microphoneRms;
  document.getElementById('microphone-help').textContent = state.livePitch == null
    ? state.microphoneRms < .001 ? 'Microfono aperto: segnale troppo debole. Controlla ingresso e volume in Windows.' : 'Il segnale arriva. Tieni una nota per riconoscerla.'
    : `Nota riconosciuta: ${noteLabel(state.livePitch)}. Sei pronto per iniziare.`;
  state.livePitch = estimate.stable && estimate.accepted && estimate.hz
    ? 69 + 12 * Math.log2(estimate.hz / 440)
    : null;
  if (running && state.livePitch != null) {
    const target = state.runtime.targetAt(beat);
    if (state.attemptActive && target && beat >= state.scoringStartBeat && beat >= target.onsetBeat + target.attackGraceBeats) {
      state.attempt.voicedMs += elapsed;
      if (Math.abs((state.livePitch - target.midiPitch - state.transpose) * 100) <= UI_CONFIG.acceptableCents) state.attempt.insideMs += elapsed;
    }
    const previous = state.pitchSamples.at(-1);
    if (!previous || previous.takeId !== state.pitchTakeId || beat - previous.beat >= .025) {
      state.pitchSamples.push({ beat, pitch: state.livePitch, confidence: estimate.confidence, takeId: state.pitchTakeId });
    }
  }
  // Keep a bounded session history: the director can pan back over earlier
  // takes instead of losing the trace whenever playback is repositioned.
  if (state.pitchSamples.length > 12000) state.pitchSamples.splice(0, state.pitchSamples.length - 12000);
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
    const isNaturalC = pitchClass === 0;
    // Alternating white-key and black-key lanes make the vertical axis read
    // like a piano keyboard instead of a uniform scientific graph.
    ctx.fillStyle = isWhiteKey ? 'rgba(166,198,193,.075)' : 'rgba(2,10,14,.27)';
    ctx.fillRect(plot.left, y - rowHeight / 2, plot.right - plot.left, rowHeight);
    ctx.strokeStyle = isNaturalC ? 'rgba(190,215,211,.25)' : (isWhiteKey ? 'rgba(190,215,211,.13)' : 'rgba(190,215,211,.055)');
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plot.left, Math.round(y) + .5); ctx.lineTo(plot.right, Math.round(y) + .5); ctx.stroke();
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
    const blockHeight = Math.max(7, rowHeight * .43);
    const toleranceHeight = rowHeight * (UI_CONFIG.targetToleranceCents / 50);
    ctx.fillStyle = 'rgba(217,168,91,.10)';
    roundedRect(ctx, x, y - toleranceHeight / 2, endX - x, toleranceHeight, 3); ctx.fill();
    ctx.fillStyle = event.onsetBeat <= beat && beat < event.onsetBeat + event.durationBeats ? '#e4b665' : '#bd8e4c';
    roundedRect(ctx, x, y - blockHeight / 2, Math.max(2, endX - x - 2), blockHeight, 3); ctx.fill();
    const graceEnd = timeToX(event.onsetBeat + event.attackGraceBeats, displayBeat, plot.left, plot.right, historyBeats, futureBeats);
    ctx.fillStyle = 'rgba(7,19,25,.24)'; ctx.fillRect(x, y - blockHeight / 2, Math.max(0, graceEnd - x), blockHeight);
    const lyric = event.lyric ?? '';
    if (lyric && endX - x > 18) { ctx.fillStyle = '#d6cbb6'; ctx.textAlign = 'left'; ctx.font = `${rect.width < 700 ? 9 : 11}px Georgia, serif`; ctx.fillText(lyric, x + 2, y - Math.max(9, blockHeight)); }
  });

  ctx.save();
  ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top); ctx.clip();
  ctx.strokeStyle = '#68d1cb'; ctx.lineWidth = rect.width < 700 ? 2.2 : 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(99,200,194,.3)'; ctx.shadowBlur = 6; ctx.beginPath();
  let drawing = false;
  let previousTakeId = null;
  for (const sample of state.pitchSamples) {
    if (sample.beat < visibleStart || sample.beat > visibleEnd) { drawing = false; previousTakeId = null; continue; }
    if (previousTakeId != null && sample.takeId !== previousTakeId) drawing = false;
    const x = timeToX(sample.beat, displayBeat, plot.left, plot.right, historyBeats, futureBeats);
    const y = pitchToY(sample.pitch, bounds.min, bounds.max, plot.top, plot.bottom);
    if (drawing) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    drawing = true;
    previousTakeId = sample.takeId;
  }
  ctx.stroke();
  // A stationary clock has no horizontal history to draw. Keep the current
  // estimate visible at NOW so activating the microphone gives immediate,
  // unambiguous feedback before playback starts.
  if (Number.isFinite(state.livePitch)) {
    const radius = rect.width < 700 ? 4 : 5;
    const y = Math.max(plot.top + radius, Math.min(
      plot.bottom - radius,
      pitchToY(state.livePitch, bounds.min, bounds.max, plot.top, plot.bottom),
    ));
    ctx.fillStyle = '#68d1cb';
    ctx.beginPath(); ctx.arc(nowX, y, radius, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore(); ctx.shadowBlur = 0;

  const currentTarget = state.runtime.targetAt(beat);
  ctx.fillStyle = '#0a181e'; ctx.fillRect(nowX - 48, plot.top - 8, 43, plot.bottom - plot.top + 16);
  for (let pitch = Math.ceil(bounds.min); pitch <= Math.floor(bounds.max); pitch += 1) {
    const y = pitchToY(pitch, bounds.min, bounds.max, plot.top, plot.bottom);
    const active = currentTarget && pitch === currentTarget.midiPitch + state.transpose;
    ctx.fillStyle = active ? '#f0cf8f' : '#93a9a8';
    ctx.font = `${active ? '700 ' : ''}${Math.max(8, Math.min(12, rowHeight * .8))}px Inter, sans-serif`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(noteLabel(pitch), nowX - 8, y);
  }
  if (Number.isFinite(state.livePitch) && (state.livePitch < bounds.min || state.livePitch > bounds.max)) {
    ctx.fillStyle = '#68d1cb'; ctx.textAlign = 'left';
    ctx.fillText(`${state.livePitch < bounds.min ? '↓' : '↑'} ${noteLabel(state.livePitch)} fuori scala`, nowX + 10,
      state.livePitch < bounds.min ? plot.bottom - 10 : plot.top + 10);
  }

  ctx.strokeStyle = '#f0cf8f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(Math.round(nowX) + .5, plot.top); ctx.lineTo(Math.round(nowX) + .5, plot.bottom); ctx.stroke();
  ctx.fillStyle = '#f0cf8f'; ctx.font = '700 9px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(inspecting ? 'VISTA' : 'ORA', nowX, 1);
  ctx.fillStyle = '#718788'; ctx.font = '9px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('PASSATO', plot.left + 3, plot.bottom + 8); ctx.textAlign = 'right'; ctx.fillText('PROSSIME NOTE', plot.right - 3, plot.bottom + 8);
}

function renderReadout(beat, running) {
  const target = state.runtime.targetAt(beat);
  const singerPitch = state.livePitch;
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
  if (els.accompanimentMode.value !== 'guide') { showToast('Questa modalità audio non è ancora disponibile.'); return; }
  if (state.clock.snapshot().beat >= totalBeats()) state.clock.seekBeat(0);
  if (state.clock.running) {
    state.clock.pause();
    savePitchHistory();
  } else {
    state.gridInspect.active = false;
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
  const active = state.microphoneStatus === 'active';
  els.microphone.setAttribute('aria-pressed', String(active));
  els.microphone.disabled = state.microphoneStatus === 'requesting';
  els.microphone.textContent = state.microphoneStatus === 'requesting' ? 'Connessione…' : active ? 'Mic attivo' : 'Microfono';
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
  state.microphoneStatus = 'idle'; state.livePitch = null; state.microphoneRms = 0; state.pitchSmoother.reset();
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

function pitchHistoryKey() { return `${preferenceKey()}:pitch-history`; }

function savePitchHistory() {
  try {
    const samples = state.pitchSamples.slice(-12000).map((sample) => ({
      beat: Number(sample.beat.toFixed(3)), pitch: Number(sample.pitch.toFixed(2)),
      confidence: Number((sample.confidence ?? 0).toFixed(2)), takeId: sample.takeId,
    }));
    localStorage.setItem(pitchHistoryKey(), JSON.stringify({ samples, pitchTakeId: state.pitchTakeId }));
  } catch (_) { /* Storage is optional; the current-session history remains available. */ }
}

function restorePitchHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(pitchHistoryKey()));
    const samples = Array.isArray(saved?.samples) ? saved.samples.filter((sample) => Number.isFinite(sample.beat)
      && Number.isFinite(sample.pitch) && Number.isInteger(sample.takeId)).slice(-12000) : [];
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

function groundTruthStore(mode = 'readonly') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('choir-ground-truth', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('takes', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result.transaction('takes', mode).objectStore('takes'));
  });
}

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

function savePreferences() {
  try {
    localStorage.setItem(preferenceKey(), JSON.stringify({ transpose: state.transpose,
      speed: els.playbackSpeed.value, volume: els.volume.value, metronome: els.metronomeVolume.value,
      measure: measureIndexAt(state.clock.snapshot().beat), phrase: state.phrase,
      autoLoop: state.autoLoop, noteNames: state.noteNames }));
    localStorage.setItem(`choir-part:${state.bundleManifest.piece_id ?? state.runtime.title}`, state.runtime.selectedPartId);
  } catch (_) { /* Practice remains usable when storage is unavailable. */ }
}

function restorePreferences() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(preferenceKey())) ?? {}; } catch (_) {}
  state.transpose = Number.isInteger(saved.transpose) && Math.abs(saved.transpose) <= 12 ? saved.transpose : 0;
  els.transpose.value = String(state.transpose);
  state.autoLoop = saved.autoLoop === true; els.phraseLoop.checked = state.autoLoop;
  state.noteNames = saved.noteNames === 'italian' ? 'italian' : 'international'; els.noteNames.value = state.noteNames;
  const measures = buildOccurrenceMeasures(state.runtime);
  state.selectedMeasureIndex = Number.isInteger(saved.measure) ? Math.max(0, Math.min(measures.length - 1, saved.measure)) : 0;
  state.phrase = saved.phrase && Number.isInteger(saved.phrase.start) && Number.isInteger(saved.phrase.end)
    && saved.phrase.start >= 0 && saved.phrase.start <= saved.phrase.end && saved.phrase.end < measures.length ? saved.phrase : null;
  els.playbackSpeed.value = ['0.5', '0.75', '1'].includes(saved.speed) ? saved.speed : '1';
  els.volume.value = Number.isFinite(Number(saved.volume)) ? Math.max(0, Math.min(100, Number(saved.volume))) : 62;
  els.metronomeVolume.value = Number.isFinite(Number(saved.metronome)) ? Math.max(0, Math.min(100, Number(saved.metronome))) : 0;
}

function changePart(partId) {
  state.attemptActive = false;
  if (state.clock.running) state.clock.pause();
  savePitchHistory();
  state.runtime.selectPart(partId);
  restorePreferences();
  restorePitchHistory();
  const part = state.runtime.parts.find((item) => item.id === partId);
  els.scorePartLabel.textContent = part?.name ?? 'Parte';
  state.scorePage = 0;
  state.pitchViewport = null;
  buildScoreGeometry(partId);
  configureBacking();
  if (state.usesPreRenderedSpeed) state.clock.setPreRenderedSpeed(Number(els.playbackSpeed.value));
  else state.clock.setSpeed(Number(els.playbackSpeed.value));
  seekToMeasure(0);
}

function bindControls() {
  bindGridInspection();
  document.getElementById('test-microphone').addEventListener('click', toggleMicrophone);
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
  els.togglePlayback.addEventListener('click', togglePlayback);
  els.restartPractice.addEventListener('click', restartPractice);
  els.restartTransport.addEventListener('click', restartPractice);
  els.groundTruth.addEventListener('click', openGroundTruthDialog);
  els.groundTruthStart.addEventListener('click', startGroundTruthCapture);
  els.groundTruthApprove.addEventListener('click', approveGroundTruthCapture);
  els.groundTruthClose.addEventListener('click', () => els.groundTruthDialog.close());
  els.microphone.addEventListener('click', toggleMicrophone);
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
    savePreferences();
  });
  els.backingAudio.addEventListener('ended', () => { updatePlaybackButton(); render(); });
  els.backingAudio.addEventListener('pause', () => { updatePlaybackButton(); if (!state.clock.running) render(); });
  els.backingAudio.addEventListener('error', () => showToast(`Errore audio (${els.backingAudio.error?.code ?? 'sconosciuto'}).`));
  els.settings.addEventListener('click', () => window.open('admin-review.html', 'choir-admin-review'));
  document.getElementById('exit-practice').addEventListener('click', openLibraryPicker);
  window.addEventListener('resize', () => { state.activeScoreSegment = null; render(); });
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
  const libraryResponse = await fetch('/api/library', { cache: 'no-store' });
  if (!libraryResponse.ok) throw new Error('Libreria dei brani non disponibile');
  state.library = (await libraryResponse.json()).pieces ?? [];
  if (!state.library.length) throw new Error('Non ci sono brani MuseScore nella cartella sheets');
  bindLibraryPicker();
  const selectedPiece = new URLSearchParams(window.location.search).get('piece');
  if (!selectedPiece || !state.library.some((piece) => piece.piece_id === selectedPiece)) {
    openLibraryPicker();
    return;
  }
  await loadPracticePiece(selectedPiece);
}

function openLibraryPicker() {
  if (state.clock?.running) state.clock.pause();
  if (state.clock) updatePlaybackButton();
  els.libraryPiece.replaceChildren(...state.library.map((piece) => new Option(piece.title, piece.piece_id)));
  const requested = new URLSearchParams(window.location.search).get('piece');
  els.libraryPiece.value = state.library.some((piece) => piece.piece_id === requested) ? requested : state.library[0].piece_id;
  updateLibraryParts();
  if (!els.piecePickerDialog.open) els.piecePickerDialog.showModal();
}

async function updateLibraryParts() {
  const piece = state.library.find((item) => item.piece_id === els.libraryPiece.value);
  if (piece && !piece.parts?.length && !piece.loading) {
    piece.loading = true;
    els.libraryOpen.disabled = true;
    els.libraryPart.replaceChildren(new Option('Preparazione parti…', ''));
    els.libraryNote.hidden = false;
    els.libraryNote.textContent = 'Lettura del file MuseScore in corso…';
    try {
      const response = await fetch(`/api/library/${encodeURIComponent(piece.piece_id)}/bundle`, { cache: 'no-store' });
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
  const message = piece?.monodic ? 'Brano monodico: Soprano e Contralto usano la melodia scritta; Tenore e Basso la cantano un’ottava sotto.' : (!parts.length ? 'Nessuna parte vocale disponibile nel file MuseScore.' : '');
  els.libraryNote.hidden = !message;
  els.libraryNote.textContent = message;
}

function bindLibraryPicker() {
  els.piecePicker.addEventListener('click', openLibraryPicker);
  els.library.addEventListener('click', openLibraryPicker);
  els.libraryPiece.addEventListener('change', updateLibraryParts);
  els.libraryOpen.addEventListener('click', () => {
    const query = new URLSearchParams({ piece: els.libraryPiece.value });
    if (els.libraryPart.value) query.set('part', els.libraryPart.value);
    window.location.search = query.toString();
  });
}

function restartPractice() {
  state.clock.pause();
  savePitchHistory();
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
  const bundleResponse = await fetch(`/api/library/${encodeURIComponent(pieceId)}/bundle`, { cache: 'no-store' });
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
  els.assetStatus.textContent = state.bundleApproved
    ? 'APPROVATO LOCALMENTE · bundle coerente'
    : 'PENDING REVIEW · apri la revisione admin dal menu ⋯';
  if (bundleManifest.local_source) state.bundleApproved = true;
  els.assetStatus.textContent = bundleManifest.local_source
    ? 'SORGENTE MUSESCORE LOCALE · derivati pronti per la prova'
    : els.assetStatus.textContent;
  const parts = vocalParts(state.runtime);
  els.partSelector.replaceChildren(...parts.map((part) => new Option(part.name, part.id)));
  let savedPart;
  try { savedPart = new URLSearchParams(window.location.search).get('part') ?? localStorage.getItem(`choir-part:${bundleManifest.piece_id ?? state.runtime.title}`); } catch (_) {}
  state.runtime.selectPart(parts.find((part) => part.id === savedPart)?.id ?? parts.find((part) => part.name.toLowerCase().includes('tenor'))?.id ?? parts[0]?.id);
  els.partSelector.value = state.runtime.selectedPartId;
  els.transpose.replaceChildren(...Array.from({ length: 25 }, (_, index) => {
    const offset = index - 12;
    const label = offset === 0 ? 'Originale' : Math.abs(offset) === 12
      ? `${offset > 0 ? '+' : '−'}1 ottava` : `${offset > 0 ? '+' : ''}${offset} semitoni`;
    return new Option(label, String(offset));
  }));
  restorePreferences();
  restorePitchHistory();
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
  const restoredMeasure = state.selectedMeasureIndex;
  bindControls(); updateMicrophoneButton(); updateMetronomeControl(); seekToMeasure(restoredMeasure); updatePlaybackButton();
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
