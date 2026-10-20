"""Regression checks for diagnostic timing/sign and reference-only ablations."""
import unittest
import numpy as np
from analyze_echo_diagnostic import delay_probe
from probe_santo_alignment import shift_prediction

class EchoDiagnosticAnalysisTest(unittest.TestCase):
    def test_recovers_too_late_prediction_and_correct_sign(self):
        rng=np.random.default_rng(713);reference=rng.normal(size=48000)
        raw=shift_prediction(reference,7680)*.4
        prediction=shift_prediction(reference,8876)*.4
        result=delay_probe(prediction,raw,48000)
        self.assertEqual(result['lagSamples'],-1196)
        self.assertAlmostEqual(result['correlation'],1.)
        aligned=shift_prediction(prediction,result['lagSamples'])
        # Ends depend on future samples in this offline ablation: ignore the
        # last 1196 samples. Production must use a causal model, not lookahead.
        np.testing.assert_allclose(aligned[:-1196],raw[:-1196],atol=1e-12)

    def test_frozen_reference_subtraction_preserves_same_frequency_voice_coefficient(self):
        sr=48000;t=np.arange(sr)/sr;echo=.08*np.sin(2*np.pi*196*t)
        prediction=echo*.75
        for phase in [0,.2,1.7,np.pi]:
            for level in [.0001,.02,.1]:
                voice=level*np.sin(2*np.pi*196*t+phase)
                with_voice=(echo+voice)-prediction
                without_voice=echo-prediction
                np.testing.assert_allclose(with_voice-without_voice,voice,atol=1e-14)

    def test_shift_padding_does_not_wrap_audio_across_recording_boundaries(self):
        x=np.arange(10.)
        np.testing.assert_array_equal(shift_prediction(x,2),[0,0,0,1,2,3,4,5,6,7])
        np.testing.assert_array_equal(shift_prediction(x,-2),[2,3,4,5,6,7,8,9,0,0])
        np.testing.assert_array_equal(shift_prediction(x,0),x)

if __name__=='__main__':unittest.main()
