# Playback and audio architecture

**Status:** canonical
**Owner:** project maintainer
**Last reviewed:** 2026-09-28

## Contract

During rehearsal, `HTMLAudioElement.currentTime` is the playback authority.
`MediaPlaybackClock` converts that media position through the score tempo map;
the resulting snapshot drives notation, target selection, pitch-lane position,
metronome and transport. `requestAnimationFrame` redraws state but is not a
musical clock.

## Bundle model

Each published piece contains an `audio-manifest.json`. Its `score_version_id`
and timeline hash must agree with the normalized score and release bundle.
Every vocal part maps to a backing file and may optionally map to pre-rendered
speed variants. The browser refuses playback for an inconsistent bundle.

Bundles using the voice mixer additionally expose one instrumental
`accompaniment_file` and a `voice_stems` map. The instrumental file remains the
authoritative media clock; selected vocal stems follow its play, pause, seek
and playback-rate state. Drift beyond 80 ms is corrected against the master.
The user's currently selected vocal part is enabled by default, and several
vocal stems may be enabled together.

The local authoring server may generate or transform audio. Production serves
only allowlisted, pre-generated assets and has no audio-processing endpoint.

## Speed and transposition

Playback speed uses `HTMLMediaElement.playbackRate`; the clock continues to read
media time. The first static release supports original key only. Supporting
production transposition requires authorized pre-rendered files recorded in the
manifest; the local `/api/transpose` capability is never deployed.

## Microphone interaction

Playback starts microphone acquisition through a user gesture. Headphones are
the supported condition for reliable scoring because the detector performs no
source separation. Browser echo cancellation may improve speaker use but is
not an accuracy guarantee.

## Delivery requirements

- Audio must be seekable and served over HTTPS with byte-range support.
- Each file must remain under the active hosting limit.
- Audio and score hashes belong to the immutable release candidate.
- A missing or inconsistent asset disables playback rather than silently using
  a different score version.
