"""Silent synthetic test of the MediaStream bridge; no microphone or phone.

Records one 220 Hz oscillator directly, through a same-context MediaStream,
and through a second context, simultaneously. Keeps PCM for independent
analysis. All physical playback is muted; this does not measure room AEC.
"""
import argparse
from contextlib import closing
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import urllib.request

import numpy as np
import websocket
from browser_audio_quantum_probe import Handler
from browser_practice_smoke import CHROME,command,evaluate
from probe_android_calibration import export_array

CAPTURE=r"""(async()=>{
  const duration=__DURATION__,stress=__STRESS__,a=new AudioContext({sampleRate:48000}),b=new AudioContext({sampleRate:48000});
  const p=window.bridgeProbe={buffers:[],conditions:[],contexts:[a,b]};
  await Promise.all([a.resume(),b.resume()]);
  await Promise.all([a.audioWorklet.addModule('/capture.js'),b.audioWorklet.addModule('/capture.js')]);
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/pitch_detector.js';s.onload=resolve;s.onerror=reject;document.head.append(s)});
  const osc=a.createOscillator(),gain=a.createGain(),stream=a.createMediaStreamDestination();
  osc.frequency.value=220;gain.gain.value=.03;stream.channelCount=1;
  osc.connect(gain);gain.connect(stream);
  const same=a.createMediaStreamSource(stream.stream),other=b.createMediaStreamSource(stream.stream);
  const silence=ctx=>{const n=ctx.createGain();n.gain.value=0;n.connect(ctx.destination);return n};
  const sinkA=silence(a),sinkB=silence(b);gain.connect(sinkA);
  const record=(ctx,sources,names,sink)=>new Promise(resolve=>{
    const startFrame=Math.ceil((ctx.currentTime+1)*ctx.sampleRate/128)*128;
    const node=new AudioWorkletNode(ctx,'choir-echo-diagnostic',{numberOfInputs:4,numberOfOutputs:1,
      channelCount:1,channelCountMode:'explicit',outputChannelCount:[1],
      processorOptions:{startFrame,maximumFrames:Math.round(duration*ctx.sampleRate)}});
    sources.forEach((s,i)=>s.connect(node,0,i));node.connect(sink);
    const chunks=[];let done=false;
    const checks=sources.map(source=>{
      const analyser=ctx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=0;
      source.connect(analyser);analyser.connect(sink);
      return {source,analyser,buffer:new Float32Array(2048),rows:[],badWindows:[]};
    });
    const sampleTimer=setInterval(()=>{
      if(ctx.currentTime<startFrame/ctx.sampleRate)return;
      for(const c of checks){
        c.analyser.getFloatTimeDomainData(c.buffer);
        const r=ChoirPitch.detectPitch(c.buffer,ctx.sampleRate,{rmsThreshold:0,yinThreshold:.42});
        const cents=r.hz?1200*Math.log2(r.hz/220):null;
        c.rows.push({time:ctx.currentTime,hz:r.hz||null,cents});
        if((cents===null||Math.abs(cents)>10)&&c.badWindows.length<16)c.badWindows.push(Array.from(c.buffer));
      }
    },17);
    const finish=error=>{
      if(done)return;done=true;clearTimeout(timer);clearInterval(sampleTimer);
      const frames=chunks.reduce((n,c)=>n+c.valid,0);
      for(let channel=0;channel<sources.length;channel++){
        const pcm=new Float32Array(frames);let offset=0;
        for(const c of chunks){pcm.set(c.channels[channel].subarray(0,c.valid),offset);offset+=c.valid}
        p.buffers.push(pcm);p.conditions.push({name:names[channel],sampleRate:ctx.sampleRate,frames,error:error||null,
          clock:chunks.at(-1)?.clock||null,originFrame:startFrame,analyser:checks[channel].rows,
          analyserBadWindows:checks[channel].badWindows});
      }
      for(const c of checks){c.source.disconnect(c.analyser);c.analyser.disconnect()}
      sources.forEach(s=>s.disconnect(node));node.disconnect();node.port.onmessage=null;node.port.close();resolve();
    };
    const timer=setTimeout(()=>finish('deadline'),(duration+5)*1000);
    node.onprocessorerror=()=>finish('processor-error');
    node.port.onmessage=({data})=>{if(data.valid)chunks.push(data);if(data.error)finish(data);else if(data.done)finish()};
  });
  let mutations=0;
  const churn=stress?setInterval(()=>{
    for(let i=0;i<100;i++){const n=a.createGain();gain.connect(n);n.connect(a.destination);gain.disconnect(n);n.disconnect();mutations++;}
  },10):null;
  osc.start();
  try{await Promise.all([record(a,[gain,same],['direct','same-context-bridge'],sinkA),
    record(b,[other],['second-context-bridge'],sinkB)])}
  finally{clearInterval(churn);osc.stop();osc.disconnect();gain.disconnect();same.disconnect();other.disconnect();
    sinkA.disconnect();sinkB.disconnect();stream.stream.getTracks().forEach(t=>t.stop());
    await Promise.all([a.close(),b.close()])}
  return {frequency:220,amplitude:.03,duration,stress,mutations,conditions:p.conditions};
})()"""

