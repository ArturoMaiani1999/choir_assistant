# Implementation plan

## Milestone 0 — audit and contract

**Status:** complete for the current repository snapshot.

Deliverables:

- architecture and tool audit;
- legacy pitch-tracking audit;
- durable ingestion-pipeline specification;
- explicit decision that unreviewed OMR cannot be published.

Exit condition: the domain model, state machine, artifact policy and first benchmark are agreed before production UI work starts.

## Milestone 1 — ingestion proof of concept

Build the smallest vertical slice around one real PDF, starting with `Gloria Frisina` when its PDF is added.

Deliverables:

1. Python package for `IngestionJob`, artifact manifest, content hashes and state transitions.
2. Capability inspector for MuseScore and Audiveris; clear diagnostics when a tool is absent.
3. PDF preflight and page-image extraction.
4. Audiveris adapter with captured command, environment, stdout/stderr, `.omr` preservation and raw MusicXML export.
5. MusicXML parser/validator that reports rather than guesses.
6. MuseScore 4 adapter that imports MusicXML, saves `.mscz`, and exports a review preview.
7. Initial timeline builder with parts, measures, tempo/meter, ties and navigation occurrences.
8. Validation report and review manifest.
9. CLI commands `ingest submit`, `status`, `report`, `retry`.

Acceptance criteria:

- a rerun with the same inputs is reproducible and does not overwrite prior artifacts;
- the generated `.mscz` opens in MuseScore;
- the report identifies warnings and unresolved items;
- no job can be marked approved by the worker;
- the first score’s five expected parts and `D.C. al Fine` behavior are either represented or explicitly reported as blockers.

## Milestone 2 — admin review gate

Add FastAPI endpoints and a minimal React admin view:

- upload PDF;
- see live job state and logs;
- download/open review artifacts;
- inspect warnings and timeline summary;
- reject/request correction;
- approve an immutable score version;
- publish a derived asset set as a separate action.

Use SQLite and local filesystem storage initially. Add authentication before exposing the service beyond the local machine.

## Milestone 3 — canonical asset generation

From one approved MusicXML version, generate:

- master MusicXML and MuseScore files;
- generic part exports (not hard-coded to exactly SATB);
- MIDI;
- aligned audio stems for available parts and organ;
- SVG/PDF score previews;
- `timeline.json` and an asset manifest.

Add checks that all stems share the same start offset, sample rate policy, duration and score-version hash.

## Milestone 4 — rehearsal vertical slice

Implement one piece and one voice in the React application:

- render approved MusicXML;
- choose a written measure;
- resolve preceding lead-in and scoring start as performance occurrences;
- play a stem and metronome from the canonical clock;
- capture microphone locally;
- run browser pitch detection;
- display target and singer trajectory;
- calculate cents and a meaningful session summary.

No dynamic score following in this milestone.

## Milestone 5 — multi-part rehearsal product

Add generic parts, aligned-stem mixer modes, organ, metronome, 50/75/100% speed, score cursor, user accounts, role separation, session history and progress charts.

Speed must be tested for pitch preservation and clock synchronization on the target browser/device matrix before being enabled globally.

## Milestone 6 — quality and scale

Only after the first real repertoire is working:

- automated OMR benchmark set;
- correction feedback and re-ingestion;
- additional OMR adapters if justified;
- richer rhythm analysis;
- director analytics;
- deployment hardening and PostgreSQL migration.

## Testing gates

Every milestone must include:

- unit tests for Hz/MIDI/cents, tempo, measure selection and timeline expansion;
- fixture tests for repeats, first/second endings, `D.C.`, `D.S.`, `Coda` and `Fine`;
- synthetic audio tests for pitch and noise conditions;
- manifest/hash and retry tests;
- integration tests from MusicXML to timeline to target lookup;
- a manual MuseScore smoke test for generated files.

## Immediate next actions

1. Add the actual `Gloria Frisina.pdf` to a controlled input location.
2. Install or configure Audiveris and record its exact version in the environment manifest.
3. Scaffold the Python ingestion package and CLI around the state machine in `INGESTION_PIPELINE.md`.
4. Run the first OMR attempt without normalizing away any intermediate artifact.
5. Review the generated MuseScore manually and use observed errors to refine validators and the benchmark, not hidden repair rules.
