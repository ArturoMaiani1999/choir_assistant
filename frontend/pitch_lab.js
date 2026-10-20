(() => {
  'use strict';

  const Core = () => window.PitchLabCore;
  const $ = id => document.getElementById(id);
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const colors = ['#79ded2', '#78a9ed', '#d68ad6', '#ef9d68', '#94d884', '#d7b36a'];
  const state = { context: null, pcm: null, sampleRate: 0, audioHash: null, pitchDocument: null, liveFrames: [], targets: [],
    results: [], worker: null, workerReject: null, requestId: 0, selectedTime: 0, visible: new Set(['target', 'live']), acousticTruth: [], tuning: null,
    view: { zoom: 1, center: 0 }, drag: null, geometry: null, activeProblemFilter: 'all' };

  const parameterGroups = [
    ['Analisi', [
      ['frameLength', 'Frame length', 'select', [2048, 4096, 8192], 'Campioni per finestra. Più lungo migliora le basse frequenze ma sfoca gli attacchi.'],
      ['hopLength', 'Hop length', 'select', [256, 512, 1024], 'Campioni tra due stime. Più piccolo aumenta risoluzione temporale e costo CPU.'],
      ['analysisSampleRate', 'Sample rate analisi', 'select', [12000, 16000, 22050, 24000, 32000, 44100, 48000], 'Il PCM viene ricampionato localmente. 16 kHz è il compromesso CPU predefinito del Lab.'],
      ['fmin', 'F0 minima (Hz)', 'number', [40, 500, 1], 'Limite inferiore della ricerca. Nel live di produzione è 70 Hz.'],
      ['fmax', 'F0 massima (Hz)', 'number', [100, 4000, 1], 'Limite superiore della ricerca. Nel live di produzione è 1000 Hz.'],
      ['removeDc', 'Rimuovi componente continua', 'checkbox', null, 'Sottrae la media del frame, come il detector live. librosa.pyin non lo fa implicitamente.'],
      ['discontinuityCents', 'Soglia discontinuità (cent)', 'number', [50, 2400, 10], 'Scarto minimo tra frame adiacenti conteggiato come discontinuità nelle metriche.'],
      ['disagreementCents', 'Soglia disaccordo (cent)', 'number', [10, 2400, 10], 'Scarto minimo tra detector per evidenziare un segmento di disaccordo.'],
    ]],
    ['Estimatore YIN', [
      ['yinThreshold', 'YIN threshold', 'number', [.01, .99, .01], 'Primo minimo CMND sotto soglia. Valori alti ammettono minimi meno profondi.'],
      ['rmsThreshold', 'RMS threshold', 'number', [0, .1, .000001], 'Gate energetico prima del calcolo YIN.'],
      ['levelConfidenceFloor', 'Confidence floor', 'number', [0, 1, .01], 'Limite inferiore del fattore di livello usato nella confidence live.'],
    ]],
    ['Gate e tracker YIN', [
      ['tracking', 'Tracker temporale', 'checkbox', null, 'Disattivandolo, la traccia tracked coincide con il raw.'],
      ['minClarity', 'Clarity minima', 'number', [0, 1, .01], 'Gate sulla periodicità 1 − CMND.'],
      ['minConfidence', 'Confidence minima', 'number', [0, 1, .01], 'Gate combinato periodicità/livello. Zero lo disattiva.'],
      ['warmupFrames', 'Frame di warm-up', 'number', [1, 12, 1], 'Conferme coerenti prima di pubblicare una nuova nota.'],
      ['smallJumpCents', 'Soglia salto grande (cent)', 'number', [50, 1200, 10], 'Oltre questo scarto si attiva la conferma temporale.'],
      ['largeJumpConfirmFrames', 'Conferma salto grande', 'number', [1, 12, 1], 'Frame coerenti richiesti per un salto non d’ottava.'],
      ['octaveConfirmFrames', 'Conferma ottava', 'number', [1, 16, 1], 'Frame coerenti richiesti per un possibile errore d’ottava.'],
      ['releaseFrames', 'Release frame', 'number', [1, 12, 1], 'Frame non affidabili prima di azzerare lo stato interno.'],
      ['weakSignalHoldFrames', 'Hold segnale debole', 'number', [0, 12, 1], 'Frame per cui mantenere la F0 precedente su segnale debole.'],
      ['medianWindowFrames', 'Finestra mediana', 'number', [1, 15, 1], 'Dimensione della mediana sui pitch raw, in frame.'],
      ['fastAlpha', 'EMA alpha iniziale', 'number', [.01, 1, .01], 'Reattività EMA nei primi frame della nota.'],
      ['slowAlpha', 'EMA alpha stabile', 'number', [.01, 1, .01], 'Reattività EMA dopo l’aggancio.'],
    ]],
    ['pYIN', [
      ['decoder', 'Decoder', 'select', ['normalized-grid', 'legacy-sparse'], 'Griglia V/UV normalizzata oppure decoder originale per riprodurre i dropout.'],
      ['minVoicedProbability', 'Gate probabilità voce', 'number', [0, .9, .01], 'Zero disattiva il gate. Sperimentale: esclude emissioni voiced sotto soglia, conservando i candidati diagnostici.'],
      ['nThresholds', 'Numero soglie', 'number', [10, 400, 10], 'Discretizzazione della distribuzione probabilistica delle soglie.'],
      ['betaAlpha', 'Beta α', 'number', [.1, 30, .1], 'Primo parametro della prior Beta sulle soglie CMND.'],
      ['betaBeta', 'Beta β', 'number', [.1, 60, .1], 'Secondo parametro della prior Beta sulle soglie CMND.'],
      ['boltzmannParameter', 'Boltzmann', 'number', [.1, 10, .1], 'Prior sul rango dei trough: più alto favorisce periodi più piccoli.'],
      ['resolution', 'Risoluzione (semitono)', 'number', [.01, .5, .01], 'Ampiezza dei bin di pitch; 0,1 equivale a 10 cent.'],
      ['maxTransitionRate', 'Transizione max (ottave/s)', 'number', [.1, 80, .1], 'Velocità massima ammessa dal modello temporale.'],
      ['switchProb', 'Probabilità switch V/UV', 'number', [.0001, .5, .001], 'Probabilità per frame di cambiare stato voiced/unvoiced.'],
      ['noTroughProb', 'Probabilità senza trough', 'number', [0, .5, .001], 'Massa residuale assegnata al minimo globale quando nessun trough supera la soglia.'],
    ]],
  ];

  function api(path) {
    return window.ChoirAuthFetch(path, { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `HTTP ${response.status}`);
      return response;
    });
  }

  function formatTime(seconds) {
    const value = Math.max(0, Number(seconds) || 0); const minutes = Math.floor(value / 60);
    return `${String(minutes).padStart(2, '0')}:${(value % 60).toFixed(3).padStart(6, '0')}`;
  }

  function number(value, digits = 2, suffix = '') { return Number.isFinite(value) ? `${Number(value).toFixed(digits)}${suffix}` : 'non disponibile'; }

  function createParameterForm() {
    const form = $('pitch-lab-parameters'); form.replaceChildren();
    for (const [legendText, definitions] of parameterGroups) {
      const fieldset = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = legendText; fieldset.append(legend);
      for (const [key, labelText, type, range, help] of definitions) {
        const label = document.createElement('label'); label.className = 'pitch-lab-parameter-line'; label.dataset.algorithm = legendText === 'pYIN' ? 'pyin' : 'all';
        const span = document.createElement('span'); span.textContent = labelText; span.title = help;
        let input;
        if (type === 'select') { input = document.createElement('select'); range.forEach(value => input.add(new Option(String(value), String(value)))); }
        else { input = document.createElement('input'); input.type = type; if (range) [input.min, input.max, input.step] = range.map(String); }
        input.id = `pitch-lab-param-${key}`; input.name = key; input.title = help;
        const small = document.createElement('small'); small.textContent = help;
        label.append(span, input, small); fieldset.append(label);
      }
      form.append(fieldset);
    }
  }

  function writeConfig(config) {
    $('pitch-lab-algorithm').value = config.algorithm;
    for (const [, definitions] of parameterGroups) for (const [key, , type] of definitions) {
      const input = $(`pitch-lab-param-${key}`); if (!input) continue;
      if (type === 'checkbox') input.checked = Boolean(config[key]); else input.value = String(config[key]);
    }
    updateParameterVisibility(config.algorithm);
  }

  function readConfig() {
    const base = { ...Core().DEFAULTS };
    for (const [, definitions] of parameterGroups) for (const [key, , type] of definitions) {
      const input = $(`pitch-lab-param-${key}`); if (!input) continue;
      base[key] = type === 'checkbox' ? input.checked : key === 'decoder' ? input.value : Number(input.value);
    }
    base.algorithm = $('pitch-lab-algorithm').value;
    return Core().validateConfig(base);
  }

  function updateParameterVisibility(algorithm) {
    document.querySelectorAll('[data-algorithm="pyin"]').forEach(element => { element.closest('fieldset').hidden = algorithm !== 'pyin'; });
    const yin = algorithm === 'yin';
    [...$('pitch-lab-parameters').querySelectorAll('fieldset')].forEach((fieldset, index) => { if (index === 1 || index === 2) fieldset.hidden = !yin; });
  }

  function initializeControls() {
    createParameterForm();
    const presetSelect = $('pitch-lab-preset'); presetSelect.replaceChildren();
    Object.entries(Core().PRESETS).forEach(([id, value]) => presetSelect.add(new Option(value.label, id)));
    presetSelect.value = 'yin-production'; writeConfig(Core().preset('yin-production'));
    presetSelect.addEventListener('change', () => writeConfig(Core().preset(presetSelect.value)));
    $('pitch-lab-algorithm').addEventListener('change', event => {
      const presetId = event.target.value === 'pyin' ? 'pyin-default' : 'yin-production';
      presetSelect.value = presetId; writeConfig(Core().preset(presetId));
    });
    $('pitch-lab-mode').addEventListener('change', () => { $('pitch-lab-sweep').hidden = $('pitch-lab-mode').value !== 'sweep'; });
    const sweep = $('pitch-lab-sweep-parameter');
    ['yinThreshold', 'minClarity', 'minConfidence', 'rmsThreshold', 'warmupFrames', 'medianWindowFrames', 'slowAlpha', 'nThresholds', 'resolution', 'switchProb']
      .forEach(key => sweep.add(new Option(key, key)));
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('epistrophe-pitch-lab', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('analyses');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }

  async function cached(key) {
    try { const db = await openDatabase(); return await new Promise((resolve, reject) => { const request = db.transaction('analyses').objectStore('analyses').get(key); request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error); }); }
    catch (_) { return null; }
  }

  async function cache(key, result) {
    try { const db = await openDatabase(); await new Promise((resolve, reject) => { const request = db.transaction('analyses', 'readwrite').objectStore('analyses').put(result, key); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); }
    catch (_) { /* Cache locale opzionale. */ }
  }

  async function decodeAudio(url) {
    const response = await api(url); const encoded = await response.arrayBuffer();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext; const context = new AudioContextClass();
    try {
      const decoded = await context.decodeAudioData(encoded.slice(0)); const mono = new Float32Array(decoded.length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const data = decoded.getChannelData(channel); for (let index = 0; index < mono.length; index += 1) mono[index] += data[index] / decoded.numberOfChannels;
      }
      return { pcm: mono, sampleRate: decoded.sampleRate, duration: decoded.duration };
    } finally { void context.close(); }
  }

  async function audioSha256(audio, sampleRate) {
    if (!crypto.subtle?.digest) return `${Core().audioFingerprint(audio, sampleRate)}:${sampleRate}`;
    const digest = await crypto.subtle.digest('SHA-256', audio.buffer);
    const hex = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex}:${sampleRate}:${audio.length}`;
  }

  function buildTimelines() {
    const recording = state.context.recording, document = state.pitchDocument, music = state.context.music;
    const timeAtBeat = beat => recording.audioOffsetMs / 1000 + music.secondsAtBeat(beat) / recording.playbackRate;
    state.liveFrames = (document.samples || []).map(sample => {
      const provisional = sample.confirmationState === 'provisional';
      return { timeSec: timeAtBeat(sample.beat), trackedHz: provisional ? null : Core().midiToHz(sample.displayPitch),
        trackedMidi: provisional ? null : sample.displayPitch, provisionalHz: provisional ? Core().midiToHz(sample.displayPitch) : null,
        confidence: sample.confidence ?? null, rejectionReason: provisional ? 'provisional' : null };
    });
    state.targets = (music.targetEvents || []).map(event => ({ startSec: timeAtBeat(event.onsetBeat),
      endSec: timeAtBeat(event.onsetBeat + event.durationBeats), midi: event.midiPitch + Number(recording.transpose || 0), lyric: event.lyric || '' }))
      .sort((a, b) => a.startSec - b.startSec);
  }

  async function loadRecording() {
    const recording = state.context.recording;
    $('pitch-lab-status').textContent = 'Decodifica locale dell’audio…';
    const [decoded, pitchResponse] = await Promise.all([decodeAudio(recording.audioUrl), api(recording.pitchUrl)]);
    state.pitchDocument = await pitchResponse.json(); state.pcm = decoded.pcm; state.sampleRate = decoded.sampleRate;
    state.audioHash = await audioSha256(state.pcm, state.sampleRate); buildTimelines();
    const audio = $('pitch-lab-audio'); audio.src = recording.audioUrl; $('pitch-lab-scrub').max = String(decoded.duration);
    state.view = { zoom: 1, center: decoded.duration / 2 }; state.selectedTime = recording.audioOffsetMs / 1000;
    $('pitch-lab-status').textContent = `${number(decoded.duration, 1, ' s')} · ${decoded.sampleRate} Hz · audio autorizzato`;
    renderAll();
  }

  function cacheKey(config) { return `${state.audioHash}:${Core().ALGORITHM_VERSION}:${Core().configHash(config)}`; }

  function runWorkerRequest(payload, expectedType) {
    return new Promise((resolve, reject) => {
      const requestId = ++state.requestId; const worker = new Worker('pitch_lab_worker.js'); state.worker = worker;
      state.workerReject = reject;
      $('pitch-lab-progress').hidden = false; $('pitch-lab-cancel').hidden = false; $('pitch-lab-run').disabled = true;
      worker.onmessage = event => {
        if (event.data.requestId !== requestId) return;
        if (event.data.type === 'progress') {
          $('pitch-lab-progress').value = event.data.value;
          const phase = event.data.phase === 'shared-cmnd' ? 'CMND condivisa' : event.data.phase === 'pyin-viterbi' ? 'Decoding Viterbi' : 'Inferenza';
          $('pitch-lab-status').textContent = `${phase} ${Math.round(event.data.value * 100)}%`;
        } else if (event.data.type === expectedType) { const value = expectedType === 'batch-result' ? event.data.batch : event.data.result; finishWorker(); resolve(value); }
        else if (event.data.type === 'error') { finishWorker(); reject(new Error(event.data.error)); }
      };
      worker.onerror = event => { finishWorker(); reject(new Error(event.message || 'Worker non disponibile')); };
      const copy = state.pcm.slice(); worker.postMessage({ ...payload, requestId, audioBuffer: copy.buffer, sampleRate: state.sampleRate,
        metadata: { audioHash: state.audioHash, durationSec: state.pcm.length / state.sampleRate, targets: state.targets } }, [copy.buffer]);
    });
  }

  function runWorker(config) { return runWorkerRequest({ type: 'analyze', config }, 'result'); }
  function runWorkerBatch(configs) { return runWorkerRequest({ type: 'analyze-batch', configs }, 'batch-result'); }

  function finishWorker() {
    state.worker?.terminate(); state.worker = null; state.workerReject = null; $('pitch-lab-progress').hidden = true; $('pitch-lab-cancel').hidden = true; $('pitch-lab-run').disabled = false;
  }

  function cancelWorker() {
    const reject = state.workerReject;
    finishWorker();
    reject?.(new Error('Analisi interrotta'));
  }

  function appendExperiment(config, label, result) {
    result.metrics = Core().metrics(result, state.targets, config, state.acousticTruth);
    const entry = { id: `${Date.now()}-${state.results.length}`, label, color: colors[state.results.length % colors.length], result };
    state.results.push(entry); state.visible.add(`${entry.id}:tracked`); if (config.algorithm === 'yin') state.visible.add(`${entry.id}:raw`);
    return entry;
  }

  async function oneExperiment(config, label) {
    const key = cacheKey(config); let result = await cached(key);
    if (result) $('pitch-lab-status').textContent = 'Risultato recuperato dalla cache locale.';
    else { result = await runWorker(config); await cache(key, result); }
    return appendExperiment(config, label, result);
  }

  async function sweepExperiments(base, key, values) {
    const preset = Core().PRESETS[$('pitch-lab-preset').value].label;
    const plans = values.map(value => { const config = Core().validateConfig({ ...base, [key]: value });
      return { config, key: cacheKey(config), label: `${preset} · ${key}=${value}`, result: null }; });
    const cachedResults = await Promise.all(plans.map(plan => cached(plan.key)));
    plans.forEach((plan, index) => { plan.result = cachedResults[index]; });
    const missing = plans.filter(plan => !plan.result);
    if (missing.length) {
      const batch = await runWorkerBatch(missing.map(plan => plan.config));
      for (let index = 0; index < missing.length; index += 1) {
        missing[index].result = batch.results[index]; await cache(missing[index].key, missing[index].result);
      }
      plans.forEach(plan => appendExperiment(plan.config, plan.label, plan.result));
      return `CMND calcolata una volta su ${batch.performance.cmndFrameCount} frame e riusata per ${missing.length} configurazioni.`;
    }
    plans.forEach(plan => appendExperiment(plan.config, plan.label, plan.result));
    return 'Sweep recuperato interamente dalla cache locale.';
  }

  async function run() {
    if (!state.pcm || state.worker) return;
    try {
      const base = readConfig(), mode = $('pitch-lab-mode').value; let runSummary = '';
      if (mode === 'tune') {
        const batch = await runWorkerRequest({ type: 'tune', config: base, acousticTruth: state.acousticTruth }, 'batch-result');
        state.tuning = { ...batch.tuning, audioHash: state.audioHash, createdAt: new Date().toISOString(), performance: batch.performance };
        batch.results.forEach((result, index) => {
          const entry = appendExperiment(result.config,
            `T${index + 1} · ${result.config.decoder === 'legacy-sparse' && base.algorithm === 'pyin' ? 'Originale' : 'Candidato'}${batch.tuning.selectedIndex === index ? ' · selezionato*' : ''}`, result);
          if (index > 1 && index !== batch.tuning.selectedIndex) { state.visible.delete(`${entry.id}:tracked`); state.visible.delete(`${entry.id}:raw`); }
        });
        runSummary = batch.tuning.note;
      } else if (mode === 'sweep') {
        const key = $('pitch-lab-sweep-parameter').value;
        const values = [...new Set($('pitch-lab-sweep-values').value.split(',').map(value => Number(value.trim())).filter(Number.isFinite))];
        if (!values.length || values.length > 6) throw new Error('Inserisci da 1 a 6 valori validi per lo sweep.');
        runSummary = await sweepExperiments(base, key, values);
      } else {
        const prefix = mode === 'ab' && state.results.length ? 'B' : mode === 'ab' ? 'A' : `E${state.results.length + 1}`;
        await oneExperiment(base, `${prefix} · ${Core().PRESETS[$('pitch-lab-preset').value].label}`);
      }
      $('pitch-lab-status').textContent = `${state.results.length} esperimenti disponibili · ${runSummary || 'ultimo risultato riproducibile dalla configurazione salvata.'}`;
      renderAll();
    } catch (error) { $('pitch-lab-status').textContent = error.message === 'Analisi interrotta' ? 'Analisi interrotta. I risultati precedenti restano disponibili.' : `Analisi non riuscita: ${error.message}`; finishWorker(); }
  }

  function visibleRange() {
    const duration = state.pcm ? state.pcm.length / state.sampleRate : 1; const zoom = clamp(state.view.zoom, 1, 80); const span = duration / zoom;
    const center = clamp(state.view.center, span / 2, Math.max(span / 2, duration - span / 2));
    return { duration, span, start: center - span / 2, end: center + span / 2, center };
  }

  function drawLine(context, geometry, frames, valueKey, color, uncertain = false) {
    context.save(); context.beginPath(); context.rect(geometry.plot.left, geometry.plot.top, geometry.plot.right - geometry.plot.left, geometry.plot.bottom - geometry.plot.top); context.clip();
    context.strokeStyle = color; context.lineWidth = uncertain ? 1.25 : 2.2; context.globalAlpha = uncertain ? .55 : .9;
    if (uncertain) context.setLineDash([3, 4]);
    let previous = null;
    for (const frame of frames) {
      const midi = valueKey === 'live' ? frame.trackedMidi : Core().hzToMidi(frame[valueKey]);
      if (!Number.isFinite(midi) || frame.timeSec < geometry.viewStart || frame.timeSec > geometry.viewEnd) { previous = null; continue; }
      const point = { x: geometry.xAtBeat(frame.timeSec), y: geometry.yAtPitch(midi), timeSec: frame.timeSec, midi };
      if (!previous || frame.timeSec - previous.timeSec > .14 || Math.abs(midi - previous.midi) > 8) {
        context.fillStyle = color; context.fillRect(point.x - 1, point.y - 1, 2, 2);
        context.beginPath(); context.moveTo(point.x, point.y);
      }
      else { context.lineTo(point.x, point.y); context.stroke(); context.beginPath(); context.moveTo(point.x, point.y); }
      previous = point;
    }
    context.restore(); context.globalAlpha = 1; context.setLineDash([]);
  }

  function draw() {
    const canvas = $('pitch-lab-canvas'), rect = canvas.getBoundingClientRect(); if (!state.pcm || rect.width < 10 || !window.PianoRoll) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), width = rect.width, height = rect.height; canvas.width = width * dpr; canvas.height = height * dpr;
    const context = canvas.getContext('2d'); context.setTransform(dpr, 0, 0, dpr, 0, 0); context.fillStyle = '#061116'; context.fillRect(0, 0, width, height);
    const range = visibleRange(); state.view.center = range.center; $('pitch-lab-zoom').textContent = `${Math.round(state.view.zoom * 100)}%`;
    const pitches = [...state.targets.map(item => item.midi), ...state.liveFrames.map(item => item.trackedMidi),
      ...state.results.flatMap(item => item.result.frames.flatMap(frame => [Core().hzToMidi(frame.rawHz), Core().hzToMidi(frame.trackedHz)]))].filter(Number.isFinite);
    const bounds = pitches.length ? { min: Math.floor(Math.min(...pitches)) - 2, max: Math.ceil(Math.max(...pitches)) + 2 } : { min: 45, max: 75 };
    const gridLines = []; const labelSpacing = range.span / Math.max(2, Math.floor((width - 68) / 100));
    const step = [.25, .5, 1, 2, 5, 10, 20, 30, 60, 120, 300].find(value => value >= labelSpacing) || 600;
    for (let second = Math.ceil(range.start / step) * step; second <= range.end; second += step) gridLines.push({ beat: second, kind: Number.isInteger(second) ? 'measure' : 'beat', label: formatTime(second) });
    const geometry = window.PianoRoll.drawBase(context, { width, height, plot: { left: 58, right: width - 10, top: 28, bottom: height - 28 }, bounds,
      viewStart: range.start, viewEnd: range.end, gridLines, targetEvents: state.visible.has('target') ? state.targets.map(item => ({ onsetBeat: item.startSec,
        durationBeats: item.endSec - item.startSec, midiPitch: item.midi, lyric: item.lyric })) : [], showPitchLabels: true, compact: width < 700 });
    if (state.visible.has('live')) {
      drawLine(context, geometry, state.liveFrames, 'live', '#dfb465');
      drawLine(context, geometry, state.liveFrames, 'provisionalHz', '#dfb465', true);
    }
    for (const entry of state.results) {
      if (state.visible.has(`${entry.id}:raw`)) drawLine(context, geometry, entry.result.frames, 'rawHz', entry.color, true);
      if (state.visible.has(`${entry.id}:tracked`)) drawLine(context, geometry, entry.result.frames, 'trackedHz', entry.color, false);
    }
    const x = geometry.xAtBeat(state.selectedTime); context.strokeStyle = '#f4eee2'; context.lineWidth = 1; context.setLineDash([5, 4]); context.beginPath(); context.moveTo(x, geometry.plot.top); context.lineTo(x, geometry.plot.bottom); context.stroke(); context.setLineDash([]);
    state.geometry = { ...geometry, beatAtX: localX => range.start + clamp((localX - geometry.plot.left) / Math.max(1, geometry.plot.right - geometry.plot.left), 0, 1) * range.span };
  }

  function renderLayers() {
    const container = $('pitch-lab-layers'); container.replaceChildren();
    const add = (id, label, color) => { const element = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = state.visible.has(id);
      input.addEventListener('change', () => { input.checked ? state.visible.add(id) : state.visible.delete(id); draw(); }); const swatch = document.createElement('i'); swatch.style.setProperty('--layer-color', color); element.append(input, swatch, label); container.append(element); };
    add('target', 'Target MIDI', '#bd8e4c'); add('live', 'Live salvato (display)', '#dfb465');
    state.results.forEach(entry => { add(`${entry.id}:raw`, `${entry.label} · raw`, entry.color); add(`${entry.id}:tracked`, `${entry.label} · ${entry.result.algorithmId.startsWith('pyin') ? 'pYIN' : 'tracked'}`, entry.color); });
  }

  function nearest(frames, time) {
    let result = null, distance = Infinity; for (const frame of frames || []) { const next = Math.abs(frame.timeSec - time); if (next < distance) { result = frame; distance = next; } if (frame.timeSec > time + .2) break; }
    return distance <= .12 ? result : null;
  }

  function targetAtTime(time) { return state.targets.find(target => time >= target.startSec && time < target.endSec) || null; }

  function renderInspector() {
    const target = targetAtTime(state.selectedTime), live = nearest(state.liveFrames, state.selectedTime), latest = state.results.at(-1), frame = nearest(latest?.result.frames, state.selectedTime);
    $('pitch-lab-inspector-title').textContent = formatTime(state.selectedTime);
    const targetHz = target ? Core().midiToHz(target.midi) : null; const error = frame?.trackedHz && targetHz ? Core().centsBetween(frame.trackedHz, targetHz) : null;
    const values = [['Timestamp', `${number(state.selectedTime, 4, ' s')}`], ['Target MIDI', target ? `${number(target.midi, 2)} · ${number(targetHz, 2, ' Hz')}` : 'non disponibile'],
      ['Live salvato', live ? number(live.trackedHz, 2, ' Hz') : 'non disponibile'], ['YIN / pYIN raw', frame ? number(frame.rawHz, 2, ' Hz') : 'non disponibile'],
      ['Tracked', frame ? number(frame.trackedHz, 2, ' Hz') : 'non disponibile'], ['Errore target', number(error, 1, ' ¢')], ['RMS', frame ? number(frame.rms, 6) : 'non disponibile'],
      ['Clarity YIN', frame ? number(frame.clarity, 3) : 'non disponibile'], ['Confidence YIN', frame ? number(frame.confidence, 3) : 'non disponibile'],
      ['Voiced probability pYIN', frame ? number(frame.voicedProbability, 3) : 'non disponibile'], ['Rejection reason', frame?.rejectionReason || 'nessuna / non disponibile'],
      ['Alternativa d’ottava', frame ? number(frame.octaveAlternateHz, 2, ' Hz') : 'non disponibile']];
    const dl = $('pitch-lab-inspector-values'); dl.replaceChildren(); values.forEach(([term, value]) => { const wrapper = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = term; const dd = document.createElement('dd'); dd.textContent = value; wrapper.append(dt, dd); dl.append(wrapper); });
    const detail = $('pitch-lab-candidates');
    detail.textContent = frame?.candidates ? `Candidati: ${frame.candidateCount} · V/UV per frame (p ≥ 0,5): ${frame.frameVoiced ? 'V' : 'UV'} · decoder: ${frame.decoderVoiced ? 'V' : 'UV'}\n`
      + frame.candidates.map(item => `${number(item.hz, 2)} Hz · massa ${number(item.probability, 5)} · CMND ${number(item.cmnd, 4)}`).join('\n')
      : 'Seleziona un frame pYIN. La massa dei candidati non è una confidence calibrata.';
  }

  function renderMetrics() {
    const percent = value => number(value == null ? null : value * 100, 1, '%');
    $('pitch-lab-metrics-body').innerHTML = state.results.map(entry => {
      const metric = entry.result.metrics, acoustic = metric.acousticAccuracy;
      const rejected = Object.entries(metric.rejectionReasons || {}).map(([reason, count]) => `${reason}: ${count}`).join(' · ') || 'nessuno';
      const gapDuration = metric.gaps.reduce((sum, gap) => sum + gap.durationSec, 0);
      return `<tr><td>${escapeHtml(entry.label)}</td><td>${number(metric.audioDurationSec,2,' s')}</td><td>${number(metric.processingMs,0,' ms')}</td><td>${number(metric.realtimeFactor,2)}×</td>`
        + `<td>${number(metric.rawDetectedPercent,1,'%')}</td><td>${number(metric.detectedPercent,1,'%')}</td><td>${metric.gaps.length} · ${number(gapDuration,2,' s')}</td><td title="${escapeHtml(rejected)}">${escapeHtml(rejected)}</td>`
        + `<td>${metric.discontinuities}</td><td>${metric.possibleOctaveJumps}</td><td>${number(metric.targetEvaluableSec,2,' s')} · ${number(metric.targetEvaluablePercent,1,'%')}</td>`
        + `<td>${number(metric.targetMedianAbsoluteCents,0,' ¢')}</td><td>${number(metric.conditionalIntonationPercent,1,'%')}</td><td>${percent(acoustic?.rawPitchAccuracy30)}</td><td>${percent(acoustic?.rawPitchAccuracy50)}</td>`
        + `<td>${percent(acoustic?.rawChromaAccuracy50)}</td><td>${percent(acoustic?.voicingRecall)}</td><td>${percent(acoustic?.voicingFalseAlarmRate)}</td><td>${percent(acoustic?.octaveErrorRate)}</td>`
        + `<td>${number(acoustic?.maeCents,1,' ¢')}</td><td>${percent(acoustic?.overallAccuracy30)}</td>`
        + `<td>${percent(acoustic?.voicingPrecision)}</td><td>${percent(acoustic?.voicingF1)}</td><td>${number(acoustic?.medianAbsoluteCents,1)}</td><td>${number(acoustic?.p95AbsoluteCents,1)}</td>`
        + `<td>${percent(acoustic?.grossPitchErrorRate)}</td><td>${number(acoustic?.dropoutDurationSec,2,' s')}</td><td>${number(acoustic?.referenceCoveragePercent,1,'%')}</td><td>${number(metric.processingMsPerFrame,3,' ms')}</td></tr>`;
    }).join('');
  }

  async function loadGroundTruth(file) {
    if (!file) { state.acousticTruth = []; state.tuning = null;
      state.results.forEach(entry => { entry.result.metrics = Core().metrics(entry.result, state.targets, entry.result.config); }); renderMetrics(); return; }
    const payload = JSON.parse(await file.text()); const input = Array.isArray(payload) ? payload : payload.frames;
    if (payload.audioHash && payload.audioHash !== state.audioHash) throw new Error('Il riferimento appartiene a un altro audio.');
    if (payload.audioSha256 && payload.audioSha256 !== state.audioHash?.split(':')[1]) throw new Error('Il riferimento appartiene a un altro PCM.');
    if (!Array.isArray(input) || !input.length) throw new Error('Ground truth vuoto o non valido.');
    const normalized = input.map((item, index) => {
      const startSec = Number(item.startSec ?? item.timeSec); const nextTime = Number(input[index + 1]?.startSec ?? input[index + 1]?.timeSec);
      const endSec = Number(item.endSec ?? (Number.isFinite(nextTime) ? nextTime : startSec + .05));
      const hz = item.hz == null ? null : Number(item.hz);
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec || (hz != null && !(hz > 0))) throw new Error(`Ground truth non valido alla riga ${index + 1}.`);
      return { ...item, startSec, endSec, ...(Object.prototype.hasOwnProperty.call(item, 'hz') ? { hz } : {}) };
    });
    const reference = Core().normalizeTruth(normalized);
    state.acousticTruth = reference;
    state.tuning = null;
    state.results.forEach(entry => { entry.result.metrics = Core().metrics(entry.result, state.targets, entry.result.config, reference); });
    $('pitch-lab-status').textContent = `Ground truth indipendente caricato: ${normalized.length} intervalli. Le metriche acustiche sono ora abilitate nell’export.`;
    renderMetrics();
  }

  function problemSegments() {
    const entry = state.results.at(-1); if (!entry) return [];
    const frames = entry.result.frames, output = Core().falseNegativeSegments(state.liveFrames, frames, {
      disagreementCents: entry.result.config.disagreementCents,
    });
    const hopSec = entry.result.hopLength / entry.result.analysisSampleRate;
    for (const gap of entry.result.metrics.gaps || []) {
      output.push({
        kind: gap.durationSec <= hopSec * 1.5 ? 'dropout-isolato' : gap.durationSec >= .5 ? 'gap-lungo' : 'gap',
        startSec: gap.startSec, endSec: gap.endSec,
        frameCount: Math.max(1, Math.round(gap.durationSec / hopSec)),
      });
    }
    let current = null;
    for (const frame of frames) {
      let kind = null;
      if (frame.rms >= entry.result.config.rmsThreshold && !Number.isFinite(frame.rawHz)) kind = 'rms-no-f0';
      else if (Number.isFinite(frame.rawHz) && !Number.isFinite(frame.trackedHz)) kind = frame.rejectionReason || 'raw-rejected';
      else if (frame.rejectionReason) kind = frame.rejectionReason;
      if (!kind) { current = null; continue; }
      if (!current || current.kind !== kind || frame.timeSec - current.endSec > .14) { current = { kind, startSec: frame.timeSec, endSec: frame.timeSec, frameCount: 1 }; output.push(current); }
      else { current.endSec = frame.timeSec; current.frameCount += 1; }
    }
    return output.sort((a, b) => a.startSec - b.startSec);
  }

  function renderProblems() {
    const all = problemSegments(), kinds = ['all', ...new Set(all.map(item => item.kind))]; const filters = $('pitch-lab-problem-filters'); filters.replaceChildren();
    kinds.forEach(kind => { const button = document.createElement('button'); button.type = 'button'; button.className = kind === state.activeProblemFilter ? 'is-active' : ''; button.textContent = kind === 'all' ? `Tutti (${all.length})` : `${kind} (${all.filter(item => item.kind === kind).length})`;
      button.addEventListener('click', () => { state.activeProblemFilter = kind; renderProblems(); }); filters.append(button); });
    const selected = state.activeProblemFilter === 'all' ? all : all.filter(item => item.kind === state.activeProblemFilter);
    const list = $('pitch-lab-problem-list'); list.replaceChildren(); selected.slice(0, 60).forEach(segment => { const item = document.createElement('li'); const strong = document.createElement('strong'); strong.textContent = segment.kind; const span = document.createElement('span'); span.textContent = `${formatTime(segment.startSec)} – ${formatTime(segment.endSec)} · ${segment.frameCount} frame`; const button = document.createElement('button'); button.type = 'button'; button.append(strong, span); button.addEventListener('click', () => selectTime((segment.startSec + segment.endSec) / 2, true)); item.append(button); list.append(item); });
  }

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[character])); }

  function renderAll() { renderLayers(); renderInspector(); renderMetrics(); renderProblems(); draw(); }

  function selectTime(time, seek = false) {
    const duration = state.pcm ? state.pcm.length / state.sampleRate : 0; state.selectedTime = clamp(time, 0, duration); $('pitch-lab-scrub').value = String(state.selectedTime);
    if (seek) $('pitch-lab-audio').currentTime = state.selectedTime; renderInspector(); draw();
  }

  function zoomAt(factor, clientX = null) {
    if (!state.pcm) return; const before = visibleRange(); const next = clamp(state.view.zoom * factor, 1, 80); if (next === state.view.zoom) return;
    const rect = $('pitch-lab-canvas').getBoundingClientRect(); const ratio = clientX == null ? .5 : clamp((clientX - rect.left - 58) / Math.max(1, rect.width - 68), 0, 1);
    const anchor = before.start + ratio * before.span; const nextSpan = before.duration / next; state.view.zoom = next; state.view.center = anchor + (.5 - ratio) * nextSpan; draw();
  }

  function exportFile(type) {
    const recording = state.context?.recording; if (!recording) return;
    let blob, extension;
    if (type === 'json') { blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), recording: { id: recording.id, pieceId: recording.pieceId, partId: recording.partId, audioHash: state.audioHash }, algorithmVersion: Core().ALGORITHM_VERSION, acousticTruth: state.acousticTruth, tuning: state.tuning, live: state.liveFrames, targets: state.targets, experiments: state.results }, null, 2)], { type:'application/json' }); extension='json'; }
    else { const rows = [['experiment','algorithm','config_hash','time_sec','raw_hz','tracked_hz','rms','clarity','confidence','voiced_probability','rejection_reason','candidate_count','frame_voiced','decoder_voiced','candidates_json']]; state.results.forEach(entry => entry.result.frames.forEach(frame => rows.push([entry.label,entry.result.algorithmId,entry.result.configHash,frame.timeSec,frame.rawHz??'',frame.trackedHz??'',frame.rms??'',frame.clarity??'',frame.confidence??'',frame.voicedProbability??'',frame.rejectionReason??'',frame.candidateCount??'',frame.frameVoiced??'',frame.decoderVoiced??'',JSON.stringify(frame.candidates??[])]))); blob=new Blob([rows.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\n')],{type:'text/csv'}); extension='csv'; }
    const url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url; link.download=`pitch-lab-${recording.pieceId}-${recording.id}.${extension}`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  async function open(options) {
    if (!options?.recording) throw new Error('La registrazione non è condivisa per l’analisi.');
    state.context = options; state.results = []; state.visible = new Set(['target','live']); state.pcm = null; state.liveFrames = []; state.targets = []; state.acousticTruth = []; state.activeProblemFilter = 'all';
    $('pitch-lab-title').textContent = options.title || 'Pitch Detection Lab'; $('pitch-lab-meta').textContent = `${options.recording.displayName} · ${options.recording.voicePart || options.recording.partId}`;
    state.tuning = null;
    $('pitch-lab-ground-truth').value = '';
    $('pitch-lab').hidden = false; document.body.classList.add('pitch-lab-open'); $('pitch-lab-back').focus();
    try { await loadRecording(); } catch (error) { $('pitch-lab-status').textContent = `Registrazione non disponibile: ${error.message}`; }
  }

  function close() { if (state.worker) cancelWorker(); else finishWorker(); $('pitch-lab-audio').pause(); $('pitch-lab').hidden = true; document.body.classList.remove('pitch-lab-open'); state.context?.onClose?.(); }

  function bind() {
    if (!$('pitch-lab')) return; initializeControls();
    $('pitch-lab-back').addEventListener('click', close); $('pitch-lab-run').addEventListener('click', () => void run());
    $('pitch-lab-cancel').addEventListener('click', cancelWorker);
    $('pitch-lab-export-json').addEventListener('click', () => exportFile('json')); $('pitch-lab-export-csv').addEventListener('click', () => exportFile('csv'));
    $('pitch-lab-ground-truth').addEventListener('change', event => void loadGroundTruth(event.target.files?.[0]).catch(error => { $('pitch-lab-status').textContent = `Ground truth non caricato: ${error.message}`; }));
    const audio = $('pitch-lab-audio'); $('pitch-lab-play').addEventListener('click', () => audio.paused ? void audio.play() : audio.pause());
    audio.addEventListener('play', () => { $('pitch-lab-play').textContent = '❚❚ Pausa'; }); audio.addEventListener('pause', () => { $('pitch-lab-play').textContent = '▶ Riproduci'; });
    audio.addEventListener('timeupdate', () => { if (!audio.seeking) { state.selectedTime = audio.currentTime; $('pitch-lab-time').textContent = formatTime(audio.currentTime); $('pitch-lab-scrub').value = String(audio.currentTime); renderInspector(); draw(); } });
    $('pitch-lab-scrub').addEventListener('input', event => selectTime(Number(event.target.value), true));
    $('pitch-lab-zoom-out').addEventListener('click', () => zoomAt(1/1.5)); $('pitch-lab-zoom-in').addEventListener('click', () => zoomAt(1.5));
    $('pitch-lab-reset-view').addEventListener('click', () => { const duration=state.pcm?state.pcm.length/state.sampleRate:1; state.view={zoom:1,center:duration/2}; draw(); });
    const canvas=$('pitch-lab-canvas'); canvas.addEventListener('wheel', event => { event.preventDefault(); zoomAt(event.deltaY<0?1.18:1/1.18,event.clientX); },{passive:false});
    canvas.addEventListener('pointerdown', event => { canvas.setPointerCapture(event.pointerId); state.drag={x:event.clientX,center:state.view.center,moved:false}; });
    canvas.addEventListener('pointermove', event => { if (!state.drag) return; const range=visibleRange(),delta=event.clientX-state.drag.x;if(Math.abs(delta)>4)state.drag.moved=true;state.view.center=state.drag.center-delta/Math.max(1,canvas.clientWidth)*range.span;draw(); });
    canvas.addEventListener('pointerup', event => { const moved=state.drag?.moved;state.drag=null;if(!moved&&state.geometry){const rect=canvas.getBoundingClientRect();selectTime(state.geometry.beatAtX(event.clientX-rect.left),true);} });
    canvas.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const step = (state.results.at(-1)?.result.hopLength || 512) / (state.results.at(-1)?.result.analysisSampleRate || 16000); selectTime(state.selectedTime + (event.key === 'ArrowRight' ? step : -step), true); } });
    canvas.addEventListener('pointercancel',()=>{state.drag=null;}); new ResizeObserver(draw).observe(canvas);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('pitch-lab').hidden)close();});
  }

  window.PitchLab = Object.freeze({ open, close });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
