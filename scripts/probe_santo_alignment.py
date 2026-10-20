"""Offline alignment ablation. Never uses score notes as an acoustic F0 label."""
import argparse,json
from pathlib import Path
import numpy as np
from scipy import signal
from analyze_echo_diagnostic import delay_probe,rms,corr

def shift_prediction(pred,shift):
    out=np.zeros(len(pred));
    if shift>=0:out[shift:]=pred[:len(pred)-shift] if shift else pred
    else:out[:shift]=pred[-shift:]
    return out

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',type=Path)
    p.add_argument('--quiet-intro-confirmed',action='store_true',help='User confirmed no singing during the introduction')
    args=p.parse_args();folder=args.folder
    m=json.loads((folder/'manifest.json').read_text())['metadata'];sr=m['sampleRate']
    raw=np.fromfile(folder/'microphone-raw.f32',dtype='<f4').astype(float);pred=np.fromfile(folder/'echo-prediction-unscaled.f32',dtype='<f4').astype(float)
    current=np.fromfile(folder/'microphone-processed.f32',dtype='<f4').astype(float)
    # Disjoint intervals selected before fitting. The user may confirm the intro label.
    train=slice(2*sr,10*sr);check=slice(10*sr,16*sr)
    shift=delay_probe(pred[train],raw[train],sr)['lagSamples'];aligned=shift_prediction(pred,shift)
    gain=float(np.dot(raw[train],aligned[train])/np.dot(aligned[train],aligned[train]));corrected=raw-gain*aligned
    # A tiny reference-only postfilter learned on intro, never during singing.
    # Two FIR paths distinguish constant delay from residual coloration/limiting.
    taps=np.array([-16,-8,-4,-2,-1,0,1,2,4,8,16]);step=8
    indexes=np.arange(2*sr,10*sr,step)
    design=np.column_stack([aligned[indexes-t] for t in taps]);target=raw[indexes]
    coef=np.linalg.solve(design.T@design+np.eye(len(taps))*np.trace(design.T@design)*1e-6,design.T@target)
    colored=sum(c*shift_prediction(aligned,int(t)) for c,t in zip(coef,taps));colored_clean=raw-colored
    outputs={'delay-only':raw-aligned,'delay-gain':corrected,'delay-color':colored_clean}
    for name,values in outputs.items():values.astype('<f4').tofile(folder/(name+'.f32'))
    intervals=[]
    for label,a,b in [('train-quiet-intro',2,10),('validation-quiet-intro',10,16),('voice-mixture',18,42),('later-pause-candidate',42,44),('voice-later',44,58)]:
        s=slice(int(a*sr),int(b*sr));before=rms(raw[s]);row={'label':label,'from':a,'to':b,'rawRms':before,'currentRms':rms(current[s]),
          'currentReductionDb':20*np.log10(before/rms(current[s])),'alignedCorrelation':corr(raw[s],aligned[s])}
        for name,values in outputs.items():row[name]={'rms':rms(values[s]),'reductionDb':20*np.log10(before/rms(values[s]))}
        intervals.append(row)
    # Match callback RMS to the recorded processed channel to audit bridge timing.
    energy=np.r_[0,np.cumsum(current*current)]
    samples=[f for f in m['pitchFrames'] if f.get('running') and 2<f['contextTime']<59 and f.get('rms',0)>0]
    timings=[]
    for offset in range(-256,9601,32):
        end=np.round(np.array([f['contextTime'] for f in samples])*sr).astype(int)-offset
        valid=(end>=2048)&(end<len(current));end=end[valid]
        calculated=np.sqrt((energy[end]-energy[end-2048])/2048);expected=np.array([f['rms'] for f in samples])[valid]
        error=float(np.median(np.abs(np.log(np.maximum(calculated,1e-8)/expected))))
        timings.append((error,offset))
    timings.sort();best=timings[0]
    report={'kind':'real-recording-offline-ablation','source':m['createdAt'],'sampleRate':sr,
      'trainIntervalSec':[2,10],'validationIntervalSec':[10,16],
      'quietIntroConfirmedByUser':args.quiet_intro_confirmed,
      'labelWarning':'User confirmed silent introduction.' if args.quiet_intro_confirmed else 'Intro assumed not sung, pending confirmation.',
      'metricWarning':'Singing-region residual energy is not an F0 accuracy metric.',
      'shiftSamples':shift,'shiftMs':1000*shift/sr,'gain':gain,'colorTaps':taps.tolist(),'colorCoefficients':coef.tolist(),
      'callbackBestRmsEndLagSamples':best[1],'callbackBestRmsEndLagMs':best[1]/sr*1000,'callbackMedianLogRmsError':best[0],
      'callbackTimingCandidates':timings[:8],'intervals':intervals,'sameVoicingMask':'Only existing live admitted frames may be corrected; no corrected voicing decision adopted.'}
    (folder/'alignment-ablation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))

if __name__=='__main__':main()
