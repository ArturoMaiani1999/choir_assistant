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

## Runnable Practice milestone

The browser slice is a dependency-free rehearsal interface with deterministic mock pitch feedback. The existing part-specific backing mix remains connected; microphone capture is intentionally not connected in this visual milestone.

```powershell
python scripts/serve_frontend.py
```

Then open `http://localhost:5173`. Landscape is recommended for active rehearsal.

The ingestion foundation can be exercised against the real benchmark PDF:

```powershell
python -m backend.choir_assistant.cli ingest submit "sheets/Gloria Frisina.pdf" --piece-id gloria-frisina
```

The command preserves the PDF, records its hash and tool capabilities, and stops explicitly when the OMR tool is unavailable. It does not fabricate MusicXML or MuseScore output.

## Repository boundary

`FlutterPitchGame-main/` is legacy reference code. It is deliberately excluded from the new implementation until the audit is complete.
