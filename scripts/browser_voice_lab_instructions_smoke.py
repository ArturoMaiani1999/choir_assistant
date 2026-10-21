"""Verify the optional score demonstration with real assets and no microphone."""
from __future__ import annotations

import base64
import argparse
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
from browser_voice_lab_smoke import CHROME, ROOT, command, evaluate, select_path


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if Path(urlsplit(self.path).path).name.startswith('session-client.'):
            body = b'window.ChoirAuthReady=Promise.resolve();window.ChoirAuthFetch=(...args)=>window.fetch(...args);'
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.end_headers()
            self.wfile.write(body)
            return
        try:
            super().do_GET()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass  # Closing a demo/page can cancel an asset download on Windows.


def wait_for(socket, expression, seconds=12):
    ready = evaluate(socket, 800, f"""(async () => {{
      const deadline = performance.now() + {seconds * 1000};
      while (performance.now() < deadline) {{
        if ({expression}) return true;
        await new Promise(resolve => setTimeout(resolve, 30));
      }}
      return false;
    }})()""", await_promise=True)
    if not ready:
        state = evaluate(socket, 899, """({phase: document.querySelector('#warmup-instructions-dialog')?.dataset.phase,
          visibility: document.visibilityState, events: window.__demoEvents, errors: window.__demoErrors,
          time: window.__demoContext?.currentTime, audio: window.__demoContext?.state,
          notes: document.querySelectorAll('#warmup-demo-score .Note').length})""")
        raise AssertionError((expression, state))


def screenshot(socket, name):
    shot = command(socket, 801, 'Page.captureScreenshot', {'format': 'png', 'fromSurface': True})
    (ROOT / 'artifacts' / f'voice-lab-instructions-{name}.png').write_bytes(base64.b64decode(shot['data']))


