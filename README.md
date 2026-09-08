# choir_assistant

Private choir rehearsal platform: the legacy Flutter prototype is kept as reference while the new product architecture is designed around a canonical MusicXML score, a flattened performance timeline, and local browser pitch analysis.

## Project status

The repository is currently in the technical-audit phase. No production web application has been generated yet and the legacy Flutter project has intentionally not been modified.

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

## First runnable slice

The first browser slice is a dependency-free local pitch lab. It runs the YIN-style detector in the browser and does not upload microphone audio.

```powershell
python -m http.server 5173 --directory frontend
```

Then open `http://localhost:5173` and allow microphone access.

The ingestion foundation can be exercised against the real benchmark PDF:

```powershell
python -m backend.choir_assistant.cli ingest submit "sheets/Gloria Frisina.pdf" --piece-id gloria-frisina
```

The command preserves the PDF, records its hash and tool capabilities, and stops explicitly when the OMR tool is unavailable. It does not fabricate MusicXML or MuseScore output.

## Repository boundary

`FlutterPitchGame-main/` is legacy reference code. It is deliberately excluded from the new implementation until the audit is complete.
