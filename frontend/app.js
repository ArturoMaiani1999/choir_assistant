const TARGET_DEFAULT_HZ = 440;
const ANALYSIS_INTERVAL_MS = 55;
const HISTORY_WINDOW_MS = 8000;
const {
  MIN_HZ,
  MAX_HZ,
  centsBetween,
  detectPitch,
  PitchSmoother,
  rmsOf,
} = window.ChoirPitch;
const { createDemoScore, NormalizedScoreRuntime, PerformanceClock } = window.ChoirScore;

let scoreRuntime = createDemoScore();
let performanceClock = new PerformanceClock({ tempoBpm: scoreRuntime.tempoBpm });
let activeRuntimeTarget = scoreRuntime.targetAt(0);
let sessionState = 'idle';

const els = {
  scoreTitle: document.querySelector('#score-title'),
  sessionAlert: document.querySelector('#session-alert'),
  sessionAlertTitle: document.querySelector('#session-alert-title'),
  sessionAlertCopy: document.querySelector('#session-alert-copy'),
  scorePosition: document.querySelector('#score-position'),
  targetNote: document.querySelector('#target-note'),
  tempoLabel: document.querySelector('#tempo-label'),
  scoreViewport: document.querySelector('#score-viewport'),
  scorePages: document.querySelector('#score-pages'),
  partSelector: document.querySelector('#part-selector'),
  scoreProgress: document.querySelector('#score-progress'),
  expectedNote: document.querySelector('#expected-note'),
  targetFrequency: document.querySelector('#target-frequency'),
  voiceFrequency: document.querySelector('#voice-frequency'),
  voiceRangeState: document.querySelector('#voice-range-state'),
  voiceValue: document.querySelector('.voice-value'),
  heardNote: document.querySelector('#heard-note'),
  toggleSession: document.querySelector('#toggle-session'),
  sessionLabel: document.querySelector('#session-label'),
  resetSession: document.querySelector('#reset-session'),
  engineStatus: document.querySelector('#engine-status'),
  pitchState: document.querySelector('#pitch-state'),
  confidence: document.querySelector('#confidence'),
  intonationMarker: document.querySelector('#intonation-marker'),
  detectedHz: document.querySelector('#detected-hz'),
  cents: document.querySelector('#cents'),
  rms: document.querySelector('#rms'),
  micHint: document.querySelector('#mic-hint'),
  debugInfo: document.querySelector('#debug-info'),
  canvas: document.querySelector('#pitch-canvas'),
  plotRange: document.querySelector('#plot-range'),
  rangeAlert: document.querySelector('#range-alert'),
};

const graphContext = els.canvas.getContext('2d');
const pitchSmoother = new PitchSmoother();
const intentionallyStoppedTracks = new WeakSet();
const PART_ASSET_NAMES = { P1: 'soprano', P2: 'contralto', P3: 'tenore', P4: 'basso' };
const MEASURE_LAYOUT = {
  1: { page: 1, left: 6, top: 33.5, width: 23.6, height: 14.5 },
  2: { page: 1, left: 29.6, top: 33.5, width: 20.2, height: 14.5 },
  3: { page: 1, left: 49.8, top: 33.5, width: 17.8, height: 14.5 },
  4: { page: 1, left: 67.6, top: 33.5, width: 14.1, height: 14.5 },
  5: { page: 1, left: 81.7, top: 33.5, width: 18.2, height: 14.5 },
  6: { page: 1, left: 4.1, top: 83, width: 34.1, height: 15 },
  7: { page: 1, left: 38.2, top: 83, width: 22.2, height: 15 },
  8: { page: 1, left: 60.4, top: 83, width: 22.1, height: 15 },
  9: { page: 1, left: 82.5, top: 83, width: 17.4, height: 15 },
  10: { page: 2, left: 4.1, top: 15, width: 95.8, height: 21 },
  11: { page: 2, left: 4.1, top: 79, width: 95.8, height: 20 },
  12: { page: 3, left: 4.1, top: 45, width: 11.3, height: 47 },
};
let audioContext = null;
let analyser = null;
let source = null;
let silentMonitor = null;
let stream = null;
let track = null;
let animationId = null;
let samples = null;
let byteSamples = null;
let history = [];
let lastAnalysisMs = 0;
let lastCursorMeasure = null;
let scoreView = 'original';
let silenceStartedMs = null;
let scoreGlyphMap = {};

