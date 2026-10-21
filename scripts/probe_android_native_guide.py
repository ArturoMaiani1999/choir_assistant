"""Run the actual unified native-AEC guide after explicit singing readiness.

No microphone PCM export. Keeps only guide results/settings/lifecycle.
Successful calibration leaves input active as declared by the product UI;
failure/cancellation releases it. Hardware volume is always restored.
"""
import argparse
from contextlib import closing
import json
from pathlib import Path
import time
import websocket
import numpy as np

from browser_practice_smoke import evaluate
from probe_android_platform_aec import page_socket
from probe_android_calibration import volume_adjustment,export_array
from probe_android_native_acoustic import INSTALL as ACOUSTIC_INSTALL

SNAPSHOT=r"""(()=>{const s=state.microphoneStream?.getAudioTracks()[0]?.getSettings()||{};return {
 build:RUNTIME_CONFIG.buildVersion,visible:document.visibilityState,busy:microphoneCalibrationUI.isBusy(),
 instruction:document.getElementById('calibration-instruction').textContent,
 status:document.getElementById('calibration-status').textContent,
 done:!document.getElementById('calibration-done').hidden,
 voiceVerified:Boolean(microphoneCalibrationUI.activeSettings()),microphone:state.microphoneStatus,
 settings:{echoCancellation:s.echoCancellation,noiseSuppression:s.noiseSuppression,autoGainControl:s.autoGainControl,
  voiceIsolation:s.voiceIsolation,sampleRate:s.sampleRate,channelCount:s.channelCount,latency:s.latency},
 echo:echoCancellationUI.diagnostics(),report:document.getElementById('calibration-report').innerText,
 lifecycle:echoCancellationUI.lifecycle(),pitchSamples:state.pitchSamples.length,running:Boolean(state.clock?.running)};})()"""

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',action='store_true')
    parser.add_argument('--build',required=True);parser.add_argument('--volume-index',type=int,default=11)
    parser.add_argument('--output',type=Path);args=parser.parse_args()
    with closing(page_socket(9223)) as socket:
        before=evaluate(socket,1,SNAPSHOT);assert before['build']==args.build,'Reload the deployed build first'
        if not args.run:print(json.dumps(before));return
        assert before['visible']=='visible' and before['microphone']=='idle' and not before['running'] and not before['busy']
        assert evaluate(socket,2,"echoCancellationUI.enabled()&&echoCancellationUI.isNative()&&!echoDiagnosticsUI.hasPending()&&!echoDiagnosticsUI.isBusy()")
        output=args.output;assert output is not None,'Provide a new artifact directory'
        output.mkdir(parents=True,exist_ok=False);(output/'before.json').write_text(json.dumps(before,indent=2))
        success=False
        snapshot=None
        with volume_adjustment(args.volume_index,output):
            try:
                tap=ACOUSTIC_INSTALL.split(' p.task=')[0]+" return {installed:true};})()"
                evaluate(socket,20,tap)
                evaluate(socket,3,"(async()=>{await microphoneCalibrationUI.open();document.getElementById('calibration-start').click();return {started:true}})()")
                started=time.monotonic();last=None;snapshot=None
                while time.monotonic()-started<52:
                    time.sleep(.25);snapshot=evaluate(socket,4,SNAPSHOT)
                    phase=snapshot['instruction']
                    if phase!=last:
                        print(json.dumps({'instruction':phase,'busy':snapshot['busy']}),flush=True);last=phase
                        (output/'last-snapshot.json').write_text(json.dumps(snapshot,indent=2))
                    if not snapshot['busy']:break
                assert snapshot is not None
                (output/'result.json').write_text(json.dumps(snapshot,indent=2))
                captured=evaluate(socket,21,'nativeAcousticProbe.microphone?.length||0')
                if captured:
                    rate=evaluate(socket,22,'nativeAcousticProbe.rate')
                    np.savez_compressed(output/'acoustic-capture.npz',microphone=export_array(socket,'nativeAcousticProbe.microphone'),
                        reference=export_array(socket,'nativeAcousticProbe.reference'),sample_rate=rate)
                success=snapshot['done'] and snapshot['voiceVerified'] and snapshot['echo']['ready'] and not snapshot['busy']
                assert success,{'instruction':snapshot['instruction'],'status':snapshot['status']}
                assert snapshot['settings']['echoCancellation'] is True
                assert snapshot['settings']['noiseSuppression'] is False and snapshot['settings']['autoGainControl'] is False
                assert not snapshot['running'] and snapshot['pitchSamples']==before['pitchSamples'],'Guide entered rehearsal history'
                print(json.dumps({'success':True,'output':str(output),'echo':snapshot['echo'],'settings':snapshot['settings'],
                    'report':snapshot['report'],'microphoneLeftActiveAsShownInUI':True}),flush=True)
            except (OSError,websocket.WebSocketException) as error:
                (output/'connection-error.json').write_text(json.dumps({'error':str(error),
                    'lastInstruction':snapshot['instruction'] if snapshot else None,
                    'guideMayContinueOnDevice':True},indent=2))
                print('USB/CDP interrupted; guide may continue. Reconnect to inspect the result.',flush=True)
                raise
            finally:
                try:evaluate(socket,901,'window.nativeAcousticProbe?.restore()')
                except (OSError,websocket.WebSocketException):pass
                if not success:
                    try:evaluate(socket,900,"(async()=>{if(microphoneCalibrationUI.isBusy())microphoneCalibrationUI.cancel('Prova tecnica interrotta.');await stopMicrophone()})()")
                    except (OSError,websocket.WebSocketException):print('Cleanup not confirmed over disconnected USB; do not assume the microphone stopped.',flush=True)

if __name__=='__main__':main()
