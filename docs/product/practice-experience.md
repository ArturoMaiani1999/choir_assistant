# Practice UX specification

**Status:** canonical
**Owner:** project maintainer
**Last reviewed:** 2026-10-13

Status: stable frontend decisions, 9 September 2026.

## Product hierarchy

Practice is one non-scrolling rehearsal instrument inside `100dvh`, ordered as:

1. compact toolbar: exit, piece/part, speed, accompaniment, settings;
2. selected-part score viewport with a conventional moving score cursor;
3. live pitch lane with a fixed `NOW` line and more future than history;
4. compact transport: previous measure, play/pause, next measure, measure, volume.

Practice always shows one selected vocal part. The full score belongs to the separate, vertically scrolling `score-viewer.html` reading mode and never replaces or reduces the active rehearsal view.

## Temporal model

During real accompaniment, `MediaPlaybackClock` reads `HTMLAudioElement.currentTime`; this audio-derived score time is authoritative for score cursor, pitch timeline, transport and mock voice samples. RAF only redraws. The selected-part score is one horizontal continuous system: its cursor follows score time and the sheet translates only enough to keep that cursor visible. In the pitch lane, `NOW_X_RATIO = 0.375` stays fixed and events move right-to-left. These positions are intentionally not geometrically aligned.

Measure selection stores two positions: playback begins at the preceding performance occurrence and evaluation begins at the selected occurrence. The frontend represents the distinction; scoring remains mocked.

## Pitch semantics

- Pitch is represented as fractional MIDI/semitones: `69 + 12 * log2(hz / 440)`.
- Every semitone has equal vertical distance. Note names, not Hz, label the axis.
- Target notes are duration blocks; their lyric is attached when provided.
- A continuous singer path shares the same time/pitch plane, integrating pitch and onset information.
- Target blocks include configurable attack-grace metadata and a restrained tolerance corridor.
- Main readout is note, signed cents and `centrato` / `crescente` / `calante`. Hz is diagnostic only.
- Thresholds and rendering ratios live in configuration, outside drawing logic.

Canvas is used for the pitch lane because it handles a continuous high-frequency trajectory without producing a large DOM. Its backing store is scaled to `devicePixelRatio`; geometry and accessible text remain in the DOM.

The pitch Y viewport is stable for one performance occurrence. Its range is calculated from the previous occurrence through two lookahead occurrences, with a two-semitone margin and nine-semitone minimum span. It changes only at occurrence boundaries, avoiding frame-by-frame scale jumps.

## Score rendering

Practice consumes a dedicated one-staff continuous SVG for the selected part; paged SVG files remain available only as a compatibility fallback and for the separate reading view. The cursor and the piano roll share the canonical playback beat. Score geometry is indexed by written-measure identity, not by performance-occurrence index: repeats therefore return to the same graphical measure instead of advancing into a nonexistent duplicate. Repeat and final barlines are collapsed into one semantic boundary before measure slots are built. The production build must copy each `continuous_part_scores` asset and publish it as `continuous_scores` in the piece bundle; a Chromium smoke test verifies these invariants on desktop and mobile.

This is real draft notation, not arbitrary HTML notation. Horizontal position inside a measure currently follows canonical beat progress between its barlines. A future renderer may expose stable event-to-glyph bounds for note-level highlighting, but it must preserve the same audio-derived clock and written-measure mapping.

The full-score reader derives each system's vertical extent from the SATB and accompaniment staves. On a system transition it centers that complete extent between the sticky toolbar and floating transport. At the start of a wrapped system, horizontal playback begins at the first rendered note (or rest when no note exists), rather than at the barline behind the repeated clef and key signature.

## Asset loading

Changing piece in Practice does not reload the application shell. The client keeps parsed data for at most two pieces, prefetches only the selected part's score at low priority, and asks audio elements for metadata until playback requires media data. It never prefetches the whole repertoire. Library and piece assets carry the immutable release version in their URL; the browser can therefore reuse them safely while a new deployment receives a distinct cache key.

## Responsive behavior

- Desktop/laptop landscape: all four regions visible; pitch lane dominates.
- Mobile landscape: condensed toolbar, score crop and transport; secondary labels collapse; minimum touch targets remain 40px.
- Narrow portrait: concise rotation recommendation, compact score/pitch preview and essential transport remain usable. Orientation is never hard-locked.
- Active Practice never vertically scrolls in the validated target viewports.

## Visual and interaction semantics

- parchment = notation; amber = canonical time/target; cyan = singer trajectory;
- tolerance is conveyed by geometry and texture as well as color;
- feedback is calm and musical; focus is visible; controls are keyboard accessible;
- motion respects `prefers-reduced-motion`.

## Prohibited patterns

No dashboard/card stack, primary Hz axis, separate rhythm graph, gamification, persistent technical explanation, hard-coded piece logic, hard-coded four-part assumptions, full score as the active default, or vertical scrolling during Practice.

Score reconstruction remains governed by the musical normalization/Occam rules in the project request: preserve structural notation, reject unsupported complexity, and record uncertainty rather than silently inventing it.