function midiToItalianName(midi) {
  const names = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
  const pitchClass = ((midi % 12) + 12) % 12;
  return `${names[pitchClass]}${Math.floor(midi / 12) - 1}`;
}

function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

function hzToName(hz) {
  return midiToItalianName(Math.round(hzToMidi(hz)));
}

function formatHz(hz, digits = 1) {
  return `${hz.toFixed(digits).replace('.', ',')} Hz`;
}

function formatSigned(value, digits = 1) {
  const formatted = Math.abs(value).toFixed(digits).replace('.', ',');
  return `${value >= 0 ? '+' : '−'}${formatted}`;
}

function targetHz() {
  return activeRuntimeTarget?.frequencyHz ?? TARGET_DEFAULT_HZ;
}

function scoreDurationBeats() {
  if (scoreRuntime.performanceOccurrences?.length) {
    return scoreRuntime.performanceOccurrences.at(-1).endBeat;
  }
  return scoreRuntime.targetEvents.reduce(
    (maximum, event) => Math.max(maximum, event.onsetBeat + event.durationBeats),
    0,
  );
}

function renderScorePages() {
  lastCursorMeasure = null;
  const assetName = PART_ASSET_NAMES[scoreRuntime.selectedPartId] ?? 'soprano';
  const partName = scoreRuntime.parts.find((part) => part.id === scoreRuntime.selectedPartId)?.name ?? 'Soprano';
  const pages = [1, 2, 3].map((pageNumber) => {
    const page = document.createElement('figure');
    page.className = 'score-page';
    page.dataset.page = String(pageNumber);
    const image = document.createElement('img');
    image.src = scoreView === 'original'
      ? `score-assets/gloria-originale/pagina-${pageNumber}.svg`
      : `score-assets/gloria-parts/${assetName}-${pageNumber}.svg`;
    image.alt = scoreView === 'original'
      ? `Gloria, partitura completa, pagina ${pageNumber} di 3`
      : `Gloria, parte ${partName}, pagina ${pageNumber} di 3`;
    image.loading = pageNumber === 1 ? 'eager' : 'lazy';
    image.addEventListener('load', () => updateScoreCursor(scoreRuntime.measureAt(performanceClock.currentBeat)));
    const highlight = document.createElement('span');
    highlight.className = 'measure-highlight';
    highlight.hidden = true;
    const noteCursor = document.createElement('span');
    noteCursor.className = 'target-note-cursor';
    noteCursor.setAttribute('aria-hidden', 'true');
    noteCursor.hidden = true;
    page.append(image, highlight, noteCursor);
    return page;
  });
  els.scorePages.replaceChildren(...pages);
}

function updateScoreCursor(position) {
  const layout = MEASURE_LAYOUT[Number(position?.number)];
  const sourceEventId = activeRuntimeTarget?.id.match(/^target-(.+)-\d+$/)?.[1];
  const glyph = sourceEventId ? scoreGlyphMap[sourceEventId] : null;
  els.scorePages.querySelectorAll('.score-page').forEach((page) => {
    const highlight = page.querySelector('.measure-highlight');
    const noteCursor = page.querySelector('.target-note-cursor');
    const activePage = scoreView === 'part' && glyph ? glyph.page : layout?.page;
    const active = activePage && Number(page.dataset.page) === activePage;
    page.classList.toggle('is-active', Boolean(active));
    highlight.hidden = !active || scoreView === 'original';
    noteCursor.hidden = !active || scoreView !== 'part' || !glyph;
    if (!active) return;
    if (scoreView === 'part') {
      Object.assign(highlight.style, {
        left: `${layout.left}%`, top: `${layout.top}%`, width: `${layout.width}%`, height: `${layout.height}%`,
      });
      if (glyph) {
        Object.assign(noteCursor.style, { left: `${glyph.x_percent}%`, top: `${glyph.y_percent}%` });
      }
    }
    const cursorKey = `${position.number}-${page.dataset.page}`;
    if (cursorKey !== lastCursorMeasure && page.clientWidth > 0) {
      const horizontalPercent = glyph?.x_percent ?? layout.left;
      const verticalPercent = glyph?.y_percent ?? layout.top;
      const desiredLeft = scoreView === 'original'
        ? 0
        : page.offsetLeft + (horizontalPercent / 100) * page.clientWidth - els.scoreViewport.clientWidth * 0.28;
      const desiredTop = scoreView === 'original'
        ? page.offsetTop
        : page.offsetTop + (verticalPercent / 100) * page.clientHeight - 28;
      els.scoreViewport.scrollTo({ left: Math.max(0, desiredLeft), top: Math.max(0, desiredTop), behavior: 'smooth' });
      lastCursorMeasure = cursorKey;
    }
  });
}

