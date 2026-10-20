# Personal recordings and synchronized pitch replay

**Status:** implemented; pending production provisioning and cutover
**Owner:** project maintainer
**Last reviewed:** 2026-10-16

## Purpose

Choir Assistant lets a singer record their own microphone while rehearsing a
piece, listen to that voice over the same accompaniment and see the captured
pitch trace replayed on the piano roll. The feature is private by default. A
singer may explicitly opt in to share one saved recording with same-choir
directors for browser-local technical analysis. Section viewers and other
singers never gain access.

This resource is intentionally separate from the group-scoped best-performance
PNG described in
[Shared performances and scoped authorization](shared-performances-rbac.md).

## User contract

The speaker echo diagnostic is a separate, explicitly consented resource;
it intentionally captures speaker leakage and requires no headphone
attestation. It saves automatically for seven days and does not replace
the best audio recording. See [echo diagnostic storage](echo-diagnostic-storage.md).

- Recording is available only after the singer explicitly confirms that they
  are using headphones. Browsers do not expose a reliable physical-headphone
  signal, so this is an informed self-attestation rather than hardware proof.
- Manual takes require explicit microphone-capture and storage consent before
  every recording. As a simpler alternative, the singer can enable the
  revocable **Best audio automatico** preference once, including the headphone
  self-attestation. Browser microphone permission remains a separate platform
  prompt.
- The backing track is played to the headphones but is not mixed into the
  uploaded recording. The microphone stream contains the singer's voice and
  any unavoidable acoustic leakage.
- A completed take remains a local pending draft. Before changing piece or
  closing the modal, the singer must save it or discard it. Navigating away
  while a take is active or pending triggers the browser's unsaved-work warning.
- Only one saved recording is allowed per member and piece. Manual takes never
  overwrite it without an explicit review action. With **Best audio
  automatico** enabled, an uninterrupted, complete, original-key, 100%-speed
  attempt is captured temporarily and replaces the saved audio only after the
  best-performance API confirms that its score improved. Non-improving audio
  is discarded in memory and is never uploaded.
- Deletion is explicit and permanent. Replaced and deleted R2 objects also
  enter the cleanup queue as protection against partial object-store failures.

## Authorization and storage

Clerk authenticates the request and D1 resolves the active `member_id` and
`choir_id`. Every recording query includes both values. Client-supplied owner
identifiers are not accepted.

The `personal_recordings` table is the authoritative pointer and enforces
`UNIQUE(member_id, piece_id)`. It stores repertoire identity, part, duration,
capture/replay timing, explicit-consent time and the headphone attestation.
`member_recording_preferences` stores the separate, revocable authorization
for automatic best capture; this preference does not itself expose any audio.
The existing private `PERFORMANCE_BUCKET` stores two immutable objects under a
`recordings/<choir>/<member>/<piece>/<revision>/` prefix:

- microphone audio (`WebM`, `Ogg` or `MP4`, validated by declared type and
  container signature);
- a versioned JSON pitch document containing beat-positioned samples.

The browser requests Opus at 48 kbit/s when the platform supports it. The
recording contains one microphone channel; the accompaniment is never mixed
into the upload.

Neither object has a public hostname. Owner playback is served only after a
fresh owner check. Separate Cockpit routes admit an active same-choir director
only when `shared_for_analysis=1`; group grants, `section_viewer` and other
singers confer no access.

## API

| Method | Route | Contract |
|---|---|---|
| `GET` | `/api/recordings/mine?pieceId=...` | List the caller's saved recording for the piece |
| `GET` | `/api/recordings/automatic-best` | Read the caller's persistent automatic-best authorization |
| `PATCH` | `/api/recordings/automatic-best` | Enable or revoke that authorization |
| `POST` | `/api/recordings` | Save or explicitly replace audio plus pitch replay |
| `GET` | `/api/recordings/{id}/audio` | Owner-only private audio, with byte ranges |
| `GET` | `/api/recordings/{id}/pitch` | Owner-only replay document |
| `PATCH` | `/api/recordings/{id}/sharing` | Owner-only opt-in or revocation for director analysis, without replacing audio |
| `DELETE` | `/api/recordings/{id}` | Delete the caller's recording and objects |
| `GET` | `/api/cockpit/recordings?pieceId=...` | Director-only list of recordings explicitly shared for analysis |
| `GET` | `/api/cockpit/recordings/{id}/audio` | Private audio after director, choir and opt-in checks |
| `GET` | `/api/cockpit/recordings/{id}/pitch` | Matching saved live pitch document |

The upload requires `consent=true`, `headphonesConfirmed=true`, a valid
published piece/version/part tuple and bounded audio/pitch data. It rejects an
existing row with `409 recording_exists` unless replacement was explicit.
Limits are 32 MiB of audio, 2 MiB of pitch JSON, 30 minutes and 12,000 pitch
samples.

The owner can later enable or revoke `shared_for_analysis` from **La mia
registrazione**. Revocation updates D1 immediately and makes both Cockpit
object routes return `404`; it does not delete the owner's private audio.

## Replay timing

Capture starts the microphone recorder before playback and stores
`audioOffsetMs`, the measured gap before the rehearsal clock begins. Pitch
samples use performed beat positions. Replay restores the recorded part,
transpose and playback speed, starts accompaniment and microphone audio from
their stored offset, and renders the saved samples through the normal piano
roll. The microphone is released before replay.

## Privacy and lifecycle

Microphone capture stops when recording ends, when the page is hidden or when
the workflow is abandoned. Pending manual audio uses a revocable browser
object URL. Automatic-best audio remains an in-memory `Blob` and is uploaded
only after the server accepts the new score as the best. Protected responses use
`private, no-store` and `nosniff`.

Every saved recording is retained for at most 12 months from its latest save or
replacement. A later recording for the same member and piece replaces the old
one immediately. Recordings belonging to a deactivated member use the shorter
30-day grace period. The daily scheduled cleanup enforces both limits and also
retries orphan-object deletion. Production activation requires migrations
`0005_personal_recordings.sql`, `0008_pitch_lab_recording_consent.sql` and
`0009_automatic_best_recording_consent.sql`, a private R2 binding, privacy-notice coverage
for stored voice and pitch data, and staging tests for owner isolation,
revocation, range requests, replacement and deletion.

## Known constraints

- Headphone use cannot be proven by a portable web API.
- An authorized account holder can download their own recording; this is not
  DRM.
- The initial feature stores one whole-piece take, not revisions or excerpts.
- Pitch samples remain browser-generated feedback, not verified evidence.

## Related decisions

- [ADR-0004: consumer authentication](../decisions/0004-consumer-authentication.md)
- [ADR-0005: scoped performance sharing](../decisions/0005-scoped-performance-sharing.md)
- [ADR-0006: private owner-only personal recordings](../decisions/0006-private-personal-recordings.md)
