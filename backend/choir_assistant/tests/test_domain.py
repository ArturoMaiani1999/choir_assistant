import unittest

from choir_assistant.domain.models import (
    NormalizedScore,
    PerformanceOccurrence,
    TargetEvent,
)


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


if __name__ == "__main__":
    unittest.main()
