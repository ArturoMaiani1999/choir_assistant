# Pitch-tracking engineering

**Status:** canonical index
**Owner:** project maintainer
**Last reviewed:** 2026-09-28

## Current contract

`TrackedPitch` is the only pitch consumed by scoring. `DisplayPitch` may be
smoothed or shifted visually but must never feed back into scoring. The v1
baseline remains selectable and regression-tested. CREPE/ONNX is an optional
local diagnostic and is not shipped to singers.

## Active documents

- [Implementation tracker](implementation-tracker.md)
- [Validation contract](validation.md)
- [Real-vocal corpus plan](corpus-plan.md)
- [Expert audit](expert-audit.md)
- [Octave robustness plan](octave-robustness-plan.md)

The implementation tracker records current execution state. The expert audit
is a snapshot for external review and should be refreshed or date-stamped
before each new submission.
