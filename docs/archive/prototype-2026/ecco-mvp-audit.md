# Ecco quel che abbiamo · MVP review slice

## Scope

The active Practice bundle is an eight-measure excerpt corresponding to source measures 3–10 and the complete first phrase:

> Ecco quel che abbiamo, nulla ci appartiene ormai; ecco i frutti della terra che tu moltiplicherai.

It is a lead-sheet melody with a generated organ realization in 2/2 at quarter-note = 68. It is intentionally a smaller benchmark than the complete 100-measure, two-page song.

## Derivation

`sheets/ecco-quel-che-abbiamo/ecco-quel-che-abbiamo.pdf` → raw Audiveris MXL → `scripts/prepare_ecco_mvp.py` → review MusicXML → runtime JSON, MuseScore SVG/MSCZ, guide audio → `frontend/practice-piece.json`.

Once an administrator uploads a corrected MSCZ, that file becomes the canonical musical source. The import records `data/omr-ecco/admin-canonical.json`; from then on `prepare_ecco_mvp.py` refuses to replace the production MusicXML from OMR unless an intentional reset uses `--force-overwrite-admin-revision`. Player, audio and interface work must rebuild derived assets from the canonical MSCZ without touching the notation.

The normalizer:

- selects source measures 3–10;
- removes unsupported OMR dynamics/articulation guesses;
- assigns deterministic source-note IDs;
- enters the visible lyric syllables with `single/begin/middle/end` and melisma semantics;
- retains pitch, duration, rests and ties from the OMR hypothesis;
- transcribes the printed progression `SOL – SOL7+ – DO – SOL – MI- – SI- – DO – RE7`;
- realizes each chord as a sustained organ pedal/root plus a compact right-hand voicing;
- sets the printed tempo of 68.

Automated integrity currently reports 70 written events (37 melody and 33 organ), 36 mapped melody notes, 32 lyric-bearing events, eight complete 2/2 measures, and a consistent score/runtime/render/audio bundle.

## Human approval window

Open `frontend/admin-review.html`, or press **Revisione** in the Practice toolbar. The reviewer receives:

- source-PDF and reconstructed-score panes;
- the melody-and-strings guide audio generated from the same runtime timeline; the notated organ part uses MS Basic String Ensemble 1 in playback, with a very short chord overlap, attack compensation and light room reverb;
- pitch/accidental, rhythm/tie, lyric, rendering and audio checks;
- reviewer identity and notes;
- approval/revocation controls;
- a downloadable JSON review record.

Approval is stored locally under the complete bundle fingerprint. Any score, runtime, geometry, rendered-score or audio change generates another fingerprint, so the prior decision no longer unlocks Practice.

This is an honest browser-only MVP gate, not the final multi-user approval system. Production must persist the signed decision server-side with authentication, authorization and an append-only audit trail.

## Remaining review

- [ ] Human compares all pitches and accidentals against the source crop.
- [ ] Human checks the 2/2 rhythm, ties and measure boundaries.
- [ ] Human checks the exact Italian syllabification and melismas.
- [ ] Human listens through the 28.24-second guide while watching cursor transitions.
- [ ] Human approves the exact displayed fingerprint.
- [ ] Expand the same workflow to the remaining source measures.

## Future free-rhythm/recitative model

Gloria remains the deliberate future benchmark for text such as “Noi ti lodiamo…”. Such notation must not be forced into fabricated metric durations. The future model should separate:

- written order and printed score location;
- optional notated duration;
- performance-time anchors aligned by a director/editor;
- conductor-cued or audio-aligned phrase regions;
- navigation occurrences;
- target pitch continuity between reviewed anchors.

A free-rhythm region should therefore carry an explicit timing mode such as `metered`, `editor_aligned`, or `conductor_cued`. Scoring and cursor interpolation must suspend beat-based assumptions inside non-metered regions and use approved performance anchors instead.
