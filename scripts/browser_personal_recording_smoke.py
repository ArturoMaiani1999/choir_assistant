"""Verify the private-recording menu, consent gate, review, and save decision."""

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
    parser.add_argument("--url", default="http://127.0.0.1:5173/")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="choir-personal-recording-") as profile:
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
              els.libraryPiece.value = 'guarda-signore-i-doni';
              await updateLibraryParts();
              els.libraryPart.value = 'P3';
              els.libraryOpen.click();
              els.settingsAudioOutputStandard.checked = true;
              els.settingsAudioOutputStandard.dispatchEvent(new Event('change', {bubbles:true}));
              for (let attempt = 0; attempt < 200 && !state.runtime; attempt += 1)
                await new Promise(resolve => setTimeout(resolve, 50));
              assert(state.runtime, 'practice did not load');

              let savedMetadata = null;
              window.PersonalRecordings = {
                mine: async () => ({recordings: []}),
                save: async (metadata) => {
                  savedMetadata = metadata;
                  return {updated:false, recording:{id:'recording-one', pieceId:metadata.pieceId,
                    scoreVersionId:metadata.scoreVersionId, partId:metadata.partId, durationMs:metadata.durationMs,
                    audioOffsetMs:metadata.audioOffsetMs, playbackRate:metadata.playbackRate,
                    transpose:metadata.transpose, updatedAt:new Date().toISOString(),
                    audioUrl:'/api/recordings/recording-one/audio', pitchUrl:'/api/recordings/recording-one/pitch'}};
                },
                pitch: async () => ({version:1,samples:[]}),
                delete: async () => null,
              };
              els.settings.click();
              assert(!els.settingsMenu.hidden, 'settings menu did not open');
              els.settingsMenuRecording.click();
              await new Promise(resolve => setTimeout(resolve, 0));
              assert(els.personalRecordingDialog.open, 'recording dialog did not open');
              assert(els.personalRecordingStart.disabled, 'recording unlocked without consent');
              els.personalRecordingHeadphones.checked = true;
              els.personalRecordingHeadphones.dispatchEvent(new Event('change', {bubbles:true}));
              assert(els.personalRecordingStart.disabled, 'headphones alone unlocked recording');
              els.personalRecordingStorageConsent.checked = true;
              els.personalRecordingStorageConsent.dispatchEvent(new Event('change', {bubbles:true}));
              assert(!els.personalRecordingStart.disabled, 'consent plus headphones did not unlock recording');

              await startPersonalRecordingCapture();
              await new Promise(resolve => setTimeout(resolve, 900));
              assert(state.personalRecording.capture && !els.personalRecordingLive.hidden,
                'MediaRecorder capture did not start');
              stopPersonalRecordingCapture();
              for (let attempt = 0; attempt < 100 && !state.personalRecording.pending; attempt += 1)
                await new Promise(resolve => setTimeout(resolve, 25));
              assert(state.personalRecording.pending?.audio?.size > 0,
                'MediaRecorder did not produce a reviewable audio blob');
              discardPersonalRecordingPending();

              const pitchDocument = {version:1,totalBeats:48,durationMs:5000,audioOffsetMs:120,
                playbackRate:1,transpose:0,samples:[{beat:1,displayPitch:60,confidence:.8}]};
              state.personalRecording.pending = {pieceId:state.bundleManifest.piece_id,
                scoreVersionId:state.runtime.scoreVersionId,partId:state.runtime.selectedPartId,
                durationMs:5000,audioOffsetMs:120,playbackRate:1,transpose:0,
                audio:new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3])],{type:'audio/webm'}),pitchDocument};
              updatePersonalRecordingControls();
              assert(!els.personalRecordingReview.hidden, 'review controls stayed hidden');
              els.personalRecordingClose.click();
              assert(els.personalRecordingDialog.open, 'pending take closed without save/discard decision');
              await savePersonalRecording();
              assert(savedMetadata?.consent === true && savedMetadata?.headphonesConfirmed === true,
                'privacy confirmations were not sent to the profile API');
              assert(!state.personalRecording.pending && state.personalRecording.current?.id === 'recording-one',
                'saved recording did not replace pending state');
              assert(!els.personalRecordingReplay.hidden && !els.personalRecordingDelete.hidden,
                'saved recording controls are not available');
              return {menu:true, gate:'headphones+consent', decision:'required', saved:'owner-profile'};
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
