"""Minimal local-only render-clock experiment, independent of the webapp.

Uses muted headless Chrome and synthetic microphone input. A sample-coded
AudioBuffer identifies every reference sample independently of currentFrame.
Never records a real microphone or touches the connected phone.
"""
import argparse
from contextlib import closing
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import urllib.request

import websocket
from browser_practice_smoke import CHROME, command, evaluate

WORKLET = r"""
class QuantumProbe extends AudioWorkletProcessor {
  constructor(){super();this.rows=[];this.counter=0;this.port.onmessage=()=>this.flush()}
  flush(){if(this.rows.length){this.port.postMessage(this.rows);this.rows=[]}}
  process(inputs,outputs){
    const frame=currentFrame,time=currentTime,output=outputs[0][0];output.fill(0);
    const marker=inputs[0]?.[0],mix=inputs[1]?.[0],mic=inputs[2]?.[0];
    let energy=0,micEnergy=0;
    for(let i=0;i<output.length;i++){energy+=(mix?.[i]||0)**2;micEnergy+=(mic?.[i]||0)**2}
    const decode=value=>value>0?Math.round(value*16777216)-1:null;
    this.rows.push({ordinal:this.counter++,frame,time,frameAtEnd:currentFrame,
      size:output.length,first:decode(marker?.[0]),last:decode(marker?.[output.length-1]),
      mixRms:Math.sqrt(energy/output.length),micRms:Math.sqrt(micEnergy/output.length)});
    if(this.rows.length>=64)this.flush();return true;
  }
}
registerProcessor('quantum-probe',QuantumProbe);
"""

