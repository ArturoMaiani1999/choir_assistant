import './echo_cancellation.js';
import './echo_delay.js';

class ChoirEchoDelay extends AudioWorkletProcessor {
  constructor() {
    super();
    this.retimer = new globalThis.ChoirEchoDelay.Retimer(Math.round(sampleRate*.080));
    this.command = null;
    this.port.onmessage = ({data}) => {
      const accepted = this.retimer.setDelay(data.frames, data.fadeFrames || 0);
      if (accepted) this.command = { id:data.id, frames:data.frames };
      else this.port.postMessage({type:'delay-rejected',id:data.id});
    };
  }
  process(inputs,outputs) {
    this.retimer.process(inputs[0]?.[0],outputs[0][0]);
    if(this.command&&!this.retimer.fade){
      this.port.postMessage({type:'delay-complete',...this.command,renderFrame:currentFrame+outputs[0][0].length});
      this.command=null;
    }
    return true;
  }
}
registerProcessor('choir-echo-delay',ChoirEchoDelay);
