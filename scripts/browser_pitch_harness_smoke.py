"""Browser-level contract test for the dev/test pitch hooks.

The repository has no Playwright dependency, so this follows the existing smoke
suite and drives Chrome through CDP. It exercises the same page/runtime boundary.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
URL = "http://127.0.0.1:5173/?pitchTestHooks=1"


def command(socket, call_id, method, params=None):
    socket.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
    while True:
        message = json.loads(socket.recv())
        if message.get("id") == call_id:
            details = message.get("result", {}).get("exceptionDetails")
            if details:
                raise RuntimeError(details)
            return message.get("result", {})


def evaluate(socket, call_id, expression):
    result = command(socket, call_id, "Runtime.evaluate", {
        "expression": expression, "returnByValue": True, "awaitPromise": True,
    })
    return result["result"].get("value")


def main():
    with tempfile.TemporaryDirectory(prefix="choir-pitch-hooks-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            "--remote-debugging-port=0", f"--user-data-dir={profile}", URL,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(120):
                if port_file.exists():
                    break
                time.sleep(.05)
            port = port_file.read_text(encoding="utf-8").splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(tab for tab in tabs if tab.get("type") == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30)
            try:
                command(socket, 1, "Runtime.enable")
                for _ in range(80):
                    ready = evaluate(socket, 2, "Boolean(window.__pitchTestHooks && window.ChoirPitchTest)")
                    if ready:
                        break
                    time.sleep(.1)
                assert ready, "pitch test hooks not installed"
                report = evaluate(socket, 3, """(() => {
                  const f = ChoirPitchTest.fixtures;
                  const cases = [
                    f.steadyTone(),
                    f.stepChange({toHz: 246.9416506}),
                    f.stepChange({toHz: 329.6275569}),
                    f.stepChange({toHz: 440}),
                    f.vibratoTone(),
                    f.harmonicRichTone(),
                    f.silenceGap()
                  ];
                  return cases.map(item => {
                    const id = __pitchTestHooks.loadSyntheticTake(item.pcm, item.sampleRate, item.groundTruth, item.metadata);
                    const result = __pitchTestHooks.runAlgorithm(id, 'v1', {hopMs: 40});
                    const filtered = __pitchTestHooks.runAlgorithm(id, 'v1 + display-filter', {hopMs: 40});
                    return {name: item.name, frames: result.trackedPitch.length,
                      aligned: result.trackedPitch.length === result.displayPitch.length
                        && result.trackedPitch.length === result.confirmationStates.length
                        && result.trackedPitch.length === result.rawCandidates.length,
                      passthrough: JSON.stringify(result.trackedPitch) === JSON.stringify(result.displayPitch),
                      scoringUnchanged: JSON.stringify(result.trackedPitch) === JSON.stringify(filtered.trackedPitch),
                      metrics: __pitchTestHooks.getMetrics(id, 'v1')};
                  });
                })()""")
                assert len(report) == 7
                assert all(item["frames"] > 0 and item["aligned"] and item["passthrough"] and item["scoringUnchanged"] for item in report), report
                assert all("jitterCents" in item["metrics"] and "octaveErrorRate" in item["metrics"] for item in report)
                confirmation = evaluate(socket, 4, """[200, 700, 1200].map(cents => {
                  const item = ChoirPitchTest.fixtures.stepChange({fromHz: 220, toHz: 220 * 2 ** (cents / 1200)});
                  const id = __pitchTestHooks.loadSyntheticTake(item.pcm, item.sampleRate, item.groundTruth, item.metadata);
                  const result = __pitchTestHooks.runAlgorithm(id, 'v1', {frameSize: 1024});
                  return {cents, provisional: result.confirmationStates.filter(frame => frame.state === 'provisional').length};
                })""")
                expected = {200: 0, 700: 2, 1200: 4}
                assert all(abs(item["provisional"] - expected[item["cents"]]) <= 1 for item in confirmation), confirmation
                print(json.dumps({"fixtures": report, "confirmationPolicy": confirmation}, ensure_ascii=False, indent=2))
            finally:
                socket.close()
        finally:
            process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    main()
