"""Real Canvas/DPR Aurora acceptance plus the current Voice Lab integration."""
import argparse
import base64
import json
import math
import struct
import subprocess
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

import websocket
from browser_voice_lab_smoke import command

ROOT = Path(__file__).resolve().parents[1]
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-url", help="Optional running frontend, e.g. http://127.0.0.1:5188")
    args = parser.parse_args()
    artifacts = ROOT / "artifacts" / "aurora"; artifacts.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="choir-aurora-") as profile:
        audio_path = Path(profile) / "voice.wav"
        with wave.open(str(audio_path), "wb") as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(48_000)
            audio.writeframes(b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * 174.614 * i / 48_000)))
                                       for i in range(48_000 * 20)))
        process = subprocess.Popen([str(CHROME), "--headless=new", "--remote-allow-origins=*",
                                    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
                                    f"--use-file-for-fake-audio-capture={audio_path}", "--autoplay-policy=no-user-gesture-required",
                                    "--remote-debugging-port=0", f"--user-data-dir={profile}",
                                    (ROOT / "scripts/aurora_render_fixture.html").as_uri()],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(100):
                if port_file.exists(): break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            socket = websocket.create_connection(next(page for page in pages if page["type"] == "page")["webSocketDebuggerUrl"], timeout=40)
            try:
                time.sleep(.5)
                for width, dpr in [(1280, 1), (1280, 2), (720, 1)]:
                    command(socket, 1, "Emulation.setDeviceMetricsOverride", {"width": width, "height": 950,
                                                                            "deviceScaleFactor": dpr, "mobile": False})
                    result = command(socket, 2, "Runtime.evaluate", {"expression": "render();verifyAurora()", "returnByValue": True})
                    assert "exceptionDetails" not in result, result
                    metrics = result["result"]["value"]; print(json.dumps(metrics))
                    assert metrics["p95Ms"] < 70, metrics
                    screenshot = command(socket, 3, "Page.captureScreenshot", {"format": "png"})
                    (artifacts / f"aurora-{width}-{dpr}x.png").write_bytes(base64.b64decode(screenshot["data"]))
                if args.app_url:
                    command(socket, 4, "Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900,
                                                                             "deviceScaleFactor": 1, "mobile": False})
                    command(socket, 5, "Page.navigate", {"url": args.app_url + "/voice-lab.html"}); time.sleep(1)
                    expression = """(async () => {
                      document.querySelector('#lab-settings-close')?.click();
                      const original=ChoirFluidPitchTrail.Renderer.prototype.render;
                      window.fluidChecks={live:0,review:0,voiced:0,errors:[]};
                      window.addEventListener('error',event=>fluidChecks.errors.push(event.message));
                      ChoirFluidPitchTrail.Renderer.prototype.render=function(...args){
                        const settings=args[3];fluidChecks[settings.mode==='review'?'review':'live']++;
                        fluidChecks.voiced=Math.max(fluidChecks.voiced,args[0].filter(sample=>Number.isFinite(sample.displayPitch)&&sample.confidence>=.3).length);
                        return original.apply(this,args);
                      };
                      document.querySelector('[data-bpm="100"]').click();
                      document.querySelector('#warmup-start').click();
                      for(let i=0;i<280&&document.querySelector('#warmup-feedback').hidden;i++)await new Promise(resolve=>setTimeout(resolve,50));
                      fluidChecks.feedback=!document.querySelector('#warmup-feedback').hidden;
                      fluidChecks.webgl=Boolean(document.querySelector('#lab-fluid-layer').getContext('webgl2'));
                      fluidChecks.finalState=document.querySelector('#lab-state').textContent;
                      if(fluidChecks.live<2||fluidChecks.review<1||fluidChecks.voiced<2||!fluidChecks.webgl||!fluidChecks.feedback)
                        throw Error(JSON.stringify(fluidChecks));
                      return fluidChecks;
                    })()"""
                    result = command(socket, 6, "Runtime.evaluate", {"expression": expression, "awaitPromise": True, "returnByValue": True})
                    assert "exceptionDetails" not in result, result
                    print(json.dumps(result["result"]["value"]))
                    screenshot = command(socket, 7, "Page.captureScreenshot", {"format": "png"})
                    (artifacts / "voice-lab-review.png").write_bytes(base64.b64decode(screenshot["data"]))
            finally:
                socket.close()
        finally:
            process.terminate(); process.wait(timeout=5)


if __name__ == "__main__":
    main()
