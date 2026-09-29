# Symbolic score runtime slice

This increment connects the browser pitch lab to the first data-driven target timeline.

## Implemented

`frontend/score_runtime.js` defines:

- `NormalizedScoreRuntime`, with target events containing `midiPitch`, derived `frequencyHz`, `measureNumber`, `onsetBeat`, and `durationBeats`;
- `PerformanceClock`, whose canonical position is a beat value derived from `tempoBpm`;
- `createDemoScore()`, a deliberately synthetic fallback fixture.

`frontend/score-fixtures/development-target.json` is the active browser artifact. It follows the backend field names (`target_events`, `tempo_map`, `measures`) and is loaded by `frontend/app.js` with `fetch()` and `NormalizedScoreRuntime.fromNormalizedScore()`.

`frontend/app.js` uses the runtime target for the target note, target frequency, graph line, deviation in cents, and displayed measure/beat. The microphone detector never supplies the target; it only supplies the singer estimate.

## Deliberate limitation

The JSON fixture is not derived from `sheets/gloria-frisina/gloria-frisina.pdf`. Gloria Frisina is still waiting for the PDF ingestion/OMR pipeline and administrative approval. Repeats, endings, D.C., D.S., Coda, and real score navigation are therefore not implemented in this browser fixture yet.

The clock currently advances while the microphone analysis loop is active. This is a development runtime, not yet synchronized to guide audio or a score renderer. The intended next step is to replace the fixture with the backend `NormalizedScore` JSON produced from an approved symbolic score, retaining the same event/clock contract.
