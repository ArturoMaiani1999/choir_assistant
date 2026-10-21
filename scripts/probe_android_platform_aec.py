"""Paired, sequential platform-AEC experiment on the authorized staging tab.

Default is read-only. --run requires quiet/foreground readiness. Uses one
microphone at a time, the real app output bus and metronome, and preserves
continuous prefixes on capture errors. No custom subtraction or voice-profile
updates. Original Android and metronome volumes are restored.
"""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import urllib.request
from urllib.parse import urlsplit

import numpy as np
import websocket
from browser_practice_smoke import evaluate
from probe_android_calibration import export_array, volume_adjustment

INSPECT = r"""(async()=>({
  build:typeof RUNTIME_CONFIG==='undefined'?null:RUNTIME_CONFIG.buildVersion,
  visible:document.visibilityState,ua:navigator.userAgent,
  microphone:typeof state==='undefined'?null:state.microphoneStatus,
  running:typeof state==='undefined'?null:Boolean(state.clock?.running),
  constraints:navigator.mediaDevices.getSupportedConstraints(),
  inputs:(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput').map(d=>{
    const c=d.getCapabilities?.()||{};return {echoCancellation:c.echoCancellation,voiceIsolation:c.voiceIsolation,
      noiseSuppression:c.noiseSuppression,autoGainControl:c.autoGainControl,sampleRate:c.sampleRate};})
}))()"""

INSTALL = r"""(async()=>{
  if(document.hidden||state.clock?.running||state.microphoneStatus!=='idle'
    ||microphoneCalibrationUI.isBusy()||echoDiagnosticsUI.isBusy()||echoDiagnosticsUI.hasPending())
    throw Error('Keep the app visible and stop any active audio session');
  if(!echoCancellationUI.enabled())throw Error('Select speaker listening before the experiment');
  if(window.platformAecProbe?.active)throw Error('Experiment already active');
  const manifest=await(await fetch('deployment-manifest.json',{cache:'no-store'})).json();
  if(manifest.build_version!==__BUILD__)throw Error('Build changed');
  const worklet=Object.keys(manifest.files).find(n=>/^echo_diagnostic_worklet\.[a-f0-9]+\.js$/.test(n));
  if(!worklet)throw Error('Diagnostic worklet missing');
  await state.playbackMixer.resume([]);
  if(!state.playbackMixer.referenceOutput)await state.playbackMixer.setReferenceOutput(true);
  const context=state.playbackMixer.context,reference=state.playbackMixer.referenceOutput;
  if(!reference)throw Error('App output reference missing');
  await context.audioWorklet.addModule(worklet);
  const p=window.platformAecProbe={active:true,kind:'echo',build:manifest.build_version,context,
    metronome:els.metronomeVolume.value,results:[],current:null};
  p.stop=()=>{
    const c=p.current;if(!c)return;
    for(const id of c.timers)clearTimeout(id);
    for(const node of c.sources){try{node.stop()}catch(_){}node.disconnect()}
    for(const node of c.connections){try{node.disconnect(c.capture)}catch(_){}}
    if(c.capture){c.capture.port.onmessage=null;c.capture.port.close();c.capture.disconnect()}
    c.silent?.disconnect();c.stream?.getTracks().forEach(t=>t.stop());
    if(c.onContextStateChange)p.context.removeEventListener('statechange',c.onContextStateChange);
    c.analyser?.disconnect();
    if(c.kind==='voice'&&p.guide){p.guide('instruction').textContent='Attendi la prossima prova';p.guide('countdown').textContent='…'}
    els.metronomeVolume.value=p.metronome;
  };
  p.finish=()=>{if(!p.active)return;p.active=false;
    if(p.current&&!p.current.done){if(p.current.complete)p.current.complete('cancelled');else{p.current.done=true;p.current.error='cancelled'}}
    p.stop();if(p.guide){p.guide('dialog').removeEventListener('close',p.onClose);
      p.guide('dialog').querySelector('details').hidden=p.detailsHidden;p.guide('dialog').close()}};
  return {prepared:true,build:p.build,sampleRate:context.sampleRate};
})()"""

