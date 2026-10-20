"""Check timing adaptation isolation and reference-only subtraction invariants."""
import unittest
import numpy as np
from probe_echo_path_drift import fit_reference_path, switched_prediction, weighted_delay
from probe_santo_alignment import shift_prediction


class QuietPathDriftTest(unittest.TestCase):
    def test_recovers_positive_delay_change_in_independent_bands(self):
        sr = 16000
        reference = np.random.default_rng(92).normal(size=12*sr)
        first = shift_prediction(reference, 2400)
        later = shift_prediction(reference, 2448)
        for band in [(100, 700), (700, 2000), (2000, 6000)]:
            a = weighted_delay(reference[2*sr:6*sr], first[2*sr:6*sr], sr, band)
            b = weighted_delay(reference[8*sr:10*sr], later[8*sr:10*sr], sr, band)
            self.assertEqual(b-a, 48)

    def test_fit_does_not_read_adaptation_holdout_or_voice(self):
        sr = 16000
        x = np.random.default_rng(193).normal(size=12*sr)
        y = .5*shift_prediction(x, 2400)
        h, bulk = fit_reference_path(x, y, sr)
        y[6*sr:] = np.random.default_rng(7).normal(size=6*sr)*100
        x[6*sr:] = 300
        other, other_bulk = fit_reference_path(x, y, sr)
        np.testing.assert_array_equal(h, other)
        self.assertEqual(bulk, other_bulk)

    def test_adaptation_is_not_applied_before_observation_finishes(self):
        frozen = np.ones(2000)
        shifted = np.full(2000, 3.)
        prediction = switched_prediction(frozen, shifted, 100, update_at=10, fade_sec=.1)
        np.testing.assert_array_equal(prediction[:1001], frozen[:1001])
        np.testing.assert_array_equal(prediction[1010:], shifted[1010:])

    def test_same_frequency_voice_preserved_by_frozen_reference_subtraction(self):
        sr = 16000
        t = np.arange(2*sr)/sr
        reference = np.sin(2*np.pi*196*t)
        echo = .15*shift_prediction(reference, 2448)
        frozen = .15*shift_prediction(reference, 2400)
        prediction = switched_prediction(frozen, echo, sr, update_at=1)
        for phase in [0, .8, np.pi]:
            voice = .04*np.sin(2*np.pi*196*t+phase)
            np.testing.assert_allclose(((echo+voice)-prediction)-(echo-prediction), voice, atol=1e-15)


if __name__ == '__main__':
    unittest.main()
