# ADR-0004: Consumer authentication with application authorization

**Status:** proposed; implemented on `feature/consumer-auth`, pending production cutover
**Date:** 2026-10-11
**Owner:** project maintainer
**Last reviewed:** 2026-10-11
**Supersedes:** ADR-0003 only for singer authentication after cutover

## Context

Cloudflare Access is a Zero Trust workforce product. Its free plan is limited
to 50 users, while Choir Assistant needs to authorize external singers without
per-seat Zero Trust billing. Hosting, immutable static assets and the
allowlisted repertoire build remain appropriate for Cloudflare Workers.

## Decision

Use Clerk as the consumer identity provider and a D1 `authorized_members`
table as the application authorization authority. A Worker runs before every
static asset request, verifies the Clerk session, derives an HMAC-SHA-256
digest of the verified primary email and requires an active matching D1 row.

The identity provider answers *who is this?*. Choir Assistant answers *may this
identity read the private repertoire?*. A valid Clerk account alone never
grants access.

Exact email addresses and HMAC keys are not stored in Git. Clerk sessions are
verified networklessly with its public JWT verification key; the Worker does
not receive a Clerk Backend API secret key.
The production mailing list is synchronized from a private operator-owned file
and only keyed digests reach D1.

## Consequences

- All HTML, JSON, SVG and audio requests invoke the Worker before static asset
  delivery. Direct asset URLs do not bypass authorization.
- Removing a D1 row or setting `active=0` takes effect on the next request.
- D1 or identity verification failure denies access rather than serving an
  asset.
- Clerk and Cloudflare become subprocessors for authentication metadata.
- Authorized users can still save content delivered to their own browser.
  Authentication is access control, not DRM.
- Cloudflare Access may remain on a separate maintainer/staging application,
  but must not be the singer-facing authorization authority after cutover.

## Cutover condition

ADR-0003 remains the production description until the independent security
review, staging tests and rollback rehearsal in the deployment runbook pass.
