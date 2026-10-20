"""Export a reproducible scientific figure of an actual diagnostic, without scoring the singer."""
import argparse,json
from pathlib import Path
import numpy as np
from scipy import signal
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

def main():
    p=argparse.ArgumentParser();p.add_argument('folder',type=Path);args=p.parse_args();folder=args.folder
    audit=json.loads((folder/'acoustic-audit.json').read_text());alignment=json.loads((folder/'alignment-ablation.json').read_text());replay=json.loads((folder/'pitch-replay.json').read_text())
    sr=audit['sampleRate'];raw=np.fromfile(folder/'microphone-raw.f32',dtype='<f4');pred=np.fromfile(folder/'echo-prediction-unscaled.f32',dtype='<f4');processed=np.fromfile(folder/'microphone-processed.f32',dtype='<f4');clean=np.fromfile(folder/'delay-gain.f32',dtype='<f4')
    fig,axes=plt.subplots(4,1,figsize=(13,13),layout='constrained');fig.suptitle('Santo · diagnosi del rientro sul telefono\nDati reali, confronto offline; nessuna nota dello spartito usata per correggere il segnale',fontsize=14)
    start=4*sr;length=int(.09*sr);t=np.arange(length)/sr*1000
    for y,name,color in [(raw,'Microfono','#444444'),(pred,'Previsione attuale','#d65f3b'),(np.r_[pred[1196:],np.zeros(1196)]*alignment['gain'],'Previsione riallineata ×1,324','#008e99')]:
        axes[0].plot(t,y[start:start+length],label=name,color=color,linewidth=1,alpha=.85)
    axes[0].set(title='Nell’introduzione, la previsione diventa coerente solo anticipandola di 24,92 ms',xlabel='Tempo nella finestra (ms)',ylabel='Ampiezza');axes[0].legend(loc='upper right')
    ws=audit['windows'];axes[1].plot([w['startSec']+1 for w in ws],[w['predictionToRaw']['lagMs'] for w in ws],'.-',color='#008e99');axes[1].set(xlabel='Tempo registrato (s)',ylabel='Ritardo microfono rispetto\nalla previsione (ms)',title='Scarto stabile durante tutta la prova; il primo intervallo include l’avvio');axes[1].set_ylim(-75,5)
    hop=480;tt=np.arange(len(raw)//hop)*hop/sr
    for y,name,color in [(raw,'Microfono grezzo','#777777'),(processed,'Trattamento attuale','#d65f3b'),(clean,'Solo ritardo + gain corretti offline','#008e99')]:
        yy=y[:len(tt)*hop].reshape(-1,hop);db=20*np.log10(np.maximum(np.sqrt(np.mean(yy.astype(float)**2,axis=1)),1e-6));axes[2].plot(tt,db,label=name,color=color,linewidth=.8,alpha=.85)
    axes[2].axvspan(2,10,color='#777777',alpha=.08,label='Stima (2–10 s)');axes[2].axvspan(10,16,color='#008e99',alpha=.1,label='Verifica separata (10–16 s)');axes[2].set(xlabel='Tempo registrato (s)',ylabel='Livello RMS (dBFS)',title='La correzione è stimata solo nell’introduzione, poi congelata');axes[2].legend(loc='upper right',fontsize=8,ncol=2)
    rows=[r for r in replay['rows'] if r['admitted']];times=[r['t'] for r in rows]
    for key,name,color,size in [('liveHz','Pitch live','#d65f3b',5),('delayGain','Ipotesi dopo riallineamento','#008e99',3)]:
        axes[3].scatter(times,[69+12*np.log2(r[key]/440) for r in rows],s=size,label=name,color=color,alpha=.6)
    axes[3].set(xlabel='Tempo registrato (s)',ylabel='Altezza MIDI',ylim=(40,76),title='Stessa maschera di rilevamento: nessun frame ammesso viene eliminato o aggiunto');axes[3].legend(loc='upper right')
    for ax in axes:ax.grid(alpha=.18)
    fig.savefig(folder/'diagnosi-rientro.png',dpi=155);fig.savefig(folder/'diagnosi-rientro.pdf');plt.close(fig)
    # Inspect the two measures reported by the user against spectra, not a score oracle.
    fig,axes=plt.subplots(2,2,figsize=(14,8),layout='constrained')
    for row,(a,b,label) in enumerate([(28.2,30.2,'Battuta 9'),(56.4,59.9,'Battuta 17')]):
        for col,(y,title) in enumerate([(processed,'Trattamento attuale'),(clean,'Riallineamento offline')]):
            f,t,s=signal.spectrogram(y[int(a*sr):int(b*sr)],sr,nperseg=4096,noverlap=3584,scaling='spectrum')
            choose=(f>=100)&(f<=1100);axes[row,col].pcolormesh(a+t,f[choose],10*np.log10(np.maximum(s[choose],1e-12)),shading='auto',vmin=-65,vmax=-22,cmap='magma')
            selected=[r for r in rows if a<=r['t']<b];key='liveHz' if col==0 else 'delayGain';axes[row,col].scatter([r['t'] for r in selected],[r[key] for r in selected],s=6,color='cyan',label='F0 (stessi frame ammessi)')
            axes[row,col].set(title=f'{label} · {title}',xlabel='Tempo registrato (s)',ylabel='Frequenza (Hz)',ylim=(100,1100));axes[row,col].legend(fontsize=8,loc='upper right')
    fig.suptitle('Spettro armonico e pitch rilevato · nessuna verità F0 isolata disponibile');fig.savefig(folder/'battute-9-17.png',dpi=155);plt.close(fig)
    # Agreement to score is context only, not a measurement of vocal accuracy.
    summary=[]
    for name,a,b in [('B9-sostegno',28.55,29.75),('B17-finestra-comprende-rilascio',56.8,59.6),('B17-sostegno-esplorativo',57.0,59.1)]:
        chosen=[r for r in rows if a<=r['t']<b];variants={}
        for key in ['liveHz','currentRawOnMask','raw','delayOnly','delayGain','delayColor']:
            values=np.array([r[key] for r in chosen]);cents=1200*np.log2(values/195.99771799087463)
            variants[key]={'frames':len(values),'medianHz':float(np.median(values)),'medianCentsVsScore':float(np.median(cents)),
                'aboveTarget100c':int(np.sum(cents>100)),'belowTarget100c':int(np.sum(cents<-100)),
                'p95AbsoluteCentsVsScore':float(np.percentile(np.abs(cents),95))}
        summary.append({'segment':name,'from':a,'to':b,'comparisonOnly':'Score agreement, not independent acoustic truth. Note target never enters estimator.','variants':variants})
    (folder/'measure-context.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary))

if __name__=='__main__':main()