START = r"""(()=>{
  const p=platformAecProbe;
  if(!p.active||document.hidden||p.current&&!p.current.done)throw Error('Not ready');
  const c=p.current={mode:__MODE__,kind:p.kind,done:false,error:null,frames:0,chunks:[],timers:[],sources:[],connections:[]};
  p.results.push(c);
  c.task=(async()=>{
    const echo=c.mode==='raw'?false:c.mode==='all'?'all':true;
    c.constraints={audio:{echoCancellation:{exact:echo},noiseSuppression:{exact:false},
      autoGainControl:{exact:false},channelCount:1},video:false};
    c.stream=await navigator.mediaDevices.getUserMedia(c.constraints);
    if(document.hidden||!p.active)throw Error('Background/cancel during microphone activation');
    const track=c.stream.getAudioTracks()[0],s=track.getSettings(),caps=track.getCapabilities();
    c.trackEvents=[];c.mutedChecks=0;
    for(const event of ['mute','unmute','ended'])track.addEventListener(event,()=>c.trackEvents.push({type:event,at:p.context.currentTime}));
    c.settings={echoCancellation:s.echoCancellation,voiceIsolation:s.voiceIsolation,noiseSuppression:s.noiseSuppression,
      autoGainControl:s.autoGainControl,sampleRate:s.sampleRate,channelCount:s.channelCount,latency:s.latency};
    c.capabilities={echoCancellation:caps.echoCancellation,voiceIsolation:caps.voiceIsolation,noiseSuppression:caps.noiseSuppression,
      autoGainControl:caps.autoGainControl,sampleRate:caps.sampleRate};
    const ctx=p.context,sr=ctx.sampleRate;await ctx.resume();
    const start=Math.ceil((ctx.currentTime+.15)*sr/128)*128;
    c.sampleRate=sr;c.startFrame=start;c.duration=c.kind==='echo'?13:17;
    if(c.kind!=='echo')c.voiceWindow=[7,13];
    if(c.kind==='voice-music')c.music=p.musicMetadata;
    c.softVoice=Boolean(p.softVoice);
    c.amplitude=.08*Number(els.volume.value)/100;
    c.capture=new AudioWorkletNode(ctx,'choir-echo-diagnostic',{numberOfInputs:4,numberOfOutputs:1,
      outputChannelCount:[1],channelCount:1,channelCountMode:'explicit',
      processorOptions:{startFrame:start,maximumFrames:sr*c.duration}});
    const mic=ctx.createMediaStreamSource(c.stream),ref=state.playbackMixer.referenceOutput;
    mic.connect(c.capture,0,0);ref.connect(c.capture,0,1);c.connections=[mic,ref];
    c.silent=ctx.createGain();c.silent.gain.value=0;c.capture.connect(c.silent);c.silent.connect(ctx.destination);
    if(c.kind!=='echo'){c.analyser=ctx.createAnalyser();c.analyser.fftSize=2048;mic.connect(c.analyser);c.analyser.connect(c.silent)}
    const finish=error=>{
      if(c.done)return;c.error=error||null;c.done=true;
      c.pcm=Array.from({length:2},(_,channel)=>{
        const a=new Float32Array(c.frames);let at=0;for(const chunk of c.chunks){a.set(chunk[channel],at);at+=chunk[channel].length}return a;});
      c.chunks=[];p.stop();
    };
    c.complete=finish;
    c.onContextStateChange=()=>finish('audio-context-'+ctx.state);
    ctx.addEventListener('statechange',c.onContextStateChange);
    c.capture.onprocessorerror=()=>finish('capture-processor');
    c.capture.port.onmessage=({data})=>{
      if(data.clock)c.clock=data.clock;
      if(data.error){finish(data);return}
      if(data.valid){c.chunks.push(data.channels.slice(0,2).map(a=>a.slice(0,data.valid)));c.frames+=data.valid}
      if(data.done)finish();
    };
    const origin=start/sr;
    if(c.kind==='voice-music'){
      const source=ctx.createBufferSource();source.buffer=p.musicBuffer;source.connect(ref);
      source.start(origin);c.sources.push(source);
    }
    for(const [at,multiplier,seed] of (c.kind==='echo'?[[2,.5,2087],[5,1,3191]]:[])){
      const source=ctx.createBufferSource(),buffer=ctx.createBuffer(1,sr*2,sr);
      buffer.copyToChannel(ChoirEchoCancellation.noise(sr*2,c.amplitude*multiplier,seed),0);
      source.buffer=buffer;source.connect(ref);source.start(origin+at);c.sources.push(source);
    }
    c.clicks=c.kind==='echo'?[[8,15,true],[8.5,15,false],[9,15,false],[10,30,true],[10.5,30,false],[11,30,false]]
      :p.metronomeDuringVoice?[[3,30,true],[4,30,false],[5,30,false],[8,30,true],[9,30,false],[10,30,false],[14,30,true],[15,30,false]]:[];
    for(const [at,level,accented] of c.clicks)
      c.timers.push(setTimeout(()=>{if(!document.hidden&&!c.done){els.metronomeVolume.value=String(level);playMetronomeClick(accented)}},Math.max(0,(origin+at-ctx.currentTime)*1000)));
    const watch=()=>{
      if(c.done)return;
      if(track.muted)c.mutedChecks++;
      if(document.hidden||ctx.state!=='running'||track.readyState!=='live'){finish('background-or-audio-stopped');return}
      if(c.kind!=='echo'&&p.drawGuide)p.drawGuide(Math.max(0,ctx.currentTime-origin),c);
      c.timers.push(setTimeout(watch,100));
    };watch();
    c.timers.push(setTimeout(()=>finish('capture-deadline'),(c.duration+4)*1000));
  })().catch(error=>{c.error={name:error.name,message:error.message,constraint:error.constraint};c.done=true;p.stop()});
  return {started:true,mode:c.mode};
})()"""