def close(socket, method='button'):
    if method == 'escape':
        command(socket, 802, 'Input.dispatchKeyEvent', {
            'type': 'keyDown', 'key': 'Escape', 'code': 'Escape', 'windowsVirtualKeyCode': 27})
    elif method == 'backdrop':
        for event in ('mousePressed', 'mouseReleased'):
            command(socket, 803, 'Input.dispatchMouseEvent', {
                'type': event, 'x': 2, 'y': 2, 'button': 'left', 'clickCount': 1})
    else:
        evaluate(socket, 804, "document.querySelector('#warmup-demo-close').click()")
    wait_for(socket, "!document.querySelector('#warmup-instructions-dialog').open")
    wait_for(socket, "document.activeElement.id === 'warmup-instructions'")
    assert evaluate(socket, 805, "window.__demoSources.every(source => source.stopped)") is True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dist', action='store_true')
    parser.add_argument('--release', type=Path)
    args = parser.parse_args()
    directory = args.release or ROOT / ('dist' if args.dist else 'frontend')
    class Server(ThreadingHTTPServer):
        request_queue_size = 128
    server = Server(('127.0.0.1', 0), partial(Handler, directory=str(directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    (ROOT / 'artifacts').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='choir-instructions-') as profile:
        process = subprocess.Popen([
            str(CHROME), '--headless=new', '--disable-gpu', '--remote-allow-origins=*',
            '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0',
            f'--user-data-dir={profile}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / 'DevToolsActivePort'
            for _ in range(120):
                if port_file.exists():
                    break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            socket = websocket.create_connection(next(tab['webSocketDebuggerUrl'] for tab in tabs if tab['type'] == 'page'), timeout=40)
            command(socket, 1, 'Page.enable')
            command(socket, 2, 'Page.addScriptToEvaluateOnNewDocument', {'source': """
              window.__demoMicrophones = 0; window.__demoEvents = []; window.__demoSources = [];
              window.__demoErrors = []; window.addEventListener('error', event => window.__demoErrors.push(event.message));
              localStorage.setItem('choir-voice-lab:v2:role', 'tenor');
              navigator.mediaDevices.getUserMedia = async () => { window.__demoMicrophones++; throw Error('Unexpected microphone'); };
              window.addEventListener('voice-lab-audio-event', event => window.__demoEvents.push(event.detail));
              for (const method of ['createBufferSource', 'createOscillator']) {
                const original = AudioContext.prototype[method];
                AudioContext.prototype[method] = function(...args) {
                  window.__demoContext = this;
                  const source = original.apply(this, args), stop = source.stop.bind(source);
                  source.stop = (...values) => { if (!values.length) source.stopped = true; return stop(...values); };
                  window.__demoSources.push(source); return source;
                };
              }
            """})
            command(socket, 3, 'Page.navigate', {'url': f'http://127.0.0.1:{server.server_port}/voice-lab.html'})
            wait_for(socket, "document.body?.dataset.screen === 'choose'")
            for width, height in [(1366, 768), (390, 844)]:
                command(socket, 4, 'Emulation.setDeviceMetricsOverride', {
                    'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width == 390})
                select_path(socket, 'scale')
                evaluate(socket, 5, "document.querySelector('[data-bpm=\"100\"]').click(); document.querySelector('#warmup-instructions').focus(); document.querySelector('#warmup-instructions').click()")
                wait_for(socket, "document.querySelector('#warmup-instructions-dialog').dataset.phase === 'preview'")
                wait_for(socket, "document.querySelector('#warmup-demo-score .Clef')?.getAttribute('transform') !== 'translate(0 0)'")
                metrics = evaluate(socket, 6, """(() => {
                  const dialog = document.querySelector('#warmup-instructions-dialog'), bounds = dialog.getBoundingClientRect();
                  return {overflow: dialog.scrollHeight - dialog.clientHeight, top: bounds.top, bottom: bounds.bottom,
                    height: innerHeight, noteCount: dialog.querySelectorAll('.Note').length,
                    highlighted: dialog.querySelectorAll('.demo-note-active').length,
                    microphone: window.__demoMicrophones};
                })()""")
                assert metrics['overflow'] == 0 and 0 <= metrics['top'] < metrics['bottom'] <= metrics['height'], metrics
                assert metrics['noteCount'] == 9 and metrics['microphone'] == 0, metrics
                assert metrics['highlighted'] == 0, metrics
                screenshot(socket, f'preview-{width}')
                preview = evaluate(socket, 61, """(async () => {
                  const dialog = document.querySelector('#warmup-instructions-dialog');
                  const deadline = performance.now() + 12000;
                  let highlighted = false;
                  while (dialog.dataset.phase === 'preview' && performance.now() < deadline) {
                    highlighted ||= !!dialog.querySelector('.demo-note-active');
                    await new Promise(resolve => setTimeout(resolve, 30));
                  }
                  return {highlighted, phase: dialog.dataset.phase};
                })()""", await_promise=True)
                assert preview == {'highlighted': False, 'phase': 'count-in'}, preview
                assert evaluate(socket, 7, "getComputedStyle(document.querySelector('#warmup-demo-beats')).visibility") == 'visible'
                if width == 390:
                    screenshot(socket, 'count-in-mobile')
                wait_for(socket, "document.querySelector('#warmup-instructions-dialog').dataset.phase === 'take' && !!document.querySelector('#warmup-demo-score .demo-note-active')")
                follow = evaluate(socket, 71, """({
                  title: document.querySelector('#warmup-demo-title').textContent,
                  fill: getComputedStyle(document.querySelector('#warmup-demo-score .Note.demo-note-active')).fill,
                  instructions: document.querySelector('#warmup-instructions-dialog').textContent
                })""")
                assert follow['title'] == 'Segui le note' and follow['fill'] == 'rgb(217, 180, 110)', follow
                assert 'Canta su' not in follow['instructions'], follow
                wait_for(socket, "document.querySelector('#warmup-demo-caption').textContent.includes('2 / 9')")
                screenshot(socket, 'take-mobile' if width == 390 else 'take-desktop')
                wait_for(socket, "document.querySelector('#warmup-instructions-dialog').dataset.phase === 'finished'")
                assert evaluate(socket, 8, "!document.querySelector('#warmup-demo-replay').disabled") is True
                events = evaluate(socket, 9, 'window.__demoEvents')
                demo_event = [event for event in events if event['kind'] == 'demonstration'][-1]
                assert demo_event['exercise']['bpm'] == 100
                phrases = [event for event in events if event['kind'] == 'model-phrase' and event['at'] >= demo_event['at']]
                assert len(phrases) == 2, phrases
                assert phrases[0]['at'] == demo_event['at'] and phrases[1]['at'] == demo_event['takeAt'], phrases
                assert any(event['kind'] == 'metronome' and event['at'] == demo_event['takeAt'] for event in events)
                assert not any(event['kind'] == 'root-drone' for event in events)
                if width == 390:
                    evaluate(socket, 10, "document.querySelector('#warmup-demo-replay').click()")
                    wait_for(socket, "document.querySelector('#warmup-instructions-dialog').dataset.phase === 'preview'")
                    close(socket, 'backdrop')
                else:
                    close(socket, 'escape')

            select_path(socket, 'chords')
            evaluate(socket, 110, "document.querySelector('#warmup-position-options').open=true")
            assert evaluate(socket, 111, "document.querySelector('.warmup-shell').scrollHeight === document.querySelector('.warmup-shell').clientHeight") is True
            screenshot(socket, 'arpeggio-expanded-mobile')
            evaluate(socket, 11, "document.querySelector('[data-inversion=first]').click(); document.querySelector('#warmup-instructions').click()")
            wait_for(socket, "document.querySelector('#warmup-instructions-dialog').dataset.phase === 'preview'")
            assert evaluate(socket, 12, "window.__demoEvents.filter(event => event.kind === 'demonstration').at(-1).exercise.inversion") == 'first'
            assert evaluate(socket, 13, "document.querySelectorAll('#warmup-demo-score .Note').length") == 5
            screenshot(socket, 'arpeggio-mobile')
            close(socket)

            # Bass clef, reduced motion, and an independent root-only inner-ear demo.
            evaluate(socket, 14, "document.querySelector('#lab-settings').click(); document.querySelector('#lab-role').value='bass'; document.querySelector('#lab-role').dispatchEvent(new Event('change')); document.querySelector('#lab-settings-save').click()")
            command(socket, 15, 'Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]})
            select_path(socket, 'ear')
            evaluate(socket, 16, "window.__demoEvents=[]; document.querySelector('[data-family=degree]').click(); document.querySelector('#warmup-level-options').open=true; document.querySelector('#warmup-instructions').click()")
            assert evaluate(socket, 161, "document.querySelector('.warmup-shell').scrollHeight === document.querySelector('.warmup-shell').clientHeight") is True
            wait_for(socket, "document.querySelector('#warmup-instructions-dialog').dataset.phase === 'preview'")
            assert evaluate(socket, 17, "window.__demoEvents.find(event => event.kind === 'demo-root').role") == 'bass'
            assert evaluate(socket, 18, "document.querySelector('#warmup-demo-score .Clef').getAttribute('transform')") == 'translate(0 0)'
            assert evaluate(socket, 19, "window.__demoEvents.some(event => event.kind === 'model-phrase')") is False
            screenshot(socket, 'inner-ear-bass-mobile')
            close(socket)

            # A late score response after closing must not schedule any audio.
            evaluate(socket, 20, """window.__demoEvents=[]; window.__nativeFetch=window.fetch;
              window.fetch=(...args) => String(args[0]).includes('/scores/')
                ? new Promise(resolve => { window.__releaseScore = () => resolve(window.__nativeFetch(...args)); })
                : window.__nativeFetch(...args);
              document.querySelector('#warmup-instructions').click();""")
            close(socket)
            evaluate(socket, 21, "window.__releaseScore(); window.fetch=window.__nativeFetch")
            time.sleep(.3)
            assert evaluate(socket, 22, 'window.__demoEvents.length') == 0
            # Failure is explicit and retry succeeds without leaving preparation.
            evaluate(socket, 23, """window.fetch=(...args) => String(args[0]).includes('/scores/')
              ? Promise.resolve(new Response('', {status:503})) : window.__nativeFetch(...args);
              document.querySelector('#warmup-instructions').click();""")
            wait_for(socket, "document.querySelector('#warmup-instructions-dialog').dataset.phase === 'error'")
            evaluate(socket, 24, "window.fetch=window.__nativeFetch; document.querySelector('#warmup-demo-replay').click()")
            wait_for(socket, "document.querySelector('#warmup-instructions-dialog').dataset.phase === 'preview'")
            close(socket)
            assert evaluate(socket, 25, 'window.__demoMicrophones') == 0
            print('Instructions: desktop/mobile, all phases, replay, arpeggio, bass, reduced motion, three close methods, late downloads, retry; no microphone: OK')
        finally:
            if socket:
                socket.close()
            process.terminate()
            process.wait(timeout=10)
            server.shutdown()


if __name__ == '__main__':
    main()
