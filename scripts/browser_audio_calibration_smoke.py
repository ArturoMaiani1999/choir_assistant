"""Unified guide through actual Web Audio/Workers, including reopen and cancellation."""
import argparse
import base64
import json
import subprocess
import tempfile
import time
import urllib.request
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from pathlib import Path

import websocket
from browser_practice_smoke import CHROME, command, evaluate
from browser_echo_cancellation_smoke import FIXTURE, LIVE_CHECK, diagnostic_checks

OUT = Path(__file__).resolve().parents[1] / 'artifacts' / 'audio-calibration'
VOICE = r"""
window.calibrationResults=[];
window.calibrationProbeStarts=[];
const NativeBufferSource=AudioContext.prototype.createBufferSource;
AudioContext.prototype.createBufferSource=function(...args){
  const source=NativeBufferSource.apply(this,args),start=source.start.bind(source);
  source.start=(...times)=>{
    if(window.testNativeRoute&&source.buffer?.duration===2){
      const pcm=source.buffer.getChannelData(0);
      const expected=ChoirEchoCancellation.noise(pcm.length,.08,calibrationProbeStarts.length?957:173);
      calibrationProbeStarts.push({at:times[0],duration:source.buffer.duration,rms:Math.sqrt(pcm.reduce((s,v)=>s+v*v,0)/pcm.length),matchesNoise:pcm.every((v,i)=>v===expected[i])});
    }
    return start(...times);
  };
  return source;
};
const NativeWorker=window.Worker;
window.cancelledCalibrationWorkerErrors=[];
window.Worker=class extends NativeWorker {
  constructor(...args){super(...args);this.voice=String(args[0]).includes('microphone_calibration_worker');if(this.voice)this.addEventListener('message',e=>{if(e.data.type==='result')calibrationResults.push(e.data.result)});this.addEventListener('error',e=>{if(this.cancelledByTestedLifecycle){cancelledCalibrationWorkerErrors.push({message:e.message,voice:this.voice});e.preventDefault();}});}
  terminate(){this.cancelledByTestedLifecycle=true;return super.terminate();}
  postMessage(data,...rest){
    if(data?.mode==='ready'&&(this.voice?window.holdVoiceWorkerReady:window.holdEchoWorkerReady))return;
    if(this.voice&&data?.frames&&window.holdVoiceAnalysis)return;
    if(data?.frames){const times=data.frames.map(f=>f.timeSec),deltas=times.slice(1).map((t,i)=>t-times[i]);
      window.calibrationTiming={frames:times.length,first:times[0],last:times.at(-1),nonIncreasing:deltas.filter(d=>d<=0).length,maxGap:Math.max(...deltas)};}
    return super.postMessage(data,...rest);
  }
};
setInterval(()=>{
  if(!window.echoFixture||window.manualAudio)return;
  const instruction=document.getElementById('calibration-instruction')?.textContent||'';
  if(window.injectTrainingJump&&!window.trainingJumpDone&&instruction==='Ascolta senza cantare'){
    window.trainingNoiseStart??=performance.now();
    if(performance.now()-window.trainingNoiseStart>1200){
      echoFixture.delay.delayTime.value=.075;window.trainingJumpDone=true;
    }
  }
  const singing=document.getElementById('calibration-dialog')?.dataset.phase==='capture'&&instruction.startsWith('Canta');
  echoFixture.voiceGain.gain.value=singing?(instruction.includes('piano')?.05:.12):0;
},20);
"""

