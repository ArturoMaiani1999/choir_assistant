const TARGET_DEFAULT_HZ = 440;
const ANALYSIS_INTERVAL_MS = 55;
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

const els = {
  targetHz: document.querySelector('#target-hz'),
  targetNote: document.querySelector('#target-note'),
  toggleMic: document.querySelector('#toggle-mic'),
  resetTarget: document.querySelector('#reset-target'),
  toggleExercise: document.querySelector('#toggle-exercise'),
  scoreTitle: document.querySelector('#score-title'),
  scorePosition: document.querySelector('#score-position'),
  engineStatus: document.querySelector('#engine-status'),
  pitchState: document.querySelector('#pitch-state'),
  confidence: document.querySelector('#confidence'),
  detectedHz: document.querySelector('#detected-hz'),
  cents: document.querySelector('#cents'),
  rms: document.querySelector('#rms'),
  micHint: document.querySelector('#mic-hint'),
  debugInfo: document.querySelector('#debug-info'),
  canvas: document.querySelector('#pitch-canvas'),
};

const ctx = els.canvas.getContext('2d');
let audioContext = null;
let analyser = null;
let source = null;
let silentMonitor = null;
let stream = null;
let animationId = null;
let samples = null;
let byteSamples = null;
let history = [];
let lastAnalysisMs = 0;
let track = null;
const pitchSmoother = new PitchSmoother();

function midiToName(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pitchClass = ((midi % 12) + 12) % 12;
  return `${names[pitchClass]}${Math.floor(midi / 12) - 1}`;
}

function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

function hzToName(hz) {
  return midiToName(Math.round(hzToMidi(hz)));
}

function targetHz() {
  if (activeRuntimeTarget) return activeRuntimeTarget.frequencyHz;
  const value = Number(els.targetHz.value);
  return Number.isFinite(value) && value > 0 ? value : TARGET_DEFAULT_HZ;
}

function updateTargetLabel() {
  const target = targetHz();
  els.targetNote.textContent = hzToName(target);
}

function renderScoreRuntime(nowMs = performance.now()) {
  const snapshot = performanceClock.snapshot(nowMs);
  const position = scoreRuntime.measureAt(snapshot.beat);
  const runtimeTarget = scoreRuntime.targetAt(snapshot.beat);
  activeRuntimeTarget = runtimeTarget;
  els.scoreTitle.textContent = scoreRuntime.title;
  els.scorePosition.textContent = `Measure ${position.number} · beat ${position.beatInMeasure.toFixed(1)}`;
  if (runtimeTarget) {
    els.targetHz.value = runtimeTarget.frequencyHz.toFixed(2);
    els.targetNote.textContent = runtimeTarget.noteName;
  }
  els.toggleExercise.textContent = snapshot.running ? 'Stop target timeline' : 'Start target timeline';
  updateTargetLabel();
}

