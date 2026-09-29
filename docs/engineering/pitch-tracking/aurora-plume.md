# Aurora Plume

Shared live visualization for Practice and Voice Lab. This is a rendering change,
not a new pitch detector or a change to scoring. The MusicXML reference remains amber.

## Rendering contract

`frontend/pitch_shared.js` owns segmentation, temporal appearance, column
interpolation and Canvas density rasterization. Both callers use
`drawConfidencePlume`; CREPE uses the same renderer with a secondary blue-grey
palette and lower intensity, without merging its estimates with YIN.

Each physical pixel column interpolates observed MIDI pitch and confidence
linearly between adjacent valid observations. Linear interpolation cannot
overshoot the two observations. A vertical density field combines a Gaussian
body (76%) and narrower Gaussian core (24%, sigma multiplier 0.48). There are no
stroked paths, sample sprites, blur filters or additive blending. A reusable
offscreen Canvas and ImageData buffer are composited with source-over; the field
is cleared on every render, so stale pixels cannot survive reset or resize.

The baseline sigma is **0.16 semitones**: a visual width, not a calibrated
confidence interval. The existing width preference scales it within bounded
limits. Confidence interpolates locally and principally modulates opacity.
CREPE's peak salience is also an intensity heuristic, not a probability.
We do not currently have a calibrated distribution suitable for displaying
multiple probabilistic modes; raw CREPE bin sprites have been removed from the
live lane. The separate analytical benchmark views are unchanged.

The palette interpolates smoothly from `#E8A5E8` through `#A786CB` to `#676B9A`.
Age is `currentTime - observedTime`. The recent trail transitions over
**2.75 seconds**, configurable through the renderer's
`trailSeconds` option. Beyond that window the observed history stays visible in
cool violet-blue at 65% of its confidence-modulated intensity: the colour window
is not a lifetime or a data-retention cutoff. Opacity is
`1 - (1 - historyOpacity) * smoothstep(age / trail)`. Review uses one uniform
violet colour throughout the recording. Palette, history opacity and sigma live
in `AURORA`, not in each page.
The obsolete single-colour input is hidden because it would misleadingly claim
to control this temporal palette; its persisted legacy preference is retained
for compatibility.

## Musical boundaries and lifecycle

- Invalid pitch/confidence, confidence below 0.3, and provisional transitions
  break the surface. Practice now retains invalid observations as boundaries,
  including in persisted history; detector and scoring data are not changed.
- The median of recent observation intervals establishes the cadence. Maximum
  interpolation gap is `clamp(2.5 * cadence, 0.075, 0.3)` seconds.
- Abrupt jumps above 3.2 semitones, changed take IDs, nonmonotonic time or x
  break continuity. A genuine discrete leap is represented as separate regions,
  not suppressed because it differs from the expected note. Gradual glissandi
  remain continuous. An isolated sample is not drawn as a trajectory.
- Attack and release use 45/60 ms smoothstep envelopes strictly inside observed
  regions; no trajectory is extrapolated into silence.
- Practice uses runtime `secondsAtBeat` and the selected playback speed, not
  animation-frame counts. Pause freezes the musical age. The existing visual
  timing-offset preference is respected; it does not change stored F0/timestamps.
- Live Practice filters to the current take. Existing seek/start/reset/piece
  boundaries remain authoritative. Future observations are rejected after seek.
- Voice Lab uses elapsed recording time. During recording the recent plume
  is brighter, but the whole visible trail remains present. After stopping,
  the roll and feedback chart use explicit review
  mode: the entire observed trajectory remains visible without live decay.
- Practice's paused inspection also uses review mode. Historical data are not
  deleted by the live fade. Historical sample storage retains its existing
  12,000-frame limit; this work does not expand storage policy.

Ordered timelines are cropped to the viewport with binary search before segmentation;
old visible samples are not excluded just because their colour has aged.
Cadence estimation considers at most 96 intervals. Raster work is restricted to
the visible horizontal region and a narrow vertical Gaussian band. Buffers are
resized only when physical dimensions change, including DPR changes. Rendering
cost therefore scales with viewport resolution, not recording duration.

## Verification

Run:

```powershell
node frontend/pitch_shared.test.js
node frontend/vocal_feedback.test.js
node frontend/voice_lab_core.test.js
python scripts/browser_aurora_smoke.py
# With a running frontend:
python scripts/browser_aurora_smoke.py --app-url http://127.0.0.1:5188
```

Node coverage: stable note, regular vibrato, real glissando, invalid/unvoiced
boundaries, temporal gaps, suspected octave jump, provisional transitions,
low confidence, separate takes, pause determinism, seek/future clipping, reset,
full-history review, a 10-minute synthetic take, DPR/resize and buffer reuse.
Moderate downsampling preserves the stable trajectory at pixel-quantized alpha.

The headless Chrome fixture tests real Canvas pixels at widths 1280/720 and DPR
1/2, downsampling, reset/future rejection, and render timings. Captured screenshots
are under ignored `artifacts/aurora/`. The optional integration test loads O
sacrum, checks seek take-isolation and history preservation, then starts/stops
Voice Lab with a synthetic microphone signal and checks both live and review
calls. No fixture or test image is shipped in the production asset list.

On the development machine the fixture's p95 was approximately **0.4–4.4 ms**.
With persistent live history the fixture's p95 was approximately **0.6–5.3 ms**.
These are headless synthetic measurements, not guaranteed whole-app frame times
on mobile hardware. Pixel differences after halving the stable signal's sampling
were 0–4/255 across the tested resolutions. Visual review confirmed continuous
bands and waves, temporal fade, clear amber targets and no invented octave slide.

## Limitations

Linear interpolation preserves observed detail but cannot recover vibrato above
the tracker's temporal resolution. Real acoustic octave ambiguity is still the
detector's responsibility. The visual field does not represent a calibrated
posterior. Physical microphone/device latency and low-end mobile performance
still require a hardware listening test. At low vertical zoom the visual width
has a 1.25 CSS-pixel readability floor. Analytical benchmark charts retain their
existing scientific presentation rather than acquiring the live temporal fade.

Implementation files: `frontend/pitch_shared.js`, `frontend/app.js`,
`frontend/voice_lab.js`, plus cache references/settings text in the two HTML
entrypoints. Tests: `frontend/pitch_shared.test.js`,
`scripts/aurora_render_fixture.html`, `scripts/browser_aurora_smoke.py`.
