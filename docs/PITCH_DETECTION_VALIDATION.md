# Pitch detection validation

## Current implementation

The browser pitch lab uses a dependency-free YIN-style detector in [frontend/pitch_detector.js](../frontend/pitch_detector.js). The page supplies microphone frames through an `AnalyserNode`; microphone samples remain in the browser and are not uploaded.

The detector currently performs:

- DC-offset removal;
- RMS silence gate;
- YIN difference and cumulative mean normalized difference;
- parabolic lag interpolation;
- 70–1000 Hz search range;
- semitone-space smoothing;
- three-frame median pre-filter for isolated pitch spikes;
- continuity hysteresis: octave-sized changes need five coherent frames and
  other large changes need three;
- three-frame voiced stabilization;
- three-frame release before clearing the displayed pitch;
- confidence based on periodicity clarity, signal level and stabilization.

The detector is still a main-thread proof of concept. It should move to an AudioWorklet or WASM-backed implementation after the browser/device benchmark is complete.

`PitchSmoother` exposes the raw estimate as `rawHz` and the filtered estimate
as `hz`/`displayHz`. Only frames marked `accepted` are used by the practice UI.
While a large jump is being verified, `rejectionReason` reports either
`octave-transition` or `large-jump-transition`; the prior display value may be
retained for visual continuity, but the frame is not scored as valid.

## Synthetic checks

The algorithm was checked against synthetic sine waves at:

| Input | Observed result |
|---:|---:|
| 110 Hz | 110.00 Hz |
| 220 Hz | 220.00 Hz |
| 261.63 Hz | 261.63 Hz |
| 329.63 Hz | 329.63 Hz |
| 440 Hz | 440.02 Hz |
| 523.25 Hz | 523.27 Hz |
| 880 Hz | 880.05 Hz |

These are algorithm checks, not microphone/device measurements.

## Manual validation checklist

On the target PC and browser:

1. Start the microphone at `http://localhost:5173`.
2. Confirm the diagnostic line reports `readyState=live`, `enabled=true`, `muted=false`, and a non-zero `peak` when sound is present.
3. Test silence, speech, a sustained hum, a whistle, low notes, high notes and a short glissando.
4. Record detected Hz, cents, confidence and visible latency.
5. Repeat with another browser or input device if available.

The next benchmark should add voiced/unvoiced fixtures, vibrato, octave errors, background noise and guide-track leakage.
