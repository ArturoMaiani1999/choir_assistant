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
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10)
            try:
                command(socket, 1, "Page.enable")
                time.sleep(1)
                result = command(socket, 2, "Runtime.evaluate", {"expression": "({src:document.querySelector('#lab-score').getAttribute('src'),complete:document.querySelector('#lab-score').complete,naturalWidth:document.querySelector('#lab-score').naturalWidth,tag:document.querySelector('#lab-score').tagName})", "returnByValue": True})
                metrics = result["result"]["value"]
                assert metrics["tag"] == "IMG" and metrics["complete"] and metrics["naturalWidth"] > 0, metrics
                assert "/notes/note-" in metrics["src"], metrics
                early = command(socket, 3, "Runtime.evaluate", {"expression": """
                  (async () => {
                    document.querySelector('#lab-settings-close').click();
                    document.querySelector('#lab-record').click();
                    let result;
                    for (let attempt = 0; attempt < 120 && !result; attempt += 1) {
                      await new Promise((resolve) => setTimeout(resolve, 50));
                      const results = JSON.parse(localStorage.getItem('choir-voice-lab:v1:results') || '[]');
                      result = results.find((item) => item.exerciseType === 'repeat');
                    }
                    const transition = {
                      progress: document.querySelector('#lab-session-progress').textContent,
                      continueHidden: document.querySelector('#lab-continue').hidden,
                      continueLabel: document.querySelector('#lab-continue').textContent,
                      recordHidden: document.querySelector('#lab-record').hidden
                    };
                    await new Promise((resolve) => setTimeout(resolve, 1900));
                    return {
                      completionReason: result?.analysis?.completionReason,
                      completionSeconds: result?.analysis?.timeToCompletionSeconds,
                      progress: document.querySelector('#lab-session-progress').textContent,
                      recordingLabel: document.querySelector('#lab-record').textContent,
                      transition
                    };
                  })()
                """, "awaitPromise": True, "returnByValue": True})["result"]["value"]
                assert early["completionReason"] in ("reached", "reached-with-correction"), early
                assert 1.4 <= early["completionSeconds"] < 10 and early["progress"] == "2 di 4", early
                assert early["transition"]["progress"].endswith("riuscita"), early
                assert not early["transition"]["continueHidden"] and early["transition"]["recordHidden"], early
                assert early["transition"]["continueLabel"].startswith("Continua"), early
                metrics["earlyCompletion"] = early
                sustain = command(socket, 30, "Runtime.evaluate", {"expression": """
                  (async () => {
                    document.querySelector('[data-activity="sustain"]').click();
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
                assert answered["scoreSrc"].endswith(f"melodic-{answered['firstMidi']}-{answered['secondMidi']}-1.svg"), answered
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
                    document.querySelector('#lab-record').click();
                    await new Promise((resolve) => setTimeout(resolve, 120));
                    const countInState = document.querySelector('#lab-state').textContent;
                    const countInBeat = document.querySelector('#lab-countdown').textContent;
                    const countInButton = document.querySelector('#lab-record').textContent;
                    await new Promise((resolve) => setTimeout(resolve, 2750));
                    const singingState = document.querySelector('#lab-state').textContent;
                    const singingTime = document.querySelector('#lab-countdown').textContent;
                    await new Promise((resolve) => setTimeout(resolve, 2350));
                    const secondNoteState = document.querySelector('#lab-state').textContent;
                    await new Promise((resolve) => setTimeout(resolve, 2500));
                    const completedState = document.querySelector('#lab-state').textContent;
                    const feedbackVisible = !document.querySelector('#lab-feedback').hidden;
                    const completedButton = document.querySelector('#lab-record').textContent;
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