def main():
    global OUT
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',default='http://127.0.0.1:5190/?piece=o-sacrum&part=P3')
    parser.add_argument('--headphones',action='store_true')
    parser.add_argument('--extended',action='store_true',help='Test same-F0 voice, volume following, delay changes and clipping')
    parser.add_argument('--diagnostics',action='store_true',help='Requires the local diagnostic Worker/proxy fixture')
    parser.add_argument('--member-id',default=None,help='Optional member ID for the local UI fixture')
    parser.add_argument('--output',type=Path,default=None)
    parser.add_argument('--without-piece',action='store_true',help='Calibrate from Home before loading any score/player')
    parser.add_argument('--diagnostic-only',action='store_true',help='Record/upload with no prior calibration')
    parser.add_argument('--worker-loading-check',action='store_true',help='Verify preparation, silent load timeout and cleanup')
    parser.add_argument('--voice-worker-loading-check',action='store_true',help='Verify vocal analysis is available before any acoustic capture')
    parser.add_argument('--voice-analysis-timeout-check',action='store_true',help='Verify missing analysis response releases capture')
    parser.add_argument('--training-jump-check',action='store_true',help='Inject one real 40 ms acoustic-path change during initial training')
    parser.add_argument('--graph-churn-check',action='store_true',help='Exercise the production monitor through deliberate graph contention')
    parser.add_argument('--native-aec',action='store_true',help='Test platform capture and the unified guide with a processed synthetic input')
    parser.add_argument('--aec-all',action='store_true',help='Test the explicit URL-scoped all trial with a synthetic extended capture mode')
    parser.add_argument('--live-voice-check',action='store_true',help='Verify admitted live pitch after calibration enters Santo, then stop')
    parser.add_argument('--pitch-worker-timeout-check',action='store_true',help='Verify saved-profile live pitch recovers when the pitch Worker never replies')
    parser.add_argument('--probe-loading-check','--music-loading-check',dest='probe_loading_check',action='store_true',help='Reject unavailable calibration probes before acoustic capture')
    args=parser.parse_args()
    if args.aec_all:
        if not args.native_aec:parser.error('--aec-all requires --native-aec')
        u=urlsplit(args.url);query=dict(parse_qsl(u.query));query['aec']='all'
        args.url=urlunsplit((u.scheme,u.netloc,u.path,urlencode(query),u.fragment))
    OUT=args.output or (OUT/'headphones' if args.headphones else OUT)
    OUT.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='audio-calibration-') as profile:
        chrome=subprocess.Popen([str(CHROME),'--headless=new','--disable-gpu','--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--remote-allow-origins=*',
            '--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        ws=None
        try:
            portfile=Path(profile)/'DevToolsActivePort'
            for _ in range(120):
                try:
                    port=portfile.read_text().splitlines()[0]
                    if port:break
                except (OSError,IndexError):pass
                time.sleep(.05)
            else:raise RuntimeError('Chrome debugging port unavailable')
            page=next(p for p in json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json')) if p.get('type')=='page')
            ws=websocket.create_connection(page['webSocketDebuggerUrl'],timeout=50)
            command(ws,1,'Page.enable')
            command(ws,2,'Page.addScriptToEvaluateOnNewDocument',{'source':('window.testNativeRoute=true;' if args.native_aec else '')+"localStorage.setItem('choir-audio-output:v2',JSON.stringify({type:"+json.dumps('bluetooth' if args.headphones else 'standard')+",confirmedAt:Date.now()}));"+FIXTURE+VOICE})
            command(ws,3,'Page.navigate',{'url':args.url})
            for i in range(10,310):
                try:
                    if evaluate(ws,i,"typeof state!=='undefined'&&Boolean(microphoneCalibrationUI)" + ("" if args.without_piece else "&&Boolean(state.runtime)")):break
                except RuntimeError:pass
                time.sleep(.1)
            else:raise RuntimeError('Practice not ready: '+str(evaluate(ws,190,"({url:location.href,errors:window.echoErrors,loading:document.querySelector('#asset-status')?.textContent})")))

            def js(source):return evaluate(ws,200,source)
            def shots(name,selector='#calibration-dialog'):
                for width,height,device in [(1366,768,'desktop'),(390,844,'mobile')]:
                    command(ws,201,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':False})
                    time.sleep(.15)
                    bounds=js(f"""(()=>{{const d=document.querySelector({json.dumps(selector)}),r=d.getBoundingClientRect();return {{height:r.height,bottom:r.bottom,overflow:d.scrollHeight>d.clientHeight+2,wide:document.documentElement.scrollWidth>innerWidth}}}})()""")
                    shot=command(ws,202,'Page.captureScreenshot',{'format':'png','fromSurface':True})
                    (OUT/f'{device}-{name}.png').write_bytes(base64.b64decode(shot['data']))
                    assert bounds['height']<height and bounds['bottom']<=height and not bounds['overflow'] and not bounds['wide'],bounds

            js("""(async()=>{
              document.querySelectorAll('dialog[open]').forEach(d=>d.close());
              openDetectorSettings('basic');
            })()""")
            if args.member_id:js('state.performanceMe={member:{id:'+json.dumps(args.member_id)+'}}')
            js("""(async()=>{
              localStorage.removeItem(AUDIO_OUTPUT_STORAGE_KEY);restoreAudioOutputPreference();updateDetectorSettingsUi();
              if(state.audioOutputType!==null)throw Error('Missing choice silently selected a device');
              await applyAudioOutputChoice('bluetooth');
              if(echoCancellationUI.enabled()||state.plumeSettings.timeAdvanceMs!==190)throw Error('Bluetooth route failed');
              localStorage.setItem(AUDIO_OUTPUT_STORAGE_KEY,JSON.stringify({type:'bluetooth',confirmedAt:Date.now()-3600000}));
              if(!restoreAudioOutputPreference())throw Error('Valid daily choice expired');
            })()""")
            if not args.headphones:
                js("applyAudioOutputChoice('standard')")
            time.sleep(.25)
            if args.diagnostic_only:
                result=diagnostic_checks(ws,OUT,verified=False)
                js("if(echoErrors.length)throw Error(echoErrors.join(';'))")
                (OUT/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
                print(json.dumps(result,ensure_ascii=True));return
            shots('base','#settings-dialog')
            js("document.querySelector('#settings-calibrate').click()")
            time.sleep(.2);shots('ready')
            if args.worker_loading_check:js('window.holdEchoWorkerReady=true')
            if args.voice_worker_loading_check:js('window.holdVoiceWorkerReady=true')
            if args.voice_analysis_timeout_check:js('window.holdVoiceAnalysis=true')
            if args.training_jump_check:js('window.injectTrainingJump=true')
            if args.probe_loading_check:js("window.ChoirCalibrationProbe={...ChoirCalibrationProbe,load:async()=>{throw Error('Preparazione audio non riuscita. Riprova.')}}")
            js("window.sampleCountBefore=state.pitchSamples.length;document.querySelector('#calibration-start').click()")
            if args.probe_loading_check:
                for _ in range(150):
                    if not js('microphoneCalibrationUI.isBusy()'):break
                    time.sleep(.1)
                result=js("""(()=>{
                  if(state.microphoneStream||state.playbackMixer.calibrationMuted||calibrationProbeStarts.length)throw Error('Probe failure leaked capture or sound');
                  if(!/Preparazione audio non riuscita/.test(document.querySelector('#calibration-status').textContent))throw Error('Missing recoverable preparation error: '+document.querySelector('#calibration-status').textContent);
                  return {unavailableProbe:true,noSound:true,microphoneReleased:true};
                })()""")
                shots('probe-failed');(OUT/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));return
            if args.worker_loading_check or args.voice_worker_loading_check:
                time.sleep(2);shots('loading')
                js("if(!document.querySelector('#calibration-instruction').textContent.includes('Preparazione audio'))throw Error('Missing preparation state')")
                for _ in range(150):
                    if not js('microphoneCalibrationUI.isBusy()'):break
                    time.sleep(.1)
                result=js("""(()=>{
                  const assert=(v,m)=>{if(!v)throw Error(m)};
                  const journal=echoCancellationUI.lifecycle();
                  assert(window.holdVoiceWorkerReady||journal.events.some(e=>e.reason==='analysis-worker-load-timeout'),'Missing loading failure');
                  assert(!journal.events.some(e=>e.reason==='analysis-worker-ready'||e.reason==='analysis-start'||e.reason==='model-applied'),'Capture started without an available worker');
                  assert(/Preparazione audio (non riuscita|troppo lenta)/.test(document.querySelector('#calibration-status').textContent),'Wrong loading error');
                  assert(!state.microphoneStream&&!state.playbackMixer.calibrationMuted,'Load failure retained microphone or warmup');
                  assert(echoErrors.length===0,echoErrors.join(';'));
                  return {loadTimeout:true,noAcousticCapture:true,microphoneReleased:true};
                })()""")
                shots('loading-failed')
                (OUT/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
                print(json.dumps(result));return
            time.sleep(4);shots('speakers')
            js("window.sameStream=state.microphoneStream;window.sameContext=state.microphoneContext")
            for _ in range(250):
                instruction=js("document.querySelector('#calibration-instruction').textContent")
                if instruction.startswith('Canta'):break
                if js("!microphoneCalibrationUI.isBusy()"):raise AssertionError(js("document.querySelector('#calibration-status').textContent"))
                time.sleep(.1)
            else:raise AssertionError('No voice phase')
            shots('voice')
            for _ in range(500 if args.voice_analysis_timeout_check else 300):
                if not js("microphoneCalibrationUI.isBusy()"):break
                time.sleep(.1)
            if args.voice_analysis_timeout_check:
                result=js("""(()=>{
                  if(microphoneCalibrationUI.isBusy())throw Error('Analysis remains busy');
                  if(!document.querySelector('#calibration-status').textContent.includes('Analisi troppo lenta'))throw Error('Missing analysis deadline');
                  if(state.microphoneStream||state.playbackMixer.calibrationMuted)throw Error('Timeout retained capture');
                  if(calibrationResults.length)throw Error('Unverified result applied');
                  if(echoErrors.length)throw Error(echoErrors.join(';'));
                  return {analysisTimeout:true,microphoneReleased:true,noResultApplied:true};
                })()""")
                shots('analysis-timeout')
                (OUT/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
                print(json.dumps(result));return
            result=js("""(()=>{
              const assert=(v,m)=>{if(!v)throw Error(m)};
              assert(!document.querySelector('#calibration-done').hidden,'Not applied: '+document.querySelector('#calibration-status').textContent+' / '+JSON.stringify(calibrationResults)+' timing='+JSON.stringify(window.calibrationTiming));
              assert(state.microphoneStream===sameStream&&state.microphoneContext===sameContext,'Audio chain reopened');
              assert(state.pitchSamples.length===sampleCountBefore&&!state.clock?.running,'Calibration entered history');
              assert(state.microphoneStatus==='active'&&(!echoCancellationUI.enabled()||echoCancellationUI.ready()),'Live graph not retained');
              assert(state.playbackMixer.calibrationMuted,'Warmup made music audible');
              assert(microphoneCalibrationUI.activeSettings(),'No voice profile');
              assert(window.calibrationTiming?.nonIncreasing===0,'Duplicate calibration window');
              return {echo:echoCancellationUI.diagnostics(),report:document.querySelector('#calibration-report').innerText};
            })()""")
            if args.aec_all:
                result['allTrial']=js("""(()=>{const d=echoCancellationUI.diagnostics(),s=state.microphoneStream.getAudioTracks()[0].getSettings();if(d.requestedMode!=='all'||d.captureMode!=='all'||s.echoCancellation!=='all'||!d.experimental)throw Error('All trial not activated');if(!document.getElementById('echo-live-status').textContent.includes('prova all'))throw Error('Missing trial label');return {requested:d.requestedMode,effective:d.captureMode,experimental:d.experimental,separateChain:ChoirMicrophoneCalibration.chainSettings(s,state.microphoneContext.sampleRate).echoCancellation==='all'}})()""")
            if args.native_aec and not args.headphones:
                result['probe']=js("""(()=>{
                  const p=calibrationProbeStarts;
                  if(p.length!==2||Math.abs(p[1].at-p[0].at-3)>.001||p.some(v=>!v.matchesNoise))throw Error('Broadband PCM/timing differs: '+JSON.stringify(p));
                  if(!echoCancellationUI.lifecycle().events.some(e=>e.reason==='measurement-platform-start'&&e.probeId==='broadband-noise-v1'))throw Error('Missing broadband provenance');
                  return {starts:p,twoPassages:true,gapSeconds:1};
                })()""")
            shots('result')
            if args.training_jump_check:
                result['trainingJump']=js("""(()=>{
                  const events=echoCancellationUI.lifecycle().events;
                  if(!window.trainingJumpDone)throw Error('No training jump injected');
                  if(events.filter(e=>e.reason==='measurement-unstable-delay').length!==1)throw Error('Expected exactly one retry');
                  if(events.filter(e=>e.reason==='model-applied').length!==1)throw Error('Rejected model applied');
                  if(Math.abs(echoCancellationUI.diagnostics().peakDelayMs-75)>.2)throw Error('Wrong final delay');
                  return {jumpMs:40,retries:1,finalDelayMs:echoCancellationUI.diagnostics().peakDelayMs};
                })()""")
            js("document.querySelector('#calibration-done').click()")
            if not args.headphones:
                result['settingsLifecycle']=js("""(async()=>{
                  const assert=(v,m)=>{if(!v)throw Error(m)};
                  const before=echoCancellationUI.diagnostics();
                  const native=before.strategy==='platform';
                  assert(before.ready&&(native?before.appliedGain===0:before.appliedGain===1&&before.modelId),'Missing applied model identity');
                  for(let i=0;i<5;i++){
                    openDetectorSettings('basic');await new Promise(r=>setTimeout(r,30));
                    document.querySelector('#settings-dialog').close();
                    assert(echoCancellationUI.diagnostics().modelId===before.modelId&&echoCancellationUI.ready(),'Settings invalidated model');
                  }
                  const journal=echoCancellationUI.lifecycle();
                  assert(journal.events.some(e=>e.reason==='model-applied'&&(native?e.strategy==='platform':e.targetGain===1&&e.modelId===before.modelId)),'No model application command: '+JSON.stringify(journal));
                  assert(journal.events.filter(e=>e.reason==='settings-open').length>=5,'Missing settings events');
                  return {settingsCycles:5,modelId:before.modelId,strategy:before.strategy,eventCount:journal.events.length};
                })()""")
            if args.without_piece:
                if args.native_aec:
                    result['withoutPiece']=js("""(async()=>{
                      const assert=(v,m)=>{if(!v)throw Error(m)};
                      assert(state.clock===null&&!state.runtime,'Expected Home');
                      const stream=state.microphoneStream,context=state.microphoneContext;
                      await loadPracticePiece('ave-verum',{partId:'P3'});
                      assert(state.microphoneStream===stream&&state.microphoneContext===context,'Loading song reopened input');
                      assert(microphoneCalibrationUI.activeSettings()&&echoCancellationUI.ready(),'Loading song lost platform/voice verification');
                      openDetectorSettings('basic');await new Promise(r=>setTimeout(r,100));
                      assert(document.querySelector('#settings-calibration-status').textContent==='Profilo voce attivo','Wrong saved status');
                      document.querySelector('#settings-audio-output-standard').click();document.querySelector('#settings-dialog').close();
                      window.calibrationResults=[];await togglePlayback();
                      assert(state.clock.running&&echoCancellationUI.ready(),'Play required another calibration');
                      assert(calibrationResults.length===0,'Voice guide was repeated');
                      openDetectorSettings('basic');await new Promise(r=>setTimeout(r,100));
                      assert(echoCancellationUI.ready()&&state.microphoneStream===stream,'Settings lost the route');
                      document.querySelector('#settings-dialog').close();await stopMicrophone();
                      assert(!echoCancellationUI.ready()&&!state.playbackMixer.calibrationMuted,'Stop retained verification/warmup');
                      return {fullGuide:true,profileRetainedIntoSong:true,noRepeatedGuide:true,settingsRetainGraph:true,stop:true};
                    })()""")
                    (OUT/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result));return
                js("""(async()=>{
                  const assert=(v,m)=>{if(!v)throw Error(m)};
                  assert(state.clock===null&&!state.runtime,'Test must start without a score/player');
                  const stream=state.microphoneStream,context=state.microphoneContext;
                  await loadPracticePiece('ave-verum',{partId:'P3'});
                  assert(state.microphoneStream===stream&&state.microphoneContext===context,'Loading song reopened the microphone');
                  assert(microphoneCalibrationUI.activeSettings(),'Loading song lost the voice profile');
                  assert(!echoCancellationUI.ready(),'Changed output route was not invalidated');
                  assert(echoCancellationUI.diagnostics().appliedGain===0,'Invalid route still subtracts');
                  assert(echoCancellationUI.lifecycle().events.some(e=>e.reason==='invalidate:piece-output-route'),'Missing route invalidation cause');
                  openDetectorSettings('basic');await new Promise(r=>setTimeout(r,100));
                  assert(microphoneCalibrationUI.activeSettings()&&document.querySelector('#settings-calibration-status').textContent.includes('Voce salvata'),'Base misreported saved profile');
                  document.querySelector('#settings-audio-output-standard').click();
                  document.querySelector('#settings-dialog').close();
                  window.calibrationResults=[];await togglePlayback();
                  assert(state.clock.running&&echoCancellationUI.ready(),'Automatic acoustic-only verification did not start rehearsal');
                  assert(calibrationResults.length===0,'Asked to sing the voice calibration again');
                  openDetectorSettings('basic');await new Promise(r=>setTimeout(r,100));
                  assert(echoCancellationUI.ready()&&state.microphoneStream===stream,'Reopening Base lost calibrated chain');
                  document.querySelector('#settings-dialog').close();
                  await stopMicrophone();
                  assert(!state.playbackMixer.calibrationMuted&&!echoCancellationUI.ready(),'Stop retained no-player warmup');
                  await microphoneCalibrationUI.open();
                  document.querySelector('#calibration-start').click();
                  await new Promise(r=>setTimeout(r,600));
                  assert(microphoneCalibrationUI.isBusy(),'Reopening from Home failed');
                  document.querySelector('#calibration-close').click();
                  await new Promise(r=>setTimeout(r,150));
                  assert(!state.microphoneStream&&!state.playbackMixer.calibrationMuted,'Cancellation from Home retained audio');
                  assert(echoErrors.length===0,echoErrors.join(';'));
                })()""")
                result['withoutPiece']={'fullGuide':True,'applied':True,'profileRetainedIntoSong':True,'automaticAcousticOnly':True,'settingsRetainGraph':True,'stop':True,'cancel':True}
                js("openDetectorSettings('basic')")
                time.sleep(.1);shots('saved-profile','#settings-dialog')
                (OUT/'result.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
                print(json.dumps(result,ensure_ascii=True))
                return
            if args.native_aec and args.live_voice_check and not args.without_piece:
                result['voiceDuringPlayback']=js("""(async()=>{
                  const assert=(v,m)=>{if(!v)throw Error(m)};
                  const input=state.microphoneStream,context=state.microphoneContext;
                  const settings=JSON.stringify(activeRecognitionSettings()),before=state.pitchSamples.length;
                  // This is the post-AEC synthetic voice, not a simulation of
                  // Samsung's internal canceller. Exercise the actual live
                  // worker, admission gate and stored trace after entering Play.
                  window.manualAudio=true;echoFixture.voiceGain.gain.value=.05;
                  try {
                    await togglePlayback();await new Promise(r=>setTimeout(r,1500));
                    assert(state.clock.running&&!state.playbackMixer.calibrationMuted,'Play retained calibration warmup');
                    assert(state.microphoneStream===input&&state.microphoneContext===context,'Play changed microphone route');
                    assert(JSON.stringify(activeRecognitionSettings())===settings,'Play changed recognition thresholds');
                    const voiced=state.pitchSamples.slice(before).filter(p=>Number.isFinite(p.trackedPitch));
                    assert(voiced.length>=5,'Voice reached calibration but not the live trace: '+JSON.stringify({rms:state.microphoneRms,pitch:state.trackedPitch,settings:activeRecognitionSettings(),samples:state.pitchSamples.length-before}));
                    assert(voiced.every(p=>Math.abs(p.trackedPitch-57)<.2),'Live F0 differs from the supplied 220 Hz voice');
                    return {workerRecognizesVoice:true,voicedFrames:voiced.length,sameInput:true,sameSettings:true};
                  } finally {
                      echoFixture.voiceGain.gain.value=0;window.manualAudio=false;
                  }
                })()""")
            if args.live_voice_check:
                (OUT/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result));return
            if args.graph_churn_check and not args.headphones:
                result['graphContention']=js("""(async()=>{
                  const ctx=state.playbackMixer.context,bus=state.playbackMixer.referenceOutput;
                  const before=echoCancellationUI.diagnostics(),started=performance.now();let mutations=0;
                  while(performance.now()-started<2500){
                    for(let i=0;i<100;i++){const n=ctx.createGain();bus.connect(n);n.connect(ctx.destination);bus.disconnect(n);n.disconnect();mutations++;}
                    await new Promise(r=>setTimeout(r,10));
                  }
                  await new Promise(r=>setTimeout(r,400));const after=echoCancellationUI.diagnostics();
                  if(!after.ready||after.modelId!==before.modelId||after.targetGain!==before.targetGain)throw Error('Graph contention invalidated the verified model: '+JSON.stringify(after));
                  return {mutations,before:before.clock,after:after.clock,modelRetained:true};
                })()""")
            if args.extended and not args.headphones:
                js("window.manualAudio=true")
                try:
                    js("(async()=>{const assert=(v,m)=>{if(!v)throw Error(m)};"+LIVE_CHECK+"})()")
                except Exception as error:
                    result['failedLiveCheck']={'error':str(error),'state':js("({echo:echoCancellationUI.diagnostics(),lifecycle:echoCancellationUI.lifecycle(),microphoneRate:state.microphoneContext.sampleRate,mixerRate:state.playbackMixer.context.sampleRate,pcm:Array.from(state.microphoneBuffer)})")}
                    (OUT/'failed-live-check.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
                    raise
                result['volume']=js('window.echoVolumeResult')
                js("echoFixture.voiceGain.gain.value=.03")
            if args.diagnostics:
                result['diagnostic']=diagnostic_checks(ws,OUT)
            js("window.manualAudio=false")
            if not args.headphones and not args.diagnostics:
                result['contextInterruption']=js("""(async()=>{
                  const context=state.playbackMixer.context;
                  if(!echoCancellationUI.ready())throw Error('No verified model before interruption');
                  await context.suspend();await new Promise(r=>setTimeout(r,50));
                  // AudioParam.value can retain the last rendered value while
                  // suspended. Verify invalidation and the scheduled target;
                  // verify the rendered value only after resuming the context.
                  if(echoCancellationUI.ready()||echoCancellationUI.diagnostics().targetGain!==0)throw Error('Suspension retained the room model');
                  await context.resume();await new Promise(r=>setTimeout(r,50));
                  if(echoCancellationUI.ready()||echoCancellationUI.diagnostics().appliedGain!==0)throw Error('Resume restored an invalid model');
                  const events=echoCancellationUI.lifecycle().events;
                  if(!events.some(e=>e.reason==='invalidate:audio-context-suspended'))throw Error('Missing interruption checkpoint');
                  return {suspensionInvalidates:true,resumeNeedsVerification:true};
                })()""")
            if args.native_aec or args.headphones:
                result['returningVisit']=js("""(async()=>{
                  const assert=(v,m)=>{if(!v)throw Error(m)};
                  await stopMicrophone();assert(!microphoneCalibrationUI.activeSettings(),'Stopped input retained live profile');
                  for(const k of Object.keys(localStorage))if(k.startsWith('choir-microphone-calibration:v2:')){
                    const p=JSON.parse(localStorage.getItem(k));if(p?.createdAt){p.createdAt-=365*86400000;localStorage.setItem(k,JSON.stringify(p));}
                  }
                  const analyses=calibrationResults.length;
                  await togglePlayback();
                  assert(state.clock.running&&microphoneCalibrationUI.activeSettings(),'Saved profile did not start Play');
                  assert(!document.querySelector('#calibration-dialog').open&&!microphoneCalibrationUI.isBusy(),'Return opened the guide');
                  assert(calibrationResults.length===analyses,'Return repeated voice analysis');
                  if(echoCancellationUI.enabled())assert(echoCancellationUI.operational()&&!echoCancellationUI.ready(),'Restored route pretended to have a fresh acoustic measure');
                  const stream=state.microphoneStream,recognition=JSON.stringify(microphoneCalibrationUI.activeSettings());
                  for(const n of [25,80,50]){
                    els.volume.value=n;els.volume.dispatchEvent(new Event('input'));
                    els.metronomeVolume.value=n;els.metronomeVolume.dispatchEvent(new Event('input'));
                  }
                  assert(state.clock.running&&state.microphoneStream===stream&&!document.querySelector('#calibration-dialog').open,'Volume change interrupted the route');
                  assert(JSON.stringify(microphoneCalibrationUI.activeSettings())===recognition,'Volume change changed the voice thresholds');
                  return {yearOldProfile:true,noNewGuide:true,noFreshAcousticClaim:true,volumeChangesKeepRoute:true};
                })()""")
                shots('returning-play','#practice-transport')
                js('(async()=>{await togglePlayback();await stopMicrophone()})()')
                previous_origin=js('performance.timeOrigin')
                command(ws,203,'Page.reload')
                for _ in range(300):
                    try:
                        if js(f"performance.timeOrigin!=={previous_origin}&&typeof togglePlayback==='function'&&typeof state!=='undefined'&&Boolean(state.runtime)&&Boolean(microphoneCalibrationUI)"):break
                    except RuntimeError:pass
                    time.sleep(.1)
                else:raise AssertionError('Reload did not initialize practice')
                if args.pitch_worker_timeout_check:
                    js("""(()=>{const Native=window.Worker;window.Worker=class{constructor(...args){if(String(args[0]).includes('pitch_detector_worker'))return {postMessage(){},terminate(){}};return new Native(...args)}}})()""")
                result['reload']=js("""(async()=>{
                  await togglePlayback();
                  if(!state.clock.running||!microphoneCalibrationUI.activeSettings()||document.querySelector('#calibration-dialog').open)throw Error('Reload asked for another guide');
                  if(calibrationResults.length)throw Error('Reload ran vocal analysis');
                  if(echoCancellationUI.enabled()&&(!echoCancellationUI.operational()||echoCancellationUI.ready()))throw Error('Reload lost native route/provenance');
                  return {savedAcrossReload:true,playWithoutGuide:true};
                })()""")
                if args.native_aec:
                    result['restoredLiveVoice']=js("""(async()=>{
                      window.manualAudio=true;echoFixture.voiceGain.gain.value=.05;
                      try {
                        const start=state.pitchSamples.length;
                        await new Promise(r=>setTimeout(r,4500));
                        const voiced=state.pitchSamples.slice(start).filter(p=>Number.isFinite(p.trackedPitch));
                        if(!state.pitchAnalysisTimer||!Number.isFinite(state.trackedPitch)||voiced.length<5)throw Error('Restored profile left live analysis stopped: '+JSON.stringify({timer:!!state.pitchAnalysisTimer,voiced:voiced.length,mic:state.microphoneStatus,pitch:state.trackedPitch}));
                        if(voiced.some(p=>Math.abs(p.trackedPitch-57)>.2))throw Error('Restored live voice differs from supplied 220 Hz');
                        return {analysisRunning:true,voicedFrames:voiced.length,profileReused:true};
                      } finally {echoFixture.voiceGain.gain.value=0;window.manualAudio=false;}
                    })()""")
                    if args.pitch_worker_timeout_check:
                        result['pitchWorkerTimeout']=js("""(()=>{if(!state.pitchWorkerDisabled||state.pitchWorkerInFlight||!state.pitchAnalysisTimer)throw Error('Pitch Worker fallback did not recover');return {fallback:true,analysisRunning:true,workerReleased:!state.pitchWorker}})()""")
                js("(async()=>{await togglePlayback();openDetectorSettings('basic')})()")
                time.sleep(.15);shots('remembered-base','#settings-dialog')
                js("document.querySelector('#settings-dialog').close();void togglePlayback()")
                time.sleep(.5)
                if not args.headphones:
                    result['incompatibleProfiles']=js("""(async()=>{
                      const assert=(v,m)=>{if(!v)throw Error(m)},wait=ms=>new Promise(r=>setTimeout(r,ms));
                      await togglePlayback();const gum=navigator.mediaDevices.getUserMedia;
                      navigator.mediaDevices.getUserMedia=async c=>{const stream=await gum(c),t=stream.getAudioTracks()[0],settings=t.getSettings.bind(t);
                        t.getSettings=()=>({...settings(),deviceId:'different-test-microphone'});return stream;};
                      await togglePlayback();
                      assert(!state.clock.running&&!microphoneCalibrationUI.activeSettings()&&document.querySelector('#calibration-dialog').open,'Different microphone reused old profile');
                      navigator.mediaDevices.getUserMedia=gum;document.querySelector('#calibration-close').click();await wait(100);
                      microphoneCalibrationUI.inputChanged();await togglePlayback();
                      assert(state.clock.running&&microphoneCalibrationUI.activeSettings(),'Original microphone did not restore');
                      await togglePlayback();const member=state.performanceMe.member.id;state.performanceMe.member.id='different-test-account';
                      await togglePlayback();
                      assert(!state.clock.running&&!microphoneCalibrationUI.activeSettings(),'Different account reused old profile');
                      document.querySelector('#calibration-close').click();await wait(100);state.performanceMe.member.id=member;
                      microphoneCalibrationUI.inputChanged();await togglePlayback();
                      assert(state.clock.running&&microphoneCalibrationUI.activeSettings(),'Original account did not restore');
                      return {differentMicrophoneRejected:true,differentAccountRejected:true,originalProfileRetained:true};
                    })()""")
            else:
                # The legacy custom filter retains its explicit acoustic check.
                js("(async()=>{await stopMicrophone();await microphoneCalibrationUI.open()})()")
                js("window.recheckStart=performance.now();document.querySelector('#calibration-start').click()")
                time.sleep(1)
                for _ in range(280):
                    if not js('microphoneCalibrationUI.isBusy()'):break
                    time.sleep(.1)
                js("if(document.querySelector('#calibration-done').hidden)throw Error('Reuse failed');document.querySelector('#calibration-done').click()")
            # A native user gesture releases the warm media into rehearsal.
            js("localStorage.removeItem(AUDIO_OUTPUT_STORAGE_KEY)")
            js("window.playStream=state.microphoneStream;window.playContext=state.microphoneContext;if(!state.clock.running)void togglePlayback()")
            time.sleep(.6)
            js("""(()=>{if(!state.clock.running||state.playbackMixer.calibrationMuted)throw Error('Play did not release warmup');
              if(state.microphoneStream!==playStream||state.microphoneContext!==playContext)throw Error('Play changed audio chain');})()""")
            js("(async()=>{await togglePlayback();await microphoneCalibrationUI.open();document.querySelector('#calibration-start').click()})()")
            time.sleep(.5)
            js("document.querySelector('#calibration-dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
            time.sleep(.3)
            js("""(()=>{if(document.querySelector('#calibration-dialog').open||microphoneCalibrationUI.isBusy()||echoCancellationUI.isBusy())throw Error('Escape did not cancel');
              if(state.microphoneStream||state.clock.running||state.playbackMixer.calibrationMuted)throw Error('Cancellation leaked audio');
              if(echoErrors.length)throw Error(echoErrors.join(';'));})()""")
            result['lifecycle']=js("""(async()=>{
              const $=id=>document.getElementById('calibration-'+id),wait=ms=>new Promise(r=>setTimeout(r,ms));
              const assert=(v,m)=>{if(!v)throw Error(m)};
              const begin=async()=>{await microphoneCalibrationUI.open();$('start').click();await wait(350)};
              await begin();state.ignoreAudioDeviceChangesUntil=0;
              navigator.mediaDevices.dispatchEvent(new Event('devicechange'));await wait(120);
              assert(!microphoneCalibrationUI.isBusy()&&!state.microphoneStream,'Device change retained capture');
              $('start').click();await wait(350);
              Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
              document.dispatchEvent(new Event('visibilitychange'));await wait(120);delete document.visibilityState;
              assert(!microphoneCalibrationUI.isBusy()&&!state.microphoneStream&&!state.playbackMixer.calibrationMuted,'Background retained audio');
              const native=navigator.mediaDevices.getUserMedia;let release,late;
              navigator.mediaDevices.getUserMedia=args=>new Promise(resolve=>{release=()=>native(args).then(stream=>{late=stream;resolve(stream)})});
              $('start').click();await wait(30);$('close').click();await wait(30);
              await release();navigator.mediaDevices.getUserMedia=native;await wait(120);
              assert(!microphoneCalibrationUI.isBusy()&&!state.microphoneStream&&late.getTracks().every(t=>t.readyState==='ended'),'Late permission leaked microphone');
              await microphoneCalibrationUI.open();
              const d=$('dialog'),r=d.getBoundingClientRect();
              d.dispatchEvent(new MouseEvent('click',{clientX:r.left-2,clientY:r.top+3,bubbles:true}));await wait(50);
              assert(!d.open&&document.activeElement===els.settings,'Backdrop/focus failed');
              assert(echoErrors.length===0,echoErrors.join(';'));
              return {deviceChange:true,background:true,latePermission:true,backdrop:true,focus:true};
            })()""")
            (OUT/'result.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
            print(json.dumps(result,ensure_ascii=True))
        finally:
            if ws:ws.close()
            chrome.terminate()
            try:chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:chrome.kill();chrome.wait()

if __name__=='__main__':main()
