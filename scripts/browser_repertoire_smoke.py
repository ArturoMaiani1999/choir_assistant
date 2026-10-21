"""Read-only repertoire: cookie auth, one data request, retry and expired sessions.

Uses synthetic local data and a synthetic cookie, never real Clerk/accounts.
Pass --directory to check the exact generated release.
"""
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
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import websocket
from browser_navigation_audit import Handler, ROOT, CHROME, command, evaluate, wait_for, settle


class RepertoireHandler(Handler):
    mode = 'ok'
    assignments = None
    requests = []

    def translate_path(self, path):
        if Path(self.directory).resolve() != (ROOT / 'frontend').resolve():
            return SimpleHTTPRequestHandler.translate_path(self, path)
        return super().translate_path(path)

    def do_GET(self):
        path = urlsplit(self.path).path
        type(self).requests.append({
            'path': path, 'cookie': 'repertoire_smoke=allowed' in self.headers.get('Cookie', ''),
            'accept': self.headers.get('Accept'),
        })
        if path in ['/repertorio', '/repertorio.html']:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Set-Cookie', 'repertoire_smoke=allowed; SameSite=Lax; Path=/')
            self.end_headers()
            self.wfile.write(Path(self.translate_path('/repertorio.html')).read_bytes())
            return
        if path == '/api/progress/repertoire':
            if type(self).mode == 'expired' or 'repertoire_smoke=allowed' not in self.headers.get('Cookie', ''):
                self.send_response(401); self.end_headers(); return
            if type(self).mode == 'handshake':
                self.send_response(307)
                self.send_header('Location', '/must-not-follow-handshake-in-fetch')
                self.end_headers(); return
            if type(self).mode == 'unavailable':
                self.send_response(503); self.end_headers(); return
            if type(self).mode == 'slow':
                time.sleep(.5)
            return self.send_repertoire(type(self).assignments)
        if path == '/sign-in':
            return self.send_body(b'<main id="fixture-sign-in">Accesso</main>', 'text/html')
        if path == '/favicon.ico':
            self.send_response(204); self.end_headers(); return
        return super().do_GET()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, default=ROOT / 'frontend')
    args = parser.parse_args()
    output = ROOT / 'artifacts' / 'repertoire-performance' / ('source' if args.directory == ROOT / 'frontend' else 'built')
    output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(RepertoireHandler, directory=str(args.directory.resolve())))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    results = []
    with tempfile.TemporaryDirectory(prefix='repertoire-smoke-') as profile:
        process = subprocess.Popen([str(CHROME), '--headless=new', '--disable-gpu', '--remote-allow-origins=*',
            '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / 'DevToolsActivePort'
            for _ in range(120):
                if port_file.exists(): break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            socket = websocket.create_connection(next(t for t in tabs if t['type'] == 'page')['webSocketDebuggerUrl'], timeout=30)
            command(socket, 1, 'Page.enable')
            command(socket, 2, 'Network.enable')
            command(socket, 3, 'Page.addScriptToEvaluateOnNewDocument', {'source': '''
                window.repertoireErrors=[];
                window.repertoireReadyAt=null;
                addEventListener('error',e=>repertoireErrors.push(e.message||'resource error'));
                addEventListener('unhandledrejection',e=>repertoireErrors.push(String(e.reason)));
                new MutationObserver(()=>{
                    if(repertoireReadyAt===null&&document.querySelector('#repertoire-content')?.hidden===false)
                        repertoireReadyAt=performance.now();
                }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
            '''})

            def js(source): return evaluate(socket, 4, source)
            def go(ready="document.querySelector('#repertoire-content')?.hidden===false"):
                RepertoireHandler.requests = []
                command(socket, 5, 'Page.navigate', {'url': base + '/repertorio?from=smoke'})
                wait_for(socket, ready)
                settle(socket)
            def capture(name):
                shot = command(socket, 6, 'Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
                (output / f'{name}.png').write_bytes(base64.b64decode(shot['data']))

            for width, height in [(1366, 768), (390, 844)]:
                command(socket, 7, 'Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 600})
                RepertoireHandler.mode = 'ok'
                RepertoireHandler.assignments = None
                go()
                data_requests = [r for r in RepertoireHandler.requests if r['path'].startswith('/api/')]
                assert len(data_requests) == 1 and data_requests[0]['cookie'], data_requests
                assert data_requests[0]['accept'] == 'application/json', data_requests
                assert not any('session-client' in r['path'] or r['path'] == '/auth/config' for r in RepertoireHandler.requests)
                assert js("typeof window.ChoirAuthFetch==='undefined'&&document.querySelector('.open-piece').href.includes('part=P3')")
                assert not js('document.documentElement.scrollWidth>innerWidth')
                assert js('repertoireErrors.length===0'), js('repertoireErrors')
                capture(f'repertoire-{width}')
                js("document.querySelector('.open-piece').focus()")
                # Use actual keyboard input to activate :focus-visible.
                for modifiers in [8, 0]:
                    for kind in ['keyDown', 'keyUp']:
                        command(socket, 81, 'Input.dispatchKeyEvent', {'type': kind, 'key': 'Tab', 'code': 'Tab', 'windowsVirtualKeyCode': 9, 'modifiers': modifiers})
                assert js("document.activeElement.matches('.open-piece')&&getComputedStyle(document.activeElement).outlineStyle!=='none'")
                timing = js("({ready:repertoireReadyAt,resources:performance.getEntriesByType('resource').map(e=>({name:new URL(e.name).pathname,bytes:e.decodedBodySize}))})")
                results.append({'viewport': [width, height], 'oneCookieRequest': True, 'noSessionSDK': True, 'timing': timing})

                RepertoireHandler.assignments = []
                go()
                assert js("!!document.querySelector('.empty-state')")
                capture(f'empty-{width}')
                RepertoireHandler.mode = 'unavailable'
                go("document.querySelector('#repertoire-retry')?.checkVisibility()")
                capture(f'error-{width}')
                RepertoireHandler.mode = 'ok'
                js("document.querySelector('#repertoire-retry').focus()")
                for kind in ['keyDown', 'keyUp']:
                    params = {'type': kind, 'key': 'Enter', 'code': 'Enter', 'windowsVirtualKeyCode': 13}
                    if kind == 'keyDown': params.update(text='\r', unmodifiedText='\r')
                    command(socket, 8, 'Input.dispatchKeyEvent', params)
                wait_for(socket, "document.querySelector('#repertoire-content')?.hidden===false")

            RepertoireHandler.assignments = None
            command(socket, 82, 'Network.clearBrowserCache')
            command(socket, 83, 'Network.emulateNetworkConditions', {
                'offline': False, 'latency': 150, 'downloadThroughput': 200000, 'uploadThroughput': 93750,
            })
            command(socket, 84, 'Emulation.setCPUThrottlingRate', {'rate': 4})
            go()
            results.append({'simulatedMobile': True, 'ready': js('repertoireReadyAt'),
                            'noSessionSDK': not any('session-client' in r['path'] for r in RepertoireHandler.requests)})
            command(socket, 85, 'Network.emulateNetworkConditions', {
                'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1,
            })
            command(socket, 86, 'Emulation.setCPUThrottlingRate', {'rate': 1})

            for mode in ['expired', 'handshake']:
                RepertoireHandler.mode = mode
                go("Boolean(document.querySelector('#fixture-sign-in'))")
                url = js('location.href')
                assert parse_qs(urlsplit(url).query)['return_url'] == ['/repertorio?from=smoke'], url
                assert not any(r['path'] == '/must-not-follow-handshake-in-fetch' for r in RepertoireHandler.requests)
                results.append({'session': mode, 'safeReturnToSignIn': True})

            # Exercise the real timeout path without waiting fifteen seconds.
            hook = command(socket, 9, 'Page.addScriptToEvaluateOnNewDocument', {'source': '''
                const nativeTimeout=AbortSignal.timeout.bind(AbortSignal);
                AbortSignal.timeout=()=>nativeTimeout(100);
            '''})['identifier']
            RepertoireHandler.mode = 'slow'
            go("document.querySelector('#repertoire-retry')?.checkVisibility()")
            assert js("document.querySelector('#repertoire-status').textContent==='La connessione è lenta. Riprova.'")
            command(socket, 10, 'Page.removeScriptToEvaluateOnNewDocument', {'identifier': hook})
            RepertoireHandler.mode = 'ok'
            go()
            assert js('repertoireErrors.length===0'), js('repertoireErrors')
            results.append({'timeoutAndRetry': True})
            (output / 'result.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
            print(json.dumps({'checks': results, 'artifacts': str(output)}))
        finally:
            if socket: socket.close()
            process.terminate(); process.wait(timeout=10)
            server.shutdown()


if __name__ == '__main__':
    main()
