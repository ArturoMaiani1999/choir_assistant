importScripts('echo_cancellation.js');
importScripts('echo_delay.js');
let lastGainEnd = -Infinity;
self.onmessage = ({data}) => {
  if (data.mode === 'ready') { self.postMessage({ type: 'ready' }); return; }
  if (data.mode === 'gain') {
    let observation = null, delayObservation;
    try {
      if(data.endTime<=lastGainEnd||data.endTime-lastGainEnd>=8192/data.sampleRate){
        observation = self.ChoirEchoCancellation.gainObservation(data.prediction, data.microphone, data.sampleRate, data.noiseRms);
        lastGainEnd = data.endTime;
      }
      delayObservation = self.ChoirEchoDelay.observation(data.prediction,data.microphone,data.sampleRate,
        {noiseRms:data.noiseRms,validationDb:data.validationDb});
    }
    catch (_) { observation = { usable: false, reason: 'capture' }; }
    self.postMessage({ observation, delayObservation, epoch:data.epoch, endTime: data.endTime, microphone: data.microphone, prediction: data.prediction },
      [data.microphone.buffer, data.prediction.buffer]);
    return;
  }
  try {
    const stability = data.compact === true
      ? self.ChoirEchoCancellation.trainingStability(data.reference, data.microphone, data.sampleRate) : null;
    if (stability?.unstable) {
      self.postMessage({ usable: false, reason: 'unstable-delay', stability }); return;
    }
    const fitted = self.ChoirEchoCancellation.fit(data.reference, data.microphone, data.sampleRate, data.compact === true);
    const result = self.ChoirEchoDelay.prepareProfile(data.reference,data.microphone,fitted,data.sampleRate,data.compact === true);
    result.stability = stability;
    self.postMessage(result, result.impulse ? [result.impulse.buffer] : []);
  } catch (_) { self.postMessage({usable:false, reason:'capture'}); }
};
