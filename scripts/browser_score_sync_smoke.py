"""Verify continuous-score geometry against the canonical playback timeline."""

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


def wait_for_score(socket, call_id: int) -> int:
    for _ in range(160):
        ready = evaluate(socket, call_id, """Boolean(
          typeof state !== 'undefined' && state.runtime && state.bundleManifest
          && state.scoreLayout === 'continuous' && state.fallbackScoreSlots.length
          && els.scoreImage.complete && els.scoreImage.naturalWidth
        )""")
        call_id += 1
        if ready:
            return call_id
        time.sleep(.1)
    diagnostics = evaluate(socket, call_id, """({
      layout: typeof state === 'undefined' ? null : state.scoreLayout,
      slots: typeof state === 'undefined' ? null : state.fallbackScoreSlots.length,
      source: document.querySelector('#score-image')?.currentSrc,
      loading: document.querySelector('#score-loading')?.textContent
    })""")
    raise AssertionError(f"Spartito continuo non pronto: {diagnostics}")


def probe(socket, call_id: int) -> tuple[dict, int]:
    result = evaluate(socket, call_id, """(() => {
      const positions = state.occurrenceMeasures.map((occurrence, occurrenceIndex) => {
        const beat = (occurrence.startBeat + occurrence.endBeat) / 2;
        renderScore(beat);
        const position = fallbackScorePosition(beat);
        const writtenIndex = state.runtime.measures.findIndex(
          measure => measure.id === occurrence.writtenMeasureId
        );
        const slot = state.fallbackScoreSlots[writtenIndex];
        const cursor = els.scoreCursor.getBoundingClientRect();
        const viewport = els.scoreViewport.getBoundingClientRect();
        return {
          occurrenceIndex,
          writtenMeasureId: occurrence.writtenMeasureId,
          writtenIndex,
          x: position?.x_percent,
          expectedMidpoint: slot ? (slot.startX + slot.endX) / 2 : null,
          cursorVisible: cursor.right >= viewport.left && cursor.left <= viewport.right,
        };
      });
      const repeated = positions.find(item => item.occurrenceIndex === 24);
      const firstPass = positions.find(item => item.writtenMeasureId === repeated?.writtenMeasureId);
      return {
        layout: state.scoreLayout,
        source: els.scoreImage.currentSrc,
        slots: state.fallbackScoreSlots.length,
        writtenMeasures: state.runtime.measures.length,
        occurrences: state.occurrenceMeasures.length,
        sheetWidth: els.scoreSheet.getBoundingClientRect().width,
        viewportWidth: els.scoreViewport.clientWidth,
        allMapped: positions.every(item => item.writtenIndex >= 0
          && Math.abs(item.x - item.expectedMidpoint) < .001),
        allCursorsVisible: positions.every(item => item.cursorVisible),
        repeatedX: repeated?.x,
        firstPassX: firstPass?.x,
      };
    })()""")
    return result, call_id + 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8789/?piece=guarda-signore-i-doni&part=P3",
    )
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    with tempfile.TemporaryDirectory(prefix="choir-score-sync-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu",
            "--autoplay-policy=no-user-gesture-required", "--remote-allow-origins=*",
            "--remote-debugging-port=0", f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(120):
                if port_file.exists():
                    break
                time.sleep(.05)
            else:
                raise RuntimeError("Chrome non si è avviato")
            port = port_file.read_text(encoding="utf-8").splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(tab for tab in tabs if tab.get("type") == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=20)
            call_id = 1
            command(socket, call_id, "Page.enable")
            call_id += 1
            command(socket, call_id, "Runtime.enable")
            call_id += 1
            command(socket, call_id, "Emulation.setDeviceMetricsOverride", {
                "width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False,
            })
            call_id += 1
            command(socket, call_id, "Page.navigate", {"url": args.url})
            call_id += 1
            call_id = wait_for_score(socket, call_id)
            desktop, call_id = probe(socket, call_id)

            command(socket, call_id, "Emulation.setDeviceMetricsOverride", {
                "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True,
            })
            call_id += 1
            evaluate(socket, call_id, "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            call_id += 1
            mobile, call_id = probe(socket, call_id)

            for label, result in (("desktop", desktop), ("mobile", mobile)):
                assert result["layout"] == "continuous", (label, result)
                assert result["slots"] == result["writtenMeasures"] > 0, (label, result)
                assert result["occurrences"] > result["writtenMeasures"], (label, result)
                assert result["sheetWidth"] > result["viewportWidth"], (label, result)
                assert result["allMapped"] and result["allCursorsVisible"], (label, result)
                assert abs(result["repeatedX"] - result["firstPassX"]) < .001, (label, result)

            spa_switch = evaluate(socket, call_id, r"""(async () => {
              const currentPiece=state.bundleManifest.piece_id;
              const nextPiece=state.library.find(piece=>piece.piece_id!==currentPiece);
              els.piecePicker.click();
              els.libraryPiece.value=nextPiece.piece_id;
              els.libraryPiece.dispatchEvent(new Event('change'));
              for(let i=0;i<100&&!bundleCache.has(nextPiece.piece_id);i++)await new Promise(resolve=>setTimeout(resolve,20));
              for(let i=0;i<100&&pieceDataCache.size<2;i++)await new Promise(resolve=>setTimeout(resolve,20));
              const prefetched=[...performance.getEntriesByType('resource')]
                .filter(entry=>entry.name.includes(`/library-assets/${nextPiece.piece_id}/`)).map(entry=>entry.name);
              els.libraryOpen.click();
              for(let i=0;i<200&&state.bundleManifest.piece_id!==nextPiece.piece_id;i++)await new Promise(resolve=>setTimeout(resolve,20));
              for(let i=0;i<100&&(!els.scoreImage.complete||!els.scoreImage.naturalWidth);i++)await new Promise(resolve=>setTimeout(resolve,20));
              const libraryResources=performance.getEntriesByType('resource')
                .map(entry=>entry.name).filter(name=>name.includes('/library-assets/'));
              return {
                before:currentPiece,after:state.bundleManifest.piece_id,
                navigationEntries:performance.getEntriesByType('navigation').length,
                appScripts:performance.getEntriesByType('resource').filter(entry=>/\/app\.[a-f0-9]+\.js/.test(entry.name)).length,
                bundleCache:bundleCache.size,pieceDataCache:pieceDataCache.size,
                prefetchedCount:prefetched.length,
                versioned:libraryResources.every(name=>new URL(name).searchParams.get('v')===RUNTIME_CONFIG.buildVersion),
                dialogOpen:els.piecePickerDialog.open,
              };
            })()""")
            call_id += 1
            assert spa_switch["after"] != spa_switch["before"], spa_switch
            assert spa_switch["navigationEntries"] == 1 and spa_switch["appScripts"] == 1, spa_switch
            assert 1 <= spa_switch["pieceDataCache"] <= 2 and spa_switch["prefetchedCount"] > 0, spa_switch
            assert spa_switch["versioned"] and not spa_switch["dialogOpen"], spa_switch

            evidence = {"desktop": desktop, "mobile": mobile, "spaSwitch": spa_switch}
            print(json.dumps(evidence, ensure_ascii=False, indent=2))
            return 0
        finally:
            if socket is not None:
                socket.close()
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
