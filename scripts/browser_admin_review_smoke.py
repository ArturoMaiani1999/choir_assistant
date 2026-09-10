"""Exercise hash-bound admin approval and the resulting Practice unlock."""

from __future__ import annotations

import base64
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

ROOT = Path(__file__).resolve().parents[1]
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
BASE = "http://localhost:5173/"
ARTIFACTS = ROOT / "artifacts" / "admin-review"


def command(socket, call_id, method, params=None):
    socket.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
    while True:
        message = json.loads(socket.recv())
        if message.get("id") == call_id:
            return message.get("result", {})


def evaluate(socket, call_id, expression):
    result = command(socket, call_id, "Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
    if result.get("exceptionDetails"):
        raise RuntimeError(result["exceptionDetails"])
    return result["result"].get("value")


def main() -> int:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="choir-admin-") as profile:
        process = subprocess.Popen([str(CHROME), "--headless=new", "--disable-gpu", "--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--remote-allow-origins=*", "--remote-debugging-port=0", f"--user-data-dir={profile}", BASE + "admin-review.html"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(100):
                if port_file.exists(): break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            page = next(tab for tab in json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json")) if tab.get("type") == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10)
            try:
                command(socket, 1, "Page.enable")
                time.sleep(1)
                before = evaluate(socket, 2, "({title:document.querySelector('#title')?.textContent, comparisons:document.querySelectorAll('.comparison').length, checks:document.querySelectorAll('[name=review-check]').length, status:document.querySelector('#status-badge')?.textContent, audio:document.querySelector('#review-audio')?.getAttribute('src'), download:Boolean(document.querySelector('#download-mscz')), importer:Boolean(document.querySelector('#mscz-file'))})")
                assert before["comparisons"] == 1 and before["checks"] == 5
                assert before["status"] == "PENDING REVIEW" and before["audio"]
                assert before["download"] and before["importer"]
                shot = command(socket, 3, "Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
                (ARTIFACTS / "pending-review.png").write_bytes(base64.b64decode(shot["data"]))
                approved = evaluate(socket, 4, """(() => { document.querySelectorAll('[name=review-check]').forEach(item => item.checked=true); document.querySelector('#reviewer').value='Automated smoke reviewer'; document.querySelector('#approval-form').requestSubmit(); return {status:document.querySelector('#status-badge').textContent, records:Object.keys(localStorage).filter(key=>key.startsWith('choir-approval:')).length}; })()""")
                assert approved == {"status": "LOCALLY APPROVED", "records": 1}
                command(socket, 5, "Page.navigate", {"url": BASE})
                time.sleep(1.2)
                practice = evaluate(socket, 6, "({approved:state.bundleApproved, disabled:document.querySelector('#toggle-playback').disabled, audio:document.querySelector('#backing-audio').getAttribute('src'), status:document.querySelector('#asset-status').textContent})")
                assert practice["approved"] is True and practice["disabled"] is False and practice["audio"]
                microphone = evaluate(socket, 7, "(async()=>{await toggleMicrophone(); return state.microphoneStatus;})()")
                assert microphone == "active"
                playback = evaluate(socket, 8, """(async()=>{document.querySelector('#toggle-playback').click(); for(let i=0;i<40&&!state.clock.running;i++) await new Promise(r=>setTimeout(r,50)); await new Promise(r=>setTimeout(r,700)); const snapshot=state.clock.snapshot(); document.querySelector('#toggle-playback').click(); await stopMicrophone(); return snapshot;})()""")
                assert playback["running"] is True and playback["beat"] > 0
                shot = command(socket, 9, "Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
                (ARTIFACTS / "approved-practice.png").write_bytes(base64.b64decode(shot["data"]))
                print(json.dumps({"review": before, "approval": approved, "practice": practice, "playback": playback}, ensure_ascii=False, indent=2))
            finally:
                socket.close()
        finally:
            process.terminate()
            process.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
