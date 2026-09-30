"""Real Canvas/DPR Aurora acceptance and screenshot fixture; no server required."""
import base64
import argparse
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
    artifacts = ROOT / "artifacts" / "aurora"
    artifacts.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="choir-aurora-") as profile:
        audio_path = Path(profile) / "voice.wav"
        with wave.open(str(audio_path), "wb") as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(48000)
            audio.writeframes(b"".join(struct.pack("<h", int(9000*math.sin(2*math.pi*233.08188*i/48000))) for i in range(48000*12)))
        process = subprocess.Popen([str(CHROME), "--headless=new", "--remote-allow-origins=*",
                                    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
                                    f"--use-file-for-fake-audio-capture={audio_path}", "--autoplay-policy=no-user-gesture-required",
                                    "--remote-debugging-port=0", f"--user-data-dir={profile}",
                                    (ROOT / "scripts/aurora_render_fixture.html").as_uri()],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(100):
                if port_file.exists():
                    break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(p for p in pages if p["type"] == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30)
            try:
                time.sleep(.5)
                for width, dpr in [(1280, 1), (1280, 2), (720, 1)]:
                    command(socket, 1, "Emulation.setDeviceMetricsOverride", {"width": width, "height": 950,
                                                                            "deviceScaleFactor": dpr, "mobile": False})
                    result = command(socket, 2, "Runtime.evaluate", {"expression": "render();verifyAurora()", "returnByValue": True})
                    assert "exceptionDetails" not in result, result
                    metrics = result["result"]["value"]
                    print(json.dumps(metrics))
                    assert metrics["p95Ms"] < 70, metrics  # Diagnostic headless budget, not a device FPS claim.
                    screenshot = command(socket, 3, "Page.captureScreenshot", {"format": "png"})
                    (artifacts / f"aurora-{width}-{dpr}x.png").write_bytes(base64.b64decode(screenshot["data"]))
                if args.app_url:
                    command(socket, 4, "Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900,
                                                                             "deviceScaleFactor": 1, "mobile": False})
                    command(socket, 5, "Page.navigate", {"url": args.app_url + "/index.html?piece=o-sacrum"})
                    time.sleep(2)
                    expression = """(() => {
                      if (!state.runtime) throw Error('Practice did not load');
                      if(document.querySelector('#score-cursor span')) throw Error('The score cursor still has a text label');
                      document.querySelectorAll('dialog[open]').forEach(d=>d.close());
                      const beat=6, now=state.runtime.secondsAtBeat(beat);
                      const pitch=state.runtime.targetAt(beat)?.midiPitch || 62;
                      state.pitchSamples=Array.from({length:121},(_,i)=>{
                        const t=i*.025, transition=t<.65 ? -2.4+t/.65*2.4 : .16*Math.sin((t-.65)*23);
                        const signalLost=(i>=70&&i<=71)||(i>=91&&i<=102);
                        return {beat:state.runtime.beatAtSeconds(Math.max(0,now-3+t)),
                          displayPitch:signalLost?null:pitch+transition+(i===52?1.5:0),
                          confidence:signalLost?0:.9,takeId:state.pitchTakeId};
                      });
                      state.clock.seekBeat(beat); render();
                      const before=state.pitchSamples.length;
                      if(!fluidTrailRenderer.available)throw Error('WebGL2 fluid trail unavailable');
                      const times=[];for(let i=0;i<90;i++){const start=performance.now();drawPitchLane(beat);times.push(performance.now()-start);}
                      times.sort((a,b)=>a-b);
                      const gl=fluidTrailRenderer.gl,pixels=new Uint8Array(fluidTrailRenderer.canvas.width*fluidTrailRenderer.canvas.height*4);
                      gl.readPixels(0,0,fluidTrailRenderer.canvas.width,fluidTrailRenderer.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
                      let fluidPixels=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])fluidPixels++;
                      if(fluidPixels<100)throw Error('Fluid overlay is empty');
                      if(times[85]>20)throw Error('Fluid render p95 too slow: '+times[85]);
                      const originalFallback=ChoirFluidPitchTrail.drawFallback;let fallbackCalls=0;
                      ChoirFluidPitchTrail.drawFallback=(...args)=>{fallbackCalls++;return originalFallback(...args);};
                      fluidTrailRenderer.fluidEnabled=false;drawPitchLane(beat);fluidTrailRenderer.fluidEnabled=true;
                      ChoirFluidPitchTrail.drawFallback=originalFallback;
                      if(fallbackCalls!==1)throw Error('Canvas fallback was not selected');
                      if(state.pitchSamples.length!==before) throw Error('Renderer changed history');
                      const oldTake=state.pitchTakeId;seekToMeasure(0);
                      if(state.pitchTakeId===oldTake) throw Error('Seek failed to isolate take');
                      const settings=livePlumeSettings(0,false,100,0);
                      const visible=state.pitchSamples.filter(s=>s.takeId===state.pitchTakeId);
                      if(visible.length) throw Error('Old take leaks after seek');
                      state.gridInspect.active=true;state.gridInspect.viewBeat=beat;render();
                      return {historyPreserved:state.pitchSamples.length===before,seekIsolated:true,fluidPixels,fluidP95Ms:times[85],fallbackCalls,
                        review:livePlumeSettings(beat,true,100,0).mode,
                        timeUnit:settings.currentTime};
                    })()"""
                    result = command(socket, 6, "Runtime.evaluate", {"expression": expression, "returnByValue": True})
                    assert "exceptionDetails" not in result, result
                    print(json.dumps(result["result"]["value"]))
                    screenshot = command(socket, 7, "Page.captureScreenshot", {"format": "png"})
                    (artifacts / "practice-review.png").write_bytes(base64.b64decode(screenshot["data"]))
                    command(socket, 8, "Page.navigate", {"url": args.app_url + "/voice-lab.html"})
                    time.sleep(1)
                    expression = """(async () => {
                      document.querySelector('#lab-settings-close').click();
                      const original=ChoirFluidPitchTrail.Renderer.prototype.render;
                      window.fluidChecks={live:0,review:0,voiced:0,errors:[]};
                      window.addEventListener('error',e=>fluidChecks.errors.push(e.message));
                      ChoirFluidPitchTrail.Renderer.prototype.render=function(...args){
                        const settings=args[3];fluidChecks[settings.mode==='review'?'review':'live']++;fluidChecks.lastMode=settings.mode;
                        fluidChecks.voiced=Math.max(fluidChecks.voiced,args[0].filter(s=>Number.isFinite(s.displayPitch)&&s.confidence>=.3).length);
                        return original.apply(this,args);
                      };
                      document.querySelector('#lab-listen').click();
                      await new Promise(r=>setTimeout(r,8500));
                      const button=document.querySelector('#lab-listen');
                      fluidChecks.stopLabel=button.getAttribute('aria-label');fluidChecks.disabled=button.disabled;
                      if(fluidChecks.lastMode==='live') button.click();
                      await new Promise(r=>setTimeout(r,150));
                      fluidChecks.finalLabel=button.getAttribute('aria-label');fluidChecks.finalState=document.querySelector('#lab-state').textContent;
                      fluidChecks.webgl=Boolean(document.querySelector('#lab-fluid-layer').getContext('webgl2'));
                      if(fluidChecks.live<2||fluidChecks.review<1||fluidChecks.voiced<2||!fluidChecks.webgl)throw Error(JSON.stringify(fluidChecks));
                      return fluidChecks;
                    })()"""
                    result = command(socket, 9, "Runtime.evaluate", {"expression": expression, "awaitPromise": True, "returnByValue": True})
                    assert "exceptionDetails" not in result, result
                    print(json.dumps(result["result"]["value"]))
                    screenshot = command(socket, 10, "Page.captureScreenshot", {"format": "png"})
                    (artifacts / "lab-stopped.png").write_bytes(base64.b64decode(screenshot["data"]))
                    result = command(socket, 11, "Runtime.evaluate", {"expression": """(async () => {
                      document.querySelector('[data-activity="sing-interval"]').click();
                      const fluidRendersBefore=fluidChecks.live+fluidChecks.review;
                      const score=document.querySelector('#lab-score');
                      for(let i=0;i<50 && !score.naturalWidth;i++) await new Promise(r=>setTimeout(r,50));
                      if(!score.naturalWidth || !score.src.includes('/intervals/melodic-'))throw Error('Interval score missing: '+score.src);
                      if(score.naturalWidth/score.naturalHeight>12)throw Error('MuseScore measures are stretched too wide');
                      document.querySelector('#lab-listen').click();
                      for(let i=0;i<100 && document.querySelector('#lab-state').textContent!=='PREPARATI';i++)await new Promise(r=>setTimeout(r,50));
                      const countdown=document.querySelector('#lab-countdown').textContent;
                      if(!/^\\d \\/ 4$/.test(countdown))throw Error('Four-beat preparation missing: '+countdown);
                      if(fluidChecks.live+fluidChecks.review<=fluidRendersBefore)throw Error('Fluid ribbon not used by sung intervals');
                      return {score:score.src.split('/').at(-1),countdown,fluidRenders:fluidChecks.live+fluidChecks.review};
                    })()""", "awaitPromise": True, "returnByValue": True})
                    assert "exceptionDetails" not in result, result
                    print(json.dumps(result["result"]["value"]))
                    screenshot = command(socket, 12, "Page.captureScreenshot", {"format": "png"})
                    (artifacts / "interval-count-in.png").write_bytes(base64.b64decode(screenshot["data"]))
                    result = command(socket, 13, "Runtime.evaluate", {"expression": """(async () => {
                      await new Promise(r=>setTimeout(r,5300));
                      const stage=document.querySelector('#lab-state').textContent;
                      if(!stage.includes('SECONDA NOTA'))throw Error('Second sung bar did not begin: '+stage);
                      return {stage};
                    })()""", "awaitPromise": True, "returnByValue": True})
                    assert "exceptionDetails" not in result, result
                    print(json.dumps(result["result"]["value"]))
                    screenshot = command(socket, 14, "Page.captureScreenshot", {"format": "png"})
                    (artifacts / "interval-second-bar.png").write_bytes(base64.b64decode(screenshot["data"]))
                    command(socket, 15, "Runtime.evaluate", {"expression": "document.querySelector('#lab-listen').click()"})
            finally:
                socket.close()
        finally:
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    main()
