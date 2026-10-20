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


def capture_layout(socket, name):
    layout = evaluate(socket, 500, """
      (async () => {
        const image = document.querySelector('#warmup-lesson-score');
        if (!image.complete) await new Promise(resolve => image.addEventListener('load', resolve, {once:true}));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const shell = document.querySelector('.warmup-shell');
        const start = document.querySelector('#warmup-start').getBoundingClientRect();
        return {width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
          shellScroll: shell.scrollHeight - shell.clientHeight,
          scoreLoaded: image.naturalWidth > 0, startTop: start.top, startBottom: start.bottom,
          scoreHeight: document.querySelector('.warmup-lesson').getBoundingClientRect().height,
          scoreBackground: getComputedStyle(document.querySelector('.warmup-lesson-score')).backgroundColor,
          intro: document.querySelector('#warmup-lesson-intro').textContent,
          smallControls: [...document.querySelectorAll('button, summary')].filter(control => {
            const bounds = control.getBoundingClientRect();
            return bounds.width > 0 && bounds.height > 0 && (bounds.width < 44 || bounds.height < 44);
          }).map(control => control.id || control.textContent.trim()),
          path: document.querySelector('#warmup-location').textContent};
      })()
    """, await_promise=True)
    assert layout['documentWidth'] <= layout['width'], layout
    assert layout['scoreLoaded'] and 'Fa' in layout['intro'], layout
    assert layout['shellScroll'] == 0, layout
    assert layout['scoreHeight'] <= (190 if layout['width'] <= 700 else 260), layout
    assert layout['scoreBackground'] == 'rgba(0, 0, 0, 0)', layout
    assert not layout['smallControls'], layout
    assert 0 <= layout['startTop'] < layout['startBottom'] <= layout['height'], layout
    screenshot = command(socket, 501, 'Page.captureScreenshot', {'format': 'png', 'fromSurface': True})
    (ROOT / 'artifacts' / f'voice-lab-{name}.png').write_bytes(base64.b64decode(screenshot['data']))
    return layout


def wait_screen(socket, screen):
    # History traversal is asynchronous; wait before choosing the next route.
    assert evaluate(socket, 520, f"""
      (async () => {{
        for (let attempt=0; attempt<120; attempt++) {{
          if (document.body.dataset.screen === {json.dumps(screen)}) return true;
          await new Promise(resolve => setTimeout(resolve, 25));
        }}
        return false;
      }})()
    """, await_promise=True), screen


