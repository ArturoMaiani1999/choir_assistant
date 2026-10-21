import './audio_sample_clock.js';

// Paired rolling history continues while the Worker owns one reusable packet.
// No backlog: after a slow callback the next packet contains the newest PCM.
class ChoirEchoMonitor extends AudioWorkletProcessor {
  constructor() {
    super();this.index=0;this.filled=0;this.sinceSend=0;this.waiting=false;this.epoch=0;this.lastEnd=null;
    this.rawHistory=new Float32Array(8192);this.predictionHistory=new Float32Array(8192);
    this.clock=new globalThis.ChoirAudioSampleClock.SampleClock();
    this.mic=new Float32Array(8192);this.prediction=new Float32Array(8192);
    this.port.onmessage=({data})=>{
      if(data.type==='reset'){
        this.filled=0;this.sinceSend=0;this.epoch=data.epoch;
        if(data.reanchor)this.clock=new globalThis.ChoirAudioSampleClock.SampleClock();
        return;
      }
      if(data.microphone?.length===8192&&data.prediction?.length===8192){
        this.mic=data.microphone;this.prediction=data.prediction;this.waiting=false;
      }
    };
  }
  process(inputs,outputs) {
    const output=outputs[0][0];output.fill(0);
    const frame=this.clock.advance(currentFrame,output.length);
    if(this.clock.gapFrames){
      this.filled=0;this.sinceSend=0;this.port.postMessage({type:'gap',expectedFrame:this.clock.expectedFrame,actualFrame:currentFrame});
    }
    const mic=inputs[0]?.[0],prediction=inputs[1]?.[0];
    for(let i=0;i<output.length;i++){
      this.rawHistory[this.index]=mic?.[i]||0;this.predictionHistory[this.index]=prediction?.[i]||0;
      this.index=(this.index+1)%8192;this.filled=Math.min(8192,this.filled+1);this.sinceSend++;
    }
    this.lastEnd=frame+output.length;
    if(!this.waiting&&this.filled===8192&&this.sinceSend>=1024){
      for(let i=0;i<8192;i++){
        const at=(this.index+i)%8192;this.mic[i]=this.rawHistory[at];this.prediction[i]=this.predictionHistory[at];
      }
      this.waiting=true;this.sinceSend=0;
      this.port.postMessage({microphone:this.mic,prediction:this.prediction,endTime:this.lastEnd/sampleRate,epoch:this.epoch,clock:this.clock.snapshot()},
        [this.mic.buffer,this.prediction.buffer]);
    }
    return true;
  }
}
registerProcessor('choir-echo-monitor',ChoirEchoMonitor);
