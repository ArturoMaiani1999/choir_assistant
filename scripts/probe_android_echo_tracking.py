"""Confirm the deployed acoustic path on the authorized Android staging tab.

--run requires the user to have confirmed quiet/foreground readiness. Uses
the real unified guide's saved-voice quiet reuse; cancels if singing would
be required. Never invents a verified voice profile. Then records ten seconds
of independent noise and actual app metronome clicks through the live graph.
All PCM stays in local artifacts. Original Android and click levels restored.
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
from probe_android_calibration import INSTALL, SNAPSHOT, export_array, volume_adjustment

BUILD = '20261020-115221-46c4b97f1322-dirty'

INSTRUMENT = r"""(()=>{
  const Original=window.Worker;
  phoneCalibrationProbe.workerRtt=[];phoneCalibrationProbe.workerEvents=[];
  const Observed=class extends Original {
    constructor(...args){super(...args);this.sent=[];this.voice=String(args[0]).includes('microphone_calibration_worker');
      if(this.voice){phoneCalibrationProbe.workerEvents.push({type:'voice-created',at:performance.now()});
        this.addEventListener('message',({data})=>phoneCalibrationProbe.workerEvents.push({type:'voice-message',at:performance.now(),messageType:data.type,
          progress:data.value,error:data.error,verified:data.result?.verified,processingMs:data.result?.processingMs,frameCount:data.result?.frameCount}));
        this.addEventListener('error',e=>phoneCalibrationProbe.workerEvents.push({type:'voice-error',at:performance.now(),message:e.message}));}
      if(String(args[0]).includes('echo_cancellation_worker'))this.addEventListener('message',({data})=>{
        if(data.microphone&&data.prediction&&this.sent.length){
          const sent=this.sent.shift();phoneCalibrationProbe.workerRtt.push({ms:performance.now()-sent.at,
            endTime:data.endTime,delay:data.delayObservation,epoch:data.epoch});
        }
      });
    }
    postMessage(data,...rest){
      if(data.mode==='gain')this.sent.push({at:performance.now()});
      if(this.voice&&data.frames){
        phoneCalibrationProbe.workerEvents.push({type:'voice-post',at:performance.now(),frames:data.frames.length,mode:data.mode});
        phoneCalibrationProbe.voice={...data,frames:data.frames.map(f=>({timeSec:f.timeSec,buffer:new Float32Array(f.buffer).slice()}))};
      }
      return super.postMessage(data,...rest);
    }
  };
  window.Worker=Observed;
  const restore=phoneCalibrationProbe.restore;
  phoneCalibrationProbe.restore=()=>{if(window.Worker===Observed)window.Worker=Original;restore();};
})()"""

HOLDOUT = r"""(async()=>{
  const p=phoneCalibrationProbe,g=echoCancellationUI.captureGraph();
  if(!echoCancellationUI.ready()||!g?.profile.calibrationVerified)throw Error('No verified live acoustic model');
  const manifest=await (await fetch('deployment-manifest.json',{cache:'no-store'})).json();
  if(manifest.build_version!==__BUILD__)throw Error('Release changed');
  const worklet=Object.keys(manifest.files).find(n=>/^echo_diagnostic_worklet\.[a-f0-9]+\.js$/.test(n));
  if(!worklet)throw Error('Capture module missing');
  await g.context.audioWorklet.addModule(worklet);
  if(document.hidden)throw Error('Chrome must stay visible');
  const ctx=g.context,sr=ctx.sampleRate,start=Math.ceil(ctx.currentTime*sr)+4800;
  const cap=new AudioWorkletNode(ctx,'choir-echo-diagnostic',{numberOfInputs:4,numberOfOutputs:1,
    outputChannelCount:[1],channelCount:1,channelCountMode:'explicit',
    processorOptions:{startFrame:start,maximumFrames:sr*10}});
  const silent=ctx.createGain();silent.gain.value=0;cap.connect(silent);silent.connect(ctx.destination);
  [g.raw,g.reference,g.prediction,g.processed].forEach((node,i)=>node.connect(cap,0,i));
  const live=p.live={done:false,startFrame:start,sampleRate:sr,frames:0,chunks:[],snapshots:[],
    originalMetronome:els.metronomeVolume.value,profile:{...g.profile,impulse:undefined},sources:[],timers:[]};
  els.metronomeVolume.value='30';live.metronomePercent=30;
  live.stop=()=>{
    for(const timer of live.timers){clearTimeout(timer);clearInterval(timer);}
    for(const source of live.sources){try{source.stop();}catch(_){}source.disconnect();}
    els.metronomeVolume.value=live.originalMetronome;
    for(const node of [g.raw,g.reference,g.prediction,g.processed]){try{node.disconnect(cap);}catch(_){}}
    cap.port.onmessage=null;cap.port.close();cap.disconnect();silent.disconnect();
  };
  cap.onprocessorerror=()=>{live.error='capture-processor';live.done=true;live.stop();};
  cap.port.onmessage=({data})=>{
    if(data.error){live.error=data;live.done=true;live.stop();return;}
    if(data.valid){live.chunks.push(data.channels.map(a=>a.slice(0,data.valid)));live.frames+=data.valid;}
    if(data.done){
      live.pcm=Array.from({length:4},(_,c)=>{const out=new Float32Array(live.frames);let offset=0;
        for(const chunk of live.chunks){out.set(chunk[c],offset);offset+=chunk[c].length;}return out;});
      live.chunks=[];live.done=true;live.stop();
    }
  };
  const origin=start/sr,probe=ctx.createBufferSource(),buffer=ctx.createBuffer(1,sr*3,sr);
  live.amplitude=.08*Number(els.volume.value)/100;
  buffer.copyToChannel(ChoirEchoCancellation.noise(sr*3,live.amplitude,2087),0);
  probe.buffer=buffer;probe.connect(g.reference);probe.start(origin+1);live.sources.push(probe);
  for(let i=0;i<8;i++)live.timers.push(setTimeout(()=>{
    if(!document.hidden&&!live.done)playMetronomeClick(i%4===0);
  },Math.max(0,(origin+5+i*.5-ctx.currentTime)*1000)));
  live.timers.push(setInterval(()=>{
    if(document.hidden){live.error='background';live.done=true;live.stop();return;}
    const t=ctx.currentTime-origin;live.snapshots.push({time:t,...echoCancellationUI.diagnostics()});
    document.querySelector('#calibration-instruction').textContent='Controllo tecnico · resta in silenzio';
    document.querySelector('#calibration-status').textContent='Fruscio indipendente, poi metronomo. Non cantare.';
    document.querySelector('#calibration-countdown').textContent=String(Math.max(0,Math.ceil(10-t)));
  },50));
  return {started:true,sampleRate:sr,startFrame:start};
})()"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--port', type=int, default=9223)
    parser.add_argument('--volume-index', type=int, default=8)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{args.port}/json', timeout=5))
    allowed = [p for p in pages if p.get('type') == 'page' and urlsplit(p.get('url', '')).hostname == 'staging.epistrophe.it']
    if len(allowed) != 1:
        parser.error('Expected exactly one staging tab')
    endpoint = allowed[0]['webSocketDebuggerUrl']
    if urlsplit(endpoint).hostname not in ('localhost', '127.0.0.1'):
        parser.error('CDP must remain local')
    output = args.output or Path('artifacts/echo-delay-tracking') / datetime.now(timezone.utc).strftime('device-confirmation-%Y%m%d-%H%M%S')
    with closing(websocket.create_connection(endpoint, timeout=20, suppress_origin=True)) as socket:
        snapshot = evaluate(socket, 1, SNAPSHOT)
        if not args.run:
            print(json.dumps(snapshot));return
        if snapshot['build'] != BUILD:
            raise RuntimeError('Reload the page before measurement: wrong build')
        if evaluate(socket, 2, 'document.visibilityState') != 'visible':
            raise RuntimeError('Chrome must stay visible')
        output.mkdir(parents=True, exist_ok=False)
        with volume_adjustment(args.volume_index, output) as volume:
            try:
                # Install all observers before clicking Start: creation of the
                # live gain Worker occurs immediately after the click.
                install = INSTALL.replace("document.querySelector('#calibration-start').click();", '')
                install = install.replace('__START_DEADLINE__', str(round(time.time()*1000)+10000))
                evaluate(socket, 3, install)
                evaluate(socket, 4, INSTRUMENT)
                evaluate(socket, 5, "document.querySelector('#calibration-start').click()")
                print(json.dumps({'started': True, 'output': str(output)}), flush=True)
                deadline = time.monotonic()+55
                failure = None
                while time.monotonic() < deadline:
                    time.sleep(.2)
                    snapshot = evaluate(socket, 6, SNAPSHOT)
                    if snapshot['instruction'].startswith('Canta') or not snapshot['busy']:
                        break
                else:
                    failure = 'Guide did not finish within 55 seconds'
                success = evaluate(socket, 7, "!document.querySelector('#calibration-done').hidden&&echoCancellationUI.ready()")
                if success:
                    print(json.dumps(evaluate(socket, 8, HOLDOUT.replace('__BUILD__', json.dumps(BUILD)))), flush=True)
                    deadline = time.monotonic()+15
                    while time.monotonic() < deadline:
                        if evaluate(socket, 9, 'phoneCalibrationProbe.live.done'):break
                        time.sleep(.2)
                    else:
                        failure = 'Holdout capture did not finish within 15 seconds'
                live = evaluate(socket, 10, "(()=>{const l=phoneCalibrationProbe.live;if(!l)return null;const {pcm,chunks,sources,timers,stop,...meta}=l;return meta})()")
                report = {'build': BUILD, 'failure': failure, 'systemVolume': volume, 'guide': snapshot,
                          'live': live, 'workerRtt': evaluate(socket, 11, 'phoneCalibrationProbe.workerRtt'),
                          'workerEvents': evaluate(socket, 14, 'phoneCalibrationProbe.workerEvents'),
                          'lifecycle': evaluate(socket, 12, 'echoCancellationUI.lifecycle()')}
                (output/'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
                # Stop the microphone before exporting large PCM over CDP.
                evaluate(socket, 13, "(async()=>{phoneCalibrationProbe.live?.stop();phoneCalibrationProbe.restore();microphoneCalibrationUI.cancel('Misura tecnica completata.');await stopMicrophone();document.querySelector('#calibration-dialog').close();})()")
                if snapshot['microphoneFrames']:
                    arrays = {name: export_array(socket, f'phoneCalibrationProbe.pcm.{name}') for name in ('microphone','reference')}
                    arrays['impulse'] = export_array(socket, 'phoneCalibrationProbe.impulse')
                    arrays['sample_rate'] = np.array(snapshot['sampleRate'])
                    np.savez_compressed(output/'calibration.npz', **arrays)
                if live and live.get('frames') and not live.get('error'):
                    channels = [export_array(socket, f'phoneCalibrationProbe.live.pcm[{i}]') for i in range(4)]
                    np.savez_compressed(output/'live.npz', raw=channels[0], reference=channels[1], prediction=channels[2], processed=channels[3], sample_rate=live['sampleRate'])
                print(json.dumps({'output': str(output), 'failure':failure, 'guideResults': snapshot['results'], 'liveFrames': live and live.get('frames'), 'liveError': live and live.get('error')}), flush=True)
            finally:
                try:
                    evaluate(socket, 900, "(async()=>{if(window.phoneCalibrationProbe){phoneCalibrationProbe.live?.stop();phoneCalibrationProbe.restore();microphoneCalibrationUI.cancel('Misura tecnica completata.');await stopMicrophone();}})()")
                except (OSError, RuntimeError):
                    print('Keep Chrome visible to complete microphone cleanup.', flush=True)


if __name__ == '__main__':
    main()
