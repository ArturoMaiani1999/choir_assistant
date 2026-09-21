"""Exercise transposition, phrase practice and preferences in an isolated browser."""
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:5173/')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='choir-features-') as profile:
        process = subprocess.Popen([
            str(CHROME), '--headless=new', '--disable-gpu',
            '--autoplay-policy=no-user-gesture-required', '--remote-allow-origins=*',
            '--remote-debugging-port=0', f'--user-data-dir={profile}', args.url,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / 'DevToolsActivePort'
            for _ in range(100):
                try:
                    port = port_file.read_text().splitlines()[0]
                    break
                except (OSError, IndexError):
                    time.sleep(.05)
            else:
                raise RuntimeError('Chrome did not start')
            tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            page = next(tab for tab in tabs if tab.get('type') == 'page')
            socket = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=20)
            time.sleep(.8)
            result = evaluate(socket, 1, """(async () => {
              const assert = (value, message) => { if (!value) throw Error(message); };
              assert(state.runtime, 'runtime initialized');
              assert(els.transpose.options.length === 25, 'semitone and octave options');
              // Approval is stubbed in this isolated test profile, never persisted.
              state.bundleApproved = true;
              const ready = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(Error('transposed audio timeout')), 12000);
                els.backingAudio.addEventListener('loadedmetadata', () => {clearTimeout(timer); resolve();}, {once:true});
                els.backingAudio.addEventListener('error', () => reject(Error('transposed audio failed')), {once:true});
              });
              els.transpose.value = '-12'; els.transpose.dispatchEvent(new Event('change'));
              await ready;
              assert(els.backingAudio.duration > 1 && Number.isFinite(els.backingAudio.duration), 'transposed audio decoded');
              const target = state.runtime.targetAt(0);
              state.livePitch = target.midiPitch - 12;
              renderReadout(0, false);
              assert(els.liveState.textContent === 'centrato', 'transposed comparison centered');
              state.transpose = 0; renderReadout(0, false);
              assert(els.liveState.textContent.includes('ottava sotto'), 'octave feedback');
              state.transpose = -12;
              els.exercise.click();
              els.phraseStart.value = '0'; els.phraseEnd.value = '1'; els.phraseApply.click();
              assert(state.phrase.end === 1 && !els.exerciseDialog.open, 'phrase selected');
              state.autoLoop = true; state.attemptActive = true;
              state.clock.seekBeat(state.occurrenceMeasures[1].endBeat); render();
              await new Promise(resolve => setTimeout(resolve, 400));
              assert(state.clock.running && state.clock.snapshot().beat < 2, 'automatic loop restarts: ' + JSON.stringify({snapshot:state.clock.snapshot(),toast:els.toast.textContent,active:state.attemptActive}));
              state.clock.pause(); state.autoLoop = false; state.attemptActive = false;
              state.attempt = {voicedMs:2000, insideMs:1500}; finishAttempt();
              assert(els.resultDialog.open && els.resultText.textContent.startsWith('75%'), 'phrase summary');
              els.resultClose.click();
              state.attempt = {voicedMs:2000, insideMs:1600}; finishAttempt();
              assert(els.resultProgress.textContent.startsWith('+5'), 'comparable attempt progress');
              els.resultClose.click();
              state.attempt = {voicedMs:0, insideMs:0}; finishAttempt();
              assert(els.resultText.textContent.includes('insufficienti'), 'silence not scored');
              els.resultClose.click();
              savePreferences();
              return {duration:els.backingAudio.duration, transpose:state.transpose, phrase:state.phrase};
            })()""")
            command(socket, 2, 'Page.reload')
            time.sleep(.8)
            restored = evaluate(socket, 3, """({transpose:state.transpose, phrase:state.phrase})""")
            assert restored['transpose'] == -12 and restored['phrase']['end'] == 1, restored
            print(json.dumps({'features': result, 'restored': restored}, indent=2))
        finally:
            if socket:
                socket.close()
            process.terminate()
            process.wait(timeout=10)


if __name__ == '__main__':
    main()
