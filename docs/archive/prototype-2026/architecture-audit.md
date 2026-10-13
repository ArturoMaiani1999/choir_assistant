# Architecture audit

**Status:** Milestone 0 audit, 8 September 2026  
**Scope:** repository, `FlutterPitchGame-main`, local score tooling, and the future PDF upload workflow.

## Executive decision

The new application should be built as a React + TypeScript web client and a Python + FastAPI backend, with SQLite for the local MVP behind a repository interface that can later target PostgreSQL.

The musical source of truth is an approved, versioned MusicXML score. MuseScore files are the editable review artifact; rendered audio, SVG/PDF pages, MIDI, and `timeline.json` are derived assets. The singer-facing application can only consume a published score version.

PDF ingestion is a durable workflow, not a script that is run once during setup. Each upload creates an immutable ingestion job with its own input hash, tool versions, intermediate artifacts, validation report, warnings, and review history. A bounded orchestration state machine may use agents for inspection and diagnosis, but deterministic tools perform the actual conversion and no agent may silently “repair” uncertain notation.

## Repository findings

- The repository contains only `README.md`, `.gitignore`, and the nested legacy project.
- No `Gloria Frisina.pdf`, MusicXML, MuseScore, or other score asset is currently present in the workspace. The first integration test therefore remains blocked on adding the real PDF.
- The legacy project is a complete Flutter application under `FlutterPitchGame-main/FlutterPitchGame-main/`.
- The legacy project must remain unchanged and isolated.
- Local tooling found on this Windows machine:
  - `C:\Program Files\MuseScore 4\bin\MuseScore4.exe`
  - MuseScore 4.7.4, verified with `-v` and `--long-version`
  - Audiveris, Java, and FFmpeg were not found on `PATH`

