(function scoreViewer() {
  'use strict';

  const config = window.ChoirRuntimeConfig ?? {};
  const els = {
    back: document.getElementById('viewer-back'),
    title: document.getElementById('viewer-title'),
    piece: document.getElementById('viewer-piece'),
    pages: document.getElementById('viewer-pages'),
    status: document.getElementById('viewer-status'),
    position: document.getElementById('viewer-page-position'),
    zoomOut: document.getElementById('viewer-zoom-out'),
    zoomFit: document.getElementById('viewer-zoom-fit'),
    zoomIn: document.getElementById('viewer-zoom-in'),
  };
  let library = [];
  let pageObserver = null;
  let zoom = 960;
  let loadGeneration = 0;
  const paperPreferenceKey = 'choir-score-paper:v1';
  const paperColors = new Set(['#c3c0b6', '#e3e8e6', '#ffffff']);

  function bundleUrl(pieceId) {
    if (!config.bundleUrlTemplate) throw new Error('Configurazione della libreria incompleta');
    return config.bundleUrlTemplate.replace('{pieceId}', encodeURIComponent(pieceId));
  }

  function normalizeSlug(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function proposedTitle(piece) {
    const duplicate = library.filter((item) => item.title.trim().toLowerCase() === piece.title.trim().toLowerCase()).length > 1;
    if (!duplicate) return piece.title;
    const knownVariants = { animachristi: 'SATB', 'animachristi-strofa-monodico': 'Strofe monodiche' };
    const inferred = piece.piece_id.replace(normalizeSlug(piece.title), '').replace(/^-+|-+$/g, '').replace(/-/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    const variant = knownVariants[piece.piece_id] ?? (inferred || 'Versione alternativa');
    return `${piece.title} — ${variant}`;
  }

  function displayTitle(piece) {
    try { return localStorage.getItem(`choir-piece-title:${piece.piece_id}`)?.trim() || proposedTitle(piece); }
    catch (_) { return proposedTitle(piece); }
  }

  function setStatus(message, error = false) {
    els.pages.replaceChildren(els.status);
    els.status.textContent = message;
    els.status.classList.toggle('is-error', error);
    els.status.hidden = false;
    els.pages.setAttribute('aria-busy', String(!error));
    els.position.hidden = true;
  }

  function observePages(pageCount) {
    pageObserver?.disconnect();
    const visibility = new Map();
    pageObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) visibility.set(entry.target, entry.intersectionRatio);
      const current = [...visibility.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
      if (!current) return;
      els.position.value = `Pagina ${current.dataset.page} / ${pageCount}`;
    }, { threshold: [0, .15, .35, .6, .85] });
    document.querySelectorAll('.viewer-page').forEach((page) => pageObserver.observe(page));
  }

  async function openPiece(pieceId, { updateHistory = true } = {}) {
    const generation = ++loadGeneration;
    const piece = library.find((item) => item.piece_id === pieceId) ?? library[0];
    if (!piece) throw new Error('Non ci sono partiture disponibili');
    setStatus('Preparazione della partitura…');
    els.piece.value = piece.piece_id;
    els.title.textContent = displayTitle(piece);
    document.title = `${displayTitle(piece)} · Partitura completa`;
    els.back.href = `index.html?piece=${encodeURIComponent(piece.piece_id)}`;
    if (updateHistory) history.replaceState(null, '', `?piece=${encodeURIComponent(piece.piece_id)}`);
    try { localStorage.setItem('choir-last-practice-piece', piece.piece_id); } catch (_) { /* Optional convenience. */ }

    const response = await fetch(bundleUrl(piece.piece_id), { cache: 'no-store' });
    if (!response.ok) throw new Error('Partitura non disponibile');
    const bundle = await response.json();
    if (generation !== loadGeneration) return;
    const sources = bundle.assets?.full_score_pages ?? [];
    if (!sources.length) throw new Error('Questo brano non ha una partitura completa');

    const fragment = document.createDocumentFragment();
    sources.forEach((source, index) => {
      const page = document.createElement('figure');
      page.className = 'viewer-page';
      page.dataset.page = String(index + 1);
      const image = document.createElement('img');
      image.src = source;
      image.alt = `Pagina ${index + 1} di ${sources.length} · ${displayTitle(piece)}`;
      image.loading = index < 2 ? 'eager' : 'lazy';
      image.decoding = 'async';
      const caption = document.createElement('figcaption');
      caption.textContent = `Pagina ${index + 1} di ${sources.length}`;
      page.append(image, caption);
      fragment.append(page);
    });
    els.pages.replaceChildren(fragment);
    els.pages.setAttribute('aria-busy', 'false');
    els.position.value = `Pagina 1 / ${sources.length}`;
    els.position.hidden = false;
    observePages(sources.length);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function setZoom(nextZoom) {
    zoom = Math.max(560, Math.min(1440, nextZoom));
    document.body.dataset.zoom = 'manual';
    document.documentElement.style.setProperty('--page-width', `${zoom}px`);
  }

  function setPaperColor(value, persist = false) {
    const color = paperColors.has(String(value).toLowerCase()) ? String(value).toLowerCase() : '#c3c0b6';
    document.documentElement.style.setProperty('--score-paper', color);
    document.querySelectorAll('[data-paper]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.paper === color));
    });
    if (persist) {
      try { localStorage.setItem(paperPreferenceKey, color); } catch (_) { /* Optional preference. */ }
    }
  }

  async function initialize() {
    let savedPaper = null;
    try { savedPaper = localStorage.getItem(paperPreferenceKey); } catch (_) { /* Optional preference. */ }
    setPaperColor(savedPaper);
    document.querySelectorAll('[data-paper]').forEach((button) => {
      button.addEventListener('click', () => setPaperColor(button.dataset.paper, true));
    });
    window.addEventListener('storage', (event) => {
      if (event.key === paperPreferenceKey) setPaperColor(event.newValue);
    });
    const response = await fetch(config.libraryUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error('Libreria dei brani non disponibile');
    library = (await response.json()).pieces ?? [];
    if (!library.length) throw new Error('Non ci sono partiture disponibili');
    els.piece.replaceChildren(...library.map((piece) => new Option(displayTitle(piece), piece.piece_id)));
    const requested = new URLSearchParams(location.search).get('piece');
    let remembered = null;
    try { remembered = localStorage.getItem('choir-last-practice-piece'); } catch (_) { /* Optional convenience. */ }
    const selected = [requested, remembered, library[0].piece_id]
      .find((pieceId) => pieceId && library.some((piece) => piece.piece_id === pieceId));
    await openPiece(selected, { updateHistory: requested !== selected });

    els.piece.addEventListener('change', () => openPiece(els.piece.value).catch((error) => setStatus(error.message, true)));
    els.zoomOut.addEventListener('click', () => setZoom(zoom - 120));
    els.zoomIn.addEventListener('click', () => setZoom(zoom + 120));
    els.zoomFit.addEventListener('click', () => { document.body.dataset.zoom = 'fit'; });
    document.addEventListener('keydown', (event) => {
      if (['INPUT', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (event.key === '+' || event.key === '=') setZoom(zoom + 120);
      if (event.key === '-') setZoom(zoom - 120);
      if (event.key === '0') document.body.dataset.zoom = 'fit';
    });
  }

  initialize().catch((error) => {
    els.title.textContent = 'Partitura non disponibile';
    setStatus(error.message, true);
    console.error(error);
  });
}());
