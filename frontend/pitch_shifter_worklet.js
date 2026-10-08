class ChoirPitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: .5, maxValue: 2, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.ringSize = 8192;
    this.grainRange = 2048;
    this.maximumDelay = 2304;
    this.rings = [];
    this.writeIndex = 0;
    this.phase = 0;
  }

  sampleAt(ring, position) {
    const size = this.ringSize;
    const wrapped = ((position % size) + size) % size;
    const left = Math.floor(wrapped);
    const fraction = wrapped - left;
    return ring[left] * (1 - fraction) + ring[(left + 1) % size] * fraction;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;
    const ratio = Math.max(.5, Math.min(2, Number(parameters.ratio?.[0]) || 1));
    const frameCount = output[0].length;
    while (this.rings.length < output.length) this.rings.push(new Float32Array(this.ringSize));

    for (let frame = 0; frame < frameCount; frame += 1) {
      const phaseA = this.phase;
      const phaseB = (phaseA + .5) % 1;
      const weightA = Math.sin(Math.PI * phaseA) ** 2;
      const weightB = Math.sin(Math.PI * phaseB) ** 2;
      const delayA = this.maximumDelay - phaseA * this.grainRange;
      const delayB = this.maximumDelay - phaseB * this.grainRange;

      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[Math.min(channel, Math.max(0, input.length - 1))];
        const sample = source?.[frame] ?? 0;
        const ring = this.rings[channel];
        ring[this.writeIndex] = sample;
        output[channel][frame] = Math.abs(ratio - 1) < 1e-5
          ? sample
          : this.sampleAt(ring, this.writeIndex - delayA) * weightA
            + this.sampleAt(ring, this.writeIndex - delayB) * weightB;
      }

      this.writeIndex = (this.writeIndex + 1) % this.ringSize;
      this.phase += (ratio - 1) / this.grainRange;
      this.phase -= Math.floor(this.phase);
    }
    return true;
  }
}

registerProcessor('choir-pitch-shifter', ChoirPitchShifterProcessor);
