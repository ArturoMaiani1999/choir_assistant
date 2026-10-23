"""Read-only navigation audit with local assets and synthetic account data.

Writes observations and screenshots, never talks to the deployed application.
This is an audit probe, not a test that treats known UX findings as failures.
"""
from __future__ import annotations

import base64
import hashlib
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

from browser_dist_smoke import CHROME, command, evaluate

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'artifacts' / 'navigation-audit'
ME = {'roles': ['director'], 'voicePart': 'tenore', 'preferredVoicePart': 'tenore', 'profileCompleted': True,
      'member': {'id': 'audit-member', 'firstName': 'Corista', 'lastName': 'Esempio', 'displayName': 'Corista Esempio'}}
BEST = {'id': 'audit-best', 'pieceId': 'ave-verum', 'partId': 'P3', 'voicePart': 'tenore',
        'score': 90, 'coverage': 100, 'coverageRatio': 1, 'owner': ME['member'], 'imageUrl': '/audit-trace.svg'}
OTHER_BEST = dict(BEST, id='audit-other', pieceId='o-sacrum')


class Handler(SimpleHTTPRequestHandler):
    def do_PATCH(self):
        if urlsplit(self.path).path != '/api/me':
            self.send_error(404); return
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if 'preferredVoicePart' in body:
            ME['preferredVoicePart'] = body['preferredVoicePart']
        for field in ['firstName', 'lastName']:
            if field in body:
                ME['member'][field] = body[field]
        return self.send_body(ME)
    def handle(self):
        try:
            super().handle()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

    def log_message(self, *_args):
        pass

    def send_body(self, body, mime='application/json'):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_repertoire(self, assignments=None):
        if assignments is None:
            assignments = [{'pieceId': 'ave-verum', 'status': 'in_progress',
                            'latestScore': 82, 'latestCoverage': 62, 'completionCount': 2}]
        library = json.loads(Path(self.translate_path('/library.json')).read_text(encoding='utf-8'))
        assigned_ids = {item['pieceId'] for item in assignments}
        return self.send_body({
            'voicePart': ME.get('preferredVoicePart') or ME.get('voicePart'),
            'canDirect': 'director' in ME.get('roles', []),
            'assignments': assignments,
            'pieces': [piece for piece in library['pieces'] if piece['piece_id'] in assigned_ids],
        })

    def translate_path(self, path):
        original = Path(super().translate_path(path))
        if original.is_file() or original.is_dir() or original.suffix == '.html':
            return str(original)
        relative = original.relative_to(ROOT / 'frontend')
        return str(ROOT / 'dist' / relative)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/progress/repertoire':
            return self.send_repertoire()
        # Match deployed asset byte ranges: SimpleHTTPRequestHandler otherwise
        # exposes a zero-length seekable range for some Chromium MP3 loads.
        if path.endswith('.mp3'):
            audio = Path(self.translate_path(self.path))
            if audio.is_file():
                payload = audio.read_bytes()
                start, end = 0, len(payload)-1
                requested = self.headers.get('Range')
                if requested:
                    span = requested.removeprefix('bytes=').split(',')[0].split('-')
                    start = int(span[0]) if span[0] else max(0,len(payload)-int(span[1]))
                    end = min(end,int(span[1])) if span[0] and span[1] else end
                    if start > end:
                        self.send_error(416);return
                self.send_response(206 if requested else 200)
                self.send_header('Content-Type','audio/mpeg')
                self.send_header('Accept-Ranges','bytes')
                self.send_header('Content-Length',str(end-start+1))
                if requested:self.send_header('Content-Range',f'bytes {start}-{end}/{len(payload)}')
                self.end_headers()
                self.wfile.write(payload[start:end+1]);return
        if path == '/session-client.js':
            return self.send_body(b'window.ChoirAuthReady=Promise.resolve();window.ChoirAuthFetch=window.fetch.bind(window);', 'text/javascript')
        if path == '/runtime-config.js':
            config = {'mode': 'production', 'libraryUrl': 'library.json',
                      'bundleUrlTemplate': 'library-assets/{pieceId}/bundle.json',
                      'features': {'diagnostics': False, 'crepe': False, 'transpose': True, 'performances': True}}
            return self.send_body(('window.ChoirRuntimeConfig = ' + json.dumps(config) + ';').encode(), 'text/javascript')
        if path == '/audit-trace.svg':
            return self.send_body(b'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200"><rect width="640" height="200" fill="#102126"/><path d="M0 130L120 70L240 90L400 40L640 120" stroke="#76c7b9" fill="none" stroke-width="4"/></svg>', 'image/svg+xml')
        responses = {
            '/api/me': ME,
            '/api/groups': {'groups': []},
            '/api/performances/mine': {'performances': [BEST, OTHER_BEST]},
            '/api/performances/audit-best/analysis': {'status':'ready', 'trace': [{'beat': i / 4, 'displayPitch': 60, 'confidence': .95} for i in range(96)], 'errors':[]},
            '/api/performances/audit-other/analysis': {'status':'ready', 'trace': [{'beat': i / 4, 'displayPitch': 60, 'confidence': .95} for i in range(96)], 'errors':[]},
            '/api/recordings/mine': {'recordings': []},
            '/api/recordings/automatic-best': {'enabled': False},
            '/api/progress/consent': {'accepted': True},
            '/api/echo-diagnostics': {'diagnostics': []},
            '/api/progress/assignments': {'assignments': [{'pieceId': 'ave-verum', 'status': 'in_progress', 'latestScore': 82, 'latestCoverage': 62, 'completionCount': 2}]},
            '/api/cockpit/overview': {'assignments': [{'pieceId': 'ave-verum'}], 'members': [dict(ME['member'], memberId='audit-member', voicePart='tenore')], 'progress': []},
            '/api/cockpit/recordings': {'recordings': []},
            '/api/cockpit/pieces/ave-verum': {'scoreVersionId': 'audit-version', 'traces': [{'id': 'audit-best', 'memberId': 'audit-member', 'displayName': 'Corista Esempio', 'voicePart': 'tenore', 'partId': 'P3', 'trace': [{'beat': i / 4, 'displayPitch': 60, 'confidence': .95} for i in range(96)]}]},
        }
        if path in responses:
            return self.send_body(responses[path])
        return super().do_GET()