function renderScoreRuntime(nowMs = performance.now()) {
  const snapshot = performanceClock.snapshot(nowMs);
  const totalBeats = Math.max(1, scoreDurationBeats());
  const safeBeat = Math.min(snapshot.beat, totalBeats);
  const positionBeat = Math.min(safeBeat, Math.max(0, totalBeats - 0.001));
  const position = scoreRuntime.measureAt(positionBeat);
  activeRuntimeTarget = scoreRuntime.targetAt(safeBeat);
  const expectedName = activeRuntimeTarget ? midiToItalianName(activeRuntimeTarget.midiPitch) : '—';

  els.scorePosition.textContent = `Battuta ${position.number} · movimento ${position.beatInMeasure.toFixed(1)}`;
  els.targetNote.textContent = expectedName;
  els.expectedNote.textContent = expectedName;
  els.targetFrequency.textContent = activeRuntimeTarget ? formatHz(activeRuntimeTarget.frequencyHz) : 'Pausa';
  els.tempoLabel.textContent = scoreRuntime.measures[0]?.timeSignatureDenominator === 8
    ? `♩. = ${Math.round(scoreRuntime.tempoBpm / 2)}`
    : `${Math.round(scoreRuntime.tempoBpm)} BPM`;
  els.scoreProgress.style.width = `${Math.min(100, (safeBeat / totalBeats) * 100)}%`;
  updateScoreCursor(position);
  return snapshot;
}

