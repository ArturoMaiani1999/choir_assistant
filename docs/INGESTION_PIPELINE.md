# Agentic PDF ingestion pipeline

This document turns “upload a PDF and obtain a MuseScore for admin approval” into a repeatable product capability.

## Product contract

An admin uploads a PDF. The system creates an ingestion job and eventually presents a review package containing:

- the original PDF, preserved unchanged;
- normalized page images and preprocessing metadata;
- the OMR project (`.omr`) when the selected adapter supports it;
- raw MusicXML exported by OMR;
- normalized MusicXML used for downstream generation;
- a MuseScore file (`.mscz`) opened/tested by the installed MuseScore adapter;
- a machine-readable timeline;
- validation and uncertainty reports;
- rendered score previews and, only if validation permits, derived MIDI/audio assets;
- a complete manifest with hashes, tool versions, configuration, logs and timestamps.

The job remains `pending_review` until the admin has inspected the score in MuseScore and explicitly approves that exact `ScoreVersion`. Approval does not mutate the raw output; it creates an immutable approved revision. Publishing then creates a separate immutable asset set.

## State machine

```text
received
  -> validating_input
  -> capabilities_checked
  -> preprocessing
  -> omr_running
  -> musicxml_extracted
  -> normalizing
  -> validating_score
  -> materializing_musescore
  -> building_timeline
  -> generating_preview_assets
  -> pending_review
       -> rejected -> (new job or corrected revision)
       -> approved -> publishing -> published

Any automated state may enter failed_retryable or failed_terminal.
```

The state transition is persisted after every stage. Retries are idempotent: a stage is keyed by `(job_id, stage, input_hash, toolchain_hash, configuration_hash)` and never overwrites a previous artifact. A retry creates a new attempt record.

## Bounded agents and deterministic tools

“Agentic” means the system can inspect context, choose the next safe adapter action, explain failures, and produce a useful review packet. It does not mean an LLM is allowed to rewrite notation without provenance.

| Component | Responsibility | Must not do |
|---|---|---|
| Ingestion orchestrator | Persist state, dispatch stages, retry safe failures, enforce gates. | Skip approval or hide a failed stage. |
| Capability inspector | Discover configured executables and versions: MuseScore, Audiveris, Java, FFmpeg/renderers. | Install software or silently switch to an unapproved online service. |
| PDF preflight agent | Check MIME, page count, dimensions, rotation, scan quality and likely score pages; recommend preprocessing. | Alter the original PDF. |
| OMR runner | Invoke the selected adapter with a pinned configuration and capture stdout/stderr. | Guess missing notes or silently repair MusicXML. |
| MusicXML validator/normalizer | Parse schema, detect structural problems, normalize safe representation details, emit warnings. | Change ambiguous pitch/rhythm semantics without an explicit rule and provenance. |
| MuseScore adapter | Import MusicXML, save `.mscz`, export previews/parts/audio where configured, and run smoke checks. | Mark a score approved. |
| Timeline builder | Resolve symbolic measures and navigation into performance occurrences and target events. | Infer navigation from rendered audio. |
| QA/report agent | Summarize warnings, compare expected part/range/meter properties, and identify pages/measures for review. | Turn uncertainty into a green pass. |
| Review coordinator | Expose artifacts and collect admin decision/comments. | Publish a `review` version. |

The first implementation can use Python functions/classes rather than an LLM. If an LLM is later added for report synthesis or operator guidance, its output is advisory, schema-validated, logged, and never the only source of a musical mutation.

## Implemented symbolic compiler slice

`backend/choir_assistant/ingestion/musicxml.py` now provides a dependency-free `compile_musicxml()` function and the CLI command:

```text
python -m backend.choir_assistant.cli score compile-musicxml path/to/score.musicxml --output data/score.json
```

This slice parses partwise notes, rests, durations, voices, lyrics, time signatures and basic tempo directions into the existing `NormalizedScore` contract. It computes both beat coordinates and seconds using the tempo map. Forward/backward repeats and simple first/second ending labels are flattened into performance occurrences. One explicit D.C. or D.S. pass is supported, including Fine and the basic To Coda/Coda path. It remains a compiler, not an OMR engine, and nested or ambiguous navigation is not silently guessed.

## Artifact layout

```text
data/ingestions/<job-id>/
  manifest.json
  input/source.pdf
  preflight/report.json
  preflight/pages/page-001.png
  omr/attempt-001/
    command.json
    stdout.log
    stderr.log
    source.omr
    raw.musicxml
  normalized/score.musicxml
  musescore/master.mscz
  timeline/timeline.json
  derived/preview.pdf
  derived/parts/<part-id>.*
  derived/audio/<part-id>.wav
  reports/validation.json
  reports/review.html
  audit/events.ndjson
```

The application database stores metadata and references; large files live in the artifact store. For the local MVP the artifact store can be the filesystem. Every file is addressed by SHA-256 and referenced from `manifest.json`.

## Manifest minimum

```json
{
  "job_id": "ing-2026-0001",
  "piece_id": "gloria-frisina",
  "source": {"filename": "Gloria Frisina.pdf", "sha256": "..."},
  "status": "pending_review",
  "toolchain": {
    "musescore": {"path": "...\\MuseScore4.exe", "version": "4.7.4"},
    "omr": {"adapter": "audiveris", "version": "5.x"}
  },
  "configuration": {"omr_profile": "printed-choir", "language": ["it"]},
  "artifacts": [
    {"kind": "raw_musicxml", "path": "omr/attempt-001/raw.musicxml", "sha256": "..."},
    {"kind": "review_mscz", "path": "musescore/master.mscz", "sha256": "..."}
  ],
  "quality": {
    "errors": 0,
    "warnings": 7,
    "uncertainty_count": 12,
    "requires_human_review": true
  }
}
```

## Safety gates

The job cannot reach `pending_review` when any of these is true:

- the source is not a valid PDF or exceeds configured limits;
- required executable capability is unavailable;
- OMR exits unsuccessfully or produces no MusicXML;
- MusicXML cannot be parsed or contains unbound measures/events;
- MuseScore cannot open/save the generated score;
- the timeline contains impossible durations, negative time, or unresolved navigation;
- manifest hashes do not match the files on disk.

Warnings may be accepted only by the admin during review and remain attached to the approved version. A failed job is visible with its logs and can be retried with a new attempt.

## Human review UX

The admin review page should show the score preview beside the structured report and expose:

- open/download `.mscz` and MusicXML;
- page/measure warning locations;
- detected parts and ranges;
- repeat/navigation summary;
- timeline preview and total duration;
- approve, reject, or request correction with a comment;
- exact toolchain and input hash.

“Approve” requires an explicit confirmation that the MuseScore file has been inspected. “Publish” is a second action because a corrected approved score may exist before it is made visible to singers.

## Initial CLI contract

The same service API and CLI should call the same application service:

```text
choir ingest submit path/to/score.pdf --piece-id gloria-frisina
choir ingest status <job-id>
choir ingest retry <job-id> --stage omr
choir ingest report <job-id>
choir score approve <score-version-id>
choir score publish <score-version-id>
```

The CLI is useful for Milestone 1 and remains the fallback if the web admin page is temporarily unavailable. It must not implement a second conversion path.

## First benchmark

The first benchmark is `Gloria Frisina` once its PDF is added to the workspace. The expected review checklist includes Soprano, Alto, Tenor, Bass, Organ, lyrics, rests, ties, tempo/meter/key, repeats, `Fine`, `D.C. al Fine`, organ grand staff, part alignment, and performance-order flattening.
