# Gloria transcription audit

Status: **PENDING_REVIEW**  
Benchmark source: `sheets/gloria-frisina/gloria-frisina.pdf` (visually inspected pages 1–3; PDF page 4 is blank)  
Current review score: `gloria-frisina-review-2caad6da075f0252`  
Approval: **not granted**

The PDF is the evidence. The Audiveris MusicXML is retained as a raw hypothesis. This pass repairs only visually demonstrable errors and makes every unresolved item block publication.

## Pipeline trace

| Stage | Artifact | Finding |
|---|---|---|
| Source | `sheets/gloria-frisina/gloria-frisina.pdf` | SATB score in 6/8; no printed tuplets in the affected opening passages; no dynamics or ornamental marks represented by the OMR noise below. |
| Raw OMR | `data/omr-gloria/mxl-extracted/Gloria Frisina.xml` | Eight `<time-modification>` notes forming three false tuplet groups; expression noise; zero lyrics; structurally inconsistent organ durations in measures 9–12. |
| Normalizer | `scripts/prepare_gloria_musicxml.py` | Applies only enumerated PDF-backed rhythm repairs, strips unsupported expression guesses, assigns deterministic source-note IDs, and restores verified tempo/Fine/D.C. text. |
| Review MusicXML | `frontend/score-assets/gloria-frisina-draft.musicxml` | Zero tuplets/noise; every SATB measure spans 3 quarter-note beats; no lyrics are asserted because none has yet passed editorial transcription review. |
| MuseScore | `data/omr-gloria/gloria-frisina-draft.mscz` and part SVGs | Regenerated from the review MusicXML. These are review outputs, not approved assets. |
| Runtime | `frontend/score-fixtures/gloria-frisina-draft.json` | Regenerated from the same review MusicXML. Runtime targets carry exact `source_event_id`, lyric semantics, written measure, and performance occurrence. |
| Audio | `frontend/audio/*.mp3` | Old `gloria-frisina-omr-draft-v1` renders. Quarantined: the app refuses to play them with the review score. |
| Bundle | `frontend/score-assets/gloria-bundle-manifest.json` | Hashes every derived class and records the mismatch, missing lyrics, and organ blockers. |

## Tuplet audit

Beat positions below are eighth-note units within the printed 6/8 bar.

| Part | Measure | Beat/unit | Source page | Raw OMR | Normalized representation | Verdict |
|---|---:|---|---:|---|---|---|
| Contralto | 1 | units 3–5 | 1 | Two notes with 3:2 `time-modification` (durations 2 and 4 at divisions 6) | ordinary eighth + quarter (durations 3 and 6); no tuplet | **REMOVE** |
| Tenore | 1 | units 4–6 | 1 | Three 3:2 eighths, each duration 2 at divisions 6 | three ordinary eighths, each duration 3 | **REMOVE** |
| Tenore | 3 | units 4–6 | 1 | Three 3:2 eighths, each duration 2 at divisions 6 | three ordinary eighths, each duration 3 | **REMOVE** |

Visual evidence: the source opening crop shows ordinary beamed/subdivided 6/8 notation and no tuplet numeral or bracket. See [source opening](../artifacts/gloria-transcription-audit/source/page1-opening-satb.png) and [Tenore measures 1–4](../artifacts/gloria-transcription-audit/source/tenore-measures-1-4.png). The regenerated comparison is [Tenore rendered page 1](../artifacts/gloria-transcription-audit/rendered/tenore-1.png).

Automated result: raw OMR `time-modification` count 8; normalized count 0; normalized tuplet-notation count 0.

## Difference report

