"""Read-only acoustic audit of synchronized diagnostic channels; no F0 ground-truth claim."""
import argparse,json
from pathlib import Path
import numpy as np
from scipy import signal

def rms(x):return float(np.sqrt(np.mean(np.asarray(x,dtype=float)**2))) if len(x) else 0.
def corr(x,y):
    denominator=np.linalg.norm(x)*np.linalg.norm(y)
    return float(np.dot(x,y)/denominator) if denominator>0 else 0.
def delay_probe(x,y,sr,max_ms=250):
    # Positive lag means y arrives later than x. Estimate from phase, not note labels.
    cc=signal.correlate(y,x,mode='full',method='fft');lags=signal.correlation_lags(len(y),len(x))
    select=np.abs(lags)<=round(max_ms*sr/1000);at=np.flatnonzero(select)[np.argmax(np.abs(cc[select]))];lag=int(lags[at])
    xx=x[:len(x)-lag] if lag>=0 else x[-lag:];yy=y[lag:] if lag>=0 else y[:len(y)+lag]
    return {'lagSamples':lag,'lagMs':lag/sr*1000,'correlation':corr(xx,yy),'gain':float(np.dot(xx,yy)/max(1e-30,np.dot(xx,xx)))}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',type=Path);args=p.parse_args()
    manifest=json.loads((args.folder/'manifest.json').read_text(encoding='utf-8'));meta=manifest['metadata'];sr=meta['sampleRate']
    channels=[np.fromfile(args.folder/(name+'.f32'),dtype='<f4').astype(float) for name in meta['channelNames']]
    raw,ref,processed,pred=channels
    windows=[]
    for start in np.arange(0,len(raw)/sr-1.999,2.):
        a,b=round(start*sr),round((start+2)*sr);x=raw[a:b];y=pred[a:b];z=processed[a:b]
        g=float(np.dot(x,y)/max(1e-30,np.dot(y,y)))
        windows.append({'startSec':float(start),'endSec':float(start+2),'rms':[rms(c[a:b]) for c in channels],
          'rawPredictionCorrelation':corr(x,y),'bestScalar':g,'processedToRawDb':20*np.log10(max(1e-30,rms(z))/max(1e-30,rms(x))),
          'predictionToRaw':delay_probe(y,x,sr),'referenceToRaw':delay_probe(ref[a:b],x,sr)})
    frames=meta['pitchFrames'];known=[f for f in frames if f.get('contextTime') is not None and 0<=f['contextTime']<60]
    offsets=[(f['contextTime'],f['beat']*60/68-f['contextTime']) for f in known if f.get('running')]
    echo=meta['echo'];impulse=np.asarray(echo['impulse']);peak=int(np.argmax(np.abs(impulse)))
    summary={'sourceSha256':manifest['sourceSha256'],'durationSec':len(raw)/sr,'sampleRate':sr,
      'mixer':meta['mixer'],'echo':{k:v for k,v in echo.items() if k!='impulse'},'modelPeakSamples':peak,'modelPeakMs':peak/sr*1000,
      'modelImpulseEnergy':float(np.dot(impulse,impulse)),'rms':dict(zip(meta['channelNames'],map(rms,channels))),
      'processedMinusRawPlusPredictionRms':rms(processed-raw+pred),'maximumSamples':dict(zip(meta['channelNames'],[float(np.max(np.abs(c))) for c in channels])),
      'overOneSamples':dict(zip(meta['channelNames'],[int(np.sum(np.abs(c)>=1)) for c in channels])),
      'pitchFrames':len(frames),'acceptedFrames':sum(f.get('trackedHz') is not None for f in frames),
      'beatTimeOffsetSec':{'median':float(np.median([v for _,v in offsets])),'minimum':float(min(v for _,v in offsets)),'maximum':float(max(v for _,v in offsets))},
      'windows':windows,'labelWarning':'Score onset and user report are contextual labels, not isolated vocal F0 ground truth.'}
    (args.folder/'acoustic-audit.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in summary.items() if k!='windows'}))
    for w in windows:print(json.dumps(w))

if __name__=='__main__':main()
