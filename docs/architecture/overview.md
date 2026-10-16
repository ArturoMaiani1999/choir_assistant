# System architecture

**Status:** canonical
**Owner:** project maintainer
**Last reviewed:** 2026-10-15

## Purpose

Choir Assistant prepares reviewed musical material locally and distributes a
rehearsal application to an authenticated group of singers. Published scores
and audio remain immutable; the optional shared-performance area stores only
each singer's current best piano-roll image and score metadata. The singer
application synchronizes notation and backing audio while estimating a single
vocal fundamental frequency locally in the browser.

## Context

```text
Maintainer workstation
  MuseScore source + review tools + local Python server
           |
           | deterministic, allowlisted build
           v
  dist/ static release candidate
           |
           | immutable upload
           v
Clerk identity -> Worker authorization -> D1 members, roles and performance metadata
                         |                         |
                         v                         v
              Workers Static Assets       private R2 piano-roll PNGs
                         |                         |
                         `----------> singer browser <----------'
                                    |-- Web Audio pitch analysis
                                    |-- localStorage preferences
                                    `-- IndexedDB local takes
```

The workstation is an authoring boundary, not a production server. Only the
static release candidate crosses that boundary.

## Components

### Singer application

`frontend/index.html`, `styles.css` and `app.js` implement the dependency-light
browser client. `score_runtime.js` owns normalized score traversal and the
audio-derived playback clock. `pitch_detector.js` produces the scoring pitch;
`one_euro_filter.js` affects only the displayed trajectory.

The production client reads a static `library.json`, per-piece `bundle.json`
and versioned score/audio/SVG assets. The shared-performance feature uses a
same-origin private Worker API for member context, scoped lists and current
best piano-roll images; rehearsal playback remains static.

### Local authoring and administration

`scripts/serve_frontend.py` supports local library discovery, MuseScore-derived
assets, transposition and administrative review. It is trusted local tooling
and is not hardened as an Internet service. Upload, OMR, conversion and review
functions remain on the maintainer workstation.

### Score domain and ingestion

`backend/choir_assistant` defines score and ingestion contracts. Editable
MuseScore and reviewed MusicXML are authoring artifacts. Normalized score JSON,
SVG pages and audio are derived artifacts. See
[ingestion-pipeline.md](ingestion-pipeline.md).

### Release builder

`scripts/build_dist.py` is the production boundary. It accepts only entries in
`deploy/repertoire.json` that have explicit publication approval and a rights
note. It copies the minimum runtime assets, fingerprints application files,
generates security headers and records hashes in `deployment-manifest.json`.

## Trust and privacy boundaries

- Clerk authenticates the singer and issues a signed session. The Worker then
  requires an active HMAC email digest in D1 before serving any production
  asset. Production cutover remains gated by ADR-0004 and security review.
- The Worker exposes authentication middleware, static files, the
  singer-facing scoped-performance API and the owner-only personal-recording
  API. Local authoring/admin endpoints remain absent.
- Live microphone samples and pitch estimates are processed in the browser.
  Ordinary practice takes remain browser-local. With explicit per-take consent
  and headphone confirmation, a singer may instead store one private personal
  recording and its pitch replay per piece in D1/private R2.
- An eligible completed attempt may separately export its rendered piano-roll
  PNG and score metadata for scoped sharing; that shared artifact never
  contains microphone audio.
- CREPE/ONNX is diagnostic-only and excluded from production releases.
- `noindex` is defense in depth, not an authentication mechanism.

## Authoritative data

| Concern | Authority |
|---|---|
| Editable notation | Human-reviewed MuseScore source |
| Interchange notation | Approved MusicXML |
| Playback order and targets | Normalized score/performance timeline |
| Release contents | `deploy/repertoire.json` plus `deployment-manifest.json` |
| Singer identity | Clerk verified session |
| Singer authorization | D1 active member, Clerk subject, roles and group grants |
| Live sung pitch | Browser-local detector output |
| Current shared best metadata | D1 `best_performances` |
| Current shared best image | Private R2 object referenced by D1 |
| Current personal recording metadata | D1 `personal_recordings`, owner-only |
| Personal voice and pitch replay | Private R2 objects referenced by D1 |

## Known constraints

- Production is initially original-key only because live transposition depends
  on the local server. Pre-rendered transposed audio may be added later.
- Pitch scoring is monophonic and expects headphones to avoid backing leakage.
- The real-vocal corpus is still too small for broad estimator claims.
- Every static request is mediated by the Worker; preview URLs remain disabled
  and alternate hostnames must be included in the security assessment.
- Shared scores and images are good-faith browser output, not tamper-proof
  evidence.

## Related decisions

- [ADR-0001: private static delivery](../decisions/0001-private-static-delivery.md)
- [ADR-0002: neural pitch models remain diagnostic](../decisions/0002-neural-pitch-diagnostics-only.md)
- [ADR-0003: Workers static delivery](../decisions/0003-workers-static-delivery.md)
- [ADR-0004: consumer authentication](../decisions/0004-consumer-authentication.md)
- [ADR-0005: scoped performance sharing](../decisions/0005-scoped-performance-sharing.md)
- [ADR-0006: private personal recordings](../decisions/0006-private-personal-recordings.md)
- [Shared performances and scoped authorization](shared-performances-rbac.md)
- [Personal recordings and synchronized pitch replay](personal-recordings.md)
