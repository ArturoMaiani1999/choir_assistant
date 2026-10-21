"""Inspect real Samsung playback over local CDP, without saving microphone PCM.

--run performs short audible comparisons and restores the paused position and
microphone state. Input settings are temporary; no scores or audio are uploaded.
"""
import argparse
from contextlib import closing
import json
import hashlib
from pathlib import Path
import subprocess
import urllib.request
from urllib.parse import urlsplit

import websocket
from browser_practice_smoke import command, evaluate

ROOT = Path(__file__).resolve().parents[1]
ADB = ROOT / 'artifacts/android-tools/platform-tools/adb.exe'

SNAPSHOT = r"""(()=>{
 const s=state.microphoneStream?.getAudioTracks()[0]?.getSettings()||{};
 const context=c=>c?{state:c.state,sampleRate:c.sampleRate,baseLatency:c.baseLatency,outputLatency:c.outputLatency,
   currentTime:c.currentTime,outputTimestamp:c.getOutputTimestamp?.()}:null;
 return {build:RUNTIME_CONFIG.buildVersion,visible:document.visibilityState,piece:state.bundleManifest?.piece_id,
   viewport:[innerWidth,innerHeight],running:state.clock?.running,position:playbackSnapshot(),microphone:state.microphoneStatus,
   connection:state.audioOutputType,headphones:!echoCancellationUI.enabled(),
   workerDisabled:state.pitchWorkerDisabled,inFlight:state.pitchWorkerInFlight,
   settings:{sampleRate:s.sampleRate,channelCount:s.channelCount,latency:s.latency,
     echoCancellation:s.echoCancellation,noiseSuppression:s.noiseSuppression,autoGainControl:s.autoGainControl},
   contexts:{mixer:context(state.playbackMixer.context),microphone:context(state.microphoneContext),metronome:context(state.metronomeContext)},
   volume:Number(els.volume.value),calibrationMuted:state.playbackMixer.calibrationMuted,
   channels:[...state.playbackMixer.channels].map(([media,c])=>({file:media.currentSrc.split('/').at(-1),
     requestedGain:state.playbackMixer.levels.get(media),gain:c.gain.gain.value,muted:media.muted,volume:media.volume})),
   mediaError:els.backingAudio.error?.message??null,
   dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id)};
})()"""

INSTALL = r"""(()=>{
 if(document.hidden||state.clock.running||state.microphoneStatus!=='idle')throw Error('Expected visible paused app with idle microphone');
 if(echoCancellationUI.enabled()||microphoneCaptureActive()||echoDiagnosticsUI.hasPending()||document.querySelector('dialog[open]'))throw Error('Close active operations before comparison');
 if(window.bluetoothDeviceProbe)throw Error('Probe already installed');
 const p=window.bluetoothDeviceProbe={saved:{time:playbackSnapshot().performanceTime,attemptActive:state.attemptActive,
   attempt:state.attempt,pitchSamples:state.pitchSamples,pitchTakeId:state.pitchTakeId,lastSampleMs:state.lastSampleMs,
   lastMetronomeBeat:state.lastMetronomeBeat,scoringStartBeat:state.scoringStartBeat,
   save:savePitchHistory,draw:drawPitchLane,apply:applyPitchEstimate,gum:navigator.mediaDevices.getUserMedia,
   media:[els.backingAudio,...state.voiceStemAudio.values()].map(audio=>({audio,src:audio.getAttribute('src')})),
   contexts:[state.playbackMixer.context,state.metronomeContext].filter(Boolean).map(context=>({context,state:context.state}))},frames:[],pitch:[],urls:[]};
 state.attemptActive=false;state.pitchSamples=[];state.scoringStartBeat=0;
 savePitchHistory=()=>{};
 drawPitchLane=function(beat){const t=performance.now();try{return p.saved.draw(beat)}finally{
   if(p.measuring)p.frames.push({wallMs:t,beat,mediaTime:els.backingAudio.currentTime,costMs:performance.now()-t});}};
 applyPitchEstimate=function(raw,beat,sampledAt,analysisMs,...args){
   if(p.measuring)p.pitch.push({analysisMs,ageMs:performance.now()-sampledAt,accepted:Boolean(raw?.hz)});
   return p.saved.apply(raw,beat,sampledAt,analysisMs,...args);
 };
 p.cleanup=async()=>{
   p.measuring=false;state.clock.pause();pauseVoiceStems();
   navigator.mediaDevices.getUserMedia=p.saved.gum;
   try{if(state.microphoneStatus!=='idle')await stopMicrophone()}finally{
     drawPitchLane=p.saved.draw;applyPitchEstimate=p.saved.apply;savePitchHistory=p.saved.save;
     state.attemptActive=p.saved.attemptActive;state.attempt=p.saved.attempt;
     state.pitchSamples=p.saved.pitchSamples;state.pitchTakeId=p.saved.pitchTakeId;
     state.lastSampleMs=p.saved.lastSampleMs;state.lastMetronomeBeat=p.saved.lastMetronomeBeat;state.scoringStartBeat=p.saved.scoringStartBeat;
     if(p.urls.length){
       for(const {audio,src} of p.saved.media){audio.src=src;audio.load()}
       await Promise.all(p.saved.media.map(({audio})=>waitForMediaReady(audio,3,8000)));
       for(const url of p.urls)URL.revokeObjectURL(url);
     }
     for(const {context,state:original} of p.saved.contexts){
       if(context.state==='running')await context.suspend();
       if(original==='running')await context.resume();
     }
     queueAudioSeek(p.saved.time);await waitForMediaSeek(els.backingAudio);
     // The live source can reject seeking while returning a 200 response to
     // Range. For short starting positions restore by muted playback, avoiding
     // another unsupported seek. Keep scoring and history disabled throughout.
     if(p.saved.time>0&&p.saved.time<=5&&Math.abs(els.backingAudio.currentTime-p.saved.time)>.1){
       const muted=state.playbackMixer.calibrationMuted;state.attemptActive=false;
       state.playbackMixer.muteForCalibration(true);state.pendingAudioTime=null;
       try{
         for(const {audio} of p.saved.media)audio.load();
         await waitForMediaReady(els.backingAudio,3,7000);
         await Promise.race([state.clock.play(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Position restoration timed out')),7000))]);
         const start=performance.now();while(els.backingAudio.currentTime<p.saved.time&&performance.now()-start<8000)await new Promise(r=>setTimeout(r,10));
       }finally{state.clock.pause();pauseVoiceStems();state.attemptActive=p.saved.attemptActive;state.playbackMixer.muteForCalibration(muted)}
     }
     updatePlaybackButton();render();delete window.bluetoothDeviceProbe;
   }
 };
 return {installed:true};
})()"""