async function loadScoreDocument() {
  try {
    const response = await fetch('score-fixtures/gloria-frisina-draft.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const glyphResponse = await fetch('score-assets/gloria-parts/glyph-map.json', { cache: 'no-store' });
    scoreGlyphMap = glyphResponse.ok ? await glyphResponse.json() : {};
    const loadedRuntime = NormalizedScoreRuntime.fromNormalizedScore(payload);
    if (loadedRuntime.targetEvents.length === 0) throw new Error('Lo spartito non contiene eventi target');
    scoreRuntime = loadedRuntime;
    performanceClock = new PerformanceClock({ tempoBpm: scoreRuntime.tempoBpm });
    activeRuntimeTarget = scoreRuntime.targetAt(0);
    els.scoreTitle.textContent = scoreRuntime.title;
    els.partSelector.value = scoreRuntime.selectedPartId;
    renderScorePages();
    renderScoreRuntime();
    drawGraph();
  } catch (error) {
    console.warn('Uso della sequenza simbolica di riserva:', error);
    els.scoreTitle.textContent = 'Esercizio simbolico di riserva';
    renderScorePages();
    renderScoreRuntime();
  }
}

function setStatus(text, state = '') {
  els.engineStatus.textContent = text;
  els.engineStatus.dataset.state = state;
}

function showSessionAlert(title, copy, tone = 'warning') {
  els.sessionAlertTitle.textContent = title;
  els.sessionAlertCopy.textContent = copy;
  els.sessionAlert.dataset.tone = tone;
  els.sessionAlert.hidden = false;
}

function hideSessionAlert() {
  els.sessionAlert.hidden = true;
  els.sessionAlert.dataset.tone = '';
}

function renderTrackState(event) {
  const observedTrack = event?.currentTarget ?? track;
  if (!observedTrack) return;
  if (observedTrack.readyState === 'ended' && !intentionallyStoppedTracks.has(observedTrack)) {
    interruptSession('Microfono scollegato', 'La prova è stata messa in pausa. Ricollega il microfono e premi “Riprendi la prova”.');
  } else if (observedTrack.muted) {
    setStatus('Microfono disattivato', 'error');
    els.pitchState.textContent = 'Il microfono è disattivato dal browser o da Windows.';
    els.micHint.lastChild.textContent = ' Controlla privacy, volume d’ingresso e tasto fisico del microfono.';
    if (sessionState === 'running') {
      interruptSession('Microfono disattivato', 'Il tempo è stato fermato per non perdere la sincronizzazione. Riattiva l’ingresso e riprendi.');
    }
  } else if (observedTrack.readyState === 'live' && sessionState === 'running') {
    setStatus('In prova', 'active');
  }
}

function recordPitchHistory(hz, nowMs) {
  history.push({ hz, targetHz: activeRuntimeTarget?.frequencyHz ?? null, timeMs: nowMs });
  history = history.filter((point) => nowMs - point.timeMs <= HISTORY_WINDOW_MS + 250);
}

function drawGraph(nowMs = performance.now()) {
  const width = els.canvas.width;
  const height = els.canvas.height;
  const plot = { left: 76, right: width - 18, top: 16, bottom: height - 25 };
  const recent = history.filter((point) => nowMs - point.timeMs <= HISTORY_WINDOW_MS);
  const frequencies = recent.flatMap((point) => [point.hz, point.targetHz]).filter((value) => value > 0);
  const currentTargetHz = activeRuntimeTarget?.frequencyHz ?? null;
  if (currentTargetHz) frequencies.push(currentTargetHz / 2, currentTargetHz * 2);
  if (frequencies.length === 0) frequencies.push(110, 880);

  let minHz = Math.max(MIN_HZ, Math.min(...frequencies) / 1.12);
  let maxHz = Math.min(MAX_HZ, Math.max(...frequencies) * 1.12);
  if (maxHz / minHz < 2) {
    const center = Math.sqrt(minHz * maxHz);
    minHz = Math.max(MIN_HZ, center / Math.sqrt(2));
    maxHz = Math.min(MAX_HZ, center * Math.sqrt(2));
  }
  const minLog = Math.log(minHz);
  const maxLog = Math.log(maxHz);
  const xForTime = (timeMs) => plot.right - ((nowMs - timeMs) / HISTORY_WINDOW_MS) * (plot.right - plot.left);
  const yForHz = (hz) => plot.bottom - ((Math.log(hz) - minLog) / (maxLog - minLog)) * (plot.bottom - plot.top);

  graphContext.clearRect(0, 0, width, height);
  graphContext.fillStyle = '#061016';
  graphContext.fillRect(0, 0, width, height);
  graphContext.font = '20px Inter, sans-serif';
  graphContext.textAlign = 'right';
  graphContext.textBaseline = 'middle';
  for (let index = 0; index < 5; index += 1) {
    const ratio = index / 4;
    const hz = Math.exp(maxLog - ratio * (maxLog - minLog));
    const y = plot.top + ratio * (plot.bottom - plot.top);
    graphContext.strokeStyle = index === 2 ? 'rgba(178,211,211,.18)' : 'rgba(178,211,211,.10)';
    graphContext.lineWidth = 1;
    graphContext.beginPath();
    graphContext.moveTo(plot.left, y);
    graphContext.lineTo(plot.right, y);
    graphContext.stroke();
    graphContext.fillStyle = '#89a2a2';
    graphContext.fillText(`${Math.round(hz)} Hz`, plot.left - 10, y);
  }
  graphContext.textAlign = 'center';
  graphContext.textBaseline = 'top';
  [8, 6, 4, 2, 0].forEach((secondsAgo, index) => {
    const x = plot.left + (index / 4) * (plot.right - plot.left);
    graphContext.fillStyle = '#70898a';
    graphContext.fillText(secondsAgo === 0 ? 'ora' : `−${secondsAgo}s`, x, plot.bottom + 5);
  });

  const targetPoints = recent.length > 0
    ? recent.map((point) => ({ timeMs: point.timeMs, targetHz: point.targetHz }))
    : [];
  if (targetPoints[0]?.targetHz && targetPoints[0].timeMs > nowMs - HISTORY_WINDOW_MS) {
    targetPoints.unshift({ timeMs: nowMs - HISTORY_WINDOW_MS, targetHz: targetPoints[0].targetHz });
  }
  if (targetPoints.some((point) => point.targetHz) || currentTargetHz) {
    const points = targetPoints.some((point) => point.targetHz)
      ? targetPoints
      : [{ timeMs: nowMs - HISTORY_WINDOW_MS, targetHz: currentTargetHz }, { timeMs: nowMs, targetHz: currentTargetHz }];
    graphContext.strokeStyle = '#e7ad62';
    graphContext.lineWidth = 3;
    graphContext.setLineDash([12, 8]);
    graphContext.beginPath();
    let previousTarget = null;
    let targetDrawing = false;
    points.forEach((point) => {
      const x = Math.max(plot.left, xForTime(point.timeMs));
      if (!point.targetHz) {
        targetDrawing = false;
        previousTarget = null;
        return;
      }
      const y = yForHz(point.targetHz);
      if (!targetDrawing) graphContext.moveTo(x, y);
      else {
        const previousY = yForHz(previousTarget);
        graphContext.lineTo(x, previousY);
        graphContext.lineTo(x, y);
      }
      targetDrawing = true;
      previousTarget = point.targetHz;
    });
    if (targetDrawing && previousTarget) graphContext.lineTo(plot.right, yForHz(previousTarget));
    graphContext.stroke();
    graphContext.setLineDash([]);
  }

  graphContext.strokeStyle = '#74d8cb';
  graphContext.lineWidth = 5;
  graphContext.lineJoin = 'round';
  graphContext.lineCap = 'round';
  graphContext.shadowColor = 'rgba(116,216,203,.28)';
  graphContext.shadowBlur = 9;
  graphContext.beginPath();
  let drawing = false;
  recent.forEach((point) => {
    const x = Math.max(plot.left, xForTime(point.timeMs));
    if (!point.hz) {
      drawing = false;
      return;
    }
    const y = yForHz(point.hz);
    if (!drawing) graphContext.moveTo(x, y);
    else graphContext.lineTo(x, y);
    drawing = true;
  });
  graphContext.stroke();
  graphContext.shadowBlur = 0;
  els.plotRange.textContent = `Scala ${Math.round(minHz)}–${Math.round(maxHz)} Hz`;
}

function renderEstimate(estimate, nowMs = performance.now()) {
  const { hz, rms, clarity } = estimate;
  const currentTarget = activeRuntimeTarget?.frequencyHz ?? null;
  els.rms.textContent = rms.toFixed(3).replace('.', ',');
  recordPitchHistory(hz, nowMs);

  if (hz == null) {
    const silent = rms < 0.004;
    silenceStartedMs = silent ? (silenceStartedMs ?? nowMs) : null;
    const longSilence = silent && nowMs - silenceStartedMs >= 3000;
    const targetMissing = !activeRuntimeTarget;
    els.confidence.textContent = targetMissing ? 'Pausa nello spartito' : silent ? 'In ascolto' : 'Segnale instabile';
    els.detectedHz.textContent = '—';
    els.cents.textContent = '—';
    els.heardNote.textContent = '—';
    els.voiceFrequency.textContent = '—';
    els.voiceRangeState.textContent = targetMissing
      ? 'Nessun target in questo istante'
      : longSilence ? 'Non sento ancora la voce' : silent ? 'Nessun suono stabile rilevato' : 'Mantieni il suono più a lungo';
    els.voiceValue.dataset.range = '';
    els.rangeAlert.hidden = true;
    els.intonationMarker.style.left = '50%';
    els.intonationMarker.style.background = 'var(--text)';
    els.pitchState.textContent = targetMissing
      ? 'Pausa musicale: preparati all’ingresso successivo.'
      : longSilence ? 'Non sento ancora la voce. Controlla il microfono oppure canta un suono stabile.'
        : silent ? 'Canta la nota indicata nello spartito.' : 'Il segnale è presente, ma non è ancora abbastanza stabile.';
    drawGraph(nowMs);
    return;
  }

  silenceStartedMs = null;
  els.heardNote.textContent = hzToName(hz);
  els.voiceFrequency.textContent = formatHz(hz);
  els.detectedHz.textContent = formatHz(hz);
  if (!currentTarget) {
    els.confidence.textContent = 'Pausa nello spartito';
    els.cents.textContent = '—';
    els.voiceRangeState.textContent = 'Nessun target in questo istante';
    els.voiceValue.dataset.range = '';
    els.rangeAlert.hidden = true;
    els.intonationMarker.style.left = '50%';
    els.intonationMarker.style.background = 'var(--text)';
    els.pitchState.textContent = 'Qui non c’è una nota da intonare: preparati all’ingresso successivo.';
    drawGraph(nowMs);
    return;
  }

  const cents = centsBetween(hz, currentTarget);
  const semitones = cents / 100;
  const absoluteCents = Math.abs(cents);
  const confidence = estimate.confidence ?? clarity;
  const markerPosition = 50 + Math.max(-100, Math.min(100, cents)) / 2;
  els.confidence.textContent = confidence >= 0.7 ? 'Segnale chiaro' : confidence >= 0.4 ? 'Segnale discreto' : 'Segnale debole';
  els.cents.textContent = `${formatSigned(cents)} ¢`;
  els.voiceRangeState.textContent = `${formatSigned(semitones)} semitoni dal target`;
  els.intonationMarker.style.left = `${markerPosition}%`;
  els.voiceValue.dataset.range = absoluteCents > 200 ? 'far' : '';

  if (absoluteCents <= 25) {
    els.intonationMarker.style.background = 'var(--teal)';
    els.pitchState.textContent = 'Intonazione centrata.';
    els.rangeAlert.hidden = true;
  } else if (absoluteCents <= 100) {
    els.intonationMarker.style.background = 'var(--amber)';
    els.pitchState.textContent = cents > 0 ? 'Leggermente alta: scendi un poco.' : 'Leggermente bassa: sali un poco.';
    els.rangeAlert.hidden = true;
  } else {
    els.intonationMarker.style.background = 'var(--coral)';
    const direction = cents > 0 ? 'sopra' : 'sotto';
    els.pitchState.textContent = absoluteCents >= 700
      ? `La voce è ${Math.abs(semitones).toFixed(1).replace('.', ',')} semitoni ${direction} il target: verifica l’ottava.`
      : `La voce è molto ${cents > 0 ? 'alta' : 'bassa'} rispetto al target.`;
    els.rangeAlert.textContent = `${cents > 0 ? '↑' : '↓'} ${formatSigned(semitones)} semitoni`;
    els.rangeAlert.hidden = absoluteCents <= 200;
  }
  drawGraph(nowMs);
}

function tick(nowMs) {
  if (!analyser || !samples) return;
  const snapshot = renderScoreRuntime(nowMs);
  if (sessionState === 'running' && snapshot.beat >= scoreDurationBeats()) {
    completeSession(nowMs);
    return;
  }
  if (nowMs - lastAnalysisMs >= ANALYSIS_INTERVAL_MS) {
    analyser.getFloatTimeDomainData(samples);
    analyser.getByteTimeDomainData(byteSamples);
    let bytePeak = 0;
    for (const value of byteSamples) bytePeak = Math.max(bytePeak, Math.abs(value - 128));
    const floatRms = rmsOf(samples);
    if (floatRms < 0.0001 && bytePeak > 0) {
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = (byteSamples[index] - 128) / 128;
      }
    }
    if (track) {
      els.debugInfo.textContent = `Ingresso: ${audioContext.sampleRate} Hz · ${track.label || 'senza nome'} · ${track.readyState} · attivo=${track.enabled} · disattivato=${track.muted} · picco=${bytePeak}`;
      renderTrackState();
    }
    renderEstimate(pitchSmoother.update(detectPitch(samples, audioContext.sampleRate), nowMs), nowMs);
    lastAnalysisMs = nowMs;
  }
  animationId = requestAnimationFrame(tick);
}

