"""Responsive regression check for the director programme table."""
from __future__ import annotations

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

import websocket

from browser_practice_smoke import CHROME, command, evaluate


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
ARTIFACTS = ROOT / "artifacts" / "cockpit-layout"

LIBRARY = {
    "pieces": [
        {"piece_id": "o-sacrum", "title": "O sacrum convivium", "parts": []},
        {"piece_id": "anima-christi", "title": "Anima Christi", "parts": []},
        {"piece_id": "ave-maria", "title": "Ave Maria", "parts": []},
        {"piece_id": "ubi-caritas", "title": "Ubi caritas", "parts": []},
    ],
}
OVERVIEW = {
    "assignments": [{"pieceId": "o-sacrum"}, {"pieceId": "anima-christi"}],
    "members": [
        {"memberId": "m1", "displayName": "Anna", "voicePart": "soprano"},
        {"memberId": "m2", "displayName": "Bruno", "voicePart": "tenore"},
        {"memberId": "m3", "displayName": "Carla", "voicePart": "contralto"},
    ],
    "progress": [
        {"memberId": "m1", "pieceId": "o-sacrum", "status": "ready", "bestScore": 92},
        {"memberId": "m2", "pieceId": "o-sacrum", "status": "completed", "bestScore": 84},
        {"memberId": "m3", "pieceId": "o-sacrum", "status": "in_progress", "bestScore": 68},
        {"memberId": "m1", "pieceId": "anima-christi", "status": "completed", "bestScore": 88},
    ],
}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        return

    def send_json(self, payload: object) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib hook
        path = self.path.split("?", 1)[0]
        if path == "/session-client.js":
            body = b"window.ChoirAuthReady=Promise.resolve();window.ChoirAuthFetch=window.fetch.bind(window);"
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/me":
            self.send_json({
                "roles": ["director"], "voicePart": "tenore",
                "member": {"displayName": "Arturo", "firstName": "Arturo"},
            })
            return
        if path == "/api/cockpit/overview":
            self.send_json(OVERVIEW)
            return
        if path == "/api/progress/assignments":
            self.send_json({"assignments": [
                {"pieceId": "o-sacrum", "status": "in_progress", "latestCoverage": 62,
                 "latestScore": 69, "completionCount": 2, "lastPracticedAt": "2026-10-17T18:00:00Z"},
                {"pieceId": "anima-christi", "status": "ready", "latestCoverage": 100,
                 "latestScore": 91, "completionCount": 5, "lastPracticedAt": "2026-10-16T18:00:00Z"},
            ]})
            return
        if path == "/library.json":
            self.send_json(LIBRARY)
            return
        super().do_GET()


def wait_for_rows(socket: websocket.WebSocket) -> None:
    for call_id in range(20, 120):
        if evaluate(socket, call_id, "document.querySelectorAll('.assignment-row').length") == 4:
            return
        time.sleep(.05)
    raise RuntimeError("La tabella del programma non è stata renderizzata")