CASE = r"""(async()=>{
  const options=__OPTIONS__,duration=__DURATION__,ctx=new AudioContext({sampleRate:48000});
  await ctx.resume();await ctx.audioWorklet.addModule('/quantum.js');
  const sr=ctx.sampleRate,bus=ctx.createGain();bus.connect(ctx.destination);
  const rows=[],probe=new AudioWorkletNode(ctx,'quantum-probe',{numberOfInputs:3,numberOfOutputs:1,
    channelCount:1,channelCountMode:'explicit',outputChannelCount:[1]});
  probe.port.onmessage=({data})=>rows.push(...data);
  const sink=options.zeroGain?ctx.createGain():null;
  if(sink){sink.gain.value=0;probe.connect(sink);sink.connect(ctx.destination)}else probe.connect(ctx.destination);
  const buffer=ctx.createBuffer(1,Math.ceil((duration+2)*sr),sr),samples=buffer.getChannelData(0);
  for(let i=0;i<samples.length;i++)samples[i]=(i+1)/16777216;
  const source=ctx.createBufferSource();source.buffer=buffer;
  source.connect(bus);source.connect(probe,0,0);bus.connect(probe,0,1);
  let stream,other,mic;
  if(options.microphone){
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
    mic=ctx.createMediaStreamSource(stream);mic.connect(probe,0,2);
    if(options.secondContext){
      other=new AudioContext({sampleRate:48000});await other.resume();
      const input=other.createMediaStreamSource(stream),mute=other.createGain();mute.gain.value=0;
      input.connect(mute);mute.connect(other.destination);
    }
  }
  if(options.originalRecorder)await ctx.audioWorklet.addModule(options.legacyRecorder?'/capture-legacy.js':'/capture.js');
  const origin=Math.ceil((ctx.currentTime+.1)*sr/128)*128/sr;
  let recorder,recorderSink;const capture={frames:0,error:null,packets:[],clockEvents:[],sampleErrors:0,lastSample:null};
  if(options.originalRecorder){
    recorder=new AudioWorkletNode(ctx,'choir-echo-diagnostic',{numberOfInputs:4,numberOfOutputs:1,
      channelCount:1,channelCountMode:'explicit',outputChannelCount:[1],
      processorOptions:{startFrame:Math.round(origin*sr),maximumFrames:Math.round(duration*sr)}});
    source.connect(recorder,0,0);bus.connect(recorder,0,1);
    recorderSink=ctx.createGain();recorderSink.gain.value=0;recorder.connect(recorderSink);recorderSink.connect(ctx.destination);
    recorder.port.onmessage=({data})=>{
      if(data.clock)capture.clock=data.clock;
      if(data.clockEvent){capture.clockEvents.push(data.clockEvent);return}
      if(data.error){capture.error=data;return}
      if(data.valid){
        const a=data.channels[0];capture.frames+=data.valid;
        for(let i=0;i<data.valid;i++){
          const value=Math.round(a[i]*16777216)-1;
          if(capture.lastSample!==null&&value!==capture.lastSample+1)capture.sampleErrors++;
          capture.lastSample=value;
        }
        capture.packets.push({firstFrame:data.firstFrame,valid:data.valid,
          first:Math.round(a[0]*16777216)-1,last:Math.round(a[data.valid-1]*16777216)-1});
      }
    };
  }
  source.start(origin);const timers=[],oscillators=[];
  if(options.clicks)for(let at=.4;at<duration-.2;at+=.4)
    timers.push(setTimeout(()=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain(),now=ctx.currentTime;
      gain.gain.setValueAtTime(.03,now);gain.gain.exponentialRampToValueAtTime(.0001,now+.055);
      osc.frequency.setValueAtTime(820,now);osc.frequency.exponentialRampToValueAtTime(570,now+.045);
      osc.connect(gain);gain.connect(bus);osc.start(now);osc.stop(now+.08);oscillators.push(osc,gain);
    },Math.max(0,(origin+at-ctx.currentTime)*1000)));
  let mutationCount=0;
  const churn=options.graphChurn?setInterval(()=>{
    // Deliberate graph-lock contention, not an acoustic simulation.
    for(let i=0;i<100;i++){
      const gain=ctx.createGain();bus.connect(gain);gain.connect(ctx.destination);
      bus.disconnect(gain);gain.disconnect();mutationCount++;
    }
  },10):null;
  let deadlineError=null;
  const wallStart=performance.now();
  while(ctx.currentTime<origin+duration){
    if(performance.now()-wallStart>(duration+5)*1000){deadlineError='context-stalled';break}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  clearInterval(churn);source.stop();probe.port.postMessage('flush');await new Promise(resolve=>setTimeout(resolve,100));
  for(const timer of timers)clearTimeout(timer);
  source.disconnect();bus.disconnect();probe.disconnect();sink?.disconnect();mic?.disconnect();
  recorder?.disconnect();recorderSink?.disconnect();if(recorder){recorder.port.onmessage=null;recorder.port.close()}
  for(const node of oscillators)node.disconnect();stream?.getTracks().forEach(t=>t.stop());
  probe.port.onmessage=null;probe.port.close();await other?.close();await ctx.close();
  return {options,rate:sr,originFrame:Math.round(origin*sr),duration,deadlineError,mutationCount,capture,rows};
})()"""

def capture_source(counted=False,legacy=False):
    root=Path(__file__).resolve().parents[1]
    # counted remains accepted for old local preview launchers. The current
    # production candidate already counts samples and retains clock telemetry.
    path=next((root/'artifacts/echo-calibration-stability/release-acoustic-probe').glob('echo_diagnostic_worklet.*.js')) if legacy else root/'frontend/echo_diagnostic_worklet.js'
    return path.read_text()

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        if self.path=='/quantum.js':body=WORKLET.encode()
        elif self.path in ('/capture.js','/capture-counted.js','/capture-legacy.js'):
            body=capture_source(legacy=self.path=='/capture-legacy.js').encode()
        elif self.path=='/audio_sample_clock.js':body=(Path(__file__).resolve().parents[1]/'frontend/audio_sample_clock.js').read_bytes()
        elif self.path=='/pitch_detector.js':body=(Path(__file__).resolve().parents[1]/'frontend/pitch_detector.js').read_bytes()
        else:body=b'<!doctype html><title>Local audio quantum probe</title>'
        self.send_response(200);self.send_header('Content-Type','text/javascript' if self.path.endswith('.js') else 'text/html')
        self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

