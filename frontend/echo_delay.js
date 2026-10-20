(function(root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./echo_cancellation.js') : root.ChoirEchoCancellation;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChoirEchoDelay = api;
})(globalThis, function(Core) {
  'use strict';
  const WINDOW = 8192, HOP = 1024, MAX_SHIFT_SEC = .020;
  function spectrum(input, size) {
    const re = new Float64Array(size), im = new Float64Array(size);
    re.set(input); Core.fft(re, im); return { re, im };
  }
  // Four-tap Lagrange interpolation. Near a buffer boundary use the causal
  // linear pair; no read outside the supplied history is allowed.
  function sample(input, position) {
    const i = Math.floor(position), f = position - i;
    if (f === 0) return input[i] || 0;
    if (i < 1 || i + 2 >= input.length) return (input[i] || 0) * (1-f) + (input[i+1] || 0) * f;
    return -f*(f-1)*(f-2)/6*input[i-1] + (f+1)*(f-1)*(f-2)/2*input[i]
      - (f+1)*f*(f-2)/2*input[i+1] + (f+1)*f*(f-1)/6*input[i+2];
  }
  function periodic(input, rate) {
    let mean = 0; for (const v of input) mean += v; mean /= input.length;
    const x = Float64Array.from(input, v => v-mean), sums = new Float64Array(x.length+1);
    for (let i=0;i<x.length;i++) sums[i+1] = sums[i]+x[i]*x[i];
    if (sums[x.length] < 1e-14) return false;
    const size = 2 ** Math.ceil(Math.log2(x.length*2)), s = spectrum(x, size);
    for(let i=0;i<size;i++){s.re[i]=s.re[i]**2+s.im[i]**2;s.im[i]=0;}
    Core.fft(s.re,s.im,true);
    for(let lag=Math.max(2,Math.floor(rate/1200));lag<=Math.min(x.length/2,Math.ceil(rate/50));lag++) {
      const denominator = Math.sqrt(sums[x.length-lag]*(sums[x.length]-sums[lag]));
      if(denominator>0&&s.re[lag]/denominator>.78)return true;
    }
    return false;
  }
  function broadband(input, rate) {
    const x = Float64Array.from(input,(v,i)=>v*(.5-.5*Math.cos(2*Math.PI*i/(input.length-1))));
    const s=spectrum(x,x.length),bands=new Float64Array(6);let total=0,largest=0;
    for(let k=Math.ceil(150*x.length/rate);k<x.length/2;k++){
      const frequency=k*rate/x.length;if(frequency>=9600)break;
      const power=s.re[k]**2+s.im[k]**2;bands[Math.floor(Math.log2(frequency/150))]+=power;
      total+=power;largest=Math.max(largest,power);
    }
    return total>0&&bands.filter(v=>v>total*.003).length>=4&&largest<total*.12&&!periodic(input,rate);
  }
  function independentBands(correlation,rate,margin,maxLag,candidate) {
    // Restore the weighted cross-spectrum. Agreement must come from three
    // disjoint frequency ranges, rather than one vocal fundamental.
    Core.fft(correlation.re,correlation.im);
    const size=correlation.re.length;
    for(const [low,high] of [[250,900],[900,2400],[2400,8000]]){
      const re=new Float64Array(size),im=new Float64Array(size);let power=0;
      for(let k=0;k<size;k++){
        const frequency=Math.min(k,size-k)*rate/size;
        if(frequency>=low&&frequency<high){re[k]=correlation.re[k];im[k]=correlation.im[k];power+=re[k]**2+im[k]**2;}
      }
      if(power<1e-15)return false;
      Core.fft(re,im,true);let at=margin-maxLag;
      for(let i=at+1;i<=margin+maxLag;i++)if(re[i]>re[at])at=i;
      if(at===margin-maxLag||at===margin+maxLag)return false;
      const denominator=re[at-1]-2*re[at]+re[at+1];
      const fraction=denominator ? .5*(re[at-1]-re[at+1])/denominator : 0;
      if(Math.abs(margin-at-fraction-candidate)>Math.max(1.5,rate*.00005))return false;
    }
    return true;
  }
  function coherentValidation(prediction,microphone,start,length,delta,rate) {
    for(let half=0;half<2;half++){
      const count=length/2,offset=start+half*count;
      const aligned=new Float64Array(count),old=new Float64Array(count),mic=new Float64Array(count);
      for(let j=0;j<count;j++){
        const weight=.5-.5*Math.cos(2*Math.PI*j/(count-1));
        aligned[j]=sample(prediction,offset+j-delta)*weight;old[j]=prediction[offset+j]*weight;mic[j]=microphone[offset+j]*weight;
      }
      const p=spectrum(aligned,count),previous=spectrum(old,count),y=spectrum(mic,count),entries=[];
      let total=0;
      for(let k=Math.ceil(150*count/rate);k<count/2&&k*rate/count<8000;k++)total+=p.re[k]**2+p.im[k]**2;
      for(let k=Math.ceil(150*count/rate);k<count/2&&k*rate/count<8000;k++){
        const power=p.re[k]**2+p.im[k]**2;
        if(power>total*.0005)entries.push({k,power,ratio:(p.re[k]*y.re[k]+p.im[k]*y.im[k])/power});
      }
      if(entries.length<16)return false;
      const ratios=entries.map(e=>e.ratio).sort((a,b)=>a-b),gain=ratios[Math.floor(ratios.length/2)];
      if(gain<.125||gain>8)return false;
      let retained=0,kept=0,error=0,oldError=0;const bands=new Set();
      for(const {k,power} of entries){
        const residual=(y.re[k]-gain*p.re[k])**2+(y.im[k]-gain*p.im[k])**2;
        if(residual>gain*gain*power*.25**2)continue;
        retained+=power;kept++;error+=residual;
        oldError+=(y.re[k]-gain*previous.re[k])**2+(y.im[k]-gain*previous.im[k])**2;
        bands.add(Math.floor(Math.log2(k*rate/count/150)));
      }
      // This mask belongs ONLY to the estimator. No microphone/pitch bins are
      // removed. Both independent time halves must retain broad evidence.
      if(kept<entries.length*.65||retained<total*.55||bands.size<4
        ||error>gain*gain*retained*.14**2||error>oldError*.5)return false;
    }
    return true;
  }
  function observation(prediction, microphone, rate, { noiseRms=0, validationDb=25 }={}) {
    const refuse=reason=>({usable:false,reason});
    if(prediction.length!==WINDOW||microphone.length!==WINDOW||![32000,44100,48000,96000].includes(rate)
      ||!prediction.every(Number.isFinite)||!microphone.every(Number.isFinite))return refuse('capture');
    const length=rate>=88000?4096:2048,maxLag=Math.round(MAX_SHIFT_SEC*rate),margin=maxLag+3;
    const start=WINDOW-margin-length,end=start+length;
    const p=prediction.subarray(start-margin,end+margin),y=microphone.subarray(start,end);
    let energy=0;for(const v of prediction.subarray(start,end))energy+=v*v;
    if(energy/length<1e-8)return refuse('weak');
    if(y.some(v=>Math.abs(v)>=.98))return refuse('clipping');
    if(!broadband(prediction.subarray(WINDOW-4096),rate))return refuse('narrow');
    const size=2**Math.ceil(Math.log2(p.length+length)),px=spectrum(p,size);
    const wy=Float64Array.from(y,(v,i)=>v*(.5-.5*Math.cos(2*Math.PI*i/(length-1)))),sy=spectrum(wy,size);
    let largest=0;
    for(let k=0;k<size;k++){
      const re=px.re[k]*sy.re[k]+px.im[k]*sy.im[k],im=px.im[k]*sy.re[k]-px.re[k]*sy.im[k];
      px.re[k]=re;px.im[k]=im;largest=Math.max(largest,Math.hypot(re,im));
    }
    for(let k=0;k<size;k++){
      const frequency=Math.min(k,size-k)*rate/size;
      const scale=frequency>=150&&frequency<9600?1/Math.max(Math.hypot(px.re[k],px.im[k]),largest*.001)**.7:0;
      px.re[k]*=scale;px.im[k]*=scale;
    }
    Core.fft(px.re,px.im,true);
    let at=margin-maxLag;
    for(let i=at+1;i<=margin+maxLag;i++)if(px.re[i]>px.re[at])at=i;
    if(at===margin-maxLag||at===margin+maxLag)return refuse('range');
    let competitor=0;const guard=Math.max(4,Math.round(rate/6000));
    for(let i=margin-maxLag;i<=margin+maxLag;i++)if(Math.abs(i-at)>guard)competitor=Math.max(competitor,px.re[i]);
    if(px.re[at]<=0||px.re[at]<competitor*1.3)return refuse('ambiguous');
    const denominator=px.re[at-1]-2*px.re[at]+px.re[at+1];
    const fraction=denominator ? .5*(px.re[at-1]-px.re[at+1])/denominator : 0;
    const deltaFrames=Math.round((margin-at-fraction)*8)/8;
    if(Math.abs(deltaFrames)<.25)return {usable:true,deltaFrames:0,residualRatio:null};
    const tolerance=Math.min(.16,Math.max(.045,10**(-validationDb/20)*1.7));
    const residual=new Float64Array(length);let residualEnergy=0,alignedEnergy=0,worst=0,strict=true;
    const gains=[];
    for(let half=0;half<2;half++){
      let pp=0,yy=0,py=0,oldPP=0,oldPY=0;
      for(let j=half*length/2;j<(half+1)*length/2;j++){
        const q=sample(prediction,start+j-deltaFrames),old=prediction[start+j],v=y[j];
        pp+=q*q;yy+=v*v;py+=q*v;oldPP+=old*old;oldPY+=old*v;
      }
      const gain=py/pp,oldGain=oldPY/oldPP,error=Math.max(0,yy-2*gain*py+gain*gain*pp);
      const oldError=Math.max(0,yy-2*oldGain*oldPY+oldGain*oldGain*oldPP);
      if(!Number.isFinite(gain)||gain<.125||gain>8)return refuse('double-talk-or-path');
      if(error>pp*gain*gain*tolerance*tolerance||error>oldError*.5)strict=false;
      gains.push(gain);worst=Math.max(worst,Math.sqrt(error/(pp*gain*gain)));
      for(let j=half*length/2;j<(half+1)*length/2;j++){
        const q=gain*sample(prediction,start+j-deltaFrames);residual[j]=y[j]-q;
        residualEnergy+=residual[j]**2;alignedEnergy+=q*q;
      }
    }
    if(Math.abs(gains[0]/gains[1]-1)>.10)return refuse('changing');
    // Noise cannot provide an unlimited exemption for a quiet periodic singer.
    const floor=Math.max(1e-12,Math.min(length*(2*noiseRms)**2,alignedEnergy*.0001));
    const voice=residualEnergy>floor&&periodic(residual,rate);
    if((!strict||voice)&&(!independentBands(px,rate,margin,maxLag,deltaFrames)
      ||!coherentValidation(prediction,microphone,start,length,deltaFrames,rate)))return refuse(voice?'voice':'double-talk-or-path');
    return {usable:true,deltaFrames,residualRatio:worst,observationLagFrames:margin,doubleTalkValidated:voice||!strict};
  }
  class Follower {
    constructor(minimum,maximum){this.minimum=minimum;this.maximum=maximum;this.reset();}
    reset(){this.candidate=null;this.count=0;this.lastEnd=null;}
    observe(value,endTime,current){
      if(!Number.isFinite(endTime)||(this.lastEnd!=null&&(endTime<=this.lastEnd||endTime-this.lastEnd>.25)))this.reset();
      this.lastEnd=endTime;
      const unchanged={changed:false,offsetFrames:current};
      if(!value.usable||!Number.isFinite(value.deltaFrames)||Math.abs(value.deltaFrames)<.25){this.candidate=null;this.count=0;return unchanged;}
      const target=Math.round((current+value.deltaFrames)*8)/8;
      if(target<this.minimum||target>this.maximum){this.candidate=null;this.count=0;return {...unchanged,reason:'range'};}
      if(this.candidate==null||Math.abs(target-this.candidate)>.375){this.candidate=target;this.count=1;return unchanged;}
      this.count++;
      if(this.count<2)return unchanged;
      this.candidate=null;this.count=0;return {changed:true,offsetFrames:target};
    }
  }
  class Retimer {
    constructor(maximum,initial=0){
      this.maximum=maximum;this.buffer=new Float32Array(Math.ceil(maximum)+4);this.write=0;
      this.current=initial;this.target=initial;this.fade=0;this.progress=0;
    }
    setDelay(target,fade=0){
      if(!Number.isFinite(target)||target<0||target>this.maximum||!Number.isSafeInteger(fade)||fade<0)return false;
      if(this.fade&&this.progress<this.fade)return false;
      this.target=target;this.progress=0;this.fade=fade;
      if(!fade)this.current=target;
      return true;
    }
    read(delay){
      const i=Math.floor(delay),f=delay-i,n=this.buffer.length;
      const at=age=>this.buffer[(this.write-age+n)%n];
      if(!f)return at(i);
      if(i<1)return at(i)*(1-f)+at(i+1)*f;
      return -f*(f-1)*(f-2)/6*at(i-1)+(f+1)*(f-1)*(f-2)/2*at(i)
        -(f+1)*f*(f-2)/2*at(i+1)+(f+1)*f*(f-1)/6*at(i+2);
    }
    process(input,output){
      for(let i=0;i<output.length;i++){
        this.buffer[this.write]=input?.[i]||0;
        if(this.fade&&this.progress<this.fade){
          const weight=++this.progress/this.fade;
          output[i]=this.read(this.current)*(1-weight)+this.read(this.target)*weight;
          if(this.progress===this.fade){this.current=this.target;this.fade=0;}
        }else output[i]=this.read(this.current);
        this.write=(this.write+1)%this.buffer.length;
      }
    }
  }
  function prepare(impulse,rate) {
    const full=Float32Array.from(impulse);let total=0,prefix=0,baseFrames=0;
    for(const value of full)total+=value*value;
    const maximum=Math.min(full.length-1,Math.round(rate*.032));
    // Remove at most -40 dB of impulse energy, then explicitly revalidate the
    // resulting model. This reserves causal headroom for negative corrections.
    while(baseFrames<maximum&&prefix+full[baseFrames]**2<=total*.0001){
      prefix+=full[baseFrames]**2;full[baseFrames++]=0;
    }
    return {impulse:full,baseFrames,removedEnergyFraction:total?prefix/total:0};
  }
  function prepareProfile(reference,microphone,profile,rate,compact=false) {
    if(!profile.usable)return profile;
    const prepared=prepare(profile.impulse,rate),from=Math.round((compact?3:4)*rate),to=Math.round((compact?7:11)*rate);
    const trainDb=Core.reduction(microphone.slice(from,to),Core.convolve(reference.slice(from,to),prepared.impulse));
    const validationDb=Core.reduction(microphone.slice(to),Core.convolve(reference.slice(to),prepared.impulse));
    const usable=trainDb>=15&&validationDb>=12&&Number.isFinite(trainDb)&&Number.isFinite(validationDb);
    return {...profile,usable,reason:usable?null:'validation',impulse:usable?prepared.impulse:null,
      trainDb,validationDb,retimeBaseFrames:prepared.baseFrames,retimeRemovedEnergyFraction:prepared.removedEnergyFraction};
  }
  return Object.freeze({WINDOW,HOP,MAX_SHIFT_SEC,observation,Follower,Retimer,sample,prepare,prepareProfile});
});
