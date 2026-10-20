class ChoirEchoCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.start = options.processorOptions.startFrame;
    this.length = options.processorOptions.length;
    this.index = 0; this.mic = new Float32Array(this.length); this.ref = new Float32Array(this.length);
    this.sent = false;
  }
  process(inputs, outputs) {
    const output = outputs[0][0]; output.fill(0);
    if (this.sent) return false;
    const mic = inputs[0]?.[0], ref = inputs[1]?.[0];
    for (let i = 0; i < output.length; i++) {
      if (currentFrame + i < this.start) continue;
      if (!mic || !ref) { this.port.postMessage({error:'missing-input'}); this.sent = true; return false; }
      this.mic[this.index] = mic[i]; this.ref[this.index] = ref[i]; this.index++;
      if (this.index === this.length) {
        this.port.postMessage({microphone:this.mic, reference:this.ref}, [this.mic.buffer,this.ref.buffer]);
        this.sent = true; return false;
      }
    }
    return true;
  }
}
registerProcessor('choir-echo-capture', ChoirEchoCapture);