class ReleaseHandler(Handler):
    """Serve an exact built directory with the local account/session fixture."""
    def translate_path(self, path):
        return SimpleHTTPRequestHandler.translate_path(self, path)

    def do_GET(self):
        if Path(urlsplit(self.path).path).name.startswith('session-client.'):
            return self.send_body(b'window.ChoirAuthReady=Promise.resolve();window.ChoirAuthFetch=window.fetch.bind(window);', 'text/javascript')
        return super().do_GET()


def wait_for(socket, expression):
    for _ in range(120):
        if evaluate(socket, 900, expression):
            return
        time.sleep(.05)
    raise RuntimeError(f'Page did not reach: {expression}')


def settle(socket):
    evaluate(socket, 901, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')


def snapshot(socket, name, reports):
    settle(socket)
    result = evaluate(socket, 902, """(() => {
      const visible = element => element.checkVisibility({checkVisibilityCSS:true});
      return {url:location.pathname+location.search+location.hash, width:innerWidth, height:innerHeight,
        focus:document.activeElement?.id, historyLength:history.length,
        dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>({id:d.id,scroll:d.scrollHeight-d.clientHeight,
          actions:[...d.querySelectorAll('button,a,summary')].filter(visible).map(b=>({id:b.id,text:b.textContent.trim().replace(/\\s+/g,' '),top:b.getBoundingClientRect().top,bottom:b.getBoundingClientRect().bottom}))})),
        navigation:[...document.querySelectorAll('a,button')].filter(visible).filter(e=>!e.closest('dialog:not([open])')).map(e=>({id:e.id,text:e.textContent.trim().replace(/\\s+/g,' ').slice(0,90),href:e.getAttribute('href'),top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom})),
        practice:typeof state!=='undefined'&&state.runtime?{piece:state.bundleManifest?.piece_id,part:state.runtime.selectedPartId,beat:state.clock?.beat,checkpoint:state.resumeCheckpointBeat,measure:document.querySelector('#measure-number')?.textContent}:null};
    })()""")
    result['name'] = name
    reports.append(result)
    shot = command(socket, 903, 'Page.captureScreenshot', {'format': 'png', 'fromSurface': True})
    (ARTIFACTS / f'{name}.png').write_bytes(base64.b64decode(shot['data']))
    return result


def main():
    # The original findings are documented in navigation-ux-audit.md. The
    # corrected flows are now exercised by the regression smoke.
    from browser_navigation_smoke import main as regression
    regression()


if __name__ == '__main__':
    main()
