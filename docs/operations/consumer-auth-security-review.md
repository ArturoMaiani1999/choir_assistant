# Consumer authentication security review

**Status:** review baseline
**Owner:** project maintainer
**Last reviewed:** 2026-10-13

This document gives the independent security reviewer an explicit attack
surface and reproducible acceptance criteria. It is not evidence that a
penetration test has passed. Record findings separately with severity,
reproduction steps, affected commit and remediation verification.

Testing must be performed only against the staging hostname and test accounts
authorized by the maintainer. Denial-of-service, mailbox flooding, attacks on
Clerk or Cloudflare infrastructure, and access to real singer accounts require
separate written authorization.

## Protected assets and data

| Asset | Location | Intended exposure |
|---|---|---|
| Published scores, SVG and rehearsal audio | Workers Static Assets | Active authorized singers only |
| Exact singer email addresses | Clerk and private operator list | Clerk, operator and the singer concerned |
| Email authorization digest | D1 | Worker and maintainer |
| Clerk public JWT key and HMAC key | Cloudflare binding/password manager | Worker runtime and maintainer |
| Microphone samples and local takes | Browser memory/IndexedDB | That browser only |
| MuseScore sources and local admin APIs | Maintainer workstation | Never Internet-facing |

The HMAC digest reduces disclosure impact but is still pseudonymous personal
data. If the HMAC key is compromised, an attacker with candidate addresses can
test them offline.

## Trust boundaries

```text
untrusted browser
    | HTTPS + Clerk session cookie
    v
Cloudflare Worker -- verifies signature, issuer, expiry and authorized party
    | normalized verified email -> HMAC-SHA-256
    v
D1 authorization row (active=1)
    |
    v
ASSETS binding -> immutable release files

Clerk Frontend API/email channel -> identity proof and session lifecycle
maintainer workstation -> private list digest sync and immutable release build
```

## Implemented controls

1. **Fail-closed middleware.** Authentication exceptions return `401`; D1 or
   HMAC failures return `503`; neither path invokes the asset binding.
2. **Complete asset mediation.** `assets.run_worker_first=true` places HTML,
   JSON, SVG, audio and manifests behind the same middleware.
3. **Identity/authorization separation.** A valid Clerk identity is
   insufficient without an active D1 digest.
4. **Canonical request origin.** Before serving even public authentication
   files, the Worker requires the request origin to equal `APP_ORIGIN`.
   Deployment rejects `workers.dev`, preview URLs and custom-domain routes that
   do not exactly match that hostname.
5. **Verified session origin.** Clerk validation receives one HTTPS
   `authorizedParties` origin to reduce CSRF/session-token misuse.
6. **Minimal identity claim.** Only the primary email needed for authorization
   is added to the signed Clerk session token. The Worker normalizes and
   validates it, and rejects any session containing Clerk's actor (`act`) claim.
   Email verification itself remains a mandatory Clerk tenant setting.
7. **Pseudonymous allowlist.** D1 stores HMAC-SHA-256 digests, not plaintext
   email addresses. The key is a Worker secret and is absent from Git.
8. **Immediate application revocation.** D1 is consulted for every protected
   request. Disabling a row blocks subsequent asset requests regardless of the
   remaining Clerk session lifetime.
9. **No external return URLs.** Client redirects accept only same-origin paths
   beginning with one `/`; authentication paths cannot be return targets.
10. **Cache containment.** Protected responses set `private, no-store` and vary
   on authentication headers. Login and public configuration are `no-store`.
11. **Browser hardening.** Protected pages retain the restrictive static CSP.
    Login receives a separate CSP containing only its own origin and the Clerk
    origins required for identity and bot challenges. Frame embedding is
    denied, MIME sniffing is disabled and referrers are suppressed.
12. **Local dependency bundle.** ClerkJS is bundled during the deterministic
    build; production does not execute a generic third-party CDN script.
13. **Least-privilege Clerk verification.** Sessions are verified networklessly
    with Clerk's public JWT key. `/auth/config` returns only the publishable
    key; the Worker has no Clerk Backend API secret, and the HMAC key remains an
    encrypted binding.
14. **Private source-list handling.** `.gitignore` rejects conventional member
    list filenames; the sync tool emits only digests and deletes its temporary
   SQL file in a `finally` block. Full replacement additionally requires the
   operator to confirm the exact validated member count.
