"""Print effective practice settings from a clean temporary Chrome profile."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

from browser_dist_smoke import CHROME, command, evaluate


SNAPSHOT = """({
  origin: location.origin,
  mode: window.ChoirRuntimeConfig?.mode,
  buildVersion: window.ChoirRuntimeConfig?.buildVersion ?? null,
  lyricTextScale: state.lyricTextScale,
  showIntervals: state.showIntervals,
  rmsThreshold: state.detectorSettings.rmsThreshold,
  weakVoiceMode: state.detectorSettings.weakVoiceMode,
  fastAlpha: state.detectorSettings.fastAlpha,
  slowAlpha: state.detectorSettings.slowAlpha,
  medianWindowFrames: state.detectorSettings.medianWindowFrames,
  plumeWidth: state.plumeSettings.width,
  plumeIntensity: state.plumeSettings.intensity,
  plumeAdvanceMs: state.plumeSettings.timeAdvanceMs,
  pianoRollDelayMs: state.pianoRollDelayMs,
  audioOutputType: state.audioOutputType,
  storage: Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])),
  controls: {
    lyricTextScale: els.settingsTextScale.value,
    showIntervals: els.settingsShowIntervals.checked,
    rms: els.settingsV1Rms.value,
    weakVoiceMode: els.settingsWeakVoiceMode.checked,
    fastAlpha: els.settingsV1FastAlpha.value,
    slowAlpha: els.settingsV1SlowAlpha.value,
    medianFrames: els.settingsV1MedianFrames.value,
    plumeWidth: els.settingsV1PlumeWidth.value,
    plumeIntensity: els.settingsV1PlumeIntensity.value,
    plumeAdvanceMs: els.settingsV1PlumeAdvance.value,
    pianoRollDelayMs: els.settingsPianoRollDelay.value
  }
})"""


def capture(url: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="choir-settings-", ignore_cleanup_errors=True) as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu",
            "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required",
            "--remote-allow-origins=*", "--remote-debugging-port=0",
            f"--user-data-dir={profile}", "about:blank",
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
            command(socket, 1, "Page.enable")
            command(socket, 2, "Runtime.enable")
            command(socket, 3, "Page.navigate", {"url": url})
            call_id = 10
            for _ in range(240):
                ready = evaluate(socket, call_id, "typeof state !== 'undefined' && Boolean(state.runtime)")
                call_id += 1
                if ready:
                    return evaluate(socket, call_id, SNAPSHOT)
                time.sleep(.1)
            raise RuntimeError(f"Pagina non pronta: {url}")
        finally:
            if socket:
                try:
                    command(socket, 9999, "Browser.close")
                except (OSError, websocket.WebSocketException):
                    pass
                socket.close()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("urls", nargs="+")
    args = parser.parse_args()
    snapshots = [capture(url) for url in args.urls]
    print(json.dumps(snapshots, ensure_ascii=False, indent=2))
    comparable = [{key: value for key, value in item.items() if key not in {"origin", "mode", "buildVersion"}}
                  for item in snapshots]
    if any(item != comparable[0] for item in comparable[1:]):
        print("DIFFERENZA: le impostazioni effettive non coincidono")
        return 1
    print("OK: impostazioni effettive identiche nei profili puliti")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
