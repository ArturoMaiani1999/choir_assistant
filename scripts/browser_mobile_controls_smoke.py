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
              assert(UI_CONFIG.mobileHistoryBeats + UI_CONFIG.mobileFutureBeats === 4,
                'mobile piano roll displays four beats at its widest zoom');
              assert(livePlumeSettings(0, false, 10, 0).retainHistory === true,
                'live singing retains all visible plume history');
              assert(livePlumeSettings(0, true, 10, 0).retainHistory === false,
                'paused inspection continues to use review rendering');
              assert(state.pianoRollDelayMs === 270, 'piano roll delay defaults to 270 ms');
              assert(state.plumeSettings.timeAdvanceMs === 270, 'standard vocal trace advance defaults to 270 ms');
              populateLibraryPieces(state.bundleManifest.piece_id);
              const libraryTitles = [...els.libraryPiece.options].map(option => option.textContent);
              const sortedTitles = [...libraryTitles].sort((left, right) => left.localeCompare(right, 'it', {sensitivity:'base'}));
              assert(JSON.stringify(libraryTitles) === JSON.stringify(sortedTitles),
                'piece picker is alphabetically sorted by displayed title');
              assert(libraryTitles.includes('Anima Christi'), 'Anima Christi uses normal title casing');
              assert(libraryTitles.includes('qui-credit-in-me-non-sitiet-umquam'),
                'Qui credit uses the configured display title');
              els.settingsAudioOutputBluetooth.checked = true;
              els.settingsAudioOutputBluetooth.dispatchEvent(new Event('change'));
              assert(state.pianoRollDelayMs === 270, 'Bluetooth does not alter the piano roll delay');
              assert(state.plumeSettings.timeAdvanceMs === 320, 'Bluetooth applies 320 ms vocal trace advance');
              els.settingsAudioOutputStandard.checked = true;
              els.settingsAudioOutputStandard.dispatchEvent(new Event('change'));
              assert(state.plumeSettings.timeAdvanceMs === 270, 'standard output restores 270 ms vocal trace advance');
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
              const speed = document.querySelector('.speed-control');
              const speedSelect = document.querySelector('#playback-speed');
              const mixerButton = document.querySelector('#accompaniment-mode');
              const settingsButton = document.querySelector('#settings');
              const settingsIcon = settingsButton.querySelector('.settings-icon');
              const metronome = document.querySelector('.metronome-control');
              const metronomeVolume = document.querySelector('#metronome-volume');
              const toolbarRect = document.querySelector('#practice-toolbar').getBoundingClientRect();
              const transportGroupRect = document.querySelector('.practice-transport [aria-label="Trasporto"]').getBoundingClientRect();
              const mixerGroupRect = document.querySelector('.practice-transport .mixer-controls').getBoundingClientRect();
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
              assert(getComputedStyle(speed).display !== 'none' && speed.getBoundingClientRect().width > 0,
                'speed control is visible on mobile');
              assert([...speedSelect.options].map(option => option.textContent).join(',') === '100%,90%,80%',
                'speed control offers 100, 90 and 80 percent');
              speedSelect.value = '0.9';
              speedSelect.dispatchEvent(new Event('change'));
              await new Promise(resolve => setTimeout(resolve, 50));
              assert(state.clock.snapshot().speed === .9, 'mobile speed control updates playback speed');
              assert(getComputedStyle(mixerButton).display === 'none', 'standalone mobile mixer button is hidden');
              assert(settingsButton.querySelector('.settings-label').getBoundingClientRect().width === 0,
                'mobile settings text is replaced');
              assert(getComputedStyle(settingsIcon).display === 'block', 'mobile settings gear is visible');
              assert(getComputedStyle(metronome).display === 'flex', 'metronome control is visible');
              assert(metronomeVolume.getBoundingClientRect().width >= 44, 'metronome volume slider is usable');
              assert(transportGroupRect.left >= 35, 'transport controls move inward from the left edge');
              assert(transportGroupRect.right < mixerGroupRect.left, 'transport and metronome controls remain separated');
              assert(scoreHeight >= innerHeight * .28 && scoreHeight <= innerHeight * .32,
                'mobile score opens at about one third of the viewport');
              assert(pitchHeight > scoreHeight, 'the piano roll receives most of the available height');
              return {toolbarHeight: toolbarRect.height, titleWidth: title.getBoundingClientRect().width,
                partWidth: part.getBoundingClientRect().width, metronomeWidth: metronomeVolume.getBoundingClientRect().width,
                transportLeft: transportGroupRect.left, transportRight: transportGroupRect.right,
                mixerLeft: mixerGroupRect.left, scoreHeight, pitchHeight};
            })()""")
            toolbar_shot = command(socket, 121, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
            (ARTIFACTS / "mobile-controls-toolbar.png").write_bytes(base64.b64decode(toolbar_shot["data"]))

            mixer = evaluate(socket, 122, """(async () => {
              const assert = (value, message) => { if (!value) throw Error(message); };
              document.querySelector('#settings').click();
              const menuMixer = document.querySelector('#settings-menu-mixer');
              assert(getComputedStyle(menuMixer).display === 'grid', 'mixer is available inside mobile settings');
              menuMixer.click();
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
              document.querySelector('#settings').click();
              document.querySelector('#settings-menu-mixer').click();
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
