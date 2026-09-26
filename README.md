# choir_assistant

Private choir rehearsal platform: the legacy Flutter prototype is kept as reference while the new product architecture is designed around a canonical MusicXML score, a flattened performance timeline, and local browser pitch analysis.

## Project status

The repository now includes a frontend-first Practice UX milestone alongside the ingestion foundation. It is not a production application: notation is still a draft asset, singer pitch/scoring are mocked, and the legacy Flutter project remains unchanged.

The future product must support a repeatable admin workflow:

```text
PDF upload -> agentic ingestion job -> OMR -> raw MusicXML -> validation
           -> MuseScore review -> explicit approval -> published app assets
```

An unreviewed transcription is never authoritative and is never exposed to singers.

## Documents

- [Architecture audit](docs/ARCHITECTURE_AUDIT.md)
- [Agentic PDF ingestion pipeline](docs/INGESTION_PIPELINE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Legacy pitch-tracking audit](docs/LEGACY_PITCH_TRACKING_AUDIT.md)
- [Practice UX specification](docs/PRACTICE_UX_SPEC.md)
- [Practice redesign plan](docs/PRACTICE_REDESIGN_PLAN.md)
- [Practice redesign progress](docs/PRACTICE_REDESIGN_PROGRESS.md)
- [Playback synchronization audit](docs/PLAYBACK_SYNC_AUDIT.md)
- [Score reconstruction policy](docs/SCORE_RECONSTRUCTION_POLICY.md)
- [Free multi-engine OMR consensus pipeline](docs/FREE_OMR_CONSENSUS_PIPELINE.md)

## Runnable Practice milestone

The browser slice is a dependency-free rehearsal interface with browser-local, monophonic pitch feedback. The existing part-specific backing mix remains connected; press **Microfono** and allow access to see the detected voice. For reliable results, use headphones.

```powershell
python scripts/serve_frontend.py
```

Then open `http://localhost:5173`. Landscape is recommended for active rehearsal.

At access, choose one of the folders in `sheets/` that contains its editable
`.mscz` source, then choose the part to sing. The local server derives the
browser score, full-score preview and rehearsal audio from that MuseScore
source; it never substitutes an unreviewed PDF/OMR transcription for it.

### Current voice-pitch detection and scoring heuristic

Pitch analysis is entirely local in the browser (`frontend/pitch_detector.js`);
no microphone audio is sent to a server. It is intended for **one unaccompanied
voice captured by the microphone**. The backing track should be heard through
headphones, because the detector has no source separation and can otherwise
lock on to the accompaniment or room reflections.

The current fundamental-frequency (`F0`) estimator is a small JavaScript
implementation of the **YIN-style time-domain algorithm**:

- Each animation frame reads a 4,096-sample floating-point microphone buffer
  from a Web Audio `AnalyserNode` (at the browser's audio sample rate).
- It rejects very quiet input (RMS below `0.001`), searches periods
  corresponding to **70–1,000 Hz**, calculates the squared-difference function
  and its cumulative mean normalized difference (CMND), then chooses the first
  descending CMND minimum below the YIN threshold `0.42`.
- A three-point parabolic interpolation around that minimum refines the period,
  and `F0 = sampleRate / period`. “Clarity” is `1 - CMND(minimum)`; the exposed
  confidence is clarity multiplied by a level term that saturates at RMS `0.08`.

The raw estimate is then passed through a hand-tuned temporal heuristic before
it is shown, recorded, or scored:

- Frames require clarity at least `0.45` and confidence at least `0.30`; after
  three consecutive rejected/unvoiced frames, the displayed pitch is released.
- Three reliable voiced frames are required before a pitch is accepted. A
  3-frame median in logarithmic pitch space rejects isolated outliers, followed
  by exponential smoothing (alpha `0.65` during warm-up, `0.30` afterwards).
- Changes of at most 300 cents are accepted immediately. Larger changes must
  be internally consistent within 100 cents for 3 frames; octave-sized changes
  (1,200 ± 180 cents) require 5 frames. This specifically suppresses common
  octave flips, but delays legitimate leaps.
- The accepted `F0` is converted to MIDI pitch relative to A4 = 440 Hz. During
  playback, it is compared only with the active MusicXML target after that
  note's configured attack grace period. Time is counted as in tune when the
  result is within ±30 cents (the display calls ±12 cents “centred”); unvoiced
  and uncertain frames are excluded from the percentage rather than penalised.

This is a practical prototype, not a robust choir-vocal analysis system. It
does not model voice type or expected-note priors, vibrato, consonant/onset
behaviour, reverberation, background speech/noise, accompaniment bleed, or
multiple simultaneous singers. Its thresholds are empirical rather than
calibrated against a labelled vocal dataset. The browser currently requests a
mono microphone with echo cancellation and noise suppression disabled, but
automatic gain control enabled.

Questions to take to a pitch-detection expert: whether to retain a lightweight
YIN/pYIN family detector with probabilistic voicing and score-aware tracking,
or use a modern neural F0 estimator; how to evaluate candidates on the
self-approved takes described below; and how to distinguish onset, sustained
pitch, vibrato, octave errors, and accompaniment leakage without making the
feedback feel laggy. The module API is deliberately separate from the UI so a
WebAssembly or AudioWorklet-based detector can replace it without rewriting
the scoring interface.

### Monodic pieces

For a monodic score, the application exposes four vocal practice choices even
though the source has a single written melody:

- **Soprano** and **Contralto** use the written melody.
- **Tenore** and **Basso** use the same melody one octave lower.

This is a rehearsal convention for the app, not a modification of the
canonical `.mscz` source.

### Self-approved ground-truth takes

Use **Campione** in the Practice toolbar to capture a passage you personally
judge to be correctly sung. On approval the browser stores the raw audio,
expected symbolic targets, detected-pitch trajectory, selected part and score
version in its local IndexedDB database. These are labelled
`self-approved-ground-truth`: useful evaluation material for comparing pitch
detectors, but not externally validated musical truth. They stay on that
browser until an explicit export/delete workflow is added.

The ingestion foundation can be exercised against the real benchmark PDF:

```powershell
python -m backend.choir_assistant.cli ingest submit "sheets/gloria-frisina/gloria-frisina.pdf" --piece-id gloria-frisina
```

The command preserves the PDF, records its hash and tool capabilities, and stops explicitly when the OMR tool is unavailable. It does not fabricate MusicXML or MuseScore output.

## Repository boundary

`FlutterPitchGame-main/` is legacy reference code. It is deliberately excluded from the new implementation until the audit is complete.
