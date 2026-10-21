"""Cache reuse and startup recovery with local assets and synthetic Clerk only."""
from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import tempfile
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import websocket
from browser_navigation_audit import Handler, ROOT, CHROME, command, evaluate, wait_for


class StartupHandler(Handler):
    mode = 'ok'
    requests = []
    bundles = {}

    def translate_path(self, path):
        if Path(self.directory).resolve() != (ROOT / 'frontend').resolve():
            pathname = urlsplit(path).path
            if pathname in ['/sign-in', '/sign-up']:
                path = pathname + '.html'
            return SimpleHTTPRequestHandler.translate_path(self, path)
        if urlsplit(path).path in ['/sign-in', '/sign-up']:
            path = urlsplit(path).path + '.html'
        return super().translate_path(path)

    def end_headers(self):
        path = urlsplit(self.path).path
        if re.fullmatch(r'/[\w-]+\.[a-f0-9]{12}\.(js|css)', path):
            self.send_header('Cache-Control', 'private, max-age=31536000, immutable')
        else:
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        type(self).requests.append(path)
        name = Path(path).name
        for prefix in ('auth-client', 'session-client'):
            if name == prefix + '.js' or name.startswith(prefix + '.'):
                if self.mode == 'script-stall':
                    time.sleep(5)
                if self.mode == 'script-error':
                    self.send_error(503); return
                return self.send_body(self.bundles[prefix], 'text/javascript')
        if path == '/auth/config':
            if self.mode == 'config-error':
                self.send_error(503); return
            return self.send_body({'publishableKey': 'pk_test_fixture'})
        if path == '/fixture/sdk-ready':
            if self.mode == 'sdk-stall':
                time.sleep(5)
            return self.send_body({})
        return super().do_GET()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, default=ROOT / 'frontend')
    args = parser.parse_args()
    output = ROOT / 'artifacts/startup-cache' / ('source' if args.directory == ROOT / 'frontend' else 'built')
    output.mkdir(parents=True, exist_ok=True)
    for prefix in ('auth-client', 'session-client'):
        target = output / (prefix + '.fixture.js')
        subprocess.run([str(ROOT / 'node_modules/.bin/esbuild.cmd'), str(ROOT / 'frontend' / (prefix + '.ts')),
                        '--bundle', '--platform=browser', '--target=es2022',
                        '--alias:@clerk/clerk-js=./scripts/fixtures/clerk_startup.ts',
                        '--alias:@clerk/localizations=./scripts/fixtures/clerk_startup.ts',
                        '--alias:@clerk/ui/entry=./scripts/fixtures/clerk_startup.ts',
                        f'--outfile={target}'], cwd=ROOT, check=True, capture_output=True)
        StartupHandler.bundles[prefix] = target.read_bytes()
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(StartupHandler, directory=str(args.directory.resolve())))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    results = []
    with tempfile.TemporaryDirectory(prefix='startup-recovery-') as profile:
        process = subprocess.Popen([str(CHROME), '--headless=new', '--remote-allow-origins=*',
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
              window.startupErrors=[];
              addEventListener('unhandledrejection',e=>startupErrors.push(String(e.reason)));
              const originalTimeout=window.setTimeout;
              window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===15000?2500:ms,...args);
            '''})
            def js(source): return evaluate(socket, 4, source)
            def go(path): command(socket, 5, 'Page.navigate', {'url': base + path})
            def shot(name):
                image = command(socket, 6, 'Page.captureScreenshot', {'format': 'png'})['data']
                (output / (name + '.png')).write_bytes(base64.b64decode(image))
            def healthy(path):
                go(path)
                ready = "!!document.querySelector('#clerk-sign-in input')" if path == '/sign-in' else "!!document.querySelector('#piece-picker-dialog')?.open"
                wait_for(socket, ready + "&&!document.querySelector('#startup-status')")
                assert js('startupErrors.length===0')
            def failed():
                wait_for(socket, "!!document.querySelector('#startup-status[data-failed] button:not([hidden])')")
                assert js("document.querySelector('#startup-status button').getBoundingClientRect().height>=44")
                assert js('document.documentElement.scrollWidth<=innerWidth')

            for width, height in [(1366, 768), (390, 844)]:
                command(socket, 7, 'Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': False})
                StartupHandler.mode = 'ok'
                healthy('/')
                shot(f'home-{width}')
                healthy('/sign-in')
                shot(f'login-{width}')
                for path, mode in [('/', 'script-stall'), ('/sign-in', 'script-stall'),
                                   ('/sign-in', 'config-error'), ('/', 'sdk-stall'), ('/sign-in', 'sdk-stall')]:
                    # Fault cases must exercise the download, even after healthy visits.
                    command(socket, 8, 'Network.setCacheDisabled', {'cacheDisabled': True})
                    StartupHandler.mode = mode
                    go(path); failed()
                    shot(f'{mode}-{"home" if path == "/" else "login"}-{width}')
                    assert js('startupErrors.length===0')
                    # Retry is reachable with keyboard and preserves the current URL.
                    js("document.querySelector('#startup-status button').focus()")
                    StartupHandler.mode = 'ok'
                    assert js("document.activeElement===document.querySelector('#startup-status button')")
                    for kind in ('keyDown', 'keyUp'):
                        command(socket, 9, 'Input.dispatchKeyEvent', {'type': kind, 'key': 'Enter', 'code': 'Enter', 'windowsVirtualKeyCode': 13,
                            **({'text': '\r', 'unmodifiedText': '\r'} if kind == 'keyDown' else {})})
                    ready = "!!document.querySelector('#clerk-sign-in input')" if path == '/sign-in' else "!!document.querySelector('#piece-picker-dialog')?.open"
                    try:
                        wait_for(socket, ready + "&&!document.querySelector('#startup-status')")
                    except RuntimeError:
                        shot('failure')
                        print(js("JSON.stringify({url:location.href,status:document.querySelector('#startup-status')?.outerHTML,auth:document.querySelector('#auth-status')?.outerHTML,errors:startupErrors})"), flush=True)
                        print(StartupHandler.requests[-12:], flush=True)
                        raise
                    assert js('startupErrors.length===0')
                    results.append({'viewport': [width, height], 'page': path, 'fault': mode, 'keyboardRetry': True})

            if args.directory != ROOT / 'frontend':
                command(socket, 10, 'Network.setCacheDisabled', {'cacheDisabled': False})
                command(socket, 11, 'Network.clearBrowserCache')
                healthy('/sign-in')
                first = js("performance.getEntriesByType('resource').find(e=>e.name.includes('/auth-client.'))?.transferSize")
                before = len([p for p in StartupHandler.requests if p.startswith('/auth-client.')])
                healthy('/sign-in')
                second = js("performance.getEntriesByType('resource').find(e=>e.name.includes('/auth-client.'))?.transferSize")
                after = len([p for p in StartupHandler.requests if p.startswith('/auth-client.')])
                assert first > 0 and second == 0 and after == before, (first, second, before, after)
                results.append({'browserCacheReused': True, 'firstTransferBytes': first, 'repeatTransferBytes': second})
            (output / 'result.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
            print(json.dumps(results), flush=True)
        finally:
            if socket: socket.close()
            process.terminate(); process.wait(timeout=15)
            server.shutdown()


if __name__ == '__main__':
    main()
