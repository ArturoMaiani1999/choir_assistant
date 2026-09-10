"""Viewport and interaction smoke test for the Practice redesign."""
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
ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts" / "practice-redesign"
VIEWPORTS = [(1440, 900), (1920, 1080), (1366, 768), (844, 390), (932, 430), (390, 844)]


def command(socket, call_id, method, params=None):
    socket.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
    while True:
        message = json.loads(socket.recv())
        if message.get("id") == call_id:
            if message.get("result", {}).get("exceptionDetails"):
                raise RuntimeError(message["result"]["exceptionDetails"])
            return message.get("result", {})


def evaluate(socket, call_id, expression):
    result = command(socket, call_id, "Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
    return result["result"].get("value")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="choir-practice-") as profile:
        process = subprocess.Popen([str(CHROME), "--headless=new", "--disable-gpu", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--remote-allow-origins=*", "--remote-debugging-port=0", f"--user-data-dir={profile}", URL], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(100):
                if port_file.exists(): break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(tab for tab in tabs if tab.get("type") == "page" and tab.get("url", "").startswith(URL))
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10)
            try:
                command(socket, 1, "Page.enable")
                time.sleep(.8)
                results = []
                call_id = 10
                for width, height in VIEWPORTS:
                    command(socket, call_id, "Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 1000}); call_id += 1
                    time.sleep(.25)
                    metrics = evaluate(socket, call_id, """({
                      viewport: [innerWidth, innerHeight],
                      scrollHeight: document.documentElement.scrollHeight,
                      bodyScrollHeight: document.body.scrollHeight,
                      scoreHeight: document.querySelector('.score-region').getBoundingClientRect().height,
                      pitchHeight: document.querySelector('.pitch-region').getBoundingClientRect().height,
                      transportBottom: document.querySelector('.practice-transport').getBoundingClientRect().bottom,
                      nowRatio: (() => { const c=document.querySelector('#pitch-lane'); return 4.5/(4.5+7.5); })(),
                      portraitHint: getComputedStyle(document.querySelector('.orientation-hint')).display,
                      part: document.querySelector('#part-selector').value,
                      cursorLeft: document.querySelector('#score-cursor').style.left,
                      publicationStatus: state.bundleManifest?.publication_status,
                      playbackDisabled: document.querySelector('#toggle-playback').disabled,
                      audioSrc: document.querySelector('#backing-audio').getAttribute('src'),
                      microphoneControl: Boolean(document.querySelector('#microphone')),
                      metronomeControl: Boolean(document.querySelector('#metronome-toggle') && document.querySelector('#metronome-volume')),
                      fabricatedLyrics: state.runtime.targetEvents.filter(event => ['lu','ce','can','ta'].includes(event.lyric)).length,
                      missingProvenance: state.runtime.targetEvents.filter(event => !event.sourceEventId).length
                    })"""); call_id += 1
                    assert metrics["scrollHeight"] == height and metrics["bodyScrollHeight"] == height
                    assert metrics["scoreHeight"] > 90 and metrics["pitchHeight"] > 80, metrics
                    assert abs(metrics["transportBottom"] - height) < 1
                    assert metrics["cursorLeft"] and metrics["part"]
                    assert metrics["publicationStatus"] == "pending_review"
                    assert metrics["playbackDisabled"] is True and metrics["audioSrc"] is None
                    assert metrics["fabricatedLyrics"] == 0 and metrics["missingProvenance"] == 0
                    assert metrics["microphoneControl"] is True
                    assert metrics["metronomeControl"] is True
                    if width < height: assert metrics["portraitHint"] == "flex"
                    else: assert metrics["portraitHint"] == "none"
                    screenshot = command(socket, call_id, "Page.captureScreenshot", {"format": "png", "fromSurface": True}); call_id += 1
                    import base64
                    (ARTIFACTS / f"practice-{width}x{height}.png").write_bytes(base64.b64decode(screenshot["data"]))
                    results.append(metrics)

                interaction = evaluate(socket, call_id, """(async () => {
                  const before = state.clock.snapshot(performance.now()).beat;
                  document.querySelector('#metronome-toggle').click();
                  const metronome = {volume: document.querySelector('#metronome-volume').value, pressed: document.querySelector('#metronome-toggle').getAttribute('aria-pressed')};
                  const cursorBefore = document.querySelector('#score-cursor').style.left;
                  document.querySelector('#toggle-playback').click();
                  const after = state.clock.snapshot(performance.now()).beat;
                  const pureMath = {
                    a4: PracticeMath.hzToPitch(440),
                    octave: PracticeMath.hzToPitch(880) - PracticeMath.hzToPitch(440),
                    cents: PracticeMath.centsBetween(440 * Math.pow(2, 20 / 1200), 440),
                    nowX: PracticeMath.timeToX(12, 12, 50, 1250, 4.5, 7.5),
                    smoothMin: PracticeMath.smoothPitchBounds({min:50,max:60},{min:60,max:70},90,180).bounds.min
                  };
                  const synthetic = new Float32Array(4096);
                  for (let i=0;i<synthetic.length;i++) synthetic[i]=.08*Math.sin(2*Math.PI*220*i/48000);
                  const detectedPitch = ChoirPitch.detectPitch(synthetic, 48000);
                  document.querySelector('#next-measure').click();
                  const cursorAfter = document.querySelector('#score-cursor').style.left;
                  const geometryPairs = state.runtime.targetEvents.slice(1).map((event, index) => {
                    const previous = state.runtime.targetEvents[index];
                    const a = state.scoreGeometry.get(previous.sourceEventId);
                    const b = state.scoreGeometry.get(event.sourceEventId);
                    return {a, b};
                  });
                  const backwardsInsideSystem = geometryPairs.filter(({a,b}) => a && b && a.systemId === b.systemId && b.x_percent < a.x_percent).length;
                  return {before, after, running: state.clock.running, scoringStart: state.scoringStartBeat, metronome,
                    scoreLabel: document.querySelector('#score-measure-label').textContent, backwardsInsideSystem,
                    canvasWidth: document.querySelector('#pitch-lane').width, cursorBefore, cursorAfter, pureMath, detectedPitch};
                })()""")
                assert interaction["after"] == interaction["before"]
                assert interaction["running"] is False and interaction["scoringStart"] > 0
                assert interaction["canvasWidth"] > 0
                assert interaction["metronome"] == {"volume": "34", "pressed": "true"}
                assert interaction["backwardsInsideSystem"] == 0
                assert abs(interaction["pureMath"]["a4"] - 69) < 1e-9
                assert abs(interaction["pureMath"]["octave"] - 12) < 1e-9
                assert abs(interaction["pureMath"]["cents"] - 20) < 1e-8
                assert interaction["pureMath"]["nowX"] == 500
                assert 50 < interaction["pureMath"]["smoothMin"] < 60
                assert abs(interaction["detectedPitch"]["hz"] - 220) < 1
                assert interaction["detectedPitch"]["clarity"] > .9
                microphone = evaluate(socket, call_id + 1, "(async()=>{await toggleMicrophone(); const active={status:state.microphoneStatus, pressed:document.querySelector('#microphone').getAttribute('aria-pressed'), analyser:Boolean(state.microphoneAnalyser)}; await stopMicrophone(); return active;})()")
                assert microphone == {"status": "active", "pressed": "true", "analyser": True}
                command(socket, call_id + 1, "Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
                evaluate(socket, call_id + 2, "document.querySelector('#next-measure').click()")
                time.sleep(.2)
                running_shot = command(socket, call_id + 4, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ARTIFACTS / "practice-1440x900-trajectory.png").write_bytes(base64.b64decode(running_shot["data"]))
                print(json.dumps({"viewports": results, "interaction": interaction}, ensure_ascii=False, indent=2))
            finally:
                socket.close()
        finally:
            process.terminate(); process.wait(timeout=5)
    return 0


if __name__ == "__main__": raise SystemExit(main())
