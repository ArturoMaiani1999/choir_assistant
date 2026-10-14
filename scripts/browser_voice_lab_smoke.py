"""Headless smoke test for the Voice Lab warm-up and inner-ear flows."""
from __future__ import annotations

import base64
import json
import math
import struct
import subprocess
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

import websocket

ROOT = Path(__file__).resolve().parents[1]
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
URL = "http://127.0.0.1:5188/voice-lab.html"


def command(socket, call_id, method, params=None):
    socket.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
    while True:
        message = json.loads(socket.recv())
        if message.get("id") == call_id:
            return message.get("result", {})


def evaluate(socket, call_id, expression, *, await_promise=False):
    result = command(socket, call_id, "Runtime.evaluate", {
        "expression": expression, "returnByValue": True, "awaitPromise": await_promise,
    })
    assert "exceptionDetails" not in result, result
    return result.get("result", {}).get("value")


def main() -> int:
    if not CHROME.is_file():
        raise SystemExit("Chrome non disponibile")
    with tempfile.TemporaryDirectory(prefix="choir-warmup-") as profile:
        microphone_wav = Path(profile) / "voice.wav"
        sample_rate = 48_000
        with wave.open(str(microphone_wav), "wb") as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(sample_rate)
            frames = [struct.pack("<h", int(8500 * math.sin(2 * math.pi * 174.614 * index / sample_rate)))
                      for index in range(sample_rate * 30)]
            audio.writeframes(b"".join(frames))
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
            f"--use-file-for-fake-audio-capture={microphone_wav}", "--autoplay-policy=no-user-gesture-required",
            "--remote-debugging-port=0", f"--user-data-dir={profile}", "--window-size=1440,900", URL,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(100):
                try:
                    lines = port_file.read_text().splitlines()
                    if lines:
                        break
                except (FileNotFoundError, PermissionError):
                    pass
                time.sleep(.05)
            else:
                raise RuntimeError("Chrome non ha aperto la porta di debug")
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{lines[0]}/json", timeout=5))
            page = next(tab for tab in tabs if tab.get("type") == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=60)
            try:
                command(socket, 1, "Page.enable")
                time.sleep(1)
                initial = evaluate(socket, 2, """
                  (() => ({
                    title: document.querySelector('h1').textContent,
                    legacyActivities: document.querySelectorAll('[data-activity]').length,
                    scoreTag: document.querySelector('#lab-score').tagName,
                    scoreAsset: document.querySelector('#lab-score-image').getAttribute('src'),
                    scoreImageHidden: document.querySelector('#lab-score-image').hidden,
                    rollTag: document.querySelector('#lab-roll').tagName,
                    plan: document.querySelector('#warmup-plan-title').textContent,
                    progress: document.querySelector('#warmup-progress').textContent,
                    volume: document.querySelector('#lab-voice-volume-value').textContent,
                    settingsOpen: document.querySelector('#lab-settings-dialog').open,
                    screen: document.body.dataset.screen,
                    chooseVisible: !document.querySelector('#warmup-choose').hidden,
                    prepareHidden: document.querySelector('#warmup-prepare').hidden,
                    workspaceHidden: document.querySelector('#warmup-workspace').hidden,
                    pathCount: document.querySelectorAll('[data-path]').length
                  }))()
                """)
                assert initial == {"title": "Allena la tua voce", "legacyActivities": 0,
                                   "scoreTag": "CANVAS", "scoreAsset": "voice-lab-assets/scores/scale-major-r53-tenor.svg",
                                   "scoreImageHidden": False, "rollTag": "CANVAS",
                                   "plan": "Scala in Fa · 60 BPM", "progress": "Fa · 60 BPM",
                                   "volume": "100%", "settingsOpen": False, "screen": "choose",
                                   "chooseVisible": True, "prepareHidden": True, "workspaceHidden": True,
                                   "pathCount": 3}, initial
                evaluate(socket, 3, "document.querySelector('#lab-settings').click(); document.querySelector('#lab-settings-save').click()")
                home = command(socket, 30, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-home.png").write_bytes(base64.b64decode(home["data"]))
                evaluate(socket, 31, """
                  (() => {
                    const prototype = ChoirFluidPitchTrail.Renderer.prototype;
                    if (prototype.__voiceLabProbeInstalled) return;
                    const original = prototype.render;
                    prototype.render = function(samples, xAt, yAt, options) {
                      if (samples.length > 2) window.__voiceLabTrailProbe = {
                        retainHistory: options.retainHistory,
                        advanceMs: options.timeAdvanceMs,
                        alignedOriginX: xAt({time: options.timeAdvanceMs / 1000})
                      };
                      return original.call(this, samples, xAt, yAt, options);
                    };
                    prototype.__voiceLabProbeInstalled = true;
                  })()
                """)

                plans = evaluate(socket, 4, """
                  (() => {
                    document.querySelector('[data-path="scale"]').click();
                    document.querySelector('[data-bpm="100"]').click();
                    const fastScale = { title: document.querySelector('#warmup-plan-title').textContent,
                      count: document.querySelector('#warmup-plan-kicker').textContent,
                      detail: document.querySelector('#warmup-plan-detail').textContent };
                    document.querySelector('[data-path="chords"]').click();
                    const arpeggio = { title: document.querySelector('#warmup-plan-title').textContent,
                      count: document.querySelector('#warmup-plan-kicker').textContent,
                      detail: document.querySelector('#warmup-plan-detail').textContent,
                      inversionsHidden: document.querySelector('#warmup-inversions').hidden };
                    document.querySelector('[data-inversion="first"]').click();
                    const firstInversion = { title: document.querySelector('#warmup-plan-title').textContent,
                      exerciseTitle: document.querySelector('#warmup-title').textContent,
                      quality: document.querySelector('#warmup-quality').textContent,
                      count: document.querySelector('#warmup-plan-kicker').textContent };
                    document.querySelector('[data-inversion="all"]').click();
                    const allInversions = { title: document.querySelector('#warmup-plan-title').textContent,
                      count: document.querySelector('#warmup-plan-kicker').textContent };
                    document.querySelector('[data-inversion="root"]').click();
                    document.querySelector('[data-path="ear"]').click();
                    document.querySelector('[data-family="degree"]').click();
                    const baseDegrees = { title: document.querySelector('#warmup-plan-title').textContent,
                      count: document.querySelector('#warmup-plan-kicker').textContent,
                      detail: document.querySelector('#warmup-plan-detail').textContent,
                      levelsHidden: document.querySelector('#warmup-degree-levels').hidden,
                      innerEarActive: document.querySelector('#warmup-prepare-kicker').textContent === 'ORECCHIO INTERNO' };
                    document.querySelector('[data-degree-level="advanced"]').click();
                    const advancedDegrees = { title: document.querySelector('#warmup-plan-title').textContent,
                      count: document.querySelector('#warmup-plan-kicker').textContent,
                      quality: document.querySelector('#warmup-quality').textContent };
                    document.querySelector('[data-path="scale"]').click();
                    document.querySelector('[data-bpm="60"]').click();
                    return {fastScale, arpeggio, firstInversion, allInversions, baseDegrees, advancedDegrees};
                  })()
                """)
                assert plans["fastScale"]["count"] == "1 ESERCIZIO" and "scegliere se salire" in plans["fastScale"]["detail"], plans
                assert plans["arpeggio"]["count"] == "4 ESERCIZI" and "alternati" in plans["arpeggio"]["detail"], plans
                assert plans["arpeggio"]["inversionsHidden"] is False, plans
                assert plans["firstInversion"]["count"] == "4 ESERCIZI" and "primo rivolto" in plans["firstInversion"]["title"], plans
                assert "primo rivolto" in plans["firstInversion"]["exerciseTitle"] and "PRIMO RIVOLTO" in plans["firstInversion"]["quality"], plans
                assert plans["allInversions"]["count"] == "12 ESERCIZI" and "tutte le posizioni" in plans["allInversions"]["title"], plans
                assert plans["baseDegrees"]["count"] == "4 ESERCIZI" and "livello base" in plans["baseDegrees"]["title"], plans
                assert plans["baseDegrees"]["levelsHidden"] is False and plans["baseDegrees"]["innerEarActive"] is True, plans
                assert "ordine casuale" in plans["baseDegrees"]["detail"], plans
                assert plans["advancedDegrees"]["count"] == "12 ESERCIZI" and "livello avanzato" in plans["advancedDegrees"]["title"], plans
                assert plans["advancedDegrees"]["quality"] == "LIVELLO AVANZATO", plans
                prepare = command(socket, 41, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-prepare.png").write_bytes(base64.b64decode(prepare["data"]))

                model = evaluate(socket, 5, """
                  (async () => {
                    window.__warmupEvents = [];
                    window.addEventListener('voice-lab-audio-event', event => window.__warmupEvents.push(event.detail));
                    document.querySelector('#warmup-start').click();
                    for (let attempt = 0; attempt < 120 && !window.__warmupEvents.some(event => event.kind === 'exercise'); attempt += 1)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    const snapshot = {events: window.__warmupEvents, running: document.body.dataset.running,
                      phase: document.querySelector('#warmup-phase-kicker').textContent};
                    document.querySelector('#warmup-cancel').click();
                    return snapshot;
                  })()
                """, await_promise=True)
                kinds = [event["kind"] for event in model["events"]]
                assert kinds.count("model-phrase") == 1 and kinds.count("harmonic-pad") == 1, kinds
                assert kinds.count("model-note") == 0 and kinds.count("root-drone") == 1, kinds
                assert kinds.count("metronome") == 14 and kinds.count("exercise") == 1, kinds
                exercise_event = next(event for event in model["events"] if event["kind"] == "exercise")
                phrase_event = next(event for event in model["events"] if event["kind"] == "model-phrase")
                pad_event = next(event for event in model["events"] if event["kind"] == "harmonic-pad")
                assert exercise_event["exercise"]["previewBpm"] == 60
                assert exercise_event["takeAt"] > exercise_event["countInAt"] > exercise_event["at"]
                assert phrase_event["end"] - phrase_event["at"] > exercise_event["exercise"]["previewSeconds"] + .4
                assert pad_event["end"] >= exercise_event["takeAt"]

                manual_transpose = evaluate(socket, 50, """
                  (async () => {
                    window.__warmupEvents = [];
                    document.querySelector('[data-path="scale"]').click();
                    document.querySelector('[data-bpm="100"]').click();
                    document.querySelector('#warmup-start').click();
                    for (let attempt = 0; attempt < 400 && document.querySelector('#warmup-feedback').hidden; attempt += 1)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    const first = window.__warmupEvents.find(event => event.kind === 'exercise');
                    const choice = {visible: !document.querySelector('#warmup-step-up').hidden,
                      enabled: !document.querySelector('#warmup-step-up').disabled,
                      label: document.querySelector('#warmup-step-up').textContent,
                      finish: document.querySelector('#warmup-next').textContent};
                    document.querySelector('#warmup-step-up').click();
                    for (let attempt = 0; attempt < 160 && window.__warmupEvents.filter(event => event.kind === 'exercise').length < 2; attempt += 1)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    const exercises = window.__warmupEvents.filter(event => event.kind === 'exercise');
                    const phrases = window.__warmupEvents.filter(event => event.kind === 'model-phrase');
                    const snapshot = {choice, roots: exercises.map(event => event.exercise.rootMidi),
                      bpms: exercises.map(event => event.exercise.bpm), phraseKeys: phrases.map(event => event.key),
                      title: document.querySelector('#warmup-title').textContent};
                    document.querySelector('#warmup-cancel').click();
                    return snapshot;
                  })()
                """, await_promise=True)
                assert manual_transpose["choice"] == {"visible": True, "enabled": True,
                                                      "label": "Sali di un semitono", "finish": "Termina"}, manual_transpose
                assert len(manual_transpose["roots"]) == 2 and manual_transpose["roots"][1] == manual_transpose["roots"][0] + 1, manual_transpose
                assert manual_transpose["bpms"] == [100, 100], manual_transpose
                assert any("-p100-" in key and "-r54-" in key for key in manual_transpose["phraseKeys"]), manual_transpose
                assert manual_transpose["title"].startswith("Fa♯"), manual_transpose

                inversion_audio = evaluate(socket, 51, """
                  (async () => {
                    window.__warmupEvents = [];
                    document.querySelector('[data-path="chords"]').click();
                    document.querySelector('[data-inversion="second"]').click();
                    document.querySelector('#warmup-start').click();
                    for (let attempt = 0; attempt < 120 && !window.__warmupEvents.some(event => event.kind === 'exercise'); attempt += 1)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    const snapshot = [...window.__warmupEvents];
                    document.querySelector('#warmup-cancel').click();
                    return snapshot;
                  })()
                """, await_promise=True)
                inversion_exercise = next(event for event in inversion_audio if event["kind"] == "exercise")["exercise"]
                inversion_notes = [event["midi"] for event in inversion_audio if event["kind"] == "model-note"]
                inversion_phrases = [event for event in inversion_audio if event["kind"] == "model-phrase"]
                inversion_pads = [event for event in inversion_audio if event["kind"] == "harmonic-pad"]
                assert inversion_exercise["patternId"] == "triad-major-second", inversion_exercise
                assert inversion_exercise["inversion"] == "second" and inversion_exercise["bassDegree"] == 5, inversion_exercise
                assert [event["degree"] for event in inversion_exercise["events"]] == ["5", "1", "3M", "1", "5"], inversion_exercise
                assert not inversion_notes, inversion_notes
                assert len(inversion_phrases) == 1 and inversion_phrases[0]["key"] == "triad-major-second-r41-p100-tenor", inversion_phrases
                assert len(inversion_pads) == 1 and inversion_pads[0]["key"] == "major-pc5", inversion_pads

                degree_audio = evaluate(socket, 52, """
                  (async () => {
                    window.__warmupEvents = [];
                    document.querySelector('[data-path="ear"]').click();
                    document.querySelector('[data-family="degree"]').click();
                    document.querySelector('[data-degree-level="base"]').click();
                    document.querySelector('[data-bpm="100"]').click();
                    const before = {title: document.querySelector('#warmup-title').textContent,
                      caption: document.querySelector('#warmup-roll-caption').textContent};
                    document.querySelector('#warmup-start').click();
                    for (let attempt = 0; attempt < 120 && !window.__warmupEvents.some(event => event.kind === 'exercise'); attempt += 1)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    const scheduled = [...window.__warmupEvents];
                    for (let attempt = 0; attempt < 200 && document.querySelector('#warmup-feedback').hidden; attempt += 1)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    const results = JSON.parse(localStorage.getItem('choir-voice-lab:v2:results') || '[]');
                    return {before, scheduled, feedbackVisible: !document.querySelector('#warmup-feedback').hidden,
                      segmentCount: document.querySelectorAll('#warmup-segments span').length,
                      rollCaption: document.querySelector('#warmup-roll-caption').textContent, stored: results.at(-1)};
                  })()
                """, await_promise=True)
                degree_kinds = [event["kind"] for event in degree_audio["scheduled"]]
                degree_exercise = next(event for event in degree_audio["scheduled"] if event["kind"] == "exercise")["exercise"]
                assert degree_audio["before"]["title"].startswith("Canta ") and degree_audio["before"]["caption"] == "Solo la tua voce · target nascosto", degree_audio
                assert degree_kinds.count("root-reference") == 1 and degree_kinds.count("root-drone") == 1, degree_kinds
                assert "model-note" not in degree_kinds, degree_kinds
                assert degree_exercise["family"] == "degree" and degree_exercise["level"] == "base", degree_exercise
                assert degree_exercise["totalBeats"] == 4 and degree_exercise["events"][0]["degree"] in ["2", "3", "4", "5"], degree_exercise
                assert degree_audio["feedbackVisible"] and degree_audio["segmentCount"] == 1, degree_audio
                assert degree_audio["rollCaption"] == "Target e voce rilevata", degree_audio
                assert degree_audio["stored"]["exercise"]["family"] == "degree" and degree_audio["stored"]["exercise"]["level"] == "base", degree_audio

                inner = evaluate(socket, 6, """
                  (async () => {
                    window.__warmupEvents = [];
                    document.querySelector('[data-path="ear"]').click();
                    document.querySelector('[data-family="scale"]').click();
                    document.querySelector('[data-bpm="100"]').click();
                    const before = {caption: document.querySelector('#warmup-roll-caption').textContent,
                      scoreCaption: document.querySelector('#warmup-score-caption').textContent,
                      instruction: document.querySelector('#warmup-instruction').textContent,
                      scoreImageHidden: document.querySelector('#lab-score-image').hidden};
                    document.querySelector('#warmup-start').click();
                    for (let attempt = 0; attempt < 160 && !window.__warmupEvents.some(event => event.kind === 'exercise'); attempt += 1)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    const scheduled = [...window.__warmupEvents];
                    for (let attempt = 0; attempt < 260 && document.querySelector('#warmup-feedback').hidden; attempt += 1)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    const results = JSON.parse(localStorage.getItem('choir-voice-lab:v2:results') || '[]');
                    return {before, scheduled, feedbackVisible: !document.querySelector('#warmup-feedback').hidden,
                      feedbackTitle: document.querySelector('#warmup-feedback-title').textContent,
                      segmentCount: document.querySelectorAll('#warmup-segments span').length,
                      stored: results.at(-1), rollCaption: document.querySelector('#warmup-roll-caption').textContent,
                      trailProbe: window.__voiceLabTrailProbe,
                      revealedScore: {hidden: document.querySelector('#lab-score-image').hidden,
                        width: document.querySelector('#lab-score-image').naturalWidth,
                        source: document.querySelector('#lab-score-image').getAttribute('src')}};
                  })()
                """, await_promise=True)
                inner_kinds = [event["kind"] for event in inner["scheduled"]]
                inner_reference = next(event for event in inner["scheduled"] if event["kind"] == "root-reference")
                inner_drone = next(event for event in inner["scheduled"] if event["kind"] == "root-drone")
                assert inner["before"]["caption"] == "Solo la tua voce · target nascosto", inner
                assert "altezze nascoste" in inner["before"]["scoreCaption"], inner
                assert inner["before"]["scoreImageHidden"] is True, inner
                assert inner_kinds.count("root-reference") == 1 and inner_kinds.count("root-drone") == 1, inner_kinds
                assert inner_reference["gain"] == .075 and inner_reference["continuousFade"] is True, inner_reference
                assert inner_drone["gain"] == .025 and inner_drone["continuousFade"] is True, inner_drone
                assert inner_reference["end"] == inner_drone["at"] and inner_reference["fadeStart"] < inner_drone["at"], inner
                assert "model-note" not in inner_kinds, inner_kinds
                assert inner["feedbackVisible"] and inner["segmentCount"] == 9, inner
                assert inner["stored"]["schemaVersion"] == 2 and inner["stored"]["exercise"]["mode"] == "inner-ear", inner
                assert inner["stored"]["deviceAndLatencyConfig"]["plumeAdvanceMs"] == 270, inner
                assert inner["trailProbe"]["retainHistory"] is True and inner["trailProbe"]["advanceMs"] == 270, inner
                assert abs(inner["trailProbe"]["alignedOriginX"] - 48) < .5, inner
                assert inner["revealedScore"]["hidden"] is False and inner["revealedScore"]["width"] > 0, inner
                assert inner["revealedScore"]["source"].endswith("scale-major-r53-tenor.svg"), inner
                assert inner["rollCaption"] == "Target e voce rilevata", inner

                screenshot = command(socket, 7, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-warmup.png").write_bytes(base64.b64decode(screenshot["data"]))
                command(socket, 8, "Emulation.setDeviceMetricsOverride", {"width": 390, "height": 780, "deviceScaleFactor": 1, "mobile": True})
                mobile = command(socket, 9, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-warmup-mobile.png").write_bytes(base64.b64decode(mobile["data"]))
                evaluate(socket, 91, "document.querySelector('[data-path=\"scale\"]').click()")
                mobile_prepare = command(socket, 92, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-prepare-mobile.png").write_bytes(base64.b64decode(mobile_prepare["data"]))
                evaluate(socket, 93, "document.querySelector('#warmup-back-choose').click()")
                mobile_home = command(socket, 94, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-home-mobile.png").write_bytes(base64.b64decode(mobile_home["data"]))
                print(json.dumps({"initial": initial, "plans": plans, "modelEvents": len(model["events"]),
                                  "innerEar": {"feedback": inner["feedbackTitle"], "segments": inner["segmentCount"]}}, ensure_ascii=True))
            finally:
                socket.close()
        finally:
            process.terminate(); process.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
