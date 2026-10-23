"""Check metronome defaults, saved levels and audible timing in real Chrome."""
from __future__ import annotations

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
ARTIFACTS = ROOT / "artifacts" / "metronome"


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="choir-metronome-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            "--remote-debugging-port=0", f"--user-data-dir={profile}",
            "http://127.0.0.1:5173/?piece=ave-verum",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(100):
                if port_file.exists():
                    break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
            page = next(tab for tab in tabs if tab.get("type") == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=20)
            command(socket, 1, "Page.enable")
            for _ in range(200):
                evaluate(socket, 2, "document.querySelector('#piece-picker-dialog[open] [data-preferred-voice=tenore]:not(:disabled)')?.click()")
                if evaluate(socket, 3, "typeof state !== 'undefined' && Boolean(state.clock) && !els.piecePickerDialog.open"):
                    break
                time.sleep(.1)
            else:
                raise RuntimeError("Practice did not open")

            results = []
            for width, height in [(1366, 768), (390, 844)]:
                command(socket, 4, "Emulation.setDeviceMetricsOverride", {
                    "width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 1000,
                })
                time.sleep(.25)
                result = evaluate(socket, 5, """(() => ({
                  volume: els.metronomeVolume.value, active: els.metronomeToggle.getAttribute('aria-pressed'),
                  label: els.metronomeToggle.getAttribute('aria-label'), offset: state.metronomeOffsetMs,
                  width: innerWidth, height: innerHeight,
                  scrollWidth: document.documentElement.scrollWidth,
                  scrollHeight: document.documentElement.scrollHeight,
                }))()""")
                assert result["volume"] == "30" and result["active"] == "true", result
                assert result["label"] == "Disattiva metronomo" and result["offset"] == 0, result
                assert result["scrollWidth"] == width and result["scrollHeight"] == height, result
                shot = command(socket, 6, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ARTIFACTS / f"default-{width}x{height}.png").write_bytes(base64.b64decode(shot["data"]))
                results.append(result)

            interaction = evaluate(socket, 7, """(() => {
              const assert = (condition, message) => { if (!condition) throw Error(message); };
              const read = () => ({volume: els.metronomeVolume.value, active: els.metronomeToggle.getAttribute('aria-pressed')});
              els.metronomeToggle.click();
              assert(read().volume === '0' && read().active === 'false', 'mute works');
              els.metronomeToggle.click();
              assert(read().volume === '30' && read().active === 'true', 'unmute restores 30%');
              els.metronomeVolume.value = '67';
              els.metronomeVolume.dispatchEvent(new Event('input'));
              els.metronomeVolume.dispatchEvent(new Event('change'));
              restorePreferences(); updateMetronomeControl();
              els.metronomeToggle.click(); els.metronomeToggle.click();
              assert(read().volume === '67', 'saved custom volume survives restoration and toggle');
              els.metronomeToggle.click();
              restorePreferences(); updateMetronomeControl();
              assert(read().volume === '0' && read().active === 'false', 'saved mute survives restoration');
              els.metronomeToggle.click();
              assert(read().volume === '30', 'reopened muted piece uses 30% when enabled');
              const originalClick = playMetronomeClick;
              const timings = [];
              try {
                let wallMs = 0;
                let clicks = [];
                playMetronomeClick = accented => clicks.push({wallMs, accented});
                for (const speed of [.8, .9, 1]) {
                  clicks = []; state.lastMetronomeBeat = null;
                  const measure = state.occurrenceMeasures[0];
                  const pulseSeconds = state.runtime.secondsAtBeat(measure.startBeat + 4 / measure.timeSignatureDenominator);
                  const endMs = Math.ceil(pulseSeconds / speed * 1000 + 180);
                  for (wallMs = 0; wallMs <= endMs; wallMs += 1)
                    renderMetronome({running: true, performanceTime: wallMs / 1000 * speed, speed});
                  assert(Math.abs(clicks[0].wallMs) <= 1, 'first click follows the music origin');
                  assert(Math.abs(clicks[1].wallMs - pulseSeconds / speed * 1000) <= 1,
                    'later clicks follow the media pulse at every offered speed');
                  timings.push({speed, clicks});
                }
              } finally { playMetronomeClick = originalClick; state.lastMetronomeBeat = null; }
              return {volume: read(), timings};
            })()""")
            print(json.dumps({"viewports": results, "interaction": interaction}, indent=2))
        finally:
            if socket:
                socket.close()
            process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    main()