async function startMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Questo browser non consente l’accesso al microfono. Usa localhost oppure HTTPS.');
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Questo browser non supporta l’elaborazione audio richiesta.');
  audioContext = new AudioContextClass();
  audioContext.addEventListener('statechange', () => {
    if (audioContext?.state === 'suspended' && sessionState === 'running' && document.visibilityState === 'visible') {
      interruptSession('Audio sospeso', 'Il browser ha sospeso l’ascolto. Il tempo è fermo: premi “Riprendi la prova”.');
    }
  });
  source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  samples = new Float32Array(analyser.fftSize);
  byteSamples = new Uint8Array(analyser.fftSize);
  source.connect(analyser);
  silentMonitor = audioContext.createGain();
  silentMonitor.gain.value = 0;
  analyser.connect(silentMonitor);
  silentMonitor.connect(audioContext.destination);
  history = [];
  pitchSmoother.reset();
  await audioContext.resume();
  track = stream.getAudioTracks()[0];
  track.addEventListener('mute', renderTrackState);
  track.addEventListener('unmute', renderTrackState);
  track.addEventListener('ended', renderTrackState);
  const settings = track.getSettings?.() ?? {};
  els.debugInfo.textContent = `Ingresso: ${audioContext.sampleRate} Hz · ${settings.channelCount ?? '?'} canale/i · ${track.label || 'senza nome'} · pronto=${track.readyState} · disattivato=${track.muted}`;
  lastAnalysisMs = 0;
  animationId = requestAnimationFrame(tick);
}

