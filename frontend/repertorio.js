(function personalRepertoireApp() {
  'use strict';

  const $ = id => document.getElementById(id);
  const STATUS_LABELS = {
    not_started: 'Da iniziare',
    in_progress: 'In esercizio',
    completed: 'Completato',
    ready: 'Pronto',
  };
  const VOICE_LABELS = {
    soprano: 'Soprano',
    contralto: 'Contralto',
    tenore: 'Tenore',
    basso: 'Basso',
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);

  async function api(path) {
    const response = await window.ChoirAuthFetch(path, { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  }

  function normalized(value) {
    return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function partVoice(part) {
    const value = normalized(`${part?.name} ${part?.id}`);
    if (/sopran/.test(value)) return 'soprano';
    if (/contralt|\balto\b/.test(value)) return 'contralto';
    if (/tenor/.test(value)) return 'tenore';
    if (/bass/.test(value)) return 'basso';
    return null;
  }

  function practiceHref(piece, voicePart) {
    const part = (piece.parts || []).find(item => partVoice(item) === voicePart);
    const query = new URLSearchParams({ piece: piece.piece_id, from: 'repertorio' });
    if (part?.id) query.set('part', part.id);
    return `index.html?${query}`;
  }

  function progressPercent(item) {
    if (item.status === 'ready') return 100;
    if (item.status === 'completed') return Math.max(85, Number(item.latestCoverage) || 0);
    if (item.status === 'in_progress') return Math.max(8, Math.min(80, Number(item.latestCoverage) || 8));
    return 0;
  }

  function scoreLabel(value) {
    return value == null ? '—' : `${Math.round(Number(value))}%`;
  }

  function lastActivity(item) {
    if (!item.lastPracticedAt) return 'Non ancora iniziato';
    const value = new Date(item.lastPracticedAt);
    return Number.isNaN(value.valueOf()) ? 'Attività registrata' : `Ultima prova ${value.toLocaleDateString('it-IT')}`;
  }

  function renderSummary(assignments) {
    const completed = assignments.filter(item => ['completed', 'ready'].includes(item.status)).length;
    const ready = assignments.filter(item => item.status === 'ready').length;
    $('summary').innerHTML = [
      [assignments.length, 'Brani assegnati'],
      [completed, 'Completati'],
      [ready, 'Pronti'],
    ].map(([value, label]) => `<article><strong>${value}</strong><span>${label}</span></article>`).join('');
  }

  function renderAssignments(assignments, library, voicePart) {
    const pieces = new Map(library.map(piece => [piece.piece_id, piece]));
    if (!assignments.length) {
      $('assignment-list').innerHTML = '<article class="empty-state"><h3>Nessun brano assegnato</h3><p>Quando i direttori pubblicheranno il programma, lo troverai qui.</p></article>';
      return;
    }
    $('assignment-list').innerHTML = assignments.map(item => {
      const piece = pieces.get(item.pieceId) || { piece_id: item.pieceId, title: item.pieceId.replaceAll('-', ' '), parts: [] };
      const progress = progressPercent(item);
      return `<article class="piece-card" data-status="${escapeHtml(item.status)}">
        <div class="piece-main">
          <div class="piece-kicker">
            <span class="state state-${escapeHtml(item.status)}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>
            <span class="piece-voice">${escapeHtml(VOICE_LABELS[voicePart] || 'Parte da definire')}</span>
          </div>
          <h3>${escapeHtml(piece.title)}</h3>
          <progress class="progress-track" aria-label="Avanzamento" max="100" value="${progress}">${progress}%</progress>
          <div class="piece-meta">
            <span>Ultimo risultato<strong>${scoreLabel(item.latestScore)}</strong></span>
            <span>Completamenti<strong>${Number(item.completionCount) || 0}</strong></span>
          </div>
        </div>
        <div class="piece-actions">
          <small>${escapeHtml(lastActivity(item))}</small>
          <a class="open-piece" href="${escapeHtml(practiceHref(piece, voicePart))}">Apri brano</a>
        </div>
      </article>`;
    }).join('');
  }

  async function initialize() {
    $('repertoire-retry').hidden = true;
    $('repertoire-status').hidden = false;
    $('repertoire-status').textContent = 'Caricamento…';
    try {
      const [me, progress, library] = await Promise.all([
        api('/api/me'), api('/api/progress/assignments'), api('/library.json'),
      ]);
      $('member-name').textContent = me.member?.firstName || me.member?.displayName || 'corista';
      const voicePart = me.preferredVoicePart || me.voicePart;
      $('member-detail').textContent = voicePart
        ? `La tua parte: ${VOICE_LABELS[voicePart] || voicePart}.`
        : 'Completa il profilo e indica la tua parte vocale.';
      $('direction-link').hidden = !me.roles?.includes('director');
      const assignments = progress.assignments || [];
      renderSummary(assignments);
      renderAssignments(assignments, library.pieces || [], voicePart);
      $('repertoire-status').hidden = true;
      $('repertoire-content').hidden = false;
      try {
        const savedScroll = sessionStorage.getItem('choir-repertoire-scroll');
        if (savedScroll) requestAnimationFrame(() => window.scrollTo(0, Number(savedScroll) || 0));
      } catch (_) {}
    } catch (error) {
      $('repertoire-status').textContent = `Repertorio non disponibile: ${error.message}`;
      $('repertoire-retry').hidden = false;
    }
  }

  $('repertoire-retry').addEventListener('click', () => void initialize());
  window.addEventListener('pagehide', () => { try { sessionStorage.setItem('choir-repertoire-scroll', String(window.scrollY)); } catch (_) {} });
  void initialize();
})();
