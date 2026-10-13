# Choir beta operations

**Status:** canonical
**Owner:** project maintainer
**Last reviewed:** 2026-10-04

This document defines how Choir Assistant can be used by real singers while it
continues to evolve. Hosting and access-control commands live in the
[private deployment runbook](private-deployment.md); local checks and coding
rules live in the [development workflow](development-workflow.md).

## Operating goal

The first release is a **private beta**, not a public launch. Its goals are to:

- give the choir one stable URL that keeps working during normal development;
- collect actionable feedback from a small, known group;
- release improvements without exposing unfinished work or source material;
- preserve a tested rollback for every production change;
- keep microphone analysis and takes on the singer's device.

Public availability is a later product and legal decision. It requires a new
review of rights, privacy, abuse prevention, capacity and support; removing the
Access policy is not by itself a public-launch plan.

## Environments

| Environment | Audience | Content | Update rule |
|---|---|---|---|
| Local | Maintainer/developers | Authoring data and diagnostics allowed | Changes continuously |
| Staging | Maintainer plus 2–4 pilot singers | Exact production candidate, protected by Access | Every candidate |
| Production | Authorized choir members | Approved static release only, protected by Access | Explicit promotion |

Access must protect the whole Worker before real repertoire is uploaded.
Version preview URLs are disabled; production is never used as a development
preview.

## Source-control model

After the first beta transition:

- `main` represents the code currently eligible for production;
- work happens on short-lived `feature/<name>` or `fix/<name>` branches;
- a change reaches `main` only after review and the relevant checks pass;
- each production deployment receives a tag such as `beta-2026.10.03.1`;
- the current long-lived `deploy` branch is reconciled into `main` and retired;
- releases are never built from an uncommitted or untracked working tree.

Large features stay off production until complete. If an experiment must be
visible to pilot users, expose it only in staging; introduce a production
feature flag only when both enabled and disabled paths have tests and a clear
removal date.

## Release flow

```text
feature/fix -> local checks -> review -> main -> immutable dist/
                                            -> protected staging
                                            -> acceptance
                                            -> production promotion + tag
```

1. Write user-visible acceptance criteria before implementation.
2. Run focused checks during development and the full release suite before the
   candidate is accepted.
3. Confirm that every allowlisted score is editorially approved and has a real,
   traceable rights note.
4. Build `dist/` from a clean commit. The build version and manifest identify
   that exact source state.
5. Deploy the unchanged directory to protected staging.
6. Test the candidate on at least one desktop and one phone, including audio,
   microphone permission, pause/resume and the selected repertoire.
7. Record the result using the release record below.
8. Promote the same `dist/` to production and tag the commit. Never rebuild
   between staging acceptance and production.
9. Announce user-visible changes in a short message to the choir.

Normal releases should use a predictable maintenance window, initially no more
than once per week. Avoid deployments immediately before or during rehearsal.
Urgent fixes still pass through staging, but may use a shortened device matrix.

## Change classes

| Class | Examples | Minimum gate |
|---|---|---|
| Content | New/corrected score, lyrics or backing track | Editorial/rights review, bundle rebuild, sync smoke test |
| Application | UI, playback, pitch tracking | Unit checks, browser smoke, desktop and phone acceptance |
| Security/privacy | Access, headers, data behavior | Independent access tests and explicit maintainer approval |
| Hotfix | Production is unusable or materially wrong | Branch from production tag, focused regression test, staging, immediate rollback ready |

Content and application changes may ship together, but the release record must
make both scopes visible. A new score is not “just data”: timing and audio
synchronization are production behavior.

## Beta cohort and onboarding

Start with 2–4 singers using different devices, then expand to the whole choir
after one stable rehearsal cycle. Every tester receives:

- the production URL and OTP login instructions;
- the recommendation to use headphones;
- a short privacy statement explaining email/access logs and local microphone
  processing;
- one feedback channel and the minimum information needed for a useful report.

Provision and revoke singer access through the exact-email OTP procedure in
[cloudflare-access-email-pin.md](cloudflare-access-email-pin.md); never store
the cohort's email addresses in this repository.

Do not request recordings by default. If an audio sample is genuinely needed,
ask explicitly for that incident, explain how it will be used and deleted, and
keep it outside the production site.

## Feedback and triage

A useful report contains: visible build version, device, operating system,
browser, brano/parte/battuta, expected behavior, actual behavior and repeatable
steps. A screenshot is optional; an audio recording is never implicit.

| Priority | Meaning | Response |
|---|---|---|
| P0 | Unauthorized access, unintended publication or privacy risk | Disable/rollback immediately; investigate before reopening |
| P1 | Site unavailable, playback unusable for many singers | Roll back or hotfix before the next rehearsal |
| P2 | Important function broken with a workaround | Schedule for the next release |
| P3 | Cosmetic issue or improvement idea | Backlog and group with related work |

Keep one issue list with owner, priority, affected build and status. Chat
messages may start a report, but decisions and reproduction details must be
copied into that list.

## Incident and rollback rule

For a P0 or broad P1, prefer restoring service over debugging in production:

1. record the affected build and time;
2. roll back to the last accepted Cloudflare deployment;
3. verify login and one representative rehearsal flow;
4. notify the choir briefly;
5. reproduce locally, add a regression check and release through staging;
6. document cause and prevention before closing the incident.

If content may have been exposed, also disable access, preserve the relevant
Access/deployment logs and review the allowlist before reopening.

## Minimal observability

The private beta starts without behavioral analytics or uploaded microphone
data. Operational evidence is limited to:

- Cloudflare deployment status and Access authentication logs;
- the visible build version and `deployment-manifest.json`;
- structured reports from singers;
- local browser console/network inspection during support.

Adding client error reporting or product analytics requires a separate privacy
decision, data-retention rules and an update to the singer notice.

## Release record

Store one record per production release in the issue/release system or a dated
operations log:

```text
Release/tag:
Commit:
Build version:
deployment-manifest.json SHA-256:
Repertoire and score versions:
User-visible changes:
Checks run and result:
Staging URL and acceptance date:
Devices/browsers tested:
Approved by:
Production deployment ID/time:
Rollback deployment/tag:
Known limitations:
```

## First-beta exit criteria

The choir invitation can be sent only when all of these are true:

- the repository changes intended for release are committed and reviewed;
- `deploy/repertoire.json` contains no placeholder rights notes;
- a clean production build passes its internal asset and security audit;
- staging and every preview hostname are protected before real repertoire is
  uploaded;
- OTP is tested with one allowed and one denied address;
- the same candidate passes desktop and phone acceptance;
- rollback to the preceding deployment has been rehearsed once;
- the privacy/onboarding message and support contact are ready.

Automation can be expanded after the first beta, but these gates are mandatory
from the first real user onward.