function releaseMicrophone() {
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
  if (source) source.disconnect();
  if (analyser) analyser.disconnect();
  if (silentMonitor) silentMonitor.disconnect();
  if (stream) stream.getTracks().forEach((mediaTrack) => {
    intentionallyStoppedTracks.add(mediaTrack);
    mediaTrack.stop();
  });
  if (audioContext) audioContext.close();
  source = null;
  analyser = null;
  silentMonitor = null;
  stream = null;
  track = null;
  audioContext = null;
  samples = null;
  byteSamples = null;
  pitchSmoother.reset();
}

function microphoneErrorMessage(error) {
  if (error?.name === 'NotAllowedError') return 'Permesso microfono negato. Abilitalo dalle impostazioni del sito.';
  if (error?.name === 'NotFoundError') return 'Non trovo un microfono collegato al dispositivo.';
  return error?.message || 'Non riesco ad avviare il microfono.';
}

async function startOrResumeSession() {
  els.toggleSession.disabled = true;
  setStatus('Attivazione…');
  hideSessionAlert();
  try {
    if (sessionState === 'complete' || performanceClock.currentBeat >= scoreDurationBeats()) {
      performanceClock.reset();
      history = [];
    }
    if (!stream) await startMicrophone();
    performanceClock.start(performance.now());
    sessionState = 'running';
    silenceStartedMs = null;
    setStatus('In prova', 'active');
    els.sessionLabel.textContent = 'Metti in pausa';
    els.toggleSession.querySelector('.play-icon').textContent = 'Ⅱ';
    els.pitchState.textContent = 'Ascolto la tua voce…';
    els.voiceRangeState.textContent = 'In ascolto';
    els.micHint.lastChild.textContent = ' Il microfono viene elaborato solo in questa scheda: non registriamo né inviamo la tua voce.';
  } catch (error) {
    releaseMicrophone();
    sessionState = 'idle';
    setStatus('Microfono non disponibile', 'error');
    els.pitchState.textContent = microphoneErrorMessage(error);
  } finally {
    els.toggleSession.disabled = false;
  }
}