def summarize(result):
    rows=result['rows'];events=[];previous=None
    for row in rows:
        if row['frame']!=row['frameAtEnd']:events.append({'kind':'clock-changed-inside-callback','row':row})
        if previous:
            frame_step=row['frame']-previous['frame']
            marker_step=row['first']-previous['first'] if row['first'] is not None and previous['first'] is not None else None
            if frame_step!=previous['size'] or marker_step is not None and marker_step!=previous['size']:
                events.append({'kind':'step','frameStep':frame_step,'markerStep':marker_step,'previous':previous,'row':row})
        previous=row
    return {k:v for k,v in result.items() if k!='rows'}|{'callbacks':len(rows),'events':events}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--duration',type=float,default=10)
    parser.add_argument('--output',type=Path,default=Path('artifacts/audio-quantum-isolation/minimal'))
    parser.add_argument('--cases',nargs='+',default=['direct','muted','clicks','mic-clicks','two-contexts'])
    parser.add_argument('--verify',action='store_true',help='Require full, sample-perfect capture for every requested condition')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=False)
    definitions={'direct':{'zeroGain':False},'muted':{'zeroGain':True},
        'clicks':{'zeroGain':True,'clicks':True},
        'mic-clicks':{'zeroGain':True,'clicks':True,'microphone':True},
        'two-contexts':{'zeroGain':True,'clicks':True,'microphone':True,'secondContext':True},
        'recorder':{'zeroGain':True,'originalRecorder':True},
        'recorder-clicks':{'zeroGain':True,'originalRecorder':True,'clicks':True},
        'recorder-mic-clicks':{'zeroGain':True,'originalRecorder':True,'clicks':True,'microphone':True},
        'graph-churn':{'zeroGain':True,'graphChurn':True},
        'recorder-churn':{'zeroGain':True,'originalRecorder':True,'graphChurn':True},
        'counted-churn':{'zeroGain':True,'originalRecorder':True,'graphChurn':True},
        'counted-clicks':{'zeroGain':True,'originalRecorder':True,'clicks':True},
        'legacy-churn':{'zeroGain':True,'originalRecorder':True,'graphChurn':True,'legacyRecorder':True},
        'legacy-clicks':{'zeroGain':True,'originalRecorder':True,'clicks':True,'legacyRecorder':True}}
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='quantum-probe-') as profile:
        chrome=subprocess.Popen([str(CHROME),'--headless=new','--mute-audio','--disable-gpu',
            '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
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
                (args.output/'browser.json').write_text(json.dumps(command(socket,10,'Browser.getVersion'),indent=2))
                command(socket,1,'Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/'})
                time.sleep(.3);results=[]
                for index,name in enumerate(args.cases):
                    expression=CASE.replace('__OPTIONS__',json.dumps(definitions[name])).replace('__DURATION__',str(args.duration))
                    result=evaluate(socket,2,expression)
                    (args.output/f'{index+1:02d}-{name}.json').write_text(json.dumps(result))
                    summary=summarize(result);summary['case']=name;results.append(summary)
                    print(json.dumps({'case':name,'callbacks':summary['callbacks'],'events':len(summary['events']),
                        'firstEvents':summary['events'][:2],'recorderError':summary['capture']['error']}),flush=True)
                (args.output/'summary.json').write_text(json.dumps(results,indent=2))
                if args.verify:
                    for result in results:
                        capture=result['capture'];assert capture['error'] is None,result['case']
                        assert capture['frames']==round(args.duration*result['rate']),(result['case'],capture['frames'])
                        assert capture['sampleErrors']==0,(result['case'],capture['sampleErrors'])
                        assert not result['deadlineError'],result['case']
        finally:
            chrome.terminate()
            try:chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:chrome.kill();chrome.wait()
            server.shutdown();server.server_close()

if __name__=='__main__':main()
