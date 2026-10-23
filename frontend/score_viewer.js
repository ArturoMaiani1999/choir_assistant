(function scoreViewer() {
  'use strict';

  const config = window.ChoirRuntimeConfig ?? {};
  const entryQuery = new URLSearchParams(location.search);
  const elementIds = {
    back: 'viewer-back', title: 'viewer-title', piece: 'viewer-piece', pages: 'viewer-pages', status: 'viewer-status',
    position: 'viewer-page-position', zoomOut: 'viewer-zoom-out', zoomFit: 'viewer-zoom-fit', zoomIn: 'viewer-zoom-in',
    restart: 'viewer-restart', play: 'viewer-play', mixerOpen: 'viewer-mixer-open', mixer: 'viewer-mixer', mixerOptions: 'viewer-mixer-options',
    mixerClose: 'viewer-mixer-close', audio: 'viewer-audio', time: 'viewer-time',
  };
  const els = Object.fromEntries(Object.entries(elementIds).map(([key, id]) => [key, document.getElementById(id)]));
  const { MediaElementMixer, buildMediaPlaybackPlan } = window.ChoirMedia;
  const mixer = new MediaElementMixer();
  let library = [], pageObserver = null, zoom = 960, loadGeneration = 0;
  let runtime = null, audioManifest = null, bundle = null, activeElements = [], voiceElements = new Map(), raf = 0, playbackPosition = 0;
  let selections = { accompaniment: true, voices: new Set() }, pageCount = 0, lastCursorPage = -1, lastCursorSystem = null, fullScoreSlots = [];
  let transportStartedAt = null, transportStartedPosition = 0;
  const presentationTime = new window.PracticeMath.VisualPlaybackTime();
  let waiting = false;
  const seekableAudioUrls = new Map();
  const paperPreferenceKey = 'choir-score-paper:v1';
  const paperColors = new Set(['#c3c0b6', '#e3e8e6', '#ffffff']);

  function releaseAssetUrl(path) {
    if (!path || !config.buildVersion) return path;
    const url = new URL(path, location.href); url.searchParams.set('v', config.buildVersion); return url.href;
  }
  function bundleUrl(pieceId) {
    if (!config.bundleUrlTemplate) throw new Error('Configurazione della libreria incompleta');
    return releaseAssetUrl(config.bundleUrlTemplate.replace('{pieceId}', encodeURIComponent(pieceId)));
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
    const audio = document.createElement('audio'); audio.preload = 'metadata';
    audio.src = releaseAssetUrl(new URL(file, `${new URL(bundle.assets.audio_root, location.href).href.replace(/\/$/, '')}/`).href);
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
  function clearSeekableAudioUrls() { for (const url of seekableAudioUrls.values()) URL.revokeObjectURL(url); seekableAudioUrls.clear(); }
  function waitForMetadata(audio) {
    return new Promise((resolve,reject)=>{
      if(audio.readyState>=1){resolve();return;}
      const cleanup=()=>{audio.removeEventListener('loadedmetadata',ready);audio.removeEventListener('error',failed);};
      const ready=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('Audio non disponibile'));};
      audio.addEventListener('loadedmetadata',ready,{once:true});audio.addEventListener('error',failed,{once:true});
    });
  }
  async function makeAudioRandomAccess(audio) {
    if (!audio || audio.src.startsWith('blob:')) return;
    const source=audio.currentSrc||audio.src; if(!source)return;
    let blobUrl=seekableAudioUrls.get(source);
    if(!blobUrl){const response=await fetch(source,{cache:'force-cache'});if(!response.ok)throw new Error('Audio non disponibile');blobUrl=URL.createObjectURL(await response.blob());seekableAudioUrls.set(source,blobUrl);}
    audio.pause();audio.dataset.originalSource=source;audio.src=blobUrl;audio.load();await waitForMetadata(audio);
  }
  async function ensureRandomAccess(seconds) {
    if (seconds<=.05||Math.abs((els.audio.currentTime||0)-seconds)<.08)return;
    els.pages.classList.add('is-audio-seeking');
    try { await Promise.all(activeElements.map(makeAudioRandomAccess)); }
    finally { els.pages.classList.remove('is-audio-seeking'); }
  }
  function transportSeconds() {
    if (transportStartedAt == null || els.audio.paused) return Math.max(0, els.audio.currentTime || playbackPosition);
    return presentationTime.update({performanceTime:els.audio.currentTime || transportStartedPosition,
      running:!els.audio.ended,speed:els.audio.playbackRate},performance.now(),
      waiting||els.audio.seeking||els.audio.readyState<3||(mixer.context&&mixer.context.state!=='running'));
  }
  async function applyMix({ resume = !els.audio.paused, time = activeElements.length ? transportSeconds() : playbackPosition } = {}) {
    if (!audioManifest) return;
    playbackPosition=Math.max(0,Number(time)||0);
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
    if (wasPlaying) {
      try { await mixer.resume(activeElements); } catch (error) { console.warn('Mixer audio non disponibile', error); }
    }
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
  function points(element) {
    return (element.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  }
  function clusterBarXs(values) {
    const clusters = [];
    [...values].sort((a,b)=>a-b).forEach((value) => {
      const cluster = clusters.at(-1);
      if (cluster && value - cluster.at(-1) < 140) cluster.push(value);
      else clusters.push([value]);
    });
    // Double/repeat barlines form one musical boundary. Keep their right edge.
    return clusters.map((cluster)=>Math.max(...cluster));
  }
  function parseFullScorePage(svg, page) {
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const [, , width = 0, height = 0] = (document.documentElement.getAttribute('viewBox') ?? '').trim().split(/\s+/).map(Number);
    const rawStaffLines = [...document.querySelectorAll('.StaffLines')].map((element)=>points(element)).filter((value)=>value.length>=4);
    const barLines = [...document.querySelectorAll('.BarLine')].map((element)=>points(element)).filter((value)=>value.length>=4)
      .map((value)=>({x:value[0],y1:value[1],y2:value[3]}));
    const symbols = [...document.querySelectorAll('.Note, .Rest')].map((element) => {
      const matrix=(element.getAttribute('transform')??'').match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([-+\d.eE]+),\s*([-+\d.eE]+)\)/);
      const path=(element.getAttribute('d')??'').match(/^\s*M\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)/);
      const anchor=matrix??path;
      return anchor ? { x:Number(anchor[1]), y:Number(anchor[2]), kind:element.classList.contains('Note')?'note':'rest' } : null;
    }).filter((symbol)=>symbol&&Number.isFinite(symbol.x)&&Number.isFinite(symbol.y));
    const staffs = [];
    for(let index=0;index+4<rawStaffLines.length;index+=5){
      const lines=rawStaffLines.slice(index,index+5);
      const staff={startX:Math.min(...lines.map((line)=>line[0])),endX:Math.max(...lines.map((line)=>line[2])),
        topY:Math.min(...lines.map((line)=>line[1])),bottomY:Math.max(...lines.map((line)=>line[1]))};
      staff.barXs=clusterBarXs(barLines.filter((bar)=>Math.abs(bar.y1-staff.topY)<35&&bar.x>=staff.startX-50&&bar.x<=staff.endX+50).map((bar)=>bar.x));
      staff.signature=staff.barXs.map((value)=>Math.round(value/10)*10).join(':'); staffs.push(staff);
    }
    return {page,width,height,staffs,symbols};
  }
  async function buildFullScoreSlots(sources) {
    const pages = await Promise.all(sources.map(async (source,index)=>{
      const response=await fetch(source,{cache:'force-cache'}); if(!response.ok)throw new Error('Geometria della partitura non disponibile');
      return parseFullScorePage(await response.text(),index+1);
    }));
    const runLengths=[];
    pages.forEach((page)=>{let signature=null,length=0;page.staffs.forEach((staff)=>{
      if(signature==null||staff.signature===signature)length+=1;
      else{runLengths.push(length);length=1;} signature=staff.signature;
    });if(length)runLengths.push(length);});
    const frequencies=new Map();runLengths.forEach((length)=>frequencies.set(length,(frequencies.get(length)??0)+1));
    const staffsPerSystem=[...frequencies].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]??1;
    const slots=[];
    pages.forEach((page)=>{
      for(let index=0;index<page.staffs.length;index+=staffsPerSystem){
        const system=page.staffs.slice(index,index+staffsPerSystem);if(!system.length)continue;
        const first=system[0],last=system.at(-1),barXs=first.barXs;
        for(let boundary=0;boundary+1<barXs.length;boundary+=1){
          if(barXs[boundary+1]-barXs[boundary]<140)continue;
          let startX=barXs[boundary];
          if(boundary===0){
            const inFirstMeasure=(symbol)=>symbol.y>=first.topY-500&&symbol.y<=last.bottomY+500
              &&symbol.x>startX+20&&symbol.x<barXs[boundary+1];
            const notes=page.symbols.filter((symbol)=>symbol.kind==='note'&&inFirstMeasure(symbol));
            const rests=page.symbols.filter((symbol)=>symbol.kind==='rest'&&inFirstMeasure(symbol));
            const firstSymbolX=Math.min(...(notes.length?notes:rests).map((symbol)=>symbol.x));
            if(Number.isFinite(firstSymbolX))startX=firstSymbolX;
          }
          slots.push({page:page.page,startX:startX/page.width*100,barStartX:barXs[boundary]/page.width*100,endX:barXs[boundary+1]/page.width*100,
            topY:first.topY/page.height*100,bottomY:last.bottomY/page.height*100,
            systemId:`p${page.page}-s${Math.floor(index/staffsPerSystem)+1}`});
        }
      }
    });
    return slots;
  }
  function scorePositionAtBeat(beat) {
    if(!runtime||!fullScoreSlots.length)return null;
    const safeBeat=Math.max(0,beat),occurrences=runtime.performanceOccurrences??[];
    // secondsAtBeat()/beatAtSeconds() may return a value a few ulps before an
    // exact measure boundary. Prefer that boundary so a seek cannot leave the
    // cursor at the final glyph of the preceding system.
    const boundary=occurrences.find((item)=>Math.abs(item.startBeat-safeBeat)<1e-4);
    const occurrence=boundary??occurrences.find((item)=>item.startBeat<=safeBeat&&safeBeat<item.endBeat)??occurrences.at(-1);
    if(!occurrence)return null;
    const measureIndex=runtime.measures.findIndex((measure)=>measure.id===occurrence.writtenMeasureId),slot=fullScoreSlots[measureIndex];
    if(!slot)return null;
    const progress=Math.max(0,Math.min(1,(safeBeat-occurrence.startBeat)/Math.max(.001,occurrence.endBeat-occurrence.startBeat)));
    return {...slot,x:slot.startX+(slot.endX-slot.startX)*progress,measureNumber:runtime.measures[measureIndex]?.number??'?'};
  }
  function occurrenceForWrittenMeasure(measureIndex) {
    const writtenMeasure = runtime?.measures?.[measureIndex];
    if (!writtenMeasure) return null;
    const occurrences = (runtime.performanceOccurrences ?? []).filter((item)=>item.writtenMeasureId===writtenMeasure.id);
    if (!occurrences.length) return null;
    const currentBeat = runtime.beatAtSeconds(els.audio.currentTime || playbackPosition);
    return occurrences.find((item)=>item.startBeat<=currentBeat&&currentBeat<item.endBeat)
      ?? occurrences.find((item)=>item.startBeat>=currentBeat-.001) ?? occurrences[0];
  }
  function setPlaybackTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0); playbackPosition = safeSeconds;
    transportStartedPosition=safeSeconds;transportStartedAt=els.audio.paused?null:performance.now();
    for (const audio of activeElements) {
      try { audio.currentTime = safeSeconds; } catch (_) { /* Metadata retry occurs when playback starts. */ }
    }
    try { els.audio.currentTime = safeSeconds; } catch (_) {}
    lastCursorPage = -1; lastCursorSystem = null; updateCursor();
  }
  async function startFromBeat(beat) {
    if (!runtime) return;
    const safeBeat = Math.max(0, Math.min(totalBeats(), Number(beat) || 0));
    const seconds = runtime.secondsAtBeat(safeBeat); setPlaybackTime(seconds); await ensureRandomAccess(seconds); setPlaybackTime(seconds);
    els.pages.dataset.lastSeekBeat = String(safeBeat); els.pages.dataset.lastSeekSeconds = String(seconds);
    await startPlayback();
  }
  async function startFromScore(measureIndex, progress = 0) {
    const occurrence = occurrenceForWrittenMeasure(measureIndex); if (!occurrence) return;
    const ratio = Math.max(0, Math.min(.999, Number(progress) || 0));
    const beat = occurrence.startBeat + (occurrence.endBeat - occurrence.startBeat) * ratio;
    els.pages.dataset.lastSeekMeasure = String(runtime.measures[measureIndex]?.number ?? measureIndex + 1);
    await startFromBeat(beat);
  }
  function installMeasureTargets() {
    for (const [measureIndex, slot] of fullScoreSlots.entries()) {
      const page = document.querySelector(`.viewer-page[data-page="${slot.page}"]`); if (!page) continue;
      const target = document.createElement('button'); target.type = 'button'; target.className = 'viewer-measure-hit';
      const measureNumber = runtime.measures[measureIndex]?.number ?? measureIndex + 1;
      target.setAttribute('aria-label', `Riproduci dalla battuta ${measureNumber}`); target.title = `Riproduci dalla battuta ${measureNumber}`;
      target.dataset.measureIndex = String(measureIndex); target.dataset.systemId=slot.systemId; target.dataset.barStartX=String(slot.barStartX);
      target.style.left = `${slot.startX}%`; target.style.top = `${slot.topY}%`;
      target.style.width = `${slot.endX-slot.startX}%`; target.style.height = `${slot.bottomY-slot.topY}%`;
      target.addEventListener('click',(event)=>{
        const rect=target.getBoundingClientRect();
        const progress=event.detail===0?0:(event.clientX-rect.left)/Math.max(1,rect.width);
        startFromScore(measureIndex,progress).catch(handlePlaybackError);
      });
      page.append(target);
    }
  }
  function centerActiveSystem(page, position) {
    if (!position || !page.getBoundingClientRect().height) return;
    const pageRect=page.getBoundingClientRect(),toolbar=document.querySelector('.viewer-toolbar')?.getBoundingClientRect();
    const transport=document.querySelector('.viewer-transport')?.getBoundingClientRect();
    const chromeGap=8;
    const visibleTop=Math.max(0,toolbar?.bottom??0)+chromeGap;
    const visibleBottom=Math.max(visibleTop+80,Math.min(innerHeight,(transport?.top??innerHeight)-chromeGap));
    const systemCenter=pageRect.top+pageRect.height*(position.topY+position.bottomY)/200;
    const viewportCenter=(visibleTop+visibleBottom)/2;
    window.scrollTo({top:window.scrollY+systemCenter-viewportCenter,behavior:'auto'});
  }
  function updateCursor() {
    if (!runtime || !pageCount) return;
    const seconds = transportSeconds(); playbackPosition = seconds; els.pages.dataset.playbackSeconds=String(seconds);
    const beat = runtime.beatAtSeconds(seconds), position = scorePositionAtBeat(beat);
    const progress = Math.max(0, Math.min(.9999, beat / totalBeats()));
    const pageIndex = position ? position.page - 1 : Math.min(pageCount - 1, Math.floor(progress * pageCount));
    const page = document.querySelector(`.viewer-page[data-page="${pageIndex + 1}"]`);
    if (page) {
      const line = page.querySelector('.viewer-playhead');
      document.querySelectorAll('.viewer-playhead.is-active').forEach((item)=>item.classList.remove('is-active'));
      if(position){line.style.left=`${position.x}%`;line.style.top=`${position.topY}%`;line.style.height=`${position.bottomY-position.topY}%`;line.dataset.measure=String(position.measureNumber);}
      else{line.style.left=`${(progress*pageCount-pageIndex)*100}%`;line.style.top='0';line.style.height='100%';line.dataset.measure='';}
      line.classList.add('is-active');
      const systemKey=position?.systemId??`page-${pageIndex+1}`;
      if(systemKey!==lastCursorSystem){lastCursorPage=pageIndex;lastCursorSystem=systemKey;centerActiveSystem(page,position);}
      els.position.value = `Pagina ${pageIndex + 1} / ${pageCount} · Battuta ${runtime.measureAt(beat).number}`;
    }
    els.time.value = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`;
    if (!els.audio.paused) raf = requestAnimationFrame(updateCursor);
  }
  async function startPlayback() {
    if (!activeElements.length) await applyMix({ resume:false });
    if (!activeElements.length) return;
    try { await mixer.resume(activeElements); } catch (_) { /* Native playback fallback remains available. */ }
    // playbackPosition remains authoritative while a freshly loaded media
    // element is still reporting zero for a seek it has already accepted.
    const requestedTime = Math.max(0, playbackPosition);
    for(const audio of activeElements)audio.currentTime=requestedTime;
    await mixer.playTogether(activeElements);
    transportStartedPosition=requestedTime;transportStartedAt=performance.now();
    els.play.textContent = 'Ⅱ Pausa'; els.play.setAttribute('aria-pressed','true'); cancelAnimationFrame(raf); raf = requestAnimationFrame(updateCursor);
  }
  function pausePlayback() {
    mixer.cancelGroupStart();presentationTime.reset();
    playbackPosition=transportSeconds();transportStartedAt=null;
    activeElements.forEach((audio) => audio.pause());
    els.play.textContent = '▶ Play'; els.play.setAttribute('aria-pressed','false'); cancelAnimationFrame(raf); updateCursor();
  }
  function handlePlaybackError(error) {
    // A rapid play/pause gesture can reject an older play() promise after the
    // audio has already been paused. It is expected and must not replace the score.
    if (error?.name === 'AbortError' || /interrupted by a call to pause/i.test(error?.message ?? '')) return;
    pausePlayback();
    els.play.title = `Riproduzione non avviata: ${error?.message || 'errore audio'}`;
    console.warn('Riproduzione non avviata', error);
  }
  function synchronizeStems() {
    mixer.synchronize(els.audio,activeElements.slice(1));
  }
  async function openPiece(pieceId, { updateHistory = true } = {}) {
    const generation = ++loadGeneration; pausePlayback(); stopActive(); clearSeekableAudioUrls();
    const piece = library.find((item) => item.piece_id === pieceId) ?? library[0];
    if (!piece) throw new Error('Non ci sono partiture disponibili');
    setStatus('Preparazione della partitura…'); els.piece.value = piece.piece_id; els.title.textContent = displayTitle(piece);
    document.title = `${displayTitle(piece)} · Mostra partitura · Xynon`;
    const backQuery = new URLSearchParams({ piece: piece.piece_id });
    if (entryQuery.get('from') === 'repertorio') backQuery.set('from', 'repertorio');
    const returning = piece.piece_id === entryQuery.get('piece') && entryQuery.has('resume');
    if (returning) for (const key of ['part', 'resume', 'entry']) {
      if (entryQuery.has(key)) backQuery.set(key, entryQuery.get(key));
    }
    const fromMenu = entryQuery.get('from') === 'menu';
    els.back.href = fromMenu ? 'index.html' : `index.html?${backQuery}`;
    els.back.textContent = fromMenu ? 'Menù' : returning ? 'Torna alla prova' : 'Canta questo brano';
    if (updateHistory) {
      const query = new URLSearchParams({ piece: piece.piece_id });
      if (fromMenu) query.set('from', 'menu');
      history.replaceState(null, '', `?${query}`);
    }
    try { localStorage.setItem('choir-last-practice-piece', piece.piece_id); } catch (_) {}
    const response = await fetch(bundleUrl(piece.piece_id), { cache:'force-cache' });
    if (!response.ok) throw new Error('Partitura non disponibile');
    bundle = await response.json(); if (generation !== loadGeneration) return;
    const sources = (bundle.assets?.full_score_pages ?? []).map(releaseAssetUrl);
    if (!sources.length) throw new Error('Questo brano non ha una partitura completa');
    const [scoreResponse, audioResponse, scoreSlots] = await Promise.all([
      fetch(releaseAssetUrl(bundle.assets.score),{cache:'force-cache'}),
      fetch(releaseAssetUrl(bundle.assets.audio_manifest),{cache:'force-cache'}),
      buildFullScoreSlots(sources),
    ]);
    if (!scoreResponse.ok || !audioResponse.ok) throw new Error('Timeline o audio del brano non disponibili');
    const [score, manifest] = await Promise.all([scoreResponse.json(), audioResponse.json()]);
    if (generation !== loadGeneration) return;
    runtime = window.ChoirScore.NormalizedScoreRuntime.fromNormalizedScore(score); audioManifest = manifest; playbackPosition = 0; fullScoreSlots=scoreSlots;
    els.pages.dataset.measureSlots=String(fullScoreSlots.length);els.pages.dataset.measures=String(runtime.measures.length);
    if(fullScoreSlots.length!==runtime.measures.length)console.warn('Geometria battute partitura incompleta',{slots:fullScoreSlots.length,measures:runtime.measures.length});
    selections = { accompaniment:true, voices:new Set(Object.keys(manifest.voice_stems ?? {})) }; pageCount = sources.length; lastCursorPage = -1; lastCursorSystem = null;
    const fragment = document.createDocumentFragment();
    sources.forEach((source,index) => {
      const page = document.createElement('figure'); page.className = 'viewer-page'; page.dataset.page = String(index+1);
      const image = document.createElement('img'); image.src = source; image.alt = `Pagina ${index+1} di ${sources.length} · ${displayTitle(piece)}`; image.loading = index < 2 ? 'eager':'lazy'; image.decoding='async';
      image.addEventListener('load',()=>{if(page.querySelector('.viewer-playhead.is-active')){lastCursorSystem=null;updateCursor();}},{once:true});
      const line = document.createElement('div'); line.className='viewer-playhead'; line.setAttribute('aria-hidden','true');
      const caption = document.createElement('figcaption'); caption.textContent=`Pagina ${index+1} di ${sources.length}`;
      page.append(image,line,caption); fragment.append(page);
    });
    els.pages.replaceChildren(fragment); els.pages.setAttribute('aria-busy','false'); els.position.value=`Pagina 1 / ${sources.length}`; els.position.hidden=false;
    // Reset the old piece before exposing the score hit targets. A later reset
    // would override a fast user's seek while audio metadata is still loading.
    window.scrollTo({top:0,behavior:'auto'});
    installMeasureTargets(); updateMixerOptions(); await applyMix({ resume:false, time:0 }); observePages(sources.length);
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
    const response=await fetch(releaseAssetUrl(config.libraryUrl),{cache:'force-cache'}); if(!response.ok)throw new Error('Libreria dei brani non disponibile');
    library=(await response.json()).pieces??[]; if(!library.length)throw new Error('Non ci sono partiture disponibili');
    els.piece.replaceChildren(...library.map((piece)=>new Option(displayTitle(piece),piece.piece_id)));
    const requested=new URLSearchParams(location.search).get('piece'); let remembered=null;
    try{remembered=localStorage.getItem('choir-last-practice-piece');}catch(_){}
    const selected=[requested,remembered,library[0].piece_id].find((id)=>id&&library.some((piece)=>piece.piece_id===id));
    els.piece.addEventListener('change',()=>openPiece(els.piece.value).catch((error)=>setStatus(error.message,true)));
    els.zoomOut.addEventListener('click',()=>setZoom(zoom-120)); els.zoomIn.addEventListener('click',()=>setZoom(zoom+120)); els.zoomFit.addEventListener('click',()=>{document.body.dataset.zoom='fit';});
    els.restart.addEventListener('click',()=>startFromBeat(0).catch(handlePlaybackError));
    els.play.addEventListener('click',()=>els.audio.paused?startPlayback().catch(handlePlaybackError):pausePlayback());
    els.mixerOpen.addEventListener('click',()=>{ pausePlayback(); els.mixer.showModal(); });
    els.mixerClose.addEventListener('click',()=>els.mixer.close());
    els.mixer.addEventListener('click', event => {
      if (event.target !== els.mixer) return;
      const bounds = els.mixer.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) els.mixer.close();
    });
    els.audio.addEventListener('ended',pausePlayback);
    els.audio.addEventListener('timeupdate',synchronizeStems);
    for(const event of ['play','pause','seeking','seeked','ratechange','emptied','ended'])
      els.audio.addEventListener(event,()=>{presentationTime.reset();if(['play','emptied','ended'].includes(event))waiting=false;});
    els.audio.addEventListener('waiting',()=>{waiting=true;presentationTime.reset();activeElements.slice(1).forEach(audio=>audio.pause());});
    els.audio.addEventListener('playing',()=>{
      waiting=false;presentationTime.reset();
      if(!mixer.startingGroup)for(const audio of activeElements.slice(1)){
        audio.currentTime=els.audio.currentTime;void audio.play().catch(handlePlaybackError);
      }
    });
    window.addEventListener('pagehide',clearSeekableAudioUrls);
    document.addEventListener('keydown',(event)=>{
      if (els.mixer.open || ['INPUT','SELECT','TEXTAREA','BUTTON','A'].includes(document.activeElement?.tagName)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        event.stopPropagation();
        if (els.audio.paused) startPlayback().catch(handlePlaybackError);
        else pausePlayback();
        return;
      }
      if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
      if(event.key==='+'||event.key==='=')setZoom(zoom+120);
      if(event.key==='-')setZoom(zoom-120);
      if(event.key==='0')document.body.dataset.zoom='fit';
    });
    await openPiece(selected,{updateHistory:requested!==selected});
  }
  initialize().then(()=>window.ChoirStartup?.ready()).catch((error)=>{window.ChoirStartup?.fail();els.title.textContent='Partitura non disponibile';setStatus(error.message,true);console.error(error);});
}());
