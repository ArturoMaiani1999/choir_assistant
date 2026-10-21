"""Exercise the platform probe with real browser capture and fake input.

Validates settings, reference capture, continuity and cleanup; does not
measure acoustic cancellation, because the fake microphone has no room path.
"""
import argparse
import base64
from contextlib import closing
import json
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request

import websocket
from browser_practice_smoke import CHROME, command, evaluate
from probe_android_platform_aec import INSTALL, START, GUIDE, MUSIC

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:5198/?piece=santo-frisina&part=P3')
    parser.add_argument('--output',type=Path,default=Path('artifacts/aec-platform-comparison/browser-smoke.json'))
    parser.add_argument('--voice-check',action='store_true')
    parser.add_argument('--voice-with-music',action='store_true')
    parser.add_argument('--metronome',action='store_true')
    args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='platform-aec-') as profile:
        chrome=subprocess.Popen([str(CHROME),'--headless=new','--mute-audio','--disable-gpu',
            '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required','--remote-allow-origins=*',
            '--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            portfile=Path(profile)/'DevToolsActivePort'
            for _ in range(100):
                if portfile.exists():break
                time.sleep(.05)
            port=portfile.read_text().splitlines()[0]
            pages=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            page=next(p for p in pages if p.get('type')=='page')
            with closing(websocket.create_connection(page['webSocketDebuggerUrl'],timeout=20)) as socket:
                command(socket,1,'Page.enable')
                command(socket,2,'Page.addScriptToEvaluateOnNewDocument',{'source':"window.probeErrors=[];addEventListener('error',e=>probeErrors.push(e.message));addEventListener('unhandledrejection',e=>probeErrors.push(String(e.reason)));"})
                command(socket,3,'Page.navigate',{'url':args.url})
                js=lambda s:evaluate(socket,100,s)
                for _ in range(150):
                    if js("typeof state!=='undefined'&&Boolean(microphoneCalibrationUI)&&Boolean(state.runtime)"):break
                    time.sleep(.1)
                js("document.querySelector('#echo-enabled').click()")
                for _ in range(100):
                    if js('Boolean(state.playbackMixer.referenceOutput)'):break
                    time.sleep(.1)
                build=js('RUNTIME_CONFIG.buildVersion')
                js(INSTALL.replace('__BUILD__',json.dumps(build)))
                if args.voice_with_music:js(MUSIC)
                if args.metronome:js('platformAecProbe.metronomeDuringVoice=true;platformAecProbe.softVoice=true')
                if args.voice_check or args.voice_with_music:js(GUIDE)
                results=[]
                for mode in ['raw','browser']:
                    start=START.replace('__MODE__',json.dumps(mode)).replace(
                        'c.capture.port.onmessage=({data})=>{',
                        'c.capture.port.onmessage=({data})=>{if(data.clockEvent){(c.clockEvents ||= []).push(data.clockEvent);return;}')
                    js(start)
                    if (args.voice_check or args.voice_with_music) and mode=='raw':
                        time.sleep(8)
                        args.output.parent.mkdir(parents=True,exist_ok=True)
                        for name,width,height in [('desktop',1366,768),('mobile',390,844)]:
                            command(socket,11,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':name=='mobile'})
                            time.sleep(.15)
                            shot=command(socket,12,'Page.captureScreenshot',{'format':'png'})
                            (args.output.parent/f'{name}-voice-check.png').write_bytes(base64.b64decode(shot['data']))
                    for _ in range(115):
                        if js('platformAecProbe.current.done'):break
                        time.sleep(.2)
                    result=js("(()=>{const c=platformAecProbe.current;return {mode:c.mode,error:c.error,frames:c.frames,duration:c.duration,sampleRate:c.sampleRate,settings:c.settings,referenceEnergy:c.pcm?.[1].reduce((s,v)=>s+v*v,0),tracksEnded:c.stream.getTracks().every(t=>t.readyState==='ended'),profileVerified:Boolean(microphoneCalibrationUI.activeSettings()),clock:c.clock||null,clockEvents:c.clockEvents||[],errors:probeErrors}})()")
                    if result['error']:
                        args.output.parent.mkdir(parents=True,exist_ok=True)
                        args.output.write_text(json.dumps({'kind':'failed-harness-capture','condition':result},indent=2))
                        raise AssertionError({k:v for k,v in result.items() if k!='error'}|{'error':result['error'].get('error') if isinstance(result['error'],dict) else result['error']})
                    assert result['frames']==result['sampleRate']*result['duration'],result
                    assert result['settings']['echoCancellation']==(mode=='browser'),result
                    assert result['settings']['noiseSuppression'] is False and result['settings']['autoGainControl'] is False,result
                    assert (result['referenceEnergy']==0 if args.voice_check else result['referenceEnergy']>0),result
                    assert result['tracksEnded'] and not result['profileVerified'] and not result['errors'],result
                    results.append(result)
                js('platformAecProbe.finish()')
                args.output.parent.mkdir(parents=True,exist_ok=True)
                args.output.write_text(json.dumps({'kind':'harness-only-no-acoustic-score','conditions':results},indent=2))
                print(json.dumps(results))
        finally:
            chrome.terminate()
            try:chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:chrome.kill();chrome.wait()

if __name__=='__main__':main()
