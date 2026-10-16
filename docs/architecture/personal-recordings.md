# Personal recordings and synchronized pitch replay

**Status:** implemented; pending production provisioning and cutover
**Owner:** project maintainer
**Last reviewed:** 2026-10-15

## Purpose

Choir Assistant lets a singer record their own microphone while rehearsing a
piece, listen to that voice over the same accompaniment and see the captured
pitch trace replayed on the piano roll. The feature is for private
self-assessment: the recording is never shared with directors, section viewers
or other singers.

This resource is intentionally separate from the group-scoped best-performance
PNG described in
[Shared performances and scoped authorization](shared-performances-rbac.md).

## User contract

- Recording is available only after the singer explicitly confirms that they
  are using headphones. Browsers do not expose a reliable physical-headphone
  signal, so this is an informed self-attestation rather than hardware proof.
- The singer explicitly consents to microphone capture and profile storage
  before every new take. Browser microphone permission remains a separate
  platform prompt.
- The backing track is played to the headphones but is not mixed into the
  uploaded recording. The microphone stream contains the singer's voice and
  any unavoidable acoustic leakage.
- A completed take remains a local pending draft. Before changing piece or
  closing the modal, the singer must save it or discard it. Navigating away
  while a take is active or pending triggers the browser's unsaved-work warning.
- Only one saved recording is allowed per member and piece. A new take never
  overwrites the saved version automatically: its review action is labelled
  as replacement and the server requires `replaceExisting=true`.
- Deletion is explicit and permanent. Replaced and deleted R2 objects also
  enter the cleanup queue as protection against partial object-store failures.

## Authorization and storage

Clerk authenticates the request and D1 resolves the active `member_id` and
`choir_id`. Every recording query includes both values. Client-supplied owner
identifiers are not accepted.

The `personal_recordings` table is the authoritative pointer and enforces
`UNIQUE(member_id, piece_id)`. It stores repertoire identity, part, duration,
capture/replay timing, explicit-consent time and the headphone attestation.
The existing private `PERFORMANCE_BUCKET` stores two immutable objects under a
`recordings/<choir>/<member>/<piece>/<revision>/` prefix:

- microphone audio (`WebM`, `Ogg` or `MP4`, validated by declared type and
  container signature);
- a versioned JSON pitch document containing beat-positioned samples.

Neither object has a public hostname. Audio byte ranges and pitch JSON are
served through the Worker only after a fresh owner check. Group grants,
`section_viewer`, `director` and `admin` roles confer no access.

## API

| Method | Route | Contract |
|---|---|---|
| `GET` | `/api/recordings/mine?pieceId=...` | List the caller's saved recording for the piece |
| `POST` | `/api/recordings` | Save or explicitly replace audio plus pitch replay |
| `GET` | `/api/recordings/{id}/audio` | Owner-only private audio, with byte ranges |
| `GET` | `/api/recordings/{id}/pitch` | Owner-only replay document |
| `DELETE` | `/api/recordings/{id}` | Delete the caller's recording and objects |

The upload requires `consent=true`, `headphonesConfirmed=true`, a valid
published piece/version/part tuple and bounded audio/pitch data. It rejects an
existing row with `409 recording_exists` unless replacement was explicit.
Limits are 32 MiB of audio, 2 MiB of pitch JSON, 30 minutes and 12,000 pitch
samples.

## Replay timing

Capture starts the microphone recorder before playback and stores
`audioOffsetMs`, the measured gap before the rehearsal clock begins. Pitch
samples use performed beat positions. Replay restores the recorded part,
transpose and playback speed, starts accompaniment and microphone audio from
their stored offset, and renders the saved samples through the normal piano
roll. The microphone is released before replay.

## Privacy and lifecycle

Microphone capture stops when recording ends, when the page is hidden or when
the workflow is abandoned. Pending audio uses a revocable browser object URL
and is uploaded only after the save decision. Protected responses use
`private, no-store` and `nosniff`.

Inactive-member recordings are removed by the scheduled cleanup after the
same 30-day grace period used for performance artifacts. Production activation
requires migration `0005_personal_recordings.sql`, a private R2 binding,
privacy-notice coverage for stored voice and pitch data, and staging tests for
owner isolation, revocation, range requests, replacement and deletion.

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
