(function pianoRollModule(global) {
  'use strict';

  const DEFAULT_TRACE_COLORS = ['#72dfd1', '#70a7e8', '#d98bd8', '#91e6a7', '#e8b15c', '#b994e8', '#e88475', '#75c8e8'];
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  function isAcceptedObservation(sample) {
    return Number.isFinite(sample.beat) && Number.isFinite(sample.displayPitch)
      && sample.confirmationState !== 'provisional' && sample.accepted !== false
      && (!Object.hasOwn(sample, 'trackedPitch') || Number.isFinite(sample.trackedPitch))
      && (!Object.hasOwn(sample, 'confidence') || sample.confidence > 0);
  }

  function roundedRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.roundRect(x, y, width, height, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
  }

  function italianNoteName(pitch) {
    const names = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
    const midi = Math.round(pitch);
    return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  }

  function gridLines(measures, start, end) {
    const lines = [];
    for (const measure of measures || []) {
      if (measure.endBeat < start || measure.startBeat > end) continue;
      lines.push({ beat: measure.startBeat, kind: 'measure', label: `b. ${measure.number}` });
      const duration = Math.max(1, measure.endBeat - measure.startBeat);
      for (let beat = Math.ceil(measure.startBeat + .001); beat < measure.endBeat - .001; beat += 1) {
        lines.push({ beat, kind: 'beat', label: duration > 6 ? String(Math.round(beat - measure.startBeat + 1)) : '' });
      }
    }
    return lines;
  }

  function drawBase(context, options) {
    const {
      width, height, plot, bounds, viewStart, viewEnd, measures = [], targetEvents = [],
      pitchOffset = 0, activeBeat = null, lyricScale = 1, compact = false,
      targetToleranceCents = 50, showPitchLabels = true, noteName = italianNoteName,
    } = options;
    const xAtBeat = beat => plot.left + (beat - viewStart) / Math.max(.001, viewEnd - viewStart) * (plot.right - plot.left);
    const yAtPitch = pitch => plot.bottom - (pitch - bounds.min) / Math.max(.001, bounds.max - bounds.min) * (plot.bottom - plot.top);
    const rowHeight = (plot.bottom - plot.top) / Math.max(1, bounds.max - bounds.min);

    for (let pitch = Math.floor(bounds.min); pitch <= Math.ceil(bounds.max); pitch += 1) {
      const y = yAtPitch(pitch);
      const pitchClass = ((pitch % 12) + 12) % 12;
      const white = [0, 2, 4, 5, 7, 9, 11].includes(pitchClass);
      context.fillStyle = white ? 'rgba(166,198,193,.075)' : 'rgba(2,10,14,.27)';
      context.fillRect(plot.left, y - rowHeight / 2, plot.right - plot.left, rowHeight);
      if (pitchClass === 0 || pitchClass === 5) {
        context.strokeStyle = 'rgba(190,215,211,.25)'; context.lineWidth = 1;
        context.beginPath(); context.moveTo(plot.left, Math.round(y + rowHeight / 2) + .5);
        context.lineTo(plot.right, Math.round(y + rowHeight / 2) + .5); context.stroke();
      }
      if (showPitchLabels && pitch >= bounds.min && pitch <= bounds.max) {
        context.fillStyle = '#93a9a8'; context.font = `${Math.max(8, Math.min(11, rowHeight * .72))}px Inter, sans-serif`;
        context.textAlign = 'right'; context.textBaseline = 'middle'; context.fillText(noteName(pitch), plot.left - 7, y);
      }
    }

    context.save(); context.beginPath(); context.rect(plot.left, 0, plot.right - plot.left, plot.bottom); context.clip();
    for (const line of options.gridLines || gridLines(measures, viewStart, viewEnd)) {
      if (line.beat < viewStart || line.beat > viewEnd || (compact && line.kind === 'subdivision')) continue;
      const x = xAtBeat(line.beat);
      if (line.kind === 'measure') { context.strokeStyle = 'rgba(226,180,101,.48)'; context.lineWidth = 1.4; context.setLineDash([]); }
      else if (line.kind === 'beat') { context.strokeStyle = 'rgba(180,207,203,.25)'; context.lineWidth = 1; context.setLineDash([]); }
      else { context.strokeStyle = 'rgba(180,207,203,.12)'; context.lineWidth = 1; context.setLineDash([2, 4]); }
      context.beginPath(); context.moveTo(Math.round(x) + .5, line.kind === 'subdivision' ? plot.top : 18); context.lineTo(Math.round(x) + .5, plot.bottom); context.stroke();
      if (line.label) {
        context.fillStyle = line.kind === 'measure' ? '#d9ad67' : '#829a99';
        context.font = `${line.kind === 'measure' ? '700 ' : ''}${compact ? 8 : 9}px Inter, sans-serif`;
        context.textAlign = 'left'; context.textBaseline = 'top'; context.fillText(line.label, x + 4, line.kind === 'measure' ? 4 : 19);
      }
    }
    context.restore(); context.setLineDash([]);

    context.save(); context.beginPath(); context.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top); context.clip();
    for (const event of targetEvents) {
      if (event.onsetBeat + event.durationBeats < viewStart || event.onsetBeat > viewEnd) continue;
      const x = xAtBeat(event.onsetBeat), endX = xAtBeat(event.onsetBeat + event.durationBeats);
      const y = yAtPitch(event.midiPitch + pitchOffset), blockHeight = rowHeight;
      const toleranceHeight = rowHeight * (targetToleranceCents / 50);
      context.fillStyle = 'rgba(217,168,91,.10)'; roundedRect(context, x, y - toleranceHeight / 2, endX - x, toleranceHeight, 3); context.fill();
      const active = Number.isFinite(activeBeat) && event.onsetBeat <= activeBeat && activeBeat < event.onsetBeat + event.durationBeats;
      context.fillStyle = active ? '#e4b665' : '#bd8e4c';
      roundedRect(context, x, y - blockHeight / 2, Math.max(2, endX - x - 2), blockHeight, 3); context.fill();
      const grace = Math.max(0, event.attackGraceBeats || 0);
      if (grace) { const graceEnd = xAtBeat(event.onsetBeat + grace); context.fillStyle = 'rgba(7,19,25,.24)'; context.fillRect(x, y - blockHeight / 2, Math.max(0, graceEnd - x), blockHeight); }
      if (event.lyric && endX - x > 18) {
        context.fillStyle = '#d6cbb6'; context.textAlign = 'left'; context.textBaseline = 'bottom';
        context.font = `${(compact ? 9 : 11) * lyricScale}px Georgia, serif`; context.fillText(event.lyric, x + 2, y - blockHeight / 2 - 2);
      }
    }
    context.restore();
    return { xAtBeat, yAtPitch, rowHeight, plot, bounds, viewStart, viewEnd, width, height };
  }

  function stableSegments(samples, maximumGap = .35, maximumJump = 8) {
    const segments = []; let segment = [];
    const close = () => { if (segment.length > 1) segments.push(segment); segment = []; };
    for (const sample of [...samples].sort((a, b) => a.beat - b.beat)) {
      if (!isAcceptedObservation(sample)) { close(); continue; }
      const previous = segment.at(-1);
      if (previous && (sample.beat - previous.beat > maximumGap || Math.abs(sample.displayPitch - previous.displayPitch) > maximumJump)) close();
      segment.push(sample);
    }
    close(); return segments;
  }

  function drawTrace(context, geometry, trace, index, single) {
    const samples = (trace.samples || []).filter(sample => sample.beat >= geometry.viewStart && sample.beat <= geometry.viewEnd);
    const color = trace.color || DEFAULT_TRACE_COLORS[index % DEFAULT_TRACE_COLORS.length];
    context.save(); context.beginPath(); context.rect(geometry.plot.left, geometry.plot.top, geometry.plot.right - geometry.plot.left, geometry.plot.bottom - geometry.plot.top); context.clip();
    context.lineCap = 'round'; context.lineJoin = 'round'; context.globalAlpha = trace.muted ? .18 : (trace.opacity ?? (single ? 1 : .76));
    for (const segment of stableSegments(samples)) {
      for (let point = 1; point < segment.length; point += 1) {
        const previous = segment[point - 1], sample = segment[point];
        const error = Math.abs(Number(sample.errorCents));
        context.strokeStyle = single ? (error > 100 ? '#ef6b5b' : error > 55 ? '#e8b15c' : '#72dfd1') : color;
        context.lineWidth = single && error > 100 ? 3.2 : 2.35;
        context.beginPath(); context.moveTo(geometry.xAtBeat(previous.beat), geometry.yAtPitch(previous.displayPitch));
        context.lineTo(geometry.xAtBeat(sample.beat), geometry.yAtPitch(sample.displayPitch)); context.stroke();
      }
    }
    context.restore(); context.globalAlpha = 1;
  }

  function boundsFor(model, view) {
    const pitches = [
      ...(model.targetEvents || []).map(event => event.midiPitch),
      ...(model.traces || []).flatMap(trace => (trace.samples || []).filter(isAcceptedObservation).map(sample => sample.displayPitch)),
    ].filter(Number.isFinite);
    if (!pitches.length) return { min: 48, max: 72 };
    const minimum = Math.floor(Math.min(...pitches)) - 2, maximum = Math.ceil(Math.max(...pitches)) + 2;
    const baseSpan = Math.max(8, maximum - minimum), span = baseSpan / (view.pitchZoom || 1);
    const center = (minimum + maximum) / 2 + (view.pitchOffset || 0);
    return { min: center - span / 2, max: center + span / 2 };
  }

  function draw(canvas, model, view = {}) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const dpr = Math.min(global.devicePixelRatio || 1, 2.5), width = rect.width, height = rect.height;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const context = canvas.getContext('2d'); context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height);
    context.fillStyle = '#071419'; context.fillRect(0, 0, width, height);
    const total = Math.max(1, model.totalBeats || 1), zoom = clamp(view.zoom || 1, 1, 20), span = total / zoom;
    const center = clamp(Number.isFinite(view.centerBeat) ? view.centerBeat : total / 2, 0, total);
    const start = clamp(center - span / 2, 0, Math.max(0, total - span));
    const plot = { left: width < 700 ? 48 : 58, right: width - 10, top: width < 700 ? 28 : 32, bottom: height - 28 };
    const geometry = drawBase(context, { width, height, plot, bounds: boundsFor(model, view), viewStart: start, viewEnd: start + span,
      measures: model.measures, targetEvents: model.targetEvents, activeBeat: view.focusBeat, lyricScale: model.lyricScale || 1.35,
      compact: width < 700, showPitchLabels: model.showPitchLabels !== false });
    const visibleTraces = (model.traces || []).filter(trace => trace.visible !== false);
    visibleTraces.forEach((trace, index) => drawTrace(context, geometry, trace, index, visibleTraces.length === 1));
    const markerGeometry = [];
    for (const marker of model.markers || []) {
      if (marker.endBeat < geometry.viewStart || marker.startBeat > geometry.viewEnd) continue;
      const x = geometry.xAtBeat((marker.startBeat + marker.endBeat) / 2);
      const y = clamp(geometry.yAtPitch(marker.pitch) - 22, plot.top + 11, plot.bottom - 10);
      const severe = marker.severity === 'high' || Number(marker.severity) >= 3;
      const radius = marker.selected ? 12 : 9;
      if (marker.selected) { context.strokeStyle = '#f5f1e5'; context.lineWidth = 2; context.beginPath(); context.arc(x, y, radius + 3, 0, Math.PI * 2); context.stroke(); }
      context.fillStyle = severe ? '#ef6b5b' : '#e8b15c'; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#071419'; context.font = '800 11px Inter, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('!', x, y + .5);
      markerGeometry.push({ marker, source: marker, x, y, radius: radius + 4 });
    }
    if (Number.isFinite(view.hoverBeat)) {
      const x = geometry.xAtBeat(view.hoverBeat); context.strokeStyle = 'rgba(245,241,229,.72)'; context.setLineDash([4, 4]);
      context.beginPath(); context.moveTo(x, plot.top); context.lineTo(x, plot.bottom); context.stroke(); context.setLineDash([]);
    }
    context.strokeStyle = 'rgba(192,220,215,.22)'; context.strokeRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
    return { ...geometry, total, span, center, markers: markerGeometry,
      beatAtX: localX => geometry.viewStart + clamp((localX - plot.left) / Math.max(1, plot.right - plot.left), 0, 1) * span };
  }

  // Shared by paused practice, saved performances and local take analysis.
  // All transforms use the geometry actually drawn, including responsive crops.
  function noteAt(geometry, events, x, y, pitchOffset = 0) {
    if (!geometry) return null;
    const { plot, rowHeight, xAtBeat, yAtPitch } = geometry;
    if (x < plot.left || x > plot.right || y < plot.top || y > plot.bottom) return null;
    let best = null, distance = Infinity;
    for (const note of events || []) {
      if (!Number.isFinite(note.midiPitch) || note.durationBeats <= 0) continue;
      const left = xAtBeat(note.onsetBeat), right = xAtBeat(note.onsetBeat + note.durationBeats);
      if (right < plot.left || left > plot.right) continue;
      const centerY = yAtPitch(note.midiPitch + pitchOffset);
      const dx = Math.max(left - x, x - right, 0), dy = Math.abs(y - centerY);
      // Prefer the closest visible note; generous touch tolerance never snaps
      // to a note outside the viewport or an unrelated time position.
      if (centerY < plot.top - rowHeight / 2 || centerY > plot.bottom + rowHeight / 2) continue;
      const next = Math.hypot(dx, Math.max(0, dy - rowHeight / 2));
      if (dx <= 10 && dy <= Math.max(12, rowHeight / 2) && next < distance) { best = note; distance = next; }
    }
    return best;
  }

  let previewContext = null, previewVoice = null, previewGeneration = 0;
  function stopPreview() {
    previewGeneration += 1;
    if (!previewVoice) return;
    const { oscillator, gain, context } = previewVoice;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, .008);
    oscillator.stop(now + .04);
    previewVoice = null;
  }

  async function previewNote(pitch, duration = .65, volume = .6) {
    stopPreview();
    const generation = previewGeneration;
    const Context = global.AudioContext || global.webkitAudioContext;
    if (!Context) throw new Error('Audio non disponibile');
    previewContext ??= new Context({ latencyHint: 'interactive' });
    if (previewContext.state === 'suspended') await previewContext.resume();
    if (generation !== previewGeneration) return;
    const context = previewContext, now = context.currentTime;
    const oscillator = context.createOscillator(), gain = context.createGain();
    const seconds = clamp(duration, .15, 2);
    oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(440 * 2 ** ((pitch - 69) / 12), now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(clamp(volume, 0, 1) * .22, now + .012);
    gain.gain.setValueAtTime(clamp(volume, 0, 1) * .22, now + seconds - .06);
    gain.gain.linearRampToValueAtTime(0, now + seconds);
    oscillator.connect(gain).connect(context.destination);
    const voice = { oscillator, gain, context };
    previewVoice = voice;
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); if (previewVoice === voice) previewVoice = null; };
    oscillator.start(now); oscillator.stop(now + seconds + .02);
  }

  function bindNavigation(canvas, options) {
    const points = new Map();
    let gesture = null, selectedNote = null;
    const enabled = () => options.enabled?.() !== false;
    const geometry = () => options.geometry();
    const activate = () => { options.activate?.(); return geometry(); };
    const details = document.createElement('details'); details.className = 'roll-navigation';
    details.innerHTML = `<summary aria-label="Regola vista piano roll">Vista</summary><div class="roll-navigation-panel">
      <div><span>Tempo</span><button type="button" data-axis="time" data-factor="0.6666667" aria-label="Riduci zoom tempo">−</button><output data-value="time">100%</output><button type="button" data-axis="time" data-factor="1.5" aria-label="Aumenta zoom tempo">+</button></div>
      <div><span>Altezza</span><button type="button" data-axis="pitch" data-factor="0.6666667" aria-label="Riduci zoom altezza">−</button><output data-value="pitch">100%</output><button type="button" data-axis="pitch" data-factor="1.5" aria-label="Aumenta zoom altezza">+</button></div>
      <button type="button" data-reset>Reimposta vista</button>
      <p>Trascina per spostarti. Pizzica per ingrandire. Tocca una nota per ascoltarla.</p>
      <p>Rotella: tempo · Maiusc: altezza.<br>Frecce: sposta · + / −: zoom · Maiusc: altezza · 0: reimposta.<br>← / → con Alt: scegli nota · Invio: ascolta.</p></div>`;
    const status = document.createElement('output'); status.className = 'roll-note-status'; status.setAttribute('role', 'status');
    const host = options.controlsHost || canvas.parentElement;
    host.append(details, status);
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Piano roll interattivo: esplora con le frecce, zoom con più e meno, Alt e frecce per scegliere una nota, Invio per ascoltare');
    canvas.title = 'Trascina per esplorare · rotella: zoom tempo · Maiusc + rotella: zoom altezza · tocca una nota per ascoltarla';
    function refresh() {
      details.hidden = !enabled();
      if (details.hidden) { details.open = false; cancel(); }
      const view = options.view();
      details.querySelector('[data-value="time"]').textContent = `${Math.round(view.zoom * 100)}%`;
      details.querySelector('[data-value="pitch"]').textContent = `${Math.round(view.pitchZoom * 100)}%`;
    }
    function change(values) { options.change(values); refresh(); }
    function zoom(timeFactor, pitchFactor, clientX, clientY) {
      if (!enabled()) return;
      const g = activate(); if (!g) return;
      const view = options.view(), rect = canvas.getBoundingClientRect(), p = g.plot;
      const rx = Number.isFinite(clientX) ? clamp((clientX - rect.left - p.left) / (p.right - p.left), 0, 1) : .5;
      const ry = Number.isFinite(clientY) ? clamp((clientY - rect.top - p.top) / (p.bottom - p.top), 0, 1) : .5;
      const zoomValue = clamp(view.zoom * timeFactor, options.minZoom ?? 1, 20);
      const pitchZoom = clamp(view.pitchZoom * pitchFactor, .25, 8);
      const span = g.viewEnd - g.viewStart, pitchSpan = g.bounds.max - g.bounds.min;
      change({ zoom: zoomValue, pitchZoom,
        centerBeat: (g.viewStart + g.viewEnd) / 2 + (rx - .5) * span * (1 - view.zoom / zoomValue),
        pitchOffset: view.pitchOffset + (.5 - ry) * pitchSpan * (1 - view.pitchZoom / pitchZoom) });
    }
    function pan(dx, dy) {
      const g = activate(); if (!g) return;
      const view = options.view(), p = g.plot;
      change({ centerBeat: (g.viewStart + g.viewEnd) / 2 - dx / (p.right - p.left) * (g.viewEnd - g.viewStart),
        pitchOffset: view.pitchOffset + dy / (p.bottom - p.top) * (g.bounds.max - g.bounds.min) });
    }
    function reset() { cancel(); stopPreview(); selectedNote = null; status.textContent = ''; options.reset(); refresh(); }
    function cancel() {
      const ids = [...points.keys()]; points.clear(); gesture = null;
      selectedNote = null; status.textContent = '';
      for (const id of ids) if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
      canvas.classList.remove('is-panning', 'is-inspecting');
    }
    function announce(text) { status.textContent = text; clearTimeout(announce.timer); announce.timer = setTimeout(() => { status.textContent = ''; }, 2200); }
    function listen(note) {
      selectedNote = note;
      const pitch = note.midiPitch + (options.pitchOffset?.() || 0);
      announce(`♪ ${italianNoteName(pitch)}`);
      const playback = options.notePlayback?.(note) || {};
      Promise.resolve(previewNote(pitch, playback.duration, playback.volume)).catch(() => announce('Audio non disponibile. Riprova.'));
    }
    details.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.hasAttribute('data-reset')) reset();
      else zoom(button.dataset.axis === 'time' ? Number(button.dataset.factor) : 1, button.dataset.axis === 'pitch' ? Number(button.dataset.factor) : 1);
    });
    details.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); details.open = false; details.querySelector('summary').focus(); } });
    canvas.addEventListener('wheel', event => {
      if (!enabled()) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && !event.ctrlKey && !event.metaKey) pan(-event.deltaX * unit, 0);
      else { const factor = Math.exp(-clamp(event.deltaY * unit, -160, 160) * .0014);
        zoom(event.shiftKey ? 1 : factor, event.shiftKey || event.ctrlKey || event.metaKey ? factor : 1, event.clientX, event.clientY); }
    }, { passive: false });
    function midpoint() {
      const [a, b] = [...points.values()];
      return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) } : a;
    }
    canvas.addEventListener('pointerdown', event => {
      if (!enabled() || event.button !== 0 || points.size >= 2 || !activate()) return;
      event.preventDefault(); canvas.focus({ preventScroll: true });
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      const middle = midpoint();
      gesture = { ...middle, startX: middle.x, startY: middle.y, moved: points.size > 1 };
      canvas.classList.add('is-panning');
    });
    canvas.addEventListener('pointermove', event => {
      if (!points.has(event.pointerId)) { options.hover?.(event); return; }
      if (!enabled()) { cancel(); return; }
      event.preventDefault(); points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const middle = midpoint();
      if (Math.hypot(middle.x - gesture.startX, middle.y - gesture.startY) > 5) gesture.moved = true;
      if (!gesture.moved) return;
      if (points.size > 1) {
        const factor = middle.distance / gesture.distance;
        zoom(factor, factor, gesture.x, gesture.y);
      }
      pan(middle.x - gesture.x, middle.y - gesture.y);
      gesture = { ...gesture, ...middle };
    });
    function finish(event, cancelled = false) {
      if (!points.has(event.pointerId)) return;
      const moved = gesture.moved;
      points.delete(event.pointerId);
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (points.size) { const middle = midpoint(); gesture = { ...middle, startX: middle.x, startY: middle.y, moved: true }; return; }
      gesture = null; canvas.classList.remove('is-panning');
      if (cancelled || moved || !enabled()) return;
      const rect = canvas.getBoundingClientRect();
      const note = noteAt(geometry(), options.notes(), event.clientX - rect.left, event.clientY - rect.top, options.pitchOffset?.() || 0);
      if (note) listen(note);
      options.tap?.(event, note);
    }
    canvas.addEventListener('pointerup', event => finish(event));
    canvas.addEventListener('pointercancel', event => finish(event, true));
    canvas.addEventListener('lostpointercapture', event => { if (points.has(event.pointerId)) cancel(); });
    canvas.addEventListener('keydown', event => {
      if (!enabled()) return;
      if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault(); activate();
        const notes = options.notes(), g = geometry();
        if (!notes.length || !g) return;
        const index = selectedNote ? notes.indexOf(selectedNote) + (event.key === 'ArrowRight' ? 1 : -1) : notes.findIndex(note => note.onsetBeat >= g.viewStart);
        selectedNote = notes[clamp(index, 0, notes.length - 1)];
        change({ centerBeat: selectedNote.onsetBeat + selectedNote.durationBeats / 2 });
        announce(`${italianNoteName(selectedNote.midiPitch + (options.pitchOffset?.() || 0))} · Invio per ascoltare`); return;
      }
      if (event.key === 'Enter') {
        event.preventDefault(); const g = activate();
        const note = selectedNote || options.notes().find(note => g && note.onsetBeat + note.durationBeats >= g.viewStart && note.onsetBeat <= g.viewEnd);
        if (note) listen(note); return;
      }
      if (['+', '=', '-', '_'].includes(event.key)) { event.preventDefault(); const factor = ['+', '='].includes(event.key) ? 1.5 : 1 / 1.5; zoom(event.shiftKey ? 1 : factor, event.shiftKey ? factor : 1); }
      else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); reset(); }
      else if (event.key.startsWith('Arrow')) { event.preventDefault(); pan(event.key === 'ArrowLeft' ? 60 : event.key === 'ArrowRight' ? -60 : 0, event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0); }
    });
    global.addEventListener('blur', () => { cancel(); stopPreview(); });
    global.addEventListener('pagehide', stopPreview);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { cancel(); stopPreview(); } });
    refresh();
    return { zoom, reset, refresh, cancel };
  }

  global.PianoRoll = Object.freeze({ DEFAULT_TRACE_COLORS, drawBase, draw, gridLines, italianNoteName, isAcceptedObservation,
    noteAt, previewNote, stopPreview, bindNavigation });
})(window);
