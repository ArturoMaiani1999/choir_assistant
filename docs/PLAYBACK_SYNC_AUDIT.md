# Playback synchronization audit

Audit date: 9 September 2026. Status: defect confirmed and remediated; validation evidence recorded below.

## Finding

The pre-audit Practice implementation is **B: a JavaScript/mock clock started approximately together with audio**. It is not audio-clock-driven and therefore is not truly synchronized. The earlier claim that a canonical clock drove the score, pitch and real backing conflated shared visual time with audible playback authority.

## Actual pre-fix path

1. User presses Play: `frontend/app.js::togglePlayback()`.
2. `PerformanceClock.start(performance.now())` starts immediately, setting an independent wall-clock origin in `frontend/score_runtime.js::PerformanceClock`.
3. `syncBackingToClock()` seeks the `HTMLAudioElement` only when the discrepancy exceeds 120 ms.
4. `await backingAudio.play()` requests playback, but no `playing` event or media timestamp confirms audible start before the visual clock advances.
5. `requestAnimationFrame(render)` asks `PerformanceClock.snapshot(now)`, whose beat comes from `performance.now()`, tempo and speed—not media position.
6. That beat drives `renderScore()`, `drawPitchLane()`, `runtime.targetAt()` and the readout.

Consequences:

- startup latency lets visuals advance before audio is actually playing;
- the 120 ms correction threshold explicitly tolerates visible/audible error and can introduce jumps;
- buffering/stalling does not freeze the independent clock;
- `HTMLAudioElement.currentTime` and visual performance time can diverge between corrections;
- playback rate is multiplied independently in both media and JavaScript clock;
- pause and seek set both systems near the same wall-clock instant but do not establish one authority.

## Pre-fix operation details

| Operation | Audio | Visual time |
|---|---|---|
| Play | `HTMLAudioElement.play()` awaited after mock clock start | independent `performance.now()` clock already running |
| 50/75/100% | `audio.playbackRate` | independent `PerformanceClock.speed` multiplication |
| Pause | `audio.pause()` | separate `clock.stop(now)` |
| Seek/measure | `audio.currentTime = beat * 60 / tempo` | separate `clock.seek(beat)` |
| Redraw | media time not queried | RAF supplies wall-clock timestamp to `clock.snapshot()` |

No explicit arbitrary additive millisecond compensation was found. The invalid synchronization mechanisms are the independent start timestamp and the 120 ms drift threshold. `setTimeout` is used only to dismiss a toast and is unrelated to synchronization.

## Current playback technology

The real accompaniment uses an `HTMLAudioElement` (`#backing-audio`) and pre-rendered MP3 mixes. It does not use `AudioContext` or `AudioBufferSourceNode`. Therefore the correct current authority is media `currentTime`, gated by actual media state/events. `requestAnimationFrame` may sample this value for display but must not advance it.

## Required replacement contract

`MediaPlaybackClock` will expose canonical performance seconds directly from `HTMLMediaElement.currentTime` while real backing is selected. Beats are derived centrally through a score-time mapper. It owns play confirmation, pause, seek and rate changes. Score, target, lyrics and pitch NOW consume one immutable snapshot per render.

Future aligned stems will implement the same `PlaybackClock` interface using `AudioContext.currentTime`, stored score-time seek offset and playback rate. That engine—not UI code—will own the mapping.

## Time semantics

- **wall time:** elapsed real-world time; diagnostic only for event timing.
- **media time:** `HTMLMediaElement.currentTime`, expressed in canonical source-audio seconds.
- **performance/score time:** canonical symbolic performance seconds. For the current aligned rendered backing, it equals media time.
- **speed:** media rate; at `0.5x`, 1 wall second advances about 0.5 media/performance seconds. Target pitch is unchanged.

The frontend must not multiply media time by speed. The browser already advances `currentTime` at the selected `playbackRate`.

## Score geometry audit

The current glyph map supplies real per-event `{page, x_percent, y_percent}` coordinates, but `sourceEventId` is reconstructed from target ID text and the viewport tracks X continuously when zoomed. It does not explicitly model system identity or bounds. Page SVG whitespace is merely translated, not structurally cropped.

The current assets are sufficient for a robust interim singer viewport if we:

1. map target events to source events through explicit fixture data rather than parsing IDs;
2. cluster mapped event Y coordinates into stable rendered systems;
3. assign every event a page/system identity and system bounds;
4. keep that system transform stable while the cursor moves;
5. change the crop only when the active event enters another system.

If future engravings cannot retain stable event IDs and geometry, OSMD or Verovio becomes necessary. Static page-percentage heuristics must not be extended beyond this explicit draft glyph contract.

## Implemented remediation

- `frontend/score_runtime.js::MediaPlaybackClock` owns play confirmation, media-derived snapshots, pause, performance-time/beat seek and rate.
- `frontend/score_runtime.js::NormalizedScoreRuntime.secondsAtBeat()` and `beatAtSeconds()` centralize tempo-map conversion.
- `frontend/app.js::render()` obtains exactly one media-derived snapshot per frame. RAF only schedules redraw.
- `frontend/app.js::renderScore()`, `drawPitchLane()`, `renderReadout()` and `targetAt()` receive the same snapshot beat.
- Unsupported mock accompaniment modes cannot start an independent visual clock.
- The 120 ms drift threshold, wall-clock origin and duplicated speed arithmetic were removed from active Practice.
- `?syncDebug=1` enables a development-only overlay showing media/performance/NOW time, target, score cursor, drift and rate.

Real seeking requires HTTP byte-range support. `scripts/serve_frontend.py` supplies it for local development; the former `python -m http.server` exposed no seekable media range and caused Chrome to reset seeks to zero.

## Measured validation

`python scripts/browser_sync_smoke.py` exercised the real 40-second MP3 through `HTMLAudioElement`:

- decoded seekable range: 0–40 seconds;
- canonical drift (`performanceTime - media.currentTime`): exactly 0 by architecture;
- maximum observed render-sampling lag in the timestamped sequence: below 15 ms;
- pause: 0-second movement over a 250 ms wait;
- direct seeks: 3.2 seconds forward and 1.1 seconds backward;
- previous/next occurrence lead-in seeks: 6.0 and 10.0 seconds, with scoring start retained separately at beat 18;
- 100%, 75% and 50%: media time advanced approximately in proportion to rate;
- speed change while playing preserved position and then advanced about 0.26 score seconds over 0.5 wall seconds at 0.5x;
- target and score resolved the same source event after arbitrary seek (`P3-event-77` in the test).

Machine-readable evidence and three time-stamped debug screenshots are stored in `artifacts/practice-redesign/sync-sequence/`.

The tests decode and play the real backing asset in Chrome. An AI-run headless test cannot certify loudspeaker audibility or conduct a human listening judgment; that final device-level observation remains a manual acceptance step.
