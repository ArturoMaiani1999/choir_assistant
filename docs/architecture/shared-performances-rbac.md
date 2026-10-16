# Shared performances and scoped authorization

**Status:** implemented; pending production provisioning and cutover
**Owner:** project maintainer
**Last reviewed:** 2026-10-15

## Purpose

Choir Assistant will let each singer keep one current best performance for a
piece and optionally share it with selected people in the choir. A shared
performance contains a rendered piano-roll image with detected pitch and
summary metrics. It never contains microphone audio.

Private voice recordings are a different, owner-only resource with separate
consent and authorization rules; see
[Personal recordings and synchronized pitch replay](personal-recordings.md).

This document defines the authorization, identity, data, storage and update
contracts for that feature. It extends the Clerk/D1 boundary in
[ADR-0004](../decisions/0004-consumer-authentication.md): Clerk proves who the
requester is, while Choir Assistant decides which choir resources that member
may access.

The initial deployment contains one maintainer-operated choir. The model still
carries `choir_id` so every decision is tenant-scoped and a later second choir
cannot accidentally inherit access.

## Goals and non-goals

The feature must:

- let a normal singer create, replace, read and delete only their own best;
- let a selected singer read performances in explicitly granted groups;
- let a director read every group in their choir;
- prevent every role from altering another singer's result;
- store only the current PNG and score metadata, never microphone audio;
- make member, role and grant revocation effective on the next request;
- enforce lists, metadata and image access in the Worker, not only in the UI.

It does not provide public profiles, public leaderboards, anonymous image
links, audio upload, DRM or cryptographic proof that a browser-generated score
is genuine. The local authoring/admin server remains offline.

## Terms

| Term | Meaning |
|---|---|
| Choir | Top-level authorization and privacy boundary. |
| Member | A singer authorized for one choir and linked to Clerk. |
| Group | Configurable subset such as Soprani, Contralti, Tenori or Bassi; not hard-coded to SATB. |
| Membership | Groups to which the subject of a performance belongs. |
| View grant | Group whose members a selected viewer may inspect; independent from the viewer's membership. |
| Best performance | One accepted current result for a member and comparable practice context. |
| Owner | Member who produced and may replace or delete the result. |

## Authorization model

The design is role-based access control with resource scope. A role grants a
capability; choir and group relations constrain its resources.

| Role | Own performances | Other members | Configuration |
|---|---|---|---|
| `singer` | Read, submit a better result, delete | None | None |
| `section_viewer` | Same as `singer` | Read explicitly granted groups | None |
| `director` | Same as `singer` | Read all groups in the same choir | None |
| `admin` | Same as `singer` | No implicit access | Manage members, roles and groups when remote administration exists |

Every active member has effective `singer` capabilities. Other roles are
additional, not mutually exclusive. `director` and `admin` stay separate:
musical oversight does not automatically grant account administration. The
first implementation may provision assignments with a trusted local tool and
avoid deploying an admin API.

### Read decision

A requester may read a performance only when:

1. the Clerk session is valid and not an impersonation session;
2. requester and owner are active members;
3. requester and owner have the same `choir_id`;
4. the requested artifact is the current D1 record; and
5. one of these rules matches:
   - requester and owner have the same `member_id`;
   - requester has `director` in that choir;
   - requester has `section_viewer`, the owner belongs to an active group and
     the requester has an active view grant for that group.

An owner in several groups is visible if any membership intersects the
viewer's grants. Server records are checked for every request. Object names,
cached client state and client-supplied group IDs never grant access.

### Write and delete decision

Only the owner may submit, replace or delete a performance. The Worker derives
the owner from the authenticated context and rejects or ignores an owner ID
from the client. `section_viewer`, `director` and `admin` do not bypass this
rule.

## Identity and member binding

The current `authorized_members` row has an email digest and active flag.
Shared resources also need a stable internal identity. Each member therefore
needs:

- opaque application-generated `member_id`;
- `choir_id`;
- existing `email_digest` for private provisioning;
- unique `clerk_subject` after first successful binding;
- chosen `display_name` or pseudonym;
- active and audit timestamps.

On first access, the Worker verifies Clerk, computes the email digest, finds
the active member and atomically binds the Clerk subject if unbound. A bound
row must never silently bind to another subject. Later requests require the
subject to match. Existing email normalization and HMAC behavior remain.

Email, HMAC keys, display names, groups, roles and grants are private
operational data and their production source files must remain outside Git.

## Logical D1 model

Exact migrations are deferred, but this logical schema is the contract:

