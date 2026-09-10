# Practice UX specification

Status: stable frontend decisions, 9 September 2026.

## Product hierarchy

Practice is one non-scrolling rehearsal instrument inside `100dvh`, ordered as:

1. compact toolbar: exit, piece/part, speed, accompaniment, settings;
2. selected-part score viewport with a conventional moving score cursor;
3. live pitch lane with a fixed `NOW` line and more future than history;
4. compact transport: previous measure, play/pause, next measure, measure, volume.

The active default is one selected vocal part. Full score is a paused consultation mode and must never permanently reduce the active rehearsal view.

## Temporal model

During real accompaniment, `MediaPlaybackClock` reads `HTMLAudioElement.currentTime`; this audio-derived score time is authoritative for score cursor, pitch timeline, transport and mock voice samples. RAF only redraws. Score notation stays stationary within an event-mapped system/segment and its cursor moves. In the pitch lane, `NOW_X_RATIO = 0.375` stays fixed and events move right-to-left. These positions are intentionally not geometrically aligned.

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

The current prototype uses the existing selected-part SVG exports plus their event-to-glyph map. Target events are associated with source events by occurrence/part/measure ordinal; no target-ID parsing is used. Mapped Y coordinates are clustered into page/system identities. A system/segment transform remains stable while its cursor moves and changes only at a mapped boundary. This is real draft notation, not arbitrary HTML notation. It remains a partial renderer: final production must consume an approved score version and expose stable event/system bounds directly.

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
