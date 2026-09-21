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
