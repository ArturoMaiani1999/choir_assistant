"""Home composition, keyboard disclosure, motion and navigation in real Chromium.

Uses the existing navigation fixture; never contacts Clerk or the deployed site.
"""
from __future__ import annotations

import base64
import html
import json
import re
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
    # Compare the shipped mission with the latest editorial text in the source.
    mission_source=(ROOT/'frontend/about.html').read_text(encoding='utf-8')
    mission_article=re.search(r'<article\b[^>]*>(.*?)</article>',mission_source,re.S).group(1)
    expected_mission=' '.join(html.unescape(re.sub(r'<[^>]+>','',mission_article)).split())
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
                let makingHomeScene=false;
                const createElement=document.createElement.bind(document);
                document.createElement=function(...args){
                    const e=createElement(...args);
                    if(makingHomeScene&&args[0]==='canvas')e.dataset.homeProbe='true';return e;
                };
                const isHomeCanvas=c=>c.id==='home-canvas'||c.id==='home-glow'||c.dataset.homeProbe==='true';
                const recordHomeColor=color=>{
                    if(/^#[0-9a-f]{6}$/i.test(color))color=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)).join(',');
                    else color=color.replace(/^rgba?\(([^)]*)\).*$/,'$1').split(',').slice(0,3).map(v=>v.trim()).join(',');
                    homeStrokeColors.add(color);
                };
                const homeGradients=new WeakSet();
                const gradient=CanvasRenderingContext2D.prototype.createLinearGradient;
                CanvasRenderingContext2D.prototype.createLinearGradient=function(...args){
                    const g=gradient.apply(this,args);
                    if(isHomeCanvas(this.canvas))homeGradients.add(g);
                    return g;
                };
                const addStop=CanvasGradient.prototype.addColorStop;
                CanvasGradient.prototype.addColorStop=function(offset,color){
                    if(homeGradients.has(this))recordHomeColor(color);
                    return addStop.call(this,offset,color);
                };
                // Capture the real Home instance without a production debug API.
                Object.defineProperty(window,'Lissajous',{configurable:true,set(api){
                    Object.defineProperty(window,'Lissajous',{value:Object.freeze({...api,create(...args){
                        makingHomeScene=Boolean(args[2]?.home);
                        const scene=api.create(...args);makingHomeScene=false;
                        if(args[2]?.home)window.homeScene=scene;return scene;
                    }}),configurable:true});
                }});
                const stroke=CanvasRenderingContext2D.prototype.stroke;
                CanvasRenderingContext2D.prototype.stroke=function(...args){
                    if(isHomeCanvas(this.canvas)&&typeof this.strokeStyle==='string'){
                        recordHomeColor(this.strokeStyle);
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
            def capture(name, duet=False):
                shot = command(socket,7,'Page.captureScreenshot',{'format':'png','fromSurface':True})
                directory=ROOT/'artifacts/home-duet' if duet else ARTIFACTS
                directory.mkdir(parents=True,exist_ok=True)
                (directory/f'{name}.png').write_bytes(base64.b64decode(shot['data']))
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
                    const about=document.querySelector('#home-about').getBoundingClientRect();
                    const controls=[...d.querySelectorAll('button,a,summary')].filter(e=>e.checkVisibility());
                    const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                    let lit=0,edge=0;
                    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
                        if(pixels[(y*c.width+x)*4+3]>0){lit++;if(x<2||y<2||x>=c.width-2||y>=c.height-2)edge++;}
                    }
                    return {viewport:[innerWidth,innerHeight],scroll:d.scrollHeight-d.clientHeight,
                        horizontal:d.scrollWidth>d.clientWidth||document.documentElement.scrollWidth>innerWidth,
                        footerOverlaps:about.left<actions.right&&about.right>actions.left&&about.top<actions.bottom&&about.bottom>actions.top,
                        separated:innerWidth>=900||(innerWidth>=700&&innerHeight<=500) ? curve.right+15<=actions.left : curve.bottom+15<=actions.top,
                        clipped:controls.filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight}).map(e=>e.id),
                        small:controls.filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44}).map(e=>e.id),
                        canvasRatio:c.width/curve.width,renderRatio:Number(c.dataset.renderRatio),lit,edge,buttonWidth:actions.width};
                })()""")
                assert not layout['horizontal'] and not layout['footerOverlaps'] and layout['separated'] and not layout['small'],layout
                assert layout['scroll']<=1 and not layout['clipped'],layout
                assert layout['canvasRatio']<=4.01 and layout['lit']>500 and layout['edge']==0,layout
                assert layout['renderRatio']>=(3.74 if width<600 else 1.99),layout
                assert layout['canvasRatio']>=(2.99 if width<600 else .99),layout
                still=frame();delay(120);assert frame()==still
                capture(f'home-{width}x{height}')
                click('#home-settings summary')
                assert js("document.querySelector('#home-settings summary').getAttribute('aria-expanded')==='true'")
                capture(f'account-{width}x{height}')
                assert js("(()=>{const p=document.querySelector('#home-account-menu').getBoundingClientRect();return p.left>=0&&p.right<=innerWidth&&p.top>=0&&p.bottom<=innerHeight})()")
                key('Escape',27)
                assert js("!document.querySelector('#home-settings').open&&document.activeElement.tagName==='SUMMARY'")
                # The same Canvas keeps its bounds across mobile entry steps.
                curve=js("document.querySelector('#home-canvas').getBoundingClientRect().toJSON()")
                js("window.stepPixels=document.querySelector('#home-canvas').toDataURL();void 0")
                assert js("[...document.querySelectorAll('#library-mode-step .studio-route-entry')].map(e=>e.textContent.trim()).join('|')==='Scegli brano|Mostra partiture|Esercizi vocali'")
                click('#library-sing')
                source_curve=js("document.querySelector('#home-canvas').getBoundingClientRect().toJSON()")
                assert all(abs(curve[k]-source_curve[k])<1 for k in ['x','y','width','height']),(width,curve,source_curve)
                assert js("document.querySelector('#home-canvas').toDataURL()===stepPixels"),width
                assert js("document.querySelector('#library-back').textContent==='Indietro'&&document.querySelector('.home-brand').hidden")
                capture(f'sources-{width}x{height}')
                click('#library-custom')
                catalog_curve=js("document.querySelector('#home-canvas').getBoundingClientRect().toJSON()")
                assert all(abs(curve[k]-catalog_curve[k])<1 for k in ['x','y','width','height']),(width,curve,catalog_curve)
                assert js("document.querySelector('#home-canvas').toDataURL()===stepPixels"),width
                capture(f'catalog-{width}x{height}')
                click('#library-back')
                assert js("document.querySelector('#piece-picker-dialog').dataset.step==='source'&&document.querySelector('#library-assigned').checkVisibility()&&document.querySelector('#library-custom').checkVisibility()")
                assert js("document.querySelector('#home-canvas').toDataURL()===stepPixels"),width
                click('#library-back')
                assert js("document.querySelector('#piece-picker-dialog').dataset.step==='mode'")
                click('#library-read');click('#library-back')
                assert js("document.querySelector('#piece-picker-dialog').dataset.step==='mode'")
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

            # Mission page: real menu entry, accessible wordmark, complete reading
            # and reduced motion. The letter X is drawn by the shared 3D scene.
            about_results=[]
            for width,height in [(1366,768),(390,844)]:
                command(socket,9,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':width<600})
                go('/index.html',"document.querySelector('#piece-picker-dialog')?.open")
                footer=js("""(()=>{const a=document.querySelector('#home-about').getBoundingClientRect(),
                    buttons=document.querySelector('#library-mode-step').getBoundingClientRect();
                    return {center:(a.left+a.right)/2,bottom:a.bottom,top:a.top,
                        overlaps:a.left<buttons.right&&a.right>buttons.left&&a.top<buttons.bottom&&a.bottom>buttons.top};})()""")
                assert abs(footer['center']-width/2)<1 and height-70<footer['bottom']<=height and not footer['overlaps'],footer
                key('Tab',9)
                js("document.querySelector('#home-about').focus()")
                assert js("document.activeElement.matches(':focus-visible')")
                key('Enter',13)
                wait_for(socket,"Boolean(document.querySelector('#about-canvas')?.dataset.time)")
                settle(socket)
                layout=js("""(()=>{const main=document.querySelector('.about-main').getBoundingClientRect(),
                    mark=document.querySelector('.about-wordmark'),button=document.querySelector('.menu-link').getBoundingClientRect(),
                    canvas=document.querySelector('#about-canvas'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
                    let lit=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])lit++;
                    return {width:innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth,
                        left:main.left,right:main.right,wordmark:mark.getAttribute('aria-label'),
                        heading:document.querySelector('h1').textContent,paragraphs:document.querySelectorAll('article p').length,
                        touch:button.width>=44&&button.height>=44,lit};})()""")
                assert not layout['horizontal'] and layout['left']>=0 and layout['right']<=width,layout
                assert layout['wordmark']=='Xynon' and layout['heading']=='Perché Xynon' and layout['touch'] and layout['lit']>100,layout
                assert js("document.querySelector('article').textContent.replace(/\\s+/g,' ').trim()") == expected_mission
                still=js("document.querySelector('#about-canvas').dataset.time")
                delay(180);assert js("document.querySelector('#about-canvas').dataset.time")==still
                capture(f'about-top-{width}x{height}')
                full_height=js('document.documentElement.scrollHeight')
                shot=command(socket,7,'Page.captureScreenshot',{'format':'png','captureBeyondViewport':True,
                    'clip':{'x':0,'y':0,'width':width,'height':full_height,'scale':1}})
                (ARTIFACTS/f'about-full-{width}x{height}.png').write_bytes(base64.b64decode(shot['data']))
                js("document.querySelector('.about-closing').scrollIntoView({block:'end'})")
                assert js("document.querySelector('.about-closing').getBoundingClientRect().bottom<=innerHeight+1")
                assert js('homeErrors.length===0&&micCalls===0'),js('homeErrors')
                click('.menu-link')
                wait_for(socket,"document.querySelector('#piece-picker-dialog')?.open")
                # Running wordmark suspends offscreen and resumes after BFCache.
                command(socket,8,'Emulation.setEmulatedMedia',{'features':[]})
                click('#home-about');wait_for(socket,"Boolean(document.querySelector('#about-canvas')?.dataset.time)")
                def about_frame():return js("document.querySelector('#about-canvas').dataset.time")
                before=about_frame();delay(180);assert about_frame()!=before
                js('scrollTo(0,document.documentElement.scrollHeight)')
                # A short editorial text may leave the mark visible even at
                # the end; move it offscreen to exercise the same observer.
                js("if(document.querySelector('#about-canvas').getBoundingClientRect().bottom>0)document.querySelector('.about-wordmark').style.transform='translateX(-5000px)'")
                delay(120);before=about_frame();delay(180)
                assert about_frame()==before,js("({scrollY,canvas:document.querySelector('#about-canvas').getBoundingClientRect().toJSON(),height:innerHeight,scrollHeight:document.documentElement.scrollHeight})")
                js("document.querySelector('.about-wordmark').style.transform='';scrollTo(0,0)");delay(180);assert about_frame()!=before
                js("dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))")
                before=about_frame();delay(180);assert about_frame()==before
                js("dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
                delay(180);assert about_frame()!=before
                command(socket,8,'Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
                delay(120)
                before=about_frame();delay(180);assert about_frame()==before
                assert js('homeErrors.length===0&&micCalls===0'),js('homeErrors')
                about_results.append(layout)

            # Running scene: pause, overlay suspension, hidden/offscreen suspension, resume.
            command(socket,8,'Emulation.setEmulatedMedia',{'features':[]})
            motion_results=[]
            for width,height in [(1366,768),(390,844)]:
                command(socket,9,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':width<600})
                go('/index.html',"document.querySelector('#piece-picker-dialog')?.open&&Boolean(document.querySelector('#home-canvas')?.dataset.time)")
                capture(f'animation-start-{width}')
                js("window.beforeCurvePixels=document.querySelector('#home-canvas').getContext('2d').getImageData(0,0,document.querySelector('#home-canvas').width,document.querySelector('#home-canvas').height).data;void 0")
                delay(1200)
                change=js("""(()=>{const c=document.querySelector('#home-canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                    let changed=0,lit=0;for(let i=0;i<p.length;i+=4){
                        if(p[i+3]>0||beforeCurvePixels[i+3]>0)lit++;
                        if(Math.abs(p[i]-beforeCurvePixels[i])+Math.abs(p[i+1]-beforeCurvePixels[i+1])+Math.abs(p[i+2]-beforeCurvePixels[i+2])+Math.abs(p[i+3]-beforeCurvePixels[i+3])>60)changed++;
                    }return {width:innerWidth,changed,lit,fraction:changed/Math.max(1,lit)};})()""")
                assert change['changed']>250 and change['fraction']>.1,change
                assert js("homeStrokeColors.size===2"),js("[...homeStrokeColors]")
                assert js("document.querySelector('#home-canvas').dataset.tailSeconds==='40'")
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

            # Seed only the existing mathematical clock; all state transitions,
            # drawing and the five-second hold still run on real browser RAF.
            command(socket,8,'Emulation.setEmulatedMedia',{'features':[]})
            duets=[]
            for width,height in [(1366,768),(390,844)]:
                command(socket,9,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':width<600})
                go('/index.html',"Boolean(window.homeScene?.state.active)")
                js("""window.homeYawSpeed=.0225*5/3*1.3;
                    window.duetTarget=(Math.PI-Math.atan(1/3)-(.67+20.8*(.0225-homeYawSpeed)))/homeYawSpeed;
                    homeScene.state.time=duetTarget-.3;
                    window.duetTransitions=[];window.duetHeldTimes=new Set();
                    window.duetPrevious='ROTATING';
                    requestAnimationFrame(function observe(timestamp){
                        const s=homeScene.state;
                        if(s.duet.phase!==duetPrevious){duetTransitions.push({phase:s.duet.phase,timestamp});duetPrevious=s.duet.phase;}
                        if(s.duet.phase==='DUET')duetHeldTimes.add(s.time);
                        if(duetTransitions.length<3)requestAnimationFrame(observe);
                    });""")
                wait_for(socket,"homeScene.state.duet.phase==='DUET'")
                capture(f'duet-enter-{width}',duet=True)
                delay(700);capture(f'duet-sing-{width}',duet=True)
                js("window.duetPixels=document.querySelector('#home-canvas').getContext('2d').getImageData(0,0,document.querySelector('#home-canvas').width,document.querySelector('#home-canvas').height).data;void 0")
                delay(1100);capture(f'duet-sway-{width}',duet=True)
                animated=js("""(()=>{const c=document.querySelector('#home-canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                    let changed=0;for(let i=0;i<p.length;i+=4)if(Math.abs(p[i+3]-duetPixels[i+3])>40)changed++;return changed;})()""")
                assert animated>100,animated
                assert js("homeScene.state.duet.count===1&&homeScene.state.time===duetTarget"),js("({duet:homeScene.state.duet,time:homeScene.state.time,target:duetTarget,transitions:duetTransitions})")
                wait_for(socket,"homeScene.state.duet.elapsedMs>4700")
                capture(f'duet-fade-{width}',duet=True)
                wait_for(socket,"homeScene.state.duet.phase==='RESUMING'")
                capture(f'duet-resume-{width}',duet=True)
                wait_for(socket,"duetTransitions.length===3")
                summary=js("""({width:innerWidth,transitions:duetTransitions,
                    holdMs:duetTransitions[1].timestamp-duetTransitions[0].timestamp,
                    heldTimes:duetHeldTimes.size,count:homeScene.state.duet.count,
                    colors:[...homeStrokeColors],time:homeScene.state.time,target:duetTarget})""")
                summary['animatedPixelsWhileHeld']=animated
                assert abs(summary['holdMs']-5000)<65,summary
                assert summary['heldTimes']==1 and summary['count']==1 and len(summary['colors'])==2,summary
                assert 0<summary['time']-summary['target']<.6,summary
                delay(150);assert js('homeScene.state.duet.count===1&&homeScene.state.time>duetTarget+.25')
                duets.append(summary)

            # Suspension also preserves expression/deformation time mid-duet.
            js('homeScene.state.time=duetTarget+Math.PI*2/homeYawSpeed-.3')
            wait_for(socket,"homeScene.state.duet.phase==='DUET'")
            delay(600)
            click('#home-settings summary');click('#home-pause')
            held=js('homeScene.state.duet.elapsedMs');delay(180)
            assert js('homeScene.state.duet.elapsedMs')==held
            click('#home-pause');key('Escape',27)
            js("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
            held=js('homeScene.state.duet.elapsedMs');delay(180)
            assert js('homeScene.state.duet.elapsedMs')==held
            js("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
            delay(120);assert js('homeScene.state.duet.elapsedMs')>held
            js("dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))")
            held=js('homeScene.state.duet.elapsedMs');delay(180)
            assert js('homeScene.state.duet.elapsedMs')==held
            js("dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
            delay(120);assert js('homeScene.state.duet.elapsedMs')>held
            command(socket,8,'Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
            delay(120)
            assert js("homeScene.state.paused&&homeScene.state.duet.phase==='ROTATING'")
            capture('duet-reduced-motion-390',duet=True)
            js('homeScene.setPaused(false)');delay(150)
            assert js("homeScene.state.duet.phase==='ROTATING'&&homeScene.state.duet.count===2")
            js('homeScene.destroy()');before=frame();delay(120);assert frame()==before
            assert js('homeErrors.length===0&&micCalls===0'),js('homeErrors')
            report={'viewports':results,'about':about_results,'keyboard':'passed','profileAndSettings':'passed','voiceLab':'passed',
                'motionAndVisibility':'passed','visibleMotion':motion_results,'twoColorPalette':'passed',
                'duets':duets,'duetLifecycle':'passed','errors':[],'microphoneCalls':0}
            (ARTIFACTS/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            print(json.dumps(report))
        finally:
            if socket: socket.close()
            process.terminate();process.wait(timeout=5);server.shutdown()


if __name__=='__main__': main()
