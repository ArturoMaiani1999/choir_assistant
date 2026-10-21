# Playback and audio architecture

**Status:** canonical
**Owner:** project maintainer
**Last reviewed:** 2026-10-21

## Contract

During rehearsal, `HTMLAudioElement.currentTime` is the playback authority.
`MediaPlaybackClock` converts that media position through the score tempo map;
the resulting snapshot drives notation, target selection, metronome and
transport. The piano roll and plotted pitch use a separate, user-adjustable
visual delay (270 ms by default); detector timestamps and scoring keep the
undelayed media time. The plume advance is applied relative to that delayed
visual timeline. `requestAnimationFrame` redraws state but is not a musical
clock. `VisualPlaybackTime` interpolates the piano-roll presentation using
monotonic elapsed time between media observations, with bounded phase
correction. It never replaces the canonical snapshot used by samples or scoring.
Unreported stalls stop prediction after 120 ms; waiting/seeking, pause, rate
changes and long frame gaps reanchor to media time. Media events explicitly
reset the presentation epoch even for short seeks and loop restarts.

The connection preference applies a fixed vocal-trace timestamp correction:
270 ms for cable/device, 320 ms for Bluetooth. It does not change the piano-roll
delay. These are presets, not measured input/output latency. The visual timeline
does not consume `AudioContext.outputLatency` or `getOutputTimestamp()`; latency
values in echo diagnostics do not compensate playback or detector timestamps.
The [Bluetooth timing audit](../engineering/pitch-tracking/bluetooth-sync-audit-2026-10-21.md)
records the Samsung measurements; the
[correction report](../engineering/pitch-tracking/bluetooth-playback-fix-2026-10-21.md)
records the implementation and physical candidate comparison.

## Bundle model

Each published piece contains an `audio-manifest.json`. Its `score_version_id`
and timeline hash must agree with the normalized score and release bundle.
Every vocal part maps to a backing file and may optionally map to pre-rendered
speed variants. The browser refuses playback for an inconsistent bundle.

Bundles using the voice mixer additionally expose one instrumental
`accompaniment_file` and a `voice_stems` map. The instrumental file remains the
authoritative media clock; selected vocal stems follow its play, pause, seek
and playback-rate state. Drift beyond 80 ms is corrected against the master.
Each SATB stem and the accompaniment have independent mute and gain controls.
The user's currently selected vocal part is enabled by default, and several
vocal stems may be enabled together.

The local authoring server may generate or transform audio. Production serves
only allowlisted, pre-generated assets and has no audio-processing endpoint.
The browser bundle exporter retains Choir Aahs for SATB and assigns MS Basic
Strings Fast to any organ part before exporting the full mix and accompaniment.
The score still labels that part as an organ.

## Speed and transposition

Playback speed uses `HTMLMediaElement.playbackRate` with `preservesPitch` (and
the WebKit equivalent); the clock continues to read media time. Production
transposition runs locally in an AudioWorklet, changes pitch without changing
duration, and is applied to the master and every selected stem. Browsers that
cannot load the worklet fail closed instead of playing audio in a key that does
not match the transposed targets.

## Microphone interaction

Playback starts microphone acquisition through a user gesture. Headphones are
the supported condition for reliable scoring because the detector performs no
source separation. Browser echo cancellation may improve speaker use but is
not an accuracy guarantee.

On Android in headphone mode, when device enumeration exposes Bluetooth and
the phone's named built-in input, acquisition explicitly selects that input
with AEC/NS/AGC off. This preserves the Bluetooth music output instead of opening
the headset microphone's SCO route. If permission initially hides the labels,
the first capture is stopped before reacquiring the phone. Cancellation releases
that capture. Other platforms and the speaker/AEC path retain their requested
constraints. Profiles are matched against the actually acquired device/chain.

## Delivery requirements

- Audio must be seekable and served over HTTPS with byte-range support.
- Each file must remain under the active hosting limit.
- Audio and score hashes belong to the immutable release candidate.
- A missing or inconsistent asset disables playback rather than silently using
  a different score version.
