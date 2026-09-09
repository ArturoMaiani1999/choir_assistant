# Performance timeline slice

The MusicXML compiler now separates written measures from performance occurrences.

For a repeat with a first and second ending, the written measures remain unique, while `NormalizedScore.performance_occurrences` can contain a sequence such as:

```text
measure-1, measure-2, measure-1, measure-3
```

`TargetEvent` records are cloned into that performance order. Their `onset_beats`, `onset_seconds`, and `occurrence_id` refer to the flattened execution, while `MusicalEvent` continues to describe the written score.

Implemented in `backend/choir_assistant/ingestion/navigation.py` and `musicxml.py`:

- forward/backward repeats;
- explicit repeat counts;
- simple ending labels such as `1` and `2`;
- repeated occurrence indexes;
- tempo-aware performance seconds.
- one explicit D.C. or D.S. pass;
- Fine termination;
- basic To Coda/Coda routing.

Remaining limitations:

- multiple D.C./D.S. jumps in one score;
- nested or overlapping repeat structures;
- resolving all MusicXML ending ranges spanning multiple measures.

Those markers are retained in `NormalizedScore.navigation` so the future navigation engine can operate from explicit source evidence.