def main() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        partial(Handler, directory=str(FRONTEND)),
    )
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    url = f"http://127.0.0.1:{server.server_port}/cockpit.html"

    with tempfile.TemporaryDirectory(prefix="choir-cockpit-layout-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            "--remote-debugging-port=0", f"--user-data-dir={profile}", "--window-size=1440,900", url,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(100):
                try:
                    port = port_file.read_text().splitlines()[0]
                    break
                except (OSError, IndexError):
                    time.sleep(.05)
            else:
                raise RuntimeError("Chrome non ha aperto la porta di debug")
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(tab for tab in tabs if tab.get("type") == "page" and tab.get("url") == url)
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=20)
            command(socket, 1, "Page.enable")
            wait_for_rows(socket)

            desktop = evaluate(socket, 130, """(async () => {
              const rows = [...document.querySelectorAll('.assignment-row')];
              const assigned = rows.filter(row => row.classList.contains('is-assigned'));
              const normal = rows.find(row => !row.classList.contains('is-assigned'));
              const assignedStyle = getComputedStyle(assigned[0]);
              const normalStyle = getComputedStyle(normal);
              const highlighted = assignedStyle.backgroundColor !== normalStyle.backgroundColor
                && assignedStyle.boxShadow !== 'none';
              const triggers = [...document.querySelectorAll('.assignment-preparation-trigger')];
              triggers[0].dispatchEvent(new MouseEvent('click', {bubbles:true, detail:1}));
              await new Promise(resolve => setTimeout(resolve, 230));
              const detail = document.querySelector('.preparation-detail');
              const groups = [...detail.querySelectorAll('.preparation-group')];
              return {
                rowCount: rows.length,
                firstTwoAssigned: rows.slice(0, 2).every(row => row.classList.contains('is-assigned')),
                semanticRows: rows.every(row => row.tagName === 'TR' && row.querySelector('th[scope=row]')),
                progressValues: assigned.map(row => row.querySelector('progress')?.value),
                highlighted,
                matrixAbsent: !document.querySelector('.matrix-wrap'),
                preparationTriggerCount: triggers.length,
                detailOpen: Boolean(detail) && Boolean(document.querySelector('.assignment-preparation-trigger[aria-expanded=true]')),
                preparedCount: groups[0].querySelector('h4 strong').textContent,
                remainingCount: groups[1].querySelector('h4 strong').textContent,
                ambientLayerCount: document.querySelectorAll('.ambient-respiro__glow').length,
                ambientAnimationRunning: [...document.querySelectorAll('.ambient-respiro__glow')]
                  .every(layer => getComputedStyle(layer).animationName !== 'none'
                    && getComputedStyle(layer).animationPlayState === 'running'),
                ambientBreathSeconds: [...document.querySelectorAll('.ambient-respiro__glow')]
                  .map(layer => Number.parseFloat(getComputedStyle(layer).animationDuration)),
                oldCircularGradientAbsent: !getComputedStyle(document.body).backgroundImage.includes('radial-gradient'),
                documentOverflow: document.documentElement.scrollWidth > innerWidth,
              };
            })()""")
            assert desktop == {
                "rowCount": 4,
                "firstTwoAssigned": True,
                "semanticRows": True,
                "progressValues": [33, 67],
                "highlighted": True,
                "matrixAbsent": True,
                "preparationTriggerCount": 2,
                "detailOpen": True,
                "preparedCount": "1",
                "remainingCount": "2",
                "ambientLayerCount": 2,
                "ambientAnimationRunning": True,
                "ambientBreathSeconds": [22, 29],
                "oldCircularGradientAbsent": True,
                "documentOverflow": False,
            }, desktop
            shot = command(socket, 131, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
            (ARTIFACTS / "programme-desktop.png").write_bytes(base64.b64decode(shot["data"]))

            command(socket, 132, "Emulation.setDeviceMetricsOverride", {
                "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True,
            })
            time.sleep(.2)
            mobile = evaluate(socket, 133, """(() => {
              const rows = [...document.querySelectorAll('.assignment-row')];
              const buttons = [...document.querySelectorAll('.assignment-actions button')];
              const detail = document.querySelector('.preparation-detail').getBoundingClientRect();
              return {
                rowCount: rows.length,
                tableIsRecomposed: getComputedStyle(document.querySelector('.assignment-table')).display === 'block',
                buttonsUsable: buttons.every(button => button.getBoundingClientRect().height >= 44),
                preparationTriggerUsable: [...document.querySelectorAll('.assignment-preparation-trigger')]
                  .every(button => button.getBoundingClientRect().height >= 44),
                detailInsideViewport: detail.left >= 0 && detail.right <= innerWidth,
                ambientWarmHidden: getComputedStyle(document.querySelector('.ambient-respiro__glow--warm')).display === 'none',
                rowsInsideViewport: rows.every(row => {
                  const box = row.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth;
                }),
                documentOverflow: document.documentElement.scrollWidth > innerWidth,
              };
            })()""")
            assert mobile == {
                "rowCount": 4,
                "tableIsRecomposed": True,
                "buttonsUsable": True,
                "preparationTriggerUsable": True,
                "detailInsideViewport": True,
                "ambientWarmHidden": True,
                "rowsInsideViewport": True,
                "documentOverflow": False,
            }, mobile
            shot = command(socket, 134, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
            (ARTIFACTS / "programme-mobile.png").write_bytes(base64.b64decode(shot["data"]))

            command(socket, 135, "Page.navigate", {
                "url": f"http://127.0.0.1:{server.server_port}/sign-in.html",
            })
            time.sleep(.4)
            auth = evaluate(socket, 136, """(() => {
              const main = document.querySelector('main').getBoundingClientRect();
              const paragraphs = [...document.querySelectorAll('main p')].map(item => item.getBoundingClientRect());
              return {
                mainInsideViewport: main.left >= 0 && main.right <= innerWidth,
                paragraphsInsideViewport: paragraphs.every(box => box.left >= 0 && box.right <= innerWidth),
                documentOverflow: document.documentElement.scrollWidth > innerWidth,
              };
            })()""")
            assert auth == {
                "mainInsideViewport": True,
                "paragraphsInsideViewport": True,
                "documentOverflow": False,
            }, auth
            shot = command(socket, 137, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
            (ARTIFACTS / "auth-mobile.png").write_bytes(base64.b64decode(shot["data"]))

            command(socket, 138, "Page.navigate", {
                "url": f"http://127.0.0.1:{server.server_port}/repertorio.html",
            })
            for call_id in range(140, 200):
                if evaluate(socket, call_id, "document.querySelectorAll('.piece-card').length") == 2:
                    break
                time.sleep(.05)
            else:
                raise RuntimeError("Il repertorio personale non è stato renderizzato")
            repertoire = evaluate(socket, 201, """(() => {
              const cards = [...document.querySelectorAll('.piece-card')];
              const actions = [...document.querySelectorAll('.open-piece')];
              return {
                cardCount: cards.length,
                navigationFits: [...document.querySelectorAll('.page-header nav a')].every(link => {
                  const box = link.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth;
                }),
                actionsUsable: actions.every(action => action.getBoundingClientRect().height >= 44),
                documentOverflow: document.documentElement.scrollWidth > innerWidth,
              };
            })()""")
            assert repertoire == {
                "cardCount": 2,
                "navigationFits": True,
                "actionsUsable": True,
                "documentOverflow": False,
            }, repertoire
            shot = command(socket, 202, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
            (ARTIFACTS / "repertoire-mobile.png").write_bytes(base64.b64decode(shot["data"]))

            command(socket, 203, "Emulation.setEmulatedMedia", {
                "features": [{"name": "prefers-reduced-motion", "value": "reduce"}],
            })
            reduced_motion = evaluate(socket, 204, """(() => ({
              animationsStopped: [...document.querySelectorAll('.ambient-respiro__glow')]
                .every(layer => getComputedStyle(layer).animationName === 'none'),
              transitionStopped: getComputedStyle(document.querySelector('.ambient-respiro')).transitionDuration === '0s',
            }))()""")
            assert reduced_motion == {
                "animationsStopped": True,
                "transitionStopped": True,
            }, reduced_motion
            print(json.dumps({
                "desktop": desktop, "mobile": mobile, "auth": auth, "repertoire": repertoire,
                "reducedMotion": reduced_motion,
            }, ensure_ascii=False, indent=2))
        finally:
            if socket:
                socket.close()
            process.terminate()
            process.wait(timeout=10)
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
