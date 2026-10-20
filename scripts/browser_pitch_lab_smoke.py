"""End-to-end browser smoke test for the Cockpit Pitch Detection Lab."""

from __future__ import annotations

import base64
import io
import json
import math
import struct
import subprocess
import tempfile
import threading
import time
import urllib.request
import wave
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import websocket

from browser_practice_smoke import CHROME, command, evaluate


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
ARTIFACTS = ROOT / "artifacts" / "pitch-lab"


def wav_fixture() -> bytes:
    sample_rate = 16_000
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        values = []
        for index in range(sample_rate * 2):
            hz = 220 if index < sample_rate else 440
            sample = int(0.18 * 32767 * math.sin(2 * math.pi * hz * index / sample_rate))
            values.append(struct.pack("<h", sample))
        output.writeframes(b"".join(values))
    return buffer.getvalue()


AUDIO = wav_fixture()
PITCH = {
    "version": 1, "totalBeats": 8, "durationMs": 2000, "audioOffsetMs": 0,
    "playbackRate": 1, "transpose": 0,
    "samples": [{"beat": index / 10, "displayPitch": 57 if index < 10 else 69,
                 "confidence": 0.9, "confirmationState": "confirmed"}
                for index in range(20)],
}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        return

    def body(self, payload: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/session-client.js":
            self.body(b"window.ChoirAuthReady=Promise.resolve();window.ChoirAuthFetch=window.fetch.bind(window);", "text/javascript")
        elif path == "/api/me":
            self.body(json.dumps({"roles": ["director"]}).encode(), "application/json")
        elif path == "/api/cockpit/overview":
            self.body(json.dumps({"members": [], "assignments": [], "progress": []}).encode(), "application/json")
        elif path == "/library.json":
            self.body(b'{"pieces":[]}', "application/json")
        elif path == "/recording.wav":
            self.body(AUDIO, "audio/wav")
        elif path == "/pitch.json":
            self.body(json.dumps(PITCH).encode(), "application/json")
        else:
            super().do_GET()


def main() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(FRONTEND)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/cockpit.html"
    with tempfile.TemporaryDirectory(prefix="choir-pitch-lab-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            "--remote-debugging-port=0", f"--user-data-dir={profile}", "--window-size=1366,768", url,
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
            page = next(tab for tab in tabs if tab.get("type") == "page" and tab.get("url") == url)
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30)
            command(socket, 1, "Page.enable")
            command(socket, 2, "Emulation.setDeviceMetricsOverride", {
                "width": 1366, "height": 768, "deviceScaleFactor": 1, "mobile": False,
            })
            for call_id in range(10, 130):
                if evaluate(socket, call_id, "Boolean(window.PitchLab && window.PitchLabCore)"):
                    break
                time.sleep(.05)
            result = evaluate(socket, 140, """(async()=>{
              document.querySelector('#performance-review').hidden=false;
              await PitchLab.open({title:'Fixture',recording:{id:'r1',pieceId:'fixture',partId:'tenore',displayName:'Ada',voicePart:'tenore',audioUrl:'/recording.wav',pitchUrl:'/pitch.json',audioOffsetMs:0,playbackRate:1,transpose:0},music:{secondsAtBeat:beat=>beat/4,targetEvents:[{onsetBeat:0,durationBeats:4,midiPitch:57,lyric:'A'},{onsetBeat:4,durationBeats:4,midiPitch:69,lyric:'B'}]}});
              document.querySelector('#pitch-lab-run').click();
              for(let i=0;i<300;i++){if(document.querySelectorAll('#pitch-lab-metrics-body tr').length)break;await new Promise(r=>setTimeout(r,30));}
              const canvas=document.querySelector('#pitch-lab-canvas'),rect=canvas.getBoundingClientRect();
              canvas.dispatchEvent(new WheelEvent('wheel',{clientX:rect.left+rect.width*.78,clientY:rect.top+200,deltaY:-100,bubbles:true,cancelable:true}));
              await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
              const algorithm=document.querySelector('#pitch-lab-algorithm');
              algorithm.value='pyin';
              algorithm.dispatchEvent(new Event('change',{bubbles:true}));
              document.querySelector('#pitch-lab-run').click();
              for(let i=0;i<400;i++){if(document.querySelectorAll('#pitch-lab-metrics-body tr').length>=2)break;await new Promise(r=>setTimeout(r,30));}
              const layers=[...document.querySelectorAll('#pitch-lab-layers label')].map(x=>x.textContent.trim());
              return {open:!document.querySelector('#pitch-lab').hidden,rows:document.querySelectorAll('#pitch-lab-metrics-body tr').length,layers,
                inspector:document.querySelectorAll('#pitch-lab-inspector-values>div').length,zoom:document.querySelector('#pitch-lab-zoom').textContent,
                canvas:[rect.width,rect.height],overflow:getComputedStyle(document.body).overflow,status:document.querySelector('#pitch-lab-status').textContent,
                algorithm:algorithm.value,preset:document.querySelector('#pitch-lab-preset').value,
                pyinVisible:![...document.querySelectorAll('#pitch-lab-parameters fieldset')].at(-1).hidden,
                aboveReview:document.elementFromPoint(innerWidth/2,20).closest('#pitch-lab')!==null,
                z:[getComputedStyle(document.querySelector('#performance-review')).zIndex,getComputedStyle(document.querySelector('#pitch-lab')).zIndex]};
            })()""")
            assert result["open"] and result["rows"] == 2, result
            assert result["aboveReview"] and int(result["z"][1]) > int(result["z"][0]), result
            assert len(result["layers"]) == 6 and any("pYIN" in layer for layer in result["layers"]) and result["inspector"] == 12, result
            assert result["zoom"] != "100%" and result["canvas"][0] > 800 and result["canvas"][1] > 300, result
            assert result["overflow"] == "hidden", result
            assert result["algorithm"] == "pyin" and result["preset"] == "pyin-default" and result["pyinVisible"], result
            shot = command(socket, 141, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
            (ARTIFACTS / "desktop.png").write_bytes(base64.b64decode(shot["data"]))

            command(socket, 142, "Emulation.setDeviceMetricsOverride", {
                "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": False,
            })
            time.sleep(.2)
            mobile = evaluate(socket, 143, """({
              overflow:document.documentElement.scrollWidth>innerWidth,
              layout:getComputedStyle(document.querySelector('.pitch-lab-layout')).gridTemplateColumns,
              canvas:document.querySelector('#pitch-lab-canvas').getBoundingClientRect().width,
              controls:document.querySelector('.pitch-lab-controls').getBoundingClientRect().width
            })""")
            assert mobile["overflow"] is False and mobile["canvas"] <= 390 and mobile["controls"] <= 390, mobile
            shot = command(socket, 144, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
            (ARTIFACTS / "mobile.png").write_bytes(base64.b64decode(shot["data"]))
            sweep = evaluate(socket, 145, """(async()=>{
              const algorithm=document.querySelector('#pitch-lab-algorithm');
              algorithm.value='yin'; algorithm.dispatchEvent(new Event('change',{bubbles:true}));
              const mode=document.querySelector('#pitch-lab-mode');
              mode.value='sweep'; mode.dispatchEvent(new Event('change',{bubbles:true}));
              document.querySelector('#pitch-lab-sweep-values').value='0.20, 0.42, 0.55';
              document.querySelector('#pitch-lab-run').click();
              for(let i=0;i<400;i++){if(document.querySelectorAll('#pitch-lab-metrics-body tr').length>=5)break;await new Promise(r=>setTimeout(r,30));}
              return {rows:document.querySelectorAll('#pitch-lab-metrics-body tr').length,
                status:document.querySelector('#pitch-lab-status').textContent,
                layers:document.querySelectorAll('#pitch-lab-layers label').length,
                workerIdle:document.querySelector('#pitch-lab-run').disabled===false};
            })()""")
            assert sweep["rows"] == 5 and sweep["layers"] == 12 and sweep["workerIdle"], sweep
            assert "CMND calcolata una volta" in sweep["status"], sweep
            tuning = evaluate(socket, 146, """(async()=>{
              const algorithm=document.querySelector('#pitch-lab-algorithm');
              algorithm.value='pyin';algorithm.dispatchEvent(new Event('change',{bubbles:true}));
              const mode=document.querySelector('#pitch-lab-mode');
              mode.value='tune';mode.dispatchEvent(new Event('change',{bubbles:true}));
              document.querySelector('#pitch-lab-run').click();
              for(let i=0;i<400;i++){if(document.querySelectorAll('#pitch-lab-metrics-body tr').length===11)break;await new Promise(r=>setTimeout(r,30));}
              const create=URL.createObjectURL;let exported;
              URL.createObjectURL=blob=>{exported=blob;return create(blob)};
              document.querySelector('#pitch-lab-export-json').click();
              URL.createObjectURL=create;
              const payload=JSON.parse(await exported.text());
              const candidateFrame=payload.experiments.at(-1).result.frames.find(f=>f.candidateCount>0);
              const canvas=document.querySelector('#pitch-lab-canvas');canvas.focus();
              canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
              const keyTime=document.querySelector('#pitch-lab-inspector-title').textContent;
              return {rows:document.querySelectorAll('#pitch-lab-metrics-body tr').length,
                status:document.querySelector('#pitch-lab-status').textContent,
                tuning:payload.tuning.status,selected:payload.tuning.selectedIndex,
                configs:payload.tuning.evaluations.length,candidates:candidateFrame.candidates.length,
                decoder:typeof candidateFrame.decoderVoiced, keyTime,
                columns:document.querySelectorAll('.pitch-lab-metrics thead th').length,
                cells:document.querySelector('#pitch-lab-metrics-body tr').children.length};
            })()""")
            assert tuning['rows'] == 11 and tuning['tuning'] == 'diagnostic-only' and tuning['selected'] is None, tuning
            assert tuning['configs'] == 6 and tuning['candidates'] > 0 and tuning['decoder'] == 'boolean', tuning
            assert tuning['columns'] == tuning['cells'] and 'Nessun vincitore' in tuning['status'], tuning
            referenced = evaluate(socket, 149, """(async()=>{
              const input=document.querySelector('#pitch-lab-ground-truth'),files=new DataTransfer();
              files.items.add(new File([JSON.stringify({frames:[{startSec:.2,endSec:.8,hz:220},
                {startSec:1.2,endSec:1.7,hz:440},{startSec:0,endSec:.1,hz:null}]})], 'reference.json',{type:'application/json'}));
              input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
              for(let i=0;i<100;i++){if(document.querySelector('#pitch-lab-status').textContent.includes('caricato'))break;await new Promise(r=>setTimeout(r,20));}
              document.querySelector('#pitch-lab-run').click();
              for(let i=0;i<400;i++){if(document.querySelectorAll('#pitch-lab-metrics-body tr').length===17)break;await new Promise(r=>setTimeout(r,30));}
              const create=URL.createObjectURL;let blob;
              URL.createObjectURL=value=>{blob=value;return create(value)};
              document.querySelector('#pitch-lab-export-json').click();URL.createObjectURL=create;
              const payload=JSON.parse(await blob.text()),metric=payload.experiments.at(-1).result.metrics.acousticAccuracy;
              input.files=new DataTransfer().files;input.dispatchEvent(new Event('change',{bubbles:true}));
              return {status:payload.tuning.status,selected:payload.tuning.selectedIndex,
                referenceFrames:metric.evaluatedFrames,unknownFrames:metric.unknownFrames,
                precision:metric.voicingPrecision,truth:payload.acousticTruth.length};
            })()""")
            assert referenced['status'] == 'in-sample-only' and referenced['selected'] is not None, referenced
            assert referenced['referenceFrames'] > 0 and referenced['unknownFrames'] > 0 and referenced['truth'] == 3, referenced
            command(socket, 147, 'Input.dispatchKeyEvent', {'type':'keyDown','key':'Escape','code':'Escape'})
            assert evaluate(socket, 148, "document.querySelector('#pitch-lab').hidden"), 'Escape did not close lab'
            print(json.dumps({"desktop": result, "mobile": mobile, "sweep": sweep, "tuning": tuning, "referenced": referenced}, ensure_ascii=False))
        finally:
            if socket is not None:
                socket.close()
            process.terminate()
            process.wait(timeout=5)
            server.shutdown()


if __name__ == "__main__":
    main()
