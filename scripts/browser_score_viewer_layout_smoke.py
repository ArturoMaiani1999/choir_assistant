"""Check full-score line starts and active-system viewport centering."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

from browser_practice_smoke import CHROME, command, evaluate


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8789/score-viewer.html?piece=qui-credit-in-me-non-sitiet",
    )
    parser.add_argument("--width", type=int, default=1440)
    parser.add_argument("--height", type=int, default=900)
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    with tempfile.TemporaryDirectory(prefix="choir-viewer-layout-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu",
            "--autoplay-policy=no-user-gesture-required", "--remote-allow-origins=*",
            "--remote-debugging-port=0", f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            port = None
            for _ in range(120):
                try:
                    lines = port_file.read_text(encoding="utf-8").splitlines()
                    if lines:
                        port = lines[0]
                        break
                except OSError:
                    pass
                time.sleep(.05)
            if port is None:
                raise RuntimeError("Chrome non si è avviato")
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(tab for tab in tabs if tab.get("type") == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30)
            call_id = 1
            command(socket, call_id, "Page.enable")
            call_id += 1
            command(socket, call_id, "Runtime.enable")
            call_id += 1
            command(socket, call_id, "Emulation.setDeviceMetricsOverride", {
                "width": args.width, "height": args.height,
                "deviceScaleFactor": 1, "mobile": args.width <= 760,
            })
            call_id += 1
            command(socket, call_id, "Page.navigate", {"url": args.url})
            call_id += 1
            for _ in range(200):
                ready = evaluate(socket, call_id, """Boolean(
                  document.querySelectorAll('.viewer-measure-hit').length
                  && [...document.querySelectorAll('.viewer-page img')].slice(0,2).every(image=>image.complete&&image.naturalWidth)
                )""")
                call_id += 1
                if ready:
                    break
                time.sleep(.05)
            else:
                raise AssertionError("Il viewer non ha completato il caricamento")

            result = evaluate(socket, call_id, """(async () => {
              const targets=[...document.querySelectorAll('.viewer-measure-hit')];
              const firstBySystem=[...targets.reduce((systems,target)=>{
                const key=`${target.parentElement.dataset.page}:${target.dataset.systemId}`;
                if(!systems.has(key))systems.set(key,target);
                return systems;
              },new Map()).values()];
              const pageSystems=new Map();
              for(const target of firstBySystem){
                const page=target.parentElement.dataset.page,systems=pageSystems.get(page)??[];
                systems.push(target);pageSystems.set(page,systems);
              }
              const pageWithWrap=[...pageSystems.values()].find(systems=>systems.length>1);
              const target=pageWithWrap?.[1]??firstBySystem.at(-1);
              const startPercent=parseFloat(target.style.left),barStartPercent=Number(target.dataset.barStartX);
              target.click();
              const initialLineLeft=parseFloat(document.querySelector('.viewer-playhead.is-active').style.left);
              await new Promise(resolve=>setTimeout(resolve,700));
              const line=document.querySelector('.viewer-playhead.is-active');
              const lineRect=line.getBoundingClientRect(),toolbar=document.querySelector('.viewer-toolbar').getBoundingClientRect();
              const transport=document.querySelector('.viewer-transport').getBoundingClientRect();
              const visibleTop=Math.max(0,toolbar.bottom)+8;
              const visibleBottom=Math.max(visibleTop+80,Math.min(innerHeight,transport.top-8));
              const firstOffsets=firstBySystem.map(item=>parseFloat(item.style.left)-Number(item.dataset.barStartX));
              const resources=performance.getEntriesByType('resource').map(entry=>entry.name);
              return {
                systems:firstBySystem.length,firstOffsets,
                selectedSystem:target.dataset.systemId,
                initialLineLeft,startPercent,
                startsAfterSignature:startPercent>barStartPercent,
                playheadStartsAtFirstSymbol:Math.abs(initialLineLeft-startPercent)<.001,
                centerDelta:Math.abs((lineRect.top+lineRect.height/2)-(visibleTop+visibleBottom)/2),
                fullyVisible:lineRect.top>=visibleTop-2&&lineRect.bottom<=visibleBottom+2,
                viewport:{lineTop:lineRect.top,lineBottom:lineRect.bottom,visibleTop,visibleBottom,scrollY},
                measureSlots:targets.length,writtenMeasures:Number(document.querySelector('#viewer-pages').dataset.measures),
                versioned:resources.filter(name=>name.includes('/library-assets/'))
                  .every(name=>new URL(name).searchParams.has('v')),
              };
            })()""")
            assert result["systems"] > 1, result
            assert result["measureSlots"] == result["writtenMeasures"] > 0, result
            assert result["startsAfterSignature"] and min(result["firstOffsets"]) > 0, result
            assert result["playheadStartsAtFirstSymbol"], result
            assert result["centerDelta"] < 30 and result["fullyVisible"], result
            assert result["versioned"], result
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
        finally:
            if socket is not None:
                socket.close()
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
