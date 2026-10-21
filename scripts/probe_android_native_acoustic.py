"""Capture only the actual native route's residual check, after quiet readiness."""
from contextlib import closing
import argparse,json,time
from pathlib import Path
import numpy as np
from probe_android_platform_aec import page_socket
from probe_android_calibration import volume_adjustment,export_array
from browser_practice_smoke import evaluate

INSTALL=r"""(()=>{
 if(document.hidden||state.microphoneStatus!=='idle'||microphoneCalibrationUI.isBusy())throw Error('Not idle');
 const Native=window.AudioWorkletNode,p=window.nativeAcousticProbe={done:false,ok:false};
 const Instrumented=class extends Native{
  constructor(...args){super(...args);if(args[1]==='choir-echo-capture'){
   this.port.addEventListener('message',({data})=>{
    p.captureError=data.error||null;p.clock=data.clock;
    if(data.microphone){p.microphone=data.microphone.slice();p.reference=data.reference.slice();p.rate=args[0].sampleRate;
     const s=state.microphoneStream.getAudioTracks()[0].getSettings();p.settings={echoCancellation:s.echoCancellation,noiseSuppression:s.noiseSuppression,autoGainControl:s.autoGainControl,sampleRate:s.sampleRate,channelCount:s.channelCount};}
   });this.port.start();
  }}
 };
 window.AudioWorkletNode=Instrumented;p.restore=()=>{if(window.AudioWorkletNode===Instrumented)window.AudioWorkletNode=Native;};
 p.task=microphoneCalibrationUI.measureAcoustic().then(ok=>{p.ok=ok;p.done=true},error=>{p.error=String(error);p.done=true});
 return {started:true};
})()"""

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--volume-index',type=int,default=11);args=parser.parse_args()
 args.output.mkdir(parents=True,exist_ok=False)
 with closing(page_socket(9223)) as s,volume_adjustment(args.volume_index,args.output):
  try:
   print(json.dumps(evaluate(s,1,INSTALL)),flush=True)
   start=time.monotonic()
   while time.monotonic()-start<25:
    time.sleep(.2)
    if evaluate(s,2,'nativeAcousticProbe.done'):break
   report=evaluate(s,3,"(()=>{const p=nativeAcousticProbe;return {done:p.done,ok:p.ok,error:p.error,captureError:p.captureError,clock:p.clock,settings:p.settings,rate:p.rate,frames:p.microphone?.length||0,status:document.getElementById('calibration-status').textContent,echo:echoCancellationUI.diagnostics(),lifecycle:echoCancellationUI.lifecycle()}})()")
   (args.output/'result.json').write_text(json.dumps(report,indent=2))
   if report['frames']:
    np.savez_compressed(args.output/'capture.npz',microphone=export_array(s,'nativeAcousticProbe.microphone'),reference=export_array(s,'nativeAcousticProbe.reference'),sample_rate=report['rate'])
   print(json.dumps(report),flush=True)
  finally:
   evaluate(s,900,"(async()=>{nativeAcousticProbe.restore();if(microphoneCalibrationUI.isBusy())microphoneCalibrationUI.cancel('Misura completata.');await stopMicrophone();document.getElementById('calibration-dialog').close()})()")

if __name__=='__main__':main()