| Part | Measure | Category | OMR result | Source evidence | Fix | Confidence |
|---|---:|---|---|---|---|---|
| Contralto | 1 | RHYTHM/TUPLET | 2.5 quarter beats and false 3:2 group | Six ordinary eighth units are visible | Corrected to 3 beats; removed tuplet data | High |
| Tenore | 1 | RHYTHM/TUPLET | Final three eighths compressed to one beat | Six ordinary eighths are visible | Corrected final three durations | High |
| Tenore | 3 | RHYTHM/TUPLET | Three eighths compressed to one beat | Dotted quarter plus three ordinary eighths is visible | Corrected final three durations | High |
| SATB | 9–12 | RHYTHM/LAYOUT | Stemless recitative pitches encoded as 4-beat events in 6/8 | Each printed pitch occupies one complete written bar | Playback span set to 3 beats while retaining the whole-note visual type | Medium; human timing review required |
| P1 | 1–8, 10–12 | ARTICULATION/ORNAMENT | 14 articulation containers, 3 ornaments, 3 arpeggiates and one dynamic across affected measures | Corresponding marks are absent from PDF | Removed in canonical review MusicXML | High |
| P2 | 1–12 | DYNAMIC/ARTICULATION | 12 articulation containers, 3 dynamics and 3 arpeggiates | Corresponding marks are absent from PDF | Removed | High |
| P3 | 1–12 | DYNAMIC/ARTICULATION | 16 articulations, 3 dynamics, 2 fermatas, 1 technical mark and 3 arpeggiates | Corresponding marks are absent from PDF | Removed; genuine slurs/ties retained | High |
| P4 | 1–10 | DYNAMIC/ARTICULATION | 11 articulations, 2 dynamics, 1 technical mark and 1 arpeggiate | Corresponding marks are absent from PDF | Removed | High |
| Organo | 2–12 | EXPRESSION | Dynamics/articulation/technical/arpeggiate guesses | Corresponding marks are absent from PDF | Removed; pitch/rhythm still pending structural review | High for removal |
| SATB | 1–12 | LYRIC | Raw OMR contains no `<lyric>` | Printed Italian text is visible, including multi-line recitative text | No text invented; runtime labels blank and validation warning emitted | Incomplete |
| P1–P5 | 8/12 | NAVIGATION | Navigation absent from OMR | `Fine` at measure 8 and `D.C. al Fine` at measure 12 are printed | Restored explicitly | High |
| Runtime | all | IDENTITY | Performance targets were associated to source notes by ordinal reconstruction in JavaScript | No stable identity existed in the asset contract | Deterministic MusicXML note IDs now flow directly through runtime targets | High |
| Renderer | all | LAYOUT | Note heads were position-zipped and systems were re-clustered in the browser | This can merge/reset geometry and interpolate toward a smaller x | Build emits explicit `system_id`; browser changes systems atomically and refuses negative-x interpolation | High for visible regression; mapping remains review-only |

Raw expression inventory by part and measure is reproducible from the raw XML. The largest concentrations are P3 measures 1–8 and the OMR arpeggiate guesses in measures 9–12. The normalized manifest records a zero count for every removed category.

## Lyric audit

There is no approved lyric-bearing symbolic source yet. The printed text is not algorithmically aligned because measures 9–12 contain multiple recitative lines/verses. Until a human editor enters and checks that alignment, the correct runtime value is `null`, displayed as nothing.

| Part/section | Source text (visual transcription for review) | Transcribed MusicXML/runtime text | Status |
|---|---|---|---|
| SATB, measures 1–4 | “Glo-ria, glo-ria, glo-ri-a a Di-o, nel-l’al-to dei cie-li, ed in ter-ra” | none | **MISSING — REVIEW REQUIRED** |
| SATB, measures 5–8 | Continues “pa-ce a-gli uo-mi-ni di buo-na vo-lon-tà” with printed continuation/alternate text | none | **MISSING — REVIEW REQUIRED** |
| SATB, measures 9–11 | Multiple printed recitative lines, including phrase endings “gloria immensa”, “abbi pietà di noi”, and “Gesù Cristo” | none | **AMBIGUOUS ALIGNMENT — REVIEW REQUIRED** |
| SATB, measure 12 | Multiple concluding lines ending with “Gesù Cristo”, “abbi pietà di noi”, and “amen” | none | **AMBIGUOUS ALIGNMENT — REVIEW REQUIRED** |
| Tenore pitch lane, all | Must match the lyric attached to the same approved Tenore note | none; no fallback | **SAFE BUT INCOMPLETE** |

The former `lu` / `ce` / `can` / `ta` fallback array has been removed from real-piece code. The compiler now preserves `syllabic` (`single`, `begin`, `middle`, `end`) and `extend` on both written and performance events. A missing lyric cannot be replaced or repeated.

## Cursor cause and invariant

The backwards movement had two independent enabling conditions:

1. runtime-to-written identity was reconstructed by measure/part ordinal in the browser;
2. exported SVG note heads were position-zipped and browser code then inferred systems again from y-distance. Interpolation could therefore select a same-cluster glyph with a smaller x.

The review implementation now uses:

`performance event -> source_event_id -> renderer geometry {system_id, x, y}`