def select_path(socket, path):
    evaluate(socket, 530, "document.querySelector('#warmup-back-choose').click()")
    wait_screen(socket, 'choose')
    evaluate(socket, 531, f"document.querySelector('[data-path={path}]').click()")
    wait_screen(socket, 'prepare')


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
                command(socket, 11, "Emulation.setDeviceMetricsOverride", {"width": 1366, "height": 768, "deviceScaleFactor": 1, "mobile": False})
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

                layouts = {}
                for width, height in [(1366, 768), (390, 844)]:
                    command(socket, 420, 'Emulation.setDeviceMetricsOverride', {
                        'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width == 390})
                    evaluate(socket, 421, "document.querySelector('#warmup-back-choose').click()")
                    wait_screen(socket, 'choose')
                    evaluate(socket, 4211, "document.querySelector('[data-path=scale]').click()")
                    layouts[f'scale-{width}'] = capture_layout(socket, f'scale-{width}')
                    select_path(socket, "chords")
                    layouts[f'chords-{width}'] = capture_layout(socket, f'chords-{width}')
                    select_path(socket, "scale")
                    assert evaluate(socket, 424, "document.querySelector('#warmup-prepare-kicker').textContent") == 'SCALDA LA VOCE'
                    select_path(socket, "ear")
                    layouts[f'ear-{width}'] = capture_layout(socket, f'ear-{width}')
                    assert evaluate(socket, 426, "document.querySelectorAll('#warmup-next-path, #warmup-previous-path').length") == 0
                    evaluate(socket, 427, "document.querySelector('[data-family=degree]').click()")
                    layouts[f'degree-{width}'] = capture_layout(socket, f'degree-{width}')
                command(socket, 428, 'Emulation.setDeviceMetricsOverride', {
                    'width': 1366, 'height': 768, 'deviceScaleFactor': 1, 'mobile': False})
                evaluate(socket, 429, "document.querySelector('#warmup-back-choose').click()")
                wait_screen(socket, 'choose')
                evaluate(socket, 4291, "document.querySelector('[data-path=scale]').click(); document.querySelector('[data-bpm=\"60\"]').click()")

                evaluate(socket, 430, "document.querySelector('#lab-settings').focus(); document.querySelector('#lab-settings').click()")
                command(socket, 431, 'Input.dispatchKeyEvent', {'type': 'keyDown', 'key': 'Escape', 'code': 'Escape', 'windowsVirtualKeyCode': 27})
                closed = evaluate(socket, 432, """
                  (async () => {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    return {open: document.querySelector('#lab-settings-dialog').open, focus: document.activeElement.id};
                  })()
                """, await_promise=True)
                assert closed == {'open': False, 'focus': 'lab-settings'}, closed
                evaluate(socket, 433, "document.querySelector('#lab-settings').click()")
                command(socket, 434, 'Input.dispatchMouseEvent', {'type':'mousePressed', 'x':2, 'y':2, 'button':'left', 'clickCount':1})
                command(socket, 435, 'Input.dispatchMouseEvent', {'type':'mouseReleased', 'x':2, 'y':2, 'button':'left', 'clickCount':1})
                assert evaluate(socket, 436, "!document.querySelector('#lab-settings-dialog').open") is True
                evaluate(socket, 437, "document.querySelector('#warmup-back-choose').click()")
                wait_screen(socket, 'choose')
                evaluate(socket, 4371, "document.querySelector('[data-path=chords]').focus()")
                command(socket, 438, 'Input.dispatchKeyEvent', {'type':'keyDown', 'key':'Enter', 'code':'Enter', 'text':'\r', 'windowsVirtualKeyCode':13})
                command(socket, 4381, 'Input.dispatchKeyEvent', {'type':'keyUp', 'key':'Enter', 'code':'Enter', 'windowsVirtualKeyCode':13})
                keyboard = evaluate(socket, 439, "({path: document.querySelector('#warmup-location').textContent, focus: document.activeElement.id})")
                assert 'Accordi' in keyboard['path'] and keyboard['focus'] == 'warmup-prepare-title', keyboard
                select_path(socket, "scale")

                model = evaluate(socket, 5, """
                  (async () => {
                    window.__warmupEvents = [];
                    window.addEventListener('voice-lab-audio-event', event => window.__warmupEvents.push(event.detail));
                    document.querySelector('#warmup-start').click();
                    for (let attempt = 0; attempt < 120 && !window.__warmupEvents.some(event => event.kind === 'exercise'); attempt += 1)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    const snapshot = {events: window.__warmupEvents, running: document.body.dataset.running,
                      phase: document.querySelector('#warmup-phase-kicker').textContent};
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
                for width, height in [(1366, 768), (390, 844)]:
                    command(socket, 450, 'Emulation.setDeviceMetricsOverride', {
                        'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width == 390})
                    session = evaluate(socket, 451, """
                      (async () => {
                        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                        const score = document.querySelector('#lab-score-image');
                        const stop = document.querySelector('#warmup-cancel').getBoundingClientRect();
                        return {scoreVisible: !score.hidden && score.naturalWidth > 0,
                          width: innerWidth, documentWidth: document.documentElement.scrollWidth,
                          stopTop: stop.top, stopBottom: stop.bottom, height: innerHeight};
                      })()
                    """, await_promise=True)
                    assert session['scoreVisible'] and session['width'] == session['documentWidth'], session
                    assert 0 < session['stopTop'] < session['stopBottom'] <= session['height'], session
                    shot = command(socket, 452, 'Page.captureScreenshot', {'format':'png', 'fromSurface':True})
                    (ROOT / 'artifacts' / f'voice-lab-session-{width}.png').write_bytes(base64.b64decode(shot['data']))
                command(socket, 453, 'Emulation.setDeviceMetricsOverride', {'width':1366, 'height':768, 'deviceScaleFactor':1, 'mobile':False})
                evaluate(socket, 454, "document.querySelector('#warmup-back-prepare').click()")
                assert evaluate(socket, 455, "document.body.dataset.screen === 'prepare' && document.body.dataset.running === 'false'") is True

                manual_transpose = evaluate(socket, 50, """
                  (async () => {
                    window.__warmupEvents = [];
                    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                    const microphoneStreams = [];
                    navigator.mediaDevices.getUserMedia = async (...args) => {
                      const stream = await nativeGetUserMedia(...args);
                      microphoneStreams.push(stream);
                      return stream;
                    };
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
                    await new Promise(resolve => setTimeout(resolve, 0));
                    snapshot.microphoneReleased = microphoneStreams.length >= 2
                      && microphoneStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'));
                    navigator.mediaDevices.getUserMedia = nativeGetUserMedia;
                    return snapshot;
                  })()
                """, await_promise=True)
                assert manual_transpose["choice"] == {"visible": True, "enabled": True,
                                                      "label": "Sali di un semitono", "finish": "Termina"}, manual_transpose
                assert len(manual_transpose["roots"]) == 2 and manual_transpose["roots"][1] == manual_transpose["roots"][0] + 1, manual_transpose
                assert manual_transpose["bpms"] == [100, 100], manual_transpose
                assert any("-p100-" in key and "-r54-" in key for key in manual_transpose["phraseKeys"]), manual_transpose
                assert manual_transpose["microphoneReleased"] is True, manual_transpose
                assert manual_transpose["title"].startswith("Fa♯"), manual_transpose
                wait_screen(socket, 'prepare')

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
                wait_screen(socket, 'prepare')

                command(socket, 509, 'Emulation.setDeviceMetricsOverride', {'width':390, 'height':844, 'deviceScaleFactor':1, 'mobile':True})
                chord_audio = evaluate(socket, 510, """
                  (async () => {
                    document.querySelector('[data-path=chords]').click();
                    document.querySelector('[data-inversion=root]').click();
                    document.querySelector('[data-bpm="80"]').click();
                    const nativeFetch = window.fetch;
                    const nativeMicrophone = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                    const streams = [];
                    navigator.mediaDevices.getUserMedia = async (...args) => {
                      const stream = await nativeMicrophone(...args); streams.push(stream); return stream;
                    };
                    window.__warmupEvents = [];
                    window.fetch = (url, ...args) => String(url).includes('/phrases/')
                      ? Promise.resolve(new Response('', {status:404})) : nativeFetch(url, ...args);
                    document.querySelector('#warmup-start').click();
                    await new Promise(resolve => setTimeout(resolve, 0));
                    for (let n = 0; n < 120 && document.body.dataset.running === 'true'; n++)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    const missingPhrase = {message: document.querySelector('#warmup-plan-detail').textContent,
                      screen: document.body.dataset.screen, events: [...window.__warmupEvents],
                      errorVisible: document.querySelector('#warmup-plan-detail').getBoundingClientRect().height > 0};
                    window.fetch = nativeFetch;
                    document.querySelector('#warmup-start').click();
                    for (let n = 0; n < 400 && document.querySelector('#warmup-feedback').hidden; n++)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    const major = [...window.__warmupEvents];
                    window.__warmupEvents = [];
                    document.querySelector('#warmup-next').click();
                    for (let n = 0; n < 120 && !window.__warmupEvents.some(event => event.kind === 'exercise'); n++)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    const minor = [...window.__warmupEvents];
                    const resultsBefore = JSON.parse(localStorage.getItem('choir-voice-lab:v2:results')).length;
                    document.querySelector('#warmup-back-choose').click();
                    for (let n = 0; n < 120 && document.body.dataset.screen !== 'choose'; n++)
                      await new Promise(resolve => setTimeout(resolve, 25));
                    document.querySelector('[data-path=ear]').click();
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const snapshot = {missingPhrase, major, minor, screen: document.body.dataset.screen,
                      path: document.querySelector('#warmup-location').textContent,
                      microphoneReleased: streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')),
                      resultsBefore, resultsAfter: JSON.parse(localStorage.getItem('choir-voice-lab:v2:results')).length};
                    navigator.mediaDevices.getUserMedia = nativeMicrophone;
                    return snapshot;
                  })()
                """, await_promise=True)
                assert 'voce guida non è disponibile' in chord_audio['missingPhrase']['message'], chord_audio
                assert chord_audio['missingPhrase']['screen'] == 'prepare' and not chord_audio['missingPhrase']['events'], chord_audio
                assert chord_audio['missingPhrase']['errorVisible'], chord_audio
                for quality in ('major', 'minor'):
                    events = chord_audio[quality]
                    assert sum(event['kind'] == 'model-phrase' for event in events) == 1, events
                    assert not any(event['kind'] == 'model-note' for event in events), events
                    assert next(event['key'] for event in events if event['kind'] == 'model-phrase') == f'triad-{quality}-root-r53-p80-tenor', events
                    assert next(event['key'] for event in events if event['kind'] == 'harmonic-pad') == f'{quality}-pc5', events
                assert chord_audio['screen'] == 'prepare' and 'Orecchio' in chord_audio['path'], chord_audio
                assert chord_audio['microphoneReleased'] and chord_audio['resultsBefore'] == chord_audio['resultsAfter'], chord_audio
                command(socket, 511, 'Emulation.setDeviceMetricsOverride', {'width':1366, 'height':768, 'deviceScaleFactor':1, 'mobile':False})

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
                assert degree_audio["before"]["title"].startswith("Canta ") and degree_audio["before"]["caption"] == "Solo la tua voce · confronto alla fine", degree_audio
                assert degree_kinds.count("root-reference") == 1 and degree_kinds.count("root-drone") == 1, degree_kinds
                assert "model-note" not in degree_kinds, degree_kinds
                assert degree_exercise["family"] == "degree" and degree_exercise["level"] == "base", degree_exercise
                assert degree_exercise["totalBeats"] == 4 and degree_exercise["events"][0]["degree"] in ["2", "3", "4", "5"], degree_exercise
                assert degree_audio["feedbackVisible"] and degree_audio["segmentCount"] == 1, degree_audio
                assert degree_audio["rollCaption"] == "Note da cantare e tua voce", degree_audio
                assert degree_audio["stored"]["exercise"]["family"] == "degree" and degree_audio["stored"]["exercise"]["level"] == "base", degree_audio

                inner = evaluate(socket, 6, """
                  (async () => {
                    window.__warmupEvents = [];
                    document.querySelector('[data-path="ear"]').click();
                    for (let attempt = 0; attempt < 120 && document.body.dataset.screen !== 'prepare'; attempt++)
                      await new Promise(resolve => setTimeout(resolve, 25));
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
                assert inner["before"]["caption"] == "Solo la tua voce · confronto alla fine", inner
                assert inner["before"]["scoreCaption"] == "Note e numeri da cantare", inner
                assert inner["before"]["scoreImageHidden"] is False, inner
                assert "Fa è la nota 1" in inner["before"]["instruction"], inner
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
                assert inner["rollCaption"] == "Note da cantare e tua voce", inner

                screenshot = command(socket, 7, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-warmup.png").write_bytes(base64.b64decode(screenshot["data"]))
                command(socket, 8, "Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
                mobile = command(socket, 9, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-warmup-mobile.png").write_bytes(base64.b64decode(mobile["data"]))
                evaluate(socket, 91, "document.querySelector('[data-path=\"scale\"]').click()")
                wait_screen(socket, 'prepare')
                mobile_prepare = command(socket, 92, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-prepare-mobile.png").write_bytes(base64.b64decode(mobile_prepare["data"]))
                evaluate(socket, 93, "document.querySelector('#warmup-back-choose').click()")
                wait_screen(socket, 'choose')
                mobile_home = command(socket, 94, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-home-mobile.png").write_bytes(base64.b64decode(mobile_home["data"]))
                print(json.dumps({"initial": initial, "plans": plans, "layouts": layouts, "modelEvents": len(model["events"]),
                                  "innerEar": {"feedback": inner["feedbackTitle"], "segments": inner["segmentCount"]}}, ensure_ascii=True))
            finally:
                socket.close()
        finally:
            process.terminate(); process.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
