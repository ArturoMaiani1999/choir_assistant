# Backend foundation

This first backend slice intentionally uses only the Python standard library. It establishes the domain and ingestion-job contracts before adding FastAPI and a worker queue.

## Run the ingestion preflight

From the repository root:

```powershell
python -m backend.choir_assistant.cli ingest submit "sheets/Gloria Frisina.pdf" --piece-id gloria-frisina
```

The command creates a versioned job under `data/ingestions/<job-id>/`. It preserves the source PDF by copying it into the job directory, records its SHA-256, discovers local tooling, and stops with an explicit capability status if Audiveris is unavailable. It never creates fake MusicXML or MuseScore output.

## Runtime model

`choir_assistant.domain.models` contains the first runtime score contract. It deliberately separates written measures and performance occurrences, even before the MusicXML compiler is added.

## Compile MusicXML

The first dependency-free symbolic compiler is available through:

```powershell
python -m backend.choir_assistant.cli score compile-musicxml path/to/score.musicxml --output data/score.json
```

`choir_assistant.ingestion.musicxml.compile_musicxml` currently parses partwise MusicXML notes, rests, durations, voices, lyrics, time signatures and basic metronome/`<sound tempo>` changes. It emits `NormalizedScore` JSON with beat and second coordinates. Forward/backward repeats and simple first/second ending labels are flattened into distinct `PerformanceOccurrence` records. One explicit D.C. or D.S. pass is also supported, including Fine and the basic To Coda/Coda path; ambiguous or nested navigation remains a reported limitation.
