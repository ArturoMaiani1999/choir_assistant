(() => {
  'use strict';
  const Core = window.ChoirMicrophoneCalibration;
  const $ = id => document.getElementById(`calibration-${id}`);
  const messages = {
    'capture-incomplete': 'Misura interrotta o troppo lenta. Riprova lasciando aperta questa pagina.',
    clipping: 'Il segnale è troppo forte. Allontanati un po’ dal microfono e riprova.',
    'insufficient-separation': 'Voce e rumore sono troppo vicini. Cerca un posto più tranquillo e riprova.',
    'validation-failed': 'La seconda prova non conferma il risultato. Riprova con una vocale comoda.',
    'no-verified-improvement': 'Non ho trovato una regolazione affidabile. Le impostazioni restano quelle di prima.',
  };
  const prefix = `choir-microphone-calibration:v${Core.VERSION}:`;
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } };
  const remove = key => { try { localStorage.removeItem(key); } catch (_) {} };
  const randomId = () => crypto.randomUUID?.() || [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
  async function digest(value) {
    if (!crypto.subtle) return null;
    const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(result)].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function create(adapter) {
    let generation = 0, busy = false, timer = null, worker = null, frames = [], result = null, finished = false;
    let workerDeadline = null, rejectWorkerPreparation = null;
    let chain = null, scope = null, persistable = false, active = null, saved = null, mode = 'full';
    let inputTrack = null, baseline = null, trackerSettings = null, baseSignature = null, activeSignature = null;
    let localSalt = null, anonymousInput = randomId();
    let restoring = false;
    let levels = [], lastMeterAt = -Infinity, clippedUntil = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const account = () => adapter.userId() || 'local-only';
    const currentBaseSignature = () => JSON.stringify({ recognition: Core.settings(adapter.baseline()), tracker: adapter.trackerSettings() });
    const key = () => `${prefix}${scope}:${chain}`;
    function storedProfile() {
      try {
        return Object.keys(localStorage).filter(k=>k.startsWith(`${prefix}${account()}:`))
          .map(read).filter(p=>Core.validProfile(p,account(),p?.chain)&&p.baseSignature===currentBaseSignature()
            &&(scope!==account()||!chain||p.chain===chain)
            &&(p.speakers==null||p.speakers===Boolean(adapter.echo()?.enabled())))
          .sort((a,b)=>b.createdAt-a.createdAt)[0]||null;
      } catch (_) { return null; }
    }
    const percent = number => `${Math.round(number * 100)}%`;
    const setText = (id, text) => { if ($(id).textContent !== text) $(id).textContent = text; };
    function drawLevel() {
      const canvas = $('level'), width = canvas.clientWidth || 320, height = 48;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== height * dpr) {
        canvas.width = Math.round(width * dpr); canvas.height = height * dpr;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
      const styles = getComputedStyle($('dialog'));
      ctx.fillStyle = styles.getPropertyValue('--line').trim();
      ctx.fillRect(0, height - 1, width, 1);
      if (reducedMotion.matches) {
        const db = levels.at(-1) ?? -72;
        ctx.fillStyle = styles.getPropertyValue(db > -3 ? '--amber' : '--cyan').trim();
        ctx.fillRect(0, height / 2 - 5, width * (db + 72) / 72, 10);
        return;
      }
      const slot = width / 80;
      levels.forEach((db, i) => {
        const barHeight = Math.max(1, (db + 72) / 72 * (height - 2));
        ctx.fillStyle = styles.getPropertyValue(db > -3 ? '--amber' : '--cyan').trim();
        ctx.fillRect((80 - levels.length + i) * slot, height - barHeight, Math.max(1, slot - 1), barHeight);
      });
    }
    function resetLevel() {
      levels = []; lastMeterAt = -Infinity; clippedUntil = 0;
      $('signal').dataset.clipped = 'false'; $('level-status').textContent = 'In attesa';
      $('meter').setAttribute('aria-valuenow', '-72'); $('meter').setAttribute('aria-valuetext', 'Microfono spento');
      drawLevel();
    }
    function updateLevel(pcm, elapsed) {
      let energy = 0, peak = 0;
      for (const value of pcm) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
      if (peak >= .99) clippedUntil = elapsed + 1;
      if (elapsed - lastMeterAt < .1) return;
      lastMeterAt = elapsed;
      const rms = Math.sqrt(energy / pcm.length), db = Math.max(-72, Math.min(0, 20 * Math.log10(Math.max(rms, 1e-8))));
      levels.push(db); if (levels.length > 80) levels.shift();
      const clipped = clippedUntil > elapsed;
      const label = clipped ? 'Troppo forte: allontanati' : rms < .001 ? 'Segnale basso' : 'Segnale presente';
      $('signal').dataset.clipped = String(clipped); setText('level-status', label);
      $('meter').setAttribute('aria-valuenow', String(Math.round(db))); $('meter').setAttribute('aria-valuetext', label);
      drawLevel();
    }
    function readyGuide() {
      $('status').setAttribute('aria-live', 'polite');
      setText('step', 'Prima di iniziare'); setText('instruction', 'Segui i segnali');
      setText('hint', 'Scegli una nota comoda: non devi imitarne una precisa.');
      setText('countdown', adapter.echo()?.enabled() ? adapter.echo().isNative?.() ? '30' : '35' : '25'); setText('timer-label', 'secondi totali');
      setText('next', adapter.echo()?.enabled() ? 'Silenzio durante i fruscii, poi due vocali.' : 'Prima il silenzio, poi due vocali: normale e più piano.');
      $('volume-note').hidden = !adapter.echo()?.enabled();
      $('progress').value = 0; resetLevel();
    }
    function hideReport() {
      $('report').hidden = true; $('done').hidden = true;
      delete $('dialog').dataset.phase;
    }
    function showReport(report) {
      // Saved aggregates are display-only. Older local profiles may lack them.
      if (!report || ![report.before, report.after].every(value => value &&
        ['recall', 'specificity', 'balancedAccuracy'].every(k => Number.isFinite(value[k]) && value[k] >= 0 && value[k] <= 1))) return;
      $('report').hidden = false; $('dialog').dataset.phase = 'result';
      $('comparison').textContent = `Verifica: prima ${percent(report.before.balancedAccuracy)} → dopo ${percent(report.after.balancedAccuracy)}`;
      $('voice').textContent = percent(report.after.recall);
      $('silence').textContent = percent(report.after.specificity);
      $('balanced').textContent = percent(report.after.balancedAccuracy);
      const acoustic = adapter.echo()?.diagnostics();
      $('acoustic-result').hidden = !acoustic?.ready;
      if (acoustic?.ready) $('acoustic-result').textContent = acoustic.strategy === 'platform'
        ? 'Riduzione del rientro del dispositivo attiva.' : `Rientro ridotto: ${Math.round(acoustic.validationDb)} dB nella verifica.`;
    }
    function profileDetails(profile) {
      $('details').textContent = `Soglia ingresso: ${profile.settings.rmsThreshold.toPrecision(3)} RMS · confidence minima: ${percent(profile.settings.minConfidence)}\n`
        + `Controllo del ${new Date(profile.createdAt).toLocaleString('it-IT')}. Le stime si riferiscono alla guida originale.`;
      const acoustic = adapter.echo()?.diagnostics();
      if (acoustic?.ready) $('details').textContent += acoustic.strategy === 'platform'
        ? '\nAEC del dispositivo attivo. Il controllo verifica il residuo, senza stimare il ritardo o i dB di cancellazione.'
        : `\nRitardo del percorso: ${acoustic.peakDelayMs.toFixed(1)} ms. Riduzione indipendente: ${acoustic.validationDb.toFixed(1)} dB.`;
    }
    function updateStatus() {
      const stored = Boolean(storedProfile());
      const value = activeSettings() ? 'Profilo voce attivo' : stored ? 'Profilo voce salvato' : 'Da calibrare';
      document.getElementById('settings-calibration-status').textContent = value;
      document.getElementById('settings-calibrate').textContent = stored ? 'Rivedi calibrazione' : 'Calibra audio';
      document.getElementById('settings-calibration-heading').textContent = stored ? 'La tua voce' : 'Prepara la tua voce';
      if (stored) document.getElementById('settings-calibration-hint').textContent = 'Puoi iniziare il brano. Ricalibra solo se necessario.';
    }
    function activeSettings() {
      const input = adapter.input();
      if (active && (input.track !== inputTrack || inputTrack?.readyState !== 'live' || input.context?.state !== 'running'
        || account() !== scope || currentBaseSignature() !== activeSignature)) {
        active = null; queueMicrotask(() => { adapter.changed(); updateStatus(); });
      }
      return active?.chain === chain ? active.settings : null;
    }
    function disable(message) {
      active = null; activeSignature = null;
      adapter.changed(); updateStatus();
      if (message && $('dialog').open) $('status').textContent = message;
    }
    async function microphoneReady() {
      // Restore only after matching the actual acquired device and chain.
      // A restored voice profile is not evidence of a fresh acoustic check.
      if (inputTrack !== adapter.input().track) active = null;
      inputTrack = adapter.input().track;
      const currentTrack = inputTrack;
      currentTrack?.addEventListener('ended', () => {
        if (inputTrack !== currentTrack) return;
        if (busy) cancel('Microfono scollegato. Riprova.');
        inputChanged();
      }, { once: true });
      const settings = inputTrack?.getSettings() || {}, rate = adapter.input().sampleRate;
      scope = account();
      let salt = localSalt || read(`${prefix}salt`);
      if (typeof salt !== 'string') { salt = randomId(); write(`${prefix}salt`, salt); }
      localSalt = salt;
      persistable = Boolean(settings.deviceId && crypto.subtle);
      const inputHash = persistable ? await digest(`${salt}:${settings.deviceId}`) : `session-${anonymousInput}`;
      const description = JSON.stringify({ input: inputHash, settings: Core.chainSettings(settings, rate), speakers: Boolean(adapter.echo()?.enabled()) });
      const nextChain = await digest(description) || description;
      if (chain !== nextChain) active = null;
      chain = nextChain;
      saved = read(key());
      if (!Core.validProfile(saved, scope, chain) || saved.baseSignature !== currentBaseSignature()) saved = null;
      if (saved && !busy && (!adapter.echo()?.enabled() || adapter.echo().isNative?.())) {
        active = { ...saved, verifiedAt: Date.now() }; activeSignature = saved.baseSignature;
      }
      updateStatus();
    }
    function clearWork() {
      clearInterval(timer); timer = null;
      clearTimeout(workerDeadline); workerDeadline = null;
      rejectWorkerPreparation?.(new Error('Preparazione annullata.'));
      rejectWorkerPreparation = null;
      worker?.terminate(); worker = null;
      frames = []; busy = false;
      resetLevel();
    }
    function inputChanged() {
      if (busy) cancel('Dispositivo audio cambiato. Riprova.');
      result = null; saved = null; active = null; chain = null; anonymousInput = randomId();
      finished = false; $('start').textContent = 'Avvia controllo';
      hideReport();
      readyGuide();
     
      disable('Dispositivo audio cambiato. Ripeti il controllo.');
    }
    function cancel(message = 'Misura annullata. Puoi riprovare.') {
      generation += 1; adapter.echo()?.cancel(); clearWork(); result = null;
      finished = false;
      hideReport();
      $('start').hidden = false; $('start').disabled = false; $('start').textContent = 'Avvia controllo';
     
      readyGuide();
      $('status').textContent = message;
      void adapter.stopMicrophone();
    }
    function renderResult(value) {
      result = value; busy = false; frames = [];
      $('dialog').dataset.phase = 'result';
      $('status').setAttribute('aria-live', 'polite');
      $('start').hidden = false; $('start').disabled = false; $('start').textContent = 'Riprova';
     
     
      $('instruction').textContent = value.selected ? value.status === 'baseline' ? 'Impostazioni confermate' : 'Regolazione pronta' : 'Ripetiamo il controllo';
      $('countdown').textContent = ''; $('progress').value = 1;
      $('status').textContent = value.selected ? 'Regolazione applicata. Il microfono resta attivo per la prova.' : messages[value.reason] || 'Non è stato possibile completare la misura.';
      if (value.selected) showReport({ before: value.evaluations[0].validation, after: value.evaluations[value.selectedIndex].validation });
      $('details').textContent = value.selected ? `Stime voce/pausa sulla guida, non accuratezza F0.\n`
        + `Soglia ingresso: ${value.selected.rmsThreshold.toPrecision(3)} RMS · confidence minima: ${percent(value.selected.minConfidence)}\n`
        + value.evaluations.map(e => `${e.index === value.selectedIndex ? '→ ' : ''}Prova ${e.index + 1}: prima parte ${percent(e.train.balancedAccuracy)}, verifica ${percent(e.validation.balancedAccuracy)}; voce ${percent(e.validation.recall)}, pausa ${percent(e.validation.specificity)}`).join('\n')
        : 'Nessuna impostazione è stata modificata. Gli intervalli della guida sono riferimenti approssimativi.';
      if (value.selected) applyResult();
      else { void adapter.stopMicrophone(); $('start').focus(); }
    }
    function prepareVoiceWorker(token) {
      return new Promise((resolve, reject) => {
        worker = new Worker('microphone_calibration_worker.js');
        const pending = worker;
        rejectWorkerPreparation = reject;
        const finish = error => {
          clearTimeout(workerDeadline); workerDeadline = null;
          rejectWorkerPreparation = null;
          if (error) reject(error); else resolve();
        };
        workerDeadline = setTimeout(() => finish(new Error('Preparazione audio troppo lenta. Controlla la connessione e riprova.')), 12000);
        pending.onerror = () => {
          if (token === generation && worker === pending) finish(new Error('Preparazione audio non riuscita. Controlla la connessione e riprova.'));
        };
        pending.onmessageerror = pending.onerror;
        pending.onmessage = ({ data }) => {
          if (token !== generation || worker !== pending || data.type !== 'ready') return;
          finish();
          pending.onerror = () => {
            if (token === generation && worker === pending) cancel('Analisi non disponibile. Riprova.');
          };
          pending.onmessageerror = pending.onerror;
        };
        pending.postMessage({ mode: 'ready' });
      });
    }
    function analyse(token) {
      clearInterval(timer); timer = null;
      $('dialog').dataset.phase = 'result';
      $('status').setAttribute('aria-live', 'polite');
      resetLevel();
      $('instruction').textContent = 'Verifica del segnale'; $('countdown').textContent = '';
      const copy = frames; frames = [];
      if (!worker) { cancel('Analisi non disponibile. Riprova.'); return; }
      workerDeadline = setTimeout(() => {
        if (token === generation) cancel('Analisi troppo lenta. Riprova lasciando aperta questa pagina.');
      }, 15000);
      worker.onmessage = event => {
        if (token !== generation) return;
        if (event.data.type === 'progress') { $('status').textContent = `Analisi locale ${Math.round(event.data.value * 100)}%`; return; }
        if (event.data.type === 'error') { cancel(`Analisi non riuscita: ${event.data.error}`); return; }
        if (event.data.type !== 'result') return;
        const value = event.data.result;
        clearTimeout(workerDeadline); workerDeadline = null;
        worker.terminate(); worker = null;
        if (mode === 'reuse') {
          busy = false;
          if (value.verified && Core.validProfile(saved, scope, chain) && saved.baseSignature === currentBaseSignature()) {
            active = { ...saved, verifiedAt: Date.now() }; activeSignature = saved.baseSignature;
            adapter.changed(); updateStatus();
            finished = true; $('start').textContent = 'Torna alla prova';
            showReport(saved.report); profileDetails(saved);
            $('instruction').textContent = 'Profilo riattivato'; $('status').textContent = 'Rumore compatibile. Ricalibra se cambia la voce o l’ambiente.';
          } else {
            disable(); $('instruction').textContent = 'Serve un nuovo controllo';
            $('status').textContent = 'Il segnale è cambiato. Esegui la guida completa.';
          }
          $('start').disabled = false;
          if (finished) { $('start').hidden = true; $('done').hidden = false; $('instruction').textContent = 'Audio pronto'; $('status').textContent = 'Profilo verificato. Il microfono resta attivo per la prova.'; $('done').focus(); }
          else { saved = null; void start('full'); }
        } else renderResult(value);
      };
      worker.onerror = () => { if (token === generation) cancel('Analisi non disponibile. Riprova.'); };
      worker.onmessageerror = worker.onerror;
      worker.postMessage({ frames: copy, sampleRate: adapter.input().sampleRate, baseline, trackerSettings, mode, profile: mode === 'reuse' ? saved : null, unified: true }, copy.map(f => f.buffer));
      // Keep the same microphone and contexts alive into rehearsal.
      // Full PCM is transferred to a temporary Worker and never persisted.
    }
    async function start(nextMode = 'auto') {
      if (busy) return;
      const token = ++generation;
      busy = true; mode = nextMode; result = null; frames = [];
      finished = false; hideReport();
      resetLevel(); $('dialog').dataset.phase = 'capture';
      $('status').setAttribute('aria-live', 'off');
      $('dialog').querySelector('details').open = false;
      setText('step', 'Attivazione'); setText('instruction', 'Consenti il microfono');
      setText('hint', 'Attendi il countdown. Non cantare ancora.');
      setText('countdown', '—'); setText('timer-label', 'in attesa'); setText('next', 'Poi: preparazione e silenzio.');
     
      $('start').disabled = false; $('start').textContent = 'Interrompi controllo';
      $('status').textContent = 'Attivazione del microfono…'; $('progress').value = 0;
      try {
        if (!window.Worker) throw new Error('Il browser non supporta l’analisi in background.');
        adapter.echo()?.prepare();
        await adapter.startMicrophone();
        if (token !== generation) return;
        await adapter.warmPlayback();
        if (token !== generation) return;
        baseline = Core.settings(adapter.baseline()); trackerSettings = adapter.trackerSettings(); baseSignature = currentBaseSignature();
       
        if (nextMode === 'auto' && saved) mode = 'reuse';
        if (mode === 'reuse' && !saved) throw new Error('Profilo non disponibile per questo microfono.');
        if (mode === 'reuse') setText('next', 'Profilo vocale trovato: basta una verifica in silenzio.');
        if (mode !== 'acoustic' && mode !== 'acoustic-test') {
          setText('instruction', 'Preparazione audio');
          setText('status', 'Il controllo sta per iniziare.');
          await prepareVoiceWorker(token);
          if (token !== generation) return;
        }
        if (adapter.echo()?.enabled()) {
          await adapter.echo().measure((elapsed, analysing, phase) => {
            if (phase === 'native-check') {
              const input=adapter.input(),pcm=new Float32Array(2048);input.analyser.getFloatTimeDomainData(pcm);updateLevel(pcm,elapsed);
              setText('step','Altoparlanti · non cantare');setText('instruction',elapsed<2?'Resta in silenzio':'Ascolta senza cantare');
              setText('hint','Mantieni fermi dispositivo e volume. Sentirai due brevi fruscii.');
              const end=elapsed<2?2:elapsed<5?5:8;
              setText('countdown',String(Math.max(1,Math.ceil(end-elapsed))));setText('timer-label','secondi rimasti');
              setText('next',mode==='acoustic'||mode==='acoustic-test'?'Poi: controllo completato.':'Poi: controllo della voce.');
              setText('status','Verifica della riduzione del rientro del dispositivo.');$('progress').value=elapsed/30;return;
            }
            if (phase === 'loading' || phase === 'retry') {
              setText('step', 'Preparazione'); setText('instruction', 'Preparazione audio');
              setText('hint', 'Mantieni aperta questa pagina.');
              setText('countdown', '…'); setText('timer-label', 'preparazione in corso');
              setText('next', 'Poi: resta in silenzio e ascolta i due segnali.');
              setText('status', phase === 'retry' ? 'Il ritardo è cambiato. Ripetiamo una volta la misura: resta in silenzio.' : 'Il controllo sta per iniziare.');
              return;
            }
            const input = adapter.input(), pcm = new Float32Array(2048);
            input.analyser.getFloatTimeDomainData(pcm); updateLevel(pcm, elapsed);
            setText('step', phase === 'retry-capture' ? 'Ripetizione · non cantare' : 'Altoparlanti · non cantare');
            setText('instruction', analysing ? 'Verifica del rientro' : elapsed < 3 ? 'Resta in silenzio' : 'Ascolta senza cantare');
            setText('hint', analysing ? 'Analisi locale. Rimani in silenzio.' : 'Mantieni fermi dispositivo e volume. Sentirai due fruscii.');
            const end = elapsed < 3 ? 3 : elapsed < 7 ? 7 : 10;
            setText('countdown', analysing ? '…' : String(Math.max(1, Math.ceil(end - elapsed))));
            setText('timer-label', analysing ? 'analisi in corso' : 'secondi rimasti');
            setText('next', mode === 'acoustic-test' ? 'Poi: verifica tecnica del rientro.' : mode === 'acoustic' ? 'La voce è già calibrata. Poi riprende la prova.' : mode === 'reuse' ? 'Poi: verifica del profilo in silenzio.' : 'Poi: controllo della voce.');
            $('progress').value = elapsed / (mode === 'acoustic' ? 10 : mode === 'reuse' ? 18 : 32);
            setText('status', analysing ? 'Controllo su un secondo segnale indipendente.' : 'Stiamo misurando ritardo e risposta degli altoparlanti.');
          });
          if (token !== generation) return;
          await new Promise(resolve => setTimeout(resolve, 350));
        } else {
          for (let count = 3; count > 0; count--) {
            if (token !== generation) return;
            setText('instruction', 'Mettiti comodo'); setText('hint', 'Tra poco misuriamo il silenzio. Non cantare ancora.');
            setText('countdown', String(count)); setText('timer-label', 'secondi alla misura');
            for (let tick = 0; tick < 10; tick++) {
              if (token !== generation) return;
              const input = adapter.input(), pcm = new Float32Array(2048);
              if (!input.analyser || document.hidden) throw new Error('Misura interrotta. Riprova.');
              input.analyser.getFloatTimeDomainData(pcm); updateLevel(pcm, 3 - count + tick / 10);
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        }
        if (token !== generation) return;
        if (mode === 'acoustic-test') {
          busy = false;
          $('instruction').textContent = 'Altoparlanti verificati';
          $('countdown').textContent = ''; $('progress').value = 1;
          $('status').textContent = 'Misura tecnica del rientro. Il profilo vocale non è stato verificato.';
          $('start').hidden = true; $('done').hidden = false;
          return Boolean(adapter.echo()?.ready());
        }
        if (mode === 'acoustic') {
          if (!activeSettings()) throw new Error('Il profilo vocale è cambiato. Ripeti Calibra audio.');
          busy = false; finished = true;
          showReport(active.report); profileDetails(active);
          $('instruction').textContent = 'Audio pronto'; $('countdown').textContent = ''; $('progress').value = 1;
          $('status').textContent = 'Rientro verificato. Profilo vocale mantenuto.';
          $('start').hidden = true; $('done').hidden = false;
          adapter.changed(); updateStatus();
          return true;
        }
        resetLevel();
        const stages = mode === 'reuse' ? Core.REUSE_STAGES : Core.AUDIO_STAGES;
        const input = adapter.input(), origin = input.context.currentTime, duration = stages.at(-1).end;
        const inputDescription = () => JSON.stringify({ input: input.track.getSettings().deviceId || null,
          chain: Core.chainSettings(input.track.getSettings(), input.sampleRate) });
        const expectedInput = inputDescription();
        const pcm = new Float32Array(2048);
        const tick = () => {
          if (token !== generation) return;
          if (document.visibilityState === 'hidden' || input.track.readyState !== 'live' || input.context.state !== 'running') { cancel('Misura interrotta. Riprova lasciando aperta questa pagina.'); return; }
          if (inputDescription() !== expectedInput) { inputChanged(); return; }
          const elapsed = input.context.currentTime - origin;
          if (elapsed >= duration) { analyse(token); return; }
          if (frames.length >= Core.MAX_FRAMES) { cancel(); return; }
          input.analyser.getFloatTimeDomainData(pcm);
          updateLevel(pcm, elapsed);
          const buffer = pcm.slice().buffer;
          const timeSec = elapsed - 1024 / input.sampleRate;
          // Timer callbacks can run twice within the same audio quantum.
          // The analyser then exposes the same window: do not count it twice.
          if (timeSec >= 0 && (!frames.length || timeSec > frames.at(-1).timeSec)) frames.push({ timeSec, buffer });
          const index = stages.findIndex(s => elapsed >= s.start && elapsed < s.end), stage = stages[index], next = stages[index + 1];
          setText('step', `Fase ${index + 1} di ${stages.length} · ${stage.voiced === null ? 'Preparazione' : stage.voiced ? 'Canta' : 'Silenzio'}`);
          setText('instruction', stage.instruction); setText('hint', stage.hint);
          setText('countdown', String(Math.max(1, Math.ceil(stage.end - elapsed)))); setText('timer-label', 'secondi rimasti');
          setText('next', next ? `Poi: ${next.instruction} · ${next.end - next.start} s` : 'Poi: risultati del controllo.');
          const offset = adapter.echo()?.enabled() ? adapter.echo().isNative?.() ? 8 : 10 : 3;
          $('progress').value = (offset + elapsed) / (offset + duration);
          // Countdown is a timer, not a live region: announce the instruction
          // once per phase instead of reading every second over the singer.
          setText('status', `Restano ${Math.ceil(duration - elapsed)} secondi in tutto.`);
        };
        // Let the graph produce one fresh frame before starting the cadence.
        timer = setInterval(tick, 20);
      } catch (error) { if (token === generation) cancel(error.message || 'Microfono non disponibile.'); }
    }
    async function open() {
      if (busy || !adapter.canOpen()) return;
      const token = ++generation;
      await adapter.pause();
      if (token !== generation) return;
      result = null;
      hideReport();
      finished = false;
      $('dialog').querySelector('details').open = false;
      $('start').hidden = false; $('start').disabled = false; $('start').textContent = 'Avvia controllo';
      readyGuide();
      $('status').textContent = 'Il microfono si attiva premendo «Avvia controllo».';
      $('intro').textContent = adapter.echo()?.enabled()
        ? `Circa ${adapter.echo().isNative?.() ? 30 : 35} secondi: ascolto e voce in una sola guida.` : 'Circa 25 secondi: silenzio, voce normale e più piano.';
      $('details').textContent = Core.AUDIO_STAGES.map(s => `${s.end - s.start} s · ${s.instruction}`).join('\n');
      $('progress').value = 0; $('dialog').showModal(); $('start').focus();
      const remembered = activeSettings() ? active : storedProfile();
      if (remembered && (!adapter.echo()?.enabled() || adapter.echo().isNative?.())) {
        finished = true; showReport(remembered.report); profileDetails(remembered);
        $('instruction').textContent = 'Profilo voce salvato';
        $('status').textContent = 'Si riutilizza automaticamente su questo dispositivo. Puoi tornare al brano.';
        $('start').textContent = 'Ricalibra'; $('done').hidden = false; $('done').focus();
      } else if (activeSettings()) {
        finished = true; showReport(active.report); profileDetails(active);
        const check = adapter.echo()?.enabled() && !adapter.echo().ready();
        $('instruction').textContent = check ? 'Voce già calibrata' : 'Calibrazione attiva'; $('countdown').textContent = '';
        $('status').textContent = check ? 'Profilo vocale salvato. Al Play verifichiamo solo il rientro, senza farti ricantare.' : 'Ripeti il controllo se cambia la voce o l’ambiente.';
        $('start').textContent = check ? 'Verifica rientro' : 'Ricalibra'; $('done').hidden = false; $('done').focus();
      }
    }
    $('start').addEventListener('click', () => {
      if (busy) cancel('Controllo interrotto. Puoi ripartire.');
      else void start(adapter.echo()?.isNative?.() || !adapter.echo()?.enabled() ? 'full'
        : activeSettings() ? !adapter.echo().ready() ? 'acoustic' : 'full' : 'auto');
    });
    $('done').addEventListener('click', () => $('dialog').close());
    function applyResult() {
      if (!result?.selected || account() !== scope || currentBaseSignature() !== baseSignature) { cancel('Dispositivo o impostazioni cambiati. Riprova.'); return; }
      const profile = { version: Core.VERSION, detectorVersion: Core.DETECTOR_VERSION, scope, chain,
        settings: result.selected, quality: result.quality, baseSignature, createdAt: Date.now(), speakers: Boolean(adapter.echo()?.enabled()),
        speakerProbeId: adapter.echo()?.enabled() && adapter.echo().isNative?.() ? window.ChoirCalibrationProbe?.id ?? null : null,
        reference: 'guided-weak-labels', validation: result.evaluations[result.selectedIndex].validation,
        report: { before: result.evaluations[0].validation, after: result.evaluations[result.selectedIndex].validation } };
      active = { ...profile, verifiedAt: Date.now() }; activeSignature = baseSignature;
      saved = persistable && write(key(), profile) ? profile : null;
      profileDetails(profile);
      finished = true; $('start').hidden = true; $('done').hidden = false; $('instruction').textContent = 'Audio pronto';
      adapter.changed(); updateStatus(); $('done').focus();
    }
    $('reset').addEventListener('click', () => {
      adapter.echo()?.invalidate('voice-input-changed'); void adapter.stopMicrophone();
      if (scope === account()) remove(key()); saved = null; disable();
      // Delete this account's local profiles, leaving other users isolated.
      try { for (const storedKey of Object.keys(localStorage)) if (storedKey.startsWith(`${prefix}${account()}:`)) remove(storedKey); } catch (_) {}
      if (busy) cancel('Calibrazione reimpostata.');
      result = null;
      finished = false; $('start').hidden = false; $('start').textContent = 'Avvia controllo';
      hideReport();
      $('status').textContent = 'Calibrazione rimossa. Ripristinate le preferenze manuali.';
      readyGuide();
      $('details').textContent = 'Nessuna calibrazione applicata.';
    });
    $('close').addEventListener('click', () => $('dialog').close());
    $('dialog').addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); $('dialog').close(); }
    });
    $('dialog').addEventListener('click', event => {
      if (event.target !== $('dialog')) return;
      const r = $('dialog').getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('dialog').close();
    });
    $('dialog').addEventListener('close', () => {
      // A native close event can arrive after a new opening in the same turn.
      if ($('dialog').open) return;
      if (finished) adapter.resumeAnalysis(); else cancel();
      adapter.returnFocus();
    });
    async function verifyPlayback() {
      if (adapter.echo()?.isNative?.()) {
        if (busy || restoring || !adapter.canOpen()) return false;
        if (activeSettings() && adapter.echo().operational()) return true;
        if (storedProfile()) {
          restoring = true;
          try {
            adapter.echo().prepare();
            await adapter.startMicrophone();
            if (activeSettings() && adapter.echo().operational()) {
              adapter.changed();
              // startMicrophone prepares calibration by stopping live analysis.
              // A restored native profile skips the guide and its close handler,
              // so it must explicitly resume the live detector before Play.
              adapter.resumeAnalysis();
              updateStatus(); return true;
            }
            await adapter.stopMicrophone();
          } catch (_) { await adapter.stopMicrophone(); }
          finally { restoring = false; }
        }
        await open(); return false;
      }
      if (!activeSettings()) { await open(); return false; }
      if (busy || !adapter.canOpen()) return false;
      await open();
      const verified = await start('acoustic');
      if (verified && $('dialog').open) $('dialog').close();
      return Boolean(verified);
    }
    async function measureAcoustic() {
      if (busy || !adapter.canOpen() || !adapter.echo()?.enabled()) return false;
      await open();
      return Boolean(await start('acoustic-test'));
    }
    return Object.freeze({ open, verifyPlayback, measureAcoustic, cancel, microphoneReady, activeSettings, disable, inputChanged, refresh: updateStatus, isBusy: () => busy, isRestoring: () => restoring });
  }
  window.ChoirMicrophoneCalibrationUI = Object.freeze({ create });
})();