MuseScore’s command-line interface supports opening a file and exporting to a target file; the exact flags must be validated against the installed 4.7.4 build in the pipeline adapter rather than assumed from MuseScore 3 documentation. MuseScore’s documented formats include MusicXML import/export and audio/graphic export. See the [MuseScore command-line documentation](https://musescore.org/en/print/book/export/html/278640) and [file-format documentation](https://musescore.org/en/handbook/2/file-formats).

## Proposed system shape

```text
admin browser
    |
    v
FastAPI + SQLite/PostgreSQL
    |
    +-- ingestion job state machine
    |      +-- capability check
    |      +-- PDF normalization
    |      +-- OMR adapter (Audiveris)
    |      +-- MusicXML validation/normalization
    |      +-- MuseScore materialization
    |      +-- timeline and asset generation
    |      +-- review package + report
    |      +-- explicit approve/publish gate
    |
    +-- immutable artifact store
    |
    +-- published score versions
             |
             +-- React rehearsal client
                    +-- score renderer
                    +-- aligned stem mixer
                    +-- canonical playback clock
                    +-- local microphone DSP
```

The first deployment can run all pipeline workers as subprocesses on the same computer. The process boundaries are logical, not microservices: a later worker queue can replace the local runner without changing the domain model.

## Domain model

The minimum durable entities are:

| Entity | Purpose |
|---|---|
| `Piece` | Stable repertoire identity, title, composer, aliases, and publication metadata. |
| `ScoreVersion` | Immutable symbolic revision; states are `draft`, `review`, `approved`, `published`, `superseded`. |
| `IngestionJob` | One PDF-to-score attempt, including state, actor, timestamps, toolchain, and failure reason. |
| `Artifact` | Content-addressed file produced by a job: PDF, page image, `.omr`, `.mxl`/`.musicxml`, `.mscz`, report, audio, SVG, MIDI, or timeline. |
| `Part` | Generic musical part (`soprano`, `alto`, `tenor`, `bass`, `organ`, future subdivisions), not a hard-coded four-voice enum. |
| `WrittenMeasure` | A written measure with stable ID, number/display label, meter and source location. |
| `MusicalEvent` | Note, rest, tie, lyric, direction, tempo, key, time signature, repeat or navigation event in written-score coordinates. |
| `PerformanceOccurrence` | One execution of a written measure in flattened performance order. It carries an occurrence ID, written-measure ID, start/end beat and seconds. |
| `TargetEvent` | A playable/scorable vocal event linked to a performance occurrence, with MIDI pitch, frequency, onset, duration, part, lyric and confidence/provenance. |
| `PublishedAssetSet` | The exact derived assets exposed to singers, all generated from one approved version and manifest. |
| `PracticeSession` / `PracticeResult` | User selection, clock configuration, raw-free metrics, and per-target/per-measure results. |

The critical distinction is `written_measure_id` versus `performance_occurrence_id`. A measure after `D.C. al Fine`, a repeat, or a first/second ending must be represented more than once in the performance timeline. A map from measure number to timestamp is insufficient.

## Canonical timeline

The timeline builder parses symbolic MusicXML and resolves navigation into an ordered list. Each target event should be addressable approximately as:

```json
{
  "occurrence_id": "perf-0012",
  "written_measure_id": "m-003",
  "written_measure_number": "3",
  "performance_occurrence": 2,
  "part_id": "tenor",
  "beat": 2.0,
  "onset_beats": 14.0,
  "duration_beats": 1.0,
  "onset_seconds": 34.82,
  "duration_seconds": 0.66,
  "midi_pitch": 64,
  "frequency_hz": 329.6276,
  "lyric": "...",
  "is_rest": false,
  "source": {"measure": "3", "voice": 1},
  "confidence": {"pitch": "omr", "rhythm": "omr"}
}
```

This is a target representation, not yet a public API contract. Tempo changes, pickup measures, ties, tuplets, multiple voices, repeats, endings, `D.S.`, `Coda`, `Fine`, and `D.C. al Fine` must be covered by tests before a score can be published.

The practice engine will expose one canonical clock containing `performance_time_seconds`, `speed`, `playback_start`, `scoring_start`, and the active occurrence. Score cursor, audio mixer, target lookup, and microphone evaluation derive from this clock. The selected measure rule is domain data: for selected measure `M`, playback begins at the preceding performance occurrence and scoring begins at the attack of `M`.

## PDF-to-MuseScore decision

**Decision:** use Audiveris as the first OMR adapter, preserving its `.omr` project and exported MusicXML, then open/materialize the result with MuseScore. Treat OMR as a proposal requiring human review.

**Alternatives considered:** a commercial OMR service, a neural transcription service, or manual entry directly in MuseScore. Audiveris is preferable for the local MVP because it is scriptable, local, open source, produces MusicXML, and preserves a reloadable `.omr` project. Manual MuseScore editing remains part of the workflow because Audiveris itself documents that OMR accuracy is not perfect and that MusicXML export is lossy. See the [Audiveris CLI](https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/), [OMR output formats](https://audiveris.github.io/audiveris/_pages/reference/outputs/README/), and [export guidance](https://audiveris.github.io/audiveris/_pages/tutorials/quick/export/).

**Drawbacks:** Audiveris is not installed here, accuracy varies with scan quality and notation, and its AGPL license must be reviewed before any distribution model is chosen. PDF preprocessing and manual correction remain necessary.

**Reconsider when:** a benchmark on the real repertoire shows unacceptable accuracy, or the deployment model cannot accommodate Audiveris licensing/tooling. In that case, keep the same job/artifact/review contract and swap only the OMR adapter.

## Score rendering decision

**Decision:** start with OpenSheetMusicDisplay for the React score view and keep Verovio as a measured alternative. OSMD is directly oriented toward MusicXML in the browser and exposes cursor/measure navigation concepts. Verovio is attractive for precise SVG engraving, selective rendering, and later server-side/headless use, but adds a different data/rendering integration path.

**Drawbacks:** neither renderer is the source of truth; graphical-to-symbolic mapping must be tested on the approved score version, and repeats/navigation still belong to our performance timeline.

**Reconsider when:** OSMD cannot reliably map the required note/measure IDs, mobile rendering is inadequate, or SVG layout/performance becomes the dominant constraint. References: [OSMD](https://opensheetmusicdisplay.github.io/classdoc/) and the [Verovio reference book](https://book.verovio.org/verovio-reference-book.pdf).

## Pitch engine decision

**Decision:** carry forward the legacy YIN concept as a benchmark and prototype reference, but implement the web DSP behind a typed `PitchDetector` interface, preferably in an AudioWorklet/WASM-capable path. Benchmark YIN against a browser-compatible autocorrelation/McLeod implementation on synthetic tones, silence, noise, octave errors, transitions, and vibrato.

The target error is computed in cents:

```text
1200 * log2(f_singer / f_target)
```

The first product metrics should be voiced-frame coverage, median signed cents, median absolute cents, in-tolerance time, onset error, and per-measure difficulty. The legacy `Hz` difference/log score is not suitable as the authoritative musical metric.

## Playback speed decision

**Decision:** keep score time in canonical quarter-note seconds and make speed a clock multiplier. Use pitch-preserving Web Audio time stretching only after measuring browser/device behavior; if quality or synchronization is insufficient, pre-render tempo variants from the same approved score as a controlled fallback. Never change target pitch when speed changes.

**Reconsider when:** latency or artifact measurements show that the chosen browser implementation cannot meet the rehearsal UX target. Aligned stems, MIDI, and target timeline must carry the same score version and timing manifest.

## Main technical risks

1. OMR errors in lyrics, rhythms, accidentals, ties, voices, and navigation can produce a plausible-looking but wrong score.
2. Written order is not performance order; repeats and jumps can break cursor, scoring, and asset alignment.
3. Browser microphone capture and output leakage can make the detector hear the guide track. Headphones, echo-cancellation constraints, confidence gating, and a visible setup check are required.
4. Audio output time, microphone capture time, analysis-window delay, smoothing delay, and UI time are different clocks. They must be measured and represented, not hidden in constants.
5. Scores with organ grand staff, multiple voices, and future subdivisions exceed the legacy single melody model.
6. Tool availability and versions affect reproducibility. Every job must record executable path/version and fail clearly when a required capability is missing.
7. Score and audio assets may contain copyrighted repertoire. Access control, local storage policy, and export/download permissions are product requirements.

## Audit conclusion

The Flutter prototype is valuable evidence for the singer-facing interaction and low-latency pitch path, but it is not a suitable domain foundation. The correct next implementation is the ingestion job contract and a real-PDF benchmark, followed by a single approved score flowing through timeline generation and a minimal rehearsal slice.
