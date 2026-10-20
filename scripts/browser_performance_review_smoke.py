"""Visual and interaction smoke test for the full-screen performance review."""
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
ARTIFACT = ROOT / "artifacts" / "performance-review.png"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8765/")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="choir-performance-review-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--remote-allow-origins=*", "--remote-debugging-port=0",
            f"--user-data-dir={profile}", args.url,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(100):
                if port_file.exists():
                    break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(tab for tab in tabs if tab.get("type") == "page" and tab.get("url", "").startswith(args.url))
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=15)
            command(socket, 1, "Page.enable")
            command(socket, 2, "Emulation.setDeviceMetricsOverride", {
                "width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False,
            })
            for call_id in range(10, 110):
                if evaluate(socket, call_id, "Boolean(window.PerformanceReview && window.PianoRoll) && document.readyState === 'complete'"):
                    break
                time.sleep(.1)
            else:
                raise RuntimeError("PerformanceReview did not load")
            result = evaluate(socket, 120, """(async () => {
              const totalBeats=24;
              const targetEvents=Array.from({length:24},(_,index)=>({
                onsetBeat:index,durationBeats:.9,midiPitch:58+(index%7),measureNumber:String(Math.floor(index/4)+1),lyric:index%4===0?'O':null
              }));
              const samples=[];
              for(let beat=0;beat<totalBeats;beat+=.08){
                const target=targetEvents[Math.min(23,Math.floor(beat))].midiPitch;
                const error=beat>6&&beat<8?145:beat>15&&beat<17?-125:Math.sin(beat*3)*22;
                samples.push({beat,displayPitch:target+error/100,targetPitch:target,errorCents:error,confidence:.9});
              }
              PerformanceReview.open({
                performance:{id:'demo',pieceId:'o-sacrum',partId:'P3',score:78,coverage:91.4,imageUrl:'library-assets/o-sacrum/piano-roll.png',owner:{displayName:'Arturo Maianovski'}},
                title:'O sacrum convivium',analysis:{trace:{version:1,totalBeats,samples,segments:[]}},targetEvents,
                measures:Array.from({length:6},(_,index)=>({number:String(index+1),startBeat:index*4,endBeat:(index+1)*4})),totalBeats,
                scoreUrl:'library-assets/o-sacrum/part-P3-continuous-1.svg'
              });
              await new Promise(resolve=>setTimeout(resolve,350));
              const rect=document.querySelector('#performance-review-canvas').getBoundingClientRect();
              window.reviewSmokeInitial={
                before:document.querySelector('#performance-review-zoom').textContent,
                initialSuggestions:document.querySelectorAll('#performance-review-suggestions li').length
              };
              return {x:rect.left+rect.width*.331,y:rect.top+rect.height*.70};
            })()""")
            # Use a genuine pointer sequence so capture, drag suppression and
            # marker activation are exercised together.
            for call_id, kind in [(123,"mousePressed"),(124,"mouseReleased")]:
                command(socket, call_id, "Input.dispatchMouseEvent", {
                    "type":kind,"x":result["x"],"y":result["y"],"button":"left","clickCount":1,
                })
            result = evaluate(socket, 125, """(async () => {
              const {before,initialSuggestions}=window.reviewSmokeInitial;
              const canvas=document.querySelector('#performance-review-canvas');
              const rect=canvas.getBoundingClientRect();
              await new Promise(resolve=>requestAnimationFrame(resolve));
              document.querySelector('#performance-review-zoom-in').click();
              await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
              const buttonAfter=document.querySelector('#performance-review-zoom').textContent;
              document.querySelector('#performance-review-reset').click();
              await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
              const plotLeft=58,plotRight=rect.width-10;
              const pointerClientX=Math.round(rect.left+rect.width*.8);
              const pointerX=pointerClientX-rect.left;
              const pointerRatio=(pointerX-plotLeft)/(plotRight-plotLeft);
              const startBefore=Number(canvas.dataset.viewStart),endBefore=Number(canvas.dataset.viewEnd);
              const beatBefore=startBefore+pointerRatio*(endBefore-startBefore);
              canvas.dispatchEvent(new WheelEvent('wheel',{clientX:pointerClientX,clientY:rect.top+rect.height*.5,deltaY:-100,bubbles:true,cancelable:true}));
              await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
              const startAfter=Number(canvas.dataset.viewStart),endAfter=Number(canvas.dataset.viewEnd);
              const beatAfter=startAfter+pointerRatio*(endAfter-startAfter);
              const root=document.querySelector('#performance-review');
              return {hidden:root.hidden,before,after:buttonAfter,wheelAfter:document.querySelector('#performance-review-zoom').textContent,
                anchorDrift:Math.abs(beatAfter-beatBefore),
                initialSuggestions,suggestions:document.querySelectorAll('#performance-review-suggestions li').length,
                canvas:[canvas.getBoundingClientRect().width,canvas.getBoundingClientRect().height],
                score:[document.querySelector('#performance-review-score-scroller').getBoundingClientRect().width,
                  document.querySelector('#performance-review-score-scroller img').getBoundingClientRect().width],
                overflow:getComputedStyle(document.body).overflow};
            })()""")
            assert result["hidden"] is False, result
            assert result["before"] == "100%" and result["after"] == "150%", result
            assert result["wheelAfter"] == "115%" and result["anchorDrift"] < .001, result
            if "cockpit" not in args.url:
                assert result["initialSuggestions"] == 0 and result["suggestions"] == 1, result
            assert result["canvas"][0] > 700 and result["canvas"][1] > 300, result
            assert result["score"][1] > result["score"][0], result
            assert result["overflow"] == "hidden", result
            screenshot = command(socket, 121, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
            ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
            ARTIFACT.write_bytes(base64.b64decode(screenshot["data"]))
            director = evaluate(socket, 122, """(()=>{
              const samples=Array.from({length:20},(_,index)=>({beat:index/2,displayPitch:60+index%3,targetPitch:60}));
              let opened=null;
              PerformanceReview.open({mode:'director',title:'Director fixture',totalBeats:10,targetEvents:[],measures:[],
                traces:[
                  {id:'private',label:'Audio privato',samples},
                  {id:'shared',label:'Audio condiviso',samples,recording:{id:'recording-one'}}
                ],onOpenLab:trace=>{opened=trace.id;}});
              const buttons=[...document.querySelectorAll('.performance-review__lab-button')];
              buttons[1].click();
              return {count:buttons.length,disabled:buttons.map(button=>button.disabled),opened,
                reasons:[...document.querySelectorAll('.performance-review__lab-reason')].map(item=>item.textContent)};
            })()""")
            assert director["count"] == 2 and director["disabled"] == [True, False], director
            assert director["opened"] == "shared" and director["reasons"] == ["Audio non condiviso dal corista"], director
            print(json.dumps({"singer": result, "director": director}, ensure_ascii=False))
        finally:
            if socket is not None:
                socket.close()
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    main()
