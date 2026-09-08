# Legacy pitch-tracking audit

The legacy Flutter project is reference material only. No files in it were modified.

## Runtime architecture

- Flutter UI and Riverpod own navigation, game state, plots and settings.
- Android Kotlin owns microphone capture, ring-buffer assembly, pitch estimation and backing-track playback.
- Flutter communicates through `MethodChannel("com.example.pitch_game/audio")` and `EventChannel("com.example.pitch_game/audio_stream")`.
- The event payload is approximately `{type, timeSec, pitchHz, rmsLevel, isSilent}`.
- iOS/native parity is not implemented; the README describes it as future work.

This is a sensible low-latency boundary for a mobile app: the UI does not attempt to run the pitch estimator in Dart.

## Pitch estimator

`YinPitchDetector.kt` implements a basic YIN-style estimator:

1. It computes the squared difference function over candidate lags.
2. It computes the cumulative mean normalized difference function.
3. It selects the first local minimum below a threshold.
4. It applies parabolic interpolation to the selected lag.
5. It converts lag to Hz and rejects values outside the configured range.

At startup the plugin constructs it with `sampleRate=44100`, `threshold=0.20`, `fMin=20`, `fMax=2000`. The class defaults are different (`threshold=0.3`, `70..800`), but those defaults are overridden in the actual plugin path. This distinction matters for any benchmark.

`AudioRecorder` captures mono 16-bit PCM with a default hop of 512 samples. The plugin maintains a 4096-sample ring buffer, so at 44.1 kHz the analysis window is about 92.9 ms and the nominal hop is about 11.6 ms. RMS below `40.0` is treated as silence. There is no confidence score in the event payload, only nullable pitch and a silence boolean.

The recorder can use Android `VOICE_COMMUNICATION` plus `AcousticEchoCanceler` when appropriate. The code detects wired/Bluetooth outputs and recommends echo cancellation when no headphones are detected. This is useful, but it is not enough to guarantee that guide audio will not contaminate the microphone.

The frame timestamp is obtained from `System.nanoTime()` in the recorder callback. It is a monotonic absolute timestamp, not a timestamp derived from the exact audio sample position. The backing player emits a separate `backingStarted` timestamp.

## Dart smoothing and visualization

`PitchBus` applies:

- a silence latch;
- 16 consecutive voiced frames before re-entry;
- a median-of-5 prefilter;
- an EMA in semitone space with alpha `0.2` for the displayed trace;
- a much slower EMA with alpha `0.01` for the center/reference window;
- a slew-rate limit of 5 semitones/second for that center;
- history pruning by ingestion time.

`PitchPlotWidget` draws a rolling five-second custom canvas with logarithmic frequency mapping, pitch-class bands, target melody blocks, the detected trace, a playhead, and a fading error “smoke” trail. This is the strongest reusable interaction idea: singers can see a continuous relationship between target and voice rather than receiving only a final score.

## Legacy musical model

`MelodyNote` contains `startSec`, `endSec`, MIDI number and Hz. `MidiParser` reads note-on/note-off events from every MIDI track, converts ticks using one supplied BPM, merges all notes, and sorts by start time.

Important limitations:

- MIDI tempo meta-events are skipped; the caller’s single BPM is authoritative.
- Meter is passed in but does not drive parsing.
- Tracks are not mapped to named choir parts.
- Lyrics, rests, ties, tuplets, dynamics and directions are not represented.
- Repeats, endings, `D.C.`, `D.S.`, `Coda` and `Fine` are not represented.
- Multiple occurrences of one written measure cannot be distinguished.
- The model is effectively one flattened melody list, not a score model.

The new system must therefore derive targets from approved MusicXML and build an explicit performance timeline before the rehearsal client consumes them.

## Legacy scoring

Classic mode finds the first note whose time interval contains the current time. It accumulates the logarithm of squared Hz difference, not cents error. That value is neither musically interpretable nor robust across pitch ranges.

Practice mode compares cents using the correct basic formula, but uses a fixed 100-cent threshold and advances after 100 qualifying frames. It contains a game-like “glide/bounce” state machine and generates challenge tiers based on elapsed time. This can inspire an optional warm-up mode, but it is not the desired rehearsal metric.

The new scoring engine should handle rests, attack grace periods, unvoiced frames, confidence, octave errors, vibrato and note transitions. It should persist interpretable metrics such as valid voiced coverage, median absolute cents, time within tolerance, onset error, missing note and per-measure summaries.

## Synchronization risks

`PitchGameScreen` uses several time concepts:

- native frame timestamp;
- backing-start timestamp;
- desired first-note time;
- audio/playhead time;
- MIDI evaluation time;
- a hard-coded lead compensation from `SyncConfig`;
- a larger Bluetooth offset returned by `getMidiLeadOffset()`.

The plot shifts target MIDI intervals onto the audio axis, while scoring subtracts the lead compensation. This is a useful experiment, but it is not one canonical clock and the constants are device-dependent. The web rehearsal engine must instead expose one measured clock with separate playback, scoring and analysis offsets, all recorded in the session configuration.

## Reusable concepts

- Native/low-level audio analysis boundary.
- Nullable pitch events and explicit silence frames.
- YIN as a benchmark baseline.
- Median plus semitone-space smoothing.
- A custom target-versus-singer trajectory visualization.
- Headphone/Bluetooth/AEC setup awareness.
- Riverpod-style separation between orchestration state and widgets.

## Concepts not to copy

- Firebase authentication and mobile platform code for the web MVP.
- The MIDI-only `MelodyNote` model.
- Hard-coded single melody and four-voice assumptions.
- Arbitrary timing constants as synchronization truth.
- Hz-difference/log scoring.
- Frame-count timing for musical durations.
- Silent fallback/`firstWhere` patterns that can hide a missing target.
- Game tiers as the only practice result.

## Benchmark plan

Before adopting a browser detector, create deterministic audio fixtures for A4 at 440 Hz, ±20/30 cents, octave error, silence, white noise, vibrato, note transitions and guide-track leakage. Compare detection latency, voiced precision/recall, median cents error and dropouts across browser/device combinations. The legacy Android YIN implementation is a baseline, not a ground-truth oracle.