GUIDE = r"""(async()=>{
  const p=platformAecProbe;if(p.kind==='echo')p.kind='voice';
  await microphoneCalibrationUI.open();
  const $=id=>document.getElementById('calibration-'+id);p.guide=$;
  $('start').hidden=true;$('done').hidden=true;$('dialog').dataset.phase='capture';
  $('intro').textContent='Controllo tecnico della voce. Canta solo al segnale.';
  p.detailsHidden=$('dialog').querySelector('details').hidden;$('dialog').querySelector('details').hidden=true;
  $('status').textContent='Audio acquisito sul PC per la diagnosi.';
  $('instruction').textContent='Preparazione';$('countdown').textContent='…';
  p.onClose=()=>p.finish();$('dialog').addEventListener('close',p.onClose);
  p.drawGuide=(elapsed,c)=>{
    const singing=elapsed>=7&&elapsed<13,end=elapsed<7?7:singing?13:17;
    const text=singing?(c.softVoice?'Canta più piano':'Canta una nota comoda'):'Resta in silenzio';
    if($('instruction').textContent!==text)$('instruction').textContent=text;
    $('step').textContent='Controllo voce · '+(c.mode==='raw'?'Ingresso grezzo':c.mode==='all'?'AEC completo':'AEC normale');
    $('hint').textContent=singing?(c.softVoice?'Una «aaa» più piano, senza sussurrare.':'Una «aaa» continua, senza sforzarti.'):'Attendi il segnale sullo schermo.';
    $('countdown').textContent=String(Math.max(1,Math.ceil(end-elapsed)));
    $('timer-label').textContent='secondi rimasti';$('progress').value=elapsed/17;
    $('next').textContent=elapsed<7?'Poi: canta per 6 secondi.':singing?'Poi: silenzio per 4 secondi.':'Poi: attendi il termine del controllo.';
    const pcm=new Float32Array(2048);c.analyser.getFloatTimeDomainData(pcm);
    const rms=Math.sqrt(pcm.reduce((s,v)=>s+v*v,0)/pcm.length),db=Math.max(-72,Math.min(0,20*Math.log10(Math.max(rms,1e-8))));
    const label=rms>.001?'Segnale presente':'Segnale basso';$('level-status').textContent=label;
    $('meter').setAttribute('aria-valuenow',String(Math.round(db)));$('meter').setAttribute('aria-valuetext',label);
    const canvas=$('level'),w=canvas.clientWidth||320;canvas.width=w;canvas.height=48;
    const context=canvas.getContext('2d'),styles=getComputedStyle($('dialog'));
    context.fillStyle=styles.getPropertyValue('--cyan').trim();context.fillRect(0,19,w*(db+72)/72,10);
  };
  return {guide:true};
})()"""

