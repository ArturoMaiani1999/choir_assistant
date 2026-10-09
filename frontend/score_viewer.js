(function scoreViewer() {
  'use strict';

  const config = window.ChoirRuntimeConfig ?? {};
  const elementIds = {
    back: 'viewer-back', title: 'viewer-title', piece: 'viewer-piece', pages: 'viewer-pages', status: 'viewer-status',
    position: 'viewer-page-position', zoomOut: 'viewer-zoom-out', zoomFit: 'viewer-zoom-fit', zoomIn: 'viewer-zoom-in',
    play: 'viewer-play', mixerOpen: 'viewer-mixer-open', mixer: 'viewer-mixer', mixerOptions: 'viewer-mixer-options',
    mixerClose: 'viewer-mixer-close', audio: 'viewer-audio', time: 'viewer-time',
  };
  const els = Object.fromEntries(Object.entries(elementIds).map(([key, id]) => [key, document.getElementById(id)]));
  const { MediaElementMixer, buildMediaPlaybackPlan } = window.ChoirMedia;
  const mixer = new MediaElementMixer();
  let library = [], pageObserver = null, zoom = 960, loadGeneration = 0;
  let runtime = null, audioManifest = null, bundle = null, activeElements = [], voiceElements = new Map(), raf = 0, playbackPosition = 0;
  let selections = { accompaniment: true, voices: new Set() }, pageCount = 0, lastCursorPage = -1;
  const paperPreferenceKey = 'choir-score-paper:v1';
  const paperColors = new Set(['#c3c0b6', '#e3e8e6', '#ffffff']);

  function bundleUrl(pieceId) {
    if (!config.bundleUrlTemplate) throw new Error('Configurazione della libreria incompleta');
    return config.bundleUrlTemplate.replace('{pieceId}', encodeURIComponent(pieceId));
  }
  function normalizeSlug(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function proposedTitle(piece) {
    const duplicate = library.filter((item) => item.title.trim().toLowerCase() === piece.title.trim().toLowerCase()).length > 1;
    return duplicate ? `${piece.title} — ${piece.piece_id.replace(normalizeSlug(piece.title), '').replace(/^-+|-+$/g, '').replace(/-/g, ' ') || 'Versione alternativa'}` : piece.title;
  }
  function displayTitle(piece) { try { return localStorage.getItem(`choir-piece-title:${piece.piece_id}`)?.trim() || proposedTitle(piece); } catch (_) { return proposedTitle(piece); } }
  function setStatus(message, error = false) {
    els.pages.replaceChildren(els.status); els.status.textContent = message;
    els.status.classList.toggle('is-error', error); els.status.hidden = false;
    els.pages.setAttribute('aria-busy', String(!error)); els.position.hidden = true;
  }
  function observePages(count) {
    pageObserver?.disconnect(); const visibility = new Map();
    pageObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) visibility.set(entry.target, entry.intersectionRatio);
      const current = [...visibility.entries()].sort((a,b) => b[1]-a[1])[0]?.[0];
      if (current && !els.audio.paused) return;
      if (current) els.position.value = `Pagina ${current.dataset.page} / ${count}`;
    }, { threshold: [0,.15,.35,.6,.85] });
    document.querySelectorAll('.viewer-page').forEach((page) => pageObserver.observe(page));
  }
  function makeAudio(file) {
    if (!file) return null;
    const audio = document.createElement('audio'); audio.preload = 'auto';
    audio.src = new URL(file, `${new URL(bundle.assets.audio_root, location.href).href.replace(/\/$/, '')}/`).href;
    return audio;
  }
  function selectedPlan() {
    const manifest = audioManifest ?? {};
    return buildMediaPlaybackPlan({
      mixFile: manifest.full_mix_file ?? Object.values(manifest.mixes ?? {})[0]?.file,
      accompanimentFile: manifest.accompaniment_file,
      accompanimentEnabled: selections.accompaniment,
      voiceStems: manifest.voice_stems ?? {},
      selectedVoiceIds: [...selections.voices],
    });
  }
  function stopActive() { activeElements.forEach((audio) => { audio.pause(); mixer.release(audio); }); activeElements = []; voiceElements.clear(); }
  async function applyMix({ resume = !els.audio.paused, time = activeElements.length ? els.audio.currentTime : playbackPosition } = {}) {
    if (!audioManifest) return;
    const plan = selectedPlan();
    if (plan.kind === 'muted') { playbackPosition = Math.max(0,time); stopActive(); els.audio.removeAttribute('src'); els.audio.load(); els.play.textContent = '▶ Play'; els.play.setAttribute('aria-pressed','false'); return; }
    const wasPlaying = resume; stopActive();
    const root = bundle.assets.audio_root;
    const masterFile = plan.masterFile;
    const master = makeAudio(masterFile);
    if (!master) throw new Error('Nessuna traccia audio disponibile');
    const stems = plan.voiceStems.map(({ partId, file }) => [partId, makeAudio(file)]).filter(([,audio]) => audio);
    if (plan.masterPartId) voiceElements.set(plan.masterPartId, master);
    stems.forEach(([partId,audio]) => voiceElements.set(partId,audio));
    activeElements = [master, ...stems.map(([,audio]) => audio)];
    // Keep the element used as the clock stable for the animation loop.
    els.audio.src = master.src; els.audio.currentTime = Math.max(0,time); els.audio.load();
    await new Promise((resolve) => {
      if (els.audio.readyState >= 1) resolve();
      else { els.audio.addEventListener('loadedmetadata', resolve, { once:true }); els.audio.addEventListener('error', resolve, { once:true }); }
    });
    els.audio.currentTime = Math.max(0,time);
    // Replace the temporary master with the clock element; preserve routing and levels.
    mixer.release(master); activeElements[0] = els.audio;
    if (plan.masterPartId) voiceElements.set(plan.masterPartId, els.audio);
    const voiceLevel = plan.masterPartId ? 0.8 : 1;
    mixer.setLevel(els.audio, plan.silentMaster ? 0 : voiceLevel);
    for (const [partId,audio] of stems) mixer.setLevel(audio, .8);
    try { await mixer.resume(activeElements); } catch (error) { console.warn('Mixer audio non disponibile', error); }
    for (const audio of activeElements.slice(1)) { audio.currentTime = els.audio.currentTime; }
    if (wasPlaying) await startPlayback(); else updateCursor();
  }
  function updateMixerOptions() {
    const voices = audioManifest?.voice_stems ?? {};
    els.mixerOptions.replaceChildren();
    const accompaniment = document.createElement('label'); accompaniment.className = 'viewer-mixer-choice';
    const acc = document.createElement('input'); acc.type = 'checkbox'; acc.checked = selections.accompaniment;
    acc.addEventListener('change', () => { selections.accompaniment = acc.checked; void applyMix({ resume:false }); });
    accompaniment.append(acc, document.createTextNode(' Organo / accompagnamento')); els.mixerOptions.append(accompaniment);
    for (const part of (bundle.parts ?? [])) {
      if (!(part.id in voices)) continue;
      const label = document.createElement('label'); label.className = 'viewer-mixer-choice';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selections.voices.has(part.id);
      input.addEventListener('change', () => { input.checked ? selections.voices.add(part.id) : selections.voices.delete(part.id); void applyMix({ resume:false }); });
      label.append(input, document.createTextNode(` ${part.name}`)); els.mixerOptions.append(label);
    }
  }
  function totalBeats() { return Math.max(...(runtime?.performanceOccurrences ?? []).map((item) => item.endBeat), ...(runtime?.allTargetEvents ?? []).map((item) => item.onsetBeat + item.durationBeats), 1); }
  function updateCursor() {
    if (!runtime || !pageCount) return;
    const seconds = els.audio.currentTime || playbackPosition; playbackPosition = seconds;
    const beat = runtime.beatAtSeconds(seconds), progress = Math.max(0, Math.min(.9999, beat / totalBeats()));
    const pageIndex = Math.min(pageCount - 1, Math.floor(progress * pageCount));
    const pageProgress = progress * pageCount - pageIndex;
    const page = document.querySelector(`.viewer-page[data-page="${pageIndex + 1}"]`);
    if (page) {
      const line = page.querySelector('.viewer-playhead');
      line.style.left = `${pageProgress * 100}%`;
      if (pageIndex !== lastCursorPage) { lastCursorPage = pageIndex; page.scrollIntoView({ block:'center', behavior:'smooth' }); }
      els.position.value = `Pagina ${pageIndex + 1} / ${pageCount} · Battuta ${runtime.measureAt(beat).number}`;
    }
    els.time.value = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`;
    if (!els.audio.paused) raf = requestAnimationFrame(updateCursor);
  }
  async function startPlayback() {
    if (!activeElements.length) await applyMix({ resume:false });
    if (!activeElements.length) return;
    try { await mixer.resume(activeElements); } catch (_) { /* Native playback fallback remains available. */ }
    await Promise.all(activeElements.map((audio) => { audio.currentTime = els.audio.currentTime; return audio.play(); }));
    els.play.textContent = 'Ⅱ Pausa'; els.play.setAttribute('aria-pressed','true'); cancelAnimationFrame(raf); raf = requestAnimationFrame(updateCursor);
  }
  function pausePlayback() { activeElements.forEach((audio) => audio.pause()); els.play.textContent = '▶ Play'; els.play.setAttribute('aria-pressed','false'); cancelAnimationFrame(raf); updateCursor(); }
  function synchronizeStems() {
    if (els.audio.paused) return;
    for (const audio of activeElements.slice(1)) {
      if (Math.abs(audio.currentTime - els.audio.currentTime) > .08) audio.currentTime = els.audio.currentTime;
    }
  }
  async function openPiece(pieceId, { updateHistory = true } = {}) {
    const generation = ++loadGeneration; pausePlayback(); stopActive();
    const piece = library.find((item) => item.piece_id === pieceId) ?? library[0];
    if (!piece) throw new Error('Non ci sono partiture disponibili');
    setStatus('Preparazione della partitura…'); els.piece.value = piece.piece_id; els.title.textContent = displayTitle(piece);
    document.title = `${displayTitle(piece)} · Mostra partitura`; els.back.href = `index.html?piece=${encodeURIComponent(piece.piece_id)}`;
    if (updateHistory) history.replaceState(null, '', `?piece=${encodeURIComponent(piece.piece_id)}`);
    try { localStorage.setItem('choir-last-practice-piece', piece.piece_id); } catch (_) {}
    const response = await fetch(bundleUrl(piece.piece_id), { cache:'no-store' });
    if (!response.ok) throw new Error('Partitura non disponibile');
    bundle = await response.json(); if (generation !== loadGeneration) return;
    const sources = bundle.assets?.full_score_pages ?? [];
    if (!sources.length) throw new Error('Questo brano non ha una partitura completa');
    const [scoreResponse, audioResponse] = await Promise.all([fetch(bundle.assets.score), fetch(bundle.assets.audio_manifest)]);
    if (!scoreResponse.ok || !audioResponse.ok) throw new Error('Timeline o audio del brano non disponibili');
    const [score, manifest] = await Promise.all([scoreResponse.json(), audioResponse.json()]);
    if (generation !== loadGeneration) return;
    runtime = window.ChoirScore.NormalizedScoreRuntime.fromNormalizedScore(score); audioManifest = manifest; playbackPosition = 0;
    selections = { accompaniment:true, voices:new Set(Object.keys(manifest.voice_stems ?? {})) }; pageCount = sources.length; lastCursorPage = -1;
    const fragment = document.createDocumentFragment();
    sources.forEach((source,index) => {
      const page = document.createElement('figure'); page.className = 'viewer-page'; page.dataset.page = String(index+1);
      const image = document.createElement('img'); image.src = source; image.alt = `Pagina ${index+1} di ${sources.length} · ${displayTitle(piece)}`; image.loading = index < 2 ? 'eager':'lazy'; image.decoding='async';
      const line = document.createElement('div'); line.className='viewer-playhead'; line.setAttribute('aria-hidden','true');
      const caption = document.createElement('figcaption'); caption.textContent=`Pagina ${index+1} di ${sources.length}`;
      page.append(image,line,caption); fragment.append(page);
    });
    els.pages.replaceChildren(fragment); els.pages.setAttribute('aria-busy','false'); els.position.value=`Pagina 1 / ${sources.length}`; els.position.hidden=false;
    updateMixerOptions(); await applyMix({ resume:false, time:0 }); observePages(sources.length); window.scrollTo({top:0,behavior:'auto'});
  }
  function setZoom(nextZoom) { zoom=Math.max(560,Math.min(1440,nextZoom)); document.body.dataset.zoom='manual'; document.documentElement.style.setProperty('--page-width',`${zoom}px`); }
  function setPaperColor(value,persist=false) {
    const color=paperColors.has(String(value).toLowerCase())?String(value).toLowerCase():'#c3c0b6'; document.documentElement.style.setProperty('--score-paper',color);
    document.querySelectorAll('[data-paper]').forEach((button)=>button.setAttribute('aria-pressed',String(button.dataset.paper===color)));
    if(persist)try{localStorage.setItem(paperPreferenceKey,color);}catch(_){}
  }
  async function initialize() {
    try { setPaperColor(localStorage.getItem(paperPreferenceKey)); } catch (_) { setPaperColor(null); }
    document.querySelectorAll('[data-paper]').forEach((button)=>button.addEventListener('click',()=>setPaperColor(button.dataset.paper,true)));
    window.addEventListener('storage',(event)=>{if(event.key===paperPreferenceKey)setPaperColor(event.newValue);});
    const response=await fetch(config.libraryUrl,{cache:'no-store'}); if(!response.ok)throw new Error('Libreria dei brani non disponibile');
    library=(await response.json()).pieces??[]; if(!library.length)throw new Error('Non ci sono partiture disponibili');
    els.piece.replaceChildren(...library.map((piece)=>new Option(displayTitle(piece),piece.piece_id)));
    const requested=new URLSearchParams(location.search).get('piece'); let remembered=null;
    try{remembered=localStorage.getItem('choir-last-practice-piece');}catch(_){}
    const selected=[requested,remembered,library[0].piece_id].find((id)=>id&&library.some((piece)=>piece.piece_id===id));
    await openPiece(selected,{updateHistory:requested!==selected});
    els.piece.addEventListener('change',()=>openPiece(els.piece.value).catch((error)=>setStatus(error.message,true)));
    els.zoomOut.addEventListener('click',()=>setZoom(zoom-120)); els.zoomIn.addEventListener('click',()=>setZoom(zoom+120)); els.zoomFit.addEventListener('click',()=>{document.body.dataset.zoom='fit';});
    els.play.addEventListener('click',()=>els.audio.paused?startPlayback().catch((error)=>setStatus(`Riproduzione non avviata: ${error.message}`,true)):pausePlayback());
    els.mixerOpen.addEventListener('click',()=>{ pausePlayback(); els.mixer.showModal(); });
    els.mixerClose.addEventListener('click',()=>els.mixer.close());
    els.audio.addEventListener('ended',pausePlayback);
    els.audio.addEventListener('timeupdate',synchronizeStems);
    document.addEventListener('keydown',(event)=>{
      if (event.code === 'Space') {
        event.preventDefault();
        event.stopPropagation();
        if (els.audio.paused) startPlayback().catch((error)=>setStatus(`Riproduzione non avviata: ${error.message}`,true));
        else pausePlayback();
        return;
      }
      if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
      if(event.key==='+'||event.key==='=')setZoom(zoom+120);
      if(event.key==='-')setZoom(zoom-120);
      if(event.key==='0')document.body.dataset.zoom='fit';
    });
  }
  initialize().catch((error)=>{els.title.textContent='Partitura non disponibile';setStatus(error.message,true);console.error(error);});
}());
