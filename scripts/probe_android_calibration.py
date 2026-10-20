"""Capture the authorized staging calibration over an existing ADB/CDP forward.

Default: inspect only. --run starts the two acoustic probes and stops the
guide after the acoustic result, before asking the user to sing. Use only
after confirming that the user is silent and the device/volume are fixed.
PCM stays in local artifacts; no upload or account changes.
"""
import argparse
import base64
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.request
from urllib.parse import urlsplit

import numpy as np
import websocket
from browser_practice_smoke import command, evaluate

ADB = Path(__file__).resolve().parents[1] / 'artifacts/android-tools/platform-tools/adb.exe'


@contextmanager
def volume_adjustment(index, output):
    if index is None:
        yield None
        return
    def volume_command(*args):
        return subprocess.run([str(ADB), 'shell', 'cmd', 'media_session', 'volume', '--stream', '3', *args],
                              check=True, capture_output=True, text=True, timeout=10).stdout
    def current():
        match = re.search(r'volume is (\d+) in range \[(\d+)\.\.(\d+)\]', volume_command('--get'))
        if not match:
            raise RuntimeError('Cannot read media volume; no change made')
        return tuple(map(int, match.groups()))
    before, minimum, maximum = current()
    if not minimum <= index <= maximum:
        raise ValueError(f'Volume index outside device range [{minimum}..{maximum}]')
    record = {'beforeIndex': before, 'duringIndex': index, 'range': [minimum, maximum]}
    try:
        volume_command('--set', str(index))
        actual, _, _ = current()
        if actual != index:
            raise RuntimeError('Device did not apply the requested volume')
        yield record
    finally:
        try:
            volume_command('--set', str(before))
            record['restoredIndex'] = current()[0]
            if record['restoredIndex'] != before:
                raise RuntimeError('Volume restoration was not confirmed')
        except Exception as error:
            record['restorationError'] = str(error)
            print(f'Restore phone media volume manually to {before} on a scale of {maximum}.', flush=True)
        (output / 'volume.json').write_text(json.dumps(record, indent=2), encoding='utf-8')

INSTALL = r"""(async()=>{
  if(Date.now()>__START_DEADLINE__)throw Error('Start expired: keep Chrome in the foreground and retry');
  if (echoDiagnosticsUI.hasPending() || echoDiagnosticsUI.isBusy() ||
      microphoneCalibrationUI.isBusy() || state.clock?.running ||
      state.microphoneStatus !== 'idle') throw Error('Audio session already active');
  if (!echoCancellationUI.enabled()) throw Error('Speaker mode is not enabled');
  window.phoneCalibrationProbe={results:[],pcm:null,startedAt:new Date().toISOString()};
  const original=window.Worker;
  const Instrumented=class extends original {
    constructor(...args){super(...args);
      if(String(args[0]).includes('echo_cancellation_worker'))
        this.addEventListener('message',({data})=>{
          if('usable' in data){const {impulse,...metadata}=data;
            phoneCalibrationProbe.results.push(metadata);
            if(impulse)phoneCalibrationProbe.impulse=impulse.slice();}
        });
    }
    postMessage(data,...rest){
      if(data.compact&&data.microphone&&data.reference){
        const s=state.microphoneStream?.getAudioTracks()[0]?.getSettings()||{};
        phoneCalibrationProbe.pcm={microphone:data.microphone.slice(),
          reference:data.reference.slice(),sampleRate:data.sampleRate};
        phoneCalibrationProbe.inputSettings={sampleRate:s.sampleRate,channelCount:s.channelCount,
          echoCancellation:s.echoCancellation,noiseSuppression:s.noiseSuppression,
          autoGainControl:s.autoGainControl,latency:s.latency};
      }
      return super.postMessage(data,...rest);
    }
  };
  window.Worker=Instrumented;
  phoneCalibrationProbe.restore=()=>{if(window.Worker===Instrumented)window.Worker=original;};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  await microphoneCalibrationUI.open();
  if(Date.now()>__START_DEADLINE__)throw Error('Start expired: keep Chrome in the foreground and retry');
  document.querySelector('#calibration-start').click();
  return {started:true};
})()"""

