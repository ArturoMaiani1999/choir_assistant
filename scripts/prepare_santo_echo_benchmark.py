"""Local real-MP3 reference mix + independently labelled synthetic singer.

This is not a reconstruction of the user's microphone recording.
The user's mixer levels are known; master volume and phone acoustics are not.
"""
import argparse, hashlib, json
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=ROOT/'artifacts/santo-research-2026-10-19/fixture')
    args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    source=ROOT/'dist/library-assets/santo-frisina';rate=48000;duration=70;n=rate*duration
    mixes={'accompaniment.mp3':.4,'voice-P1.mp3':.5,'voice-P2.mp3':.5,'voice-P3.mp3':1.,'voice-P4.mp3':.5}
    mixture=np.zeros(n);sources=[]
    for name,level in mixes.items():
        audio,sr=sf.read(source/name,dtype='float32',always_2d=True)
        mono=resample_poly(audio.mean(axis=1),160,147) if sr==44100 else audio.mean(axis=1)
        assert sr in [44100,48000]
        mixture[:min(n,len(mono))]+=mono[:n]*level*.62/np.sqrt(5)
        sources.append({'file':name,'sha256':hashlib.sha256((source/name).read_bytes()).hexdigest(),'level':level,'decodedSampleRate':sr})
    click=np.zeros(n);bpm=68;offset=.05
    for pulse in range(int(duration*bpm/60)+1):
        accented=pulse%4==0;f0=1120 if accented else 820;f1=760 if accented else 570
        peak=.3*(.5 if accented else .34);decay=.075 if accented else .055
        t=np.arange(round(.08*rate))/rate;k=np.log(f1/f0)/.045
        phase=np.where(t<=.045,f0*np.expm1(k*t)/k,f0*np.expm1(k*.045)/k+f1*(t-.045))
        sound=peak*np.exp(np.log(.0001/peak)*np.minimum(t/decay,1))*np.sin(2*np.pi*phase)
        start=round((pulse*60/bpm+offset)*rate)
        if start<n:click[start:min(n,start+len(sound))]+=sound[:max(0,min(len(sound),n-start))]
    score=json.loads((source/'score.json').read_text());events=[e for e in score['target_events'] if e['part_id']=='P3' and not e['is_rest']]
    truth=np.zeros(n);onset_age=np.zeros(n);distance_to_end=np.zeros(n)
    for e in events:
        start=round(e['onset_seconds']*rate);end=min(n,round((e['onset_seconds']+e['duration_seconds'])*rate))
        if start>=n:continue
        breath=min(.18,.14*e['duration_seconds']) if e['duration_seconds']>.6 else .025
        end=max(start,end-round(breath*rate))
        if end<=start:continue
        age=np.arange(end-start)/rate
        cents=-85*np.exp(-age/.032)+23*np.sin(2*np.pi*5.2*age)+7
        truth[start:end]=e['frequency_hz']*2**(cents/1200)
        onset_age[start:end]=age;distance_to_end[start:end]=(end-np.arange(start,end))/rate
    phase=np.cumsum(2*np.pi*truth/rate)
    envelope=np.minimum(1,onset_age/.025)*np.minimum(1,distance_to_end/.025)
    voice=.055*envelope*(np.sin(phase)+.4*np.sin(2*phase+.3)+.2*np.sin(3*phase+.8)+.1*np.sin(4*phase))
    # A deliberately wrong singer: detector correction must not pull this to score.
    wrong_truth=truth.copy();wrong_truth[(np.arange(n)/rate>=29)&(truth>0)]*=2**(95/1200)
    wrong_phase=np.cumsum(2*np.pi*wrong_truth/rate)
    wrong_voice=.055*envelope*(np.sin(wrong_phase)+.4*np.sin(2*wrong_phase+.3)+.2*np.sin(3*wrong_phase+.8))
    for name,data in [('music',mixture),('metronome',click),('voice',voice),('truth',truth),('wrong-voice',wrong_voice),('wrong-truth',wrong_truth)]:
        np.asarray(data,dtype='<f4').tofile(args.out/f'{name}.f32')
    metadata={'schemaVersion':1,'kind':'real-MP3-reference-plus-synthetic-singer','sampleRate':rate,'durationSec':duration,
        'sources':sources,'scoreVersion':score['score_version_id'],'metronome':{'level':.3,'bpm':bpm,'offsetSec':offset},
        'assumptions':['Master slider 62%, not reported by the user.','48 kHz mono reference; libsndfile decode + scipy polyphase SRC.',
            'No transpose, playback 100%; no real acoustic path or hardware volume measured.',
            'Singer F0 labels come from oscillator phase, not detector output or the expected note.',
            'Natural attack convergence, vibrato and shortened releases/breaths are synthesized.'],
        'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in args.out.glob('*.f32')}}
    (args.out/'manifest.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8');print(json.dumps({'fixture':str(args.out),'seconds':duration,'sources':sources}))
if __name__=='__main__':main()