function pauseSession(interruption = null) {
  const nowMs = performance.now();
  performanceClock.stop(nowMs);
  renderScoreRuntime(nowMs);
  releaseMicrophone();
  sessionState = interruption ? 'interrupted' : 'paused';
  setStatus(interruption ? 'Interrotta' : 'In pausa', interruption ? 'error' : '');
  els.sessionLabel.textContent = 'Riprendi la prova';
  els.toggleSession.querySelector('.play-icon').textContent = '▶';
  els.pitchState.textContent = interruption ? 'La prova è interrotta: la posizione è stata conservata.' : 'Prova in pausa.';
  els.confidence.textContent = interruption ? 'Interrotta' : 'In pausa';
  els.voiceRangeState.textContent = interruption ? 'Ascolto interrotto' : 'Prova in pausa';
  if (interruption) showSessionAlert(interruption.title, interruption.copy, interruption.tone);
  else hideSessionAlert();
}

function interruptSession(title, copy, tone = 'warning') {
  if (sessionState !== 'running') return;
  pauseSession({ title, copy, tone });
}

function completeSession(nowMs) {
  performanceClock.stop(nowMs);
  performanceClock.seek(scoreDurationBeats(), nowMs);
  renderScoreRuntime(nowMs);
  releaseMicrophone();
  sessionState = 'complete';
  setStatus('Completata', 'complete');
  els.sessionLabel.textContent = 'Ripeti la prova';
  els.toggleSession.querySelector('.play-icon').textContent = '↻';
  els.pitchState.textContent = 'Prova completata. Puoi ripeterla quando vuoi.';
  els.confidence.textContent = 'Completata';
  els.voiceRangeState.textContent = 'Prova completata';
}