MUSIC = r"""(async()=>{
  const p=platformAecProbe,ctx=p.context,sr=ctx.sampleRate;
  const cached=window.platformAecPreparedMusic;
  if(cached?.build===p.build&&cached.buffer.sampleRate===sr){
    p.musicBuffer=cached.buffer;p.musicMetadata=cached.metadata;p.kind='voice-music';return p.musicMetadata;
  }
  if(state.playbackMixer.transposeSemitones!==0)throw Error('Music test requires original key');
  const mix=new Float32Array(sr*17),metadata=[];
  const media=[['organo',els.backingAudio],...state.voiceStemAudio.entries()];
  for(const [id,audio] of media){
    const level=state.playbackMixer.levels.get(audio)||0;if(level<=0)continue;
    const url=new URL(audio.getAttribute('src'),location.href);
    if(url.origin!==location.origin||!url.pathname.startsWith('/library-assets/santo-frisina/'))throw Error('Expected authorized Santo assets');
    const response=await fetch(url);if(!response.ok)throw Error('Music download failed');
    const bytes=await response.arrayBuffer();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
    const buffer=await ctx.decodeAudioData(bytes);
    if(buffer.sampleRate!==sr||buffer.duration<35)throw Error('Music excerpt unavailable');
    for(let channel=0;channel<buffer.numberOfChannels;channel++){
      const data=buffer.getChannelData(channel).subarray(sr*18,sr*35);
      for(let i=0;i<mix.length;i++)mix[i]+=data[i]*level/buffer.numberOfChannels;
    }
    metadata.push({id,path:url.pathname,sha256:hash,level,offsetSec:18});
  }
  if(!metadata.length)throw Error('No music sources');
  let peak=0,energy=0;for(const value of mix){peak=Math.max(peak,Math.abs(value));energy+=value*value;}
  if(peak>=.98)throw Error('Music mix exceeds the digital peak limit');
  p.musicBuffer=ctx.createBuffer(1,mix.length,sr);p.musicBuffer.copyToChannel(mix,0);
  p.musicMetadata={sources:metadata,peak,rms:Math.sqrt(energy/mix.length),duration:17};p.kind='voice-music';
  window.platformAecPreparedMusic={build:p.build,buffer:p.musicBuffer,metadata:p.musicMetadata};
  return p.musicMetadata;
})()"""

