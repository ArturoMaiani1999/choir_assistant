# Documentation index

**Status:** canonical
**Owner:** project maintainer
**Last reviewed:** 2026-10-11

This directory separates current contracts and procedures from historical
investigation. If two documents disagree, the canonical documents listed here
take precedence over anything under `archive/`.

## Architecture

- [System overview](architecture/overview.md) — components, trust boundaries,
  runtime data and deployment topology.
- [Ingestion pipeline](architecture/ingestion-pipeline.md) — durable score
  ingestion and review model.
- [Playback and audio](architecture/playback-audio.md) — clock authority,
  backing manifests and static-release constraints.
- [Performance timeline](architecture/performance-timeline.md) — written score
  versus performed occurrences.

- [Shared performances and scoped authorization](architecture/shared-performances-rbac.md) —
  singer best-score images, group-scoped RBAC, private storage and update
  protocol.
- [Personal recordings and synchronized pitch replay](architecture/personal-recordings.md) —
  owner-only voice capture, explicit consent, one recording per piece and
  synchronized pitch replay.
- [Direzione, repertorio personale e avanzamento](architecture/director-cockpit.md) —
  assignments, named progress, consent, per-part aggregates and retention.

## Product

- [Practice experience](product/practice-experience.md) — canonical UX and
  temporal behavior.
- [Home di Xynon](product/home.md) — composizione responsive, firma
  armonica bicolore e accesso unificato a profilo e impostazioni.
- [Session states](product/session-states.md) — microphone, playback and
  interruption state model.
- [Voice Lab warm-up redesign](product/voice-lab-warmup-redesign-plan.md) —
  current product and technical contract for scales, arpeggios and inner-ear
  work.
- [Audit dei flussi di navigazione](product/navigation-ux-audit.md) — passaggi,
  ritorni e conservazione del contesto verificati su desktop e mobile.
- [Relax mode](product/relax-mode.md) — riferimento storico della superficie
  rimossa; il renderer 3D resta in Home e About.
- [Performance monitoring privacy notice](product/performance-monitoring-privacy-notice.md) —
  draft copy shown before the first derived-metrics upload.

## Engineering

- [Pitch Detection Ablation Lab](engineering/pitch-tracking/ablation-lab.md) —
  confronto scientifico browser-side di YIN e pYIN sulle registrazioni opt-in.
- [Pitch tracking](engineering/pitch-tracking/README.md) — current contract,
  tracker, validation and expert material.

## Business

- [500-user cost model](business/500-user-cost-model.md) — first- and
  second-year costs, licensing assumptions, price sensitivity and public-domain
  alternative for a 500-user commercial service.

## Operations

- [Epistrophe staging deployment lesson](operations/epistrophe-staging-deployment-lesson.md) —
  guida didattica dalla registrazione del dominio alla configurazione
  Cloudflare, D1, R2 e Clerk, con checkpoint DNS e troubleshooting `.it`.
- [Consumer authentication implementation tracker](operations/consumer-auth-implementation-tracker.md) —
  motivation, staged plan, implementation status, evidence and external gates.
- [Consumer authentication dashboard checklist](operations/consumer-auth-dashboard-checklist.md) —
  Clerk/Cloudflare tenant, anti-abuse, privacy and cost controls that cannot be
  enforced from source code.
- [Consumer authentication deployment](operations/consumer-auth-deployment.md) —
  staged Clerk/D1 provisioning, member synchronization, cutover and rollback.
- [Consumer authentication security review](operations/consumer-auth-security-review.md) —
  controls, threat model, adversarial test scope and residual risk.

- [Development workflow](operations/development-workflow.md) — local setup,
  checks, change flow and release-candidate discipline.
- [Choir beta operations](operations/choir-beta-operations.md) — environments,
  branch policy, releases, feedback, incidents and rollback while singers use
  the application.
- [Private deployment](operations/private-deployment.md) — build, staging,
  Cloudflare Access and production checklist.
- [Email allowlist and PIN access](operations/cloudflare-access-email-pin.md) —
  reusable exact-email policy, OTP setup, Worker association, tests and
  troubleshooting.
- [Score review policy](operations/score-review-policy.md) — editorial source of
  truth and approval rules.
- [OMR consensus procedure](operations/omr-consensus.md) — local reconstruction
  workflow.

## Decisions

- [ADR index](decisions/README.md) — durable architectural decisions and their
  consequences.

## Archive

`archive/prototype-2026/` contains completed audits and superseded execution
plans. `archive/handoffs/` contains alternative deployment handoffs. Archived
documents provide evidence and context, but must not be used as current
requirements without a new ADR or an update to a canonical document.

## Documentation rules

1. Root contains only `README.md`; project documentation belongs here.
2. Every canonical document states status, owner and last review date.
3. Procedures describe commands that are actually executable in this repo.
4. Decisions with long-term consequences receive an ADR.
5. Completed plans move to `archive/`; live trackers stay beside their domain.
6. Code changes that alter architecture, operations or product contracts update
   the corresponding document in the same change.
