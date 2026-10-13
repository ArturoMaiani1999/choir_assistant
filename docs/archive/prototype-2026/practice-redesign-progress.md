# Practice redesign progress

Final audit: 9 September 2026.

## Phase checklist

- [x] repository/frontend audit — DONE. Evidence: `docs/PRACTICE_REDESIGN_PLAN.md`; frontend, architecture/UX documents, draft assets and legacy pitch plot inspected.
- [x] practice shell — DONE. `frontend/index.html`, `frontend/styles.css`; four-region `100dvh` instrument layout.
- [x] desktop landscape — DONE. Headless screenshots at 1440×900, 1920×1080 and 1366×768.
- [x] single-part score viewport — PARTIAL. Real draft MuseScore part SVG and event glyph map are used; production renderer and approved source are not connected.
- [x] pitch lane — DONE. `frontend/app.js`, `frontend/practice_math.js`; equal-semitone axis, target durations, tolerance and attack-grace geometry.
- [x] pitch mock trajectory — MOCKED. Deterministic continuous path with onset gaps and pitch drift; no microphone input.
- [x] real audio-derived playback clock — DONE. `MediaPlaybackClock` reads `HTMLAudioElement.currentTime`; score, pitch NOW and target resolve one snapshot. See `docs/PLAYBACK_SYNC_AUDIT.md`.
- [x] transport — DONE. Play/pause, previous/next occurrence, measure readout, speed and volume. Measure selection stores distinct playback/scoring starts.
- [x] mobile landscape — DONE. Dedicated tracked/zoomed score layout verified at 844×390 and 932×430.
- [x] portrait fallback — DONE. Rotation recommendation plus compact usable preview verified at 390×844.
- [x] accessibility — DONE for milestone. Semantic controls, canvas description, live musical readout, keyboard shortcuts, focus styles, touch targets, non-color geometry and reduced motion.
- [x] visual regression validation — DONE. Six viewport captures plus trajectory capture in `artifacts/practice-redesign/`, visually inspected and iterated.
- [x] cleanup — DONE. Earlier UX documents marked historical; frontend/root READMEs updated; no frontend branch on piece title.
- [ ] final verification — PARTIAL. Automated real-media, visual and technical checks pass; physical-device human watch-and-listen acceptance remains.

## Acceptance audit

| Requirement | Status | Evidence / limitation |
|---|---|---|
| One landscape viewport, no vertical scroll | DONE | Browser assertions show document/body height exactly equals all five landscape viewport heights. |
| Score and pitch visible together | DONE | All landscape screenshots. |
| Only selected vocal staff by default | DONE | Part-specific SVG selected from generic available-part list. |
| Conventional moving score cursor | DONE | Glyph-map cursor interpolates across the stationary/locally tracked system; browser assertion confirms movement. |
| Pitch NOW remains fixed | DONE | `timeToX(current,current)` and browser assertion; ratio is 0.375. |
| One canonical real-audio time | DONE | One `media.currentTime` snapshot feeds both renderers, target and transport; no wall-clock advancement. |
| Equal semitone/log pitch axis | DONE | `hzToPitch`, `pitchToY`; browser math assertions validate octave and cents. |
| No primary linear Hz chart | DONE | Axis contains musical note names only. |
| Duration blocks | DONE | Width is onset-to-end in canonical beats. |
| Continuous singer trajectory | MOCKED | Cyan Canvas path uses deterministic samples; microphone remains disconnected. |
| Lyrics associated with events | PARTIAL | Fixture lyrics are consumed; sparse missing values receive clearly documented mock syllables. |
| Pitch and timing in one lane | DONE | Target and singer share one time/pitch plane; no rhythm subplot. |
| Note + cents + musical interpretation | DONE | DOM readout uses note, signed cents and calm Italian state. |
| Very little persistent copy; no gamification | DONE | Toolbar/regions/transport only; no scores, streaks or praise. |
| Desktop/laptop usable | DONE | 1440×900, 1920×1080, 1366×768 inspected. |
| Mobile landscape usable | DONE | Dedicated responsive zoom/tracking, compact controls at 844×390 and 932×430. |
| Portrait coherent | DONE | Non-blocking rotate hint and usable essential transport at 390×844. |
| No Gloria-specific musical logic | DONE | Timing, parts, measures, range and lyrics derive from data. Current benchmark asset roots are configuration, not title-conditioned behavior. |
| Existing music/backend work preserved | DONE | Ingestion/backend untouched; real per-part backing retained for `Altre voci`; backend tests pass. |
| Full-score consultation | PARTIAL | Paused consultation toggle loads the current full-score page; multi-page browsing is not implemented. |
| Accompaniment modes | PARTIAL | `Altre voci` uses real per-part audio; other mode states are MOCKED and identified by toast/progress. |
| 50/75/100% speed | DONE for real backing | Clock and audio rate change together with `preservesPitch`; verified by backing smoke test. Final DSP quality is not certified. |

## Validation performed

- `python scripts/browser_practice_smoke.py` — PASS: six viewports, zero scrolling, visible score/pitch/transport, portrait hint behavior, cursor movement, clock movement, measure lead-in state, Hz→pitch, cents and NOW mappings.
- `python scripts/browser_backing_smoke.py` — PASS: correct Tenor backing, playback-clock alignment, 50% rate/pitch preservation flag and part-specific source change.
- `python scripts/browser_sync_smoke.py` — PASS: real MP3 at 100/75/50%, pause/resume, forward/backward seek, previous/next occurrence, paused/running rate changes, target/score correspondence and stable system transform. Evidence: `artifacts/practice-redesign/sync-sequence/`.
- `python -m unittest discover -s backend/choir_assistant/tests -t backend` — PASS: 6 tests.
- `frontend/practice_math.test.js` and `frontend/score_runtime.test.js` — NOT RUN: Node.js is unavailable in this environment. Equivalent critical math and clock assertions execute in headless Chrome.
- No package build/typecheck/lint exists for this dependency-free frontend.

## Remaining integration work

- MOCKED: microphone samples, confidence/silence handling, scoring and attack-grace evaluation.
- PARTIAL: lyric completeness, full-score navigation, non-`Altre voci` audio modes.
- PLANNED: approved MusicXML/version manifest, production score renderer with stable event geometry, measured output/input/analysis latency offsets and real pitch detector adapter.
- BLOCKED by source approval: editorial correctness of the displayed draft score. The current SVG visibly contains OMR-derived expressive/tuplet markings; `docs/SCORE_RECONSTRUCTION_POLICY.md` requires normalization and human review before publication.
- MANUAL ACCEPTANCE: a person must still perform the final watch-and-listen check on a real output device; headless Chrome proves real media decoding/position but cannot certify perceived loudspeaker timing.
