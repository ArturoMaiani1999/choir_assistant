"""Real mouse/touch, anchored zoom, note audio and viewport regression smoke."""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

from browser_practice_smoke import CHROME, command, evaluate

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts" / "piano-roll"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5173/?piece=o-sacrum")
    args = parser.parse_args()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="choir-roll-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--autoplay-policy=no-user-gesture-required", "--remote-allow-origins=*",
            "--remote-debugging-port=0", f"--user-data-dir={profile}", args.url,
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

        def mouse(kind, x, y, **extra):
            return cdp("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, **extra})

        def click(x, y):
            mouse("mousePressed", x, y, button="left", clickCount=1)
            mouse("mouseReleased", x, y, button="left", clickCount=1)

        def snapshot(name):
            data = cdp("Page.captureScreenshot", {"format": "png", "fromSurface": True})
            (ARTIFACTS / f"{name}.png").write_bytes(base64.b64decode(data["data"]))

        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(100):
                if port_file.exists():
                    break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
            page = next(tab for tab in tabs if tab.get("type") == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=25)
            cdp("Page.enable")
            cdp("Page.addScriptToEvaluateOnNewDocument", {"source": """
              window.rollErrors=[]; window.rollSounds=[]; window.rollEnded=0;
              addEventListener('error', e=>rollErrors.push(e.message));
              addEventListener('unhandledrejection', e=>rollErrors.push(String(e.reason?.stack||e.reason)));
              const setValue=AudioParam.prototype.setValueAtTime;
              AudioParam.prototype.setValueAtTime=function(value,...args){this.rollScheduledValue=value;return setValue.call(this,value,...args);};
              const start=OscillatorNode.prototype.start;
              OscillatorNode.prototype.start=function(...args){
                rollSounds.push({frequency:this.frequency.rollScheduledValue??this.frequency.value,type:this.type});
                this.addEventListener('ended',()=>rollEnded++);
                return start.apply(this,args);
              };
            """})
            cdp("Page.reload")
            for _ in range(160):
                js("document.querySelector('#piece-picker-dialog[open] [data-preferred-voice=tenore]:not(:disabled)')?.click()")
                if js("typeof state!=='undefined' && Boolean(state.runtime && state.gridNavigation)"):
                    break
                time.sleep(.1)
            else:
                raise AssertionError(js("({errors:rollErrors,loading:document.querySelector('#score-loading')?.textContent})"))
            results = []
            for width, height in [(1366, 768), (390, 844)]:
                cdp("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 700})
                cdp("Emulation.setTouchEmulationEnabled", {"enabled": width < 700})
                time.sleep(.2)
                js("""(async()=>{const beat=state.runtime.targetEvents[0].onsetBeat+.5;
                  queueAudioSeek(state.runtime.secondsAtBeat(beat));
                  for(let n=0;n<100&&Math.abs(playbackSnapshot().beat-beat)>.01;n++)await new Promise(resolve=>setTimeout(resolve,25));
                  if(Math.abs(playbackSnapshot().beat-beat)>.01)throw Error('Practice seek did not settle');
                  state.pitchViewport=null;state.gridNavigation.reset();render();})()""")
                snapshot(f"practice-{width}x{height}")
                bounds = js("""(()=>{const r=els.pitchLane.getBoundingClientRect();return {x:r.left+r.width*.65,y:r.top+r.height*.5,top:r.top,bottom:r.bottom,
                  overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,
                  beat:playbackSnapshot().beat,checkpoint:state.resumeCheckpointBeat};})()""")
                assert not bounds["overflow"], bounds
                # Independent axes, anchored at the actual pointer position.
                anchored = js("""(()=>{const c=els.pitchLane,r=c.getBoundingClientRect();
                  const before=state.gridGeometry, x=before.plot.left+(before.plot.right-before.plot.left)*.72,
                    y=before.plot.top+(before.plot.bottom-before.plot.top)*.4;
                  const rx=(Math.round(r.left+x)-r.left-before.plot.left)/(before.plot.right-before.plot.left),
                    ry=(Math.round(r.top+y)-r.top-before.plot.top)/(before.plot.bottom-before.plot.top);
                  const beat=before.viewStart+rx*(before.viewEnd-before.viewStart);
                  c.dispatchEvent(new WheelEvent('wheel',{clientX:r.left+x,clientY:r.top+y,deltaY:-100,cancelable:true}));
                  const after=state.gridGeometry;
                  const drift=Math.abs(beat-(after.viewStart+rx*(after.viewEnd-after.viewStart)));
                  const timeZoom=state.gridInspect.timeZoom,pitchZoom=state.gridInspect.pitchZoom;
                  const pitch=after.bounds.max-ry*(after.bounds.max-after.bounds.min);
                  c.dispatchEvent(new WheelEvent('wheel',{clientX:r.left+x,clientY:r.top+y,deltaY:-100,shiftKey:true,cancelable:true}));
                  const next=state.gridGeometry;
                  return {drift,pitchDrift:Math.abs(pitch-(next.bounds.max-ry*(next.bounds.max-next.bounds.min))),timeZoom,pitchZoom,
                    finalTime:state.gridInspect.timeZoom,finalPitch:state.gridInspect.pitchZoom};})()""")
                assert anchored["drift"] < .001 and anchored["pitchDrift"] < .001, anchored
                assert anchored["timeZoom"] > 1 and anchored["pitchZoom"] == 1, anchored
                assert anchored["finalTime"] == anchored["timeZoom"] and anchored["finalPitch"] > 1, anchored
                x, y = bounds["x"], bounds["y"]
                before = js("({beat:state.gridInspect.viewBeat,offset:state.gridInspect.pitchOffset,sounds:rollSounds.length})")
                mouse("mousePressed", x, y, button="left", clickCount=1)
                mouse("mouseMoved", x-70, y+50, button="left", buttons=1)
                mouse("mouseReleased", x-70, y+50, button="left", clickCount=1)
                after = js("({beat:state.gridInspect.viewBeat,offset:state.gridInspect.pitchOffset,sounds:rollSounds.length})")
                assert after["beat"] > before["beat"] and after["offset"] > before["offset"], (before, after)
                assert after["sounds"] == before["sounds"], (before, after)
                # A real tap sounds exactly one transposed reference note.
                note = js("""(()=>{state.gridNavigation.reset();state.transpose=2;render();const g=state.gridGeometry,r=els.pitchLane.getBoundingClientRect();
                  const note=state.runtime.targetEvents.find(n=>n.onsetBeat<g.viewEnd&&n.onsetBeat+n.durationBeats>g.viewStart);
                  return {x:r.left+g.xAtBeat((Math.max(g.viewStart,note.onsetBeat)+Math.min(g.viewEnd,note.onsetBeat+note.durationBeats))/2),y:r.top+g.yAtPitch(note.midiPitch+2),pitch:note.midiPitch+2};})()""")
                if width < 700:
                    cdp("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": note["x"], "y": note["y"], "id": 1}]})
                    cdp("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
                else:
                    click(note["x"], note["y"])
                audio = js("({sounds:rollSounds,beat:playbackSnapshot().beat,checkpoint:state.resumeCheckpointBeat,mic:state.microphoneStatus,running:state.clock.running})")
                assert len(audio["sounds"]) == before["sounds"] + 1, audio
                assert abs(audio["sounds"][-1]["frequency"] - 440 * 2 ** ((note["pitch"]-69)/12)) < .01, audio
                assert audio["beat"] == bounds["beat"] and audio["checkpoint"] == bounds["checkpoint"] and not audio["running"] and audio["mic"] != "active", audio
                # Pinch changes both axes and must suppress note playback.
                if width < 700:
                    before_pinch = js("({zoom:state.gridInspect.timeZoom,pitch:state.gridInspect.pitchZoom,sounds:rollSounds.length})")
                    def touch(kind, coords):
                        cdp("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": px, "y": py, "id": i+1} for i, (px, py) in enumerate(coords)]})
                    touch("touchStart", [(170, y-30), (260, y+30)])
                    touch("touchMove", [(140, y-50), (290, y+50)])
                    touch("touchEnd", [])
                    after_pinch = js("({zoom:state.gridInspect.timeZoom,pitch:state.gridInspect.pitchZoom,sounds:rollSounds.length})")
                    assert after_pinch["zoom"] > before_pinch["zoom"] and after_pinch["pitch"] > before_pinch["pitch"] and after_pinch["sounds"] == before_pinch["sounds"], after_pinch
                js("state.transpose=0;state.gridNavigation.reset()")
                assert js("els.pitchLane.parentElement.querySelector('.roll-navigation') === null")
                # Same interactions in the final performance analysis.
                js("""PerformanceReview.open({title:'O sacrum convivium',totalBeats:24,targetEvents:Array.from({length:24},(_,i)=>({onsetBeat:i,durationBeats:.85,midiPitch:58+i%7,lyric:i%4===0?'O':null})),
                  traces:[{id:'test',samples:Array.from({length:240},(_,i)=>({beat:i/10,displayPitch:58+Math.floor(i/10)%7,confidence:.9,errorCents:0}))}],
                  measures:Array.from({length:6},(_,i)=>({number:String(i+1),startBeat:i*4,endBeat:(i+1)*4})),scoreUrl:'library-assets/o-sacrum/part-P3-continuous-1.svg'})""")
                time.sleep(.2)
                snapshot(f"review-{width}x{height}")
                review = js("""(()=>{const c=document.querySelector('#performance-review-canvas'),r=c.getBoundingClientRect(),host=c.parentElement;
                  c.focus();
                  c.dispatchEvent(new KeyboardEvent('keydown',{key:'+',shiftKey:true,cancelable:true}));
                  return {x:r.left+r.width*.6,y:r.top+r.height*.5,height:r.height,bottom:r.bottom,sounds:rollSounds.length,
                    navigationAbsent:host.querySelector('.roll-navigation')===null,
                    overflow:document.documentElement.scrollWidth>innerWidth};})()""")
                assert review["height"] > 180 and review["bottom"] <= height and not review["overflow"], review
                assert review["navigationAbsent"], review
                mouse("mousePressed", review["x"], review["y"], button="left", clickCount=1)
                mouse("mouseMoved", review["x"]-40, review["y"]+40, buttons=1, button="left")
                mouse("mouseReleased", review["x"]-40, review["y"]+40, button="left", clickCount=1)
                assert js("rollSounds.length") == review["sounds"]
                # Keyboard chooses and previews a note without requiring tiny hit targets.
                js("document.querySelector('#performance-review-canvas').focus()")
                cdp("Input.dispatchKeyEvent", {"type": "keyDown", "key": "ArrowRight", "modifiers": 1})
                cdp("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Enter"})
                assert js("rollSounds.length") == review["sounds"] + 1
                js("PerformanceReview.close()")
                # Saved local takes use the same navigation with their own
                # geometry and recorded transposition.
                js("""state.benchmark.savedTakes=[{id:'roll-smoke',startBeat:0,endBeat:12,transpose:-2,frames:[],
                  targetEvents:Array.from({length:12},(_,i)=>({onsetBeat:i,durationBeats:.8,midiPitch:60+i%4,measureNumber:String(1+Math.floor(i/4))}))}];
                  state.benchmark.selectedTakeId='roll-smoke';els.benchmarkAnalysis.hidden=false;
                  resetBenchmarkAnalysisView(false);""")
                local = js("""(()=>{const c=els.benchmarkAnalysisRoll,g=state.benchmark.rollGeometry,r=c.getBoundingClientRect();
                  return {x:r.left+g.xAtBeat(.4),y:r.top+g.yAtPitch(58),sounds:rollSounds.length};})()""")
                # The local analysis retains its existing scrolling layout.
                js("els.benchmarkAnalysisRoll.scrollIntoView({block:'center'})")
                local = js("""(()=>{const g=state.benchmark.rollGeometry,r=els.benchmarkAnalysisRoll.getBoundingClientRect();
                  return {x:r.left+g.xAtBeat(.4),y:r.top+g.yAtPitch(58),sounds:rollSounds.length};})()""")
                click(local["x"], local["y"])
                assert js("rollSounds.length") == local["sounds"] + 1
                assert abs(js("rollSounds.at(-1).frequency") - 440 * 2 ** ((58-69)/12)) < .01
                js("closeBenchmarkAnalysis()")
                # Running playback owns the live viewport. Inspection cannot
                # change it or emit preview notes until it is paused again.
                running = js("""(async()=>{await state.clock.play();render();
                  const sounds=rollSounds.length,c=els.pitchLane,r=c.getBoundingClientRect();
                  const zoom=state.gridInspect.timeZoom,offset=state.gridInspect.pitchOffset;
                  c.dispatchEvent(new WheelEvent('wheel',{clientX:r.left+100,clientY:r.top+100,deltaY:-100,cancelable:true}));
                  const navigationAbsent=c.parentElement.querySelector('.roll-navigation')===null;
                  const unchanged=zoom===state.gridInspect.timeZoom&&offset===state.gridInspect.pitchOffset&&sounds===rollSounds.length;
                  state.clock.pause();render();return {navigationAbsent,unchanged};})()""")
                assert running == {"navigationAbsent": True, "unchanged": True}, running
                results.append({"viewport": [width, height], "anchoredZoom": anchored, "pan": after, "audio": audio["sounds"][-1]})
            time.sleep(2.2)
            assert js("rollEnded===rollSounds.length"), js("({ended:rollEnded,sounds:rollSounds.length})")
            assert js("rollErrors") == [], js("rollErrors")
            print(json.dumps(results))
        finally:
            if socket is not None:
                socket.close()
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    main()
