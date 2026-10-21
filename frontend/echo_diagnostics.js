(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ChoirEchoDiagnostics=api;})(globalThis,function(){
  'use strict';
  const MAX_SECONDS=60,CHANNELS=['microphone-raw','app-reference','microphone-processed','echo-prediction-unscaled'];
  function wav(chunks,sampleRate,metadata) {
    const frames=chunks.reduce((n,b)=>n+b.valid,0),json=new TextEncoder().encode(JSON.stringify({...metadata,schemaVersion:1,
      channelNames:CHANNELS,sampleRate,frames,format:'float32le',durationSec:frames/sampleRate}));
    const padding=json.length%2,pcmBytes=frames*16;
    const buffer=new ArrayBuffer(44+pcmBytes+8+json.length+padding),v=new DataView(buffer);
    const tag=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
    tag(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);
    v.setUint16(20,3,true);v.setUint16(22,4,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*16,true);
    v.setUint16(32,16,true);v.setUint16(34,32,true);tag(36,'data');v.setUint32(40,pcmBytes,true);
    let at=44;
    for(const b of chunks)for(let i=0;i<b.valid;i++)for(let c=0;c<4;c++){v.setFloat32(at,b.channels[c][i],true);at+=4;}
    tag(at,'chAI');v.setUint32(at+4,json.length,true);new Uint8Array(buffer,at+8,json.length).set(json);
    return new Blob([buffer],{type:'audio/wav'});
  }
  function create(adapter) {
    const $=id=>document.getElementById('echo-test-'+id),modules=new WeakMap();
    let busy=false,preparing=false,pending=null,chunks=[],frames=[],events=[],node=null,silent=null,wiring=[],
      token=0,metadata=null,origin=0,rate=0,stopPromise=null,resolveStop=null,stopTimeout=null,saved=null,saving=false,stopReason=null,
      captureContext=null,onContextStateChange=null;
    const active=()=>busy||preparing;
    const hasPending=()=>Boolean(pending);
    function cleanup(){
      clearTimeout(stopTimeout);stopTimeout=null;
      captureContext?.removeEventListener('statechange',onContextStateChange);captureContext=null;onContextStateChange=null;
      for(const [source]of wiring)try{source.disconnect(node);}catch(_){}wiring=[];
      if(node){node.port.onmessage=null;node.port.close();node.disconnect();node=null;}
      silent?.disconnect();silent=null;
      $('live').hidden=true;
    }
    function resultView(){
      $('intro').hidden=true;$('consent-row').hidden=true;$('start').hidden=true;
      $('retry').hidden=!pending||saving;$('discard').hidden=!pending||saving;$('delete').hidden=!saved||saving;
      $('done').hidden=!saved||saving;
      $('instruction').textContent=saving?'Salvataggio…':saved?'Test salvato':pending?'Test da salvare':'Nessun audio acquisito';
      $('status').textContent=saving?'Invio di voce e misure. Mantieni aperta questa pagina.':saved?'Disponibile per la diagnosi per 7 giorni. Non occorre allegare nulla.':pending?'Il test è ancora su questo dispositivo. Premi Riprova per salvarlo.':'Puoi chiudere e avviare un nuovo test.';
      if(document.visibilityState!=='hidden'){$('dialog').showModal();(pending&&!saving?$('retry'):$('close')).focus();}
    }
    async function savePending(){
      if(!pending||saving)return;
      saving=true;resultView();
      try {
        pending.blob??=wav(pending.chunks,rate,pending.metadata);pending.chunks=[];
        const response=await adapter.save(pending.id,pending.metadata,pending.blob);
        if(!response?.diagnostic?.id)throw Error('Salvataggio non confermato.');
        saved=response.diagnostic;pending=null;
      }catch(error){
        saving=false;resultView();$('status').textContent='Salvataggio non riuscito. Il test è conservato qui: premi Riprova. '+(error.status===401?'Accedi di nuovo in un’altra scheda.':'Controlla la connessione.');return;
      }
      saving=false;resultView();
    }
    async function finish(reason='stopped') {
      if(!active())return;
      busy=false;preparing=false;token++;cleanup();
      const count=chunks.reduce((n,b)=>n+b.valid,0);
      pending=count?{id:crypto.randomUUID(),chunks,frames:count,metadata:{...metadata,stoppedReason:reason,events,pitchFrames:frames,
        echoLifecycleEnd:adapter.lifecycle?.()||null,
        pcmContinuity:{firstFrame:chunks[0]?.firstFrame??null,lastFrameExclusive:chunks.length?chunks.at(-1).firstFrame+chunks.at(-1).valid:null,
          capturedFrames:count,packets:chunks.length,discontinuous:reason==='discontinuous-capture',
          clock:chunks.at(-1)?.clock||null},
        acousticTruth:null,frameClockNote:'PCM counts rendered samples; stale browser timestamps are telemetry. ADC/OS losses are not measured. Pitch callbacks use the analyser/worker bridge.'}}:null;
      chunks=[];frames=[];events=[];saved=null;
      if(resolveStop){resolveStop();resolveStop=null;}stopPromise=null;
      await adapter.pause();resultView();void savePending();
    }
    async function stop(reason='stopped') {
      if(!active())return;
      if(stopPromise)return stopPromise;
      if(!node){await finish(reason);return;}
      stopPromise=new Promise(resolve=>{resolveStop=resolve;});
      stopReason=reason;
      node.port.postMessage('stop');
      stopTimeout=setTimeout(()=>void finish(reason+'-partial-tail'),400);
      return stopPromise;
    }
    async function open(){
      if(active()||saving||!adapter.canOpen())return;
      await adapter.pause({keepMicrophone:true});
      if(hasPending()){resultView();return;}
      pending=null;
      saved=null;
      try { saved=(await adapter.latest())?.diagnostics?.[0]||null; } catch(_) { /* A new capture can still be attempted. */ }
      $('intro').hidden=false;$('consent-row').hidden=false;$('consent').checked=false;
      $('start').hidden=false;$('start').disabled=true;$('retry').hidden=true;$('discard').hidden=true;$('delete').hidden=!saved;$('done').hidden=true;
      $('instruction').textContent='Registra voce e base';
      $('status').textContent=saved?'Un test è già salvato. Avviandone un altro lo sostituisci.':adapter.calibrated()?'Parte dal punto selezionato. Lascia l’introduzione in silenzio, poi canta.':'Calibrazione non verificata: puoi registrare comunque il problema, senza ripetere la guida.';
      $('dialog').showModal();$('consent').focus();
    }
    async function start(){
      if(!$('consent').checked||active())return;
      if(!adapter.ready()){$('status').textContent='Apri un brano e attiva Uso gli altoparlanti nelle impostazioni Base.';return;}
      preparing=true;const current=++token;$('start').disabled=true;$('status').textContent='Attivazione del microfono…';
      try{
        await adapter.startMicrophone();if(current!==token)return;
        const graph=adapter.graph();if(!graph)throw Error('Percorso audio non disponibile.');
        const context=graph.context;rate=context.sampleRate;
        if(!modules.has(context))modules.set(context,context.audioWorklet.addModule('echo_diagnostic_worklet.js'));
        await modules.get(context);if(current!==token)return;
        const startFrame=Math.ceil((context.currentTime+.05)*rate/128)*128;origin=startFrame/rate;
        metadata={createdAt:new Date().toISOString(),...adapter.metadata(),echo:{...graph.profile,impulse:Array.from(graph.profile.impulse)},originContextTime:origin,
          echoLifecycleStart:adapter.lifecycle?.()||null};
        if(!graph.profile.calibrationVerified)$('status').textContent='Rientro non verificato: registriamo il segnale originale per la diagnosi.';
        chunks=[];frames=[];events=[];stopReason=null;
        node=new AudioWorkletNode(context,'choir-echo-diagnostic',{numberOfInputs:4,numberOfOutputs:1,outputChannelCount:[1],
          channelCount:1,channelCountMode:'explicit',processorOptions:{startFrame,maximumFrames:rate*MAX_SECONDS}});
        for(const [i,source]of [graph.raw,graph.reference,graph.processed,graph.prediction].entries()){
          if(source){source.connect(node,0,i);wiring.push([source]);}
        }
        silent=context.createGain();silent.gain.value=0;node.connect(silent);silent.connect(context.destination);
        node.onprocessorerror=()=>void finish('processor-error');
        captureContext=context;onContextStateChange=()=>{
          events.push({type:'audio-context-state-change',state:context.state,contextTime:context.currentTime-origin});
          // Keep only the prefix already delivered; never join across resume.
          void finish(`audio-context-${context.state}`);
        };
        context.addEventListener('statechange',onContextStateChange);
        node.port.onmessage=({data})=>{
          if(current!==token)return;
          if(data.error){events.push({type:data.error,expectedFrame:data.expectedFrame,actualFrame:data.actualFrame});void finish('discontinuous-capture');return;}
          const expected=startFrame+chunks.reduce((n,b)=>n+b.valid,0);
          if(data.firstFrame!==expected){void finish('discontinuous-capture');return;}
          if(data.valid)chunks.push(data);
          const count=chunks.reduce((n,b)=>n+b.valid,0),remaining=Math.ceil(MAX_SECONDS-count/rate);
          $('remaining').textContent=`${remaining} s · voce, base e segnale trattato`;
          if(data.done)void finish(stopReason||'maximum-duration');
        };
        busy=true;preparing=false;$('dialog').close();$('live').hidden=false;
        await adapter.play();
        if(current!==token)return;
        if(!adapter.running())throw Error('Conferma l’uscita audio e riprova ad avviare il test.');
        events.push({contextTime:context.currentTime-origin,...adapter.metadata()});
      }catch(error){
        if(current!==token)return;
        await finish('start-error');$('status').textContent=error.message||'Test non avviato.';
      }
    }
    function requestClose(event){
      if(saving||hasPending()){event?.preventDefault();$('status').textContent=saving?'Attendi il salvataggio prima di chiudere.':'Riprova il salvataggio o scarta il test prima di chiudere.';return;}
      if(preparing){token++;preparing=false;cleanup();void adapter.pause();}
      $('dialog').close();adapter.focus();
    }
    $('open').addEventListener('click',()=>void open());
    $('consent').addEventListener('change',()=>{$('start').disabled=!$('consent').checked;});
    $('start').addEventListener('click',()=>void start());$('stop').addEventListener('click',()=>void stop());
    $('close').addEventListener('click',requestClose);$('dialog').addEventListener('cancel',requestClose);
    $('done').addEventListener('click',requestClose);
    $('dialog').addEventListener('click',e=>{if(e.target!==$('dialog'))return;const r=$('dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)requestClose(e);});
    $('retry').addEventListener('click',()=>void savePending());
    $('discard').addEventListener('click',()=>{if(saving)return;pending=null;chunks=[];frames=[];events=[];$('dialog').close();adapter.focus();});
    $('delete').addEventListener('click',async()=>{
      if(!saved||saving)return;
      saving=true;$('delete').disabled=true;$('status').textContent='Eliminazione…';
      try {await adapter.remove(saved.id);saved=null;$('delete').hidden=true;$('status').textContent='Test eliminato.';}
      catch(_){$('status').textContent='Eliminazione non riuscita. Riprova.';}
      finally{saving=false;$('delete').disabled=false;}
    });
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void stop('background');else if((hasPending()||saved)&&!$('dialog').open)resultView();});
    return Object.freeze({open,stop,isBusy:active,hasPending,onPitchFrame(frame){
      if(!busy||frames.length>=7200)return;
      const graph=adapter.graph();
      frames.push({...frame,contextTime:graph?graph.context.currentTime-origin:null});
      if(frames.length%30===0&&graph)events.push({contextTime:graph.context.currentTime-origin,...adapter.metadata()});
    }});
  }
  return Object.freeze({MAX_SECONDS,CHANNELS,wav,create});
});