async function loadScoreDocument() {
  try {
    const response = await fetch('score-fixtures/development-target.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Score document returned HTTP ${response.status}`);
    const payload = await response.json();
    const loadedRuntime = NormalizedScoreRuntime.fromNormalizedScore(payload);
    if (loadedRuntime.targetEvents.length === 0) throw new Error('Score document has no target events');
    scoreRuntime = loadedRuntime;
    performanceClock = new PerformanceClock({ tempoBpm: scoreRuntime.tempoBpm });
    activeRuntimeTarget = scoreRuntime.targetAt(0);
    renderScoreRuntime();
    drawGraph();
  } catch (error) {
    // Keep the in-code fixture usable if the static score artifact is unavailable.
    console.warn('Using in-code score fallback:', error);
    els.scoreTitle.textContent = 'Development fallback · score JSON unavailable';
  }
}

function setStatus(text, state = '') {
  els.engineStatus.textContent = text;
  els.engineStatus.dataset.state = state;
}

function renderTrackState() {
  if (!track) return;
  if (track.muted) {
    setStatus('Input muted', 'error');
    els.pitchState.textContent = 'Microphone muted by browser or Windows';
    els.micHint.textContent = 'Check Windows microphone privacy, input volume, and the physical mute key.';
  } else if (track.readyState === 'live') {
    setStatus('Listening', 'active');
    els.micHint.textContent = 'Microphone samples stay local to this browser tab.';
  }
}

function drawGraph() {
  const width = els.canvas.width;
  const height = els.canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#071118';
  ctx.fillRect(0, 0, width, height);

  const minLog = Math.log(MIN_HZ);
  const maxLog = Math.log(MAX_HZ);
  const yForHz = (hz) => {
    const position = (Math.log(Math.max(MIN_HZ, Math.min(MAX_HZ, hz))) - minLog) / (maxLog - minLog);
    return height - position * height;
  };

  const targetY = yForHz(targetHz());
  ctx.strokeStyle = '#ffb86b';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(0, targetY);
  ctx.lineTo(width, targetY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#213d49';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i += 1) {
    const y = (height / 5) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }

  if (history.length < 2) return;
  ctx.strokeStyle = '#6de7dc';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  history.forEach((point, index) => {
    const x = (index / Math.max(1, history.length - 1)) * width;
    const y = point.hz == null ? null : yForHz(point.hz);
    if (y == null) { ctx.moveTo(x, height / 2); return; }
    if (index === 0 || history[index - 1].hz == null) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function renderEstimate(estimate) {
  const { hz, rms, clarity } = estimate;
  els.rms.textContent = rms.toFixed(3);
  els.confidence.textContent = hz == null ? 'unvoiced' : `${Math.round((estimate.confidence ?? clarity) * 100)}% confidence`;
  if (hz == null) {
    els.detectedHz.textContent = '—';
    els.cents.textContent = '—';
    els.pitchState.textContent = rms < 0.004 ? 'Sing or play a note' : 'Signal received · pitch not stable';
  } else {
    const cents = centsBetween(hz, targetHz());
    els.detectedHz.textContent = `${hz.toFixed(1)} Hz`;
    els.cents.textContent = `${cents >= 0 ? '+' : ''}${cents.toFixed(1)}¢`;
    els.pitchState.textContent = Math.abs(cents) <= 25 ? 'In tune' : cents > 0 ? 'Slightly sharp' : 'Slightly flat';
  }
  history.push({ hz });
  if (history.length > 180) history.shift();
  drawGraph();
}

function tick(nowMs) {
  if (!analyser || !samples) return;
  renderScoreRuntime(nowMs);
  if (nowMs - lastAnalysisMs >= ANALYSIS_INTERVAL_MS) {
    analyser.getFloatTimeDomainData(samples);
    analyser.getByteTimeDomainData(byteSamples);
    let bytePeak = 0;
    for (const value of byteSamples) bytePeak = Math.max(bytePeak, Math.abs(value - 128));
    const floatRms = rmsOf(samples);
    if (floatRms < 0.0001 && bytePeak > 0) {
      for (let i = 0; i < samples.length; i += 1) samples[i] = (byteSamples[i] - 128) / 128;
    }
    if (track) {
      els.debugInfo.textContent = `Audio input: ${audioContext.sampleRate} Hz · ${track.label || 'unnamed'} · ${track.readyState} · enabled=${track.enabled} · muted=${track.muted} · peak=${bytePeak}`;
      renderTrackState();
    }
    const rawEstimate = detectPitch(samples, audioContext.sampleRate);
    renderEstimate(pitchSmoother.update(rawEstimate, nowMs));
    lastAnalysisMs = nowMs;
  }
  animationId = requestAnimationFrame(tick);
}

async function startMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not expose getUserMedia. Use localhost or HTTPS.');
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('This browser does not support Web Audio.');
  audioContext = new AudioContextClass();
  source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  samples = new Float32Array(analyser.fftSize);
  byteSamples = new Uint8Array(analyser.fftSize);
  source.connect(analyser);
  // Keep the Web Audio graph actively processed without playing the
  // microphone back to the user. Some browsers do not update an analyser
  // that is not connected to the destination graph.
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
  const settings = track?.getSettings?.() ?? {};
  els.debugInfo.textContent = `Audio input: ${audioContext.sampleRate} Hz · ${settings.channelCount ?? '?'} channel(s) · ${track.label || 'unnamed'} · ready=${track.readyState} · muted=${track.muted}`;
  els.toggleMic.textContent = 'Stop microphone';
  els.pitchState.textContent = 'Listening locally';
  setStatus('Listening', 'active');
  lastAnalysisMs = 0;
  animationId = requestAnimationFrame(tick);
}

function stopMicrophone() {
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
  if (source) source.disconnect();
  if (analyser) analyser.disconnect();
  if (silentMonitor) silentMonitor.disconnect();
  if (stream) stream.getTracks().forEach((track) => track.stop());
  if (audioContext) audioContext.close();
  source = null; stream = null; analyser = null; silentMonitor = null; audioContext = null; samples = null; byteSamples = null; track = null;
  pitchSmoother.reset();
  els.toggleMic.textContent = 'Start microphone';
  els.pitchState.textContent = 'Waiting for microphone';
  els.detectedHz.textContent = '—';
  els.cents.textContent = '—';
  els.rms.textContent = '—';
  els.confidence.textContent = '—';
  els.debugInfo.textContent = 'Audio input: not started';
  els.micHint.textContent = 'Use headphones if you later add guide playback. This first test does not play audio.';
  setStatus('Idle');
  history = [];
  drawGraph();
}

els.targetHz.addEventListener('input', () => { updateTargetLabel(); drawGraph(); });
els.resetTarget.addEventListener('click', () => { els.targetHz.value = TARGET_DEFAULT_HZ; updateTargetLabel(); drawGraph(); });
els.toggleExercise.addEventListener('click', () => {
  const nowMs = performance.now();
  if (performanceClock.running) performanceClock.stop(nowMs);
  else performanceClock.start(nowMs);
  renderScoreRuntime(nowMs);
  drawGraph();
});
els.toggleMic.addEventListener('click', async () => {
  if (stream) { stopMicrophone(); return; }
  els.toggleMic.disabled = true;
  try { await startMicrophone(); }
  catch (error) { setStatus('Microphone error', 'error'); els.pitchState.textContent = error.message; }
  finally { els.toggleMic.disabled = false; }
});

updateTargetLabel();
renderScoreRuntime();
drawGraph();
loadScoreDocument();
