(function cockpitApp() {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { me: null, library: [], overview: null, selectedPiece: null, expandedPreparationPiece: null };
  const statusLabels = { not_started: 'Non iniziato', in_progress: 'In esercizio', completed: 'Completato', ready: 'Pronto' };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);

  async function api(path, options = {}) {
    const response = await window.ChoirAuthFetch(path, { cache: 'no-store', ...options });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  }
  const title = id => state.library.find(piece => piece.piece_id === id)?.title || id.replaceAll('-', ' ');
  const progressMap = () => new Map(state.overview.progress.map(item => [`${item.memberId}:${item.pieceId}`, item]));
  const assigned = () => new Set(state.overview.assignments.map(item => item.pieceId));
  function stateBadge(value) { return `<span class="state state-${escapeHtml(value)}">${escapeHtml(statusLabels[value] || value)}</span>`; }

  function renderPreparationMembers(members, progress, pieceId) {
    if (!members.length) return '<li class="preparation-empty">Nessun corista in questo gruppo.</li>';
    return members.map(member => {
      const item = progress.get(`${member.memberId}:${pieceId}`);
      const value = item?.status || 'not_started';
      const voice = AggregatePitch.LABELS[member.voicePart] || 'Parte da assegnare';
      return `<li>
        <span class="preparation-member"><strong>${escapeHtml(member.displayName)}</strong><small>${escapeHtml(voice)}</small></span>
        <span class="preparation-member-status">${stateBadge(value)}${item?.bestScore == null ? '' : `<small>best ${Number(item.bestScore)}%</small>`}</span>
      </li>`;
    }).join('');
  }

  function renderPreparationDetail(piece, progress) {
    const members = [...state.overview.members].sort((left, right) => left.displayName.localeCompare(right.displayName, 'it'));
    const prepared = members.filter(member => ['completed', 'ready'].includes(
      progress.get(`${member.memberId}:${piece.piece_id}`)?.status,
    ));
    const remaining = members.filter(member => !prepared.includes(member));
    return `<tr class="preparation-detail-row">
      <td colspan="4">
        <section id="preparation-detail-${escapeHtml(piece.piece_id)}" class="preparation-detail" aria-label="Preparazione di ${escapeHtml(piece.title)}">
          <header><div><span class="eyebrow">PREPARAZIONE DEL BRANO</span><h3>${escapeHtml(piece.title)}</h3></div><p><strong>${prepared.length}</strong> di ${members.length} hanno completato</p></header>
          <div class="preparation-groups">
            <section class="preparation-group is-prepared"><h4><span>Hanno preparato il brano</span><strong>${prepared.length}</strong></h4><ul>${renderPreparationMembers(prepared, progress, piece.piece_id)}</ul></section>
            <section class="preparation-group"><h4><span>Devono ancora prepararlo</span><strong>${remaining.length}</strong></h4><ul>${renderPreparationMembers(remaining, progress, piece.piece_id)}</ul></section>
          </div>
        </section>
      </td>
    </tr>`;
  }

  function renderSummary() {
    const active = assigned(), progress = progressMap();
    const total = state.overview.members.length * active.size;
    const counts = { ready: 0, completed: 0, in_progress: 0 };
    for (const member of state.overview.members) for (const pieceId of active) {
      const value = progress.get(`${member.memberId}:${pieceId}`)?.status;
      if (value && counts[value] != null) counts[value] += 1;
    }
    $('summary').innerHTML = [
      [state.overview.members.length, 'Coristi attivi'], [active.size, 'Brani assegnati'],
      [total ? `${Math.round((counts.completed + counts.ready) / total * 100)}%` : '—', 'Completati'],
      [total ? `${Math.round(counts.ready / total * 100)}%` : '—', 'Pronti'],
    ].map(([value, label]) => `<article><strong>${value}</strong><span>${label}</span></article>`).join('');
  }

  function renderAssignments() {
    const active = assigned(), progress = progressMap(), memberCount = state.overview.members.length;
    const ordered = [...state.library].sort((left, right) => {
      const assignmentOrder = Number(active.has(right.piece_id)) - Number(active.has(left.piece_id));
      return assignmentOrder || left.title.localeCompare(right.title, 'it');
    });
    $('assignments').innerHTML = ordered.map(piece => {
      const isAssigned = active.has(piece.piece_id);
      const prepared = state.overview.members.filter(member => ['completed', 'ready'].includes(
        progress.get(`${member.memberId}:${piece.piece_id}`)?.status,
      )).length;
      const preparation = memberCount ? Math.round(prepared / memberCount * 100) : 0;
      const detailOpen = isAssigned && state.expandedPreparationPiece === piece.piece_id;
      return `<tr class="assignment-row ${isAssigned ? 'is-assigned' : ''} ${detailOpen ? 'has-open-preparation' : ''}" data-piece="${escapeHtml(piece.piece_id)}">
        <th class="assignment-title" scope="row" data-label="Brano">
          <strong>${escapeHtml(piece.title)}</strong>
          <small>${isAssigned ? 'Visibile a tutto il coro' : 'Fuori dal programma'}</small>
        </th>
        <td class="assignment-preparation" data-label="Preparazione">
          ${isAssigned ? `<button id="preparation-trigger-${escapeHtml(piece.piece_id)}" class="assignment-preparation-trigger" type="button" data-preparation-piece="${escapeHtml(piece.piece_id)}" aria-expanded="${detailOpen}" aria-controls="preparation-detail-${escapeHtml(piece.piece_id)}">
            <span class="assignment-preparation-summary"><span><strong>${prepared}</strong> di ${memberCount} completati</span><output>${preparation}%</output></span>
            <progress max="100" value="${preparation}" aria-label="${escapeHtml(piece.title)}: ${preparation}% del coro ha completato il brano">${preparation}%</progress>
            <span class="assignment-preparation-hint">${detailOpen ? 'Nascondi coristi' : 'Vedi i coristi'}<i aria-hidden="true"></i></span>
          </button>` : '<span class="assignment-muted">Non ancora rilevata</span>'}
        </td>
        <td data-label="Programma"><span class="assignment-state">${isAssigned ? 'Assegnato' : 'Non assegnato'}</span></td>
        <td class="assignment-actions" data-label="Azioni">
          <button class="open-piece" type="button">Analisi</button>
          <button class="toggle-assignment" type="button" aria-pressed="${isAssigned}">${isAssigned ? 'Rimuovi' : 'Assegna'}</button>
        </td>
      </tr>${detailOpen ? renderPreparationDetail(piece, progress) : ''}`;
    }).join('');
    $('assignments').querySelectorAll('[data-preparation-piece]').forEach(button => {
      button.addEventListener('click', event => {
        const pieceId = button.dataset.preparationPiece;
        const keyboardInitiated = event.detail === 0;
        state.expandedPreparationPiece = state.expandedPreparationPiece === pieceId ? null : pieceId;
        renderAssignments();
        if (keyboardInitiated) document.getElementById(`preparation-trigger-${pieceId}`)?.focus();
      });
    });
    $('assignments').querySelectorAll('.assignment-row').forEach(row => {
      const pieceId = row.dataset.piece;
      row.querySelector('.open-piece').addEventListener('click', () => void openUnifiedPiece(pieceId));
      row.querySelector('.toggle-assignment').addEventListener('click', async event => {
        event.currentTarget.disabled = true;
        try {
          await api(`/api/cockpit/assignments/${encodeURIComponent(pieceId)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assigned: !assigned().has(pieceId) }),
          });
          if (state.expandedPreparationPiece === pieceId) state.expandedPreparationPiece = null;
          await loadOverview();
        } catch (error) { $('cockpit-status').hidden = false; $('cockpit-status').textContent = `Modifica non riuscita: ${error.message}`; }
      });
    });
  }

  async function loadOverview() {
    state.overview = await api('/api/cockpit/overview');
    if (state.expandedPreparationPiece && !assigned().has(state.expandedPreparationPiece)) state.expandedPreparationPiece = null;
    renderSummary(); renderAssignments();
    $('cockpit-status').hidden = true; $('cockpit-content').hidden = false;
  }

  function occurrenceMeasures(runtime) {
    if (runtime.performanceOccurrences.length) return runtime.performanceOccurrences.map(occurrence => {
      const written = runtime.measures.find(measure => measure.id === occurrence.writtenMeasureId);
      return {
        number: written?.number ?? '?', startBeat: occurrence.startBeat, endBeat: occurrence.endBeat,
      };
    });
    let beat = 0;
    return runtime.measures.map(measure => {
      const duration = measure.timeSignatureNumerator * (4 / measure.timeSignatureDenominator);
      const result = { number: measure.number, startBeat: beat, endBeat: beat + duration };
      beat += duration;
      return result;
    });
  }

  function mostRepresentedPart(traces) {
    const counts = new Map();
    for (const trace of traces) counts.set(trace.partId, (counts.get(trace.partId) || 0) + 1);
    return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
  }

  async function loadDirectorMusic(pieceId, partId) {
    const bundleResponse = await fetch(`library-assets/${encodeURIComponent(pieceId)}/bundle.json`, { cache: 'force-cache' });
    if (!bundleResponse.ok) throw new Error('Manifest del brano non disponibile');
    const bundle = await bundleResponse.json();
    const scoreResponse = await fetch(bundle.assets.score, { cache: 'force-cache' });
    if (!scoreResponse.ok) throw new Error('Partitura normalizzata non disponibile');
    const runtime = window.ChoirScore.NormalizedScoreRuntime.fromNormalizedScore(await scoreResponse.json());
    const selectedPart = runtime.parts.some(part => part.id === partId) ? partId : runtime.parts[0]?.id;
    runtime.selectPart(selectedPart);
    const scoreUrl = bundle.assets.continuous_scores?.[selectedPart]
      ?? bundle.assets.score_pages?.[selectedPart]?.[0] ?? '';
    return {
      targetEvents: runtime.targetEvents,
      measures: occurrenceMeasures(runtime),
      totalBeats: runtime.performanceOccurrences.at(-1)?.endBeat
        ?? Math.max(1, ...runtime.targetEvents.map(event => event.onsetBeat + event.durationBeats)),
      scoreUrl,
      partId: selectedPart,
      secondsAtBeat: beat => runtime.secondsAtBeat(beat),
    };
  }

  async function openUnifiedPiece(pieceId) {
    const returnFocus = document.activeElement;
    state.selectedPiece = pieceId;
    $('cockpit-status').hidden = false;
    $('cockpit-status').textContent = 'Caricamento analisi…';
    try {
      const [payload, recordingPayload] = await Promise.all([
        api(`/api/cockpit/pieces/${encodeURIComponent(pieceId)}`),
        api(`/api/cockpit/recordings?pieceId=${encodeURIComponent(pieceId)}`).catch(() => ({ recordings: [] })),
      ]);
      const recordings = recordingPayload.recordings || [];
      const initialPartId = mostRepresentedPart(payload.traces || []);
      if (!initialPartId) throw new Error('Non ci sono ancora esecuzioni complete da confrontare.');
      const partOrder = { soprano: 0, contralto: 1, tenore: 2, basso: 3 };
      const partOptions = [...new Map((payload.traces || []).map(trace => [trace.partId, {
        id: trace.partId,
        label: AggregatePitch.LABELS[trace.voicePart] || trace.voicePart || trace.partId,
        order: partOrder[trace.voicePart] ?? 99,
      }])).values()].sort((left, right) => left.order - right.order);
      const showPart = async (partId) => {
        const music = await loadDirectorMusic(pieceId, partId);
        const selected = (payload.traces || []).filter(trace => trace.partId === partId);
        const traces = selected.map(trace => ({
          id: trace.id,
          label: trace.displayName,
          subtitle: AggregatePitch.LABELS[trace.voicePart] || trace.voicePart,
          analysis: { trace: trace.trace },
          recording: recordings.find(recording => recording.memberId === trace.memberId
            && recording.partId === trace.partId && recording.scoreVersionId === payload.scoreVersionId) || null,
        }));
        const voicePart = selected[0]?.voicePart;
        window.PerformanceReview.open({
          mode: 'director',
          returnFocus,
          title: title(pieceId),
          meta: `${AggregatePitch.LABELS[voicePart] || voicePart || ''} · ${traces.length} esecuzioni individuali`,
          backLabel: 'Direzione',
          traces,
          targetEvents: music.targetEvents,
          measures: music.measures,
          totalBeats: music.totalBeats,
          scoreUrl: music.scoreUrl,
          partOptions,
          activePartId: partId,
          onPartChange: showPart,
          onOpenLab: trace => window.PitchLab.open({
            title: title(pieceId), trace, recording: trace.recording, music,
          }),
        });
      };
      await showPart(initialPartId);
      $('cockpit-status').hidden = true;
    } catch (error) {
      $('cockpit-status').hidden = false;
      $('cockpit-status').textContent = `Analisi non disponibile: ${error.message}`;
    }
  }

  async function initialize() {
    try {
      const [me, library] = await Promise.all([api('/api/me'), api('/library.json')]);
      if (!me.roles.includes('director')) throw new Error('Questa pagina è riservata ai direttori.');
      state.me = me; state.library = library.pieces || [];
      await loadOverview();
    } catch (error) { $('cockpit-status').textContent = error.message; }
  }
  void initialize();
})();