function resetSession() {
  const wasRunning = sessionState === 'running';
  performanceClock.reset();
  if (wasRunning) performanceClock.start(performance.now());
  history = [];
  silenceStartedMs = null;
  pitchSmoother.reset();
  activeRuntimeTarget = scoreRuntime.targetAt(0);
  sessionState = wasRunning ? 'running' : 'idle';
  els.heardNote.textContent = '—';
  els.voiceFrequency.textContent = '—';
  els.voiceRangeState.textContent = wasRunning ? 'In ascolto' : 'In attesa del microfono';
  els.voiceValue.dataset.range = '';
  els.rangeAlert.hidden = true;
  hideSessionAlert();
  els.detectedHz.textContent = '—';
  els.cents.textContent = '—';
  els.rms.textContent = '—';
  els.intonationMarker.style.left = '50%';
  els.pitchState.textContent = wasRunning ? 'Ripartiamo dall’inizio.' : 'Avvia la prova quando sei pronta o pronto.';
  els.confidence.textContent = wasRunning ? 'In ascolto' : 'In attesa';
  if (!wasRunning) {
    setStatus('Pronto');
    els.sessionLabel.textContent = 'Avvia la prova';
    els.toggleSession.querySelector('.play-icon').textContent = '▶';
  }
  renderScoreRuntime();
  drawGraph();
}

els.toggleSession.addEventListener('click', () => {
  if (sessionState === 'running') pauseSession();
  else startOrResumeSession();
});
els.resetSession.addEventListener('click', resetSession);
document.querySelectorAll('[data-score-view]').forEach((button) => {
  button.addEventListener('click', () => {
    scoreView = button.dataset.scoreView;
    document.querySelectorAll('[data-score-view]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    renderScorePages();
    renderScoreRuntime();
  });
});
els.partSelector.addEventListener('change', () => {
  if (sessionState === 'running') pauseSession();
  scoreRuntime.selectPart(els.partSelector.value);
  performanceClock.reset();
  activeRuntimeTarget = scoreRuntime.targetAt(0);
  sessionState = 'idle';
  setStatus('Pronto');
  els.sessionLabel.textContent = 'Avvia la prova';
  els.toggleSession.querySelector('.play-icon').textContent = '▶';
  els.pitchState.textContent = 'Parte cambiata. Avvia la prova quando sei pronta o pronto.';
  renderScorePages();
  renderScoreRuntime();
  drawGraph();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    interruptSession('Prova sospesa', 'L’app non era più in primo piano. Il tempo è stato fermato sulla battuta corrente.');
  }
});

window.addEventListener('pagehide', () => {
  if (sessionState === 'running') performanceClock.stop(performance.now());
  releaseMicrophone();
});

window.addEventListener('resize', () => {
  lastCursorMeasure = null;
  updateScoreCursor(scoreRuntime.measureAt(performanceClock.snapshot(performance.now()).beat));
});

els.scoreTitle.textContent = 'Caricamento di Gloria…';
renderScorePages();
renderScoreRuntime();
drawGraph();
loadScoreDocument();
