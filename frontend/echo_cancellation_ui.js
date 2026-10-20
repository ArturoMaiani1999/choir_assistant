(() => {
  'use strict';
  const Core = window.ChoirEchoCancellation, Timing = window.ChoirEchoDelay, $ = id => document.getElementById(`echo-${id}`);
  const reasons = {
    capture: 'Misura interrotta. Riprova lasciando aperta la pagina.',
    clipping: 'Il microfono satura. Abbassa il volume delle casse e riprova.',
    weak: 'Il suono di prova è troppo debole. Controlla volume e microfono.',
    validation: 'Il secondo controllo non conferma la riduzione. Riprova senza muovere il dispositivo.',
  };
  function create(adapter) {
    let profile = null, result = null, busy = false, generation = 0, graphGeneration = 0;
    let graph = null, worker = null, timer = null, capture = null, tones = [], raw = null, muted = null;
    let signature = null, scope = null, rejectCapture = null, preparing = false, analysisTimeout = null;
    let heldFloor = 0, floorAt = 0;
    let lastClippingToast = -Infinity;
    const loaded = new WeakMap();
    const listeningKey = `choir-speaker-listening:v1:${adapter.userId()}`;
    try { $('enabled').checked = localStorage.getItem(listeningKey) === 'true'; } catch (_) {}
    const enabled = () => $('enabled').checked;
    const mixer = () => adapter.mixer();
    // Bounded, RAM-only technical history. Exported only with diagnostic consent.
    let journalScope = adapter.userId(), journalId = crypto.randomUUID(), sequence = 0, dropped = 0, modelSequence = 0;
    const journal = [], observations = [], contextIds = new WeakMap(), trackIds = new WeakMap();
    let identitySequence = 0;
    function identity(map, value) {
      if (!value) return null;
      if (!map.has(value)) map.set(value, ++identitySequence);
      return map.get(value);
    }
    function journalAccount() {
      if (journalScope === adapter.userId()) return;
      journalScope = adapter.userId(); journalId = crypto.randomUUID(); journal.length = 0; observations.length = 0; sequence = 0; dropped = 0;
    }
    const appliedGain = () => graph ? -graph.negative.gain.value || 0 : 0;
    function checkpoint(reason, details = {}) {
      journalAccount();
      const context = mixer()?.context, track = adapter.stream()?.getAudioTracks()[0];
      // High-rate monitoring must not evict calibration and routing history.
      const monitoring = reason === 'observation-reason' || reason === 'delay-observation-reason' || reason === 'gain-target' || reason.startsWith('status:');
      const destination = monitoring ? observations : journal;
      destination.push({ sequence: ++sequence, reason, wallTime: Date.now(),
        contextId: identity(contextIds, context), contextTime: context?.currentTime ?? null,
        frame: context ? Math.round(context.currentTime * context.sampleRate) : null,
        sampleRate: context?.sampleRate ?? null, contextState: context?.state ?? null,
        baseLatency: context?.baseLatency ?? null, outputLatency: context?.outputLatency ?? null,
        trackId: identity(trackIds, track), trackState: track?.readyState ?? null,
        graphId: graph?.id ?? null, modelId: graph?.modelId ?? null,
        profilePresent: Boolean(profile), profileAgeMs: profile ? Date.now() - profile.createdAt : null,
        enabled: enabled(), running: Boolean(adapter.running()), status: graph?.status ?? 'idle',
        followerGain: graph?.follower.gain ?? null, appliedGain: appliedGain(),
        targetGain: graph?.targetGain ?? 0, observationReason: graph?.observationReason ?? null,
        delayBaseFrames: graph?.delayBaseFrames ?? 0, delayOffsetFrames: graph?.delayOffsetFrames ?? 0,
        delayTargetFrames: graph?.delayTargetFrames ?? 0, delayReason: graph?.delayReason ?? null, ...details });
      if (destination.length > (monitoring ? 128 : 256)) { destination.shift(); dropped++; }
    }
    function lifecycle() {
      journalAccount();
      return { schemaVersion: 1, sessionId: journalId, droppedEvents: dropped,
        clockNote: 'Frame is the main-thread audio command timestamp, not a sample-exact observation of the AudioParam ramp.',
        events: [...journal, ...observations].sort((a, b) => a.sequence - b.sequence).map(event => ({ ...event })) };
    }
    function disableSubtraction(reason) {
      if (graph) {
        // Assigning .value alone does not remove an earlier setTargetAtTime.
        const now = mixer().context.currentTime;
        graph.negative.gain.cancelScheduledValues(now);
        graph.negative.gain.setValueAtTime(0, now);
        graph.targetGain = 0;
      }
      checkpoint(reason);
    }
    const liveCopy = {
      unverified: ['Rientro · non verificato', 'Nessuna sottrazione applicata. Il test diagnostico resta disponibile.'],
      automatic: ['Rientro · automatico', 'Il livello del rientro viene verificato automaticamente. Premi per ricalibrare.'],
      adjusting: ['Rientro · adeguamento', 'Verifica automatica del percorso audio.'],
      waiting: ['Rientro · in attesa', 'Regolazione mantenuta: voce, segnale tonale o percorso cambiato non permettono un aggiornamento sicuro. Premi per verificare in silenzio.'],
      clipping: ['Rientro · volume alto', 'Il microfono satura. Abbassa il volume e ripeti il controllo.'],
      failed: ['Rientro · da verificare', 'Controllo automatico interrotto. Premi per ricalibrare.'],
    };
    function liveStatus(mode) {
      const button = $('live-status');
      button.hidden = !enabled() || !graph;
      const [label, description] = liveCopy[mode] || liveCopy.automatic;
      if (button.textContent !== label) button.textContent = label;
      button.title = description; button.setAttribute('aria-label', `${label}. ${description}`); button.dataset.state = mode;
      if (graph && graph.status !== mode) { graph.status = mode; checkpoint(`status:${mode}`); }
    }
    function ready() {
      if (profile && (profile.scope !== adapter.userId() || !adapter.running() && Date.now() - profile.createdAt > Core.TTL)) {
        const reason = profile.scope !== adapter.userId() ? 'account-changed' : 'profile-expired';
        checkpoint(`invalidate-before:${reason}`); profile = null;
        disableSubtraction(`invalidate:${reason}`); if (graph) liveStatus('unverified');
      }
      return Boolean(profile && graph && profile.signature === signature);
    }
    function update() {
      $('entry-status').textContent = !enabled() ? 'Non attiva' : ready() ? 'Pronta · livello automatico' : 'Da calibrare';

    }
    function invalidate(reason = 'unspecified') {
      checkpoint(`invalidate-before:${reason}`);
      profile = null;
      disableSubtraction(`invalidate:${reason}`);
      if (graph) liveStatus('unverified');
      if (busy) cancel('Dispositivo cambiato. Ripeti il controllo.');
      update();
    }
    function inputSignature(stream) {
      const settings = stream.getAudioTracks()[0].getSettings();
      if (settings.echoCancellation || settings.noiseSuppression || settings.autoGainControl) throw new Error('Il microfono non consente di disattivare le elaborazioni automatiche. Usa le cuffie.');
      return JSON.stringify({ device: settings.deviceId || null, rate: settings.sampleRate || null,
        channels: settings.channelCount || null, contextRate: mixer().context.sampleRate,
        agc: settings.autoGainControl, ns: settings.noiseSuppression, aec: settings.echoCancellation });
    }
    function inputMatches(stream) {
      try { return inputSignature(stream) === signature; } catch (_) { return false; }
    }
    function detach(reason = 'microphone-stop') {
      checkpoint(`detach-before:${reason}`);
      graphGeneration++;
      preparing = false;
      profile = null;
      heldFloor = 0; floorAt = 0;
      if (!graph) return;
      const old = graph; graph = null;
      try { mixer().referenceOutput.disconnect(old.convolver); } catch (_) {}
      old.worker.terminate(); old.monitor.port.onmessage = null; old.monitor.port.close();
      old.retimer.port.onmessage = null; old.retimer.port.close();
      for (const node of [old.source, old.convolver, old.retimer, old.prediction, old.negative, old.sum, old.output, old.monitor, old.muted]) try { node.disconnect(); } catch (_) {}
      old.output.stream.getTracks().forEach(track => track.stop());
      liveStatus('unverified');
      checkpoint(`detach:${reason}`);
    }
    async function attach(stream) {
      if (!enabled()) return stream;
      checkpoint('attach-request');
      const token = ++graphGeneration;
      await mixer().setReferenceOutput(true); await mixer().resume([]);
      if (token !== graphGeneration) throw new Error('Microfono annullato.');
      const current = inputSignature(stream);
      if (!preparing) throw new Error('Avvia Calibra audio prima di iniziare.');
      signature = current; scope = adapter.userId(); profile = null;
      const context = mixer().context;
      await context.audioWorklet.addModule('echo_monitor_worklet.js');
      await context.audioWorklet.addModule('echo_delay_worklet.js');
      if (token !== graphGeneration) throw new Error('Microfono annullato.');
      const source = context.createMediaStreamSource(stream), sum = context.createGain();
      sum.channelCount = 1; sum.channelCountMode = 'explicit';
      const convolver = context.createConvolver(); convolver.normalize = false;
      const buffer = context.createBuffer(1, 1, context.sampleRate); convolver.buffer = buffer;
      const follower = new Core.GainFollower(1);
      const negative = context.createGain(); negative.gain.value = 0;
      const prediction = context.createAnalyser(); prediction.fftSize = 2048; prediction.smoothingTimeConstant = 0;
      const output = context.createMediaStreamDestination(); output.channelCount = 1;
      // H remains frozen. Only a separately verified broadband scalar may change.
      // Narrow-band/same-F0 output and double talk cannot teach the gain follower.
      const monitor = new AudioWorkletNode(context, 'choir-echo-monitor', { numberOfInputs: 2, numberOfOutputs: 1,
        outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
      const silent = context.createGain(); silent.gain.value = 0;
      const gainWorker = new Worker('echo_cancellation_worker.js');
      const retimer = new AudioWorkletNode(context, 'choir-echo-delay', { numberOfInputs: 1, numberOfOutputs: 1,
        outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
      source.connect(sum); mixer().referenceOutput.connect(convolver); convolver.connect(retimer); retimer.connect(prediction); prediction.connect(negative); negative.connect(sum); sum.connect(output);
      source.connect(monitor, 0, 0); prediction.connect(monitor, 0, 1); monitor.connect(silent); silent.connect(context.destination);
      const active = graph = { id: token, modelId: null, targetGain: 0, source, sum, convolver, retimer, prediction, negative, output, monitor, muted: silent, worker: gainWorker,
        delayEpoch: 0, delayCommand: 0, delayBaseFrames: 0, delayOffsetFrames: 0, delayTargetFrames: 0, retiming: false,
        delayFollower: new Timing.Follower(0, Math.round(context.sampleRate*Timing.MAX_SHIFT_SEC)),
        follower, status: 'automatic', pending: false, settlingUntil: 0, lastCheck: performance.now(), buffer: new Float32Array(2048) };
      liveStatus('unverified');
      checkpoint('attach-complete');
      function failed() {
        if (graph !== active) return;
        follower.reset(); active.delayFollower.reset(); active.pending = false; liveStatus('failed'); checkpoint('monitor-failed');
      }
      monitor.onprocessorerror = failed; gainWorker.onerror = failed;
      retimer.onprocessorerror = failed;
      retimer.port.onmessage = ({data}) => {
        if(graph!==active||data.id!==active.delayCommand)return;
        if(data.type!=='delay-complete'){failed();return;}
        active.retiming=false; active.delayOffsetFrames=data.frames-active.delayBaseFrames;
        active.delayFollower.reset();
        monitor.port.postMessage({type:'reset',epoch:active.delayEpoch});
        checkpoint('delay-complete',{renderFrame:data.renderFrame});
      };
      monitor.port.onmessage = ({ data }) => {
        if (graph !== active || token !== graphGeneration) return;
        if(data.type==='gap'){active.delayFollower.reset();checkpoint('monitor-gap',{expectedFrame:data.expectedFrame,actualFrame:data.actualFrame});return;}
        if (busy || !profile || active.retiming) { monitor.port.postMessage(data, [data.microphone.buffer, data.prediction.buffer]); return; }
        if (!ready() || !inputMatches(stream) || stream.getAudioTracks()[0]?.readyState !== 'live') { failed(); return; }
        gainWorker.postMessage({ ...data, mode: 'gain', sampleRate: context.sampleRate, noiseRms: profile.noiseRms || 0, validationDb: profile.validationDb },
          [data.microphone.buffer, data.prediction.buffer]);
      };
      gainWorker.onmessage = ({ data }) => {
        if (graph !== active || token !== graphGeneration) return;
        if(!ready()||active.retiming||data.epoch!==active.delayEpoch){
          monitor.port.postMessage({microphone:data.microphone,prediction:data.prediction},[data.microphone.buffer,data.prediction.buffer]);return;
        }
        active.lastCheck = performance.now();
        // Never apply an old acoustic observation after a stalled worker/tab.
        const stale = context.currentTime-data.endTime>.35;
        const observation = stale ? {usable:false,reason:'changing'} : data.observation;
        const delay = stale ? {usable:false,reason:'changing'} : data.delayObservation || {usable:false,reason:'capture'};
        const nextDelayReason = delay.reason || 'usable';
        if(active.delayReason!==nextDelayReason){active.delayReason=nextDelayReason;checkpoint('delay-observation-reason');}
        const shift=active.delayFollower.observe(delay,data.endTime,active.delayOffsetFrames);
        if(shift.changed){
          active.retiming=true;active.delayTargetFrames=shift.offsetFrames;active.delayEpoch++;
          retimer.port.postMessage({id:++active.delayCommand,frames:active.delayBaseFrames+shift.offsetFrames,fadeFrames:Math.round(context.sampleRate*.015)});
          follower.reset();active.pending=false;
          checkpoint('delay-command');
          // Raw microphone coefficient and voicing gates are unchanged.
        }
        // A gain observation predates the retime just commanded. Never use it
        // to start a simultaneous gain adjustment on the new alignment.
        const follow = !shift.changed && observation ? follower.observe(observation, data.endTime) : {changed:false,pending:active.pending};
        const nextReason = observation ? observation.reason || 'usable' : active.observationReason;
        if (observation && active.observationReason !== nextReason) {
          active.observationReason = nextReason; checkpoint('observation-reason');
        }
        active.pending = follow.pending;
        if (follow.changed) {
          // Smooth coefficient changes only; raw microphone coefficient stays 1.
          negative.gain.setTargetAtTime(-follow.gain, context.currentTime, .015);
          active.targetGain = follow.gain;
          checkpoint('gain-target');
          active.settlingUntil = performance.now() + 300;
          profile.gain = follow.gain; heldFloor = 0; floorAt = 0;
          adapter.gainChanged?.();
        }
        const reason = delay.reason==='clipping'?'clipping':nextReason==='usable'?null:nextReason;
        const mode = reason === 'clipping' ? 'clipping' : reason === 'capture' ? 'failed'
          : follow.pending || performance.now() < active.settlingUntil ? 'adjusting' : delay.usable ? 'automatic' : reason && reason !== 'weak' ? 'waiting' : 'automatic';
        if (mode === 'clipping' && performance.now() - lastClippingToast > 10_000) {
          lastClippingToast = performance.now(); adapter.notify('Il microfono satura. Abbassa il volume degli altoparlanti.');
        }
        liveStatus(mode);
        monitor.port.postMessage({ microphone: data.microphone, prediction: data.prediction },
          [data.microphone.buffer, data.prediction.buffer]);
      };
      return output.stream;
    }
    function detectionFloor() {
      if (!enabled() || !graph || !profile) return 0;
      if (performance.now() - graph.lastCheck > 1500) liveStatus('failed');
      if (graph.pending || performance.now() < graph.settlingUntil || ['clipping', 'failed'].includes(graph.status)) return Number.MAX_VALUE;
      graph.prediction.getFloatTimeDomainData(graph.buffer);
      let energy = 0;
      for (const v of graph.buffer) energy += v * v;
      const next = 2 * graph.follower.gain * Math.sqrt(energy / graph.buffer.length) * 10 ** (-profile.validationDb / 20);
      const now = performance.now();
      if (next >= heldFloor || now - floorAt > 300) { heldFloor = next; floorAt = now; }
      // Uncertainty affects pitch acceptance, never the microphone waveform.
      return Math.min(.01, heldFloor);
    }
    function clearWork(keepWorker = false) {
      clearInterval(timer); timer = null;
      if (!keepWorker) { worker?.terminate(); worker = null; }
      clearTimeout(analysisTimeout); analysisTimeout = null;
      for (const tone of tones) { try { tone.stop(); } catch (_) {} tone.disconnect(); } tones = [];
      if (capture) {
        try { mixer().referenceOutput.disconnect(capture); } catch (_) {}
        capture.port.onmessage = null; capture.port.close(); capture.disconnect(); capture = null;
      }
      raw?.disconnect(); raw = null; muted?.disconnect(); muted = null;
    }
    function cancel(message = 'Misura interrotta. Puoi riprovare.') {
      checkpoint('measurement-cancel');
      generation++; clearWork(); busy = false; preparing = false;
      const reject = rejectCapture; rejectCapture = null;
      reject?.(new Error(message));
    }
    const open = () => adapter.openCalibration();
    function prepare(reason = 'calibration-start') { preparing = true; invalidate(reason); }
    async function measure(onTick) {
      const token = ++generation; busy = true;
      checkpoint('measurement-start');
      const context = mixer().context, stream = adapter.stream();
      if (!graph || !inputMatches(stream)) throw new Error('Catena audio cambiata. Riprova.');
      if (!loaded.has(context)) loaded.set(context, context.audioWorklet.addModule('echo_capture_worklet.js').catch(error => {
        loaded.delete(context);
        checkpoint('capture-module-load-failed');
        throw error;
      }));
      await loaded.get(context);
      if (token !== generation) throw new Error('Misura annullata.');
      return new Promise((resolve, reject) => {
        rejectCapture = reject;
        const fail = error => { if (token === generation) cancel(error.message); };
        let phase = 'loading';
        onTick(0, false, 'loading'); checkpoint('analysis-worker-loading');
        worker = new Worker('echo_cancellation_worker.js');
        analysisTimeout = setTimeout(() => {
          checkpoint('analysis-worker-load-timeout');
          fail(new Error('Preparazione audio non riuscita. Controlla la connessione e riprova.'));
        }, 12000);
        worker.onerror = () => {
          checkpoint(phase === 'loading' ? 'analysis-worker-load-failed' : 'analysis-worker-failed');
          fail(new Error(phase === 'loading' ? 'Preparazione audio non riuscita. Controlla la connessione e riprova.' : reasons.capture));
        };
        worker.onmessage = ({data: value}) => {
          if (token !== generation) return;
          if (phase === 'loading') {
            if (value.type !== 'ready') return;
            clearTimeout(analysisTimeout); analysisTimeout = null;
            phase = 'capture'; checkpoint('analysis-worker-ready');
            try { startCapture(); } catch (error) { fail(error); }
            return;
          }
          if (phase !== 'analysis') return;
          checkpoint('analysis-result');
          clearWork(); busy = false; rejectCapture = null;
          if (!value.usable) { checkpoint(`measurement-rejected:${value.reason || 'capture'}`); reject(new Error(reasons[value.reason] || reasons.capture)); return; }
          if (!graph || !inputMatches(stream) || document.hidden) { reject(new Error(reasons.capture)); return; }
          const baseFrames=value.retimeBaseFrames||0;
          const buffer = context.createBuffer(1, value.impulse.length-baseFrames, context.sampleRate);
          buffer.copyToChannel(value.impulse.subarray(baseFrames), 0); graph.convolver.buffer = buffer;
          graph.delayBaseFrames=baseFrames;graph.delayOffsetFrames=0;graph.delayTargetFrames=0;graph.delayEpoch++;
          graph.delayFollower=new Timing.Follower(Math.max(-baseFrames,-Math.round(context.sampleRate*Timing.MAX_SHIFT_SEC)),Math.round(context.sampleRate*Timing.MAX_SHIFT_SEC));
          graph.retiming=true;
          graph.retimer.port.postMessage({id:++graph.delayCommand,frames:baseFrames,fadeFrames:0});
          graph.follower.reset(); graph.follower.gain = 1;
          graph.negative.gain.cancelScheduledValues(context.currentTime);
          graph.negative.gain.setValueAtTime(-1, context.currentTime); graph.targetGain = 1;
          graph.modelId = `${journalId}:${++modelSequence}`;
          profile = { ...value, signature, scope, gain: 1, createdAt: Date.now() };
          checkpoint('model-applied');
          graph.lastCheck = performance.now(); update(); resolve(value);
        };
        worker.postMessage({ mode: 'ready' });
        function startCapture() {
          const startFrame = Math.ceil((context.currentTime + .15) * context.sampleRate / 128) * 128;
          const origin = startFrame / context.sampleRate;
          capture = new AudioWorkletNode(context, 'choir-echo-capture', { numberOfInputs: 2, numberOfOutputs: 1,
            outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit',
            processorOptions: { startFrame, length: Math.round(10 * context.sampleRate) } });
          raw = context.createMediaStreamSource(stream); raw.connect(capture, 0, 0); mixer().referenceOutput.connect(capture, 0, 1);
          muted = context.createGain(); muted.gain.value = 0; capture.connect(muted); muted.connect(context.destination);
          capture.onprocessorerror = () => fail(new Error(reasons.capture));
          capture.port.onmessage = ({data}) => {
            if (token !== generation) return;
            if (data.error || !inputMatches(stream) || scope !== adapter.userId()) { fail(new Error(reasons.capture)); return; }
            clearWork(true); phase = 'analysis'; onTick(10, true); checkpoint('analysis-start');
            analysisTimeout = setTimeout(() => {
              checkpoint('analysis-timeout'); fail(new Error(reasons.capture));
            }, 15000);
            worker.postMessage({ ...data, sampleRate: context.sampleRate, compact: true }, [data.microphone.buffer, data.reference.buffer]);
          };
          const amplitude = .08 * adapter.volume();
          for (const [at, seconds, seed] of [[3,3,173],[7,2,957]]) {
            const buffer = context.createBuffer(1, Math.round(seconds * context.sampleRate), context.sampleRate);
            buffer.copyToChannel(Core.noise(buffer.length, amplitude, seed), 0);
            const source = context.createBufferSource(); source.buffer = buffer; source.connect(mixer().referenceOutput);
            source.start(origin + at); tones.push(source);
          }
          timer = setInterval(() => {
            if (token !== generation) return;
            const elapsed = Math.max(0, context.currentTime - origin);
            if (document.hidden || context.state !== 'running' || stream.getAudioTracks()[0].readyState !== 'live'
              || !inputMatches(stream) || adapter.userId() !== scope || elapsed > 11) { fail(new Error(reasons.capture)); return; }
            onTick(elapsed, false);
          }, 50);
        }
      });
    }
    $('enabled').addEventListener('change', async () => {
      try { localStorage.setItem(listeningKey, String(enabled())); } catch (_) {}
      invalidate('listening-mode-changed'); await (adapter.pauseForToggle?.() ?? adapter.pause());
      try { await mixer().setReferenceOutput(enabled()); }
      catch (error) { $('enabled').checked = false; adapter.notify(error.message); }
      adapter.changed(); update();
    });
    $('live-status').addEventListener('click', () => void open());
    update(); checkpoint('created');
    return Object.freeze({ enabled, ready, attach, detach, detectionFloor, open, invalidate, cancel, prepare, measure, checkpoint, lifecycle, refresh: update, isBusy: () => busy,
      diagnostics: () => ({ enabled: enabled(), ready: ready(), status: graph?.status || 'idle',
        gain: appliedGain(), appliedGain: appliedGain(), followerGain: graph?.follower.gain ?? null,
        targetGain: graph?.targetGain ?? 0, graphId: graph?.id ?? null, modelId: graph?.modelId ?? null,
        observationReason: graph?.observationReason ?? null, validationDb: profile?.validationDb ?? null,
        peakDelayMs: profile ? profile.peakDelayMs+(graph?.delayOffsetFrames||0)/mixer().context.sampleRate*1000 : null,
        delayOffsetMs: graph ? graph.delayOffsetFrames/mixer().context.sampleRate*1000 : 0,
        delayTargetMs: graph ? graph.delayTargetFrames/mixer().context.sampleRate*1000 : 0,
        delayReason: graph?.delayReason ?? null }),
      captureGraph: () => graph ? { context: mixer().context, raw: graph.source,
        reference: mixer().referenceOutput, processed: graph.sum, prediction: graph.prediction,
        profile: profile && ready() ? { calibrationVerified: true, modelId: graph.modelId, impulse: profile.impulse, gain: appliedGain(), validationDb: profile.validationDb,
          noiseRms: profile.noiseRms, createdAt: profile.createdAt,retimeBaseFrames:graph.delayBaseFrames,
          delayOffsetFrames:graph.delayOffsetFrames } : { calibrationVerified: false, impulse: new Float32Array([0]), gain: 0,
          validationDb: null, noiseRms: null, createdAt: null }, lifecycle } : null });
  }
  window.ChoirEchoCancellationUI = Object.freeze({create});
})();
