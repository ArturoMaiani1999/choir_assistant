"""Verify calm surfaces and the exercise toolbar with local account data."""
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
from browser_navigation_audit import Handler, ROOT, CHROME, command, evaluate, wait_for
from browser_relax_smoke import RelaxHandler

ARTIFACTS = ROOT / 'artifacts' / 'ambient-curve' / ('built' if '--dist' in sys.argv else 'source')


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    use_dist = '--dist' in sys.argv
    directory = Path(sys.argv[sys.argv.index('--directory')+1]) if '--directory' in sys.argv else ROOT/'dist'
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(RelaxHandler if use_dist else Handler,
        directory=str(directory if use_dist else ROOT/'frontend')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    reports = []
    with tempfile.TemporaryDirectory(prefix='choir-ambient-') as profile:
        process = subprocess.Popen([str(CHROME), '--headless=new', '--disable-gpu', '--remote-allow-origins=*',
            '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile)/'DevToolsActivePort'
            for _ in range(120):
                if port_file.exists(): break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            socket = websocket.create_connection(next(t for t in tabs if t['type']=='page')['webSocketDebuggerUrl'], timeout=30)
            command(socket, 1, 'Page.enable')
            command(socket, 2, 'Page.addScriptToEvaluateOnNewDocument', {'source': """
                window.ambientErrors=[];window.ambientMicrophones=0;
                addEventListener('error',e=>ambientErrors.push(e.message));
                addEventListener('unhandledrejection',e=>ambientErrors.push(String(e.reason)));
                navigator.mediaDevices.getUserMedia=async()=>{ambientMicrophones++;throw Error('Unexpected microphone');};
            """})
            def js(expression): return evaluate(socket, 3, expression)
            def delay(ms): js(f'new Promise(r=>setTimeout(r,{ms}))')
            def capture(name):
                shot=command(socket,4,'Page.captureScreenshot',{'format':'png','fromSurface':True})
                (ARTIFACTS/f'{name}.png').write_bytes(base64.b64decode(shot['data']))
            def assert_calm():
                assert js("!document.querySelector('.ambient-curve,.ambient-respiro')&&typeof window.Lissajous==='undefined'")
                assert js('ambientErrors.length===0&&ambientMicrophones===0'),js('ambientErrors')
            def layout():
                return js("""(()=>{const header=document.querySelector('.warmup-toolbar').getBoundingClientRect(),
                    nav=document.querySelector('.warmup-navigation'),main=document.querySelector('main'),
                    button=document.querySelector('.warmup-back').getBoundingClientRect();
                    return {headerTop:header.top,headerBottom:header.bottom,mainTop:main.getBoundingClientRect().top,
                        navHeight:nav.getBoundingClientRect().height,menuHeight:button.height,
                        overflow:document.documentElement.scrollWidth>innerWidth,
                        scroll:main.scrollHeight-main.clientHeight};})()""")
            for width,height in [(1366,768),(390,844),(1920,900)]:
                command(socket,5,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':width<600})
                for page in ['repertorio','cockpit','voice-lab']:
                    command(socket,6,'Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/{page}.html'})
                    if page!='voice-lab':
                        wait_for(socket,"document.querySelector('.assignment-row,.piece-card')!==null")
                        assert_calm()
                        capture(f'{page}-{width}-default')
                        continue
                    wait_for(socket,"document.body.dataset.screen==='choose'")
                    delay(150)
                    assert_calm()
                    default=layout()
                    assert default['headerTop']==0 and default['menuHeight']>=44,default
                    assert default['mainTop']==default['headerBottom'],default
                    assert not default['overflow'] and default['scroll']==0,default
                    capture(f'{page}-{width}-default')
                    # Session libraries can prepend an empty UI portal to body.
                    # It used to consume row 1 and push the toolbar into row 2.
                    js("const portal=document.createElement('div');portal.id='session-portal-probe';document.body.prepend(portal)")
                    assert layout()==default,(default,layout())
                    capture(f'{page}-{width}-session-portal')
                    js("document.querySelector('[data-path=scale]').click()")
                    wait_for(socket,"document.body.dataset.screen==='prepare'")
                    prepared=layout()
                    assert prepared['headerTop']==0 and prepared['navHeight']>=44,prepared
                    assert prepared['mainTop']==prepared['headerBottom']+prepared['navHeight'],prepared
                    assert not prepared['overflow'] and prepared['scroll']==0,prepared
                    assert_calm()
                    capture(f'{page}-{width}-prepare')
                    js("document.querySelector('#lab-settings').click()")
                    wait_for(socket,"document.querySelector('#lab-settings-dialog').open")
                    assert_calm()
                    js("document.querySelector('#lab-settings-close').click()")
                    for phase in ['session','review']:
                        js(f"document.body.dataset.screen='{phase}'")
                        assert_calm()
                        assert layout()['headerTop']==0
                    reports.append({'width':width,'choose':default,'prepare':prepared,'sessionPortal':'passed'})
            report={'pages':reports,'errors':[]}
            (ARTIFACTS/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            print(json.dumps(report))
        finally:
            if socket: socket.close()
            process.terminate();process.wait(timeout=5);server.shutdown()


if __name__=='__main__': main()
