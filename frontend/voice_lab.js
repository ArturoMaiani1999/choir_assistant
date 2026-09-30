(function () {
  'use strict';
  const Core = window.VoiceLabCore, Draw = window.VoiceDrawCore, { detectPitch, PitchSmoother } = window.ChoirPitch;
  const PitchShared = window.ChoirPitchShared;
  const $ = (id) => document.getElementById(id);
  const drawBoard = $('lab-draw-board'), drawLeft = $('lab-draw-left'), drawRight = $('lab-draw-right');
  const drawKeys = new Set();
  const els = Object.fromEntries(['lab-range-label', 'lab-kind', 'lab-title', 'lab-instruction', 'lab-config', 'lab-session-progress', 'lab-score', 'lab-score-curtain', 'lab-roll', 'lab-target', 'lab-frequency', 'lab-state', 'lab-countdown', 'lab-level', 'lab-new', 'lab-listen', 'lab-continue', 'lab-record', 'lab-answer', 'lab-feedback', 'lab-feedback-title', 'lab-feedback-message', 'lab-metrics', 'lab-chart', 'lab-play-take', 'lab-retry', 'lab-next', 'lab-note', 'lab-guided', 'lab-settings', 'lab-settings-dialog', 'lab-role', 'lab-low', 'lab-high', 'lab-mic-check', 'lab-mic-check-level', 'lab-mic-check-status', 'lab-settings-save', 'lab-settings-close'].map((id) => [id.replaceAll('-', '_'), $(id)]));
  const STORE = 'choir-voice-lab:v1', MAX_RESULTS = 200;
  let soloStartedAt = null, preparing = false, preparationId = 0;
  const phase = document.createElement('div'); phase.className = 'lab-phase'; phase.setAttribute('role', 'status');
  const scorePanel = document.querySelector('.lab-score-panel'), rollPanel = document.querySelector('.lab-roll-panel');
  const liveReadout = document.querySelector('.lab-live-readout');
  rollPanel.append(phase);
  function setPhase(text, progress = 0) { phase.textContent = text; phase.style.setProperty('--progress', `${Math.min(100, progress * 100)}%`); }
  document.querySelectorAll('[data-activity="sustain"]').forEach(button => button.remove());
  els.lab_record.hidden = true;
  function syncStart() {
    els.lab_record.hidden = true;
    els.lab_listen.textContent = state.recording || preparing ? '■' : '▶';
    els.lab_listen.setAttribute('aria-label', state.recording || preparing ? 'Interrompi' : 'Inizia');
  }
  const ROLE_RANGES = Object.freeze({ soprano: { lowMidi: 60, highMidi: 77 }, alto: { lowMidi: 55, highMidi: 72 }, tenor: { lowMidi: 48, highMidi: 67 }, bass: { lowMidi: 40, highMidi: 60 } });
  const CHOIR_ANCHORS = Object.freeze({ soprano: [62, 68, 74], alto: [57, 63, 69], tenor: [50, 56, 62, 67], bass: [42, 48, 54, 59] });
  const FINAL_DIMINUENDO_SECONDS = 4.8;
  const sharedPitch = PitchShared.readPreferences();
  const state = { activity: 'repeat', role: 'tenor', range: { ...ROLE_RANGES.tenor }, exercise: null, harmony: null, pitchSession: null, earSession: null, singSession: null, drawSession: null, drawFrame: null, guidedSession: null, autoCompleting: false, advanceTimer: null, countInTimers: [], countInFrame: null, countInStartedAt: 0, metronomeSources: [], accompanimentSources: [], countingIn: false, audio: null, voiceBuffers: new Map(), stringBuffers: new Map(), reference: null, referenceTimer: null, stream: null, analyser: null, input: null, recording: false, calibrationActive: false, calibrationGeneration: 0, mediaRecorder: null, chunks: [], generation: 0, frames: [], startedAt: 0, elapsedSeconds: 0, audioUrl: null, rollBounds: null, detectorSettings: sharedPitch.detector, plumeSettings: sharedPitch.plume };
  let needsRoleSetup = true;
  try { const savedRole = localStorage.getItem(`${STORE}:role`); needsRoleSetup = !savedRole; state.role = savedRole || state.role; state.range = { ...ROLE_RANGES[state.role] }; } catch (_) {}
  try { state.range = { ...state.range, ...JSON.parse(localStorage.getItem(`${STORE}:range`)) }; } catch (_) {}
  const activityMeta = {
    repeat: ['INTONAZIONE · LIVELLO 1', 'Trova la nota', 'Segui coro e accordo per tutta la prova; nelle ultime due battute accompagnali nel diminuendo.'],
    sustain: ['INTONAZIONE · NOTA TENUTA', 'Tieni la nota', 'Ascolta il riferimento breve, poi mantieni la nota senza guida per tutta la durata.'],
    ear: ['ASCOLTO · EAR TRAINING', 'Riconosci intervalli', 'Ascolta senza guardare la risposta, poi scegli.'],
    'sing-interval': ['INTERVALLI · RIPRODUZIONE', 'Canta gli intervalli', 'Ascolta le note; quattro pulsazioni preparano l’attacco e il cambio.'],
    draw: ['GIOCO VOCALE', 'Disegna con la voce', '← → spostano il cursore; la voce lo alza o abbassa. Segui il contorno illuminato.'],
  };
  function canvasContext(canvas, height = 220) {
    const ratio = devicePixelRatio || 1, width = canvas.clientWidth || 560; height = canvas.clientHeight || height;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d'); context.scale(ratio, ratio); return { context, width, height };
  }
  function exerciseNotes() {
    if (state.activity === 'draw') return [];
    if (!state.exercise) return [];
    const music = state.exercise.music;
    return music.interval ? [music.interval.first, music.interval.second] : [music.note];
  }
  function drawMusicViews(reveal = state.activity !== 'ear') {
    drawScore(reveal); if (state.activity !== 'draw') drawRoll(reveal);
  }
  function drawScore(reveal) {
    if (state.activity === 'draw') { els.lab_score.hidden = true; els.lab_score_curtain.hidden = true; drawBoard.hidden = false; drawDrawingBoard(); return; }
    drawBoard.hidden = true;
    const concealed = Boolean(state.exercise && !reveal);
    els.lab_score.hidden = concealed; els.lab_score_curtain.hidden = !concealed;
    if (!state.exercise || !reveal) { els.lab_score.removeAttribute('src'); delete els.lab_score.dataset.firstMidi; delete els.lab_score.dataset.secondMidi; els.lab_score.alt = ''; return; }
    const notes = exerciseNotes();
    const harmonic = state.exercise.listeningMode === 'harmonic';
    const scoreNotes = harmonic ? [...notes].sort((a, b) => a.midi - b.midi) : notes;
    els.lab_score.src = (notes.length === 1 ? `voice-lab-assets/notes/note-${notes[0].midi}-1.svg`
      : `voice-lab-assets/intervals/${harmonic ? 'harmonic' : 'melodic'}-${scoreNotes[0].midi}-${scoreNotes[1].midi}-1.svg`) + '?v=20260929-countin';
    els.lab_score.dataset.firstMidi = String(notes[0].midi);
    if (notes[1]) els.lab_score.dataset.secondMidi = String(notes[1].midi); else delete els.lab_score.dataset.secondMidi;
    els.lab_score.alt = `Spartito MuseScore: ${notes.map((note) => note.name).join(' – ')}`;
  }
  function drawRoll(reveal) {
    if (state.activity === 'draw') return;
    const { context: ctx, width, height } = canvasContext(els.lab_roll), notes = exerciseNotes(); ctx.fillStyle = '#08171c'; ctx.fillRect(0, 0, width, height);
    const targets = notes.length ? notes.map((note) => note.midi) : [60];
    const pitchWindow = state.frames;
    const recentVoiced = pitchWindow.filter((frame) => Number.isFinite(frame.displayPitch) && frame.confidence >= .3).map((frame) => frame.displayPitch);
    const visiblePitches = [...targets, ...recentVoiced], low = Math.min(...visiblePitches), high = Math.max(...visiblePitches), span = Math.max(8, high - low + 4), desired = { min: (low + high) / 2 - span / 2, max: (low + high) / 2 + span / 2 };
    if (!state.rollBounds) state.rollBounds = desired;
    else { const alpha = .14; state.rollBounds.min += (desired.min - state.rollBounds.min) * alpha; state.rollBounds.max += (desired.max - state.rollBounds.max) * alpha; }
    const { min: minMidi, max: maxMidi } = state.rollBounds;
    const yAt = (midi) => 16 + (maxMidi - midi) / Math.max(1, maxMidi - minMidi) * (height - 32), duration = state.exercise?.durationSeconds || 30;
    const rowHeight = (height - 32) / Math.max(1, maxMidi - minMidi), keyboardRight = 45;
    for (let midi = Math.floor(maxMidi); midi >= Math.ceil(minMidi); midi -= 1) {
      const y = yAt(midi), pitchClass = ((midi % 12) + 12) % 12, black = [1, 3, 6, 8, 10].includes(pitchClass);
      ctx.fillStyle = black ? 'rgba(3,13,17,.72)' : 'rgba(119,151,153,.105)';
      ctx.fillRect(keyboardRight, y - rowHeight / 2, width - keyboardRight, rowHeight);
      ctx.fillStyle = black ? '#17272c' : '#d5ddd8';
      ctx.fillRect(0, y - rowHeight / 2, black ? keyboardRight * .66 : keyboardRight, rowHeight);
      ctx.strokeStyle = black ? '#20353b' : '#65787a'; ctx.lineWidth = .7; ctx.beginPath();
      ctx.moveTo(0, y + rowHeight / 2); ctx.lineTo(width, y + rowHeight / 2); ctx.stroke();
      if (pitchClass === 0 || pitchClass === 5 || targets.some((target) => Math.round(target) === midi)) {
        ctx.fillStyle = black ? '#adc0bf' : '#34484b'; ctx.font = `${targets.includes(midi) ? '700 ' : ''}10px system-ui`;
        ctx.fillText(Core.midiToName(midi), 3, y + 3);
      }
    }
    ctx.strokeStyle = '#65787a'; ctx.beginPath(); ctx.moveTo(keyboardRight + .5, 0); ctx.lineTo(keyboardRight + .5, height); ctx.stroke();
    const nowX = Math.max(90, width * .375), elapsed = state.recording && !state.countingIn ? (performance.now() - state.startedAt) / 1000 : state.elapsedSeconds;
    const historyWidth = nowX - keyboardRight, right = width - 12;
    const pixelsPerSecond = Core.rollPixelsPerSecond(right - keyboardRight);
    const xAtTime = (time) => nowX + (time - elapsed) * pixelsPerSecond;
    const beatSeconds = 60 / Core.INTERVAL_TIMING.bpm;
    if (state.countingIn) {
      for (let beat = 0; beat <= Core.INTERVAL_TIMING.countInBeats; beat += 1) {
        const x = keyboardRight + (nowX - keyboardRight) * beat / Core.INTERVAL_TIMING.countInBeats;
        ctx.strokeStyle = beat === 0 || beat === Core.INTERVAL_TIMING.countInBeats ? 'rgba(226,180,101,.55)' : 'rgba(184,210,207,.24)';
        ctx.setLineDash(beat % 4 ? [3, 5] : []); ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, height); ctx.stroke();
        if (beat < Core.INTERVAL_TIMING.countInBeats) { ctx.setLineDash([]); ctx.fillStyle = '#91aaa9'; ctx.font = '10px system-ui'; ctx.fillText(String(beat + 1), x + 4, 13); }
      }
    } else {
      const visibleStart = elapsed - (nowX - keyboardRight) / pixelsPerSecond, visibleEnd = elapsed + (right - nowX) / pixelsPerSecond;
      for (let beat = Math.floor(visibleStart / beatSeconds); beat <= Math.ceil(visibleEnd / beatSeconds); beat += 1) {
        const x = xAtTime(beat * beatSeconds), measure = ((beat % 4) + 4) % 4 === 0;
        if (x < keyboardRight || x > right) continue;
        ctx.strokeStyle = measure ? 'rgba(226,180,101,.5)' : 'rgba(184,210,207,.18)'; ctx.setLineDash(measure ? [] : [3, 5]);
        ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, height); ctx.stroke();
        if (measure) { ctx.setLineDash([]); ctx.fillStyle = '#d1a862'; ctx.font = '700 10px system-ui'; ctx.fillText(`B. ${Math.floor(beat / 4) + 1}`, x + 4, 13); }
      }
    }
    ctx.setLineDash([]);
    if (state.exercise && reveal) {
      ctx.save(); ctx.beginPath(); ctx.rect(keyboardRight, 0, right - keyboardRight, height); ctx.clip(); ctx.fillStyle = '#d29b52';
      if (notes.length === 1) ctx.fillRect(xAtTime(0), yAt(notes[0].midi) - 7, duration * pixelsPerSecond, 14);
      else { const split = duration / 2; ctx.fillRect(xAtTime(0), yAt(notes[0].midi) - 7, split * pixelsPerSecond, 14); ctx.fillRect(xAtTime(split), yAt(notes[1].midi) - 7, split * pixelsPerSecond, 14); }
      ctx.restore();
    }
    const voiced = state.frames.filter((frame) => Number.isFinite(frame.displayPitch) && frame.confidence >= .3);
    const xAtFrame = (frame) => xAtTime(frame.time);
    PitchShared.drawConfidencePlume(ctx, state.frames, xAtFrame, yAt, minMidi, maxMidi, { ...state.plumeSettings, nowX, trailStartX: keyboardRight, currentTime: elapsed, sortedTimeline: true, mode: state.recording ? 'live' : 'review' });
    const countInDuration = Core.INTERVAL_TIMING.countInBeats * 60 / Core.INTERVAL_TIMING.bpm;
    const countInFraction = state.countingIn ? Math.min(1, Math.max(0, (performance.now() - state.countInStartedAt) / 1000 / countInDuration)) : 0;
    const cursorX = state.countingIn ? keyboardRight + historyWidth * countInFraction : state.recording || state.frames.length ? nowX : keyboardRight;
    ctx.strokeStyle = '#8ee0d8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cursorX, 0); ctx.lineTo(cursorX, height); ctx.stroke();
    const latest = voiced.at(-1);
    if (latest && elapsed - latest.time < .2) { const midi = latest.displayPitch, y = yAt(midi), target = targets[0], cents = Math.round((midi - target) * 100); ctx.fillStyle = state.plumeSettings.presentColor; ctx.font = '700 12px system-ui'; ctx.fillText(`${Core.midiToName(Math.round(midi))}  ${cents > 0 ? '+' : ''}${cents}¢`, nowX + 12, Math.max(28, Math.min(height - 10, y + 4))); }
  }
  function drawDrawingBoard() {
    if (!state.drawSession || drawBoard.hidden) return;
    const { context: ctx, width, height } = canvasContext(drawBoard), session = state.drawSession;
    const points = session.points;
    const left = width < 600 ? 46 : 58, right = width - 16, top = 44, bottom = height - 48;
    const centerX = (left + right) / 2;
    const rowHeight = (bottom - top) / 9;
    const figureWidth = Math.min(480, rowHeight * 5.4, (right - left) * .68);
    const xUnit = figureWidth / .56;
    const xAt = (x) => centerX + (x - .5) * xUnit;
    const yAt = (midi) => bottom - (midi - session.centerMidi + 4.5) * rowHeight;
    ctx.fillStyle = '#08171c'; ctx.fillRect(0, 0, width, height);
    ctx.font = `${width < 700 ? 10 : 12}px system-ui`; ctx.textBaseline = 'middle';
    for (let midi = session.centerMidi - 4; midi <= session.centerMidi + 4; midi += 1) {
      const y = yAt(midi), pitchClass = ((midi % 12) + 12) % 12;
      const white = [0, 2, 4, 5, 7, 9, 11].includes(pitchClass);
      ctx.fillStyle = white ? 'rgba(166,198,193,.075)' : 'rgba(2,10,14,.27)';
      ctx.fillRect(left, y - rowHeight / 2, right - left, rowHeight);
      if (pitchClass === 0 || pitchClass === 5) {
        ctx.strokeStyle = 'rgba(190,215,211,.25)'; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(left, Math.round(y + rowHeight / 2) + .5); ctx.lineTo(right, Math.round(y + rowHeight / 2) + .5); ctx.stroke();
      }
      ctx.fillStyle = white ? '#b5c8c5' : '#899ea1';
      ctx.fillText(Core.midiToName(midi), 3, y);
    }
    // Keep the target light; the generous hit tolerance is communicated by
    // the cursor changing colour, without a large opaque band over the roll.
    ctx.save(); ctx.translate(centerX, yAt(session.centerMidi)); ctx.scale(xUnit / 10, -rowHeight);
    ctx.beginPath(); points.forEach(([x, offset], index) => index ? ctx.lineTo((x - .5) * 10, offset) : ctx.moveTo((x - .5) * 10, offset));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(224,180,105,.18)'; ctx.lineWidth = .18; ctx.stroke();
    ctx.shadowColor = 'rgba(235,188,108,.55)'; ctx.shadowBlur = 12;
    ctx.strokeStyle = '#e2b76e'; ctx.lineWidth = session.shape === 'square' ? .105 : .035; ctx.stroke(); ctx.restore();
    points.slice(0, -1).forEach(([x, offset], index) => {
      const reached = session.bins.has(index * Draw.BINS_PER_EDGE) || session.bins.has(index * Draw.BINS_PER_EDGE + 1);
      ctx.beginPath(); ctx.arc(xAt(x), yAt(session.centerMidi + offset), index === 0 ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = reached ? '#8fd8cc' : index === 0 ? '#f4d293' : '#c09a63'; ctx.fill();
    });
    const trace = session.trace;
    for (let index = 1; index < trace.length; index += 1) {
      const a = trace[index - 1], b = trace[index];
      if (b.time - a.time >= .25) continue;
      const style = PitchShared.auroraStyle(session.elapsed - b.time, .9, { ...state.plumeSettings, mode: state.recording ? 'live' : 'review', trailSeconds: 7 });
      ctx.strokeStyle = `rgba(${style.color.join(',')},${Math.max(.42, style.alpha)})`;
      ctx.lineWidth = b.inside ? 4 : 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(xAt(a.x), yAt(a.midi)); ctx.lineTo(xAt(b.x), yAt(b.midi)); ctx.stroke();
    }
    const latest = trace.at(-1);
    const cursorY = latest && session.elapsed - latest.time < .25 ? yAt(latest.midi) : null;
    if (cursorY != null) { ctx.beginPath(); ctx.arc(xAt(session.x), cursorY, 7, 0, Math.PI * 2); ctx.fillStyle = latest.inside ? '#f6d574' : '#ee939d'; ctx.fill(); }
    else { ctx.fillStyle = '#a9c0bb'; ctx.fillRect(xAt(session.x) - 9, bottom + 8, 18, 3); }
    const result = Draw.score(session);
    ctx.fillStyle = '#a9bdbb'; ctx.font = '500 12px system-ui'; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right'; ctx.fillText(`Tempo in fascia  ${Math.round(result.insideFraction * 100)}%`, right, height - 17); ctx.textAlign = 'left';
  }
  function stopDrawing(cancelled = true) {
    if (state.drawFrame != null) cancelAnimationFrame(state.drawFrame);
    state.drawFrame = null; drawKeys.clear();
    if (state.activity !== 'draw' || !state.recording) return;
    state.recording = false; state.generation += 1;
    state.accompanimentSources.forEach((source) => { try { source.stop(); } catch (_) {} }); state.accompanimentSources = [];
    els.lab_new.disabled = false; els.lab_level.value = 0; syncStart();
    if (cancelled) { els.lab_state.textContent = 'PRONTO'; setPhase('Premi ▶ per iniziare'); }
  }
  function finishDrawing() {
    const session = state.drawSession, result = Draw.score(session); stopDrawing(false);
    els.lab_state.textContent = result.success ? 'SUPERATO' : result.completed ? 'COMPLETATO' : 'TEMPO SCADUTO';
    setPhase(result.success ? 'Livello superato' : result.completed ? 'Figura completata' : 'Riprova a seguire il contorno');
    els.lab_feedback.hidden = false; els.lab_chart.hidden = true; els.lab_play_take.hidden = true;
    els.lab_feedback_title.textContent = result.success ? 'Livello superato' : result.completed ? 'Giro completato' : 'Tempo scaduto';
    els.lab_feedback_message.textContent = result.success ? 'Sei tornato al punto di partenza con un buon punteggio.' : result.completed ? `Hai chiuso la figura, ma serve uno score superiore al ${Math.round(Draw.SCORE_THRESHOLD * 100)}%.` : 'Per completare la figura devi tornare nelle vicinanze del punto di partenza.';
    els.lab_metrics.innerHTML = `<div><dt>Score</dt><dd>${Math.round(result.score * 100)}%</dd></div><div><dt>Contorno percorso</dt><dd>${Math.round(result.coverage * 100)}%</dd></div><div><dt>Tempo nella fascia</dt><dd>${Math.round(result.insideFraction * 100)}%</dd></div>`;
    els.lab_retry.hidden = false; els.lab_next.textContent = 'Altra figura'; drawMusicViews(true);
    saveResult({ type: 'draw', shape: session.shape, success: result.success, completed: result.completed, score: result.score, coverage: result.coverage, insideFraction: result.insideFraction, elapsedSeconds: session.elapsed, at: Date.now() });
  }
  function beginDrawing() {
    const generation = ++state.generation, buffer = new Float32Array(state.analyser.fftSize), smoother = new PitchSmoother();
    const [lowMidi, highMidi] = state.exercise.music.notes;
    const accompaniment = playHarmony(state.harmony, audioContext().currentTime + .02, .6, Draw.MAX_SECONDS, { loop: true });
    smoother.configure(state.detectorSettings); state.recording = true; state.frames = [];
    state.drawSession = Draw.create($('lab-draw-shape')?.value || 'square', state.exercise.music.centerMidi, { lowMidi, highMidi });
    state.accompanimentSources = accompaniment;
    els.lab_new.disabled = true; els.lab_feedback.hidden = true; state.startedAt = performance.now(); syncStart();
    let last = state.startedAt;
    const tick = (now) => {
      if (!state.recording || generation !== state.generation || state.activity !== 'draw') return;
      const dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now;
      state.analyser.getFloatTimeDomainData(buffer);
      const raw = detectPitch(buffer, audioContext().sampleRate, state.detectorSettings), estimate = smoother.update(raw, now);
      const midi = Number.isFinite(estimate.displayHz) ? 69 + 12 * Math.log2(estimate.displayHz / 440) : null;
      const direction = (drawKeys.has('ArrowRight') ? 1 : 0) - (drawKeys.has('ArrowLeft') ? 1 : 0);
      const result = Draw.update(state.drawSession, { direction, midi, confidence: estimate.confidence ?? 0, seconds: dt });
      state.frames.push({ time: state.drawSession.elapsed, displayPitch: midi, hz: estimate.hz, confidence: estimate.confidence ?? 0, clarity: estimate.clarity ?? 0, confirmationState: estimate.accepted ? 'confirmed' : 'provisional' });
      els.lab_level.value = raw.rms || 0; els.lab_countdown.textContent = `${Math.max(0, Draw.MAX_SECONDS - state.drawSession.elapsed).toFixed(0)} s`;
      els.lab_state.textContent = result.inside ? 'NEL PERCORSO' : 'CERCA IL CONTORNO';
      els.lab_session_progress.textContent = `Percorso ${Math.round(result.coverage * 100)}%`;
      setPhase(`Percorso ${Math.round(result.coverage * 100)}% · dentro ${Math.round(result.insideFraction * 100)}%`, result.coverage);
      drawMusicViews(true);
      if (result.finished) finishDrawing(); else state.drawFrame = requestAnimationFrame(tick);
    };
    state.drawFrame = requestAnimationFrame(tick);
  }
  function audioContext() { return state.audio ??= new (window.AudioContext || window.webkitAudioContext)(); }
  function reportAudioEvent(kind, at, details = {}) {
    window.dispatchEvent(new CustomEvent('voice-lab-audio-event', { detail: { kind, at, ...details } }));
  }
  function choirAnchor(note, role = state.role) {
    const anchors = CHOIR_ANCHORS[role] ?? CHOIR_ANCHORS.tenor;
    return anchors.reduce((best, midi) => Math.abs(midi - note.midi) < Math.abs(best - note.midi) ? midi : best, anchors[0]);
  }
  async function loadVoiceSample(note, role = state.role) {
    if (!note) return null;
    const anchor = choirAnchor(note, role), key = `${role}-${anchor}`;
    if (state.voiceBuffers.has(key)) return state.voiceBuffers.get(key);
    const pending = fetch(`voice-lab-assets/choir/${role}-${anchor}.flac`).then((response) => {
      if (!response.ok) throw new Error(`Muse Choir ${role} non disponibile`);
      return response.arrayBuffer();
    }).then((data) => audioContext().decodeAudioData(data)).then((buffer) => {
      let sumSquares = 0, samples = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let index = 0; index < data.length; index += 1) { sumSquares += data[index] * data[index]; samples += 1; }
      }
      const rms = samples ? Math.sqrt(sumSquares / samples) : 0;
      if (rms < .0001) throw new Error(`Campione Muse Choir ${role} silenzioso`);
      return { buffer, anchor, role, rms };
    });
    state.voiceBuffers.set(key, pending);
    try { const asset = await pending; state.voiceBuffers.set(key, asset); return asset; }
    catch (error) { state.voiceBuffers.delete(key); throw error; }
  }
  async function loadExerciseVoices() { return Promise.all(exerciseNotes().map((note) => loadVoiceSample(note))); }
  async function loadStringSample(midi) {
    if (state.stringBuffers.has(midi)) return state.stringBuffers.get(midi);
    const pending = fetch(`voice-lab-assets/strings/string-${midi}.ogg`).then((response) => {
      if (!response.ok) throw new Error(`Campione archi ${Core.midiToName(midi)} non disponibile`);
      return response.arrayBuffer();
    }).then((data) => audioContext().decodeAudioData(data)).then((buffer) => {
      let sumSquares = 0, samples = 0; const windowSquares = [], windowSamples = [];
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let index = 0; index < data.length; index += 1) {
          const square = data[index] * data[index], second = Math.floor(index / buffer.sampleRate);
          sumSquares += square; samples += 1; windowSquares[second] = (windowSquares[second] ?? 0) + square;
          windowSamples[second] = (windowSamples[second] ?? 0) + 1;
        }
      }
      const rms = samples ? Math.sqrt(sumSquares / samples) : 0;
      if (rms < .0001) throw new Error(`Campione archi ${Core.midiToName(midi)} silenzioso`);
      const windowRms = windowSquares.map((sum, index) => Math.sqrt(sum / windowSamples[index]));
      return { buffer, rms, windowRms, normalizationGain: Math.max(.6, Math.min(3, .06 / rms)) };
    });
    state.stringBuffers.set(midi, pending);
    try { const buffer = await pending; state.stringBuffers.set(midi, buffer); return buffer; }
    catch (error) { state.stringBuffers.delete(midi); throw error; }
  }
  async function loadHarmony(harmony = state.harmony) {
    if (!harmony) return [];
    return Promise.all(harmony.notes.map(loadStringSample));
  }
  function playHarmony(harmony, at, crescendoSeconds, sustainSeconds = 30, { loop = false } = {}) {
    if (!harmony) return [];
    const context = audioContext(), bus = context.createGain(), compressor = context.createDynamicsCompressor();
    const entry = at + crescendoSeconds;
    bus.gain.setValueAtTime(.0001, at);
    const end = entry + sustainSeconds, diminuendoStart = Math.max(entry + .1, end - FINAL_DIMINUENDO_SECONDS);
    bus.gain.exponentialRampToValueAtTime(.18, Math.max(at + .05, entry - .08));
    bus.gain.exponentialRampToValueAtTime(.06, entry + .08);
    bus.gain.setValueAtTime(.06, diminuendoStart);
    bus.gain.exponentialRampToValueAtTime(.0001, end);
    compressor.threshold.value = -24; compressor.knee.value = 12; compressor.ratio.value = 3;
    bus.connect(compressor).connect(context.destination);
    const assets = harmony.notes.map((midi) => state.stringBuffers.get(midi));
    const requiredWindows = Math.floor(crescendoSeconds + sustainSeconds);
    const sustainWindows = (asset) => asset.windowRms.slice(loop ? 2 : 1, loop ? -2 : requiredWindows);
    if (assets.some((asset) => sustainWindows(asset).some((rms) => rms < .001)))
      throw new Error('Campione archi non continuo');
    const estimatedUnderVoiceRms = Math.sqrt(assets.reduce((sum, asset) => sum + (asset.rms * asset.normalizationGain * .72 * .06) ** 2, 0));
    reportAudioEvent('harmony', at, { entry, end, diminuendoStart, notes: [...harmony.notes], peakGain: .18,
      sustainGain: .06, sampleRms: assets.map((asset) => asset.rms), sampleDurations: assets.map((asset) => asset.buffer.duration),
      minimumSustainRms: Math.min(...assets.flatMap(sustainWindows)), estimatedUnderVoiceRms, loop });
    return harmony.notes.map((midi) => {
      const asset = state.stringBuffers.get(midi);
      if (!asset || typeof asset.then === 'function') throw new Error('Campioni archi non ancora pronti');
      const { buffer } = asset;
      if (!loop && buffer.duration < crescendoSeconds + sustainSeconds) throw new Error(`Campione archi ${Core.midiToName(midi)} troppo corto`);
      const source = context.createBufferSource(), voiceGain = context.createGain();
      source.buffer = buffer; source.loop = loop;
      if (loop) { source.loopStart = Math.min(2, buffer.duration * .1); source.loopEnd = Math.max(source.loopStart + .1, buffer.duration - 2); }
      voiceGain.gain.value = asset.normalizationGain * .72;
      source.connect(voiceGain).connect(bus); source.start(at); source.stop(end + .03);
      return source;
    });
  }
  function playTone(note, at, duration = .8, gainValue = .2, diminuendoSeconds = 0) {
    const anchor = choirAnchor(note), asset = state.voiceBuffers.get(`${state.role}-${anchor}`);
    if (!asset || typeof asset.then === 'function') throw new Error('Campione Muse Choir non ancora pronto');
    const context = audioContext(), source = context.createBufferSource(), gain = context.createGain();
    source.buffer = asset.buffer; source.playbackRate.value = 2 ** ((note.midi - anchor) / 12); source.loop = false;
    if (asset.buffer.duration / source.playbackRate.value < duration) throw new Error('Campione Muse Choir troppo corto');
    const fadeStart = Math.max(at + .08, at + duration - diminuendoSeconds);
    gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(gainValue, at + .12);
    gain.gain.setValueAtTime(gainValue, fadeStart); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(gain).connect(context.destination); source.start(at); source.stop(at + duration + .03);
    reportAudioEvent('voice', at, { end: at + duration, diminuendoStart: fadeStart, midi: note.midi, anchor,
      role: state.role, gain: gainValue, sampleRms: asset.rms, sourceDuration: asset.buffer.duration }); return { source, gain };
  }
  function stopReference() { if (state.reference) { try { state.reference.source.stop(); } catch (_) {} state.reference = null; } clearTimeout(state.referenceTimer); state.referenceTimer = null; if (els.lab_listen) els.lab_listen.textContent = '▶'; }
  async function listen() {
    if (!state.exercise) return;
    if (state.reference) { stopReference(); return; }
    const context = audioContext(); await context.resume(); try { await loadExerciseVoices(); } catch (error) { els.lab_note.textContent = error.message; return; } const now = context.currentTime + .03, music = state.exercise.music;
    if (music.interval) {
      if (state.exercise.listeningMode === 'construction') playTone(music.interval.first, now, 1.1, .12);
      else if (state.exercise.listeningMode === 'harmonic') { playTone(music.interval.first, now, 1.1, .1); playTone(music.interval.second, now, 1.1, .1); }
      else { playTone(music.interval.first, now, .72); playTone(music.interval.second, now + .88, .72); }
    } else if (state.exercise.listeningMode === 'continuous') {
      state.reference = playTone(music.note, now, 30, .11, FINAL_DIMINUENDO_SECONDS); els.lab_listen.textContent = '■'; els.lab_countdown.textContent = '30.0'; const started = performance.now();
      const update = () => { if (!state.reference) return; const remaining = Math.max(0, 30 - (performance.now() - started) / 1000); els.lab_countdown.textContent = remaining.toFixed(1); if (remaining > 0) requestAnimationFrame(update); }; update(); state.referenceTimer = setTimeout(stopReference, 30050);
    } else {
      playTone(music.note, now, 1.35, .16); els.lab_countdown.textContent = 'ASCOLTA';
      setTimeout(() => { if (!state.recording && state.exercise?.listeningMode !== 'continuous') els.lab_countdown.textContent = '—'; }, 1400);
    }
  }
  function configMarkup() {
    if (state.activity === 'draw') return '<label>Figura <select id="lab-draw-shape"><option value="square">Rettangolo</option><option value="diamond">Rombo</option></select></label>';
    if (state.activity === 'sustain') return '<label>Durata <select id="lab-duration"><option>2</option><option>4</option><option>6</option></select> s</label><label><input id="lab-auto-next" type="checkbox" /> Nuova altezza dopo il risultato</label>';
    if (state.activity === 'repeat') return '<span class="lab-loop-label">Riferimento · 30 secondi</span>';
    if (state.activity === 'ear') return '<label>Livello <select id="lab-ear-level"><option value="1">1 · Direzione</option><option value="2">2 · Intervalli di riferimento</option><option value="3">3 · Maggiore e minore</option><option value="4">4 · Direzione indipendente</option><option value="5">5 · Armonico</option></select></label>';
    return '<label>Modalità <select id="lab-sing-mode"><option value="imitation">Imitazione guidata</option><option value="memory">Memoria breve</option><option value="construction">Costruzione</option></select></label><label>Difficoltà <select id="lab-sing-level"><option value="1">Intervalli base</option><option value="2">Maggiore e minore</option><option value="3">Completo</option></select></label>';
  }
  function renderActivity() {
    cancelPendingAdvance();
    document.body.dataset.activity = state.activity;
    drawLeft.hidden = drawRight.hidden = state.activity !== 'draw';
    (state.activity === 'draw' ? scorePanel : rollPanel).append(liveReadout, phase);
    const meta = activityMeta[state.activity]; [els.lab_kind.textContent, els.lab_title.textContent, els.lab_instruction.textContent] = meta;
    els.lab_config.innerHTML = configMarkup(); els.lab_feedback.hidden = true; els.lab_answer.hidden = true; state.exercise = null;
    els.lab_target.textContent = '—'; els.lab_frequency.textContent = 'Genera il primo esercizio'; els.lab_listen.disabled = true; els.lab_record.disabled = true;
    els.lab_new.textContent = '↺'; els.lab_session_progress.textContent = ''; state.frames = []; drawMusicViews(false);
    els.lab_config.querySelectorAll('select').forEach((select) => select.addEventListener('change', () => {
      if (state.activity === 'ear') state.earSession = null;
      if (state.activity === 'sing-interval') state.singSession = null;
      newExercise(false);
    }));
  }
  function ensurePitchSession() {
    if (!state.pitchSession) state.pitchSession = { notes: Core.buildInitialPitchSession(state.range), index: 0, outcomes: [] };
    els.lab_session_progress.textContent = state.activity === 'repeat' ? `${state.pitchSession.index + 1} di ${state.pitchSession.notes.length}` : '';
    return state.pitchSession;
  }
  function advancePitchSession() {
    cancelPendingAdvance();
    if (state.activity !== 'repeat' || !state.pitchSession) { newExercise(); return; }
    const outcome = state.pitchSession.outcomes[state.pitchSession.index];
    if (outcome && !outcome.reliable) { newExercise(); return; }
    if (state.pitchSession.index < state.pitchSession.notes.length - 1) state.pitchSession.index += 1;
    else { showPitchSessionSummary(); return; }
    newExercise();
  }
  function cancelPendingAdvance() {
    clearTimeout(state.advanceTimer); state.advanceTimer = null;
    els.lab_continue.hidden = true; els.lab_record.hidden = true;
  }
  function offerPitchAdvance(completionReason) {
    const session = state.pitchSession, completed = session.index + 1, total = session.notes.length;
    els.lab_state.textContent = completionReason === 'reached-with-correction' ? 'NOTA TROVATA' : 'NOTA CENTRATA';
    els.lab_session_progress.textContent = `${completed} di ${total} · riuscita`;
    els.lab_continue.textContent = `Continua · ${completed + 1} di ${total}`;
    els.lab_continue.hidden = false; els.lab_record.hidden = true;
    state.advanceTimer = setTimeout(() => { state.advanceTimer = null; advancePitchSession(); }, 1600);
  }
  function showPitchSessionSummary() {
    const outcomes = state.pitchSession?.outcomes.filter(Boolean) ?? [], reached = outcomes.filter((item) => item.completionReason.startsWith('reached')).length;
    const reliable = outcomes.filter((item) => item.reliable).length, acquired = outcomes.filter((item) => item.acquired).length;
    els.lab_feedback.hidden = false; els.lab_chart.hidden = true; els.lab_feedback_title.textContent = 'Blocco completato';
    els.lab_feedback_message.textContent = `${reached} note stabilizzate su ${outcomes.length}. ${reliable < outcomes.length ? 'Le misure incerte non vengono conteggiate come errori.' : 'Hai completato il primo blocco di intonazione.'}`;
    els.lab_metrics.innerHTML = `<div><dt>Altezze trovate</dt><dd>${acquired} / 4</dd></div><div><dt>Note stabilizzate</dt><dd>${reached} / 4</dd></div><div><dt>Misure affidabili</dt><dd>${reliable}</dd></div><div><dt>Prossimo passo</dt><dd>${reached >= 3 ? 'Direzione melodica' : 'Consolida le note singole'}</dd></div>`;
    els.lab_retry.hidden = true; els.lab_play_take.hidden = true; els.lab_next.textContent = 'Nuovo blocco';
    state.pitchSession = null;
    completeGuidedBlock();
  }
  function ensureEarSession(level) {
    if (!state.earSession || state.earSession.level !== level) state.earSession = { level, queue: Core.buildEarTrainingBlock({ range: state.range, role: state.role, level }), index: 0, outcomes: [] };
    els.lab_session_progress.textContent = `${state.earSession.index + 1} di ${state.earSession.queue.length}`;
    return state.earSession;
  }
  function ensureSingSession(level, mode) {
    if (!state.singSession || state.singSession.level !== level || state.singSession.mode !== mode)
      state.singSession = { level, mode, trials: Core.buildSingingIntervalBlock({ range: state.range, role: state.role, level, mode }), index: 0, outcomes: [] };
    els.lab_session_progress.textContent = `${state.singSession.index + 1} di ${state.singSession.trials.length}`;
    return state.singSession;
  }
  function loadResults() { try { return JSON.parse(localStorage.getItem(`${STORE}:results`)) || []; } catch (_) { return []; } }
  function activateBlock(block) {
    if (block.activity === 'repertoire') {
      const query = new URLSearchParams({ piece: block.pieceId }); if (block.partId) query.set('part', block.partId);
      if (block.phrase) { query.set('phraseStart', String(block.phrase.startMeasureIndex)); query.set('phraseEnd', String(block.phrase.endMeasureIndex)); query.set('autoplayPhrase', '1'); }
      window.location.href = `index.html?${query}`; return;
    }
    state.activity = block.activity;
    document.querySelectorAll('[data-activity]').forEach((button) => button.classList.toggle('active', button.dataset.activity === state.activity));
    renderActivity();
    if (state.activity === 'ear' && block.level) $('lab-ear-level').value = String(block.level);
    if (state.activity === 'sing-interval') { if (block.level) $('lab-sing-level').value = String(block.level); if (block.mode) $('lab-sing-mode').value = block.mode; }
    newExercise(false);
    els.lab_note.textContent = state.guidedSession ? `Percorso di oggi · blocco ${state.guidedSession.index + 1} di ${state.guidedSession.plan.blocks.length} · ${block.reason}` : '';
  }
  async function loadRepertoireContext(pieceId, partId) {
    if (!pieceId) return null;
    const config = window.ChoirRuntimeConfig ?? {}, template = config.bundleUrlTemplate;
    if (!template) return { pieceId, partId };
    try {
      const bundleResponse = await fetch(template.replace('{pieceId}', encodeURIComponent(pieceId)), { cache: 'no-store' });
      if (!bundleResponse.ok) throw new Error('bundle');
      const bundle = await bundleResponse.json(), scoreResponse = await fetch(bundle.assets.score, { cache: 'no-store' });
      if (!scoreResponse.ok) throw new Error('score');
      const score = await scoreResponse.json(), phrase = Core.extractRepertoirePhrase(score, { pieceId, partId });
      return { pieceId, partId, phrase };
    } catch (_) { return { pieceId, partId }; }
  }
  async function startGuidedSession() {
    let pieceId = null, partId = null;
    try { pieceId = localStorage.getItem('choir-last-practice-piece'); if (pieceId) partId = localStorage.getItem(`choir-part:${pieceId}`); } catch (_) {}
    els.lab_guided.disabled = true; els.lab_guided.textContent = 'Preparo il percorso…';
    const repertoire = await loadRepertoireContext(pieceId, partId), plan = Core.buildRecommendedSession(loadResults(), repertoire);
    state.pitchSession = null; state.earSession = null; state.singSession = null;
    state.guidedSession = { plan, index: 0, awaitingAdvance: false };
    els.lab_guided.dataset.repertoirePhrase = repertoire?.phrase?.lyrics ?? '';
    els.lab_guided.dataset.phraseStart = repertoire?.phrase?.startMeasureIndex ?? '';
    els.lab_guided.dataset.phraseEnd = repertoire?.phrase?.endMeasureIndex ?? '';
    els.lab_guided.disabled = false; els.lab_guided.textContent = `Oggi · circa ${plan.estimatedMinutes} min`;
    activateBlock(plan.blocks[0]);
  }
  function completeGuidedBlock() {
    if (!state.guidedSession) return;
    state.guidedSession.awaitingAdvance = true;
    els.lab_next.textContent = state.guidedSession.index < state.guidedSession.plan.blocks.length - 1 ? 'Continua il percorso' : 'Concludi';
  }
  function advanceGuidedSession() {
    if (!state.guidedSession?.awaitingAdvance) return false;
    state.guidedSession.index += 1; state.guidedSession.awaitingAdvance = false;
    if (state.guidedSession.index >= state.guidedSession.plan.blocks.length) {
      els.lab_feedback.hidden = false; els.lab_chart.hidden = true; els.lab_feedback_title.textContent = 'Allenamento completato';
      els.lab_feedback_message.textContent = 'Hai concluso i blocchi consigliati. I prossimi esercizi useranno i risultati affidabili raccolti oggi.';
      els.lab_metrics.replaceChildren(); els.lab_retry.hidden = true; els.lab_play_take.hidden = true; els.lab_next.textContent = 'Nuovo allenamento';
      state.guidedSession = null; return true;
    }
    activateBlock(state.guidedSession.plan.blocks[state.guidedSession.index]); return true;
  }
  function advanceCurrentSession() {
    if (state.activity === 'draw') { const selector = $('lab-draw-shape'); selector.value = selector.value === 'square' ? 'diamond' : 'square'; newExercise(false); return; }
    if (els.lab_next.textContent === 'Nuovo allenamento') { startGuidedSession(); return; }
    if (advanceGuidedSession()) return;
    if (state.activity === 'repeat') { advancePitchSession(); return; }
    if (state.activity === 'ear' && state.earSession) {
      if (state.earSession.index < state.earSession.queue.length - 1) { state.earSession.index += 1; newExercise(); }
      else showEarSessionSummary();
      return;
    }
    if (state.activity === 'sing-interval' && state.singSession) {
      if (state.singSession.index < state.singSession.trials.length - 1) { state.singSession.index += 1; newExercise(); }
      else showSingSessionSummary();
      return;
    }
    newExercise();
  }
  function showEarSessionSummary() {
    const outcomes = state.earSession?.outcomes ?? [], correct = outcomes.filter((item) => item.correct).length;
    const byDirection = ['ascending', 'descending', 'same'].map((direction) => { const items = outcomes.filter((item) => item.direction === direction); return [direction, items.length ? Math.round(items.filter((item) => item.correct).length / items.length * 100) : null]; });
    els.lab_feedback.hidden = false; els.lab_chart.hidden = true; els.lab_feedback_title.textContent = 'Blocco di ascolto completato'; els.lab_feedback_message.textContent = `${correct} risposte corrette su ${outcomes.length}. Gli intervalli da ripassare sono già stati ripresentati nel blocco.`;
    els.lab_metrics.innerHTML = byDirection.map(([direction, value]) => `<div><dt>${{ ascending: 'Ascendenti', descending: 'Discendenti', same: 'Uguali' }[direction]}</dt><dd>${value == null ? '—' : `${value}%`}</dd></div>`).join('') + `<div><dt>Prossimo passo</dt><dd>${correct / Math.max(1, outcomes.length) >= .75 ? 'Canto degli intervalli' : 'Consolida l’ascolto'}</dd></div>`;
    els.lab_retry.hidden = true; els.lab_play_take.hidden = true; els.lab_next.textContent = 'Nuovo blocco'; state.earSession = null; completeGuidedBlock();
  }
  function showSingSessionSummary() {
    const outcomes = state.singSession?.outcomes.filter(Boolean) ?? [], reliable = outcomes.filter((item) => item.reliable);
    const relative = reliable.filter((item) => item.relativeCorrect).length, absolute = reliable.filter((item) => item.firstAbsoluteCorrect && item.secondAbsoluteCorrect).length;
    els.lab_feedback.hidden = false; els.lab_chart.hidden = true; els.lab_feedback_title.textContent = 'Blocco di canto completato';
    els.lab_feedback_message.textContent = `${relative} intervalli corretti su ${reliable.length} misure affidabili. L’intonazione assoluta resta separata dalla distanza cantata.`;
    els.lab_metrics.innerHTML = `<div><dt>Distanza corretta</dt><dd>${relative} / ${reliable.length}</dd></div><div><dt>Entrambe le note centrate</dt><dd>${absolute} / ${reliable.length}</dd></div><div><dt>Misure affidabili</dt><dd>${reliable.length} / ${outcomes.length}</dd></div><div><dt>Modalità</dt><dd>${{ imitation: 'Imitazione', memory: 'Memoria', construction: 'Costruzione' }[state.singSession?.mode] ?? '—'}</dd></div>`;
    els.lab_retry.hidden = true; els.lab_play_take.hidden = true; els.lab_next.textContent = 'Nuovo blocco'; state.singSession = null; completeGuidedBlock();
  }
  function newExercise(autoListen = true) {
    preparationId += 1; preparing = false; soloStartedAt = null;
    stopDrawing(true);
    clearCountIn();
    cancelPendingAdvance(); stopReference(); stopCapture(true); state.rollBounds = null; els.lab_feedback.hidden = true; els.lab_answer.hidden = true;
    state.frames = []; state.elapsedSeconds = 0; state.harmony = null;
    if (state.activity === 'draw') {
      const shape = $('lab-draw-shape')?.value || 'square';
      const centerMidi = Math.round((state.range.lowMidi + state.range.highMidi) / 2);
      state.harmony = Core.planHarmony(centerMidi);
      const chordPitchClasses = new Set(state.harmony.notes.map((midi) => ((midi % 12) + 12) % 12));
      const companionCandidates = Array.from({ length: state.range.highMidi - state.range.lowMidi + 1 }, (_, index) => state.range.lowMidi + index)
        .filter((midi) => midi !== centerMidi && chordPitchClasses.has(((midi % 12) + 12) % 12)
          && Math.abs(midi - centerMidi) >= 3 && Math.abs(midi - centerMidi) <= 4)
        .sort((a, b) => Math.abs(a - centerMidi) - Math.abs(b - centerMidi) || a - b);
      const companionMidi = companionCandidates[0];
      if (!Number.isFinite(companionMidi)) throw new Error('Nessuna coppia di note dell’accordo nell’estensione vocale');
      const notes = [centerMidi, companionMidi].sort((a, b) => a - b);
      state.drawSession = Draw.create(shape, centerMidi, { lowMidi: notes[0], highMidi: notes[1] });
      state.exercise = { type: 'draw', durationSeconds: Draw.MAX_SECONDS, music: { centerMidi, notes } };
      els.lab_target.textContent = Draw.SHAPES[shape].label; els.lab_frequency.textContent = `${Core.midiToName(notes[0])} ↔ ${Core.midiToName(notes[1])} · note dell’accordo`;
      els.lab_listen.disabled = false; els.lab_state.textContent = 'PRONTO'; els.lab_countdown.textContent = `${Draw.MAX_SECONDS} s`;
      els.lab_session_progress.textContent = 'Percorso 0%'; syncStart(); setPhase('Premi ▶ per iniziare'); drawMusicViews(true); return;
    }
    if (state.activity === 'ear' || state.activity === 'sing-interval') {
      const rawLevel = Number($(state.activity === 'ear' ? 'lab-ear-level' : 'lab-sing-level')?.value || 1), level = Math.min(3, rawLevel);
      const earTrial = state.activity === 'ear' ? ensureEarSession(rawLevel).queue[state.earSession.index] : null;
      const singMode = $('lab-sing-mode')?.value || 'imitation';
      const singTrial = state.activity === 'sing-interval' ? ensureSingSession(level, singMode).trials[state.singSession.index] : null;
      const interval = earTrial?.interval ?? singTrial?.interval ?? Core.generateInterval({ range: state.range, level });
      const durationSeconds = state.activity === 'sing-interval' ? Core.INTERVAL_TIMING.noteSeconds * 2 : 3.2, splitSeconds = durationSeconds / 2;
      state.exercise = Core.definition({ id: `${state.activity}-${Date.now()}`, type: state.activity, difficulty: rawLevel, music: { interval }, expectedTimeline: [{ midi: interval.first.midi, at: 0, duration: splitSeconds }, { midi: interval.second.midi, at: splitSeconds, duration: splitSeconds }], durationSeconds, listeningMode: singTrial?.mode ?? (rawLevel === 4 ? 'harmonic' : 'melodic'), microphoneRequired: state.activity === 'sing-interval', completion: { answered: true }, analysis: { relativePitch: state.activity === 'sing-interval', segmentedAt: splitSeconds } });
      if (earTrial) { state.exercise = Core.definition({ ...state.exercise, id: earTrial.id, listeningMode: earTrial.mode, analysis: { answerKind: earTrial.answerKind, retryOf: earTrial.retryOf ?? null } }); }
      els.lab_target.textContent = state.activity === 'ear' ? 'Prima e seconda nota' : interval.name;
      els.lab_frequency.textContent = state.activity === 'ear' ? 'La risposta resta nascosta fino alla scelta' : `${interval.first.name} → ${interval.second.name} · ${{ imitation: 'ascolta e imita', memory: 'ricorda, poi canta', construction: 'costruisci dalla prima nota' }[singMode]}`;
      if (state.activity === 'ear') showEarAnswers(rawLevel); else els.lab_record.disabled = false;
    } else {
      const note = state.activity === 'repeat' ? ensurePitchSession().notes[state.pitchSession.index] : Core.randomNote(state.range);
      const duration = state.activity === 'sustain' ? Number($('lab-duration')?.value || 2) : 30;
      const listeningMode = state.activity === 'repeat' ? 'continuous' : 'before';
      state.exercise = Core.definition({ id: `${state.activity}-${Date.now()}`, type: state.activity, music: { note }, expectedTimeline: [{ midi: note.midi, at: 0, duration }], durationSeconds: duration, listeningMode, microphoneRequired: true, completion: { minReliableCoverage: .35 }, analysis: { sharedPipeline: 'VocalFeedback.analyseNote' } });
      els.lab_target.textContent = note.name; els.lab_frequency.textContent = `${note.frequencyHz.toFixed(1)} Hz`; els.lab_record.disabled = false;
    }
    const harmonyTarget = state.exercise.music.note ?? state.exercise.music.interval?.first;
    if (harmonyTarget) state.harmony = Core.planHarmony(harmonyTarget.midi);
    els.lab_listen.disabled = false; els.lab_state.textContent = 'PRONTO'; els.lab_countdown.textContent = '—';
    syncStart(); setPhase('Premi ▶ per iniziare');
    drawMusicViews(state.activity !== 'ear');
  }
  function showEarAnswers(level) {
    const interval = state.exercise.music.interval, trial = state.earSession?.queue[state.earSession.index];
    delete els.lab_answer.dataset.answered;
    const answerKind = trial?.answerKind ?? (level === 1 ? 'direction' : 'interval');
    let choices;
    if (answerKind === 'direction') choices = [['Più alta', 'ascending'], ['Più bassa', 'descending'], ['Uguale', 'same']];
    else {
      const pool = level === 5 ? [0, 3, 4, 5, 7, 12] : Core.allowedIntervals(Math.min(3, level));
      const distances = [interval.semitones, ...pool.filter((value) => value !== interval.semitones)
        .sort((a, b) => Math.abs(a - interval.semitones) - Math.abs(b - interval.semitones))].slice(0, 4).sort((a, b) => a - b);
      choices = distances.map((semitones) => [Core.INTERVALS.find((item) => item.semitones === semitones)?.name ?? `${semitones} semitoni`, String(semitones)]);
    }
    els.lab_answer.hidden = false; els.lab_answer.innerHTML = `<p>${level === 1 ? 'La seconda nota è…' : 'Quale intervallo hai ascoltato?'}</p><div>${choices.map(([label, value]) => `<button type="button" data-answer="${value}">${label}</button>`).join('')}</div>`;
    els.lab_answer.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
      if (els.lab_answer.dataset.answered) return; els.lab_answer.dataset.answered = 'yes';
      const expected = answerKind === 'direction' ? interval.direction : String(interval.semitones), correct = button.dataset.answer === expected;
      els.lab_answer.querySelectorAll('button').forEach((item) => { item.disabled = true; item.classList.toggle('correct', item.dataset.answer === expected); });
      button.classList.toggle('wrong', !correct);
      if (state.earSession && trial) {
        state.earSession.outcomes.push({ trialId: trial.id, retryOf: trial.retryOf ?? null, correct, answer: button.dataset.answer,
          expected, answerKind, direction: interval.direction, semitones: interval.semitones, mode: trial.mode });
        if (!correct) state.earSession.queue = Core.scheduleEarRetry(state.earSession.queue, state.earSession.index, 3);
        els.lab_session_progress.textContent = `${state.earSession.index + 1} di ${state.earSession.queue.length}`;
      }
      const answerLabel = answerKind === 'direction' ? ({ ascending: 'più alta', descending: 'più bassa', same: 'uguale' })[expected] : interval.name;
      saveResult(Core.result({ exercise: state.exercise, actualConfig: { answer: button.dataset.answer, expected, answerKind,
        interval: { semitones: interval.semitones, direction: interval.direction }, mode: state.exercise.listeningMode, difficulty: state.exercise.difficulty, role: state.role, range: state.range },
      analysis: { correct, expected, answerKind, direction: interval.direction, semitones: interval.semitones, mode: state.exercise.listeningMode,
        retryOf: trial?.retryOf ?? null }, confidence: 1, feedbackShown: correct ? 'Risposta corretta.' : `La risposta era: ${answerLabel}.`, durationSeconds: 0 }));
      drawMusicViews(true);
      els.lab_target.textContent = interval.name;
      els.lab_frequency.textContent = `${interval.first.name} → ${interval.second.name}`;
      els.lab_feedback.hidden = false; els.lab_feedback_title.textContent = correct ? 'Esatto.' : 'Proviamo a riascoltare';
      els.lab_feedback_message.textContent = correct ? 'Risposta corretta.' : `La risposta era ${answerLabel}. La ritroverai fra qualche prova.`;
      els.lab_metrics.replaceChildren(); els.lab_chart.hidden = true; els.lab_retry.hidden = true; els.lab_play_take.hidden = true;
      els.lab_next.textContent = state.earSession?.index === state.earSession?.queue.length - 1 ? 'Concludi blocco' : 'Continua';
    }));
  }
  async function ensureMicrophone() {
    if (state.stream?.active) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Il microfono richiede una connessione sicura.');
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 }, video: false });
    const context = audioContext(); await context.resume(); state.input = context.createMediaStreamSource(state.stream); state.analyser = context.createAnalyser(); state.analyser.fftSize = 2048; state.input.connect(state.analyser);
  }
  function stopMicrophoneCheck() {
    if (!state.calibrationActive) return;
    state.calibrationActive = false; state.calibrationGeneration += 1; els.lab_mic_check_level.value = 0;
    els.lab_mic_check.textContent = 'Avvia controllo'; els.lab_mic_check_status.textContent = 'Prova libera, non valutata';
  }
  async function toggleMicrophoneCheck() {
    if (state.calibrationActive) { stopMicrophoneCheck(); return; }
    try { await ensureMicrophone(); } catch (error) { els.lab_mic_check_status.textContent = error.message; return; }
    const generation = ++state.calibrationGeneration, buffer = new Float32Array(state.analyser.fftSize), smoother = new PitchSmoother();
    smoother.configure(state.detectorSettings); state.calibrationActive = true; els.lab_mic_check.textContent = 'Ferma controllo';
    const tick = () => {
      if (!state.calibrationActive || generation !== state.calibrationGeneration || !els.lab_settings_dialog.open) { stopMicrophoneCheck(); return; }
      state.analyser.getFloatTimeDomainData(buffer); const raw = detectPitch(buffer, audioContext().sampleRate, state.detectorSettings);
      const estimate = smoother.update(raw, performance.now()); els.lab_mic_check_level.value = raw.rms || 0;
      els.lab_mic_check_status.textContent = Number.isFinite(estimate.displayHz) && (estimate.confidence ?? 0) >= .3
        ? `${Core.midiToName(Math.round(69 + 12 * Math.log2(estimate.displayHz / 440)))} rilevata · il controllo non viene salvato`
        : (raw.rms || 0) > .004 ? 'Segnale presente · canta una nota comoda' : 'Parla o canta liberamente';
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function metronomeClick(at, accented = false) {
    const context = audioContext(), oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(accented ? 1320 : 920, at);
    gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(accented ? .16 : .1, at + .006);
    gain.gain.exponentialRampToValueAtTime(.0001, at + .075); oscillator.connect(gain).connect(context.destination);
    oscillator.start(at); oscillator.stop(at + .085); reportAudioEvent('metronome', at, { accented }); return oscillator;
  }
  function clearCountIn() {
    state.countInTimers.forEach(clearTimeout); state.countInTimers = [];
    if (state.countInFrame != null) cancelAnimationFrame(state.countInFrame);
    state.countInFrame = null;
    state.metronomeSources.forEach((source) => { try { source.stop(); } catch (_) {} }); state.metronomeSources = [];
    state.accompanimentSources.forEach((source) => { try { source.stop(); } catch (_) {} }); state.accompanimentSources = [];
    state.countingIn = false;
  }
  function startIntervalCountIn(generation, beginTake) {
    const { countInBeats, bpm } = Core.INTERVAL_TIMING, beatMilliseconds = 60000 / bpm;
    const context = audioContext(), audioStart = context.currentTime + .04; state.countingIn = true; state.countInStartedAt = performance.now();
    state.accompanimentSources = playHarmony(state.harmony, audioStart, countInBeats * beatMilliseconds / 1000, state.exercise.durationSeconds);
    const animateCountIn = () => { if (!state.countingIn) return; drawRoll(true); state.countInFrame = requestAnimationFrame(animateCountIn); };
    animateCountIn();
    els.lab_record.textContent = 'Annulla';
    for (let index = 0; index < countInBeats; index += 1) {
      state.metronomeSources.push(metronomeClick(audioStart + index * beatMilliseconds / 1000, index === 0));
      state.countInTimers.push(setTimeout(() => {
        if (!state.recording || generation !== state.generation) return;
        els.lab_state.textContent = 'PREPARATI'; els.lab_countdown.textContent = `${index + 1} / ${countInBeats}`;
        setPhase(`Preparati · ${index + 1} / ${countInBeats}`, (index + 1) / countInBeats);
      }, index * beatMilliseconds));
    }
    state.countInTimers.push(setTimeout(() => {
      if (!state.recording || generation !== state.generation) return;
      state.countInTimers = []; state.metronomeSources = []; state.countingIn = false;
      if (state.countInFrame != null) cancelAnimationFrame(state.countInFrame);
      state.countInFrame = null; beginTake();
    }, countInBeats * beatMilliseconds));
  }
  async function startCapture() {
    if (!state.exercise || state.recording) return;
    const requestedExercise = state.exercise;
    els.lab_record.disabled = true;
    try { await Promise.all([ensureMicrophone(), loadExerciseVoices(), loadHarmony()]); } catch (error) { els.lab_note.textContent = error.message; return; }
    finally { els.lab_record.disabled = !state.exercise; }
    if (state.exercise !== requestedExercise || state.recording) return;
    const generation = ++state.generation, duration = state.exercise.durationSeconds; state.frames = []; state.elapsedSeconds = 0; state.autoCompleting = false; state.recording = true; state.startedAt = performance.now();
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl); state.audioUrl = null; els.lab_play_take.disabled = true;
    els.lab_record.disabled = false; els.lab_record.textContent = 'Disattiva'; els.lab_new.disabled = true; els.lab_feedback.hidden = true; els.lab_state.textContent = 'IN ASCOLTO';
    const beginTake = () => {
      if (!state.recording || generation !== state.generation) return;
      state.startedAt = performance.now(); els.lab_record.textContent = 'Disattiva';
      const entrance = audioContext().currentTime + .02;
      state.metronomeSources.push(metronomeClick(entrance, true));
      if (state.exercise.type === 'sing-interval')
        state.metronomeSources.push(metronomeClick(entrance + Core.INTERVAL_TIMING.noteSeconds, true));
      if (window.MediaRecorder) {
        state.chunks = []; const recorder = new MediaRecorder(state.stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined); state.mediaRecorder = recorder;
        recorder.ondataavailable = (event) => { if (event.data.size) state.chunks.push(event.data); };
        recorder.onstop = () => { if (!state.chunks.length) return; state.audioUrl = URL.createObjectURL(new Blob(state.chunks, { type: recorder.mimeType || 'audio/webm' })); els.lab_play_take.disabled = false; };
        recorder.start(250);
      }
      if (state.exercise.listeningMode === 'continuous' && !state.reference) { const now = audioContext().currentTime + .02; state.reference = playTone(state.exercise.music.note, now, duration, .11, FINAL_DIMINUENDO_SECONDS); }
      const buffer = new Float32Array(state.analyser.fftSize), smoother = new PitchSmoother(); smoother.configure(state.detectorSettings);
      const tick = () => {
        if (!state.recording || state.countingIn || generation !== state.generation) return;
        state.analyser.getFloatTimeDomainData(buffer); const raw = detectPitch(buffer, audioContext().sampleRate, state.detectorSettings), estimate = smoother.update(raw, performance.now()); const elapsed = (performance.now() - state.startedAt) / 1000; state.elapsedSeconds = elapsed;
        state.frames.push({ time: elapsed, hz: estimate.hz, displayPitch: Number.isFinite(estimate.displayHz) ? 69 + 12 * Math.log2(estimate.displayHz / 440) : null, confidence: estimate.confidence ?? 0, clarity: estimate.clarity ?? 0, confirmationState: estimate.accepted ? 'confirmed' : 'provisional' });
        els.lab_level.value = raw.rms || 0; els.lab_countdown.textContent = Math.max(0, duration - elapsed).toFixed(1); drawRoll(true);
        if (state.exercise.type === 'sing-interval') {
          els.lab_state.textContent = elapsed < duration / 2 ? 'CANTA · PRIMA NOTA' : 'CAMBIA · SECONDA NOTA';
          setPhase(elapsed < duration / 2 ? 'Canta la prima nota' : 'Ora la seconda nota', elapsed / duration);
        } else setPhase(elapsed < duration - FINAL_DIMINUENDO_SECONDS ? 'Segui coro e accordo' : 'Diminuendo', elapsed / duration);
        const progress = state.exercise.type === 'repeat' ? Core.evaluatePitchProgress(state.exercise.music.note, state.frames, elapsed) : null;
        if (progress?.status === 'acquired' || progress?.status === 'stabilizing') els.lab_state.textContent = 'STABILIZZA';
        else if (progress?.status === 'searching') els.lab_state.textContent = 'CERCA LA NOTA';
        if (elapsed >= duration) finishCapture(generation, progress?.completed ? progress.status : 'completed'); else requestAnimationFrame(tick);
      }; requestAnimationFrame(tick);
    };
    startIntervalCountIn(generation, beginTake); syncStart();
  }
  async function startExercise() {
    if (preparing || state.countingIn || state.recording) {
      preparationId += 1; preparing = false; stopDrawing(true); stopCapture(true); clearCountIn(); stopReference(); syncStart(); setPhase('Premi ▶ per riprovare'); return;
    }
    if (state.activity === 'draw') {
      const token = ++preparationId; preparing = true; syncStart();
      try { await Promise.all([ensureMicrophone(), loadHarmony()]); await audioContext().resume(); if (token !== preparationId || state.activity !== 'draw') return; preparing = false; beginDrawing(); }
      catch (error) { if (token === preparationId) { preparing = false; setPhase(error.message); syncStart(); } }
      return;
    }
    cancelPendingAdvance(); soloStartedAt = null;
    const token = ++preparationId; preparing = true; syncStart();
    try {
      await Promise.all([loadExerciseVoices(), loadHarmony()]); await audioContext().resume();
      if (token !== preparationId) return;
      if (state.activity !== 'ear') await ensureMicrophone();
      if (token !== preparationId) return;
      if (state.activity === 'ear') {
        const beat = 60 / Core.INTERVAL_TIMING.bpm;
        for (let index = 0; index < 2; index += 1) {
          setPhase(`Preparati · ${index + 1} / 2`, (index + 1) / 2);
          state.metronomeSources.push(metronomeClick(audioContext().currentTime + .02, index === 0));
          await new Promise(resolve => setTimeout(resolve, beat * 1000));
          if (token !== preparationId) return;
        }
        setPhase('Ascolta il modello');
        const now = audioContext().currentTime + .03, music = state.exercise.music;
        if (music.interval) {
          state.metronomeSources.push(playTone(music.interval.first, now, .8).source);
          if (state.exercise.listeningMode !== 'construction') state.metronomeSources.push(playTone(music.interval.second, now + .95, .8).source);
        }
        await new Promise(resolve => setTimeout(resolve, 1850));
        if (token !== preparationId) return;
        preparing = false; setPhase('La seconda nota è…'); syncStart();
      } else {
        preparing = false;
        await startCapture();
      }
    } catch (error) { if (token === preparationId) { preparing = false; setPhase(error.message); syncStart(); } }
  }
  function stopCapture(cancelled = false) { if (!state.recording) return; clearCountIn(); state.recording = false; state.generation += 1; if (state.mediaRecorder?.state === 'recording') { if (cancelled) state.mediaRecorder.onstop = null; state.mediaRecorder.stop(); } if (cancelled) state.chunks = []; els.lab_record.disabled = !state.exercise; els.lab_record.textContent = 'Microfono'; els.lab_new.disabled = false; els.lab_level.value = 0; if (cancelled) { els.lab_state.textContent = 'PRONTO'; if (!state.reference) els.lab_countdown.textContent = '—'; } drawRoll(true); }
  function finishCapture(generation, completionReason = 'manual') {
    if (!state.recording || generation !== state.generation) return; state.recording = false; if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop(); els.lab_record.disabled = false; els.lab_record.textContent = 'Microfono'; els.lab_new.disabled = false; els.lab_level.value = 0; els.lab_state.textContent = 'COMPLETATO';
    stopReference(); state.accompanimentSources = [];
    // Completion can advance without opening feedback: expose the full take
    // immediately rather than leaving the last live (temporally faded) frame.
    drawRoll(true);
    syncStart(); setPhase('Prova conclusa');
    const exercise = state.exercise; let analysis;
    if (exercise.type === 'sing-interval') analysis = Core.analyseSungInterval(exercise.music.interval, state.frames, exercise.durationSeconds / 2, exercise.durationSeconds);
    else analysis = Core.analyseSustained(exercise.music.note, state.frames, exercise.durationSeconds);
    if (exercise.type === 'repeat') analysis.incrementalProgress = Core.evaluatePitchProgress(exercise.music.note, state.frames, state.elapsedSeconds);
    analysis.completionReason = completionReason; analysis.timeToCompletionSeconds = state.elapsedSeconds;
    if (state.activity === 'repeat' && state.pitchSession) state.pitchSession.outcomes[state.pitchSession.index] = Core.pitchTrialOutcome(completionReason, analysis);
    if (state.activity === 'sing-interval' && state.singSession) state.singSession.outcomes[state.singSession.index] = {
      reliable: analysis.reliable, relativeCorrect: analysis.relativeCorrect, firstAbsoluteCorrect: analysis.firstAbsoluteCorrect,
      secondAbsoluteCorrect: analysis.secondAbsoluteCorrect, mode: exercise.listeningMode, interval: exercise.music.interval.semitones };
    saveResult(Core.result({ exercise, actualConfig: { ...exercise.music, role: state.role, range: state.range, mode: exercise.listeningMode }, analysis, confidence: analysis.metrics?.confidence ?? analysis.confidence ?? 0, feedbackShown: analysis.message, durationSeconds: state.elapsedSeconds }));
    const earlySuccess = completionReason === 'reached' || completionReason === 'reached-with-correction';
    if (earlySuccess && state.activity === 'repeat' && state.pitchSession) {
      if (state.pitchSession.index === state.pitchSession.notes.length - 1) showPitchSessionSummary();
      else { els.lab_feedback.hidden = true; offerPitchAdvance(completionReason); }
    } else showFeedback(analysis);
  }
  const number = (value) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(0)} ¢` : '—';
  function showFeedback(analysis) {
    els.lab_retry.hidden = false; els.lab_play_take.hidden = false;
    els.lab_feedback.hidden = false; els.lab_chart.hidden = false; els.lab_feedback_title.textContent = analysis.reliable === false || analysis.category === 'uncertain' ? 'Misura incerta' : 'Prova analizzata'; els.lab_feedback_message.textContent = analysis.message;
    if (analysis.completionReason === 'reached' || analysis.completionReason === 'reached-with-correction') {
      els.lab_feedback_title.textContent = analysis.completionReason === 'reached-with-correction' ? 'Nota raggiunta dopo la correzione' : 'Nota raggiunta';
      els.lab_feedback_message.textContent = analysis.completionReason === 'reached-with-correction' ? 'Hai trovato e stabilizzato la nota: non serve continuare fino al timeout.' : 'La nota è stabile: la prova si è conclusa in anticipo.';
    }
    const lastPitchTrial = state.activity === 'repeat' && state.pitchSession?.index === state.pitchSession?.notes.length - 1;
    const lastSingTrial = state.activity === 'sing-interval' && state.singSession?.index === state.singSession?.trials.length - 1;
    const repeatOutcome = state.activity === 'repeat' ? state.pitchSession?.outcomes[state.pitchSession.index] : null;
    els.lab_next.textContent = repeatOutcome && !repeatOutcome.reliable ? 'Riprova la stessa nota' : lastPitchTrial || lastSingTrial ? 'Concludi blocco' : 'Continua';
    const metrics = analysis.metrics ? [['Scarto mediano', number(analysis.metrics.medianCents)], ['Deriva', number(analysis.metrics.driftCents)], ['Copertura affidabile', `${Math.round(analysis.metrics.coverage * 100)}%`], ['Affidabilità', analysis.metrics.reliable ? 'Buona' : 'Insufficiente']]
      : [['Prima nota', number(analysis.firstErrorCents)], ['Seconda nota', number(analysis.secondErrorCents)], ['Errore relativo', number(analysis.relativeErrorCents)], ['Intervallo', analysis.relativeCorrect ? 'Corretto' : 'Da affinare'], ['Transizione', Number.isFinite(analysis.transitionSeconds) ? `${analysis.transitionSeconds.toFixed(2)} s` : '—']];
    els.lab_metrics.innerHTML = metrics.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join(''); drawChart(analysis);
  }
  function drawChart(analysis) {
    const canvas = els.lab_chart, ratio = devicePixelRatio || 1, width = canvas.clientWidth || 640, height = 210; canvas.width = width * ratio; canvas.height = height * ratio; const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = '#29454c'; ctx.lineWidth = 1; [-100, -50, 0, 50, 100].forEach((cent) => { const y = height / 2 - cent * (height - 32) / 240; ctx.beginPath(); ctx.moveTo(38, y); ctx.lineTo(width - 12, y); ctx.stroke(); ctx.fillStyle = '#8ca4aa'; ctx.fillText(`${cent}¢`, 2, y + 4); });
    const targetHzAt = (time) => state.exercise.type === 'sing-interval' ? (time < state.exercise.durationSeconds / 2 ? state.exercise.music.interval.first.frequencyHz : state.exercise.music.interval.second.frequencyHz) : state.exercise.music.note.frequencyHz;
    const plume = state.frames.map((frame) => ({ ...frame, displayPitch: Number.isFinite(frame.hz) ? Core.centsBetween(frame.hz, targetHzAt(frame.time)) / 100 : null }));
    const plottedDuration = Math.max(.5, state.elapsedSeconds, plume.at(-1)?.time || 0);
    PitchShared.drawConfidencePlume(ctx, plume, (frame) => 38 + frame.time / plottedDuration * (width - 50), (semitones) => height / 2 - semitones * 100 * (height - 32) / 240, -1.2, 1.2, { ...state.plumeSettings, mode: 'review', currentTime: plottedDuration });
  }
  function saveResult(item) { try { const items = JSON.parse(localStorage.getItem(`${STORE}:results`)) || []; items.push(item); localStorage.setItem(`${STORE}:results`, JSON.stringify(items.slice(-MAX_RESULTS))); } catch (_) {} }
  function renderRange() { els.lab_range_label.textContent = `Estensione: ${Core.midiToName(state.range.lowMidi)}–${Core.midiToName(state.range.highMidi)}`; }
  document.querySelectorAll('[data-activity]').forEach((button) => button.addEventListener('click', () => { stopDrawing(true); stopCapture(true); state.guidedSession = null; els.lab_guided.textContent = 'Allenamento di oggi'; document.querySelectorAll('[data-activity]').forEach((b) => b.classList.toggle('active', b === button)); state.activity = button.dataset.activity; renderActivity(); newExercise(false); }));
  window.addEventListener('keydown', (event) => {
    if (state.activity !== 'draw' || !state.recording || !['ArrowLeft', 'ArrowRight'].includes(event.key) || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName || '')) return;
    event.preventDefault(); drawKeys.add(event.key);
  });
  window.addEventListener('keyup', (event) => { if (drawKeys.delete(event.key)) event.preventDefault(); });
  window.addEventListener('blur', () => drawKeys.clear());
  for (const [button, key] of [[drawLeft, 'ArrowLeft'], [drawRight, 'ArrowRight']]) {
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); button.setPointerCapture(event.pointerId); drawKeys.add(key); });
    button.addEventListener('pointerup', () => drawKeys.delete(key));
    button.addEventListener('pointercancel', () => drawKeys.delete(key));
    button.addEventListener('lostpointercapture', () => drawKeys.delete(key));
  }
  els.lab_guided.addEventListener('click', () => { stopDrawing(true); stopCapture(true); startGuidedSession().catch((error) => { els.lab_guided.disabled = false; els.lab_guided.textContent = 'Allenamento di oggi'; els.lab_note.textContent = error.message; }); });
  els.lab_new.addEventListener('click', newExercise); els.lab_listen.addEventListener('click', startExercise); els.lab_continue.addEventListener('click', () => { cancelPendingAdvance(); advancePitchSession(); }); els.lab_retry.addEventListener('click', () => { els.lab_feedback.hidden = true; startExercise(); }); els.lab_next.addEventListener('click', advanceCurrentSession);
  els.lab_play_take.addEventListener('click', () => { if (state.audioUrl) new Audio(state.audioUrl).play(); });
  for (let midi = 36; midi <= 84; midi += 1) { els.lab_low.add(new Option(Core.midiToName(midi), midi)); els.lab_high.add(new Option(Core.midiToName(midi), midi)); }
  els.lab_settings.addEventListener('click', () => { els.lab_role.value = state.role; els.lab_low.value = state.range.lowMidi; els.lab_high.value = state.range.highMidi; els.lab_settings_dialog.showModal(); });
  els.lab_mic_check.addEventListener('click', toggleMicrophoneCheck);
  els.lab_settings_close.addEventListener('click', () => { stopMicrophoneCheck(); els.lab_settings_dialog.close(); });
  els.lab_role.addEventListener('change', () => { const preset = ROLE_RANGES[els.lab_role.value]; els.lab_low.value = preset.lowMidi; els.lab_high.value = preset.highMidi; });
  els.lab_settings_save.addEventListener('click', () => { const next = { lowMidi: Number(els.lab_low.value), highMidi: Number(els.lab_high.value) }; if (!Core.validateRange(next)) { els.lab_note.textContent = 'La nota più alta deve essere uguale o superiore a quella più bassa.'; return; } stopMicrophoneCheck(); state.role = els.lab_role.value; state.range = next; state.pitchSession = null; state.earSession = null; state.singSession = null; localStorage.setItem(`${STORE}:role`, state.role); localStorage.setItem(`${STORE}:range`, JSON.stringify(next)); renderRange(); els.lab_settings_dialog.close(); state.exercise = null; renderActivity(); newExercise(false); });
  window.addEventListener('beforeunload', () => { stopMicrophoneCheck(); stopReference(); stopCapture(true); state.stream?.getTracks().forEach((track) => track.stop()); });
  window.addEventListener('resize', () => drawMusicViews(state.activity !== 'ear' || Boolean(els.lab_answer.dataset.answered)));
  renderRange(); renderActivity(); newExercise(false);
  if (needsRoleSetup) { els.lab_role.value = state.role; els.lab_low.value = state.range.lowMidi; els.lab_high.value = state.range.highMidi; els.lab_settings_dialog.showModal(); }
})();
