import './audio_sample_clock.js';

class ChoirEchoDiagnostic extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.start=options.processorOptions.startFrame;this.maximum=options.processorOptions.maximumFrames;
    this.total=0;this.index=0;this.done=false;this.channels=Array.from({length:4},()=>new Float32Array(4096));
    this.clock=new globalThis.ChoirAudioSampleClock.SampleClock();
    this.port.onmessage=({data})=>{if(data==='stop'&&!this.done)this.flush(true);};
  }
  flush(done) {
    if(this.index||done)this.port.postMessage({channels:this.channels,valid:this.index,
      firstFrame:this.start+this.total-this.index,clock:this.clock.snapshot(),done},this.channels.map(c=>c.buffer));
    this.done=done;this.index=0;
    if(!done)this.channels=Array.from({length:4},()=>new Float32Array(4096));
  }
  process(inputs,outputs) {
    const output=outputs[0][0];output.fill(0);
    if(this.done)return false;
    const frame=this.clock.advance(currentFrame,output.length);
    if(this.clock.gapFrames&&(this.total||frame>this.start)){
      // Preserve the contiguous tail before reporting a genuine forward jump.
      if(this.index)this.flush(false);
      this.port.postMessage({error:'discontinuous-capture',expectedFrame:this.clock.expectedFrame,
        actualFrame:currentFrame,clock:this.clock.snapshot()});
      this.done=true;return false;
    }
    for(let i=0;i<output.length;i++) {
      if(frame+i<this.start)continue;
      if(frame+i!==this.start+this.total){
        if(this.index)this.flush(false);
        this.port.postMessage({error:'discontinuous-capture',expectedFrame:this.start+this.total,actualFrame:frame+i,clock:this.clock.snapshot()});
        this.done=true;return false;
      }
      for(let c=0;c<4;c++)this.channels[c][this.index]=inputs[c]?.[0]?.[i]??0;
      this.index++;this.total++;
      if(this.index===4096||this.total===this.maximum)this.flush(this.total===this.maximum);
      if(this.done)return false;
    }
    return true;
  }
}
registerProcessor('choir-echo-diagnostic',ChoirEchoDiagnostic);
