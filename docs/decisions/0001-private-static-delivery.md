# ADR-0001: Private static delivery

**Status:** accepted
**Date:** 2026-09-28
**Owner:** project maintainer
**Last reviewed:** 2026-09-28

## Context

The singer application needs private distribution to a small choir. The local
Python server also exposes authoring and administrative capabilities and is not
appropriate as an Internet-facing origin.

## Decision

Build an allowlisted static `dist/`, serve it through Cloudflare Pages and put
Cloudflare Access with exact-email policies in front of every production and
preview hostname. Keep ingestion, MuseScore automation and administration on
the maintainer workstation.

## Consequences

- No always-on application server or public admin API is required.
- Releases are reproducible, inspectable and easy to roll back.
- Dynamic local capabilities such as on-demand audio transposition are absent
  unless converted into pre-generated assets.
- Access configuration becomes part of the operational security boundary and
  must be acceptance-tested independently from `noindex` headers.