```text
choirs
  id, slug, name, active, created_at, updated_at

members
  id, choir_id, email_digest, clerk_subject, display_name, active,
  created_at, updated_at, revoked_at

choir_groups
  id, choir_id, code, name, active, created_at, updated_at

group_memberships
  member_id, group_id, active, created_at, updated_at
  primary key (member_id, group_id)

member_roles
  member_id, role, active, granted_at, revoked_at
  primary key (member_id, role)

performance_view_grants
  viewer_member_id, group_id, active, granted_at, revoked_at
  primary key (viewer_member_id, group_id)

best_performances
  id, choir_id, member_id, piece_id, score_version_id, part_id,
  scoring_profile, score, coverage, image_key, image_etag, image_size,
  created_at, improved_at
  unique (member_id, piece_id, score_version_id, part_id, scoring_profile)
```

Required uniqueness includes group code within a choir, email digest within a
choir and Clerk subject when present. Authorization joins always constrain
`choir_id`; matching opaque IDs alone is insufficient. Queries must filter
authorized rows in D1 before pagination rather than loading a cross-choir set
and filtering it in application code.

## Comparable best key and eligibility

"Best per piece" means best within a comparable context:

```text
member + piece + score version + part + scoring profile
```

`scoring_profile` is a stable versioned identifier, not arbitrary JSON. It
fixes scoring algorithm, pitch tolerance, playback speed, transposition and
completion/coverage rules. A changed score or algorithm starts a new best
instead of comparing incompatible attempts.

The current score is the percentage of recognized voiced time inside the
accepted pitch distance; silence and uncertain frames are excluded. That can
reward selectively singing a short passage. A shared attempt is eligible only
when:

- it reaches the defined end of the piece;
- recognized voice coverage exceeds the profile threshold;
- enough recognized material exists;
- speed and transposition satisfy the profile;
- piece, score version and part exist in the deployed repertoire;
- score and coverage are finite and within valid ranges.

Score and coverage are stored separately. A candidate replaces the current
result only when strictly better. A tie does not rewrite the image unless a
future decision defines an explicit tie-break rule. The initial profile uses
the 60% coverage threshold recorded below.

## Piano-roll artifact

The browser renders the whole eligible attempt to a normalized offscreen
canvas and exports PNG. It does not capture the DOM or only the visible time
window. The image includes target notes, detected pitch, musical time or
measure references, score, coverage and sufficient version context.

Display name normally remains UI metadata rather than pixels so a pseudonym
can change without rewriting every artifact. The UI supplies an accessible
text summary.

Upload accepts only a bounded PNG and validates body size, declared and
detected media type, PNG signature and decodable dimensions. SVG, HTML and
arbitrary filenames are rejected. Client metadata is not copied blindly into
response headers.

## Storage boundary

D1 holds policy and metadata. PNG objects live in a private R2 bucket bound to
the Worker. They never enter `dist/`, use a public R2 domain or receive an
authorization-free presigned URL.

Each candidate gets a new opaque revision key:

```text
performances/{choir_id}/{member_id}/{piece_id}/{revision}.png
```

Randomness prevents collisions but is not authorization. Every image read
loads the current D1 row, applies the read decision and then reads R2.
Responses set exact content type, `X-Content-Type-Options: nosniff`, existing
security headers and `Cache-Control: private, no-store`.

## Best-update protocol

The product shows one current image, but the implementation does not overwrite
a stable R2 key. D1 and R2 share no transaction, and concurrent attempts must
not let a slow lower score replace a higher one.

1. Authenticate and resolve the active member.
2. Validate repertoire context, scoring profile, eligibility and PNG.
3. Generate a server-side revision key and upload the candidate to R2.
4. Run a conditional D1 insert/update that wins only if there is no current row
   or `candidate.score > current.score`.
5. If accepted, return the new result and best-effort delete the old object.
6. If rejected, delete the candidate and return the unchanged best.

D1 is the winner election. Its row always points to a complete immutable
object. Replaced and deleted image keys are queued by D1 triggers. If immediate
cleanup fails, the object is inaccessible because no current D1 row references
it and the daily maintenance task retries deletion.

If R2 succeeds but D1 fails, the endpoint fails closed and attempts candidate
cleanup. If D1 commits but old-object deletion fails, the new row remains
authoritative and cleanup is retried later.

## API surface

```text
GET    /api/me
GET    /api/performances/mine
GET    /api/groups
GET    /api/groups/{group_id}/performances
GET    /api/performances/{performance_id}/image
POST   /api/performances/best
DELETE /api/performances/{performance_id}
```

`GET /api/me` returns effective capabilities and viewable group IDs for UI
navigation, but later endpoints authorize again. `GET /api/groups` returns
only granted groups, or all active groups for a director. Image delivery
rechecks access even if a prior list included the artifact.

