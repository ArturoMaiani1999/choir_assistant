(function () {
  'use strict';
  const Core = window.VoiceLabCore, { detectPitch, PitchSmoother } = window.ChoirPitch;
  const PitchShared = window.ChoirPitchShared;
  const $ = (id) => document.getElementById(id);
  const els = Object.fromEntries(['lab-range-label', 'lab-kind', 'lab-title', 'lab-instruction', 'lab-config', 'lab-session-progress', 'lab-score', 'lab-score-curtain', 'lab-roll', 'lab-target', 'lab-frequency', 'lab-state', 'lab-countdown', 'lab-level', 'lab-new', 'lab-listen', 'lab-continue', 'lab-record', 'lab-answer', 'lab-feedback', 'lab-feedback-title', 'lab-feedback-message', 'lab-metrics', 'lab-chart', 'lab-play-take', 'lab-retry', 'lab-next', 'lab-note', 'lab-guided', 'lab-settings', 'lab-settings-dialog', 'lab-role', 'lab-low', 'lab-high', 'lab-mic-check', 'lab-mic-check-level', 'lab-mic-check-status', 'lab-settings-save', 'lab-settings-close'].map((id) => [id.replaceAll('-', '_'), $(id)]));
  const STORE = 'choir-voice-lab:v1', MAX_RESULTS = 200;
  let soloStartedAt = null, preparing = false, preparationId = 0;
  const phase = document.createElement('div'); phase.className = 'lab-phase'; phase.setAttribute('role', 'status');
  document.querySelector('.lab-roll-panel').append(phase);
  function setPhase(text, progress = 0) { phase.textContent = text; phase.style.setProperty('--progress', `${Math.min(100, progress * 100)}%`); }
  document.querySelectorAll('[data-activity="sustain"]').forEach(button => button.remove());
  els.lab_record.hidden = true;
  function syncStart() {
    els.lab_record.hidden = true;
    els.lab_listen.textContent = state.recording || preparing ? '■' : '▶';
    els.lab_listen.setAttribute('aria-label', state.recording || preparing ? 'Interrompi' : 'Inizia');
  }
  const ROLE_RANGES = Object.freeze({ soprano: { lowMidi: 60, highMidi: 77 }, alto: { lowMidi: 55, highMidi: 72 }, tenor: { lowMidi: 48, highMidi: 67 }, bass: { lowMidi: 40, highMidi: 60 } });
  const sharedPitch = PitchShared.readPreferences();
  const state = { activity: 'repeat', role: 'tenor', range: { ...ROLE_RANGES.tenor }, exercise: null, pitchSession: null, earSession: null, singSession: null, guidedSession: null, autoCompleting: false, advanceTimer: null, countInTimers: [], metronomeSources: [], countingIn: false, audio: null, voiceBuffer: null, reference: null, referenceTimer: null, stream: null, analyser: null, input: null, recording: false, calibrationActive: false, calibrationGeneration: 0, mediaRecorder: null, chunks: [], generation: 0, frames: [], startedAt: 0, elapsedSeconds: 0, audioUrl: null, rollBounds: null, detectorSettings: sharedPitch.detector, plumeSettings: sharedPitch.plume };
  let needsRoleSetup = true;
  try { const savedRole = localStorage.getItem(`${STORE}:role`); needsRoleSetup = !savedRole; state.role = savedRole || state.role; state.range = { ...ROLE_RANGES[state.role] }; } catch (_) {}
  try { state.range = { ...state.range, ...JSON.parse(localStorage.getItem(`${STORE}:range`)) }; } catch (_) {}
  const activityMeta = {
    repeat: ['INTONAZIONE · LIVELLO 1', 'Trova la nota', 'Segui il riferimento: la prova termina appena trovi e stabilizzi la nota.'],
    sustain: ['INTONAZIONE · NOTA TENUTA', 'Tieni la nota', 'Ascolta il riferimento breve, poi mantieni la nota senza guida per tutta la durata.'],
    ear: ['ASCOLTO · EAR TRAINING', 'Riconosci intervalli', 'Ascolta senza guardare la risposta, poi scegli.'],
    'sing-interval': ['INTERVALLI · RIPRODUZIONE', 'Canta gli intervalli', 'Ascolta le note; quattro pulsazioni preparano l’attacco e il cambio.'],
  };
  function canvasContext(canvas, height = 220) {
    const ratio = devicePixelRatio || 1, width = canvas.clientWidth || 560; height = canvas.clientHeight || height;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d'); context.scale(ratio, ratio); return { context, width, height };
  }
  function exerciseNotes() {
    if (!state.exercise) return [];
    const music = state.exercise.music;
    return music.interval ? [music.interval.first, music.interval.second] : [music.note];
  }
  function drawMusicViews(reveal = state.activity !== 'ear') {
    drawScore(reveal); drawRoll(reveal);
  }
  function drawScore(reveal) {
    const concealed = Boolean(state.exercise && !reveal);
    els.lab_score.hidden = concealed; els.lab_score_curtain.hidden = !concealed;
    if (!state.exercise || !reveal) { els.lab_score.removeAttribute('src'); delete els.lab_score.dataset.firstMidi; delete els.lab_score.dataset.secondMidi; els.lab_score.alt = ''; return; }
    const notes = exerciseNotes();
    const harmonic = state.exercise.listeningMode === 'harmonic';
    const scoreNotes = harmonic ? [...notes].sort((a, b) => a.midi - b.midi) : notes;
    els.lab_score.src = notes.length === 1 ? `voice-lab-assets/notes/note-${notes[0].midi}-1.svg`
      : `voice-lab-assets/intervals/${harmonic ? 'harmonic' : 'melodic'}-${scoreNotes[0].midi}-${scoreNotes[1].midi}-1.svg`;
    els.lab_score.dataset.firstMidi = String(notes[0].midi);
    if (notes[1]) els.lab_score.dataset.secondMidi = String(notes[1].midi); else delete els.lab_score.dataset.secondMidi;
    els.lab_score.alt = `Spartito MuseScore: ${notes.map((note) => note.name).join(' – ')}`;
  }
  function drawRoll(reveal) {
    const { context: ctx, width, height } = canvasContext(els.lab_roll), notes = exerciseNotes(); ctx.fillStyle = '#08171c'; ctx.fillRect(0, 0, width, height);
    const targets = notes.length ? notes.map((note) => note.midi) : [60];
    const pitchWindow = state.frames;
    const recentVoiced = pitchWindow.filter((frame) => Number.isFinite(frame.displayPitch) && frame.confidence >= .3).map((frame) => frame.displayPitch);
    const visiblePitches = [...targets, ...recentVoiced], low = Math.min(...visiblePitches), high = Math.max(...visiblePitches), span = Math.max(8, high - low + 4), desired = { min: (low + high) / 2 - span / 2, max: (low + high) / 2 + span / 2 };
    if (!state.rollBounds) state.rollBounds = desired;
    else { const alpha = .14; state.rollBounds.min += (desired.min - state.rollBounds.min) * alpha; state.rollBounds.max += (desired.max - state.rollBounds.max) * alpha; }
    const { min: minMidi, max: maxMidi } = state.rollBounds;
    const yAt = (midi) => 16 + (maxMidi - midi) / Math.max(1, maxMidi - minMidi) * (height - 32), duration = state.exercise?.durationSeconds || 30;
    for (let midi = Math.ceil(minMidi); midi <= maxMidi; midi += 1) { const y = yAt(midi); ctx.strokeStyle = midi % 12 === 0 ? '#315059' : '#173139'; ctx.beginPath(); ctx.moveTo(38, y); ctx.lineTo(width, y); ctx.stroke(); ctx.fillStyle = '#789399'; ctx.font = '11px system-ui'; ctx.fillText(Core.midiToName(midi), 3, y + 4); }
    const nowX = Math.max(90, width * .375), elapsed = state.recording ? (performance.now() - state.startedAt) / 1000 : state.elapsedSeconds, historyWidth = nowX - 42;
    if (state.exercise && reveal) {
      ctx.fillStyle = '#d29b52'; if (notes.length === 1) ctx.fillRect(42, yAt(notes[0].midi) - 7, width - 54, 14);
      else { const split = width / 2; ctx.fillRect(42, yAt(notes[0].midi) - 7, split - 44, 14); ctx.fillRect(split, yAt(notes[1].midi) - 7, width - split - 12, 14); }
    }
    const voiced = state.frames.filter((frame) => Number.isFinite(frame.displayPitch) && frame.confidence >= .3);
    const visibleDuration = Math.max(.5, elapsed);
    const xAtFrame = (frame) => 42 + frame.time / visibleDuration * historyWidth;
    PitchShared.drawConfidencePlume(ctx, state.frames, xAtFrame, yAt, minMidi, maxMidi, { ...state.plumeSettings, nowX, trailStartX: 42, currentTime: elapsed, sortedTimeline: true, mode: state.recording ? 'live' : 'review' });
    ctx.strokeStyle = '#8ee0d8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(nowX, 0); ctx.lineTo(nowX, height); ctx.stroke(); ctx.fillStyle = '#8ee0d8'; ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('ORA', nowX, 14); ctx.textAlign = 'left';
    const latest = voiced.at(-1);
    if (latest && elapsed - latest.time < .2) { const midi = latest.displayPitch, y = yAt(midi), target = targets[0], cents = Math.round((midi - target) * 100); ctx.fillStyle = '#e8a5e8'; ctx.font = '700 12px system-ui'; ctx.fillText(`${Core.midiToName(Math.round(midi))}  ${cents > 0 ? '+' : ''}${cents}¢`, nowX + 12, Math.max(28, Math.min(height - 10, y + 4))); }
  }
  function audioContext() { return state.audio ??= new (window.AudioContext || window.webkitAudioContext)(); }
  async function loadVoiceSample() {
    if (state.voiceBuffer) return state.voiceBuffer;
    const response = await fetch('voice-lab-assets/choir-voice-c4.wav');
    if (!response.ok) throw new Error('Campione vocale non disponibile');
    state.voiceBuffer = await audioContext().decodeAudioData(await response.arrayBuffer()); return state.voiceBuffer;
  }
  function playTone(note, at, duration = .8, gainValue = .2) {
    if (!state.voiceBuffer) throw new Error('Campione vocale non ancora pronto');
    const context = audioContext(), source = context.createBufferSource(), gain = context.createGain();
    source.buffer = state.voiceBuffer; source.playbackRate.value = 2 ** ((note.midi - 60) / 12); source.loop = true;
    source.loopStart = Math.min(.35, state.voiceBuffer.duration / 4); source.loopEnd = Math.max(source.loopStart + .2, state.voiceBuffer.duration - .45);
    gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(gainValue, at + .06); gain.gain.setValueAtTime(gainValue, at + Math.max(.08, duration - .1)); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(gain).connect(context.destination); source.start(at, .18); source.stop(at + duration + .02); return { source, gain };
  }
  function stopReference() { if (state.reference) { try { state.reference.source.stop(); } catch (_) {} state.reference = null; } clearTimeout(state.referenceTimer); state.referenceTimer = null; if (els.lab_listen) els.lab_listen.textContent = '▶'; }
  async function listen() {
    if (!state.exercise) return;
    if (state.reference) { stopReference(); return; }
    const context = audioContext(); await context.resume(); try { await loadVoiceSample(); } catch (error) { els.lab_note.textContent = error.message; return; } const now = context.currentTime + .03, music = state.exercise.music;
    if (music.interval) {
      if (state.exercise.listeningMode === 'construction') playTone(music.interval.first, now, 1.1, .12);
      else if (state.exercise.listeningMode === 'harmonic') { playTone(music.interval.first, now, 1.1, .1); playTone(music.interval.second, now, 1.1, .1); }
      else { playTone(music.interval.first, now, .72); playTone(music.interval.second, now + .88, .72); }
    } else if (state.exercise.listeningMode === 'continuous') {
      state.reference = playTone(music.note, now, 30, .16); els.lab_listen.textContent = '■'; els.lab_countdown.textContent = '30.0'; const started = performance.now();
      const update = () => { if (!state.reference) return; const remaining = Math.max(0, 30 - (performance.now() - started) / 1000); els.lab_countdown.textContent = remaining.toFixed(1); if (remaining > 0) requestAnimationFrame(update); }; update(); state.referenceTimer = setTimeout(stopReference, 30050);
    } else {
      playTone(music.note, now, 1.35, .16); els.lab_countdown.textContent = 'ASCOLTA';
      setTimeout(() => { if (!state.recording && state.exercise?.listeningMode !== 'continuous') els.lab_countdown.textContent = '—'; }, 1400);
    }
  }
  function configMarkup() {
    if (state.activity === 'sustain') return '<label>Durata <select id="lab-duration"><option>2</option><option>4</option><option>6</option></select> s</label><label><input id="lab-auto-next" type="checkbox" /> Nuova altezza dopo il risultato</label>';
    if (state.activity === 'repeat') return '<span class="lab-loop-label">Riferimento · 30 secondi</span>';
    if (state.activity === 'ear') return '<label>Livello <select id="lab-ear-level"><option value="1">1 · Direzione</option><option value="2">2 · Intervalli di riferimento</option><option value="3">3 · Maggiore e minore</option><option value="4">4 · Direzione indipendente</option><option value="5">5 · Armonico</option></select></label>';
    return '<label>Modalità <select id="lab-sing-mode"><option value="imitation">Imitazione guidata</option><option value="memory">Memoria breve</option><option value="construction">Costruzione</option></select></label><label>Difficoltà <select id="lab-sing-level"><option value="1">Intervalli base</option><option value="2">Maggiore e minore</option><option value="3">Completo</option></select></label>';
  }
  function renderActivity() {
    cancelPendingAdvance();
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
    clearCountIn();
    cancelPendingAdvance(); stopReference(); stopCapture(true); state.rollBounds = null; els.lab_feedback.hidden = true; els.lab_answer.hidden = true;
    state.frames = []; state.elapsedSeconds = 0;
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
    oscillator.start(at); oscillator.stop(at + .085); return oscillator;
  }
  function clearCountIn() {
    state.countInTimers.forEach(clearTimeout); state.countInTimers = [];
    state.metronomeSources.forEach((source) => { try { source.stop(); } catch (_) {} }); state.metronomeSources = [];
    state.countingIn = false;
  }
  function startIntervalCountIn(generation, beginTake) {
    const { countInBeats, bpm } = Core.INTERVAL_TIMING, beatMilliseconds = 60000 / bpm;
    const context = audioContext(), audioStart = context.currentTime + .04; state.countingIn = true;
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
      state.countInTimers = []; state.metronomeSources = []; state.countingIn = false; beginTake();
    }, countInBeats * beatMilliseconds));
  }
  async function startCapture() {
    if (!state.exercise || state.recording) return;
    const requestedExercise = state.exercise;
    els.lab_record.disabled = true;
    try { await Promise.all([ensureMicrophone(), loadVoiceSample()]); } catch (error) { els.lab_note.textContent = error.message; return; }
    finally { els.lab_record.disabled = !state.exercise; }
    if (state.exercise !== requestedExercise || state.recording) return;
    const generation = ++state.generation, duration = state.exercise.durationSeconds; state.frames = []; state.elapsedSeconds = 0; state.autoCompleting = false; state.recording = true; state.startedAt = performance.now();
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl); state.audioUrl = null; els.lab_play_take.disabled = true;
    els.lab_record.disabled = false; els.lab_record.textContent = 'Disattiva'; els.lab_new.disabled = true; els.lab_feedback.hidden = true; els.lab_state.textContent = 'IN ASCOLTO';
    const beginTake = () => {
      if (!state.recording || generation !== state.generation) return;
      state.startedAt = performance.now(); els.lab_record.textContent = 'Disattiva';
      if (window.MediaRecorder) {
        state.chunks = []; const recorder = new MediaRecorder(state.stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined); state.mediaRecorder = recorder;
        recorder.ondataavailable = (event) => { if (event.data.size) state.chunks.push(event.data); };
        recorder.onstop = () => { if (!state.chunks.length) return; state.audioUrl = URL.createObjectURL(new Blob(state.chunks, { type: recorder.mimeType || 'audio/webm' })); els.lab_play_take.disabled = false; };
        recorder.start(250);
      }
      if (state.exercise.listeningMode === 'continuous' && !state.reference) { const now = audioContext().currentTime + .02; state.reference = playTone(state.exercise.music.note, now, duration, .07); }
      const buffer = new Float32Array(state.analyser.fftSize), smoother = new PitchSmoother(); smoother.configure(state.detectorSettings);
      const tick = () => {
        if (!state.recording || state.countingIn || generation !== state.generation) return;
        state.analyser.getFloatTimeDomainData(buffer); const raw = detectPitch(buffer, audioContext().sampleRate, state.detectorSettings), estimate = smoother.update(raw, performance.now()); const elapsed = (performance.now() - state.startedAt) / 1000; state.elapsedSeconds = elapsed;
        state.frames.push({ time: elapsed, hz: estimate.hz, displayPitch: Number.isFinite(estimate.displayHz) ? 69 + 12 * Math.log2(estimate.displayHz / 440) : null, confidence: estimate.confidence ?? 0, clarity: estimate.clarity ?? 0, confirmationState: estimate.accepted ? 'confirmed' : 'provisional' });
        els.lab_level.value = raw.rms || 0; els.lab_countdown.textContent = Math.max(0, duration - elapsed).toFixed(1); drawRoll(true);
        if (state.exercise.type === 'sing-interval') {
          els.lab_state.textContent = elapsed < duration / 2 ? 'CANTA · PRIMA NOTA' : 'CAMBIA · SECONDA NOTA';
          setPhase(elapsed < duration / 2 ? 'Canta la prima nota' : 'Ora la seconda nota', elapsed / duration);
        } else setPhase(soloStartedAt == null ? 'Segui la nota' : 'Ora continua da solo', soloStartedAt == null ? 0 : (elapsed - soloStartedAt) / Core.INTERVAL_TIMING.soloSeconds);
        const progress = state.exercise.type === 'repeat' ? Core.evaluatePitchProgress(state.exercise.music.note, state.frames, elapsed) : null;
        if (progress?.completed && soloStartedAt == null) { soloStartedAt = elapsed; stopReference(); syncStart(); }
        if (soloStartedAt != null && elapsed - soloStartedAt >= Core.INTERVAL_TIMING.soloSeconds) {
          finishCapture(generation, progress?.completed ? progress.status : 'solo-practice'); syncStart(); setPhase(progress?.completed ? 'Nota stabilizzata' : 'Prova conclusa'); return;
        }
        if (progress?.status === 'acquired' || progress?.status === 'stabilizing') els.lab_state.textContent = 'STABILIZZA';
        else if (progress?.status === 'searching') els.lab_state.textContent = 'CERCA LA NOTA';
        if (elapsed >= duration) finishCapture(generation, 'timeout'); else requestAnimationFrame(tick);
      }; requestAnimationFrame(tick);
    };
    startIntervalCountIn(generation, beginTake); syncStart();
  }
  async function startExercise() {
    if (preparing || state.countingIn || state.recording) {
      preparationId += 1; preparing = false; stopCapture(true); clearCountIn(); stopReference(); syncStart(); setPhase('Premi ▶ per riprovare'); return;
    }
    cancelPendingAdvance(); soloStartedAt = null;
    const token = ++preparationId; preparing = true; syncStart();
    try {
      await loadVoiceSample(); await audioContext().resume();
      if (token !== preparationId) return;
      if (state.activity !== 'ear') await ensureMicrophone();
      if (token !== preparationId) return;
      if (state.activity === 'ear') {
        const beat = 60 / Core.INTERVAL_TIMING.bpm;
        for (let index = 0; index < Core.INTERVAL_TIMING.countInBeats; index += 1) {
          setPhase(`Preparati · ${index + 1} / 2`, (index + 1) / 2);
          state.metronomeSources.push(metronomeClick(audioContext().currentTime + .02, index === 0));
          await new Promise(resolve => setTimeout(resolve, beat * 1000));
          if (token !== preparationId) return;
        }
      }
      setPhase('Ascolta il modello');
      const now = audioContext().currentTime + .03, music = state.exercise.music;
      if (music.interval) {
        state.metronomeSources.push(playTone(music.interval.first, now, .8).source);
        if (state.exercise.listeningMode !== 'construction') state.metronomeSources.push(playTone(music.interval.second, now + .95, .8).source);
      } else state.metronomeSources.push(playTone(music.note, now, 1.1).source);
      await new Promise(resolve => setTimeout(resolve, music.interval ? 1850 : 1200));
      if (token !== preparationId) return;
      preparing = false;
      if (state.activity === 'ear') { setPhase('La seconda nota è…'); syncStart(); }
      else await startCapture();
    } catch (error) { if (token === preparationId) { preparing = false; setPhase(error.message); syncStart(); } }
  }
  function stopCapture(cancelled = false) { if (!state.recording) return; clearCountIn(); state.recording = false; state.generation += 1; if (state.mediaRecorder?.state === 'recording') { if (cancelled) state.mediaRecorder.onstop = null; state.mediaRecorder.stop(); } if (cancelled) state.chunks = []; els.lab_record.disabled = !state.exercise; els.lab_record.textContent = 'Microfono'; els.lab_new.disabled = false; els.lab_level.value = 0; if (cancelled) { els.lab_state.textContent = 'PRONTO'; if (!state.reference) els.lab_countdown.textContent = '—'; } drawRoll(true); }
  function finishCapture(generation, completionReason = 'manual') {
    if (!state.recording || generation !== state.generation) return; state.recording = false; if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop(); els.lab_record.disabled = false; els.lab_record.textContent = 'Microfono'; els.lab_new.disabled = false; els.lab_level.value = 0; els.lab_state.textContent = 'COMPLETATO';
    stopReference();
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
  document.querySelectorAll('[data-activity]').forEach((button) => button.addEventListener('click', () => { stopCapture(true); state.guidedSession = null; els.lab_guided.textContent = 'Allenamento di oggi'; document.querySelectorAll('[data-activity]').forEach((b) => b.classList.toggle('active', b === button)); state.activity = button.dataset.activity; renderActivity(); newExercise(false); }));
  els.lab_guided.addEventListener('click', () => { stopCapture(true); startGuidedSession().catch((error) => { els.lab_guided.disabled = false; els.lab_guided.textContent = 'Allenamento di oggi'; els.lab_note.textContent = error.message; }); });
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
