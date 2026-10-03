# ADR-0003: Workers static delivery

**Status:** accepted
**Date:** 2026-10-03
**Owner:** project maintainer
**Last reviewed:** 2026-10-03
**Supersedes:** ADR-0001 for the Cloudflare delivery product

## Context

The private beta still needs an allowlisted static release behind Cloudflare
Access. Cloudflare now recommends Workers Static Assets for new projects, and
current Wrangler versions route new Pages creation toward Workers.

## Decision

Deploy the immutable `dist/` as a static-assets-only Worker named
`choir-assistant`. Disable version preview URLs, retain the generated
`_headers`, and protect the Worker itself with Cloudflare Access before any
real repertoire is uploaded. The first deployment contains only a harmless
holding page so the Worker exists and its Access policy can be configured.

## Consequences

- One Worker-level Access policy covers its `workers.dev` address, future
  custom domains and previews.
- Static asset requests retain Cloudflare's static delivery and `_headers`
  behavior without adding application server code.
- A new release is uploaded with `wrangler deploy`; Cloudflare versions and
  deployments provide rollback history.
- The allowlisted build boundary and browser-local privacy model from ADR-0001
  remain unchanged.
