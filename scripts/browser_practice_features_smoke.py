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
            '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
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
            page = next(tab for tab in tabs if tab.get('type') == 'page' and tab.get('url', '').startswith(args.url))
            socket = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=20)
            for call_id in range(10, 90):
                if evaluate(socket, call_id, "typeof state !== 'undefined' && Boolean(state.runtime)"):
                    break
                time.sleep(.1)
            result = evaluate(socket, 1, """(async () => {
              const assert = (value, message) => { if (!value) throw Error(message); };
              assert(state.runtime, 'runtime initialized');
              assert(state.plumeSettings.timeAdvanceMs === 200, 'global default visual advance');
              assert(state.plumeSettings.width === 2.5, 'global default plume width is 250%');
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
              const target = state.runtime.targetEvents[0];
              const targetBeat = target.onsetBeat + Math.min(.01, target.durationBeats / 2);
              state.trackedPitch = target.midiPitch - 12;
              state.displayPitch = state.trackedPitch;
              renderReadout(targetBeat, false);
              assert(els.liveState.textContent === 'centrato', 'transposed comparison centered');
              state.transpose = 0; renderReadout(targetBeat, false);
              assert(els.liveState.textContent.includes('ottava sotto'), 'octave feedback');
              state.transpose = -12;
              els.exercise.click();
              els.phraseStart.value = '0'; els.phraseEnd.value = '1'; els.phraseApply.click();
              assert(state.phrase.end === 1 && !els.exerciseDialog.open, 'phrase selected');
              state.autoLoop = true; state.attemptActive = true;
              state.clock.seekBeat(state.occurrenceMeasures[1].endBeat); render();
              await new Promise(resolve => setTimeout(resolve, 400));
              assert(state.clock.running && state.clock.snapshot().beat < 2, 'automatic loop restarts: ' + JSON.stringify({snapshot:state.clock.snapshot(),toast:els.toast.textContent,active:state.attemptActive}));
              assert(state.microphoneStatus === 'active', 'Play automatically activates microphone');
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
              els.settings.click();
              assert(els.settingsDialog.open, 'settings dialog opens');
              assert(!document.querySelector('#settings-close'), 'settings dialog has no close button');
                assert(els.settingsV1PlumeAdvance.max === '400', 'visual pitch advance supports high-latency headphones');
                els.settingsV1PlumeAdvance.value = '400';
                els.settingsV1PlumeAdvance.dispatchEvent(new Event('input'));
                assert(state.plumeSettings.timeAdvanceMs === 400, 'visual pitch advance accepts 400 ms');
              els.settingsV1PlumeAdvance.value = '120';
              els.settingsV1PlumeAdvance.dispatchEvent(new Event('input'));
              els.settingsV1PlumeAdvance.dispatchEvent(new Event('change'));
              const settingsRect = els.settingsDialog.getBoundingClientRect();
              els.settingsDialog.dispatchEvent(new MouseEvent('click', {
                bubbles: true, clientX: settingsRect.left - 1, clientY: settingsRect.top - 1,
              }));
              assert(!els.settingsDialog.open, 'backdrop click closes settings dialog');
              assert(state.plumeSettings.timeAdvanceMs === 120, 'visual pitch advance setting');
              const sourceBeat = Math.min(10, totalBeats() - 1);
              const shiftedBeat = visuallyAdvancedPitchBeat(sourceBeat);
              const shiftedSeconds = state.runtime.secondsAtBeat(sourceBeat) - state.runtime.secondsAtBeat(shiftedBeat);
              assert(shiftedBeat < sourceBeat && Math.abs(shiftedSeconds - .12) < .002,
                'visual pitch advance is timestamp-only: ' + JSON.stringify({sourceBeat,shiftedBeat,shiftedSeconds}));
              els.settingsV1Rms.value = '0';
              els.settingsV1Rms.dispatchEvent(new Event('input'));
              assert(Math.abs(state.detectorSettings.rmsThreshold - .000001) < 1e-12,
                'extended quiet-voice sensitivity');
              assert(els.settingsV1RmsValue.textContent.startsWith('0,000001'), 'low RMS value remains readable');
              els.settingsWeakVoiceMode.checked = true;
              els.settingsWeakVoiceMode.dispatchEvent(new Event('change'));
              const weakRecognition = activeRecognitionSettings();
              assert(state.detectorSettings.weakVoiceMode
                && Math.abs(state.pitchSmoother.minConfidence - .10) < 1e-10
                && Math.abs(state.pitchSmoother.minClarity - .32) < 1e-10
                && state.pitchSmoother.weakSignalHoldFrames === 6
                && weakRecognition.rmsThreshold <= .00003
                && Math.abs(weakRecognition.yinThreshold - .68) < 1e-10
                && Math.abs(livePlumeSettings(0,false,100,0).minConfidence - .10) < 1e-10,
                'weak-voice mode lowers the complete recognition and rendering gates');
              savePreferences();
              const piecePreferences = JSON.parse(localStorage.getItem(preferenceKey()));
              for (const key of ['v1RmsThreshold','v1WeakVoiceMode','v1FastAlpha','v1SlowAlpha','v1MedianWindowFrames','v1PlumeWidth',
                'v1PlumeIntensity','v1PlumeColor','v1PlumeAdvanceMs','displayPitchAlgorithm','pitchLayerV1','pitchLayerCrepe']) delete piecePreferences[key];
              localStorage.setItem(preferenceKey(), JSON.stringify(piecePreferences));
              assert(JSON.parse(localStorage.getItem(GLOBAL_DETECTOR_PREFERENCES_KEY)).v1PlumeAdvanceMs === 120,
                'detector preferences saved globally');
              return {duration:els.backingAudio.duration, transpose:state.transpose, phrase:state.phrase,
                plumeAdvanceMs:state.plumeSettings.timeAdvanceMs, rmsThreshold:state.detectorSettings.rmsThreshold,
                weakVoiceMode:state.detectorSettings.weakVoiceMode};
            })()""")
            command(socket, 2, 'Page.reload')
            time.sleep(.8)
            restored = evaluate(socket, 3, """({transpose:state.transpose, phrase:state.phrase,
              plumeAdvanceMs:state.plumeSettings.timeAdvanceMs, rmsThreshold:state.detectorSettings.rmsThreshold,
              weakVoiceMode:state.detectorSettings.weakVoiceMode})""")
            assert (restored['transpose'] == 0 and restored['phrase'] is None
                    and restored['plumeAdvanceMs'] == 120 and abs(restored['rmsThreshold'] - .000001) < 1e-12
                    and restored['weakVoiceMode'] is True), restored
            print(json.dumps({'features': result, 'restored': restored}, indent=2))
        finally:
            if socket:
                socket.close()
            process.terminate()
            process.wait(timeout=10)


if __name__ == '__main__':
    main()
