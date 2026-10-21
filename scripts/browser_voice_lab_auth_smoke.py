"""Real Voice Lab audio with an expired cookie and a renewed session token.

The local-only identity fixture deliberately rejects bare asset fetches. It
tests the production page, including its session-client script dependency,
without a real account, secrets, or network calls to the deployed service.
"""
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
from urllib.parse import urlsplit

import websocket
from browser_voice_lab_smoke import CHROME, ROOT, command, evaluate


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/session-client.js' or Path(path).name.startswith('session-client.'):
            body = b'''window.ChoirAuthReady=Promise.resolve();
              window.ChoirAuthFetch=async(url,init={})=>{
                await window.ChoirAuthReady;
                if(window.__expiredSession&&String(url).includes('voice-lab-assets'))
                  return new Response('',{status:401});
                const headers=new Headers(init.headers);
                headers.set('Authorization','Bearer local-test-only');
                return fetch(url,{...init,headers});
              };'''
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.end_headers()
            self.wfile.write(body)
            return
        if path == '/api/me':
            body = b'{"preferredVoicePart":"tenore"}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith('/voice-lab-assets/') and self.headers.get('Sec-Fetch-Dest') != 'image':
            if self.headers.get('Authorization') != 'Bearer local-test-only':
                self.send_response(401)
                self.end_headers()
                return
        try:
            super().do_GET()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


class Server(ThreadingHTTPServer):
    request_queue_size = 128


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', type=Path, required=True)
    parser.add_argument('--expect-failure', action='store_true')
    args = parser.parse_args()
    output = ROOT / 'artifacts/voice-lab-recovery'
    output.mkdir(exist_ok=True)
    server = Server(('127.0.0.1', 0), partial(Handler, directory=str(args.release.resolve())))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='voice-auth-') as profile:
        process = subprocess.Popen([
            str(CHROME), '--headless=new', '--disable-gpu', '--remote-allow-origins=*',
            '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0',
            f'--user-data-dir={profile}', 'about:blank',
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / 'DevToolsActivePort'
            for _ in range(120):
                if port_file.exists():
                    break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            socket = websocket.create_connection(next(t['webSocketDebuggerUrl'] for t in tabs if t['type'] == 'page'), timeout=45)
            command(socket, 1, 'Page.enable')
            command(socket, 2, 'Page.addScriptToEvaluateOnNewDocument', {'source': '''
              localStorage.setItem('choir-voice-lab:v2:role','tenor');
              window.__events=[];window.__streams=[];window.__errors=[];
              addEventListener('error',e=>__errors.push(e.message));
              addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));
              addEventListener('voice-lab-audio-event',e=>__events.push(e.detail.kind));
              const mic=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
              navigator.mediaDevices.getUserMedia=async(...a)=>{const s=await mic(...a);__streams.push(s);return s};
            '''})

            def wait(expression):
                result = evaluate(socket, 3, f'''(async()=>{{
                  for(let n=0;n<200;n++){{if({expression})return true;await new Promise(r=>setTimeout(r,50))}}
                  return false;
                }})()''', await_promise=True)
                assert result, (expression, evaluate(socket, 4, "({screen:document.body.dataset.screen,phase:document.querySelector('#warmup-instructions-dialog')?.dataset.phase,detail:document.querySelector('#warmup-plan-detail')?.textContent,errors:__errors})"))

            def shot(name):
                data = command(socket, 5, 'Page.captureScreenshot', {'format': 'png', 'fromSurface': True})
                (output / f'{name}.png').write_bytes(base64.b64decode(data['data']))

            for width, height in [(1366, 768), (390, 844)]:
                command(socket, 6, 'Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width == 390})
                command(socket, 7, 'Page.navigate', {'url': f'http://127.0.0.1:{server.server_port}/voice-lab.html'})
                wait("document.body?.dataset.screen==='choose'")
                evaluate(socket, 8, "document.querySelector('[data-path=scale]').click();document.querySelector('#warmup-instructions').click()")
                wait("['preview','error'].includes(document.querySelector('#warmup-instructions-dialog').dataset.phase)")
                phase = evaluate(socket, 9, "document.querySelector('#warmup-instructions-dialog').dataset.phase")
                assert phase == ('error' if args.expect_failure else 'preview'), phase
                assert evaluate(socket, 10, '__streams.length') == 0, 'Demo must never open microphone'
                shot(f'demo-{width}' + ('-before' if args.expect_failure else ''))
                evaluate(socket, 11, "document.querySelector('#warmup-demo-close').click();document.querySelector('#warmup-start').click()")
                if args.expect_failure:
                    wait("document.querySelector('.warmup-plan-card').classList.contains('has-error')")
                    assert evaluate(socket, 12, 'document.body.dataset.screen') == 'prepare'
                    continue
                wait("__events.includes('exercise')")
                shot(f'exercise-{width}')
                evaluate(socket, 13, "document.querySelector('#warmup-back-prepare').click()")
                wait("__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))")
                # A different tempo avoids the successful guide's decoded cache.
                evaluate(socket, 14, "__expiredSession=true;document.querySelector('[data-bpm=\"80\"]').click();document.querySelector('#warmup-start').click()")
                wait("document.querySelector('.warmup-plan-card').classList.contains('has-error')")
                metrics = evaluate(socket, 15, '''(()=>{const e=document.querySelector('#warmup-plan-detail'),b=e.getBoundingClientRect(),a=document.querySelector('#warmup-start').getBoundingClientRect();return {visible:getComputedStyle(e).display!=='none'&&b.height>0,message:e.textContent,buttonVisible:a.top>=0&&a.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()''')
                assert metrics['visible'] and metrics['buttonVisible'] and not metrics['overflow'], metrics
                assert 'Accesso scaduto' in metrics['message'], metrics
                shot(f'error-{width}')
                evaluate(socket, 16, "document.querySelector('#warmup-instructions').click()")
                wait("document.querySelector('#warmup-instructions-dialog').dataset.phase==='error'")
                assert 'Accesso scaduto' in evaluate(socket, 17, "document.querySelector('#warmup-demo-copy').textContent")
                evaluate(socket, 18, "__expiredSession=false;document.querySelector('#warmup-demo-replay').click()")
                wait("document.querySelector('#warmup-instructions-dialog').dataset.phase==='preview'")
                evaluate(socket, 19, "document.querySelector('#warmup-demo-close').click();__events=[];document.querySelector('#warmup-start').click()")
                wait("__events.includes('exercise')")
                evaluate(socket, 20, "document.querySelector('#warmup-back-prepare').click()")
                wait("__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))")
                assert evaluate(socket, 21, '__errors') == []
            print('Expected old authentication failure reproduced' if args.expect_failure else 'Authenticated demo/start, explicit expired-session errors, retry and microphone cleanup: desktop/mobile OK')
        finally:
            if socket:
                socket.close()
            process.terminate()
            process.wait(timeout=10)
            server.shutdown()


if __name__ == '__main__':
    main()
