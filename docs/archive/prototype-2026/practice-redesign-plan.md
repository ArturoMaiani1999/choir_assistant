# Practice redesign implementation plan

Status: in execution, 9 September 2026.

## Phase A — audit

Findings:

- `frontend/index.html`, `styles.css` and `app.js` form a vanilla, dependency-free single page.
- The current page is a vertically stacked card prototype with persistent setup copy and a historical Hz plot; its information hierarchy is unsuitable for singing.
- `score_runtime.js` already provides a normalized symbolic adapter and simple clock, but lacks speed, generic measure seeking, lyrics and explicit attack grace.
- Part-specific MuseScore SVG files and `glyph-map.json` provide a reusable draft selected-part rendering seam.
- The backing manifest and per-part audio mixes are reusable but remain separate from this mock-first milestone.
- `pitch_detector.js` and the legacy Flutter YIN/trajectory concepts are useful technical references. Real microphone capture is deliberately not required for this visual milestone.
- The normalized fixture supports arbitrary parts and performance occurrences. Its lyrics are incomplete and the score is an unapproved OMR draft.
- There is no Node build system. Validation uses browser DevTools smoke scripts and backend `unittest`.

## Phase B — cohesive shell

Replace the page structure and styles with toolbar, selected-part score, pitch region and transport. Use CSS grid sized against `100dvh`. Acceptance: coherent at 1440×900 and 1366×768 with no document scroll.

Files: `frontend/index.html`, `frontend/styles.css`, `frontend/app.js`.

## Phase C — musical pitch lane

Add pure pitch/timeline functions and a DPR-aware canvas renderer for equal-semitone rows, fixed NOW, target durations, tolerance/attack zones, lyrics and deterministic mock voice. Acceptance: no primary Hz scale; timing and pitch are legible in one plane.

Files: `frontend/practice_math.js`, `frontend/app.js`, `frontend/styles.css`.

## Phase D — unified mock clock

Extend the clock contract with speed and seek. Drive both score cursor and pitch lane in one animation render from one snapshot. Implement measure navigation and the playback-start/scoring-start state pair.

Files: `frontend/score_runtime.js`, `frontend/app.js`.

## Phase E/F — responsive refinement

Create dedicated compact landscape rules and a coherent portrait fallback. Reduce persistent copy and controls. Acceptance: target viewports fit without clipping or scroll.

## Phase G — validation

Add browser-independent JavaScript tests for conversions/mappings/clock/seek, update the browser smoke test to the new contract, run backend tests, syntax checks and screenshot capture at five required viewports. Inspect images and iterate.

Files: `frontend/practice_math.test.js`, `scripts/browser_practice_smoke.py`, `artifacts/practice-redesign/`.

## Phase H — final audit

Record DONE/PARTIAL/NOT DONE/BLOCKED against every acceptance criterion in `PRACTICE_REDESIGN_PROGRESS.md`.

## Risks and dependencies

- Draft glyph geometry may not remain stable after editorial score approval.
- The fixture’s missing lyrics require clearly identified mock fallback content.
- Mobile browser chrome makes `100vh` unreliable; use `100dvh` plus safe-area padding.
- Canvas needs explicit DPR scaling and redraw on resize.
- Audio/microphone timing is outside this mock-first phase; integration must later apply measured output/input offsets to the canonical clock.

No product principle conflicts were found. The plan does not modify ingestion, backend, OMR or legacy Flutter files.

## 9 September synchronization correction

Human observation invalidated the earlier mock-clock assumption. Execution was revised, in documented order, to:

1. audit and classify the clock defect (`docs/PLAYBACK_SYNC_AUDIT.md`);
2. replace wall-clock authority with `MediaPlaybackClock`;
3. feed pitch NOW, target resolution and score cursor from one media snapshot;
4. replace parsed target IDs with occurrence/measure/part event association;
5. cluster glyph geometry into stable score systems/segments;
6. reduce page whitespace and adopt occurrence-stable adaptive pitch bounds;
7. validate real MP3 playback, rate, pause, seek and navigation.

Testing discovered that Python’s basic static server did not expose a seekable byte range. `scripts/serve_frontend.py` was added as a technically required local playback dependency. This change does not alter product principles; it enables the specified real-media seek invariant.
