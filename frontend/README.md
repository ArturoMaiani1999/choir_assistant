# Pitch lab

This is the first browser-native rehearsal slice. It deliberately has no npm dependency so it can be tested immediately on a local machine while the React/Vite shell is introduced later.

## Run it

From the repository root:

```powershell
python -m http.server 5173 --directory frontend
```

Open `http://localhost:5173`, allow microphone access, and sing or play a sustained note. The detector runs locally in the browser; microphone audio is not uploaded.

The screen now also contains a small symbolic-score runtime fixture loaded from `score-fixtures/development-target.json`. It exposes note events with MIDI pitch, frequency, measure, onset beat, and duration, driven by a single beat-based `PerformanceClock`. Use `Start target timeline` to advance through the fixture while the microphone is running.

The fixture is explicitly not a transcription of `sheets/Gloria Frisina.pdf`. It exists to validate the target-event contract before the approved MusicXML/OMR compiler is connected.
