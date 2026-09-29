# Documentation index

**Status:** canonical
**Owner:** project maintainer
**Last reviewed:** 2026-09-28

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

## Product

- [Practice experience](product/practice-experience.md) — canonical UX and
  temporal behavior.
- [Session states](product/session-states.md) — microphone, playback and
  interruption state model.
- [Voice Lab learning path](product/voice-lab-learning-path.md) — curriculum,
  adaptive sessions and early-completion criteria for vocal exercises.

## Engineering

- [Pitch tracking](engineering/pitch-tracking/README.md) — current contract,
  tracker, validation and expert material.

## Operations

- [Development workflow](operations/development-workflow.md) — local setup,
  checks, change flow and release-candidate discipline.
- [Private deployment](operations/private-deployment.md) — build, staging,
  Cloudflare Access and production checklist.
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