SNAPSHOT = r"""(()=>({
  build:RUNTIME_CONFIG.buildVersion,
  busy:microphoneCalibrationUI.isBusy(),
  instruction:document.querySelector('#calibration-instruction').textContent,
  status:document.querySelector('#calibration-status').textContent,
  echo:echoCancellationUI.diagnostics(),
  lifecycle:echoCancellationUI.lifecycle(),
  inputSettings:(()=>{const s=state.microphoneStream?.getAudioTracks()[0]?.getSettings();
    return s?{sampleRate:s.sampleRate,channelCount:s.channelCount,
      echoCancellation:s.echoCancellation,noiseSuppression:s.noiseSuppression,
      autoGainControl:s.autoGainControl,latency:s.latency}:window.phoneCalibrationProbe?.inputSettings||null;})(),
  audioContexts:{mixerRate:state.playbackMixer.context?.sampleRate,
    microphoneRate:state.microphoneContext?.sampleRate,
    mixerState:state.playbackMixer.context?.state,
    microphoneState:state.microphoneContext?.state},
  results:window.phoneCalibrationProbe?.results||[],
  sampleRate:window.phoneCalibrationProbe?.pcm?.sampleRate||null,
  microphoneFrames:window.phoneCalibrationProbe?.pcm?.microphone.length||0
}))()"""


def export_array(socket, expression):
    size = evaluate(socket, 700, f'{expression}?.byteLength||0')
    chunks = []
    for offset in range(0, size, 131072):
        encoded = evaluate(socket, 701, f"""(()=>{{
          const a={expression}, bytes=new Uint8Array(a.buffer,a.byteOffset,a.byteLength)
            .subarray({offset},{min(size, offset+131072)});
          let text='';for(let i=0;i<bytes.length;i+=32768)
            text+=String.fromCharCode(...bytes.subarray(i,i+32768));
          return btoa(text);
        }})()""")
        chunks.append(base64.b64decode(encoded, validate=True))
    return np.frombuffer(b''.join(chunks), dtype='<f4').copy()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--port', type=int, default=9223)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--volume-index', type=int, help='Temporary media volume index; original value is restored')
    args = parser.parse_args()
    if args.volume_index is not None and not args.run:
        parser.error('--volume-index requires --run')
    pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{args.port}/json', timeout=5))
    allowed = [p for p in pages if p.get('type') == 'page' and
               urlsplit(p.get('url', '')).hostname == 'staging.epistrophe.it']
    if len(allowed) != 1:
        parser.error(f'Expected one staging tab, found {len(allowed)}')
    endpoint = allowed[0]['webSocketDebuggerUrl']
    if urlsplit(endpoint).hostname not in ('localhost', '127.0.0.1'):
        parser.error('CDP endpoint must remain local')
    output = args.output or Path('artifacts/echo-lifecycle') / datetime.now(timezone.utc).strftime('device-probe-%Y%m%d-%H%M%S')
    if args.run:
        output.mkdir(parents=True, exist_ok=False)
    with closing(websocket.create_connection(endpoint, timeout=20, suppress_origin=True)) as socket, volume_adjustment(args.volume_index, output) as volume:
        command(socket, 1, 'Page.bringToFront')
        if not args.run:
            print(json.dumps(evaluate(socket, 2, SNAPSHOT), ensure_ascii=True))
            return
        try:
            install = INSTALL.replace('__START_DEADLINE__', str(round(time.time()*1000)+10000))
            print(json.dumps(evaluate(socket, 3, install)), flush=True)
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                time.sleep(.2)
                snapshot = evaluate(socket, 4, SNAPSHOT)
                snapshot['systemVolume'] = volume
                if snapshot['results'] or not snapshot['busy'] or snapshot['instruction'].startswith('Canta'):
                    break
            else:
                raise TimeoutError('Acoustic calibration did not finish within 45 seconds')
            (output / 'result.json').write_text(json.dumps(snapshot, indent=2, ensure_ascii=False), encoding='utf-8')
            # Stop the live guide before it can enter the singing stages.
            evaluate(socket, 5, "microphoneCalibrationUI.cancel('Misura tecnica completata.');document.querySelector('#calibration-dialog').close();phoneCalibrationProbe.restore();")
            if snapshot['microphoneFrames']:
                arrays = {name: export_array(socket, f'phoneCalibrationProbe.pcm.{name}')
                          for name in ('microphone', 'reference')}
                arrays['impulse'] = export_array(socket, 'phoneCalibrationProbe.impulse')
                arrays['sample_rate'] = np.array(snapshot['sampleRate'])
                np.savez_compressed(output / 'capture.npz', **arrays)
            print(json.dumps({'output': str(output), 'echo': snapshot['echo'],
                              'results': snapshot['results'], 'status': snapshot['status'],
                              'frames': snapshot['microphoneFrames']}, ensure_ascii=True), flush=True)
        finally:
            socket.settimeout(3)
            try:
                evaluate(socket, 900, "if(window.phoneCalibrationProbe){phoneCalibrationProbe.restore();if(microphoneCalibrationUI.isBusy())microphoneCalibrationUI.cancel('Misura tecnica interrotta.');}")
            except (websocket.WebSocketTimeoutException, OSError):
                print('Chrome did not acknowledge cleanup; keep the webapp visible before retrying.', flush=True)


if __name__ == '__main__':
    main()
