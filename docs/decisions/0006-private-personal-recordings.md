# ADR-0006: Private owner-only personal recordings

**Status:** accepted; implemented, pending production provisioning and cutover
**Date:** 2026-10-15
**Owner:** project maintainer
**Last reviewed:** 2026-10-15

## Context

Singers need to hear their own voice over the rehearsal track while watching
the corresponding detected-pitch replay. Audio is materially more sensitive
than the piano-roll PNG approved for group-scoped performance sharing. Reusing
that sharing policy would expose voice data to directors or section viewers
without a product need.

## Decision

Create a separate owner-only personal-recording resource. Authenticate with
Clerk, derive ownership from the active D1 member context and allow no
role-based expansion of read access. Store metadata and the single current
pointer in D1; store immutable audio and versioned pitch JSON in the existing
private Worker-bound R2 bucket.

Require explicit storage consent and headphone self-attestation before each
capture. Keep a completed take local for review until the singer chooses save
or discard. Enforce one row per member and piece and require an explicit
replacement flag when a saved recording already exists.

The complete contract is
[Personal recordings and synchronized pitch replay](../architecture/personal-recordings.md).

## Consequences

- Voice and structured pitch become stored personal data and must be covered
  by privacy notice, erasure, retention and incident-response procedures.
- Directors, section viewers and admins cannot use their roles to retrieve a
  singer's audio.
- Browser headphone confirmation reduces accidental speaker leakage but is
  not hardware attestation.
- Immutable R2 revisions plus a D1 pointer avoid exposing a half-written
  replacement; cleanup handles superseded or orphaned objects.
- Playback must preserve capture offset, speed, transpose, part and score
  version to keep audio and pitch replay synchronized.

## Alternatives rejected

- **Add audio to shared best performances:** violates least privilege and the
  established no-audio sharing contract.
- **Keep recordings only in IndexedDB:** avoids server retention but does not
  satisfy profile persistence across devices and browser storage loss.
- **Keep every revision:** increases privacy and storage cost without helping
  the initial self-assessment workflow.
- **Infer headphones from device labels:** browser device APIs do not provide a
  portable, reliable physical-output guarantee.

## Implementation gate

Source support is complete. Production activation remains gated on migration
`0005_personal_recordings.sql`, private R2 provisioning, privacy-copy review,
independent security review and staging tests covering cross-owner denial,
revocation, byte ranges, replacement and deletion.
