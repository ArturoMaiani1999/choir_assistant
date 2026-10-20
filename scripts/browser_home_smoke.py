"""Home composition, keyboard disclosure, motion and navigation in real Chromium.

Uses the existing navigation fixture; never contacts Clerk or the deployed site.
"""
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
from http.server import ThreadingHTTPServer
from pathlib import Path

import websocket
from browser_navigation_audit import Handler, ROOT, CHROME, command, evaluate, wait_for, settle
from browser_relax_smoke import RelaxHandler

ARTIFACTS = ROOT / 'artifacts/home-redesign'
VIEWPORTS = [(1440,900),(1920,1080),(1366,768),(1024,768),(900,700),
             (899,700),(768,1024),(390,844),(375,667),(320,568),(844,390)]


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    use_dist='--dist' in sys.argv
    directory=Path(sys.argv[sys.argv.index('--directory')+1]) if '--directory' in sys.argv else ROOT/'dist'
    server = ThreadingHTTPServer(('127.0.0.1',0), partial(RelaxHandler if use_dist else Handler,
        directory=str(directory if use_dist else ROOT/'frontend')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    results = []
    with tempfile.TemporaryDirectory(prefix='choir-home-') as profile:
        process = subprocess.Popen([str(CHROME),'--headless=new','--disable-gpu',
            '--remote-allow-origins=*','--remote-debugging-port=0',f'--user-data-dir={profile}',
            'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile)/'DevToolsActivePort'
            for _ in range(120):
                if port_file.exists(): break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            socket = websocket.create_connection(next(t for t in tabs if t['type']=='page')['webSocketDebuggerUrl'], timeout=30)
            command(socket,1,'Page.enable')
            command(socket,2,'Page.addScriptToEvaluateOnNewDocument',{'source':r"""
                window.homeErrors=[];window.micCalls=0;
                window.homeStrokeColors=new Set();
                const stroke=CanvasRenderingContext2D.prototype.stroke;
                CanvasRenderingContext2D.prototype.stroke=function(...args){
                    if(this.canvas.id==='home-canvas'||this.canvas.id==='home-glow'){
                        homeStrokeColors.add(this.strokeStyle.replace(/^rgba?\(([^)]*)\).*$/,'$1').split(',').slice(0,3).map(v=>v.trim()).join(','));
                    }
                    return stroke.apply(this,args);
                };
                const consoleError=console.error.bind(console);
                console.error=(...args)=>{homeErrors.push(args.map(String).join(' '));consoleError(...args)};
                addEventListener('error',e=>homeErrors.push(e.message));
                addEventListener('unhandledrejection',e=>homeErrors.push(String(e.reason)));
                const get=navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices);
                if(get)navigator.mediaDevices.getUserMedia=(...args)=>{micCalls++;return get(...args)};
            """})

            def js(expression): return evaluate(socket,3,expression)
            def delay(ms): js(f'new Promise(r=>setTimeout(r,{ms}))')
            def go(path, ready):
                command(socket,4,'Page.navigate',{'url':origin+path})
                wait_for(socket,ready);settle(socket)
            def click(selector):
                point = js(f"""(()=>{{const e=document.querySelector({json.dumps(selector)});
                    if(!e?.checkVisibility())throw Error('Hidden control: '+{json.dumps(selector)});
                    e.scrollIntoView({{block:'nearest'}});const r=e.getBoundingClientRect();
                    return {{x:r.left+r.width/2,y:r.top+r.height/2}}}})()""")
                for kind in ['mousePressed','mouseReleased']:
                    command(socket,5,'Input.dispatchMouseEvent',dict(point,type=kind,button='left',clickCount=1))
                settle(socket)
            def key(name,virtual=0,shift=False):
                for kind in ['keyDown','keyUp']:
                    params={'type':kind,'key':name,'code':name,'windowsVirtualKeyCode':virtual,'modifiers':8 if shift else 0}
                    if name=='Enter' and kind=='keyDown': params.update(text='\r',unmodifiedText='\r')
                    command(socket,6,'Input.dispatchKeyEvent',params)
                settle(socket)
            def capture(name):
                shot = command(socket,7,'Page.captureScreenshot',{'format':'png','fromSurface':True})
                (ARTIFACTS/f'{name}.png').write_bytes(base64.b64decode(shot['data']))
            def frame(): return js("document.querySelector('#home-canvas').dataset.time")

            # Freeze the populated trail for comparable viewport captures.
            command(socket,8,'Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
            for width,height in VIEWPORTS:
                command(socket,9,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,
                    'deviceScaleFactor':3 if width<600 else 1,'mobile':width<600})
                go('/index.html',"document.querySelector('#piece-picker-dialog')?.open&&Boolean(document.querySelector('#home-canvas')?.dataset.time)")
                layout = js("""(()=>{
                    const d=document.querySelector('#piece-picker-dialog'),c=document.querySelector('#home-canvas');
                    const curve=c.getBoundingClientRect(),actions=document.querySelector('#library-mode-step').getBoundingClientRect();
                    const controls=[...d.querySelectorAll('button,a,summary')].filter(e=>e.checkVisibility());
                    const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                    let lit=0,edge=0;
                    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
                        if(pixels[(y*c.width+x)*4+3]>0){lit++;if(x<2||y<2||x>=c.width-2||y>=c.height-2)edge++;}
                    }
                    return {viewport:[innerWidth,innerHeight],scroll:d.scrollHeight-d.clientHeight,
                        horizontal:d.scrollWidth>d.clientWidth||document.documentElement.scrollWidth>innerWidth,
                        separated:innerWidth>=900||(innerWidth>=700&&innerHeight<=500) ? curve.right+15<=actions.left : curve.bottom+15<=actions.top,
                        clipped:controls.filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight}).map(e=>e.id),
                        small:controls.filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44}).map(e=>e.id),
                        canvasRatio:c.width/curve.width,lit,edge,buttonWidth:actions.width};
                })()""")
                assert not layout['horizontal'] and layout['separated'] and not layout['small'],layout
                assert layout['scroll']<=1 and not layout['clipped'],layout
                assert layout['canvasRatio']<=2.01 and layout['lit']>500 and layout['edge']==0,layout
                still=frame();delay(120);assert frame()==still
                capture(f'home-{width}x{height}')
                click('#home-settings summary')
                assert js("document.querySelector('#home-settings summary').getAttribute('aria-expanded')==='true'")
                capture(f'account-{width}x{height}')
                assert js("(()=>{const p=document.querySelector('#home-account-menu').getBoundingClientRect();return p.left>=0&&p.right<=innerWidth&&p.top>=0&&p.bottom<=innerHeight})()")
                key('Escape',27)
                assert js("!document.querySelector('#home-settings').open&&document.activeElement.tagName==='SUMMARY'")
                assert js('homeErrors.length===0&&micCalls===0'),js('homeErrors')
                results.append(layout)

            command(socket,9,'Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
            go('/index.html',"document.querySelector('#piece-picker-dialog')?.open")
            # Native Tab order plus optional arrow navigation; Escape restores the trigger.
            js("document.querySelector('#home-settings summary').focus()")
            key('ArrowUp',38);assert js("document.activeElement.id==='home-sign-out'")
            key('Escape',27)
            key('ArrowDown',40);assert js("document.activeElement.id==='library-profile'")
            key('End',35);assert js("document.activeElement.id==='home-sign-out'")
            key('Home',36);assert js("document.activeElement.id==='library-profile'")
            key('Tab',9,shift=True);assert js("document.activeElement.tagName==='SUMMARY'")
            key('Tab',9);assert js("document.activeElement.id==='library-profile'")
            key('Enter',13)
            assert js("document.querySelector('#member-profile-dialog').open")
            key('Escape',27)
            assert js("!document.querySelector('#member-profile-dialog').open&&document.activeElement.tagName==='SUMMARY'")
            click('#home-settings summary');click('#home-advanced')
            assert js("document.querySelector('#settings-dialog').open")
            key('Escape',27)
            assert js("!document.querySelector('#settings-dialog').open&&document.activeElement.tagName==='SUMMARY'")
            click('#home-settings summary');click('.home-brand')
            assert js("!document.querySelector('#home-settings').open")
            click('#home-settings summary');key('End',35);key('Tab',9)
            assert js("!document.querySelector('#home-settings').open&&document.activeElement.id==='library-sing'")
            click('#library-voice-lab')
            wait_for(socket,"document.body.dataset.screen==='choose'")

            # Running scene: pause, overlay suspension, hidden/offscreen suspension, resume.
            command(socket,8,'Emulation.setEmulatedMedia',{'features':[]})
            motion_results=[]
            for width,height in [(1366,768),(390,844)]:
                command(socket,9,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':width<600})
                go('/index.html',"document.querySelector('#piece-picker-dialog')?.open&&Boolean(document.querySelector('#home-canvas')?.dataset.time)")
                capture(f'animation-start-{width}')
                js("window.beforeCurvePixels=document.querySelector('#home-canvas').getContext('2d').getImageData(0,0,document.querySelector('#home-canvas').width,document.querySelector('#home-canvas').height).data")
                delay(1200)
                change=js("""(()=>{const c=document.querySelector('#home-canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                    let changed=0,lit=0;for(let i=0;i<p.length;i+=4){
                        if(p[i+3]>0||beforeCurvePixels[i+3]>0)lit++;
                        if(Math.abs(p[i]-beforeCurvePixels[i])+Math.abs(p[i+1]-beforeCurvePixels[i+1])+Math.abs(p[i+2]-beforeCurvePixels[i+2])+Math.abs(p[i+3]-beforeCurvePixels[i+3])>60)changed++;
                    }return {width:innerWidth,changed,lit,fraction:changed/Math.max(1,lit)};})()""")
                assert change['changed']>250 and change['fraction']>.1,change
                assert js("homeStrokeColors.size===2"),js("[...homeStrokeColors]")
                assert js("document.querySelector('#home-canvas').dataset.tailSeconds==='20'")
                capture(f'animation-after-{width}')
                motion_results.append(change)
            go('/index.html',"document.querySelector('#piece-picker-dialog')?.open")
            before=frame();delay(180);assert frame()!=before
            click('#home-settings summary');click('#home-pause')
            before=frame();delay(180);assert frame()==before
            click('#home-pause');delay(120);assert frame()!=before
            click('#library-profile');before=frame();delay(180);assert frame()==before
            key('Escape',27);delay(120);assert frame()!=before
            js("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
            before=frame();delay(180);assert frame()==before
            js("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
            delay(120);assert frame()!=before
            js("document.querySelector('.home-scene').style.transform='translateX(-5000px)'")
            delay(150);before=frame();delay(180);assert frame()==before
            js("document.querySelector('.home-scene').style.transform=''")
            delay(150);assert frame()!=before
            command(socket,8,'Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
            delay(120);before=frame();delay(180);assert frame()==before
            assert js("document.querySelector('#home-pause').getAttribute('aria-pressed')==='true'")
            assert js('homeErrors.length===0&&micCalls===0'),js('homeErrors')
            report={'viewports':results,'keyboard':'passed','profileAndSettings':'passed','voiceLab':'passed',
                'motionAndVisibility':'passed','visibleMotion':motion_results,'twoColorPalette':'passed','errors':[],'microphoneCalls':0}
            (ARTIFACTS/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            print(json.dumps(report))
        finally:
            if socket: socket.close()
            process.terminate();process.wait(timeout=5);server.shutdown()


if __name__=='__main__': main()
