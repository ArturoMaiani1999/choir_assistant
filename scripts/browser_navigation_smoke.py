"""Exercise the navigation tree, preserved practice context and logout locally."""
from __future__ import annotations

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
from urllib.parse import urlsplit

import websocket
from browser_navigation_audit import Handler, ME, ROOT, CHROME, command, evaluate, wait_for, settle

ARTIFACTS = ROOT / 'artifacts' / 'navigation-fixes'


class NavigationHandler(Handler):
    fail_assignments_once = False

    def translate_path(self, path):
        pathname = urlsplit(path).path
        if pathname in ['/sign-out', '/sign-in', '/sign-up']:
            return str(ROOT / 'frontend' / (pathname.lstrip('/') + '.html'))
        return super().translate_path(path)

    def do_GET(self):
        pathname = urlsplit(self.path).path
        if pathname == '/api/progress/assignments' and type(self).fail_assignments_once:
            type(self).fail_assignments_once = False
            self.send_error(503, 'Fixture temporary failure')
            return
        if pathname == '/auth-client.js':
            return self.send_body((ARTIFACTS / 'auth-client.fixture.js').read_bytes(), 'text/javascript')
        if pathname == '/auth/config':
            return self.send_body({'publishableKey':'pk_test_fixture'})
        return super().do_GET()


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    subprocess.run(['node', str(ROOT/'node_modules/esbuild/bin/esbuild'), 'frontend/auth-client.ts', '--bundle',
                    '--platform=browser', '--target=es2022', '--alias:@clerk/clerk-js=./scripts/fixtures/clerk_navigation.ts',
                    '--alias:@clerk/localizations=./scripts/fixtures/clerk_navigation.ts', '--alias:@clerk/ui/entry=./scripts/fixtures/clerk_navigation.ts',
                    f'--outfile={ARTIFACTS / "auth-client.fixture.js"}'], cwd=ROOT, check=True, capture_output=True)
    server = ThreadingHTTPServer(('127.0.0.1',0), partial(NavigationHandler, directory=str(ROOT/'frontend')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
    results=[]
    with tempfile.TemporaryDirectory(prefix='choir-navigation-') as profile:
        process=subprocess.Popen([str(CHROME),'--headless=new','--disable-gpu','--remote-allow-origins=*',
            '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
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
              window.__micStreams=[];window.__micCalls=0;
              const get=navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices);
              if(get)navigator.mediaDevices.getUserMedia=async(...args)=>{window.__micCalls++;const stream=await get(...args);window.__micStreams.push(stream);return stream};
            """})

            def go(path,ready):
                command(socket,3,'Page.navigate',{'url':base+path});wait_for(socket,ready);settle(socket)
                wait_for(socket,"document.querySelector('#piece-picker-dialog')?.dataset.intro!=='waiting'")

            def click(selector):
                point=evaluate(socket,4,f"""(()=>{{const e=document.querySelector({json.dumps(selector)});
                  if(!e?.checkVisibility())throw Error('Control hidden: '+{json.dumps(selector)});
                  e.scrollIntoView({{block:'nearest'}});const b=e.getBoundingClientRect();return {{x:b.left+b.width/2,y:b.top+b.height/2}}}})()""")
                for kind in ['mousePressed','mouseReleased']:
                    command(socket,5,'Input.dispatchMouseEvent',dict(point,type=kind,button='left',clickCount=1))
                settle(socket)

            def capture(name, selector=None):
                settle(socket)
                if selector:
                    layout=evaluate(socket,6,f"""(()=>{{const e=document.querySelector({json.dumps(selector)}),b=e.getBoundingClientRect();
                      return {{top:b.top,bottom:b.bottom,left:b.left,right:b.right,scroll:e.scrollHeight-e.clientHeight,width:innerWidth,height:innerHeight}}}})()""")
                    assert 0<=layout['left']<layout['right']<=layout['width'],(name,layout)
                    assert 0<=layout['top']<layout['bottom']<=layout['height'],(name,layout)
                    if selector=='#piece-picker-dialog':assert layout['scroll']<=1,(name,layout)
                shot=command(socket,7,'Page.captureScreenshot',{'format':'png','fromSurface':True})
                (ARTIFACTS/f'{name}.png').write_bytes(base64.b64decode(shot['data']))

            def practice_ready():
                wait_for(socket,"typeof state!=='undefined'&&Boolean(state.runtime)&&document.body.dataset.view==='practice'&&!document.querySelector('#piece-picker-dialog').open")

            for width,height in [(1366,768),(390,844)]:
                command(socket,8,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':width==390})
                ME['preferredVoicePart']=None
                go('/index.html',"document.querySelector('#piece-picker-dialog')?.open")
                evaluate(socket,9,"localStorage.clear();sessionStorage.clear()")
                go('/index.html',"document.querySelector('#piece-picker-dialog')?.open&&document.querySelector('#library-part').options.length>0")
                assert evaluate(socket,10,"getComputedStyle(document.querySelector('#practice-shell')).visibility==='hidden'")
                capture(f'home-{width}','#piece-picker-dialog')
                click('#library-read');click('#library-score')
                wait_for(socket,"document.querySelector('#viewer-pages')?.getAttribute('aria-busy')==='false'")
                assert evaluate(socket,101,"document.querySelector('#viewer-back').textContent==='Menù'")
                click('#viewer-back');wait_for(socket,"document.querySelector('#piece-picker-dialog')?.open")
                click('#library-sing');capture(f'sources-{width}','#piece-picker-dialog')
                click('#library-custom');capture(f'catalog-{width}','#piece-picker-dialog')
                evaluate(socket,11,"document.querySelector('#library-piece').value='ave-verum';document.querySelector('#library-piece').dispatchEvent(new Event('change'))")
                click('#library-open')
                wait_for(socket,"document.querySelector('#piece-picker-dialog').dataset.step==='part'")
                capture(f'first-part-{width}','#piece-picker-dialog')
                click('[data-preferred-voice=tenore]');practice_ready()
                assert ME['preferredVoicePart']=='tenore'
                assert evaluate(socket,12,"state.runtime.selectedPartId==='P3'&&document.querySelector('#mobile-toolbar-toggle').getAttribute('aria-expanded')==='true'")
                capture(f'practice-{width}','#show-feedback')
                click('#piece-picker')
                assert evaluate(socket,13,"document.body.dataset.view==='home'&&getComputedStyle(document.querySelector('#practice-shell')).visibility==='hidden'")
                capture(f'return-home-{width}','#piece-picker-dialog')
                click('#library-sing');click('#library-custom');click('#library-open');practice_ready()
                assert evaluate(socket,14,"state.runtime.selectedPartId==='P3'")

                # Profile is first and contains both the saved SATB and logout.
                click('#settings')
                assert evaluate(socket,15,"document.querySelector('#settings-menu [role=menuitem]').id==='settings-menu-profile'")
                click('#settings-menu-profile');capture(f'profile-{width}','#member-profile-dialog')
                assert evaluate(socket,16,"document.querySelector('#member-profile-voice').value==='tenore'")
                click('#member-profile-cancel')
                assert evaluate(socket,160,"document.activeElement.id==='settings'")
                click('#settings');click('#settings-menu-profile')
                command(socket,1601,'Input.dispatchKeyEvent',{'type':'keyDown','key':'Escape','code':'Escape','windowsVirtualKeyCode':27})
                settle(socket)
                assert evaluate(socket,1602,"!document.querySelector('#member-profile-dialog').open&&document.activeElement.id==='settings'")
                click('#settings');click('#settings-menu-profile')
                for kind in ['mousePressed','mouseReleased']:
                    command(socket,1603,'Input.dispatchMouseEvent',{'type':kind,'x':1,'y':1,'button':'left','clickCount':1})
                settle(socket)
                assert evaluate(socket,1604,"!document.querySelector('#member-profile-dialog').open&&document.activeElement.id==='settings'")

                # First assigned piece asks once, and that choice wins over the old section link.
                ME['preferredVoicePart']=None
                evaluate(socket,161,"localStorage.clear()")
                go('/index.html?piece=ave-verum&part=P3&from=repertorio',"document.querySelector('#piece-picker-dialog')?.dataset.step==='part'&&document.querySelector('#library-part').options.length>0")
                click('[data-preferred-voice=basso]');practice_ready()
                assert evaluate(socket,162,"state.runtime.selectedPartId==='P4'")
                click('#settings');click('#settings-menu-profile')
                evaluate(socket,163,"document.querySelector('#member-profile-voice').value='tenore'")
                click('#member-profile-save');wait_for(socket,"!document.querySelector('#member-profile-dialog').open")
                assert ME['preferredVoicePart']=='tenore'
                evaluate(socket,164,"localStorage.clear()")
                go('/index.html?piece=ave-verum',"typeof state!=='undefined'&&Boolean(state.runtime)&&document.body.dataset.view==='practice'")
                practice_ready()
                assert evaluate(socket,165,"state.runtime.selectedPartId==='P3'")

                # One-click return to the assignments, including from a collapsed toolbar.
                NavigationHandler.fail_assignments_once = True
                go('/repertorio.html',"document.querySelector('#repertoire-retry')?.checkVisibility()")
                click('#repertoire-retry');wait_for(socket,"!document.querySelector('#repertoire-content')?.hidden")
                click('.open-piece');practice_ready()
                if width==390:
                    click('#mobile-toolbar-toggle');click('#practice-return')
                else:click('#exit-practice')
                wait_for(socket,"Boolean(document.querySelector('#repertoire-content'))")
                click('.open-piece');practice_ready()

                for _ in range(4):click('#next-measure')
                before=evaluate(socket,17,'playbackSnapshot().beat')
                click('#score-viewer-link')
                wait_for(socket,"document.querySelector('#viewer-pages')?.getAttribute('aria-busy')==='false'")
                click('#viewer-mixer-open')
                assert evaluate(socket,18,"document.querySelector('#viewer-mixer').open")
                bounds=evaluate(socket,19,"document.querySelector('#viewer-mixer').getBoundingClientRect().toJSON()")
                for kind in ['mousePressed','mouseReleased']:
                    command(socket,20,'Input.dispatchMouseEvent',{'type':kind,'x':max(1,bounds['left']-5),'y':max(1,bounds['top']-5),'button':'left','clickCount':1})
                assert evaluate(socket,21,"!document.querySelector('#viewer-mixer').open&&document.activeElement.id==='viewer-mixer-open'")
                capture(f'viewer-{width}')
                click('#viewer-back');practice_ready()
                wait_for(socket,f'Math.abs(playbackSnapshot().beat-{before})<.01')
                assert evaluate(socket,22,"state.runtime.selectedPartId==='P3'&&!state.clock.running&&window.__micCalls===0")
                capture(f'viewer-return-{width}')

                # Real mobile entry, keyboard isolation and direct practice of another best.
                click('#show-feedback');wait_for(socket,"document.querySelectorAll('.performance-open').length===2")
                click('.performance-card:nth-child(2) .performance-open')
                wait_for(socket,"!document.querySelector('#performance-review').hidden")
                assert evaluate(socket,23,"document.querySelector('#performance-review-title').textContent==='O sacrum convivium'&&document.querySelector('#performance-review').contains(document.activeElement)&&document.querySelector('#practice-shell').inert")
                command(socket,24,'Input.dispatchKeyEvent',{'type':'keyDown','key':'Tab','code':'Tab','windowsVirtualKeyCode':9})
                assert evaluate(socket,25,"document.querySelector('#performance-review').contains(document.activeElement)")
                capture(f'analysis-{width}','#performance-review-practice')
                click('#performance-review-practice');practice_ready()
                assert evaluate(socket,26,"state.bundleManifest.piece_id==='o-sacrum'&&!state.clock.running&&!document.querySelector('#practice-shell').inert&&window.__micCalls===0")
                capture(f'analysis-practice-{width}')

                # A fresh catalog choice changes the return destination back to the main menu.
                click('#piece-picker');click('#library-sing');click('#library-custom');click('#library-open');practice_ready()
                assert evaluate(socket,261,"document.querySelector('#exit-practice').textContent==='Menù'&&!new URLSearchParams(location.search).has('from')")

                click('#settings');click('#settings-menu-profile');click('#settings-menu-account')
                wait_for(socket,"document.body.dataset.authMode==='sign-out'&&!document.querySelector('#signed-in-actions').hidden")
                capture(f'logout-{width}')
                assert evaluate(socket,27,"document.querySelector('#signed-in-actions a').textContent==='Annulla'&&!document.body.textContent.includes('Primo accesso')&&!document.body.textContent.includes('Accedi a')")
                click('#signed-in-actions a');practice_ready()
                click('#settings');click('#settings-menu-profile');click('#settings-menu-account')
                wait_for(socket,"document.body.dataset.authMode==='sign-out'&&!document.querySelector('#signed-in-actions').hidden")
                click('#signed-in-actions button')
                assert evaluate(socket,28,"window.__authRedirect.startsWith('/sign-in?return_url=')")
                go('/sign-in.html',"document.querySelector('#clerk-sign-in')?.dataset.ready==='true'")
                assert evaluate(socket,29,"document.querySelector('h1').textContent==='Accedi a Epistrophe'")
                # Home's unified account disclosure uses the same guarded logout route.
                evaluate(socket,290,"localStorage.removeItem('audit-signed-out')")
                go('/index.html',"document.querySelector('#piece-picker-dialog')?.open")
                click('#home-settings summary');click('#home-sign-out')
                wait_for(socket,"document.body.dataset.authMode==='sign-out'&&!document.querySelector('#signed-in-actions').hidden")
                assert evaluate(socket,291,"new URLSearchParams(location.search).get('return_url')==='/index.html'")
                click('#signed-in-actions a')
                wait_for(socket,"document.querySelector('#piece-picker-dialog')?.open")
                results.append({'viewport':[width,height],'resumeBeat':before,'satb':'tenore','navigation':'passed','logout':'passed'})

            # History restores safe screens and never starts a take on Forward.
            go('/voice-lab.html',"document.body.dataset.screen==='choose'")
            click('[data-path=scale]')
            history=command(socket,30,'Page.getNavigationHistory')
            command(socket,31,'Page.navigateToHistoryEntry',{'entryId':history['entries'][history['currentIndex']-1]['id']})
            wait_for(socket,"document.body.dataset.screen==='choose'")
            history=command(socket,32,'Page.getNavigationHistory')
            command(socket,33,'Page.navigateToHistoryEntry',{'entryId':history['entries'][history['currentIndex']+1]['id']})
            wait_for(socket,"document.body.dataset.screen==='prepare'")
            click('#warmup-start')
            wait_for(socket,"document.body.dataset.running==='true'")
            history=command(socket,34,'Page.getNavigationHistory')
            command(socket,35,'Page.navigateToHistoryEntry',{'entryId':history['entries'][history['currentIndex']-1]['id']})
            wait_for(socket,"document.body.dataset.screen==='prepare'&&document.body.dataset.running==='false'")
            assert evaluate(socket,36,"window.__micStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))")
            print(json.dumps({'flows':results,'voiceBack':'passed','microphoneReleased':True,'artifacts':str(ARTIFACTS)}))
        finally:
            if socket:socket.close()
            process.terminate();process.wait(timeout=5);server.shutdown()


if __name__=='__main__':main()
