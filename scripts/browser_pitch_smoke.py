"""Headless smoke test for the rehearsal pitch-feedback states."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket


CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
URL = "http://localhost:5173/"


def evaluate(socket: websocket.WebSocket, call_id: int, expression: str):
    socket.send(json.dumps({
        "id": call_id,
        "method": "Runtime.evaluate",
        "params": {"expression": expression, "returnByValue": True, "awaitPromise": True},
    }))
    while True:
        message = json.loads(socket.recv())
        if message.get("id") == call_id:
            return message["result"]["result"].get("value")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="choir-browser-") as profile:
        process = subprocess.Popen(
            [
                str(CHROME),
                "--headless=new",
                "--disable-gpu",
                "--remote-allow-origins=*",
                "--remote-debugging-port=0",
                f"--user-data-dir={profile}",
                URL,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(80):
                if port_file.exists():
                    break
                time.sleep(0.05)
            port = port_file.read_text(encoding="utf-8").splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(tab for tab in tabs if tab.get("type") == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=5)
            try:
                time.sleep(0.7)
                cursor = evaluate(socket, 10, """
                  (async () => {
                    document.querySelector('[data-score-view="part"]').click();
                    await new Promise(resolve => setTimeout(resolve, 250));
                    const element = document.querySelector('.target-note-cursor:not([hidden])');
                    return {visible: Boolean(element), left: element?.style.left || ''};
                  })()
                """)
                high = evaluate(socket, 1, """
                  renderEstimate({hz: 880, rms: 0.08, clarity: 0.95, confidence: 0.95}, performance.now());
                  ({frequency: document.querySelector('#voice-frequency').textContent,
                    advice: document.querySelector('#pitch-state').textContent,
                    alert: document.querySelector('#range-alert').textContent,
                    alertHidden: document.querySelector('#range-alert').hidden})
                """)
                rest = evaluate(socket, 2, """
                  activeRuntimeTarget = null;
                  renderEstimate({hz: 220, rms: 0.08, clarity: 0.9, confidence: 0.9}, performance.now());
                  ({advice: document.querySelector('#pitch-state').textContent,
                    cents: document.querySelector('#cents').textContent})
                """)
                low = evaluate(socket, 3, """
                  activeRuntimeTarget = scoreRuntime.targetAt(0);
                  renderEstimate({hz: 100, rms: 0.08, clarity: 0.9, confidence: 0.9}, performance.now());
                  ({frequency: document.querySelector('#voice-frequency').textContent,
                    advice: document.querySelector('#pitch-state').textContent,
                    alertHidden: document.querySelector('#range-alert').hidden,
                    scale: document.querySelector('#plot-range').textContent})
                """)
                silence = evaluate(socket, 4, """
                  renderEstimate({hz: null, rms: 0.001, clarity: 0, confidence: 0}, performance.now());
                  ({frequency: document.querySelector('#voice-frequency').textContent,
                    state: document.querySelector('#voice-range-state').textContent,
                    alertHidden: document.querySelector('#range-alert').hidden})
                """)
                interruption = evaluate(socket, 5, """
                  sessionState = 'running';
                  performanceClock.start(performance.now());
                  interruptSession('Prova sospesa', 'Test interruzione');
                  ({state: sessionState,
                    alertHidden: document.querySelector('#session-alert').hidden,
                    title: document.querySelector('#session-alert-title').textContent})
                """)
                assert high["frequency"] == "880,0 Hz"
                assert cursor["visible"] is True
                assert cursor["left"]
                assert "verifica l’ottava" in high["advice"]
                assert high["alertHidden"] is False
                assert rest["cents"] == "—"
                assert "non c’è una nota" in rest["advice"]
                assert low["frequency"] == "100,0 Hz"
                assert "verifica l’ottava" in low["advice"]
                assert low["alertHidden"] is False
                assert silence["frequency"] == "—"
                assert silence["alertHidden"] is True
                assert interruption == {"state": "interrupted", "alertHidden": False, "title": "Prova sospesa"}
                print(json.dumps({
                    "high_voice": high,
                    "score_cursor": cursor,
                    "target_rest": rest,
                    "low_voice": low,
                    "silence": silence,
                    "interruption": interruption,
                }, ensure_ascii=False, indent=2))
            finally:
                socket.close()
        finally:
            process.terminate()
            process.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
