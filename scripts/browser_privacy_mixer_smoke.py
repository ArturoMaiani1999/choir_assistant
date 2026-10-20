"""Verify microphone background cleanup and the singer-oriented default mix."""

from __future__ import annotations

import argparse
import json
import subprocess
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
        default="http://127.0.0.1:5173/",
    )
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="choir-privacy-mixer-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu",
            "--autoplay-policy=no-user-gesture-required", "--remote-allow-origins=*",
            "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
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
            for call_id in range(10, 110):
                if evaluate(socket, call_id, "typeof state !== 'undefined' && Boolean(state.library?.length) && els.libraryPart.options.length > 0"):
                    break
                time.sleep(.1)
            else:
                raise RuntimeError("Mode picker did not initialize")
            result = evaluate(socket, 1, """(async () => {
              const assert = (value, message) => { if (!value) throw Error(message); };
              assert(!state.runtime && els.piecePickerDialog.open, 'mode picker is not the initial screen');
              els.libraryPiece.value = 'guarda-signore-i-doni';
              await updateLibraryParts();
              els.libraryPart.value = 'P3';
              document.getElementById('library-voice-lab').click();
              assert(els.settingsDialog.open && els.settingsDialog.classList.contains('is-audio-output-prompt'),
                'voice training did not open the audio-output prompt immediately');
              els.settingsDialog.close();
              await new Promise(resolve => setTimeout(resolve, 0));
              els.libraryOpen.click();
              assert(els.settingsDialog.open && els.settingsDialog.classList.contains('is-audio-output-prompt'),
                'song practice did not open the audio-output prompt immediately');
              els.settingsAudioOutputStandard.checked = true;
              els.settingsAudioOutputStandard.dispatchEvent(new Event('change', {bubbles:true}));
              for (let attempt = 0; attempt < 200 && !state.runtime; attempt += 1)
                await new Promise(resolve => setTimeout(resolve, 50));
              assert(state.runtime && !els.settingsDialog.open && !els.piecePickerDialog.open,
                'choosing an output did not continue into song practice');
              openDetectorSettings('basic');
              els.settingsAudioOutputBluetooth.checked = true;
              els.settingsAudioOutputBluetooth.dispatchEvent(new Event('change', {bubbles:true}));
              assert(els.settingsDialog.open && !els.settingsDialog.classList.contains('is-audio-output-prompt'),
                'changing the output from manually opened settings closed the dialog');
              els.settingsDialog.close();
              let cachedChoiceContinued = false;
              requestAudioOutputForEntry(() => { cachedChoiceContinued = true; });
              assert(cachedChoiceContinued && !els.settingsDialog.open,
                'a valid recent choice unnecessarily reopened the prompt');
              const voiceIds = Object.keys(state.backingManifest.voice_stems);
              assert(state.selectedVoiceIds.size === voiceIds.length, 'all voices enabled by default');
              assert(state.voiceLevels.get(state.runtime.selectedPartId) === 1, 'own voice is 100%');
              assert(voiceIds.filter(id => id !== state.runtime.selectedPartId)
                .every(id => state.voiceLevels.get(id) === .5), 'other voices are 50%');
              assert(state.accompanimentLevel === .4, 'accompaniment is 40%');
              await togglePlayback();
              assert(state.clock.running && state.microphoneStatus === 'active',
                'exercise did not start with the microphone');
              const navigationTracks = state.microphoneStream.getTracks();
              await navigateToMeasure(Math.min(1, state.occurrenceMeasures.length - 1));
              assert(state.clock.running && state.microphoneStatus === 'active',
                'measure navigation did not resume the exercise microphone');
              assert(navigationTracks.every(track => track.readyState === 'ended'),
                'measure navigation kept the previous microphone stream open');
              const pausedTracks = state.microphoneStream.getTracks();
              await togglePlayback();
              assert(!state.clock.running && state.microphoneStatus === 'idle',
                'manual pause did not release the microphone');
              assert(pausedTracks.every(track => track.readyState === 'ended'),
                'manual pause left a microphone track open');
              await togglePlayback();
              const settingsTracks = state.microphoneStream.getTracks();
              els.settings.click();
              await new Promise(resolve => setTimeout(resolve, 100));
              assert(!state.clock.running && state.microphoneStatus === 'idle',
                'opening settings did not pause and release the microphone');
              assert(settingsTracks.every(track => track.readyState === 'ended'),
                'opening settings left a microphone track open');
              closeSettingsMenu();
              await togglePlayback();
              const resultTracks = state.microphoneStream.getTracks();
              state.clock.pause();
              state.attempt = {voicedMs: 2000, insideMs: 1500};
              finishAttempt();
              await new Promise(resolve => setTimeout(resolve, 100));
              assert(els.resultDialog.open && state.microphoneStatus === 'idle',
                'results left the microphone active');
              assert(resultTracks.every(track => track.readyState === 'ended'),
                'results left a microphone track open');
              els.resultDialog.close();
              await togglePlayback();
              const analysisTracks = state.microphoneStream.getTracks();
              await openPerformanceAnalysis({
                id: 'privacy-smoke', pieceId: state.bundleManifest.piece_id,
                partId: state.runtime.selectedPartId, score: 75, coverageRatio: .8,
                owner: {displayName: 'Privacy smoke'},
              });
              assert(!state.clock.running && state.microphoneStatus === 'idle',
                'performance analysis left the microphone active');
              assert(analysisTracks.every(track => track.readyState === 'ended'),
                'performance analysis left a microphone track open');
              PerformanceReview.close();
              await toggleMicrophone();
              assert(state.microphoneStatus === 'active', 'microphone did not activate');
              const tracks = state.microphoneStream.getTracks();
              Object.defineProperty(document, 'visibilityState', {value:'hidden', configurable:true});
              document.dispatchEvent(new Event('visibilitychange'));
              await new Promise(resolve => setTimeout(resolve, 100));
              assert(state.microphoneStatus === 'idle', 'microphone state stayed active in background');
              assert(tracks.every(track => track.readyState === 'ended'), 'a microphone track stayed open');
              delete document.visibilityState;
              const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
              let resolveRequest, delayedTrackStopped = false;
              navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { resolveRequest = resolve; });
              const pendingRequest = toggleMicrophone();
              Object.defineProperty(document, 'visibilityState', {value:'hidden', configurable:true});
              document.dispatchEvent(new Event('visibilitychange'));
              resolveRequest({getTracks: () => [{stop: () => { delayedTrackStopped = true; }}]});
              await pendingRequest;
              assert(delayedTrackStopped && state.microphoneStatus === 'idle',
                'a pending permission request reactivated the microphone in background');
              navigator.mediaDevices.getUserMedia = originalGetUserMedia;
              return {entryPrompts:['song','voice-lab'], own:100, others:50, accompaniment:40, microphone:'released'};
            })()""")
            print(json.dumps(result, ensure_ascii=False))
            return 0
        finally:
            if socket:
                try:
                    command(socket, 999, "Browser.close")
                except Exception:
                    pass
                socket.close()
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    raise SystemExit(main())
