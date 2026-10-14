# ADR-0005: Scoped sharing of singer performances

**Status:** proposed; implementation pending
**Date:** 2026-10-14
**Owner:** project maintainer
**Last reviewed:** 2026-10-14

## Context

The deployed design is a read-only rehearsal application. Clerk authenticates
a singer and D1 decides whether that email digest may read the repertoire.
Pitch estimates and takes remain in the browser.

The choir needs one shared artifact for each singer's best comparable attempt:
a piano-roll PNG with detected pitch, without audio. Ordinary singers see only
their own results. Selected singers see assigned groups, and the director sees
all groups. This requires mutable user data and resource authorization beyond
the existing active-member flag.

## Decision

Use RBAC with choir and group scope:

- every active member has singer capabilities over their own results;
- `section_viewer` reads owners in explicitly granted groups;
- `director` reads every group in the same choir;
- `admin` is separate and has no implicit performance visibility;
- no role alters another singer's result.

Store stable member identity, choir, groups, memberships, roles, view grants
and current best metadata in D1. Bind an authorized member to a Clerk subject,
use opaque member IDs and carry `choir_id` throughout even with one initial
choir.

Store PNG objects in a private Worker-bound R2 bucket. Serve every object
through the Worker after a fresh D1 decision; never use possession of an object
key as authorization.

Define a best by member, piece, score version, part and versioned scoring
profile. Upload candidates to immutable revision keys, then conditionally
update the D1 pointer only for a strictly higher score. D1 elects the winner;
rejected and superseded objects are deleted or collected later.

Accept initially that browser-computed scores and PNGs are unverified,
good-faith evidence. Audio is never uploaded. Server verification from
structured pitch data requires a separate future decision.

The full contract is
[Shared performances and scoped authorization](../architecture/shared-performances-rbac.md).

## Consequences

- The Worker gains a small private API while continuing to fail closed.
- D1 remains policy/metadata authority; R2 stores binary artifacts.
- Group membership and permission to view a group are separate relations.
- Revocation affects the next request because images never bypass the Worker.
- An eligible best needs completion and coverage rules, not only a score.
- Pitch images are personal data, requiring notice, erasure, retention, audit
  and least privilege despite the absence of audio.
- Conditional D1 winner election, not last-writer-wins object overwrite,
  resolves concurrent submissions.
- Authorized recipients can still save images; this is access control, not DRM.
- Private provisioning gains names, groups, roles and grants that stay out of
  Git.

## Alternatives rejected

- **Roles only in Clerk:** choir policy and immediate revocation belong to the
  application; group scopes are relational application data.
- **One hierarchical role:** viewers can need several groups, while an admin
  need not see performances. Capability and scope are orthogonal.
- **PNG bytes in D1:** D1 is the relational policy store; R2 is the appropriate
  binary-object boundary.
- **Public or unguessable image URLs:** URL secrecy cannot enforce revocation,
  group changes or same-choir checks.
- **One stable R2 key:** R2 and D1 share no transaction; immutable candidates
  plus a conditional D1 pointer avoid image/metadata disagreement.
- **Store every attempt:** the initial product needs only the current best, and
  retaining less personal data reduces risk and cost.

## Implementation gate

This ADR remains proposed until migrations, authorization tests, private R2
delivery, eligibility rules, deletion/retention behavior, security review and
staging revocation tests are complete. ADR-0004 continues to describe the
deployed authentication boundary until cutover.