15. **Existing release boundary.** Only repertoire explicitly approved by
    `deploy/repertoire.json` crosses into `dist/`; source scores, OMR and local
    administrative endpoints remain excluded.
16. **Pre-deploy configuration gate.** The npm deployment path rejects
    placeholders, non-HTTPS origins, preview URLs, invalid D1 identifiers and
    any configuration that would let static assets bypass the Worker.

## Required adversarial tests

Use a harmless canary file/account created for the assessment. Do not use real
member data in reports.

### Authentication and session handling

- Alter JWT header, payload and signature independently.
- Test expired, not-yet-valid, wrong-issuer and wrong-authorized-party tokens.
- Replay a signed-out/revoked session and tokens from development or another
  Clerk application.
- Attempt a Clerk impersonation session; the Worker must deny it.
- Test fixation across login/logout and multiple browser profiles.
- Attempt email changes, secondary-email substitution and unverified-address
  promotion in Clerk.
- Exercise magic-link/code replay, reuse, guessing, mailbox enumeration and
  login flooding within the approved rate envelope.

### Authorization and object access

- Request every known file type anonymously and with a non-member account.
- Enumerate predictable piece IDs, filenames, manifests and fingerprinted
  assets; responses must not disclose protected bodies.
- Test URL encodings, repeated slashes, dot segments, case changes, query
  strings, alternate methods and `Range`/conditional requests.
- Attempt access through the `workers.dev` hostname, custom hostname, old
  deployment URLs and any preview/version URL.
- Revoke an active member while audio is playing and document what the browser
  already buffered versus what subsequent requests can retrieve.

### Web and browser controls

- Test return URL variants including `//host`, encoded slashes, backslashes,
  user-info syntax and nested URLs.
- Review CSP bypasses, DOM injection in Clerk-rendered errors and unsafe URL
  handling. Confirm no production source maps are reachable.
- Test CSRF on any state-changing route and cross-origin reads under CORS.
- Inspect cookies for `Secure`, `HttpOnly`, appropriate `SameSite`, scope and
  lifetime. These are issued by Clerk and must be checked in the deployed app.
- Inspect Cache API, HTTP cache, service workers, IndexedDB and history after
  logout on a shared device.

### Infrastructure and supply chain

- Confirm Access is not accidentally layered on production in a way that masks
  application-authentication defects during testing.
- Confirm no route or hostname reaches static assets without this Worker.
- Review Cloudflare roles, API tokens, D1 access, secret rotation and deployment
  provenance under least privilege.
- Run dependency audit, secret scanning, lockfile review and static analysis.
- Attempt malformed/oversized requests and bounded bursts against login and
  asset routes; do not perform unapproved availability testing.

## Known limitations and residual risk

- An authorized singer necessarily receives decrypted score/audio bytes and
  can save, record or redistribute them. No browser access-control system can
  provide DRM against an authorized recipient.
- Compromise of a singer's mailbox or active browser session grants that
  singer's access until Clerk/session revocation takes effect.
- Clerk availability is required to create/refresh identity sessions; D1 is
  required for every protected request. Failures reduce availability rather
  than confidentiality.
- The sign-in CSP permits inline styles because Clerk's prebuilt UI uses
  runtime CSS. It does not permit inline scripts.
- Clerk session custom claims can lag identity changes briefly. End-user email
  changes must remain disabled, and emergency revocation must occur in D1.
- Email verification, bot protection and allowed redirects are controls in the
  Clerk tenant rather than repository code. A dashboard configuration drift can
  invalidate assumptions even while all local tests pass.
- Application logs intentionally avoid email addresses, which limits forensic
  attribution. Cloudflare/Clerk retention and access should be reviewed against
  the privacy policy and incident-response needs.
- Existing downloads or browser buffers cannot be remotely erased after
  authorization is revoked.

## Evidence package expected from reviewer

- Tested commit SHA, hostname, date and tool versions.
- Request/response evidence with tokens, cookies, emails and secrets redacted.
- Coverage matrix for every test above and explicit untested items.
- Findings ranked by exploitability and impact, with safe reproduction steps.
- Retest result for every remediation and a final go/no-go recommendation.