def page_socket(port):
    pages=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json',timeout=5))
    pages=[p for p in pages if p.get('type')=='page' and urlsplit(p.get('url','')).hostname=='staging.epistrophe.it']
    if not pages:raise RuntimeError('No authorized staging tab found')
    visible=[]
    for page in pages:
        endpoint=page['webSocketDebuggerUrl']
        if urlsplit(endpoint).hostname not in ('localhost','127.0.0.1'):raise RuntimeError('CDP must remain local')
        socket=websocket.create_connection(endpoint,timeout=2,suppress_origin=True)
        try:
            if evaluate(socket,101,'document.visibilityState')=='visible':
                visible.append(socket)
            else:socket.close()
        except (OSError,RuntimeError,websocket.WebSocketException):socket.close()
    if len(visible)!=1:
        for socket in visible:socket.close()
        raise RuntimeError('Expected one visible, responsive staging tab')
    visible[0].settimeout(12)
    return visible[0]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',action='store_true')
    parser.add_argument('--port',type=int,default=9223)
    parser.add_argument('--modes',nargs='+',choices=['raw','browser','all'],default=['raw','browser','browser','raw'])
    parser.add_argument('--volume-index',type=int,default=8)
    parser.add_argument('--voice-check',action='store_true',help='Guided voice only, no output sounds; requires singing readiness')
    parser.add_argument('--voice-with-music',action='store_true',help='Guided sustained voice with the current Santo mix; requires readiness')
    parser.add_argument('--prepare-music',action='store_true',help='Download/decode the excerpt without microphone, playback or volume changes')
    parser.add_argument('--metronome',action='store_true',help='Include 30% metronome clicks before, during and after guided voice')
    parser.add_argument('--soft-voice',action='store_true',help='Ask for a softer sung vowel in the guide')
    parser.add_argument('--continue-after-gap',action='store_true',help='Preserve and flag a discontinuous prefix, then acquire the next independent condition')
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    with closing(page_socket(args.port)) as socket:
        inspected=evaluate(socket,1,INSPECT)
        if args.prepare_music:
            socket.settimeout(45)
            try:
                evaluate(socket,2,INSTALL.replace('__BUILD__',json.dumps(inspected['build'])))
                print(json.dumps(evaluate(socket,21,MUSIC)),flush=True)
            finally:evaluate(socket,900,'window.platformAecProbe?.finish()')
            return
        if not args.run:print(json.dumps(inspected));return
        if inspected['visible']!='visible' or not inspected['build']:raise RuntimeError('Open the staging webapp in foreground')
        output=args.output or Path('artifacts/aec-platform-comparison')/datetime.now(timezone.utc).strftime('device-%Y%m%d-%H%M%S')
        output.mkdir(parents=True,exist_ok=False)
        (output/'before.json').write_text(json.dumps(inspected,indent=2))
        reports=[]
        with volume_adjustment(args.volume_index,output):
            try:
                prepared=evaluate(socket,2,INSTALL.replace('__BUILD__',json.dumps(inspected['build'])))
                print(json.dumps(prepared),flush=True)
                if args.voice_with_music:
                    print(json.dumps(evaluate(socket,21,MUSIC)),flush=True)
                evaluate(socket,22,f'platformAecProbe.metronomeDuringVoice={json.dumps(args.metronome)};platformAecProbe.softVoice={json.dumps(args.soft_voice)}')
                if args.voice_check or args.voice_with_music:evaluate(socket,20,GUIDE)
                for index,mode in enumerate(args.modes):
                    print(json.dumps(evaluate(socket,3,START.replace('__MODE__',json.dumps(mode)))),flush=True)
                    deadline=time.monotonic()+23
                    while time.monotonic()<deadline:
                        time.sleep(.2)
                        if evaluate(socket,4,'platformAecProbe.current.done'):break
                    else:raise RuntimeError('Condition deadline exceeded')
                    report=evaluate(socket,5,'(()=>{const {stream,task,pcm,chunks,timers,sources,connections,capture,silent,analyser,complete,onContextStateChange,...meta}=platformAecProbe.current;return meta})()')
                    reports.append(report)
                    if report['frames']:
                        channels=[export_array(socket,f'platformAecProbe.current.pcm[{i}]') for i in range(2)]
                        np.savez_compressed(output/f'{index+1}-{mode}.npz',captured=channels[0],reference=channels[1],sample_rate=report['sampleRate'])
                    (output/'result.json').write_text(json.dumps({'build':inspected['build'],'conditions':reports},indent=2))
                    print(json.dumps(report),flush=True)
                    gap=isinstance(report['error'],dict) and report['error'].get('error')=='discontinuous-capture'
                    if report['error'] and not (args.continue_after_gap and gap):break
            finally:
                evaluate(socket,900,'window.platformAecProbe?.finish()')
        print(json.dumps({'output':str(output),'conditions':len(reports)}),flush=True)

if __name__=='__main__':main()