START = r"""(async()=>{
 const p=bluetoothDeviceProbe;state.clock.pause();pauseVoiceStems();
 if(state.microphoneStatus!=='idle')await stopMicrophone();
 navigator.mediaDevices.getUserMedia=p.saved.gum;
 const media=[els.backingAudio,...state.voiceStemAudio.values()];
 for(const audio of media)if(audio.error)audio.load();
 await Promise.all(media.map(audio=>waitForMediaReady(audio,3,8000)));
 if(els.backingAudio.error||els.backingAudio.readyState<3)throw Error('Backing media is not ready');
 queueAudioSeek(Math.max(p.saved.time,5));await waitForMediaSeek(els.backingAudio);
 await state.playbackMixer.resume([els.backingAudio,...state.voiceStemAudio.values()]);
 syncBackingLevel();syncVoiceStemLevels();
 if(RESET){for(const context of [state.playbackMixer.context,state.metronomeContext])if(context?.state==='running')await context.suspend();await state.playbackMixer.resume(media)}
 if(PHASE!=='media'){
   if(PHASE==='raw')navigator.mediaDevices.getUserMedia=function(c){return p.saved.gum.call(this,{
     ...c,audio:{...c.audio,echoCancellation:{exact:false},noiseSuppression:{exact:false},autoGainControl:{exact:false}}});};
   if(PHASE==='builtin'){
     const device=(await navigator.mediaDevices.enumerateDevices()).find(d=>d.kind==='audioinput'&&d.label==='Speakerphone');
     if(!device)throw Error('No explicit built-in microphone available');
     navigator.mediaDevices.getUserMedia=function(c){return p.saved.gum.call(this,{
       ...c,audio:{...c.audio,deviceId:{exact:device.deviceId},echoCancellation:{exact:false},noiseSuppression:{exact:false},autoGainControl:{exact:false}}});};
   }
   if(PHASE==='headset'){
     const device=(await navigator.mediaDevices.enumerateDevices()).find(d=>d.kind==='audioinput'&&/bluetooth/i.test(d.label));
     if(!device)throw Error('No explicit Bluetooth microphone available');
     navigator.mediaDevices.getUserMedia=function(c){return p.saved.gum.call(this,{
       ...c,audio:{...c.audio,deviceId:{exact:device.deviceId},echoCancellation:false,noiseSuppression:false,autoGainControl:true}});};
   }
   try{await toggleMicrophone()}finally{navigator.mediaDevices.getUserMedia=p.saved.gum}
   if(state.microphoneStatus!=='active')throw Error('Microphone did not activate');
 }
 state.clock.seekPerformanceTime(Math.max(p.saved.time,5));await waitForMediaSeek(els.backingAudio);
 await Promise.race([state.clock.play(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Playback deadline exceeded')),7000))]);
 render();await new Promise(r=>setTimeout(r,2500));
 return true;
})()"""

