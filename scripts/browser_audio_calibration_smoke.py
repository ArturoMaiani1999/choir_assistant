"""Unified guide through actual Web Audio/Workers, including reopen and cancellation."""
import argparse
import base64
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket
from browser_practice_smoke import CHROME, command, evaluate
from browser_echo_cancellation_smoke import FIXTURE, LIVE_CHECK, diagnostic_checks

OUT = Path(__file__).resolve().parents[1] / 'artifacts' / 'audio-calibration'
VOICE = r"""
window.calibrationResults=[];
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker {
  constructor(...args){super(...args);if(String(args[0]).includes('microphone_calibration_worker'))this.addEventListener('message',e=>{if(e.data.type==='result')calibrationResults.push(e.data.result)});}
  postMessage(data,...rest){
    if(data?.mode==='ready'&&window.holdEchoWorkerReady)return;
    if(data?.frames){const times=data.frames.map(f=>f.timeSec),deltas=times.slice(1).map((t,i)=>t-times[i]);
      window.calibrationTiming={frames:times.length,first:times[0],last:times.at(-1),nonIncreasing:deltas.filter(d=>d<=0).length,maxGap:Math.max(...deltas)};}
    return super.postMessage(data,...rest);
  }
};
setInterval(()=>{
  if(!window.echoFixture||window.manualAudio)return;
  const instruction=document.getElementById('calibration-instruction')?.textContent||'';
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
    args=parser.parse_args()
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
                if portfile.exists():break
                time.sleep(.05)
            port=portfile.read_text().splitlines()[0]
            page=next(p for p in json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json')) if p.get('type')=='page')
            ws=websocket.create_connection(page['webSocketDebuggerUrl'],timeout=50)
            command(ws,1,'Page.enable')
            command(ws,2,'Page.addScriptToEvaluateOnNewDocument',{'source':FIXTURE+VOICE})
            command(ws,3,'Page.navigate',{'url':args.url})
            for i in range(10,180):
                if evaluate(ws,i,"typeof state!=='undefined'&&Boolean(microphoneCalibrationUI)" + ("" if args.without_piece else "&&Boolean(state.runtime)")):break
                time.sleep(.1)
            else:raise RuntimeError('Practice not ready')

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
            if not args.headphones:
                js("""(async()=>{document.querySelector('#echo-enabled').click();for(let i=0;i<100&&!state.playbackMixer.referenceOutput;i++)await new Promise(r=>setTimeout(r,20));})()""")
            if args.diagnostic_only:
                result=diagnostic_checks(ws,OUT,verified=False)
                js("if(echoErrors.length)throw Error(echoErrors.join(';'))")
                (OUT/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
                print(json.dumps(result,ensure_ascii=True));return
            shots('base','#settings-dialog')
            js("document.querySelector('#settings-calibrate').click()")
            time.sleep(.2);shots('ready')
            if args.worker_loading_check:js('window.holdEchoWorkerReady=true')
            js("window.sampleCountBefore=state.pitchSamples.length;document.querySelector('#calibration-start').click()")
            if args.worker_loading_check:
                time.sleep(2);shots('loading')
                js("if(!document.querySelector('#calibration-instruction').textContent.includes('Preparazione audio'))throw Error('Missing preparation state')")
                for _ in range(150):
                    if not js('microphoneCalibrationUI.isBusy()'):break
                    time.sleep(.1)
                result=js("""(()=>{
                  const assert=(v,m)=>{if(!v)throw Error(m)};
                  const journal=echoCancellationUI.lifecycle();
                  assert(journal.events.some(e=>e.reason==='analysis-worker-load-timeout'),'Missing loading failure');
                  assert(!journal.events.some(e=>e.reason==='analysis-worker-ready'||e.reason==='analysis-start'||e.reason==='model-applied'),'Capture started without an available worker');
                  assert(document.querySelector('#calibration-status').textContent.includes('Preparazione audio non riuscita'),'Wrong loading error');
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
            for _ in range(300):
                if not js("microphoneCalibrationUI.isBusy()"):break
                time.sleep(.1)
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
            shots('result')
            js("document.querySelector('#calibration-done').click()")
            if not args.headphones:
                result['settingsLifecycle']=js("""(async()=>{
                  const assert=(v,m)=>{if(!v)throw Error(m)};
                  const before=echoCancellationUI.diagnostics();
                  assert(before.ready&&before.appliedGain===1&&before.modelId,'Missing applied model identity');
                  for(let i=0;i<5;i++){
                    openDetectorSettings('basic');await new Promise(r=>setTimeout(r,30));
                    document.querySelector('#settings-dialog').close();
                    assert(echoCancellationUI.diagnostics().modelId===before.modelId&&echoCancellationUI.ready(),'Settings invalidated model');
                  }
                  const journal=echoCancellationUI.lifecycle();
                  assert(journal.events.some(e=>e.reason==='model-applied'&&e.targetGain===1&&e.modelId===before.modelId),'No model application command: '+JSON.stringify(journal));
                  assert(journal.events.filter(e=>e.reason==='settings-open').length>=5,'Missing settings events');
                  return {settingsCycles:5,modelId:before.modelId,eventCount:journal.events.length};
                })()""")
            if args.without_piece:
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
            if args.extended and not args.headphones:
                js("window.manualAudio=true")
                js("(async()=>{const assert=(v,m)=>{if(!v)throw Error(m)};"+LIVE_CHECK+"})()")
                result['volume']=js('window.echoVolumeResult')
                js("echoFixture.voiceGain.gain.value=.03")
            if args.diagnostics:
                result['diagnostic']=diagnostic_checks(ws,OUT)
            js("window.manualAudio=false")
            # Opening a fresh stream requires a fresh acoustic check, while the
            # compatible voice profile needs only the short quiet verification.
            js("(async()=>{await stopMicrophone();if(echoCancellationUI.ready())throw Error('Stale acoustic profile');await microphoneCalibrationUI.open()})()")
            js("window.recheckStart=performance.now();document.querySelector('#calibration-start').click()")
            time.sleep(1)
            for _ in range(280):
                if not js("microphoneCalibrationUI.isBusy()"):break
                time.sleep(.1)
            js("""(()=>{if(document.querySelector('#calibration-done').hidden)throw Error('Reuse failed: '+document.querySelector('#calibration-status').textContent);
              if(performance.now()-recheckStart>25000)throw Error('Repeated full voice routine');
              document.querySelector('#calibration-done').click();})()""")
            # A native user gesture releases the warm media into rehearsal.
            js("document.querySelector('#settings-audio-output-standard').click()")
            js("window.playStream=state.microphoneStream;window.playContext=state.microphoneContext;void togglePlayback()")
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