The glyph builder records the detected system once, validates nondecreasing x inside it, and fails on event/glyph count mismatch. The browser switches viewport segment when `system_id` changes and never interpolates to a smaller x. A D.C. jump remains distinct because the repeated written note is reached through a new `PerformanceOccurrence` while retaining its source identity.

This eliminates the observed backwards animation but does **not** make positional MuseScore SVG association suitable for publication.

## Renderer decision

| Requirement | Static MuseScore SVG | OpenSheetMusicDisplay | Verovio |
|---|---|---|---|
| Stable symbolic note identity | No exported source-note contract; current association is positional | Source and graphical objects are linked; graphical staff entries can be found from source timestamps | MEI `xml:id` is preserved as SVG element `id`; direct DOM lookup |
| Explicit system geometry | Must be inferred at build time | Graphical measures expose parent music systems and bounds | SVG hierarchy plus optional bounding boxes/page lookup |
| Responsive relayout | Static page only | Native re-layout and resize support | Re-render with page/layout options |
| Isolated part/cursor | Separate exports; custom cursor | Built-in part-aware cursor and notes-under-cursor APIs | Part selection/render options; custom cursor by element ID/timemap |
| Lyric geometry | Opaque SVG text | Parsed/rendered MusicXML lyrics | Addressable MEI/SVG lyric structure |
| Current Gloria readiness | Available, but review-only | Viable | Best identity contract after deterministic MusicXML→MEI conversion is verified |

Decision: **do not approve the static SVG mapper as the production renderer**. Verovio is the preferred migration target because its documented SVG identity contract directly matches `sourceNoteId -> element`; OSMD is a strong alternative when its native cursor and responsive reflow are more valuable. Migration is held behind the transcription gate: converting an unapproved, lyric-free score would only produce a better rendering of unapproved data. Official references: [OSMD graphical/source mapping](https://opensheetmusicdisplay.github.io/classdoc/classes/GraphicalMusicSheet.html), [OSMD cursor](https://opensheetmusicdisplay.github.io/classdoc/classes/Cursor.html), [Verovio SVG identity](https://book.verovio.org/advanced-topics/internal-structure.html), and [Verovio toolkit methods](https://book.verovio.org/toolkit-reference/toolkit-methods.html).

## Automated gates

`scripts/audit_gloria_bundle.py` checks and fingerprints:

- zero unsupported normalized tuplet/expression elements;
- twelve complete 6/8 measures for each vocal part;
- exact runtime `source_event_id` references;
- geometry coverage for all 145 written vocal notes;
- lyric coverage;
- organ structural spans;
- score/runtime/audio version consistency.

`backend/choir_assistant/tests/test_gloria_assets.py` additionally compares runtime part, written measure, duration, pitch, and lyric against the exact source event and asserts monotonic geometry inside every explicit system.

## Human review material

- Source pages: [page 1](../artifacts/gloria-transcription-audit/source/gloria-source-1.png), [page 2](../artifacts/gloria-transcription-audit/source/gloria-source-2.png), [page 3](../artifacts/gloria-transcription-audit/source/gloria-source-3.png)
- Tuplet focus: [SATB opening](../artifacts/gloria-transcription-audit/source/page1-opening-satb.png), [Tenore measures 1–4](../artifacts/gloria-transcription-audit/source/tenore-measures-1-4.png)
- Regenerated review pages: [Soprano](../artifacts/gloria-transcription-audit/rendered/soprano-1.png), [Contralto](../artifacts/gloria-transcription-audit/rendered/contralto-1.png), [Tenore](../artifacts/gloria-transcription-audit/rendered/tenore-1.png), [Basso](../artifacts/gloria-transcription-audit/rendered/basso-1.png)

## Remaining approval gate

- [ ] Director/editor verifies SATB pitch, accidentals, rests, ties, and measure boundaries page by page.
- [ ] Director/editor enters and approves note-level lyrics, including syllabic/melisma semantics and recitative verses.
- [ ] Organ measures 9–12 are reconstructed and visually/audibly checked.
- [ ] Verovio pilot proves deterministic MusicXML-note to rendered-element identity, or an explicit exception accepts the guarded static renderer.
- [ ] Audio is regenerated from the approved score version and its manifest hashes match.
- [ ] Side-by-side artifacts are signed off.

Until all boxes are checked, Gloria must remain `PENDING_REVIEW`; the app deliberately disables its stale backing tracks.