MEASURE = r"""(async()=>{
 const p=bluetoothDeviceProbe;p.frames=[];p.pitch=[];p.measuring=true;
 const raf=[],started=performance.now();
 await new Promise(resolve=>{const tick=t=>{raf.push(t);if(t-started>=DURATION)resolve();else requestAnimationFrame(tick)};requestAnimationFrame(tick)});
 p.measuring=false;
 const distribution=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return {
   count:a.length,median:a[Math.floor(a.length/2)]??null,p95:a[Math.floor(a.length*.95)]??null,max:a.at(-1)??null};};
 const changes=p.frames.slice(1).map((f,i)=>({wall:f.wallMs-p.frames[i].wallMs,beat:f.beat-p.frames[i].beat,media:f.mediaTime-p.frames[i].mediaTime}));
 const elapsed=(performance.now()-started)/1000;
 return {elapsed,rafFps:raf.length/elapsed,renderFps:p.frames.length/elapsed,
   movementFps:changes.filter(c=>c.beat>1e-6).length/elapsed,repeatedPositions:changes.filter(c=>Math.abs(c.beat)<=1e-6).length,
   backwardSteps:changes.filter(c=>c.beat< -1e-6).length,
   rafGapsMs:distribution(raf.slice(1).map((t,i)=>t-raf[i])),drawCostMs:distribution(p.frames.map(f=>f.costMs)),
   clockStepsMs:distribution(changes.map(c=>c.media*1000)),pitchCostMs:distribution(p.pitch.map(f=>f.analysisMs)),
   pitchAgeMs:distribution(p.pitch.map(f=>f.ageMs)),voicedPitchFrames:p.pitch.filter(f=>f.accepted).length,
   frames:p.frames,pitch:p.pitch};
})()"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=9223)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--phases', nargs='+', choices=['media', 'input', 'raw', 'builtin', 'headset'], default=['media', 'input'])
    parser.add_argument('--seconds', type=float, default=4)
    parser.add_argument('--buffer-media', action='store_true', help='Temporarily use fetched Blob URLs to isolate network/seek errors')
    parser.add_argument('--reset-output', action='store_true', help='Suspend/resume existing output contexts between conditions')
    parser.add_argument('--candidate', action='store_true', help='Temporarily evaluate local presentation/input fixes in the authorized tab, restored after measurement')
    parser.add_argument('--label', help='Brief label shown during an audible comparison')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/bluetooth-sync/samsung-device')
    args = parser.parse_args()
    if not 1 <= args.seconds <= 15:
        parser.error('Observe between 1 and 15 seconds per condition')
    pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{args.port}/json', timeout=5))
    pages = [p for p in pages if p.get('type') == 'page' and urlsplit(p.get('url', '')).hostname == 'staging.xynon.it']
    if len(pages) != 1:
        parser.error('Expected exactly one authorized Xynon staging page')
    endpoint = pages[0]['webSocketDebuggerUrl']
    if urlsplit(endpoint).hostname not in ('localhost', '127.0.0.1'):
        parser.error('CDP must remain local')
    args.output.mkdir(parents=True, exist_ok=False)
    with closing(websocket.create_connection(endpoint, timeout=25, suppress_origin=True)) as socket:
        before = evaluate(socket, 1, SNAPSHOT)
        (args.output / 'before.json').write_text(json.dumps(before, indent=2), encoding='utf-8')
        if not args.run:
            print(json.dumps(before, indent=2))
            return
        evaluate(socket, 2, INSTALL)
        results = []
        try:
            if args.candidate:
                app = (ROOT / 'frontend/app.js').read_text(encoding='utf-8')
                functions = {
                    'currentPianoRollBeat': app.split('function currentPianoRollBeat(', 1)[1].split('\nfunction drawPitchLane(', 1)[0],
                    'render': app.split('function render(', 1)[1].split('\nfunction updateMetronomeControl(', 1)[0],
                    'toggleMicrophone': app.split('async function toggleMicrophone(', 1)[1].split('\nfunction preferenceKey(', 1)[0],
                }
                evaluate(socket, 4, r"""(()=>{
                  const p=bluetoothDeviceProbe;
                  p.candidateSaved={math:window.PracticeMath,media:window.ChoirMedia,beat:currentPianoRollBeat,render,toggleMicrophone};
                  const cleanup=p.cleanup;
                  p.cleanup=async()=>{try{await cleanup()}finally{
                    for(const [event,listener] of p.candidateListeners??[])els.backingAudio.removeEventListener(event,listener);
                    window.PracticeMath=p.candidateSaved.math;window.ChoirMedia=p.candidateSaved.media;
                    currentPianoRollBeat=p.candidateSaved.beat;render=p.candidateSaved.render;toggleMicrophone=p.candidateSaved.toggleMicrophone;
                    delete state.pianoRollVisualTime;delete state.pianoRollWaiting;delete state.lastPianoRollTime;render();
                  }};
                })()""")
                for module in ('practice_math.js', 'media_mixer.js'):
                    source = (ROOT / 'frontend' / module).read_text(encoding='utf-8')
                    evaluate(socket, 5, source)
                source = '\n'.join(name + ' = (' + ('async ' if name == 'toggleMicrophone' else '') + 'function ' + name + '(' + body + ');' for name, body in functions.items())
                evaluate(socket, 6, source)
                evaluate(socket, 7, r"""(()=>{
                  state.pianoRollVisualTime=new window.PracticeMath.VisualPlaybackTime();state.pianoRollWaiting=false;
                  const p=bluetoothDeviceProbe;p.candidateListeners=[];
                  for(const event of ['play','pause','seeking','seeked','ratechange','emptied','ended','waiting','playing']){
                    const listener=()=>{state.pianoRollVisualTime.reset();
                      if(event==='waiting')state.pianoRollWaiting=true;
                      if(['play','emptied','ended','playing'].includes(event))state.pianoRollWaiting=false;};
                    els.backingAudio.addEventListener(event,listener);p.candidateListeners.push([event,listener]);
                  }
                })()""")
                (args.output / 'candidate-sha256.json').write_text(json.dumps({name: hashlib.sha256((ROOT / 'frontend' / name).read_bytes()).hexdigest() for name in ('app.js', 'practice_math.js', 'media_mixer.js')}, indent=2), encoding='utf-8')
            if args.buffer_media:
                evaluate(socket, 3, r"""(async()=>{
                  const p=bluetoothDeviceProbe;
                  const blobs=await Promise.all(p.saved.media.map(async({src})=>{
                    const r=await fetch(src,{cache:'no-store'});
                    if(!r.ok||!r.headers.get('content-type')?.startsWith('audio/'))throw Error('Cannot fetch backing audio');
                    return r.blob();
                  }));
                  p.saved.media.forEach(({audio},i)=>{const url=URL.createObjectURL(blobs[i]);p.urls.push(url);audio.src=url;audio.load()});
                  await Promise.all(p.saved.media.map(({audio})=>waitForMediaReady(audio,3,8000)));
                  return {buffered:true};
                })()""")
            for index, phase in enumerate(args.phases):
                if args.label:
                    evaluate(socket, 8, f'showToast({json.dumps(args.label)})')
                evaluate(socket, 10 + index, START.replace('PHASE', json.dumps(phase)).replace('RESET', json.dumps(args.reset_output)))
                snapshot = evaluate(socket, 20 + index, SNAPSHOT)
                result = evaluate(socket, 30 + index, MEASURE.replace('DURATION', str(args.seconds * 1000)))
                after_measure = evaluate(socket, 40 + index, SNAPSHOT)
                audio = subprocess.run([str(ADB), 'shell', 'dumpsys', 'audio'], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=10, check=True).stdout
                (args.output / f'{phase}-audio.txt').write_text(audio, encoding='utf-8')
                for service in ('media.audio_policy', 'media.audio_flinger'):
                    details = subprocess.run([str(ADB), 'shell', 'dumpsys', service], capture_output=True, text=True,
                                             encoding='utf-8', errors='replace', timeout=10, check=True).stdout
                    (args.output / f'{phase}-{service}.txt').write_text(details, encoding='utf-8')
                row = {'phase': phase, 'candidate': args.candidate, 'bufferedMedia': args.buffer_media, 'snapshot': snapshot, 'afterMeasure': after_measure, **result}
                results.append(row)
                (args.output / 'result.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
                print(json.dumps({k: v for k, v in row.items() if k not in ('frames', 'pitch')}), flush=True)
        finally:
            evaluate(socket, 90, 'bluetoothDeviceProbe.cleanup()')
            after = evaluate(socket, 91, SNAPSHOT)
            (args.output / 'after.json').write_text(json.dumps(after, indent=2), encoding='utf-8')
            assert not after['running'] and after['microphone'] == 'idle', after
            assert abs(after['position']['mediaTime'] - before['position']['performanceTime']) < .1, after
            assert after['volume'] == before['volume'], after


if __name__ == '__main__':
    main()
