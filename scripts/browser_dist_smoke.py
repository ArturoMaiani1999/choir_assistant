"""Smoke-test the static release candidate in a real Chromium instance."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

import websocket

CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def command(socket, call_id, method, params=None):
    socket.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
    while True:
        message = json.loads(socket.recv())
        if message.get("id") != call_id:
            continue
        if message.get("result", {}).get("exceptionDetails"):
            raise RuntimeError(message["result"]["exceptionDetails"])
        return message.get("result", {})


def evaluate(socket, call_id, expression):
    result = command(socket, call_id, "Runtime.evaluate", {
        "expression": expression,
        "returnByValue": True,
        "awaitPromise": True,
    })
    return result["result"].get("value")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--url",
        default="https://127.0.0.1:8788/?piece=ave-verum&part=P3",
    )
    args = parser.parse_args()
    parsed_url = urlsplit(args.url)
    expected_origin = f"{parsed_url.scheme}://{parsed_url.netloc}"
    query = parse_qs(parsed_url.query)
    expected_piece = query.get("piece", ["ave-verum"])[0]
    expected_part = query.get("part", ["P3"])[0]
    sys.stdout.reconfigure(encoding="utf-8")

    with tempfile.TemporaryDirectory(prefix="choir-dist-smoke-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu",
            "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required",
            "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
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
            command(socket, 5, "Emulation.setDeviceMetricsOverride", {
                "width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False,
            })
            command(socket, 3, "Page.addScriptToEvaluateOnNewDocument", {"source": r"""
              window.__releaseSmokeErrors = [];
              try {
                localStorage.setItem('choir-detector-settings:v1', JSON.stringify({v1PlumeWidth: 1}));
              } catch (_) {}
              window.__getUserMediaCalls = 0;
              if (navigator.mediaDevices?.getUserMedia) {
                const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia = (...args) => {
                  window.__getUserMediaCalls += 1;
                  return nativeGetUserMedia(...args);
                };
              }
              addEventListener('error', event => window.__releaseSmokeErrors.push({
                kind: 'error', message: event.message || 'resource error',
                resource: event.target?.src || event.target?.href || null
              }), true);
              addEventListener('unhandledrejection', event => window.__releaseSmokeErrors.push({
                kind: 'rejection', message: String(event.reason?.message || event.reason)
              }));
              addEventListener('securitypolicyviolation', event => window.__releaseSmokeErrors.push({
                kind: 'csp', message: event.violatedDirective, resource: event.blockedURI
              }));
              const nativeFetch = window.fetch.bind(window);
              window.fetch = (...args) => nativeFetch(...args).then(response => {
                if (!response.ok) window.__releaseSmokeErrors.push({
                  kind: 'fetch', message: String(response.status), resource: response.url
                });
                return response;
              });
            """})
            command(socket, 4, "Page.navigate", {"url": args.url})

            call_id = 10
            for _ in range(160):
                ready = evaluate(socket, call_id, """Boolean(
                  typeof state !== 'undefined' && state.runtime && state.bundleManifest
                  && document.querySelector('#score-image')?.complete
                  && document.querySelector('#score-image')?.naturalWidth
                )""")
                call_id += 1
                if ready:
                    break
                time.sleep(.1)
            else:
                diagnostics = evaluate(socket, call_id, """({
                  loading: document.querySelector('#score-loading')?.textContent,
                  scoreSource: document.querySelector('#score-image')?.currentSrc,
                  scoreComplete: document.querySelector('#score-image')?.complete,
                  scoreNaturalWidth: document.querySelector('#score-image')?.naturalWidth,
                  runtimeReady: typeof state !== 'undefined' && Boolean(state.runtime),
                  bundleReady: typeof state !== 'undefined' && Boolean(state.bundleManifest),
                  pageTitle: document.querySelector('#piece-title')?.textContent,
                  errors: window.__releaseSmokeErrors
                })""")
                raise AssertionError(
                    "La pagina di pratica non è pronta: "
                    + json.dumps(diagnostics, ensure_ascii=False)
                )

            visual_delay = evaluate(socket, call_id, """(() => {
              const advance = state.plumeSettings.timeAdvanceMs;
              const snapshot = { performanceTime: 3, speed: .75 };
              const actualBeat = state.runtime.beatAtSeconds(snapshot.performanceTime);
              const delayed = currentPianoRollBeat(snapshot);
              const slider = els.settingsPianoRollDelay;
              const initial = { value: slider.value, label: els.settingsPianoRollDelayValue.textContent,
                ms: state.pianoRollDelayMs, beat: delayed };
              slider.value = '250'; slider.dispatchEvent(new Event('input'));
              slider.dispatchEvent(new Event('change'));
              const changed = { ms: state.pianoRollDelayMs, beat: currentPianoRollBeat(snapshot),
                advance: state.plumeSettings.timeAdvanceMs,
                stored: JSON.parse(localStorage.getItem(GLOBAL_DETECTOR_PREFERENCES_KEY)).pianoRollDelayMs };
              slider.value = '150'; slider.dispatchEvent(new Event('input'));
              slider.dispatchEvent(new Event('change'));
              return { initial, changed, actualBeat, restored: state.pianoRollDelayMs, advance };
            })()""")
            call_id += 1
            assert visual_delay["initial"]["ms"] == 150 and visual_delay["initial"]["label"] == "150 ms", visual_delay
            assert visual_delay["initial"]["beat"] < visual_delay["actualBeat"], visual_delay
            assert visual_delay["changed"]["ms"] == visual_delay["changed"]["stored"] == 250, visual_delay
            assert visual_delay["changed"]["beat"] < visual_delay["initial"]["beat"], visual_delay
            assert visual_delay["changed"]["advance"] == visual_delay["advance"], visual_delay
            assert visual_delay["restored"] == 150, visual_delay

            pitch_history_alignment = evaluate(socket, call_id, """(() => {
              const previous = { samples: state.pitchSamples, takeId: state.pitchTakeId,
                inspect: state.gridInspect, viewport: state.pitchViewport, render: fluidTrailRenderer.render };
              const beat = Math.min(12, totalBeats() - 2);
              const sample = { beat: beat - 1, displayPitch: 60, trackedPitch: 60,
                confidence: 1, clarity: 1, takeId: 777 };
              const canvas = els.pitchLane;
              const width = canvas.getBoundingClientRect().width;
              const left = width < 700 ? 48 : 58, right = width - 8;
              const beatAtX = (x, zoom) => {
                const history = UI_CONFIG.historyBeats / zoom;
                const future = UI_CONFIG.futureBeats / zoom;
                const nowX = timeToX(beat, beat, left, right, history, future);
                return beat + (x - nowX) * (history + future) / (right - left);
              };
              let capturedX = null;
              try {
                state.pitchSamples = [sample];
                state.pitchTakeId = sample.takeId;
                fluidTrailRenderer.render = (_samples, xAt) => { capturedX = xAt(sample); return true; };
                state.gridInspect = { ...previous.inspect, active: false };
                drawPitchLane(beat);
                const liveBeat = beatAtX(capturedX, 1);
                state.gridInspect = { ...previous.inspect, active: true, viewBeat: beat,
                  timeZoom: .55, pitchZoom: 1 };
                drawPitchLane(beat);
                const reviewBeat = beatAtX(capturedX, state.gridInspect.timeZoom);
                return { liveBeat, reviewBeat, expectedBeat: visuallyAdvancedPitchBeat(sample.beat),
                  timeZoom: state.gridInspect.timeZoom };
              } finally {
                state.pitchSamples = previous.samples;
                state.pitchTakeId = previous.takeId;
                state.gridInspect = previous.inspect;
                state.pitchViewport = previous.viewport;
                fluidTrailRenderer.render = previous.render;
                render();
              }
            })()""")
            call_id += 1
            assert pitch_history_alignment["timeZoom"] < 1, pitch_history_alignment
            assert abs(pitch_history_alignment["liveBeat"] - pitch_history_alignment["reviewBeat"]) < .001, pitch_history_alignment
            assert abs(pitch_history_alignment["reviewBeat"] - pitch_history_alignment["expectedBeat"]) < .001, pitch_history_alignment

            voice_mix = evaluate(socket, call_id, """(async () => {
              const allIds = Object.keys(state.backingManifest?.voice_stems ?? {});
              await state.playbackMixer.resume([els.backingAudio, ...state.voiceStemAudio.values()]);
              await state.clock.play();
              await new Promise(resolve => setTimeout(resolve, 250));
              const beforeSwitch = state.clock.snapshot().performanceTime;
              const canSeekToBefore = () => [...Array(els.backingAudio.seekable.length).keys()]
                .some(index => els.backingAudio.seekable.start(index) <= beforeSwitch
                  && els.backingAudio.seekable.end(index) + .01 >= beforeSwitch);
              await applyVoiceSelection(allIds);
              const full = {
                kind: state.playbackPlan?.kind,
                stems: state.voiceStemAudio.size,
                source: document.querySelector('#backing-audio')?.currentSrc,
                running: state.clock.running,
                canSeek: canSeekToBefore(),
                performanceTime: state.clock.snapshot().performanceTime
              };
              await applyVoiceSelection([state.runtime.selectedPartId]);
              const own = {
                kind: state.playbackPlan?.kind,
                stems: state.voiceStemAudio.size,
                stemUrls: [...state.voiceStemAudio.values()].map(audio => audio.currentSrc || audio.src),
                source: document.querySelector('#backing-audio')?.currentSrc,
                running: state.clock.running,
                canSeek: canSeekToBefore(),
                performanceTime: state.clock.snapshot().performanceTime
              };
              state.voiceLevels.set(state.runtime.selectedPartId, .35);
              state.accompanimentEnabled = false;
              state.accompanimentLevel = 0;
              state.transpose = 3;
              state.playbackMixer.setTranspose(3);
              els.playbackSpeed.value = '0.75';
              await applyVoiceSelection([state.runtime.selectedPartId]);
              await new Promise(resolve => setTimeout(resolve, 80));
              const pitchRatios = [...state.playbackMixer.channels.entries()]
                .filter(([media]) => state.playbackMixer.levels.get(media) > 0)
                .map(([, channel]) => channel.pitch?.parameters?.get('ratio')?.value).filter(Number.isFinite);
              const custom = {
                kind: state.playbackPlan?.kind,
                stems: state.voiceStemAudio.size,
                masterPartId: state.playbackPlan?.masterPartId,
                source: els.backingAudio.currentSrc,
                accompanimentEnabled: state.accompanimentEnabled,
                backingMuted: els.backingAudio.muted || state.playbackMixer.levels.get(els.backingAudio) === 0,
                masterLevel: state.playbackMixer.levels.get(els.backingAudio),
                speed: state.clock.snapshot().speed,
                preservesPitch: els.backingAudio.preservesPitch
                  && [...state.voiceStemAudio.values()].every(audio => audio.preservesPitch),
                workletReady: state.playbackMixer.workletReady,
                pitchRatios
              };
              await applyVoiceSelection(['P1']);
              custom.sopranoOnly = {
                source: els.backingAudio.currentSrc,
                masterPartId: state.playbackPlan?.masterPartId,
                otherStems: state.voiceStemAudio.size,
                muted: els.backingAudio.muted,
                level: state.playbackMixer.levels.get(els.backingAudio)
              };
              els.playbackSpeed.value = '0.5';
              await applyVoiceSelection([state.runtime.selectedPartId]);
              custom.halfSpeed = state.clock.snapshot().speed;
              custom.halfSpeedPreservesPitch = els.backingAudio.preservesPitch
                && [...state.voiceStemAudio.values()].every(audio => audio.preservesPitch);
              state.clock.pause();
              seekToMeasure(0, false, false);
              document.querySelector('#next-measure').click();
              const navigationIndex = Math.min(1, state.occurrenceMeasures.length - 1);
              const navigationSeconds = state.runtime.secondsAtBeat(state.occurrenceMeasures[navigationIndex].startBeat);
              const navigationSeekable = [...Array(els.backingAudio.seekable.length).keys()]
                .some(index => els.backingAudio.seekable.start(index) <= navigationSeconds
                  && els.backingAudio.seekable.end(index) + .01 >= navigationSeconds);
              const navigation = {canSeek:navigationSeekable, index:navigationIndex,
                expectedBeat:state.occurrenceMeasures[navigationIndex].startBeat,
                actualBeat:playbackSnapshot().beat,
                cue:document.querySelector('#scoring-cue').textContent};
              return {available: allIds.length, beforeSwitch, full, own, custom, navigation};
            })()""")
            call_id += 1
            audio_assets = evaluate(socket, call_id, """(async () => {
              const root = state.bundleManifest.assets.audio_root;
              const files = [state.backingManifest.full_mix_file,
                state.backingManifest.accompaniment_file,
                ...Object.values(state.backingManifest.voice_stems ?? {})].filter(Boolean);
              const context = new AudioContext();
              try {
                const output = {};
                for (const file of files) {
                  const response = await fetch(`${root}/${file}`);
                  const buffer = await context.decodeAudioData(await response.arrayBuffer());
                  const samples = buffer.getChannelData(0);
                  let energy = 0;
                  for (let index = 0; index < samples.length; index += 400) energy += samples[index] ** 2;
                  output[file] = Math.sqrt(energy / Math.ceil(samples.length / 400));
                }
                return output;
              } finally { await context.close(); }
            })()""")
            call_id += 1
            microphone = evaluate(socket, call_id, """(async () => {
              await toggleMicrophone();
              await new Promise(resolve => setTimeout(resolve, 700));
              const result = {
                status: state.microphoneStatus,
                worker: Boolean(state.pitchWorker),
                workerDisabled: state.pitchWorkerDisabled
              };
              await stopMicrophone();
              return result;
            })()""")
            call_id += 1
            preliminary_result = evaluate(socket, call_id, """(async () => {
              state.attempt = {voicedMs: 2400, insideMs: 1800};
              state.attemptActive = true;
              await state.clock.play();
              await new Promise(resolve => setTimeout(resolve, 40));
              await togglePlayback();
              const dialog = document.querySelector('#result-dialog');
              const pausedWithoutDialog = !dialog.open;
              const feedback = document.querySelector('#show-feedback');
              const feedbackVisible = !feedback.hidden;
              feedback.click();
              const result = {
                open: dialog.open,
                pausedWithoutDialog,
                feedbackVisible,
                preliminary: dialog.dataset.preliminary,
                heading: document.querySelector('#result-heading').textContent,
                text: document.querySelector('#result-text').textContent,
                progress: document.querySelector('#result-progress').textContent,
                resumeVisible: !document.querySelector('#result-resume').hidden,
                attemptActive: state.attemptActive,
                running: state.clock.running
              };
              dialog.close();
              return result;
            })()""")
            call_id += 1
            mixer_layout = evaluate(socket, call_id, """(async () => {
              renderVoiceMixer();
              const dialog = document.querySelector('#voice-mixer-dialog');
              if (!dialog.open) dialog.showModal();
              await new Promise(resolve => requestAnimationFrame(resolve));
              const channels = [...dialog.querySelectorAll('.mixer-channel')];
              const faders = channels.map(channel => channel.querySelector('input[type=range]').getBoundingClientRect());
              const ownChannel = channels.find(channel => channel.querySelector('.mixer-channel-heading strong')?.textContent
                === state.runtime.parts.find(part => part.id === state.runtime.selectedPartId)?.name);
              ownChannel.querySelector('.mixer-mute').click();
              const mutedOwnChannel = [...dialog.querySelectorAll('.mixer-channel')].find(channel =>
                channel.querySelector('.mixer-channel-heading strong')?.textContent
                  === state.runtime.parts.find(part => part.id === state.runtime.selectedPartId)?.name);
              const muted = {
                selected: state.selectedVoiceIds.has(state.runtime.selectedPartId),
                label: mutedOwnChannel.querySelector('.mixer-mute').textContent,
                pressed: mutedOwnChannel.querySelector('.mixer-mute').getAttribute('aria-pressed'),
                disabled: mutedOwnChannel.querySelector('input[type=range]').disabled
              };
              await applyVoiceSelection([]);
              const allMuted = {
                label: els.accompanimentMode.textContent,
                plan: state.playbackPlan?.kind,
                source: els.backingAudio.getAttribute('src'),
                disabled: els.togglePlayback.disabled,
                stems: state.voiceStemAudio.size
              };
              await applyVoiceSelection([state.runtime.selectedPartId]);
              state.accompanimentEnabled = true;
              await applyVoiceSelection([state.runtime.selectedPartId]);
              els.voiceMixerOwn.click();
              const ownPreset = {
                organ: state.accompanimentEnabled,
                source: state.playbackPlan?.masterFile,
                voice: state.playbackPlan?.masterPartId,
                otherStems: state.voiceStemAudio.size
              };
              els.voiceMixerAll.click();
              const allVoicesPreset = {
                organ: state.accompanimentEnabled,
                source: state.playbackPlan?.masterFile,
                otherStems: state.voiceStemAudio.size
              };
              const rect = dialog.getBoundingClientRect();
              return {
                width: rect.width,
                channels: channels.length,
                columns: getComputedStyle(dialog.querySelector('.mixer-console')).gridTemplateColumns.split(' ').length,
                verticalFaders: faders.every(rectangle => rectangle.height > rectangle.width * 3),
                labels: channels.map(channel => channel.querySelector('.mixer-mute').textContent),
                overflow: dialog.scrollWidth > dialog.clientWidth,
                muted, allMuted, ownPreset, allVoicesPreset
              };
            })()""")
            call_id += 1
            command(socket, call_id, "Emulation.setDeviceMetricsOverride", {
                "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True,
            })
            call_id += 1
            mixer_mobile = evaluate(socket, call_id, """(async () => {
              await new Promise(resolve => requestAnimationFrame(resolve));
              const dialog = document.querySelector('#voice-mixer-dialog');
              return {
                columns: getComputedStyle(dialog.querySelector('.mixer-console')).gridTemplateColumns.split(' ').length,
                overflow: dialog.scrollWidth > dialog.clientWidth,
                width: dialog.getBoundingClientRect().width,
                viewport: innerWidth
              };
            })()""")
            call_id += 1
            command(socket, call_id, "Emulation.setDeviceMetricsOverride", {
                "width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False,
            })
            call_id += 1
            keyboard_mixer_setup = evaluate(socket, call_id, """(() => {
              state.clock.pause(); state.attemptActive = false; state.attempt = {voicedMs:0, insideMs:0};
              const opener = document.querySelector('#accompaniment-mode');
              const dialog = document.querySelector('#voice-mixer-dialog');
              dialog.close(); opener.focus(); opener.click();
              document.querySelector('#voice-mixer-close').click();
              return {dialogClosed: !dialog.open, focusRestored: document.activeElement === opener};
            })()""")
            call_id += 1
            assert keyboard_mixer_setup == {"dialogClosed": True, "focusRestored": True}, keyboard_mixer_setup
            command(socket, call_id, "Input.dispatchKeyEvent", {
                "type": "keyDown", "key": " ", "code": "Space", "windowsVirtualKeyCode": 32,
            })
            call_id += 1
            command(socket, call_id, "Input.dispatchKeyEvent", {
                "type": "keyUp", "key": " ", "code": "Space", "windowsVirtualKeyCode": 32,
            })
            call_id += 1
            mixer_space = evaluate(socket, call_id, """(async () => {
              const dialog = document.querySelector('#voice-mixer-dialog');
              for (let i = 0; i < 60 && !state.clock.running && !dialog.open; i++)
                await new Promise(resolve => setTimeout(resolve, 50));
              const result = {running: state.clock.running, dialogOpen: dialog.open};
              state.clock.pause(); state.attemptActive = false;
              if (dialog.open) dialog.close();
              return result;
            })()""")
            call_id += 1
            assert mixer_space["running"] and not mixer_space["dialogOpen"], mixer_space
            inspection_probe = evaluate(socket, call_id, """(() => {
              state.clock.pause(); state.pendingAudioTime = null;
              const resumeIndex = Math.min(2, state.occurrenceMeasures.length - 1);
              const measure = state.occurrenceMeasures[resumeIndex];
              const checkpoint = measure.startBeat + Math.min(1, (measure.endBeat - measure.startBeat) / 2);
              state.scoringStartBeat = 0;
              state.attemptActive = true;
              state.resumeCheckpointBeat = null;
              rememberAttemptCheckpoint(checkpoint);
              state.pitchSamples.push({beat:state.resumeCheckpointBeat - .1, displayPitch:60,
                trackedPitch:60, takeId:state.pitchTakeId, confidence:1, clarity:1});
              const rect = document.querySelector('#pitch-lane').getBoundingClientRect();
              return {startX: rect.left + rect.width * .72, endX: rect.left + rect.width * .42,
                y: rect.top + rect.height * .5, checkpoint:state.resumeCheckpointBeat,
                pausedBeat:state.clock.snapshot().beat, samples:state.pitchSamples.length};
            })()""")
            call_id += 1
            command(socket, call_id, "Input.dispatchMouseEvent", {
                "type": "mousePressed", "x": inspection_probe["startX"], "y": inspection_probe["y"], "button": "left", "clickCount": 1,
            })
            call_id += 1
            command(socket, call_id, "Input.dispatchMouseEvent", {
                "type": "mouseMoved", "x": inspection_probe["endX"], "y": inspection_probe["y"], "button": "left", "buttons": 1,
            })
            call_id += 1
            command(socket, call_id, "Input.dispatchMouseEvent", {
                "type": "mouseReleased", "x": inspection_probe["endX"], "y": inspection_probe["y"], "button": "left", "clickCount": 1,
            })
            call_id += 1
            inspection_result = evaluate(socket, call_id, """(async () => {
              const afterDrag = {active:state.gridInspect.active, viewBeat:state.gridInspect.viewBeat,
                checkpoint:state.resumeCheckpointBeat, pausedBeat:state.clock.snapshot().beat,
                samples:state.pitchSamples.length};
              const resumeIndex = measureIndexAt(state.resumeCheckpointBeat);
              const expectedStart = state.occurrenceMeasures[Math.max(0, resumeIndex - 1)].startBeat;
              const prepared = prepareAttemptResume();
              const preparedBeat = playbackSnapshot().beat;
              await togglePlayback();
              await new Promise(resolve => setTimeout(resolve, 40));
              const resumed = {running:state.clock.running, playback:state.clock.snapshot().beat,
                scoring:state.scoringStartBeat, inspectActive:state.gridInspect.active,
                samples:state.pitchSamples.length, expectedStart, prepared, preparedBeat};
              state.clock.pause(); state.attemptActive = false; state.resumeCheckpointBeat = null;
              return {afterDrag, resumed};
            })()""")
            call_id += 1
            resize = evaluate(socket, call_id, """(async () => {
              const before = {score:els.scoreViewport.clientHeight, bitmap:els.pitchLane.height};
              const limits = scoreHeightLimits();
              const target = before.score - 36 >= limits.minimum
                ? before.score - 36 : Math.min(limits.maximum, before.score + 36);
              setScoreHeight(target);
              await new Promise(resolve => requestAnimationFrame(resolve));
              const rect = els.pitchLane.getBoundingClientRect();
              const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
              return {before, score:els.scoreViewport.clientHeight, bitmap:els.pitchLane.height,
                css:rect.height, expected:Math.round(rect.height * dpr)};
            })()""")
            call_id += 1
            result = evaluate(socket, call_id, """(() => ({
              mode: window.ChoirRuntimeConfig?.mode,
              buildVersion: window.ChoirRuntimeConfig?.buildVersion,
              pieces: state.library.map(piece => piece.piece_id),
              bundlePiece: state.bundleManifest?.piece_id,
              published: state.bundleManifest?.published,
              selectedPart: state.runtime?.selectedPartId,
              plumeWidth: state.plumeSettings.width,
              plumeWidthSlider: document.querySelector('#settings-v1-plume-width')?.value,
              plumeWidthLabel: document.querySelector('#settings-v1-plume-width-value')?.textContent,
              transposeChoices: document.querySelector('#transpose')?.options.length,
              transposeLabel: document.querySelector('.transpose-control > span')?.textContent,
              transposeValue: document.querySelector('#transpose-value')?.textContent,
              phraseUiRemoved: !document.querySelector('#exercise') && !document.querySelector('#exercise-dialog'),
              advancedUiRemoved: document.querySelector('#ground-truth')?.offsetParent === null,
              mixerChannels: document.querySelectorAll('#voice-mixer-dialog .mixer-channel').length,
              metronomeOffset: state.metronomeOffsetMs,
              metronomeOffsetControl: document.querySelector('#settings-metronome-offset')?.value,
              diagnosticsHidden: document.querySelector('#benchmark')?.hidden
                && document.querySelector('#admin-review')?.hidden,
              scoreReady: Boolean(document.querySelector('#score-image')?.naturalWidth),
              audioSource: document.querySelector('#backing-audio')?.currentSrc,
              errors: window.__releaseSmokeErrors,
              resources: performance.getEntriesByType('resource').map(entry => entry.name)
            }))()""")
            call_id += 1

            external = []
            for resource in result["resources"]:
                parsed = urlsplit(resource)
                if parsed.scheme in {"data", "blob", ""}:
                    continue
                origin = f"{parsed.scheme}://{parsed.netloc}"
                if origin != expected_origin:
                    external.append(resource)

            assert result["mode"] == "production", result
            assert expected_piece in result["pieces"], result
            assert result["bundlePiece"] == expected_piece and result["published"] is True, result
            assert result["selectedPart"] == expected_part, result
            assert result["plumeWidth"] == 2.5 and result["plumeWidthSlider"] == "250" and result["plumeWidthLabel"] == "250%", result
            assert result["transposeChoices"] == 25 and result["diagnosticsHidden"], result
            assert result["transposeLabel"] == "Transpose" and result["transposeValue"] == "±0", result
            assert result["phraseUiRemoved"] and result["advancedUiRemoved"], result
            assert result["mixerChannels"] == 5, result
            assert result["metronomeOffset"] == 30 and result["metronomeOffsetControl"] == "30", result
            assert result["scoreReady"] and f"/library-assets/{expected_piece}/" in result["audioSource"], result
            if voice_mix["available"]:
                assert all(level > .0001 for level in audio_assets.values()), audio_assets
                assert voice_mix["full"]["kind"] == "full-mix" and voice_mix["full"]["stems"] == 0, voice_mix
                assert urlsplit(voice_mix["full"]["source"]).path.endswith("/score.mp3"), voice_mix
                assert voice_mix["own"]["kind"] == "stem-mix" and voice_mix["own"]["stems"] == 1, voice_mix
                assert all(parse_qs(urlsplit(url).query).get("v") == [result["buildVersion"]]
                           for url in voice_mix["own"]["stemUrls"]), voice_mix
                assert voice_mix["full"]["running"] and voice_mix["own"]["running"], voice_mix
                if voice_mix["full"]["canSeek"]:
                    assert voice_mix["full"]["performanceTime"] >= voice_mix["beforeSwitch"] - .1, voice_mix
                if voice_mix["own"]["canSeek"]:
                    assert voice_mix["own"]["performanceTime"] >= voice_mix["beforeSwitch"] - .1, voice_mix
                custom = voice_mix["custom"]
                assert custom["kind"] == "stem-mix" and custom["stems"] == 0, custom
                assert custom["masterPartId"] == expected_part, custom
                assert urlsplit(custom["source"]).path.endswith(f"/voice-{expected_part}.mp3"), custom
                assert parse_qs(urlsplit(custom["source"]).query).get("v") == [result["buildVersion"]], custom
                assert custom["accompanimentEnabled"] is False and not custom["backingMuted"], custom
                assert 0 < custom["masterLevel"] < .36, custom
                soprano_only = custom["sopranoOnly"]
                assert urlsplit(soprano_only["source"]).path.endswith("/voice-P1.mp3"), soprano_only
                assert soprano_only["masterPartId"] == "P1" and soprano_only["otherStems"] == 0, soprano_only
                assert soprano_only["muted"] is False and soprano_only["level"] > 0, soprano_only
                assert custom["speed"] == .75 and custom["preservesPitch"], custom
                assert custom["halfSpeed"] == .5 and custom["halfSpeedPreservesPitch"], custom
                assert custom["workletReady"] and custom["pitchRatios"], custom
                expected_ratio = 2 ** (3 / 12)
                assert all(abs(value - expected_ratio) < .001 for value in custom["pitchRatios"]), custom
                navigation = voice_mix["navigation"]
                assert abs(navigation["actualBeat"] - navigation["expectedBeat"]) < .01, navigation
                assert "ingresso da 2" in navigation["cue"].lower(), navigation
            assert microphone == {"status": "active", "worker": True, "workerDisabled": False}, microphone
            assert preliminary_result["pausedWithoutDialog"] and preliminary_result["feedbackVisible"], preliminary_result
            assert preliminary_result["open"] and preliminary_result["preliminary"] == "true", preliminary_result
            assert preliminary_result["heading"] == "Risultati preliminari", preliminary_result
            assert "75%" in preliminary_result["text"] and "battuta" in preliminary_result["progress"], preliminary_result
            assert preliminary_result["resumeVisible"], preliminary_result
            assert preliminary_result["attemptActive"] and not preliminary_result["running"], preliminary_result
            assert mixer_layout["width"] >= 850 and mixer_layout["channels"] == 5, mixer_layout
            assert mixer_layout["columns"] == 5 and mixer_layout["verticalFaders"], mixer_layout
            assert set(mixer_layout["labels"]) <= {"Mute", "Unmute"} and not mixer_layout["overflow"], mixer_layout
            assert mixer_layout["muted"] == {"selected": False, "label": "Unmute", "pressed": "true", "disabled": True}, mixer_layout
            assert mixer_layout["allMuted"] == {"label": "Mixer", "plan": "muted", "source": None,
                                                  "disabled": True, "stems": 0}, mixer_layout
            assert mixer_layout["ownPreset"] == {"organ": False, "source": f"voice-{expected_part}.mp3",
                                                    "voice": expected_part, "otherStems": 0}, mixer_layout
            assert mixer_layout["allVoicesPreset"] == {"organ": False, "source": "voice-P1.mp3",
                                                          "otherStems": 3}, mixer_layout
            assert mixer_mobile["columns"] == 2 and not mixer_mobile["overflow"], mixer_mobile
            assert mixer_mobile["width"] <= mixer_mobile["viewport"], mixer_mobile
            after_drag = inspection_result["afterDrag"]
            resumed = inspection_result["resumed"]
            assert after_drag["active"] and abs(after_drag["viewBeat"] - inspection_probe["pausedBeat"]) > .2, inspection_result
            assert abs(after_drag["checkpoint"] - inspection_probe["checkpoint"]) < .01, inspection_result
            assert abs(after_drag["pausedBeat"] - inspection_probe["pausedBeat"]) < .01, inspection_result
            assert after_drag["samples"] == inspection_probe["samples"], inspection_result
            assert resumed["running"] and not resumed["inspectActive"], inspection_result
            assert abs(resumed["scoring"] - inspection_probe["checkpoint"]) < .01, inspection_result
            assert resumed["prepared"] and abs(resumed["preparedBeat"] - resumed["expectedStart"]) < .01, inspection_result
            assert resumed["playback"] < resumed["scoring"] and resumed["samples"] == inspection_probe["samples"], inspection_result
            assert resize["score"] != resize["before"]["score"], resize
            assert resize["bitmap"] != resize["before"]["bitmap"] and resize["bitmap"] == resize["expected"], resize
            assert not result["errors"], result["errors"]
            assert not external, external

            viewer_url = f"{expected_origin}/score-viewer.html?piece={quote(expected_piece)}"
            command(socket, call_id, "Page.navigate", {"url": viewer_url})
            call_id += 1
            for _ in range(160):
                viewer_ready = evaluate(socket, call_id, """Boolean(
                  document.querySelectorAll('.viewer-page').length
                  && [...document.querySelectorAll('.viewer-page img')]
                    .every(image => image.complete && image.naturalWidth)
                  && document.querySelector('#viewer-audio')?.readyState >= 2
                )""")
                call_id += 1
                if viewer_ready:
                    break
                time.sleep(.1)
            else:
                diagnostics = evaluate(socket, call_id, """({
                  title: document.querySelector('#viewer-title')?.textContent,
                  status: document.querySelector('#viewer-status')?.textContent,
                  pages: document.querySelectorAll('.viewer-page').length,
                  errors: window.__releaseSmokeErrors
                })""")
                raise AssertionError(
                    "La modalità Partitura non è pronta: "
                    + json.dumps(diagnostics, ensure_ascii=False)
                )

            command(socket, call_id, "Emulation.setDeviceMetricsOverride", {
                "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True,
            })
            call_id += 1
            viewer_setup = evaluate(socket, call_id, r"""(() => {
              const grayPaper = document.querySelector('[data-paper="#e3e8e6"]');
              grayPaper.click();
              const audio = document.querySelector('#viewer-audio');
              const mixerButton = document.querySelector('#viewer-mixer-open');
              mixerButton.focus();
              return {audioPaused: audio.paused, mixerDialogOpen: document.querySelector('#viewer-mixer').open};
            })()""")
            call_id += 1
            assert viewer_setup == {"audioPaused": True, "mixerDialogOpen": False}, viewer_setup
            command(socket, call_id, "Input.dispatchKeyEvent", {
                "type": "keyDown", "key": " ", "code": "Space", "windowsVirtualKeyCode": 32,
            })
            call_id += 1
            command(socket, call_id, "Input.dispatchKeyEvent", {
                "type": "keyUp", "key": " ", "code": "Space", "windowsVirtualKeyCode": 32,
            })
            call_id += 1
            viewer_start = evaluate(socket, call_id, r"""(async () => {
              const audio = document.querySelector('#viewer-audio');
              const mixerDialog = document.querySelector('#viewer-mixer');
              for (let i = 0; i < 30 && audio.paused; i++)
                await new Promise(resolve => setTimeout(resolve, 50));
              const keyboardStartedPlayback = !audio.paused;
              const spaceDidNotOpenMixer = !mixerDialog.open;
              return {keyboardStartedPlayback, spaceDidNotOpenMixer};
            })()""")
            call_id += 1
            command(socket, call_id, "Input.dispatchKeyEvent", {
                "type": "keyDown", "key": " ", "code": "Space", "windowsVirtualKeyCode": 32,
            })
            call_id += 1
            command(socket, call_id, "Input.dispatchKeyEvent", {
                "type": "keyUp", "key": " ", "code": "Space", "windowsVirtualKeyCode": 32,
            })
            call_id += 1
            viewer_state = evaluate(socket, call_id, r"""(async () => {
              const audio = document.querySelector('#viewer-audio');
              const mixerButton = document.querySelector('#viewer-mixer-open');
              const mixerDialog = document.querySelector('#viewer-mixer');
              await new Promise(resolve => setTimeout(resolve, 80));
              const keyboardPausedPlayback = audio.paused;
              mixerButton.click();
              const mixerOpensPaused = mixerDialog.open && audio.paused;
              const mixerChannels = [...document.querySelectorAll('#viewer-mixer-options input[type="checkbox"]')];
              for (const channel of mixerChannels.slice(0, 2)) {
                channel.click();
                await new Promise(resolve => setTimeout(resolve, 220));
              }
              const mixerEditsStayPaused = audio.paused && mixerDialog.open;
              document.querySelector('#viewer-mixer-close').click();
              return {keyboardPausedPlayback, mixerOpensPaused, mixerChannels: mixerChannels.length,
                mixerEditsStayPaused, mixerDialogOpen: mixerDialog.open};
            })()""")
            call_id += 1
            command(socket, call_id, "Input.dispatchKeyEvent", {
                "type": "keyDown", "key": " ", "code": "Space", "windowsVirtualKeyCode": 32,
            })
            call_id += 1
            command(socket, call_id, "Input.dispatchKeyEvent", {
                "type": "keyUp", "key": " ", "code": "Space", "windowsVirtualKeyCode": 32,
            })
            call_id += 1
            viewer_resume = evaluate(socket, call_id, r"""(async () => {
              const audio = document.querySelector('#viewer-audio');
              await new Promise(resolve => setTimeout(resolve, 150));
              const keyboardResumesAfterMixer = !audio.paused;
              return {keyboardResumesAfterMixer};
            })()""")
            call_id += 1
            command(socket, call_id, "Input.dispatchKeyEvent", {
                "type": "keyDown", "key": " ", "code": "Space", "windowsVirtualKeyCode": 32,
            })
            call_id += 1
            command(socket, call_id, "Input.dispatchKeyEvent", {
                "type": "keyUp", "key": " ", "code": "Space", "windowsVirtualKeyCode": 32,
            })
            call_id += 1
            viewer = evaluate(socket, call_id, r"""(async () => {
              const audio = document.querySelector('#viewer-audio');
              const mixerDialog = document.querySelector('#viewer-mixer');
              const grayPaper = document.querySelector('[data-paper="#e3e8e6"]');
              await new Promise(resolve => setTimeout(resolve, 80));
              window.scrollTo(0, 500);
              await new Promise(resolve => setTimeout(resolve, 150));
              const resources = performance.getEntriesByType('resource').map(entry => entry.name);
              const activePlayhead = document.querySelector('.viewer-playhead.is-active');
              return {
                pageCount: document.querySelectorAll('.viewer-page').length,
                measureSlots: Number(document.querySelector('#viewer-pages')?.dataset.measureSlots),
                writtenMeasures: Number(document.querySelector('#viewer-pages')?.dataset.measures),
                activePlayheads: document.querySelectorAll('.viewer-playhead.is-active').length,
                activePlayheadHeight: activePlayhead?.getBoundingClientRect().height ?? 0,
                pageHeight: activePlayhead?.parentElement?.getBoundingClientRect().height ?? 0,
                audioTransport: Boolean(audio && document.querySelector('#viewer-play')),
                playheadCount: document.querySelectorAll('.viewer-playhead').length,
                getUserMediaCalls: window.__getUserMediaCalls,
                hasPitchUi: Boolean(document.querySelector(
                  'canvas, #pitch-lane, .pitch-region, #microphone, #microphone-level'
                )),
                forbiddenResources: resources.filter(resource =>
                  /pitch_detector|pitch_shared|fluid_pitch_trail|vocal_feedback|\/app\.[a-f0-9]+\.js/.test(resource)
                ),
                bodyWidth: document.body.scrollWidth,
                viewportWidth: innerWidth,
                toolbarTop: document.querySelector('.viewer-toolbar').getBoundingClientRect().top,
                paperColor: getComputedStyle(document.documentElement).getPropertyValue('--score-paper').trim(),
                savedPaperColor: localStorage.getItem('choir-score-paper:v1'),
                grayPaperPressed: grayPaper.getAttribute('aria-pressed'),
                errors: window.__releaseSmokeErrors,
                resources
              };
            })()""")
            viewer.update(viewer_start)
            viewer.update(viewer_state)
            viewer.update(viewer_resume)

            viewer_external = []
            for resource in viewer["resources"]:
                resource_url = urlsplit(resource)
                if resource_url.scheme in {"data", "blob", ""}:
                    continue
                origin = f"{resource_url.scheme}://{resource_url.netloc}"
                if origin != expected_origin:
                    viewer_external.append(resource)

            assert viewer["pageCount"] > 0, viewer
            assert viewer["measureSlots"] == viewer["writtenMeasures"] > 0, viewer
            assert viewer["activePlayheads"] == 1, viewer
            assert 0 < viewer["activePlayheadHeight"] < viewer["pageHeight"], viewer
            assert viewer["audioTransport"] and viewer["playheadCount"] == viewer["pageCount"], viewer
            assert viewer["keyboardStartedPlayback"] and viewer["spaceDidNotOpenMixer"], viewer
            assert viewer["keyboardPausedPlayback"], viewer
            assert viewer["mixerOpensPaused"] and viewer["mixerChannels"] >= 2, viewer
            assert viewer["mixerEditsStayPaused"] and viewer["keyboardResumesAfterMixer"], viewer
            assert viewer["getUserMediaCalls"] == 0, viewer
            assert not viewer["hasPitchUi"], viewer
            assert not viewer["forbiddenResources"], viewer
            assert viewer["bodyWidth"] <= viewer["viewportWidth"], viewer
            assert abs(viewer["toolbarTop"]) < 1, viewer
            assert viewer["paperColor"] == "#e3e8e6", viewer
            assert viewer["savedPaperColor"] == "#e3e8e6", viewer
            assert viewer["grayPaperPressed"] == "true", viewer
            assert not viewer["errors"], viewer["errors"]
            assert not viewer_external, viewer_external
            print(json.dumps({
                "buildVersion": result["buildVersion"],
                "piece": result["bundlePiece"],
                "part": result["selectedPart"],
                "defaultPlumeWidth": result["plumeWidthLabel"],
                "visualDelay": visual_delay,
                "pitchHistoryAlignment": pitch_history_alignment,
                "resourceCount": len(result["resources"]),
                "microphone": microphone,
                "preliminaryResult": preliminary_result,
                "mixerLayout": {"desktop": mixer_layout, "mobile": mixer_mobile},
                "pauseInspectionResume": inspection_result,
                "voiceMix": voice_mix,
                "audioAssetsRms": audio_assets,
                "dividerResize": resize,
                "externalRequests": external,
                "errors": result["errors"],
                "scoreViewer": {
                    "pages": viewer["pageCount"],
                    "getUserMediaCalls": viewer["getUserMediaCalls"],
                    "hasPitchUi": viewer["hasPitchUi"],
                    "forbiddenResources": viewer["forbiddenResources"],
                    "externalRequests": viewer_external,
                },
            }, ensure_ascii=False, indent=2))
        finally:
            if socket is not None:
                socket.close()
            process.terminate()
            process.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
