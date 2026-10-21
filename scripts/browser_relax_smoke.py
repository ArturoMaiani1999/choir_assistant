"""Real browser checks for the Relax scene, reduced motion and rehearsal returns."""
from __future__ import annotations

import base64
import json
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import websocket
from browser_navigation_audit import Handler, ROOT, CHROME, command, evaluate, wait_for, settle

ARTIFACTS = ROOT/'artifacts/relax-mode'
USE_DIST = '--dist' in sys.argv
RELEASE = Path(sys.argv[sys.argv.index('--directory')+1]) if '--directory' in sys.argv else ROOT/'dist'


class RelaxHandler(Handler):
    def translate_path(self, path):
        if USE_DIST:return SimpleHTTPRequestHandler.translate_path(self,path)
        return super().translate_path(path)

    def do_GET(self):
        if USE_DIST and Path(urlsplit(self.path).path).name.startswith('session-client.'):
            return self.send_body(b'window.ChoirAuthReady=Promise.resolve();window.ChoirAuthFetch=window.fetch.bind(window);','text/javascript')
        return super().do_GET()


def main():
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(RelaxHandler,directory=str(RELEASE if USE_DIST else ROOT/'frontend')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    results=[]
    with tempfile.TemporaryDirectory(prefix='choir-relax-') as profile:
        process=subprocess.Popen([str(CHROME),'--headless=new','--disable-gpu','--remote-allow-origins=*',
            '--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        socket=None
        try:
            port_file=Path(profile)/'DevToolsActivePort'
            for _ in range(120):
                if port_file.exists():break
                time.sleep(.05)
            port=port_file.read_text().splitlines()[0]
            tabs=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            socket=websocket.create_connection(next(t for t in tabs if t['type']=='page')['webSocketDebuggerUrl'],timeout=30)
            command(socket,1,'Page.enable')
            command(socket,2,'Page.addScriptToEvaluateOnNewDocument',{'source':"""
              window.relaxErrors=[];window.micCalls=0;
              addEventListener('error',e=>relaxErrors.push(e.message));
              addEventListener('unhandledrejection',e=>relaxErrors.push(String(e.reason)));
              const get=navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices);
              if(get)navigator.mediaDevices.getUserMedia=(...args)=>{micCalls++;return get(...args)};
            """})

            def js(expression):return evaluate(socket,3,expression)
            def delay(ms):js(f'new Promise(resolve=>setTimeout(resolve,{ms}))')
            def go(path,ready):
                command(socket,4,'Page.navigate',{'url':origin+path})
                try:wait_for(socket,ready)
                except Exception:
                    print(js("JSON.stringify({url:location.href,errors:window.relaxErrors,menu:document.querySelector('#piece-picker-dialog')?.outerHTML.slice(0,350),seen:localStorage.getItem('choir-home-intro-seen:v1')})"))
                    raise
                settle(socket)
            def mouse(kind,x,y,**extra):command(socket,5,'Input.dispatchMouseEvent',dict(type=kind,x=x,y=y,**extra))
            def click(selector):
                point=js(f"""(()=>{{const r=document.querySelector({json.dumps(selector)}).getBoundingClientRect();return {{x:r.left+r.width/2,y:r.top+r.height/2}}}})()""")
                mouse('mousePressed',**point,button='left',clickCount=1)
                mouse('mouseReleased',**point,button='left',clickCount=1);settle(socket)
            def key(name,code=None,virtual=0):
                for kind in ['keyDown','keyUp']:
                    command(socket,6,'Input.dispatchKeyEvent',{'type':kind,'key':name,'code':code or name,'windowsVirtualKeyCode':virtual})
                settle(socket)
            def capture(name):
                shot=command(socket,7,'Page.captureScreenshot',{'format':'png','fromSurface':True})
                (ARTIFACTS/f'{name}.png').write_bytes(base64.b64decode(shot['data']))
            def frame_time():return float(js("document.querySelector('#relax-canvas').dataset.time"))
            def pixels():return js("""(()=>{const c=document.querySelector('#relax-canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
              let lit=0,hash=0;for(let i=0;i<p.length;i+=16){if(p[i]+p[i+1]+p[i+2]>10)lit++;hash=(hash+p[i]*3+p[i+1]*5+p[i+2]*7)%1000000007;}return {lit,hash}})()""")

            for width,height in [(1366,768),(390,844)]:
                command(socket,8,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':width<600})
                go('/index.html',"document.querySelector('#piece-picker-dialog')?.open")
                js('localStorage.clear()')
                go('/index.html',"document.querySelector('#piece-picker-dialog')?.open&&document.querySelector('#piece-picker-dialog').dataset.intro==='skip'")
                # First entry exposes navigation immediately and draws complete harmonics.
                assert js("getComputedStyle(document.querySelector('.home-utilities')).visibility==='visible'")
                assert js("Number(document.querySelector('#home-canvas').dataset.time)>=20.8")
                assert js("getComputedStyle(document.querySelector('.studio-library-form')).visibility==='visible'")
                assert js("document.querySelector('#home-canvas').dataset.speed==='0.25'")
                capture(f'home-{width}')
                click('#home-settings summary');click('#home-pause')
                paused_home=js("document.querySelector('#home-canvas').dataset.time")
                delay(150);assert js("document.querySelector('#home-canvas').dataset.time")==paused_home
                key('Escape',virtual=27)
                assert js("!document.querySelector('#home-settings').open&&document.activeElement.tagName==='SUMMARY'")
                click('#home-settings summary');click('#home-basic')
                assert js("document.querySelector('#settings-dialog').open")
                key('Escape',virtual=27)
                assert not js("document.querySelector('#settings-dialog').open")
                assert js("document.activeElement===document.querySelector('#home-settings summary')")
                click('#library-sing');click('#library-back')
                assert js("document.querySelector('#piece-picker-dialog').dataset.intro!=='waiting'")
                go('/index.html',"document.querySelector('#piece-picker-dialog')?.open&&document.querySelector('#piece-picker-dialog').dataset.intro==='skip'")
                assert js("getComputedStyle(document.querySelector('.studio-library-form')).visibility==='visible'")
                delay(800)
                capture(f'home-return-{width}')
                home_layout=js("""(()=>{const d=document.querySelector('#piece-picker-dialog');return {
                  scroll:d.scrollHeight-d.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth,
                  clipped:[...d.querySelectorAll('button,a,summary')].filter(e=>e.checkVisibility()).filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight||r.width<44||r.height<44}).map(e=>e.id)}})()""")
                assert home_layout['scroll']<=1 and not home_layout['overflow'] and not home_layout['clipped'],home_layout
                assert js('relaxErrors.length===0&&micCalls===0'),js('relaxErrors')
                go('/relax.html',"Boolean(document.querySelector('#relax-canvas')?.dataset.time)")
                delay(1800)
                layout=js("""(()=>{const c=document.querySelector('#relax-canvas'),r=c.getBoundingClientRect();return {
                  width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,
                  black:getComputedStyle(document.body).backgroundColor,tail:Number(c.dataset.tailSeconds),age:Number(c.dataset.time)-Number(c.dataset.oldestTime),
                  small:[...document.querySelectorAll('button,a,summary')].filter(e=>e.checkVisibility()).filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44}).map(e=>e.id),
                  clipped:[...document.querySelectorAll('button,a,summary')].filter(e=>e.checkVisibility()).filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight}).map(e=>e.id)}})()""")
                assert not layout['overflow'] and not layout['small'] and not layout['clipped'],layout
                assert layout['black']=='rgb(0, 0, 0)' and abs(layout['age']-40)<.003 and layout['tail']==40,layout
                assert pixels()['lit']>1000,pixels()
                capture(f'relax-{width}')
                before=frame_time();delay(300);assert frame_time()>before
                click('#relax-pause');paused=frame_time();delay(300);assert frame_time()==paused
                before_pixels=pixels()
                mouse('mousePressed',width*.5,height*.4,button='left',clickCount=1)
                mouse('mouseMoved',width*.5+60,height*.4+25,buttons=1,button='left')
                mouse('mouseReleased',width*.5+60,height*.4+25,button='left',clickCount=1)
                assert pixels()['hash']!=before_pixels['hash'] and frame_time()==paused
                js("document.querySelector('#relax-canvas').focus()")
                before_pixels=pixels();key('ArrowRight',virtual=39)
                assert pixels()['hash']!=before_pixels['hash'] and frame_time()==paused
                click('#relax-details summary');assert js("document.querySelector('#relax-details').open")
                key('Escape',virtual=27);assert not js("document.querySelector('#relax-details').open")
                assert js("document.activeElement.tagName==='SUMMARY'")
                js('document.activeElement.blur()');key(' ','Space',32)
                assert js("document.body.dataset.paused==='false'")
                if js("!document.querySelector('#relax-fullscreen').hidden"):
                    click('#relax-fullscreen');delay(100)
                    assert js('Boolean(document.fullscreenElement)')
                    click('#relax-fullscreen');assert not js('Boolean(document.fullscreenElement)')
                assert js('relaxErrors.length===0&&micCalls===0'),js('relaxErrors')
                results.append(layout)

            # The motion preference starts with a complete, still drawing.
            command(socket,9,'Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
            js('localStorage.clear()')
            go('/index.html',"document.querySelector('#piece-picker-dialog')?.open&&document.querySelector('#piece-picker-dialog').dataset.intro==='skip'")
            still_home=js("document.querySelector('#home-canvas').dataset.time")
            delay(200);assert js("document.querySelector('#home-canvas').dataset.time")==still_home
            capture('home-reduced-motion-390')
            go('/relax.html?return=https://example.invalid/',"Boolean(document.querySelector('#relax-canvas')?.dataset.time)")
            assert js("document.body.dataset.paused==='true'&&document.querySelector('#relax-back').getAttribute('href')==='/index.html'")
            before=frame_time();delay(300);assert frame_time()==before
            assert pixels()['lit']>1000
            capture('reduced-motion-390')
            click('#relax-pause');delay(150);assert frame_time()>before
            command(socket,10,'Emulation.setEmulatedMedia',{'features':[]})

            # Enter through actual Settings and return to exactly the same paused beat.
            go('/index.html?piece=ave-verum&part=P3&resume=16&entry=16',"typeof state!=='undefined'&&Boolean(state.runtime)&&document.body.dataset.view==='practice'")
            # The provisional score cursor updates before the MP3 seek finishes.
            wait_for(socket,"Math.abs(state.clock.snapshot().beat-16)<.02&&!document.querySelector('#backing-audio').seeking")
            beat=js('playbackSnapshot().beat')
            click('#settings');click('#settings-menu-relax')
            wait_for(socket,"Boolean(document.querySelector('#relax-canvas')?.dataset.time)")
            click('#relax-back')
            wait_for(socket,"typeof state!=='undefined'&&Boolean(state.runtime)&&document.body.dataset.view==='practice'")
            try:wait_for(socket,f"Math.abs(playbackSnapshot().beat-{beat})<.02")
            except Exception:
                print(js('JSON.stringify({url:location.href,beat:playbackSnapshot().beat,errors:relaxErrors})'))
                raise
            assert js('!state.clock.running&&micCalls===0')
            js('window.relaxReloadMarker=true')
            command(socket,11,'Page.reload')
            wait_for(socket,"!window.relaxReloadMarker&&typeof state!=='undefined'&&Boolean(state.runtime&&state.clock)&&document.body.dataset.view==='practice'")
            try:wait_for(socket,f"Math.abs(playbackSnapshot().beat-{beat})<.02")
            except Exception:
                print(js('JSON.stringify({url:location.href,beat:playbackSnapshot().beat,pending:state.pendingAudioTime,ready:document.querySelector("#backing-audio").readyState,seeking:document.querySelector("#backing-audio").seeking,errors:relaxErrors})'))
                raise
            assert js('!state.clock.running&&micCalls===0')
            go('/voice-lab.html',"document.body.dataset.screen==='choose'")
            click('#lab-settings');capture('voice-settings-390')
            click('#lab-relax');wait_for(socket,"Boolean(document.querySelector('#relax-canvas')?.dataset.time)")
            click('#relax-back');wait_for(socket,"document.body.dataset.screen==='choose'")
            assert js('micCalls===0&&relaxErrors.length===0')
            print(json.dumps({'viewports':results,'reducedMotion':'passed','pauseAndDrag':'passed','returnBeat':beat,'voiceSettings':'passed','artifacts':str(ARTIFACTS)}))
        finally:
            if socket:socket.close()
            process.terminate();process.wait(timeout=5);server.shutdown()


if __name__=='__main__':main()
