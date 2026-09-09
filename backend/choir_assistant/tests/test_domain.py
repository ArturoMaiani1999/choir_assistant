import unittest
from pathlib import Path

from choir_assistant.domain.models import (
    NormalizedScore,
    PerformanceOccurrence,
    TargetEvent,
)
from choir_assistant.ingestion.musicxml import compile_musicxml
from choir_assistant.ingestion.navigation import MeasureNavigationHint, flatten_navigation


class RuntimeScoreTests(unittest.TestCase):
    def test_target_lookup_is_symbolic_and_part_specific(self) -> None:
        score = NormalizedScore(
            score_version_id="score-1",
            title="Fixture",
            target_events=[
                TargetEvent(
                    id="target-1",
                    occurrence_id="occ-1",
                    written_measure_id="m-1",
                    part_id="tenor",
                    onset_beats=0.0,
                    duration_beats=1.0,
                    onset_seconds=0.0,
                    duration_seconds=0.5,
                    midi_pitch=64,
                    frequency_hz=329.6276,
                )
            ],
        )
        target = score.target_at("tenor", 0.25)
        self.assertIsNotNone(target)
        self.assertEqual(target.midi_pitch, 64)
        self.assertIsNone(score.target_at("bass", 0.25))

    def test_performance_occurrences_are_distinct(self) -> None:
        score = NormalizedScore(
            score_version_id="score-1",
            title="Fixture",
            performance_occurrences=[
                PerformanceOccurrence("occ-1", "m-1", 1, 0, 4, 0, 2),
                PerformanceOccurrence("occ-2", "m-1", 2, 4, 8, 2, 4),
            ],
        )
        self.assertEqual(score.occurrence_at(2.5).id, "occ-2")

    def test_musicxml_compiles_to_symbolic_targets_and_tempo_seconds(self) -> None:
        fixture = Path(__file__).parent / "fixtures" / "two_measure.musicxml"
        score = compile_musicxml(fixture, score_version_id="fixture-v1")

        self.assertEqual(score.title, "Compiler fixture")
        self.assertEqual(score.parts[0].name, "Soprano")
        self.assertEqual(len(score.measures), 2)
        self.assertEqual(len(score.target_events), 5)
        self.assertEqual(score.target_events[0].midi_pitch, 60)
        self.assertAlmostEqual(score.target_events[0].onset_seconds, 0.0)
        self.assertAlmostEqual(score.target_events[1].onset_seconds, 1.0)
        self.assertTrue(score.target_events[2].is_rest)
        self.assertEqual(score.target_events[3].midi_pitch, 64)
        self.assertEqual(score.target_events[4].midi_pitch, 66)
        self.assertEqual(score.tempo_map[0].bpm, 60)

    def test_musicxml_flattens_repeat_with_second_ending(self) -> None:
        fixture = Path(__file__).parent / "fixtures" / "repeat_endings.musicxml"
        score = compile_musicxml(fixture)

        self.assertEqual([event.midi_pitch for event in score.target_events], [60, 62, 60, 64])
        self.assertEqual(
            [occurrence.written_measure_id for occurrence in score.performance_occurrences],
            ["measure-1", "measure-2", "measure-1", "measure-3"],
        )
        self.assertEqual(score.performance_occurrences[2].occurrence_index, 2)
        self.assertAlmostEqual(score.target_events[2].onset_seconds, 6.0)
        self.assertTrue(any(event.kind == "repeat_backward" for event in score.navigation))

    def test_musicxml_executes_dc_al_fine(self) -> None:
        fixture = Path(__file__).parent / "fixtures" / "dc_fine.musicxml"
        score = compile_musicxml(fixture)

        self.assertEqual([event.midi_pitch for event in score.target_events], [60, 62, 60, 62, 64])
        self.assertTrue(any(event.kind == "dc" for event in score.navigation))
        self.assertTrue(any(event.kind == "fine" for event in score.navigation))

    def test_navigation_executes_ds_al_coda_without_retriggering_jump(self) -> None:
        hints = [
            MeasureNavigationHint(0, has_segno=True),
            MeasureNavigationHint(1),
            MeasureNavigationHint(2, has_to_coda=True),
            MeasureNavigationHint(3, has_coda=True),
            MeasureNavigationHint(4),
            MeasureNavigationHint(5, jump="ds", words=("D.S. al Coda",)),
            MeasureNavigationHint(6, has_fine=True),
        ]
        self.assertEqual(flatten_navigation(hints), [0, 1, 2, 3, 4, 5, 0, 1, 3, 4, 5, 6])


if __name__ == "__main__":
    unittest.main()
