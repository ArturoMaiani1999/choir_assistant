"""Responsive checks for the compact practice toolbar, mixer and metronome."""
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
ARTIFACTS = ROOT / "artifacts" / "practice-redesign"


def wait_for_runtime(socket) -> None:
    for call_id in range(10, 110):
        if evaluate(socket, call_id, "typeof state !== 'undefined' && Boolean(state.runtime)"):
            return
        time.sleep(.1)
    raise RuntimeError("Practice initialization timed out")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5173/")
    args = parser.parse_args()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="choir-mobile-controls-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            "--remote-debugging-port=0", f"--user-data-dir={profile}", args.url,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(100):
                try:
                    port = port_file.read_text().splitlines()[0]
                    break
                except (OSError, IndexError):
                    time.sleep(.05)
            else:
                raise RuntimeError("Chrome did not start")
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
            page = next(tab for tab in tabs if tab.get("type") == "page" and tab.get("url", "").startswith(args.url))
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=20)
            command(socket, 1, "Emulation.setDeviceMetricsOverride", {
                "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True,
            })
            command(socket, 2, "Page.reload")
            wait_for_runtime(socket)

            toolbar = evaluate(socket, 120, """(async () => {
              const assert = (value, message) => { if (!value) throw Error(message); };
              const topToggle = document.querySelector('#mobile-toolbar-toggle');
              const iconBefore = topToggle.firstElementChild.getBoundingClientRect();
              const iconCenterBefore = {x:iconBefore.left + iconBefore.width / 2, y:iconBefore.top + iconBefore.height / 2};
              topToggle.click();
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const icon = topToggle.firstElementChild;
              const iconAfter = icon.getBoundingClientRect();
              const iconCenterAfter = {x:iconAfter.left + iconAfter.width / 2, y:iconAfter.top + iconAfter.height / 2};
              const title = document.querySelector('#piece-title');
              const part = document.querySelector('#part-selector');
              const transpose = document.querySelector('.transpose-control');
              const transposeSelect = document.querySelector('#transpose');
              const metronome = document.querySelector('.metronome-control');
              const metronomeVolume = document.querySelector('#metronome-volume');
              const toolbarRect = document.querySelector('#practice-toolbar').getBoundingClientRect();
              const scoreHeight = document.querySelector('.score-region').getBoundingClientRect().height;
              const pitchHeight = document.querySelector('.pitch-region').getBoundingClientRect().height;
              const actionRects = [...document.querySelectorAll('.toolbar-actions > *')]
                .filter(control => getComputedStyle(control).display !== 'none')
                .map(control => control.getBoundingClientRect());
              assert(toolbarRect.left >= 0 && toolbarRect.right <= innerWidth, 'toolbar fits viewport');
              assert(toolbarRect.height >= 80 && toolbarRect.height <= 120, 'toolbar remains compact');
              assert(icon.textContent === '' && getComputedStyle(icon).clipPath !== 'none', 'toggle uses a CSS triangle');
              assert(Math.abs(iconCenterBefore.x - iconCenterAfter.x) < .01
                && Math.abs(iconCenterBefore.y - iconCenterAfter.y) < .01, 'triangle keeps the same center');
              assert(actionRects.every((rect, index) => rect.right <= toolbarRect.right + 1
                && (!index || rect.left >= actionRects[index - 1].right - 1)), 'toolbar actions do not overlap');
              assert(getComputedStyle(title).fontFamily === getComputedStyle(document.body).fontFamily, 'toolbar uses one font family');
              assert(parseFloat(getComputedStyle(title).fontSize) <= 14, 'mobile title is compact');
              assert(parseFloat(getComputedStyle(part).borderRadius) >= 8, 'part dropdown is a styled control');
              assert(transpose.textContent.trim().startsWith('Transp'), 'transpose has compact label');
              assert(getComputedStyle(transposeSelect).opacity === '0', 'duplicate transpose value is hidden');
              assert(document.querySelector('#transpose-value').textContent === '±0', 'semitones remain visible');
              assert(getComputedStyle(metronome).display === 'flex', 'metronome control is visible');
              assert(metronomeVolume.getBoundingClientRect().width >= 44, 'metronome volume slider is usable');
              assert(scoreHeight >= innerHeight * .28 && scoreHeight <= innerHeight * .32,
                'mobile score opens at about one third of the viewport');
              assert(pitchHeight > scoreHeight, 'the piano roll receives most of the available height');
              return {toolbarHeight: toolbarRect.height, titleWidth: title.getBoundingClientRect().width,
                partWidth: part.getBoundingClientRect().width, metronomeWidth: metronomeVolume.getBoundingClientRect().width,
                scoreHeight, pitchHeight};
            })()""")
            toolbar_shot = command(socket, 121, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
            (ARTIFACTS / "mobile-controls-toolbar.png").write_bytes(base64.b64decode(toolbar_shot["data"]))

            mixer = evaluate(socket, 122, """(async () => {
              const assert = (value, message) => { if (!value) throw Error(message); };
              document.querySelector('#accompaniment-mode').click();
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const dialog = document.querySelector('#voice-mixer-dialog');
              const rect = dialog.getBoundingClientRect();
              const channels = [...dialog.querySelectorAll('.mixer-channel:not([hidden])')];
              assert(dialog.open, 'mixer opens');
              assert(rect.top >= 0 && rect.bottom <= innerHeight, 'mixer fits viewport');
              assert(dialog.scrollHeight <= dialog.clientHeight + 1, 'mixer needs no internal scrolling');
              assert(channels.length >= 2, 'mixer has channels');
              assert(channels.every(channel => channel.getBoundingClientRect().height < 70), 'channels are compact rows');
              assert(channels.every(channel => {
                const slider = channel.querySelector('input[type=range]').getBoundingClientRect();
                return slider.width > slider.height;
              }), 'mixer faders are horizontal');
              return {dialog: {top: rect.top, bottom: rect.bottom, height: rect.height},
                channelCount: channels.length, channelHeight: channels[0].getBoundingClientRect().height};
            })()""")
            mixer_shot = command(socket, 123, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
            (ARTIFACTS / "mobile-controls-mixer.png").write_bytes(base64.b64decode(mixer_shot["data"]))

            backdrop = evaluate(socket, 124, """(() => {
              const dialog = document.querySelector('#voice-mixer-dialog');
              const rect = dialog.getBoundingClientRect();
              dialog.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:rect.left - 1, clientY:rect.top - 1}));
              return {open:dialog.open};
            })()""")
            assert backdrop == {"open": False}, backdrop

            command(socket, 125, "Emulation.setDeviceMetricsOverride", {
                "width": 844, "height": 390, "deviceScaleFactor": 1, "mobile": True,
            })
            time.sleep(.15)
            landscape = evaluate(socket, 126, """(async () => {
              const assert = (value, message) => { if (!value) throw Error(message); };
              document.querySelector('#accompaniment-mode').click();
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const dialog = document.querySelector('#voice-mixer-dialog');
              const rect = dialog.getBoundingClientRect();
              assert(rect.top >= 0 && rect.bottom <= innerHeight, 'landscape mixer fits viewport');
              assert(dialog.scrollHeight <= dialog.clientHeight + 1, 'landscape mixer needs no internal scrolling');
              dialog.close();
              return {top:rect.top, bottom:rect.bottom, height:rect.height};
            })()""")
            print(json.dumps({"toolbar": toolbar, "mixer": mixer, "backdrop": backdrop,
                "landscapeMixer": landscape}, ensure_ascii=False, indent=2))
        finally:
            if socket:
                socket.close()
            process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    main()
