# Practice-score reconstruction policy

Status: canonical policy, 9 September 2026.

## Principle

Recover the simplest conventional musical score supported by the source. Musical correctness, meter and readability take precedence over literal OMR output. Complexity requires positive evidence; OMR is a hypothesis, never ground truth.

Preserve pitch, rhythm, meter, rests, necessary ties, lyrics, voice allocation, organ notes, tempo and repeat/navigation structure. Unless clearly present and necessary, omit dynamics, ornaments, articulations, breath marks and other expressive/decorative marks.

## Decision order

For every ambiguity ask, in order:

1. Is the reading explicitly visible?
2. Does the measure duration satisfy its time signature?
3. Is it a conventional subdivision of that meter?
4. Does it agree with adjacent measures?
5. Does it agree with the other voices and organ?
6. What is the simplest valid explanation?

Cross-part evidence may remove implausible complexity but must not be used to invent notes.

## Rhythm and tuplets

Validate `sum(notes + rests) == measure duration` before accepting OMR rhythm. Prefer ordinary notes, dotted values and necessary ties. Never infer tuplets merely from three notes in a beat; three eighth notes are the normal subdivision of a dotted-quarter beat in 6/8, 9/8 and 12/8. Tuplets, irregular values and exotic groupings require unambiguous evidence.

Do not simplify across barlines, repeats, lyric attacks or structural boundaries when that changes musical semantics.

## Mandatory normalization pass

The publication pipeline is:

`PDF → OMR → raw MusicXML → structural validation → musical normalization → review artifact → human approval`.

Normalization must detect improbable tuplets, ornaments, accidental articulations/dynamics, malformed ties, invalid measure totals, inconsistent meter/grouping and suspicious accidentals. Every automatic change and unresolved ambiguity belongs in the validation report with measure, part, rationale and confidence. Corrections must never be invisible.

This policy is not implemented by the Practice frontend. The currently displayed MuseScore SVGs remain unapproved draft output and visibly contain markings that require the future normalization/review pass.
