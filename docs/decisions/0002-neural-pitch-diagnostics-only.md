# ADR-0002: Neural pitch models remain diagnostic-only

**Status:** accepted
**Date:** 2026-09-28
**Owner:** project maintainer
**Last reviewed:** 2026-09-28

## Context

CREPE/ONNX was introduced to compare pitch estimators. Its model and runtime
increase transfer size and startup/runtime cost, while v1 remains the scoring
baseline.

## Decision

Keep CREPE available on demand in the local diagnostic environment. Exclude
the model, ONNX Runtime, neural controls and neural network requests from the
private singer build.

## Consequences

- Singer releases remain lightweight and require no WebAssembly CSP exception.
- Neural comparisons remain possible during engineering work.
- Any future production neural estimator requires a new ADR backed by corpus
  evidence, device performance measurements and a release-size budget.
