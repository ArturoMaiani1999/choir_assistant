"""Measure simultaneous media channels in the actual mixer, without a microphone.

Every channel plays the same local synthetic pulse WAV. A single worklet
captures all channels before output gain, so comparisons measure PCM alignment
instead of trusting HTMLMediaElement.currentTime. Physical output stays muted.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request

import numpy as np
from scipy.signal import correlate, correlation_lags
import websocket
from browser_practice_smoke import CHROME, command, evaluate
from probe_android_calibration import export_array

OUT = Path(__file__).resolve().parents[1] / 'artifacts/mix-sync'

PROBE = r"""(async()=>{
 const media=[els.backingAudio,...state.voiceStemAudio.values()];
 const metronome=METRONOME;
 state.attemptActive=false;els.metronomeVolume.value=metronome?'30':'0';state.playbackMixer.muteForCalibration(true);
 await state.playbackMixer.resume(media);const ctx=state.playbackMixer.context,sr=ctx.sampleRate;
 const length=sr*9,bytes=new ArrayBuffer(44+length*2),v=new DataView(bytes);
 const text=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
 text(0,'RIFF');v.setUint32(4,36+length*2,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);
 v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);
 v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,length*2,true);
 const period=metronome?state.runtime.secondsAtBeat(1)-state.runtime.secondsAtBeat(0):.47;
 for(let i=0;i<length;i++){const t=i/sr,phase=t%period,sample=phase<.04?.5*Math.sin(2*Math.PI*(370*phase+3000*phase*phase))*Math.sin(Math.PI*phase/.04):0;v.setInt16(44+i*2,Math.round(sample*32767),true)}
 const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
 for(const a of media){a.src=url;a.load()}
 await Promise.all(media.map(a=>waitForMediaReady(a,3)));
 for(const a of media)a.currentTime=1.1;
 await Promise.all(media.map(a=>waitForMediaSeek(a)));
 const code=`class MixSyncCapture extends AudioWorkletProcessor{
 constructor(){super();this.n=0;this.channels=Array.from({length:${media.length+(metronome?1:0)}},()=>new Float32Array(sampleRate*3));}
 process(inputs,outputs){if(this.n>=this.channels[0].length)return true;
 const size=Math.min(outputs[0][0].length,this.channels[0].length-this.n);
 for(let c=0;c<this.channels.length;c++)if(inputs[c]?.[0])this.channels[c].set(inputs[c][0].subarray(0,size),this.n);
 this.n+=size;if(this.n===this.channels[0].length)this.port.postMessage({pcm:this.channels.map(c=>c.buffer)},this.channels.map(c=>c.buffer));return true;}}
 registerProcessor('mix-sync-capture',MixSyncCapture);`;
 const workletUrl=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
 await ctx.audioWorklet.addModule(workletUrl);URL.revokeObjectURL(workletUrl);
 const capture=new AudioWorkletNode(ctx,'mix-sync-capture',{numberOfInputs:media.length+(metronome?1:0),numberOfOutputs:1,channelCount:1,channelCountMode:'explicit'});
 const silent=ctx.createGain();silent.gain.value=0;capture.connect(silent).connect(ctx.destination);
 media.forEach((a,i)=>state.playbackMixer.channels.get(a).source.connect(capture,0,i));
 const connect=AudioNode.prototype.connect;
 if(metronome)AudioNode.prototype.connect=function(destination,...args){
   if(this instanceof OscillatorNode&&this.context===ctx)connect.call(destination,capture,0,media.length);
   if(destination===ctx.destination)return connect.call(this,silent,...args);
   return connect.call(this,destination,...args);
 };
 let timer;
 const done=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('capture deadline')),6000);
 capture.port.onmessage=({data})=>{window.mixSyncPcm=data.pcm.map(b=>new Float32Array(b));clearTimeout(timer);resolve()};});
 const clocks=[];const poll=setInterval(()=>clocks.push(media.map(a=>a.currentTime)),17);
 try{await state.clock.play();render();await done;}
 finally{AudioNode.prototype.connect=connect;clearTimeout(timer);clearInterval(poll);state.clock.pause();pauseVoiceStems();
 media.forEach(a=>state.playbackMixer.channels.get(a).source.disconnect(capture));capture.disconnect();silent.disconnect();URL.revokeObjectURL(url)}
 return {sampleRate:sr,channels:media.length+(metronome?1:0),clocks,metronome,period};
})()"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:5173/?piece=santo-frisina&part=P3')
    parser.add_argument('--output', type=Path, default=OUT / 'baseline.json')
    parser.add_argument('--asset-onsets', action='store_true', help='Inspect decoded score-aligned attacks in the original musical files')
    parser.add_argument('--metronome', action='store_true', help='Capture the shared-graph click beside the reference pulse track')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='choir-mix-sync-', ignore_cleanup_errors=True) as profile:
        process = subprocess.Popen([str(CHROME), '--headless=new', '--disable-gpu', '--autoplay-policy=no-user-gesture-required',
                                    '--remote-allow-origins=*', '--remote-debugging-port=0', f'--user-data-dir={profile}', args.url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / 'DevToolsActivePort'
            for _ in range(120):
                try:
                    port = port_file.read_text().splitlines()[0]
                    break
                except (OSError, IndexError):
                    time.sleep(.05)
            pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            socket = websocket.create_connection(next(p for p in pages if p['type']=='page')['webSocketDebuggerUrl'], timeout=25)
            for _ in range(160):
                evaluate(socket, 1, "document.querySelector('#piece-picker-dialog[open] [data-preferred-voice=tenore]:not(:disabled)')?.click()")
                if evaluate(socket, 2, "typeof state!=='undefined'&&!!state.clock&&state.voiceStemAudio.size===4"):
                    break
                time.sleep(.1)
            else:
                raise RuntimeError('Expected master and four SATB channels')
            if args.asset_onsets:
                result = evaluate(socket, 3, r"""(async()=>{
                  const ctx=new AudioContext({sampleRate:48000}),score=await(await fetch(state.bundleManifest.assets.score)).json();
                  const checks=[];
                  try{for(const [part,audio] of [['P5',els.backingAudio],...state.voiceStemAudio]){
                    const b=await ctx.decodeAudioData(await(await fetch(audio.currentSrc)).arrayBuffer()),pcm=b.getChannelData(0);
                    const notes=score.target_events.filter(e=>e.part_id===part&&!e.is_rest&&Number.isFinite(e.midi_pitch));
                    let previousEnd=-1;const attacks=[];
                    for(const n of notes){
                      if(n.onset_seconds>previousEnd+.15&&attacks.length<8){
                        const start=Math.max(0,Math.round((n.onset_seconds-.15)*b.sampleRate)),end=Math.min(pcm.length,Math.round((n.onset_seconds+.6)*b.sampleRate));
                        let peak=0;for(let i=start;i<end;i++)peak=Math.max(peak,Math.abs(pcm[i]));
                        const crossings={};for(const fraction of [.01,.05,.2]){let at=start;while(at<end&&Math.abs(pcm[at])<peak*fraction)at++;crossings[fraction]=(at/b.sampleRate-n.onset_seconds)*1000;}
                        attacks.push({scoreSeconds:n.onset_seconds,peak,crossingsMs:crossings});
                      }
                      previousEnd=Math.max(previousEnd,n.onset_seconds+n.duration_seconds);
                    }
                    checks.push({part,frames:b.length,duration:b.duration,attacks});
                  }}finally{await ctx.close()}return {checks,scope:'Decoded file attacks relative to score, no playback or hardware measurement'};
                })()""")
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
                print(json.dumps(result));return
            result = evaluate(socket, 3, PROBE.replace('METRONOME', json.dumps(args.metronome)))
            pcm = [export_array(socket, f'mixSyncPcm[{i}]') for i in range(result['channels'])]
            assert all(np.max(np.abs(channel))>.01 for channel in pcm), 'Expected a captured signal on every channel'
            rate = result['sampleRate']; reference = pcm[0][::6]; rows=[]
            for i, channel in enumerate(pcm[1:5], 1):
                signal = channel[::6]
                corr=correlate(signal,reference,mode='full',method='fft');lags=correlation_lags(len(signal),len(reference))
                mask=np.abs(lags)<rate/6*.15;offset=int(lags[mask][np.argmax(corr[mask])])
                rows.append({'channel':i,'delayVsMasterMs':offset/(rate/6)*1000,
                             'maxReportedDriftMs':max(abs(c[i]-c[0])*1000 for c in result['clocks'])})
                assert abs(rows[-1]['delayVsMasterMs'])<=2, rows[-1]
            result['alignment']=rows
            if args.metronome:
                def attacks(signal):
                    active=np.flatnonzero(np.abs(signal)>np.max(np.abs(signal))*.03)
                    return active[np.r_[True,np.diff(active)>.15*rate]]/rate
                music=attacks(pcm[0]);clicks=attacks(pcm[-1])
                result['clickOffsetsMs']=[float((click-music[np.argmin(abs(music-click))])*1000) for click in clicks if len(music) and np.min(abs(music-click))<.25]
                assert len(result['clickOffsetsMs'])>=2, result
                assert max(abs(d) for d in result['clickOffsetsMs'])<40, result['clickOffsetsMs']
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
            print(json.dumps({'alignment':rows,'sampleRate':rate,'clickOffsetsMs':result.get('clickOffsetsMs')}))
        finally:
            if socket:
                socket.close()
            process.terminate();process.wait(timeout=5)


if __name__=='__main__':
    main()
