// Experimental observation-only refiner. Never modifies microphone PCM, voicing,
// confidence or score; no expected-note input. Not imported by production UI.
global.window ??= {};
require('../frontend/pitch_detector.js');
const Pitch=window.ChoirPitch;
function probe(frame,prediction,sampleRate,baseline,settings){
  if(!baseline.hz)return {hz:null,reason:'baseline-unvoiced'};
  let aa=0,ab=0,bb=0,ay=0,by=0,energy=0;
  for(let i=1;i<frame.length-1;i++){
    const a=prediction[i],b=(prediction[i+1]-prediction[i-1])/2,y=frame[i];
    aa+=a*a;ab+=a*b;bb+=b*b;ay+=a*y;by+=b*y;energy+=y*y;
  }
  const det=aa*bb-ab*ab;
  if(det<1e-18||aa<1e-8)return {hz:baseline.hz,reason:'weak-reference'};
  const a=(ay*bb-by*ab)/det,b=(by*aa-ay*ab)/det;
  if(Math.abs(a)>8||Math.abs(b)>128)return {hz:baseline.hz,reason:'unbounded-fit'};
  const residual=Float32Array.from(frame,(y,i)=>y-a*prediction[i]-b*((prediction[Math.min(frame.length-1,i+1)]-prediction[Math.max(0,i-1)])/2));
  const estimate=Pitch.detectPitch(residual,sampleRate,settings);
  if(!estimate.hz)return {hz:baseline.hz,reason:'fallback-preserves-mask'};
  return {hz:estimate.hz,clarity:estimate.clarity,baselineHz:baseline.hz,reason:'reference-projection',a,b};
}
module.exports={probe};