DETECT=r"""
const fs=require('node:fs');global.window={};require(process.argv[1]);
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),b=fs.readFileSync(p.pcm);
const pcm=new Float32Array(b.buffer,b.byteOffset,b.length/4),rows=[];
for(let at=0;at+2048<=pcm.length;at+=1024){
 const x=pcm.subarray(at,at+2048),r=window.ChoirPitch.detectPitch(x,p.rate,{rmsThreshold:0,yinThreshold:.42});
 rows.push({time:at/p.rate,hz:r.hz||null,rms:Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length)});
}
process.stdout.write(JSON.stringify(rows));
"""

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--duration',type=float,default=15)
    parser.add_argument('--stress-graph',action='store_true')
    parser.add_argument('--output',type=Path,default=Path('artifacts/audio-bridge/probe-1'))
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=False)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='bridge-probe-') as profile:
        chrome=subprocess.Popen([str(CHROME),'--headless=new','--mute-audio','--disable-gpu',
            '--autoplay-policy=no-user-gesture-required','--remote-allow-origins=*',
            '--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            portfile=Path(profile)/'DevToolsActivePort'
            for _ in range(100):
                if portfile.exists():break
                time.sleep(.05)
            port=portfile.read_text().splitlines()[0]
            pages=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            page=next(p for p in pages if p.get('type')=='page')
            with closing(websocket.create_connection(page['webSocketDebuggerUrl'],timeout=60)) as socket:
                (args.output/'browser.json').write_text(json.dumps(command(socket,1,'Browser.getVersion'),indent=2))
                command(socket,2,'Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/'});time.sleep(.3)
                result=evaluate(socket,3,CAPTURE.replace('__DURATION__',str(args.duration)).replace('__STRESS__',json.dumps(args.stress_graph)))
                arrays={}
                for i,c in enumerate(result['conditions']):
                    pcm=export_array(socket,f'bridgeProbe.buffers[{i}]');arrays[c['name']]=pcm
                    raw=args.output/(c['name']+'.f32');pcm.astype('<f4').tofile(raw)
                    params=args.output/(c['name']+'-params.json');params.write_text(json.dumps({'pcm':str(raw.resolve()),'rate':c['sampleRate']}))
                    rows=json.loads(subprocess.run(['node','-e',DETECT,str(Path('frontend/pitch_detector.js').resolve()),str(params)],check=True,capture_output=True,text=True).stdout)
                    hz=np.asarray([r['hz'] for r in rows if r['hz']]);cents=1200*np.log2(hz/220)
                    c.update({'windows':len(rows),'voicedWindows':len(hz),'medianHz':float(np.median(hz)) if len(hz) else None,
                        'outside10Cents':int(np.count_nonzero(np.abs(cents)>10)),
                        'maxAbsCents':float(np.max(np.abs(cents))) if len(hz) else None,'detectorFrames':rows,
                        'analyserWindows':len(c['analyser']),'analyserOutside10Cents':sum(r['cents'] is None or abs(r['cents'])>10 for r in c['analyser'])})
                np.savez_compressed(args.output/'pcm.npz',**arrays)
                result['limits']='Synthetic simultaneous paths; no acoustic AEC, no OS microphone input. Different contexts have independent capture origins.'
                (args.output/'result.json').write_text(json.dumps(result,indent=2))
                print(json.dumps([{k:v for k,v in c.items() if k not in ('detectorFrames','analyser','analyserBadWindows')} for c in result['conditions']],indent=2))
        finally:
            chrome.terminate()
            try:chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:chrome.kill();chrome.wait()
            server.shutdown();server.server_close()

if __name__=='__main__':main()
