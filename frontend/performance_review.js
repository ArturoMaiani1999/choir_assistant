(() => {
  const state = { current: null, view: { zoom: 1, pitchZoom: 1, pitchOffset: 0, centerBeat: 0, focusBeat: 0 } };
  const refs = {};
  let returnFocus = null;
  let background = [];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function deriveErrors(samples, segments = []) {
    const groups = [];
    let group = [];
    const close = () => { if (group.length >= 2) groups.push(group); group = []; };
    for (const sample of samples) {
      if (!window.PianoRoll.isAcceptedObservation(sample)) { close(); continue; }
      const outside = Math.abs(Number(sample.errorCents || 0)) >= 75;
      const previous = group.at(-1);
      if (!outside || (previous && Number(sample.beat) - Number(previous.beat) > .65)) close();
      if (outside) group.push(sample);
    }
    close();
    return groups.map((items) => {
      const startBeat = Number(items[0].beat);
      const endBeat = Number(items.at(-1).beat) + .18;
      const meanCents = items.reduce((sum, item) => sum + Number(item.errorCents || 0), 0) / items.length;
      const segment = segments.find((item) => startBeat < Number(item.endBeat) && endBeat > Number(item.startBeat));
      return {
        startBeat, endBeat, meanCents,
        measureNumber: segment?.measureNumber,
        severity: Math.abs(meanCents) >= 150 ? "high" : "medium",
        kind: items.length <= 2 ? "missed_attack" : "drift",
      };
    }).sort((left, right) => Math.abs(right.meanCents) - Math.abs(left.meanCents)).slice(0, 18);
  }

  function readyAnalysis(value) {
    if (value?.status === "ready" && Array.isArray(value.trace)) return value;
    if (Array.isArray(value?.trace?.samples)) return {
      status: "ready",
      trace: value.trace.samples,
      errors: deriveErrors(value.trace.samples, value.trace.segments || []),
    };
    return null;
  }

  function nearestTarget(targets, beat) {
    let result = null;
    let distance = Infinity;
    for (const target of targets || []) {
      const start = Number(target.onsetBeat ?? target.startBeat ?? 0);
      const end = Number(target.endBeat ?? (start + Number(target.durationBeats || 0)));
      const next = Math.abs((start + end) / 2 - beat);
      if (next < distance) {
        result = target;
        distance = next;
      }
    }
    return result;
  }

  function markersFor(trace, targets) {
    return (trace.analysis?.errors || []).map((error, index) => {
      const startBeat = Number(error.startBeat || 0);
      const endBeat = Math.max(startBeat + 0.08, Number(error.endBeat || startBeat + 0.25));
      const target = nearestTarget(targets, (startBeat + endBeat) / 2);
      const direction = Number(error.meanCents || 0) >= 0 ? "crescente" : "calante";
      const measure = Number.isFinite(Number(error.measureNumber)) ? `Batt. ${error.measureNumber}` : `Beat ${startBeat.toFixed(1)}`;
      const lyric = target?.lyric && target.lyric !== "-" ? ` · “${target.lyric}”` : "";
      return {
        ...error,
        id: `${trace.id}-event-${index}`,
        traceId: trace.id,
        traceLabel: trace.label,
        traceColor: trace.color,
        startBeat,
        endBeat,
        pitch: Number(target?.midiPitch ?? target?.pitch ?? error.pitch ?? 60),
        severity: error.severity === "high" ? "high" : "medium",
        heading: `${measure}${target?.pitchLabel ? ` · ${target.pitchLabel}` : ""}${lyric}`,
        message: error.message || (error.kind === "missed_attack"
          ? "Segnale incerto all’attacco: confronta il riascolto prima di valutarlo."
          : error.kind === "drift"
            ? `Scostamento rilevato ${direction}: verifica il riascolto e il possibile rientro della base.`
            : "L’altezza rilevata oscilla: confronta il riascolto prima di attribuirlo alla voce."),
      };
    });
  }

  function visibleRange() {
    const totalBeats = Math.max(1, Number(state.current?.totalBeats || 1));
    const zoom = clamp(Number(state.view.zoom || 1), 1, 20);
    const span = totalBeats / zoom;
    const center = clamp(Number(state.view.centerBeat ?? totalBeats / 2), span / 2, totalBeats - span / 2);
    return { start: center - span / 2, end: center + span / 2, span, center, totalBeats };
  }

  function syncScore() {
    const current = state.current;
    if (!current || current.legacy) return;
    const range = visibleRange();
    const beat = clamp(Number(state.view.focusBeat || range.center), 0, range.totalBeats);
    const slots = current.scoreSlots || [];
    const match = slots.find((slot) => beat >= slot.startBeat && beat < slot.endBeat) || slots.at(-1);
    const progress = match
      ? clamp((beat - Number(match.startBeat || 0)) / Math.max(.001, Number(match.endBeat || 0) - Number(match.startBeat || 0)), 0, 1)
      : 0;
    const ratio = match
      ? clamp((Number(match.left || 0) + Number(match.width || 0) * progress) / Math.max(1, Number(match.svgWidth || 1)), 0, 1)
      : clamp(beat / range.totalBeats, 0, 1);
    refs.scoreScroller.scrollLeft = Math.max(0, ratio * refs.scoreScroller.scrollWidth - refs.scoreScroller.clientWidth / 2);
    refs.scoreCursor.style.left = `${ratio * 100}%`;
    refs.measureBadge.textContent = match?.measureNumber ? `Battuta ${match.measureNumber}` : `Beat ${beat.toFixed(1)}`;
  }

  function renderPanel() {
    const current = state.current;
    if (!current) return;
    if (refs.practice) {
      refs.practice.hidden = typeof current.onPractice !== 'function';
      refs.practice.textContent = Number.isFinite(current.practiceBeat) ? 'Prova da qui' : 'Prova questo brano';
    }
    refs.suggestions.replaceChildren();
    if (current.selectedMarker) {
      const marker = current.selectedMarker;
      refs.feedbackKicker.textContent = "PUNTO SELEZIONATO";
      refs.feedbackTitle.textContent = marker.traceLabel || "Suggerimento";
      refs.feedbackIntro.textContent = "Il dettaglio resta collegato alla posizione evidenziata sul piano roll.";
      const item = document.createElement("li");
      item.className = `performance-review__suggestion severity-${marker.severity || "medium"} is-expanded`;
      item.style.setProperty("--trace-color", marker.traceColor || "var(--gold)");
      const heading = document.createElement("strong");
      heading.textContent = marker.heading;
      const message = document.createElement("span");
      message.textContent = marker.message;
      const close = document.createElement("button");
      close.type = "button";
      close.className = "secondary compact performance-review__detail-close";
      close.textContent = current.mode === "director" ? "Torna alle tracce" : "Chiudi dettaglio";
      close.addEventListener("click", () => {
        current.selectedMarker = null;
        current.practiceBeat = null;
        renderPanel();
        draw();
      });
      item.append(heading, message, close);
      refs.suggestions.append(item);
      return;
    }
    if (current.mode === "director") {
      refs.feedbackKicker.textContent = "ESECUZIONI";
      refs.feedbackTitle.textContent = "Tracce sovrapposte";
      refs.feedbackIntro.textContent = "Attiva i coristi da confrontare. Pitch Lab si abilita quando il corista condivide anche l’audio della registrazione.";
      if (current.partOptions?.length > 1) {
        const switcher = document.createElement("li");
        switcher.className = "performance-review__part-switcher";
        for (const part of current.partOptions) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = part.label;
          button.className = part.id === current.activePartId ? "is-active" : "";
          button.disabled = part.id === current.activePartId;
          button.addEventListener("click", () => void current.onPartChange?.(part.id));
          switcher.append(button);
        }
        refs.suggestions.append(switcher);
      }
      for (const trace of current.traces) {
        const item = document.createElement("li");
        item.className = "performance-review__trace-toggle";
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = trace.visible !== false;
        checkbox.addEventListener("change", () => { trace.visible = checkbox.checked; draw(); });
        const swatch = document.createElement("span");
        swatch.className = "performance-review__trace-swatch";
        swatch.style.background = trace.color;
        const text = document.createElement("span");
        text.textContent = trace.subtitle ? `${trace.label} · ${trace.subtitle}` : trace.label;
        label.append(checkbox, swatch, text);
        item.append(label);
        if (typeof current.onOpenLab === "function") {
          const lab = document.createElement("button");
          lab.type = "button";
          lab.className = "performance-review__lab-button";
          lab.textContent = "Pitch Lab";
          lab.disabled = !trace.recording;
          lab.title = trace.recording
            ? "Ricalcola YIN e pYIN sull’audio condiviso da questo corista"
            : "Il corista non ha ancora condiviso l’audio per l’analisi tecnica";
          if (trace.recording) lab.addEventListener("click", () => current.onOpenLab(trace));
          item.append(lab);
          if (!trace.recording) {
            const reason = document.createElement("small");
            reason.className = "performance-review__lab-reason";
            reason.textContent = "Audio non condiviso dal corista";
            item.append(reason);
          }
        }
        refs.suggestions.append(item);
      }
      return;
    }
    refs.feedbackKicker.textContent = "DA RIVEDERE";
    refs.feedbackTitle.textContent = "Suggerimenti nel contesto";
    refs.feedbackIntro.textContent = current.errors.length
      ? "Clicca un punto ! sul piano roll per vedere il suggerimento relativo a quella nota."
      : "Nessun errore specifico rilevato in questa esecuzione.";
  }

  function draw() {
    const current = state.current;
    if (!current || current.legacy || !window.PianoRoll) return;
    const range = visibleRange();
    state.view.centerBeat = range.center;
    refs.canvas.dataset.viewStart = range.start.toFixed(6);
    refs.canvas.dataset.viewEnd = range.end.toFixed(6);
    refs.canvas.dataset.viewCenter = range.center.toFixed(6);
    refs.zoomValue.textContent = `${Math.round(state.view.zoom * 100)}%`;
    refs.rollHeading.textContent = current.mode === "director"
      ? `${current.traces.filter((trace) => trace.visible !== false).length} tracce visibili`
      : `Battuta ${current.measureAtBeat(state.view.focusBeat || range.center)} · beat ${(state.view.focusBeat || range.center).toFixed(2)}`;
    const visibleTraceIds = new Set(current.traces.filter((trace) => trace.visible !== false).map((trace) => trace.id));
    current.rollGeometry = window.PianoRoll.draw(refs.canvas, {
      totalBeats: current.totalBeats,
      targetEvents: current.targetEvents,
      measures: current.measures,
      traces: current.traces.filter((trace) => trace.visible !== false),
      markers: current.errors.filter((marker) => visibleTraceIds.has(marker.traceId)).map((marker) => ({
        ...marker,
        selected: marker.id === current.selectedMarker?.id,
      })),
      showPitchLabels: true,
      lyricScale: 1.22,
    }, { ...state.view });
    state.navigation?.refresh();
    syncScore();
  }

  function markerAtEvent(event) {
    const geometry = state.current?.rollGeometry;
    if (!geometry?.markers?.length) return null;
    const rect = refs.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let result = null;
    let distance = Infinity;
    for (const marker of geometry.markers) {
      const next = Math.hypot(marker.x - x, marker.y - y);
      if (next <= Math.max(18, marker.radius + 8) && next < distance) {
        result = marker.source;
        distance = next;
      }
    }
    return result;
  }

  function beatAtEvent(event) {
    const geometry = state.current?.rollGeometry;
    if (!geometry?.beatAtX) return visibleRange().center;
    const rect = refs.canvas.getBoundingClientRect();
    return geometry.beatAtX(event.clientX - rect.left);
  }

  function normalizeTraces(options, analysis) {
    const palette = window.PianoRoll?.DEFAULT_TRACE_COLORS || ["#80e0d5", "#7aa7ff", "#db7fff", "#ff9b6a", "#83d475"];
    const input = Array.isArray(options.traces) && options.traces.length
      ? options.traces
      : analysis
        ? [{ id: options.performance?.id || "performance", label: options.performance?.owner?.displayName || "La mia traccia", analysis }]
        : [];
    return input.map((trace, index) => {
      const traceAnalysis = readyAnalysis(trace.analysis) || (Array.isArray(trace.samples)
        ? { status: "ready", trace: trace.samples, errors: trace.errors || [] }
        : null);
      return {
        id: String(trace.id || `trace-${index}`),
        label: trace.label || trace.displayName || `Esecuzione ${index + 1}`,
        subtitle: trace.subtitle || trace.voicePart || "",
        color: trace.color || palette[index % palette.length],
        samples: traceAnalysis?.trace || [],
        analysis: traceAnalysis,
        recording: trace.recording || null,
        visible: trace.visible !== false,
      };
    });
  }

  function open(options = {}) {
    const performance = options.performance || {};
    const analysis = readyAnalysis(options.analysis);
    const traces = normalizeTraces(options, analysis);
    const traceEnd = Math.max(0, ...traces.flatMap((trace) => trace.samples.map((sample) => Number(sample.beat || 0))));
    const targetEnd = Math.max(0, ...(options.targetEvents || []).map((event) => Number(event.endBeat || 0)));
    const totalBeats = Math.max(1, Number(options.totalBeats || 0), traceEnd, targetEnd);
    const measures = Array.isArray(options.measures) ? options.measures : [];
    const measureAtBeat = (beat) => Number(measures.find((measure) => beat >= Number(measure.startBeat) && beat < Number(measure.endBeat))?.measureNumber || 1);
    const legacy = !traces.length || !window.PianoRoll;
    const scoreSlots = (options.scoreSlots || []).map((slot, index) => {
      if (Number.isFinite(slot.startBeat) && Number.isFinite(slot.endBeat)) return slot;
      const measure = measures[index];
      if (!measure) return slot;
      const left = Number(slot.left ?? slot.startX ?? 0);
      const right = Number(slot.endX ?? (left + Number(slot.width || 0)));
      return { ...slot, startBeat: measure.startBeat, endBeat: measure.endBeat, left, width: right - left, svgWidth: 100 };
    });
    const current = {
      ...options,
      performance,
      analysis,
      traces,
      errors: traces.flatMap((trace) => markersFor(trace, options.targetEvents || [])),
      targetEvents: options.targetEvents || [],
      measures,
      scoreSlots,
      totalBeats,
      measureAtBeat,
      selectedMarker: null,
      practiceBeat: null,
      legacy,
      mode: options.mode === "director" ? "director" : "singer",
    };
    PianoRoll.stopPreview();
    state.navigation?.cancel();
    state.current = current;
    state.view = { zoom: 1, pitchZoom: 1, pitchOffset: 0, centerBeat: totalBeats / 2, focusBeat: totalBeats / 2 };
    refs.title.textContent = options.title || performance.title || "Esecuzione";
    refs.meta.textContent = options.meta || [performance.owner?.displayName, performance.voicePart ? `parte ${performance.voicePart}` : ""].filter(Boolean).join(" · ");
    refs.score.textContent = performance.score == null ? "" : `${performance.score}%`;
    refs.coverage.textContent = performance.coverageRatio == null ? "" : `${Math.round(Number(performance.coverageRatio) * 1000) / 10}% copertura`;
    refs.back.textContent = options.backLabel || "Risultati";
    if (options.scoreUrl) refs.scoreImage.src = options.scoreUrl;
    else refs.scoreImage.removeAttribute("src");
    refs.scoreImage.alt = `Partitura di ${refs.title.textContent}`;
    refs.scoreImage.hidden = !options.scoreUrl;
    refs.canvas.hidden = legacy;
    refs.legacyImage.hidden = !legacy;
    if (performance.traceUrl) refs.legacyImage.src = performance.traceUrl;
    else refs.legacyImage.removeAttribute("src");
    refs.legacyImage.alt = `Traccia di ${refs.title.textContent}`;
    refs.shell.hidden = false;
    if (!background.length) {
      returnFocus = options.returnFocus || document.activeElement;
      background = [...document.body.children].filter(element => element !== refs.shell
        && element.id !== 'pitch-lab' && !['SCRIPT', 'STYLE'].includes(element.tagName))
        .map(element => ({ element, inert: element.inert }));
      background.forEach(({ element }) => { element.inert = true; });
    }
    refs.shell.setAttribute('role', 'dialog');
    refs.shell.setAttribute('aria-modal', 'true');
    refs.shell.tabIndex = -1;
    document.body.classList.add("performance-review-open");
    refs.back.focus({ preventScroll: true });
    renderPanel();
    requestAnimationFrame(draw);
  }

  function close({ notify = true } = {}) {
    PianoRoll.stopPreview();
    state.navigation?.cancel();
    const onClose = state.current?.onClose;
    refs.shell.hidden = true;
    document.body.classList.remove("performance-review-open");
    state.current = null;
    background.forEach(({ element, inert }) => { element.inert = inert; });
    background = [];
    if (notify && typeof onClose === "function") onClose();
    if (notify && returnFocus?.isConnected && returnFocus.checkVisibility()) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function bind() {
    refs.shell = document.getElementById("performance-review");
    if (!refs.shell || refs.shell.dataset.bound === "true") return;
    refs.shell.dataset.bound = "true";
    const ids = {
      back: "performance-review-back", title: "performance-review-title", meta: "performance-review-meta",
      score: "performance-review-score", coverage: "performance-review-coverage", scoreScroller: "performance-review-score-scroller",
      scoreImage: "performance-review-score-image", scoreCursor: "performance-review-score-cursor",
      measureBadge: "performance-review-measure", rollHeading: "performance-review-inspect", canvas: "performance-review-canvas",
      legacyImage: "performance-review-legacy-image", feedbackKicker: "performance-review-feedback-kicker",
      feedbackTitle: "performance-review-feedback-title", feedbackIntro: "performance-review-feedback-intro",
      suggestions: "performance-review-suggestions", zoomOut: "performance-review-zoom-out", zoomIn: "performance-review-zoom-in",
      zoomReset: "performance-review-reset", zoomValue: "performance-review-zoom",
    };
    for (const [key, id] of Object.entries(ids)) refs[key] = document.getElementById(id);
    refs.practice = document.getElementById('performance-review-practice');
    refs.practice?.addEventListener('click', async () => {
      const current = state.current;
      if (!current?.onPractice || refs.practice.disabled) return;
      refs.practice.disabled = true;
      try { await current.onPractice({ beat: current.practiceBeat }); }
      catch (_) { refs.practice.textContent = 'Riprova apertura'; }
      finally { refs.practice.disabled = false; }
    });
    refs.back.addEventListener("click", close);
    state.navigation = PianoRoll.bindNavigation(refs.canvas, {
      enabled: () => Boolean(state.current && !state.current.legacy && !refs.shell.hidden),
      geometry: () => state.current?.rollGeometry,
      view: () => ({ zoom: state.view.zoom, pitchZoom: state.view.pitchZoom || 1, pitchOffset: state.view.pitchOffset || 0 }),
      change: values => { Object.assign(state.view, values); state.view.focusBeat = state.view.centerBeat; draw(); },
      reset: () => { state.view = { zoom: 1, pitchZoom: 1, pitchOffset: 0, centerBeat: state.current.totalBeats / 2, focusBeat: state.current.totalBeats / 2 }; draw(); },
      notes: () => state.current?.targetEvents || [],
      notePlayback: note => state.current?.notePlayback?.(note) || {},
      hover: event => { if (!state.current) return; state.view.focusBeat = beatAtEvent(event); syncScore(); },
      tap: (event, note) => {
        const marker = markerAtEvent(event);
        if (marker) { state.current.selectedMarker = marker; state.current.practiceBeat = marker.startBeat; state.view.focusBeat = (marker.startBeat + marker.endBeat) / 2; renderPanel(); }
        else if (note) { state.view.focusBeat = note.onsetBeat; state.current.practiceBeat = note.onsetBeat; renderPanel(); }
        draw();
      },
    });
    refs.zoomOut.addEventListener("click", () => state.navigation.zoom(1 / 1.5, 1));
    refs.zoomIn.addEventListener("click", () => state.navigation.zoom(1.5, 1));
    refs.zoomReset.addEventListener("click", () => state.navigation.reset());
    document.addEventListener("keydown", (event) => {
      if (refs.shell.hidden || document.body.classList.contains('pitch-lab-open')) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const controls = [...refs.shell.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
          .filter(element => element.checkVisibility());
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !refs.shell.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !refs.shell.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    });
    new ResizeObserver(draw).observe(refs.canvas);
  }

  window.PerformanceReview = { open, close };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
