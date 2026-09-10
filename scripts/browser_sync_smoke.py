"""Exercise real media-clock synchronization, transport and playback rates."""
from __future__ import annotations

import base64
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
import websocket

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts" / "practice-redesign" / "sync-sequence"
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
URL = "http://localhost:5173/?syncDebug=1"

def command(socket, call_id, method, params=None):
    socket.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
    while True:
        message = json.loads(socket.recv())
        if message.get("id") == call_id:
            if message.get("result", {}).get("exceptionDetails"):
                raise RuntimeError(message["result"]["exceptionDetails"])
            return message.get("result", {})

def evaluate(socket, call_id, expression):
    return command(socket, call_id, "Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})["result"].get("value")

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="choir-sync-") as profile:
        process = subprocess.Popen([str(CHROME), "--headless=new", "--disable-gpu", "--autoplay-policy=no-user-gesture-required", "--remote-allow-origins=*", "--remote-debugging-port=0", f"--user-data-dir={profile}", URL], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(100):
                if port_file.exists(): break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(tab for tab in tabs if tab.get("type") == "page" and tab.get("url", "").startswith("http://localhost:5173/"))
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=15)
            try:
                command(socket, 1, "Page.enable")
                command(socket, 2, "Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
                time.sleep(.8)
                ready = evaluate(socket, 3, """(async()=>{const a=els.backingAudio;for(let i=0;i<50&&a.readyState<3;i++)await new Promise(r=>setTimeout(r,100));return {ready:a.readyState>=3,source:a.currentSrc,duration:a.duration,seekable:a.seekable.length?[a.seekable.start(0),a.seekable.end(0)]:[]}})()""")
                assert ready["ready"] and "gloria-backing-P3.mp3" in ready["source"]

                evaluate(socket, 4, "(async()=>{state.clock.seekPerformanceTime(2);state.clock.setSpeed(.75);await state.clock.play();requestAnimationFrame(render);return true})()")
                sequence = []
                for index, delay in enumerate((.35, .45, .55), start=1):
                    time.sleep(delay)
                    sample = evaluate(socket, 10 + index, """(()=>{const s=state.clock.snapshot();const t=state.runtime.targetAt(s.beat);return {wall:performance.now()/1000,media:s.mediaTime,performance:s.performanceTime,renderedNow:state.lastSnapshot?.performanceTime,beat:s.beat,target:t?.id,sourceEvent:t?.sourceEventId,scoreEvent:state.lastScoreEvent?.sourceEventId,scoreMeasure:state.lastScoreEvent?.measureNumber,scoreSegment:state.activeScoreSegment,scoreTransform:els.scoreSheet.style.transform,drift:s.performanceTime-s.mediaTime,rate:s.speed}})()""")
                    sequence.append(sample)
                    shot = command(socket, 20 + index, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                    (ARTIFACTS / f"sync-{index}.png").write_bytes(base64.b64decode(shot["data"]))
                evaluate(socket, 30, "state.clock.pause(); render(); true")

                scenarios = evaluate(socket, 31, """(async()=>{
                  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
                  const snap=label=>{render();const s=state.clock.snapshot();const t=state.runtime.targetAt(s.beat);return {label,media:s.mediaTime,performance:s.performanceTime,renderedNow:state.lastSnapshot.performanceTime,beat:s.beat,rate:s.speed,running:s.running,target:t?.sourceEventId,score:state.lastScoreEvent?.sourceEventId,scoreSegment:state.activeScoreSegment,drift:s.performanceTime-s.mediaTime};};
                  const out=[];
                  for(const rate of [1,.75,.5]){state.clock.pause();state.clock.seekPerformanceTime(0);state.clock.setSpeed(rate);await state.clock.play();requestAnimationFrame(render);await sleep(700);state.clock.pause();out.push(snap(`rate-${rate}`));}
                  state.clock.seekPerformanceTime(3.2);out.push(snap('seek-forward'));
                  state.clock.seekPerformanceTime(1.1);out.push(snap('seek-backward'));
                  const pausedBefore=state.clock.snapshot().performanceTime;await sleep(250);out.push({...snap('pause-freeze'),delta:state.clock.snapshot().performanceTime-pausedBefore});
                  state.clock.setSpeed(.5);out.push(snap('speed-paused'));
                  state.clock.setSpeed(1);await state.clock.play();requestAnimationFrame(render);await sleep(350);const beforeChange=state.clock.snapshot().performanceTime;state.clock.setSpeed(.5);await sleep(500);const afterChange=state.clock.snapshot().performanceTime;state.clock.pause();out.push({...snap('speed-playing'),deltaAfterChange:afterChange-beforeChange});
                  state.clock.seekPerformanceTime(10);render();document.querySelector('#previous-measure').click();out.push(snap('previous-measure'));
                  state.clock.seekPerformanceTime(10);render();document.querySelector('#next-measure').click();out.push({...snap('next-measure'),scoringStart:state.scoringStartBeat});
                  state.clock.seekPerformanceTime(2.3);render();out.push(snap('target-score-correspondence'));
                  return out;
                })()""")

                all_samples = sequence + scenarios
                assert max(abs(item["drift"]) for item in all_samples) < 1e-9
                assert max(abs(item["performance"] - item["renderedNow"]) for item in sequence) < .06
                assert len({item["scoreTransform"] for item in sequence}) == 1
                for rate in (1, .75, .5):
                    item = next(value for value in scenarios if value["label"] == f"rate-{rate}")
                    assert abs(item["performance"] - .7 * rate) < .14
                assert abs(next(item for item in scenarios if item["label"] == "pause-freeze")["delta"]) < .005
                assert next(item for item in scenarios if item["label"] == "speed-paused")["rate"] == .5
                speed_playing = next(item for item in scenarios if item["label"] == "speed-playing")
                assert .18 < speed_playing["deltaAfterChange"] < .34
                assert abs(next(item for item in scenarios if item["label"] == "seek-forward")["performance"] - 3.2) < .03
                assert abs(next(item for item in scenarios if item["label"] == "seek-backward")["performance"] - 1.1) < .03
                assert abs(next(item for item in scenarios if item["label"] == "previous-measure")["performance"] - 6) < .03
                next_measure = next(item for item in scenarios if item["label"] == "next-measure")
                assert abs(next_measure["performance"] - 10) < .03 and next_measure["scoringStart"] == 18
                assert next_measure["scoreSegment"] != sequence[0]["scoreSegment"]
                correspondence = next(item for item in scenarios if item["label"] == "target-score-correspondence")
                assert correspondence["target"] == correspondence["score"]

                evidence = {"engine": "HTMLAudioElement", "authority": "media.currentTime", "ready": ready, "sequence": sequence, "scenarios": scenarios, "maxCanonicalDriftSeconds": max(abs(item["drift"]) for item in all_samples)}
                (ARTIFACTS / "sync-evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
                print(json.dumps(evidence, ensure_ascii=False, indent=2))
            finally:
                socket.close()
        finally:
            process.terminate(); process.wait(timeout=5)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