| Condition | Response |
|---|---|
| Missing/invalid session | `401 authentication_required` |
| Inactive identity or non-member | `403 not_authorized` |
| Resource outside the member's scope | `404 performance_not_found` |
| Invalid/ineligible candidate | `400 invalid_performance` |
| Valid candidate not better | `200` with `updated: false` and current summary |
| D1 or R2 unavailable | `503`, with no fallback asset |

Mutations accept only same-origin authenticated requests and verify origin.
Existing Clerk verification, CSP and fail-closed handling remain in force.

## Client trust boundary

Pitch analysis and rendering run in an ordinary browser. A member can modify
local JavaScript, forge a score or upload a fabricated PNG. Authentication
proves who submitted it, not that the client ran the scoring algorithm.

The initial choir feature accepts this good-faith limitation. Results support
rehearsal review and are not verified records for auditions, employment,
grading or competition. If verification becomes necessary, a future design
may upload bounded structured pitch samples and recompute server-side. That
still avoids audio but retains more sensitive performance data and requires a
separate privacy and architecture decision.

## Privacy, retention and audit

A pitch trajectory tied to a singer is personal performance data even without
audio. Production therefore requires:

- clear notice of what is shared and with which role scopes;
- a deliberate display name or pseudonym, never exposed email;
- least-privilege grants and immediate logical revocation;
- no public bucket, public index or analytics image payload;
- owner deletion and operator-assisted erasure;
- a bounded retention period after member removal;
- separate staging and production D1/R2 resources;
- audit records for role, membership and grant changes without image bodies,
  plaintext email or authentication tokens.

Logs use opaque member/performance IDs and avoid names unless necessary.
Deactivation immediately blocks the member and removes their results from
lists. Physical object deletion may be controlled cleanup, but any inaccessible
retention must be bounded and documented.

## Provisioning

The private member-sync source gains fields or companion files for display
name, memberships, roles and grants. Synchronization must support dry-run
counts, reject unknown roles and cross-choir references, distinguish omission
from revocation, require confirmation for replacement and avoid printing
personal data. Authorization data never belongs in `deploy/repertoire.json`;
that file continues to define publishable music only.

## Required tests

Authorization coverage must prove:

- singer owns all CRUD on their result and cannot enumerate or fetch another;
- section viewer sees exactly the union of granted active groups;
- revoking the last matching grant blocks the next list and image request;
- director sees the whole choir but cannot mutate another result;
- admin has no implicit musical visibility;
- no role, membership, ID or grant crosses a choir boundary;
- deactivated requesters and owners are excluded;
- guessed performance IDs and direct image endpoints do not bypass scope.

Update/storage coverage must prove:

- first eligible result creates a row and readable image;
- a higher score changes the D1 pointer;
- lower/equal scores keep the current result;
- concurrent candidates leave the highest committed score current;
- invalid or oversized artifacts are rejected;
- D1/R2 failures fail closed and orphan cleanup is safe;
- score versions, parts and profiles never overwrite each other.

Identity tests cover atomic first-subject binding, rejection of a different
subject for an already-bound member and continued rejection of Clerk
impersonation sessions.

## Implementation sequence

1. Record the decision and canonical contract.
2. Add choir/member identity, groups, roles and grants via D1 migrations and
   private sync tooling.
3. Resolve a reusable active-member context in the Worker while preserving
   static-asset protection.
4. Add private R2 and performance metadata.
5. Implement the read matrix and `/api/me` before uploads.
6. Fix the first scoring profile and coverage threshold; add normalized export.
7. Implement conditional update, owner deletion and orphan cleanup.
8. Add own, scoped-group and director views.
9. Complete privacy/security review, staging revocation tests and rollback
   rehearsal before activation.

## Initial implementation constants

- scoring profile: `pitch-v1-original-100-complete-c60`;
- minimum recognized coverage: 60%;
- speed: 100%;
- transposition: original key only;
- image limit: 4 MiB, 4096 x 2048 pixels;
- display name: explicitly supplied by the private operator CSV, with an
  opaque fallback when omitted;
- inactive-member retention: 30 days, enforced in batches by a daily Worker
  scheduled handler;
- administration: private CLI synchronization only; no production admin API.

Changing comparability constants creates a new scoring profile rather than
silently changing the meaning of an existing best.

## Related documents

- [ADR-0005: scoped performance sharing](../decisions/0005-scoped-performance-sharing.md)
- [ADR-0006: private owner-only personal recordings](../decisions/0006-private-personal-recordings.md)
- [Personal recordings and synchronized pitch replay](personal-recordings.md)
- [ADR-0004: consumer authentication](../decisions/0004-consumer-authentication.md)
- [System architecture](overview.md)
- [Consumer authentication security review](../operations/consumer-auth-security-review.md)

