// currentFrame can lag behind rendered PCM during Chromium graph contention.
// Count callbacks; keep stale timestamps as telemetry, never as missing audio.
// A forward jump still breaks continuity. Context suspension is handled by the
// owner: callback counting cannot detect losses upstream of the audio graph.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ChoirAudioSampleClock=api;})(globalThis,function(){
  'use strict';
  class SampleClock {
    constructor(){this.nextFrame=null;this.skewCount=0;this.maxLagFrames=0;this.forwardGaps=0;this.processedFrames=0;}
    advance(observedFrame,frames){
      this.observedFrame=observedFrame;
      this.expectedFrame=this.nextFrame??observedFrame;
      this.gapFrames=Math.max(0,observedFrame-this.expectedFrame);
      const lag=Math.max(0,this.expectedFrame-observedFrame);
      if(lag){this.skewCount++;this.maxLagFrames=Math.max(this.maxLagFrames,lag);}
      if(this.gapFrames)this.forwardGaps++;
      const frame=Math.max(this.expectedFrame,observedFrame);
      this.nextFrame=frame+frames;this.processedFrames+=frames;
      return frame;
    }
    snapshot(){return {timebase:'processed-samples',nextFrame:this.nextFrame,observedFrame:this.observedFrame,
      processedFrames:this.processedFrames,skewCount:this.skewCount,maxLagFrames:this.maxLagFrames,forwardGaps:this.forwardGaps};}
  }
  return Object.freeze({SampleClock});
});
