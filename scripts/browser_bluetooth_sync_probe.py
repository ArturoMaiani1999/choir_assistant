"""Audit visual timing with injected latency reports, without real Bluetooth.

Run against scripts/serve_frontend.py. No microphone capture or upload; the
media mixer is muted. Injected outputLatency values test whether the UI uses
the browser's latency report; they do not simulate a physical audio endpoint.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import struct
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

import websocket

from browser_practice_smoke import CHROME, command, evaluate

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "bluetooth-sync"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:5173/?piece=o-sacrum")
    parser.add_argument("--live-input", action="store_true", help="Use Chrome's synthetic 220 Hz microphone, never the physical microphone")
    parser.add_argument("--force-pitch-fallback", action="store_true", help="Exercise detector on main thread after opening synthetic input")
    parser.add_argument("--cpu-slowdown", type=float, default=1)
    parser.add_argument("--clock-step-ms", type=float, default=0, help="Quantize media clock reads to distinguish drawing FPS from movement FPS")
    parser.add_argument("--output", type=Path, default=OUT / "result.json")
    args = parser.parse_args()
    if args.force_pitch_fallback and not args.live_input:
        parser.error("--force-pitch-fallback requires --live-input")
    if args.cpu_slowdown < 1 or args.clock_step_ms < 0:
        parser.error("CPU slowdown must be >= 1 and clock step >= 0")
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="choir-bluetooth-sync-", ignore_cleanup_errors=True) as profile:
        flags = []
        if args.live_input:
            microphone = Path(profile) / "voice.wav"
            with wave.open(str(microphone), "wb") as wav:
                wav.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
                wav.writeframes(b"".join(struct.pack("<h", round(2200 * math.sin(2 * math.pi * 220 * i / 48000))) for i in range(48000 * 3)))
            flags = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
                     f"--use-file-for-fake-audio-capture={microphone}"]
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu",
            "--autoplay-policy=no-user-gesture-required", "--remote-allow-origins=*",
            "--remote-debugging-port=0", f"--user-data-dir={profile}", *flags, args.url,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        call_id = 0

        def cdp(method, params=None):
            nonlocal call_id
            call_id += 1
            return command(socket, call_id, method, params)

        def js(expression):
            nonlocal call_id
            call_id += 1
            return evaluate(socket, call_id, expression)

        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(100):
                try:
                    port = port_file.read_text().splitlines()[0]
                    break
                except (OSError, IndexError):
                    pass
                time.sleep(.05)
            else:
                raise RuntimeError('Chrome debugging port did not become ready')
            pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
            page = next(tab for tab in pages if tab.get("type") == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30)
            cdp("Page.enable")
            for _ in range(160):
                js("document.querySelector('#piece-picker-dialog[open] [data-preferred-voice=tenore]:not(:disabled)')?.click()")
                if js("typeof state!=='undefined' && Boolean(state.runtime && state.gridNavigation)"):
                    break
                time.sleep(.1)
            else:
                raise AssertionError("Practice did not initialize")

            js("""(async()=>{
              window.syncProbeErrors=[];
              addEventListener('error',e=>syncProbeErrors.push(e.message));
              addEventListener('unhandledrejection',e=>syncProbeErrors.push(String(e.reason)));
              els.metronomeVolume.value='0';updateMetronomeControl();
              state.playbackMixer.muteForCalibration(true);
              await state.playbackMixer.resume([els.backingAudio,...state.voiceStemAudio.values()]);
              await waitForMediaReady(els.backingAudio,3);
            })()""")
            reported = js("""(()=>{const c=state.playbackMixer.context;return {
              baseLatency:c.baseLatency,outputLatency:c.outputLatency,
              outputTimestampSupported:typeof c.getOutputTimestamp==='function',
              sampleRate:c.sampleRate,microphoneOpened:Boolean(state.microphoneStream)
            };})()""")
            assert not reported["microphoneOpened"], reported

            timing = js("""(()=>{
              const context=state.playbackMixer.context,rows=[];
              const original=Object.getOwnPropertyDescriptor(context,'outputLatency');
              try {
                for(const speed of [1,.8])for(const type of ['standard','bluetooth']) {
                  const control=type==='bluetooth'?els.settingsAudioOutputBluetooth:els.settingsAudioOutputStandard;
                  control.click();els.playbackSpeed.value=String(speed);
                  for(const injectedOutputMs of [0,150,300]) {
                    Object.defineProperty(context,'outputLatency',{configurable:true,get:()=>injectedOutputMs/1000});
                    const snapshot={performanceTime:10,speed,running:true};
                    const rollSeconds=state.runtime.secondsAtBeat(currentPianoRollBeat(snapshot));
                    const voiceSeconds=state.runtime.secondsAtBeat(visuallyAdvancedPitchBeat(state.runtime.beatAtSeconds(10)));
                    rows.push({speed,type,injectedOutputMs,reportedOutputMs:context.outputLatency*1000,
                      pianoRollDelayMs:state.pianoRollDelayMs,voiceAdvanceMs:state.plumeSettings.timeAdvanceMs,
                      rollSeconds,voiceSeconds,
                      effectiveRollDelayMs:(10-rollSeconds)/speed*1000,
                      effectiveVoiceAdvanceMs:(10-voiceSeconds)/speed*1000});
                  }
                }
              } finally {
                if(original)Object.defineProperty(context,'outputLatency',original);
                else delete context.outputLatency;
                els.playbackSpeed.value='1';els.settingsAudioOutputStandard.click();
              }
              return rows;
            })()""")
            # Characterize the current defect rather than treating this as a
            # permanent requirement: a future compensation should change it.
            for row in timing:
                assert abs(row["effectiveRollDelayMs"] - 270) < 1e-6, row
                expected = 320 if row["type"] == "bluetooth" else 270
                assert abs(row["effectiveVoiceAdvanceMs"] - expected) < 1e-6, row
                assert row["reportedOutputMs"] == row["injectedOutputMs"], row

            levels_before = js("({master:Number(els.volume.value),accompaniment:state.accompanimentLevel,channels:[...state.playbackMixer.channels].map(([media])=>({source:media.currentSrc,requestedGain:state.playbackMixer.levels.get(media)}))})")
            if args.live_input:
                js("""(async()=>{
                  if(echoCancellationUI.enabled())document.getElementById('echo-enabled').click();
                  await toggleMicrophone();
                  if(state.microphoneStatus!=='active')throw Error('Synthetic microphone did not start');
                  await new Promise(r=>setTimeout(r,500));
                })()""")
            if args.force_pitch_fallback:
                js("if(state.pitchWorker)failPitchWorker(state.pitchWorker);state.pitchWorkerDisabled=true;true")
            js("""(()=>{
              window.probeRenderCosts=[];window.probePitchCosts=[];window.probePitchAges=[];
              const draw=render,apply=applyPitchEstimate;
              render=function(...args){const t=performance.now();try{return draw(...args)}finally{probeRenderCosts.push(performance.now()-t)}};
              applyPitchEstimate=function(raw,beat,sampledAt,cost,...args){
                probePitchCosts.push(cost);probePitchAges.push(performance.now()-sampledAt);
                return apply(raw,beat,sampledAt,cost,...args);
              };
            })()""")
            if args.clock_step_ms:
                js("""(()=>{
                  const media=els.backingAudio;
                  const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
                  const step=STEP/1000;
                  Object.defineProperty(media,'currentTime',{configurable:true,
                    get(){return Math.floor(descriptor.get.call(this)/step)*step},
                    set(value){descriptor.set.call(this,value)}});
                })()""".replace("STEP", str(args.clock_step_ms)))
            cdp("Emulation.setCPUThrottlingRate", {"rate": args.cpu_slowdown})

            cadence = []
            for width, height in [(1366, 768), (390, 844)]:
                cdp("Emulation.setDeviceMetricsOverride", {
                    "width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 700,
                })
                for route in ["standard", "bluetooth"]:
                    result = js("""(async()=>{
                      const type=ROUTE,sleep=ms=>new Promise(r=>setTimeout(r,ms));
                      (type==='bluetooth'?els.settingsAudioOutputBluetooth:els.settingsAudioOutputStandard).click();
                      state.clock.pause();state.clock.setSpeed(1);queueAudioSeek(5);
                      await waitForMediaSeek(els.backingAudio);
                      await state.clock.play();render();
                      await sleep(300);
                      probeRenderCosts.length=0;probePitchCosts.length=0;probePitchAges.length=0;
                      const samples=[];
                      await new Promise(resolve=>{
                        const start=performance.now();
                        const tick=now=>{
                          const s=playbackSnapshot();
                          samples.push({wallMs:now,mediaSeconds:s.performanceTime,
                            rollSeconds:Math.max(0,(state.lastPianoRollTime??s.performanceTime)-state.pianoRollDelayMs/1000*s.speed),
                            renderedSeconds:state.lastSnapshot?.performanceTime});
                          if(now-start>=1800)resolve();else requestAnimationFrame(tick);
                        };requestAnimationFrame(tick);
                      });
                      state.clock.pause();render();
                      const gaps=samples.slice(1).map((s,i)=>s.wallMs-samples[i].wallMs).sort((a,b)=>a-b);
                      const backwardSteps=samples.slice(1).filter((s,i)=>s.rollSeconds+1e-6<samples[i].rollSeconds).length;
                      const moves=samples.slice(1).map((s,i)=>s.rollSeconds-samples[i].rollSeconds);
                      const duration=(samples.at(-1).wallMs-samples[0].wallMs)/1000;
                      const distribution=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return {
                        count:a.length,median:a[Math.floor(a.length/2)]??null,p95:a[Math.min(a.length-1,Math.floor(a.length*.95))]??null,max:a.at(-1)??null};};
                      return {viewport:[innerWidth,innerHeight],type,samples,
                        drawFps:(samples.length-1)/duration,movementFps:moves.filter(d=>d>1e-6).length/duration,
                        repeatedPositions:moves.filter(d=>Math.abs(d)<=1e-6).length,maxMovementStepMs:Math.max(...moves)*1000,
                        renderCostMs:distribution(probeRenderCosts),pitchCostMs:distribution(probePitchCosts),pitchResultAgeMs:distribution(probePitchAges),
                        workerDisabled:state.pitchWorkerDisabled,voicedSamples:state.pitchSamples.filter(p=>p.trackedPitch!=null).length,
                        levels:{master:Number(els.volume.value),accompaniment:state.accompanimentLevel,channels:[...state.playbackMixer.channels].map(([media])=>({source:media.currentSrc,requestedGain:state.playbackMixer.levels.get(media)}))},
                        medianFrameMs:gaps[Math.floor(gaps.length/2)],maxFrameMs:Math.max(...gaps),backwardSteps,
                        maxRenderAgeMs:Math.max(...samples.map(s=>Math.abs(s.mediaSeconds-s.renderedSeconds)*1000)),
                        maxVisualDelayErrorMs:Math.max(...samples.map(s=>Math.abs((s.mediaSeconds-s.rollSeconds)*1000-270))),
                        overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,
                        microphoneOpened:Boolean(state.microphoneStream)};
                    })()""".replace("ROUTE", json.dumps(route)))
                    assert len(result["samples"]) >= 10, result
                    assert result["backwardSteps"] == 0, result
                    assert result["maxVisualDelayErrorMs"] < 150, result
                    assert result["movementFps"] > result["drawFps"] * .9, result
                    assert result["maxMovementStepMs"] < 120, result
                    assert not result["overflow"] and result["microphoneOpened"] == args.live_input, result
                    assert result["levels"] == levels_before, result["levels"]
                    if args.live_input:
                        assert result["pitchCostMs"]["count"] > 0 and result["voicedSamples"] > 0, result
                    cadence.append(result)
            assert js("syncProbeErrors") == [], js("syncProbeErrors")
            evidence = {
                "scope": "Local source audit; latency reports injected, no Bluetooth endpoint or physical latency measurement",
                "runtime": reported, "timing": timing, "cadence": cadence,
                "syntheticInput": args.live_input,"forcedFallback":args.force_pitch_fallback,
                "cpuSlowdown":args.cpu_slowdown,"injectedClockStepMs":args.clock_step_ms,
                "trackSettings":js("state.microphoneStream?.getAudioTracks()[0]?.getSettings()??null"),
                "finding": "Output latency reports do not affect the 270 ms roll delay or fixed 270/320 ms voice correction",
            }
            if args.live_input:
                js("(async()=>{await stopMicrophone();return state.microphoneStatus})()")
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
            print(json.dumps({**evidence, "cadence": [{k: v for k, v in r.items() if k != "samples"} for r in cadence]}))
        finally:
            if socket is not None:
                socket.close()
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    main()
