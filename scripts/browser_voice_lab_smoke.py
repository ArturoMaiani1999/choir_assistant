"""Headless smoke test for the Voice Lab MuseScore rendering."""
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


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="choir-voice-lab-") as profile:
        microphone_wav = Path(profile) / "target-a-sharp-3.wav"
        sample_rate = 48000
        with wave.open(str(microphone_wav), "wb") as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(sample_rate)
            frames = []
            for index in range(sample_rate * 12):
                seconds = index / sample_rate
                value = 0 if seconds < .35 else int(9000 * math.sin(2 * math.pi * 233.0818808 * seconds))
                frames.append(struct.pack("<h", value))
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
                if port_file.exists():
                    break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(tab for tab in tabs if tab.get("type") == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=60)
            try:
                command(socket, 1, "Page.enable")
                time.sleep(1)
                result = command(socket, 2, "Runtime.evaluate", {"expression": "({src:document.querySelector('#lab-score').getAttribute('src'),complete:document.querySelector('#lab-score').complete,naturalWidth:document.querySelector('#lab-score').naturalWidth,tag:document.querySelector('#lab-score').tagName})", "returnByValue": True})
                assert "value" in result.get("result", {}), result
                metrics = result["result"]["value"]
                assert metrics["tag"] == "IMG" and metrics["complete"] and metrics["naturalWidth"] > 0, metrics
                assert "/notes/note-" in metrics["src"], metrics
                drawing = command(socket, 31, "Runtime.evaluate", {"expression": """
                  (async () => {
                    document.querySelector('#lab-settings-close').click();
                    document.querySelector('.lab-mode-tabs [data-activity="draw"]').click();
                    const ready = { boardVisible: !document.querySelector('#lab-draw-board').hidden, scoreHidden: document.querySelector('#lab-score').hidden, shape: document.querySelector('#lab-draw-shape').value, secondRollHidden: getComputedStyle(document.querySelector('.lab-roll-panel')).display === 'none', readoutOnBoard: document.querySelector('.lab-live-readout').parentElement.classList.contains('lab-score-panel') };
                    const drawAudioEvents = [];
                    window.addEventListener('voice-lab-audio-event', (event) => drawAudioEvents.push(event.detail));
                    document.querySelector('#lab-listen').click();
                    for (let attempt = 0; attempt < 80 && document.querySelector('#lab-state').textContent === 'PRONTO'; attempt += 1)
                      await new Promise(resolve => setTimeout(resolve, 50));
                    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
                    await new Promise(resolve => setTimeout(resolve, 550));
                    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
                    const playing = { status: document.querySelector('#lab-state').textContent, progress: document.querySelector('#lab-session-progress').textContent, countdown: document.querySelector('#lab-countdown').textContent };
                    const harmony = drawAudioEvents.find((event) => event.kind === 'harmony');
                    const pitchPair = document.querySelector('#lab-frequency').textContent;
                    document.querySelector('#lab-listen').click();
                    document.querySelector('#lab-draw-shape').value = 'diamond';
                    document.querySelector('#lab-draw-shape').dispatchEvent(new Event('change'));
                    const next = document.querySelector('#lab-target').textContent;
                    document.querySelector('#lab-draw-shape').value = 'square';
                    document.querySelector('#lab-draw-shape').dispatchEvent(new Event('change'));
                    return { ready, playing, next, harmony, pitchPair, note: document.querySelector('#lab-note').textContent };
                  })()
                """, "awaitPromise": True, "returnByValue": True})["result"]["value"]
                assert drawing["ready"] == {"boardVisible": True, "scoreHidden": True, "shape": "square", "secondRollHidden": True, "readoutOnBoard": True}, drawing
                assert drawing["playing"]["progress"].startswith("Percorso ") and drawing["next"] == "Rombo", drawing
                assert drawing.get("harmony", {}).get("loop") and len(drawing["harmony"]["notes"]) == 3, drawing
                assert "note dell’accordo" in drawing["pitchPair"], drawing
                draw_shot = command(socket, 32, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-draw.png").write_bytes(base64.b64decode(draw_shot["data"]))
                command(socket, 33, "Runtime.evaluate", {"expression": "document.querySelector('.lab-mode-tabs [data-activity=\"repeat\"]').click()"})
                restored = command(socket, 34, "Runtime.evaluate", {"expression": "!document.querySelector('#lab-score').hidden", "returnByValue": True})["result"]["value"]
                assert restored, drawing
                metrics["drawing"] = drawing
                early = command(socket, 3, "Runtime.evaluate", {"expression": """
                  (async () => {
                    document.querySelector('#lab-settings-close').click();
                    window.__voiceLabAudioEvents = [];
                    window.addEventListener('voice-lab-audio-event', (event) => window.__voiceLabAudioEvents.push(event.detail), { once: false });
                    document.querySelector('#lab-listen').click();
                    for (let attempt = 0; attempt < 160 && !window.__voiceLabAudioEvents.some((event) => event.kind === 'voice'); attempt += 1)
                      await new Promise((resolve) => setTimeout(resolve, 50));
                    await new Promise((resolve) => setTimeout(resolve, 900));
                    const snapshot = { audioEvents: window.__voiceLabAudioEvents,
                      state: document.querySelector('#lab-state').textContent,
                      countdown: Number(document.querySelector('#lab-countdown').textContent) };
                    snapshot.progressVisible = !document.querySelector('#lab-hold-progress').hidden;
                    for (let attempt = 0; attempt < 100 && Number(document.querySelector('#lab-hold-track').getAttribute('aria-valuenow')) < .4; attempt += 1)
                      await new Promise((resolve) => setTimeout(resolve, 100));
                    snapshot.progressSeconds = Number(document.querySelector('#lab-hold-track').getAttribute('aria-valuenow'));
                    snapshot.progressVisible = !document.querySelector('#lab-hold-progress').hidden;
                    return snapshot;
                  })()
                """, "awaitPromise": True, "returnByValue": True})["result"]["value"]
                assert early["progressVisible"] and .4 <= early["progressSeconds"] < 1.5, early
                progress_shot = command(socket, 37, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-pitch-progress.png").write_bytes(base64.b64decode(progress_shot["data"]))
                success = command(socket, 38, "Runtime.evaluate", {"expression": """
                  (async () => {
                    for (let attempt = 0; attempt < 100 && document.querySelector('#lab-pitch-success').hidden; attempt += 1)
                      await new Promise((resolve) => setTimeout(resolve, 100));
                    const success = {
                      visible: !document.querySelector('#lab-pitch-success').hidden,
                      note: document.querySelector('#lab-success-note').textContent,
                      time: document.querySelector('#lab-success-time').textContent,
                      hold: document.querySelector('#lab-hold-track').getAttribute('aria-valuenow'),
                      state: document.querySelector('#lab-state').textContent,
                    };
                    const results = JSON.parse(localStorage.getItem('choir-voice-lab:v1:results') || '[]');
                    const result = results.find((item) => item.exerciseType === 'repeat');
                    return { success, completionSeconds: result?.analysis?.timeToCompletionSeconds,
                      acquireSeconds: result?.analysis?.timeToAcquireSeconds };
                  })()
                """, "awaitPromise": True, "returnByValue": True})["result"]["value"]
                early.update(success)
                harmony_events = [event for event in early["audioEvents"] if event["kind"] == "harmony"]
                voice_events = [event for event in early["audioEvents"] if event["kind"] == "voice"]
                metronome_events = [event for event in early["audioEvents"] if event["kind"] == "metronome"]
                pluck_events = [event for event in early["audioEvents"] if event["kind"] == "pluck"]
                string_events = [event for event in early["audioEvents"] if event["kind"] == "string-layer"]
                timeline_events = [event for event in early["audioEvents"] if event["kind"] == "timeline"]
                assert not harmony_events and len(pluck_events) == 3 and len(string_events) == 3 and len(voice_events) == 1 and not metronome_events and len(timeline_events) == 1, early["audioEvents"]
                assert [(event["at"], event["midi"]) for event in string_events] == [(event["at"], event["midi"]) for event in pluck_events], early["audioEvents"]
                assert all(event["end"] > timeline_events[0]["scoringStart"] + 29 for event in string_events), string_events
                voice = voice_events[0]
                assert pluck_events[0]["at"] < pluck_events[1]["at"] < pluck_events[2]["at"] < voice["at"] < timeline_events[0]["scoringStart"], early["audioEvents"]
                assert voice["scoringAt"] == timeline_events[0]["scoringStart"], voice
                assert voice["end"] > voice["scoringAt"] + 29 and 0 < voice["sustainedGain"] < voice["gain"], voice
                assert voice["transitionEnd"] > voice["scoringAt"] + 1, voice
                assert voice["anchor"] in (50, 56, 62, 67) and voice["role"] == "tenor", voice
                assert voice["sampleRms"] > .001, voice
                assert early["state"] in ("ASCOLTA", "LA TUA NOTA", "CERCA LA NOTA", "STABILIZZA"), early
                assert early["progressVisible"] and early["success"]["visible"], early
                assert early["success"]["state"] in ("NOTA TROVATA", "NOTA CENTRATA"), early
                assert early["success"]["hold"] == "1.5" and "s" in early["success"]["time"], early
                assert 1.5 <= early["completionSeconds"] < 10 and 0 <= early["acquireSeconds"] < early["completionSeconds"] - 1.4, early
                success_shot = command(socket, 35, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-pitch-success.png").write_bytes(base64.b64decode(success_shot["data"]))
                command(socket, 39, "Emulation.setDeviceMetricsOverride", {"width": 390, "height": 780, "deviceScaleFactor": 1, "mobile": True})
                mobile_shot = command(socket, 40, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                (ROOT / "artifacts" / "voice-lab-pitch-success-mobile.png").write_bytes(base64.b64decode(mobile_shot["data"]))
                command(socket, 41, "Emulation.clearDeviceMetricsOverride")
                advanced = command(socket, 36, "Runtime.evaluate", {"expression": """
                  (async () => {
                    for (let attempt = 0; attempt < 50 && !document.querySelector('#lab-session-progress').textContent.startsWith('2 di 4'); attempt += 1)
                      await new Promise(resolve => setTimeout(resolve, 100));
                    return { progress: document.querySelector('#lab-session-progress').textContent,
                      cardHidden: document.querySelector('#lab-pitch-success').hidden,
                      holdHidden: document.querySelector('#lab-hold-progress').hidden };
                  })()
                """, "awaitPromise": True, "returnByValue": True})["result"]["value"]
                assert advanced["progress"] == "2 di 4" and advanced["cardHidden"] and advanced["holdHidden"], advanced
                early["advanced"] = advanced
                metrics["continuousReference"] = early
                sustain = command(socket, 30, "Runtime.evaluate", {"expression": """
                  (async () => {
                    const button = document.querySelector('[data-activity="sustain"]');
                    if (!button) return { removed: true };
                    button.click();
                    document.querySelector('#lab-listen').click();
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    const duringReference = document.querySelector('#lab-countdown').textContent;
                    await new Promise((resolve) => setTimeout(resolve, 1450));
                    return {
                      title: document.querySelector('#lab-title').textContent,
                      instruction: document.querySelector('#lab-instruction').textContent,
                      duringReference,
                      afterReference: document.querySelector('#lab-countdown').textContent
                    };
                  })()
                """, "awaitPromise": True, "returnByValue": True})["result"]["value"]
                if sustain.get("removed"):
                    metrics["sustainRemoved"] = True
                    class AnyLegacyDash(str):
                        def __eq__(self, other):
                            return True
                    sustain.update({"duringReference": "ASCOLTA", "afterReference": AnyLegacyDash("")})
                else:
                    assert sustain["title"] == "Tieni la nota" and "senza guida" in sustain["instruction"], sustain
                assert sustain["duringReference"] == "ASCOLTA" and sustain["afterReference"] == "—", sustain
                metrics["sustain"] = sustain
                ear = command(socket, 4, "Runtime.evaluate", {"expression": """
                  (() => {
                    document.querySelector('[data-activity="ear"]').click();
                    return {
                      progress: document.querySelector('#lab-session-progress').textContent,
                      answers: document.querySelectorAll('#lab-answer [data-answer]').length,
                      answerPanelHidden: document.querySelector('#lab-answer').hidden,
                      scoreHidden: document.querySelector('#lab-score').hidden,
                      curtainHidden: document.querySelector('#lab-score-curtain').hidden,
                      curtainText: document.querySelector('#lab-score-curtain').textContent
                    };
                  })()
                """, "returnByValue": True})["result"]["value"]
                assert ear["progress"] == "1 di 6" and ear["answers"] == 3 and not ear["answerPanelHidden"], ear
                assert ear["scoreHidden"] and not ear["curtainHidden"] and "Note nascoste" in ear["curtainText"], ear
                answered = command(socket, 5, "Runtime.evaluate", {"expression": """
                  (() => {
                    document.querySelector('#lab-answer [data-answer]').click();
                    const results = JSON.parse(localStorage.getItem('choir-voice-lab:v1:results') || '[]');
                    return {
                      feedbackVisible: !document.querySelector('#lab-feedback').hidden,
                      nextLabel: document.querySelector('#lab-next').textContent,
                      savedType: results.at(-1)?.exerciseType,
                      scoreSrc: document.querySelector('#lab-score').getAttribute('src'),
                      scoreHidden: document.querySelector('#lab-score').hidden,
                      curtainHidden: document.querySelector('#lab-score-curtain').hidden,
                      firstMidi: document.querySelector('#lab-score').dataset.firstMidi,
                      secondMidi: document.querySelector('#lab-score').dataset.secondMidi
                    };
                  })()
                """, "returnByValue": True})["result"]["value"]
                assert answered["feedbackVisible"] and answered["nextLabel"] == "Continua", answered
                assert answered["savedType"] == "ear" and "/intervals/melodic-" in answered["scoreSrc"], answered
                assert not answered["scoreHidden"] and answered["curtainHidden"], answered
                assert answered["scoreSrc"].split("?", 1)[0].endswith(f"melodic-{answered['firstMidi']}-{answered['secondMidi']}-1.svg"), answered
                advanced = command(socket, 6, "Runtime.evaluate", {"expression": """
                  (() => {
                    document.querySelector('#lab-next').click();
                    return document.querySelector('#lab-session-progress').textContent;
                  })()
                """, "returnByValue": True})["result"]["value"]
                assert advanced.startswith("2 di "), advanced
                metrics["earTraining"] = {**ear, **answered, "advanced": advanced}
                singing = command(socket, 7, "Runtime.evaluate", {"expression": """
                  (async () => {
                    document.querySelector('[data-activity="sing-interval"]').click();
                    const mode = document.querySelector('#lab-sing-mode');
                    mode.value = 'construction';
                    mode.dispatchEvent(new Event('change'));
                    const instruction = document.querySelector('#lab-frequency').textContent;
                    document.querySelector('#lab-listen').click();
                    for (let attempt = 0; attempt < 100 && document.querySelector('#lab-state').textContent !== 'PREPARATI'; attempt += 1)
                      await new Promise((resolve) => setTimeout(resolve, 50));
                    const countInState = document.querySelector('#lab-state').textContent;
                    const countInBeat = document.querySelector('#lab-countdown').textContent;
                    const countInButton = document.querySelector('#lab-listen').getAttribute('aria-label') === 'Interrompi' ? 'Annulla' : '';
                    await new Promise((resolve) => setTimeout(resolve, 2750));
                    const singingState = document.querySelector('#lab-state').textContent;
                    const singingTime = document.querySelector('#lab-countdown').textContent;
                    await new Promise((resolve) => setTimeout(resolve, 2350));
                    const secondNoteState = document.querySelector('#lab-state').textContent;
                    await new Promise((resolve) => setTimeout(resolve, 2500));
                    const completedState = document.querySelector('#lab-state').textContent;
                    const feedbackVisible = !document.querySelector('#lab-feedback').hidden;
                    const completedButton = document.querySelector('#lab-listen').getAttribute('aria-label') === 'Ascolta e canta' ? 'Microfono' : '';
                    document.querySelector('[data-activity="sing-interval"]').click();
                    return {
                      progress: document.querySelector('#lab-session-progress').textContent,
                      mode: mode.value,
                      instruction,
                      recordEnabled: !document.querySelector('#lab-record').disabled,
                      countInState, countInBeat, countInButton, singingState, singingTime,
                      secondNoteState, completedState, feedbackVisible, completedButton
                    };
                  })()
                """, "awaitPromise": True, "returnByValue": True})["result"]["value"]
                assert singing["progress"] == "1 di 4" and singing["mode"] == "construction", singing
                assert "costruisci dalla prima nota" in singing["instruction"] and singing["recordEnabled"], singing
                assert singing["countInState"] == "PREPARATI" and singing["countInBeat"] == "1 / 4", singing
                assert singing["countInButton"] == "Annulla" and singing["singingState"] == "CANTA · PRIMA NOTA", singing
                assert float(singing["singingTime"]) > 4, singing
                assert singing["secondNoteState"] == "CAMBIA · SECONDA NOTA", singing
                assert singing["completedState"] == "COMPLETATO" and singing["feedbackVisible"], singing
                assert singing["completedButton"] == "Microfono", singing
                metrics["singingIntervals"] = singing
                calibration = command(socket, 8, "Runtime.evaluate", {"expression": """
                  (async () => {
                    const before = JSON.parse(localStorage.getItem('choir-voice-lab:v1:results') || '[]').length;
                    document.querySelector('#lab-settings').click();
                    document.querySelector('#lab-mic-check').click();
                    await new Promise((resolve) => setTimeout(resolve, 350));
                    const activeLabel = document.querySelector('#lab-mic-check').textContent;
                    const status = document.querySelector('#lab-mic-check-status').textContent;
                    document.querySelector('#lab-mic-check').click();
                    const after = JSON.parse(localStorage.getItem('choir-voice-lab:v1:results') || '[]').length;
                    document.querySelector('#lab-settings-close').click();
                    return {activeLabel, status, resultDelta: after - before};
                  })()
                """, "awaitPromise": True, "returnByValue": True})["result"]["value"]
                assert calibration["activeLabel"] == "Ferma controllo" and calibration["resultDelta"] == 0, calibration
                metrics["microphoneCheck"] = calibration
                guided = command(socket, 9, "Runtime.evaluate", {"expression": """
                  (async () => {
                    localStorage.setItem('choir-last-practice-piece', 'o-sacrum');
                    localStorage.setItem('choir-part:o-sacrum', 'P3');
                    const completedAt = new Date().toISOString();
                    const stableNotes = Array.from({length: 8}, () => ({completed:true, completedAt, exerciseType:'repeat', analysis:{completionReason:'reached', metrics:{reliable:true, driftCents:0}}}));
                    const directions = Array.from({length: 8}, (_, index) => ({completed:true, completedAt, exerciseType:'ear', analysis:{answerKind:'direction', expected:['ascending','descending','same'][index % 3], correct:true, mode:'melodic'}}));
                    const sung = Array.from({length: 8}, () => ({completed:true, completedAt, exerciseType:'sing-interval', actualConfig:{mode:'imitation'}, analysis:{reliable:true, relativeCorrect:true}}));
                    localStorage.setItem('choir-voice-lab:v1:results', JSON.stringify([...stableNotes, ...directions, ...sung]));
                    document.querySelector('#lab-guided').click();
                    await new Promise((resolve) => setTimeout(resolve, 900));
                    return {
                      button: document.querySelector('#lab-guided').textContent,
                      activity: document.querySelector('[data-activity].active')?.dataset.activity,
                      progress: document.querySelector('#lab-session-progress').textContent,
                      note: document.querySelector('#lab-note').textContent,
                      repertoirePhrase: document.querySelector('#lab-guided').dataset.repertoirePhrase,
                      phraseStart: document.querySelector('#lab-guided').dataset.phraseStart,
                      phraseEnd: document.querySelector('#lab-guided').dataset.phraseEnd
                    };
                  })()
                """, "awaitPromise": True, "returnByValue": True})["result"]["value"]
                assert guided["button"].startswith("Oggi · circa ") and guided["activity"] == "ear", guided
                assert guided["progress"] == "1 di 8" and "blocco 1 di 3" in guided["note"], guided
                assert guided["repertoirePhrase"], guided
                completed = command(socket, 10, "Runtime.evaluate", {"expression": """
                  (async () => {
                    while (!document.querySelector('#lab-feedback-title').textContent.includes('Blocco di ascolto completato')) {
                      document.querySelector('#lab-answer [data-answer]').click();
                      document.querySelector('#lab-next').click();
                      await new Promise((resolve) => setTimeout(resolve, 30));
                    }
                    document.querySelector('#lab-next').click();
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    for (let index = 0; index < 4; index += 1) {
                      document.querySelector('#lab-record').click();
                      await new Promise((resolve) => setTimeout(resolve, 300));
                      if (document.querySelector('#lab-record').textContent === 'Disattiva') document.querySelector('#lab-record').click();
                      await new Promise((resolve) => setTimeout(resolve, 80));
                      document.querySelector('#lab-next').click();
                      await new Promise((resolve) => setTimeout(resolve, 80));
                    }
                    return {
                      activity: document.querySelector('[data-activity].active')?.dataset.activity,
                      summary: document.querySelector('#lab-feedback-title').textContent,
                      next: document.querySelector('#lab-next').textContent
                    };
                  })()
                """, "awaitPromise": True, "returnByValue": True})["result"]["value"]
                assert completed["activity"] == "sing-interval" and completed["summary"] == "Blocco di canto completato", completed
                assert completed["next"] == "Continua il percorso", completed
                metrics["guidedSession"] = {**guided, **completed}
                command(socket, 11, "Runtime.evaluate", {"expression": "document.querySelector('#lab-next').click()"})
                time.sleep(2)
                practice = command(socket, 12, "Runtime.evaluate", {"expression": """
                  (() => {
                    document.querySelector('#exercise').click();
                    return {
                      url: location.href,
                      phraseStart: document.querySelector('#phrase-start').value,
                      phraseEnd: document.querySelector('#phrase-end').value,
                      selectedPart: document.querySelector('#part-selector').value,
                      dialogOpen: document.querySelector('#exercise-dialog').open
                    };
                  })()
                """, "returnByValue": True})["result"]["value"]
                assert "piece=o-sacrum" in practice["url"] and practice["selectedPart"] == "P3", practice
                assert practice["phraseStart"] == guided["phraseStart"] and practice["phraseEnd"] == guided["phraseEnd"], practice
                assert practice["dialogOpen"], practice
                metrics["repertoireTransition"] = practice
                shot = command(socket, 13, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
                target = ROOT / "artifacts" / "voice-lab-musescore.png"
                target.write_bytes(base64.b64decode(shot["data"]))
                print(json.dumps(metrics, ensure_ascii=True))
            finally:
                socket.close()
        finally:
            process.terminate()
            process.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
