"""Unified audio choice, exact 24-hour expiry and settings in real Chromium."""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import tempfile
import threading
import time
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

import websocket
from browser_navigation_audit import Handler, ReleaseHandler, ROOT, CHROME, command, evaluate, wait_for, settle


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--directory',type=Path,default=ROOT/'frontend')
    args=parser.parse_args()
    built=args.directory.resolve()!=(ROOT/'frontend').resolve()
    output=ROOT/'artifacts/settings-redesign'/('built' if built else 'source')
    output.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(ReleaseHandler if built else Handler,directory=str(args.directory.resolve())))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    reports=[]
    with tempfile.TemporaryDirectory(prefix='xynon-settings-') as profile:
        chrome=subprocess.Popen([str(CHROME),'--headless=new','--disable-gpu','--remote-allow-origins=*',
            '--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        ws=None
        try:
            port_file=Path(profile)/'DevToolsActivePort'
            for _ in range(120):
                if port_file.exists():break
                time.sleep(.05)
            tabs=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port_file.read_text().splitlines()[0]}/json'))
            ws=websocket.create_connection(next(t for t in tabs if t['type']=='page')['webSocketDebuggerUrl'],timeout=30)
            command(ws,1,'Page.enable')
            command(ws,2,'Page.addScriptToEvaluateOnNewDocument',{'source':"""
              window.settingsErrors=[];window.micCalls=0;
              addEventListener('error',e=>settingsErrors.push(e.message));
              addEventListener('unhandledrejection',e=>settingsErrors.push(String(e.reason)));
              const get=navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices);
              if(get)navigator.mediaDevices.getUserMedia=(...args)=>{micCalls++;return get(...args)};
            """})
            def js(expression):return evaluate(ws,3,expression)
            def go(path):
                command(ws,4,'Page.navigate',{'url':origin+path})
                wait_for(ws,"typeof state!=='undefined'&&!!state.runtime&&!document.querySelector('#startup-status')")
                settle(ws)
            def click(selector):
                point=js(f"""(()=>{{const e=document.querySelector({json.dumps(selector)});
                  if(!e?.checkVisibility())throw Error('Hidden control: '+{json.dumps(selector)});
                  e.scrollIntoView({{block:'nearest'}});const r=e.getBoundingClientRect();
                  return {{x:r.left+r.width/2,y:r.top+r.height/2}}}})()""")
                for kind in ['mousePressed','mouseReleased']:
                    command(ws,5,'Input.dispatchMouseEvent',dict(point,type=kind,button='left',clickCount=1))
                settle(ws)
            def key(name,virtual):
                for kind in ['keyDown','keyUp']:
                    command(ws,6,'Input.dispatchKeyEvent',{'type':kind,'key':name,'code':name,'windowsVirtualKeyCode':virtual})
                settle(ws)
            def capture(name,selector):
                layout=js(f"""(()=>{{const d=document.querySelector({json.dumps(selector)}),r=d.getBoundingClientRect();
                  const controls=[...d.querySelectorAll('button,label.audio-output-choice,summary')].filter(e=>e.checkVisibility());
                  return {{left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:d.scrollHeight-d.clientHeight,
                    horizontal:document.documentElement.scrollWidth>innerWidth||d.scrollWidth>d.clientWidth,
                    small:controls.filter(e=>{{const b=e.getBoundingClientRect();return b.width<44||b.height<44}}).map(e=>e.id),
                    clipped:controls.filter(e=>{{const b=e.getBoundingClientRect();return b.left<0||b.right>innerWidth||b.top<0||b.bottom>innerHeight}}).map(e=>e.id)}};}})()""")
                shot=command(ws,7,'Page.captureScreenshot',{'format':'png','fromSurface':True})
                (output/f'{name}.png').write_bytes(base64.b64decode(shot['data']))
                assert layout['left']>=0 and layout['right']<=js('innerWidth') and layout['top']>=0 and layout['bottom']<=js('innerHeight'),layout
                assert not layout['horizontal'] and not layout['small'] and not layout['clipped'] and layout['scroll']<=1,layout
                return layout
            def choose(kind):
                click(f'#audio-output-form input[value={kind}]')
                click('#audio-output-confirm')
                wait_for(ws,"!document.querySelector('#audio-output-dialog').open")
                assert js(f"state.audioOutputType==={json.dumps(kind)}")

            for width,height in [(1366,768),(390,844)]:
                command(ws,8,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':width<600})
                go('/index.html?piece=ave-verum&part=P3')
                js('localStorage.clear()')
                go('/index.html?piece=ave-verum&part=P3')
                assert js("document.querySelector('#audio-output-dialog').open&&state.audioOutputType===null&&document.querySelector('#audio-output-dialog').contains(document.activeElement)")
                assert js("!document.querySelector('#audio-output-form input:checked')&&document.querySelector('#audio-output-confirm').disabled&&micCalls===0")
                entry_layout=capture(f'entry-{width}','#audio-output-dialog')
                key('Escape',27)
                assert js("!document.querySelector('#audio-output-dialog').open&&state.audioOutputType===null&&!state.clock.running")
                click('#toggle-playback');wait_for(ws,"document.querySelector('#audio-output-dialog').open")
                for kind in ['mousePressed','mouseReleased']:
                    command(ws,5,'Input.dispatchMouseEvent',{'type':kind,'x':1,'y':1,'button':'left','clickCount':1})
                settle(ws)
                assert js("!document.querySelector('#audio-output-dialog').open&&micCalls===0")
                click('#toggle-playback');wait_for(ws,"document.querySelector('#audio-output-dialog').open")
                click('#audio-output-close')
                click('#toggle-playback');wait_for(ws,"document.querySelector('#audio-output-dialog').open")
                choose('bluetooth')
                assert js('!echoCancellationUI.enabled()&&state.plumeSettings.timeAdvanceMs===190&&micCalls===0')
                confirmed=js('JSON.parse(localStorage.getItem(AUDIO_OUTPUT_STORAGE_KEY)).confirmedAt')
                go('/index.html?piece=ave-verum&part=P3')
                assert js("!document.querySelector('#audio-output-dialog').open&&state.audioOutputType==='bluetooth'")
                assert js('JSON.parse(localStorage.getItem(AUDIO_OUTPUT_STORAGE_KEY)).confirmedAt')==confirmed
                click('#settings');click('#settings-menu-advanced')
                assert js("state.plumeSettings.timeAdvanceMs===190&&els.settingsV1PlumeAdvance.value==='190'&&els.settingsV1PlumeAdvanceValue.textContent==='190 ms'")
                assert js("state.plumeSettings.intensity===1.6&&els.settingsV1PlumeIntensity.value==='160'&&els.settingsV1PlumeIntensityValue.textContent==='160%'")
                assert js("document.querySelector('#settings-v1-plume-heading').firstChild.textContent.trim()==='Aspetto scia'")
                js("els.settingsV1PlumeIntensity.value='140';els.settingsV1PlumeIntensity.dispatchEvent(new Event('input'));els.settingsV1PlumeIntensity.dispatchEvent(new Event('change'))")
                assert js('state.plumeSettings.intensity===1.4')
                click('#settings-reset')
                assert js("state.plumeSettings.intensity===1.6&&els.settingsV1PlumeIntensityValue.textContent==='160%'&&state.plumeSettings.timeAdvanceMs===190")
                js("document.querySelector('#settings-v1-plume-heading').scrollIntoView({block:'start'})")
                settle(ws)
                shot=command(ws,7,'Page.captureScreenshot',{'format':'png','fromSurface':True})
                (output/f'trace-appearance-{width}.png').write_bytes(base64.b64decode(shot['data']))
                key('Escape',27)
                click('#settings')
                assert js("[...document.querySelectorAll('#settings-menu [role=menuitem]')].map(e=>e.id).join('|')==='settings-menu-mixer|settings-menu-recording|settings-menu-basic|settings-menu-advanced'")
                click('#settings-menu-basic')
                assert js("document.querySelector('#settings-appearance').open&&!document.querySelector('.settings-connection')&&!document.querySelector('#echo-test-open')")
                settings_layout=capture(f'settings-{width}','#settings-dialog')
                info='#settings-basic-panel .audio-output-info'
                click(info)
                assert js("document.querySelector('#settings-basic-panel .audio-output-info').getAttribute('aria-expanded')==='true'&&getComputedStyle(document.querySelector('#settings-audio-output-help')).visibility==='visible'")
                js('new Promise(resolve=>setTimeout(resolve,180))')
                capture(f'help-{width}','#settings-dialog')
                key('Escape',27)
                assert js("document.querySelector('#settings-dialog').open&&getComputedStyle(document.querySelector('#settings-audio-output-help')).visibility==='hidden'")
                click('#settings-audio-output-standard')
                wait_for(ws,"state.audioOutputType==='standard'&&echoCancellationUI.enabled()")
                assert js('state.plumeSettings.timeAdvanceMs===270')
                key('Escape',27)
                assert js("document.activeElement.id==='settings'")
                confirmed=js('JSON.parse(localStorage.getItem(AUDIO_OUTPUT_STORAGE_KEY)).confirmedAt')
                go('/index.html?piece=ave-verum&part=P3')
                assert js("!document.querySelector('#audio-output-dialog').open&&state.audioOutputType==='standard'&&echoCancellationUI.enabled()")
                assert js('JSON.parse(localStorage.getItem(AUDIO_OUTPUT_STORAGE_KEY)).confirmedAt')==confirmed
                # Freeze the clock one millisecond before expiry, then cross
                # the real scheduled deadline without waiting for a day.
                js("""window.realDateNow=Date.now;
                  localStorage.setItem(AUDIO_OUTPUT_STORAGE_KEY,JSON.stringify({type:'standard',confirmedAt:realDateNow()-ChoirAudioOutput.TTL+250}));
                  restoreAudioOutputPreference();""")
                wait_for(ws,'state.audioOutputType===null')
                assert js("!document.querySelector('#audio-output-dialog').open&&!state.clock.running")
                click('#settings');click('#settings-menu-basic')
                assert js("!document.querySelector('#settings-basic-panel input[name=settings-audio-output]:checked')&&document.querySelector('#settings-audio-output-status').textContent==='Da scegliere'")
                key('Escape',27)
                js("loadPracticePiece('o-sacrum',{partId:'P3',updateHistory:true})")
                wait_for(ws,"document.querySelector('#audio-output-dialog').open&&state.bundleManifest.piece_id==='o-sacrum'")
                assert js('micCalls===0')
                choose('bluetooth')
                # A second piece within the window does not ask again.
                js("loadPracticePiece('ave-verum',{partId:'P3',updateHistory:true})")
                assert js("!document.querySelector('#audio-output-dialog').open&&state.audioOutputType==='bluetooth'")
                assert js("!document.querySelector('a[href*=relax],#settings-menu-profile,#settings-menu-repertoire')&&settingsErrors.length===0"),js('settingsErrors')
                reports.append({'viewport':[width,height],'entry':entry_layout,'settings':settings_layout,
                    'reloadAndPersistence':True,'dailyExpiry':True,'closes':True,'noMicrophoneBeforeChoice':True})
            # A browser that refuses writes must keep the confirmed choice in
            # memory, even when an older persisted choice still exists.
            js("""window.originalStorageWrite=Storage.prototype.setItem;
              Storage.prototype.setItem=function(key,...args){if(key===AUDIO_OUTPUT_STORAGE_KEY)throw Error('quota');return originalStorageWrite.call(this,key,...args)};
              applyAudioOutputChoice('standard');""")
            wait_for(ws,"state.audioOutputType==='standard'")
            assert js("restoreAudioOutputPreference()&&state.audioOutputType==='standard'")
            js("Storage.prototype.setItem=originalStorageWrite;audioOutputMemory=null")
            # The deleted surface must not be served by either source or build.
            assert js("fetch('/relax.html').then(r=>r.status===404)")
            (output/'report.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')
            print(json.dumps({'checks':reports,'artifacts':str(output)}))
        finally:
            if ws:ws.close()
            chrome.terminate();chrome.wait(timeout=10);server.shutdown()


if __name__=='__main__':main()
