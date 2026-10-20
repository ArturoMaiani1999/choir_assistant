"""Real Web Audio reference-only cancellation, with a synthetic acoustic path."""
import argparse
import base64
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket
from browser_practice_smoke import CHROME, command, evaluate

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'echo-cancellation'
FIXTURE = r"""
window.echoErrors=[];
addEventListener('error',e=>echoErrors.push(e.message));
addEventListener('unhandledrejection',e=>echoErrors.push(String(e.reason)));
const nativeMic=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
const syntheticStreams=new WeakMap(), nativeSource=AudioContext.prototype.createMediaStreamSource;
AudioContext.prototype.createMediaStreamSource=function(stream){
  const fake=syntheticStreams.get(stream);
  if(fake&&this===fake.context){const source=this.createGain();fake.sum.connect(source);return source;}
  return nativeSource.call(this,stream);
};
navigator.mediaDevices.getUserMedia=async constraints=>{
  if(!state.playbackMixer.context)await state.playbackMixer.resume([]);
  if(!state.playbackMixer.referenceOutput)await state.playbackMixer.setReferenceOutput(true);
  await state.playbackMixer.setReferenceOutput(document.getElementById('echo-enabled').checked);
  const permission=await nativeMic(constraints),original=permission.getAudioTracks()[0];
  const ctx=state.playbackMixer.context,delay=ctx.createDelay(1);delay.delayTime.value=.035;
  const room=ctx.createConvolver();room.normalize=false;
  const ir=ctx.createBuffer(1,4000,ctx.sampleRate),samples=ir.getChannelData(0);
  samples[0]=.45;samples[256]=-.12;samples[3000]=.08;room.buffer=ir;
  const sum=ctx.createGain(),out=ctx.createMediaStreamDestination(),roomLevel=ctx.createGain();sum.connect(out);
  state.playbackMixer.referenceOutput.connect(delay);delay.connect(room);room.connect(roomLevel);roomLevel.connect(sum);
  const voice=ctx.createOscillator(),voiceGain=ctx.createGain();voice.frequency.value=220;voiceGain.gain.value=0;
  voice.connect(voiceGain);voiceGain.connect(sum);voice.start();
  const stream=out.stream,track=stream.getAudioTracks()[0],stop=track.stop.bind(track);
  track.getSettings=()=>({...original.getSettings(),sampleRate:ctx.sampleRate,channelCount:1});
  track.stop=()=>{stop();permission.getTracks().forEach(t=>t.stop());
    try{state.playbackMixer.referenceOutput.disconnect(delay)}catch(_){}
    delay.disconnect();room.disconnect();roomLevel.disconnect();sum.disconnect();voice.stop();voice.disconnect();voiceGain.disconnect();};
  syntheticStreams.set(stream,{context:ctx,sum});
  window.echoFixture={voiceGain,roomLevel,delay,context:ctx};
  return stream;
};
"""


LIVE_CHECK = r"""
              const ctx=state.playbackMixer.context,osc=ctx.createOscillator(),gain=ctx.createGain();
              osc.frequency.value=220;gain.gain.value=.05;osc.connect(gain);gain.connect(state.playbackMixer.referenceOutput);osc.start();
              const read=()=>{const p=new Float32Array(2048);state.microphoneAnalyser.getFloatTimeDomainData(p);return {rms:Math.sqrt(p.reduce((s,x)=>s+x*x,0)/p.length),hz:ChoirPitch.detectPitch(p,state.microphoneContext.sampleRate,{rmsThreshold:0,yinThreshold:.42}).hz}};
              await new Promise(r=>setTimeout(r,500));const baseOnly=read();
              assert(baseOnly.rms<.002,'Output was not cancelled: '+JSON.stringify(baseOnly));
              const p=new Float32Array(2048);state.microphoneAnalyser.getFloatTimeDomainData(p);
              assert(!ChoirPitch.detectPitch(p,state.microphoneContext.sampleRate,activeRecognitionSettings()).hz,'Echo residual generated a false note');
              echoFixture.voiceGain.gain.value=.03;
              await new Promise(r=>setTimeout(r,500));const sameF0=read();
              assert(sameF0.rms>.018&&sameF0.rms<.025,'Singer amplitude changed: '+JSON.stringify(sameF0));
              assert(Math.abs(1200*Math.log2(sameF0.hz/220))<10,'Singer F0 changed');
              state.microphoneAnalyser.getFloatTimeDomainData(p);
              assert(ChoirPitch.detectPitch(p,state.microphoneContext.sampleRate,activeRecognitionSettings()).hz>0,'Gate rejected same-frequency voice');
              gain.gain.value=0;await new Promise(r=>setTimeout(r,900));const voiceOnly=read();
              assert(voiceOnly.rms>.018&&voiceOnly.rms<.025,'Voice suppressed without output');
              osc.stop();osc.disconnect();gain.disconnect();
              // Hardware volume is downstream of the digital reference. Change
              // the simulated acoustic path gain, never the app's output slider.
              const probe=ctx.createBufferSource(),probeGain=ctx.createGain();probeGain.gain.value=1;
              const noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);
              noise.copyToChannel(ChoirEchoCancellation.noise(ctx.sampleRate,.08,382),0);
              probe.buffer=noise;probe.loop=true;probe.connect(probeGain);probeGain.connect(state.playbackMixer.referenceOutput);probe.start();
              echoFixture.roomLevel.gain.value=2;
              await new Promise(r=>setTimeout(r,1300));
              assert(Math.abs(echoCancellationUI.diagnostics().gain-1)<.01,'Gain learned the singer during double talk');
              const frozen=echoCancellationUI.diagnostics();
              echoFixture.voiceGain.gain.value=0;
              for(let i=0;i<160&&Math.abs(echoCancellationUI.diagnostics().gain-2)>.04;i++)await new Promise(r=>setTimeout(r,25));
              const louder=echoCancellationUI.diagnostics();
              assert(Math.abs(louder.gain-2)<.04,'Hardware volume increase not followed: '+JSON.stringify(louder));
              await new Promise(r=>setTimeout(r,500));const afterLouder=read();
              assert(afterLouder.rms<.002,'Louder echo not cancelled: '+JSON.stringify(afterLouder));
              echoFixture.roomLevel.gain.value=.5;
              for(let i=0;i<160&&Math.abs(echoCancellationUI.diagnostics().gain-.5)>.02;i++)await new Promise(r=>setTimeout(r,25));
              const quieter=echoCancellationUI.diagnostics();
              assert(Math.abs(quieter.gain-.5)<.02,'Hardware volume decrease not followed: '+JSON.stringify(quieter));
              await new Promise(r=>setTimeout(r,500));
              const afterQuieter=read();assert(afterQuieter.rms<.002,'Quieter echo not cancelled');
              echoFixture.delay.delayTime.value=.036;
              for(let i=0;i<120&&Math.abs(echoCancellationUI.diagnostics().delayOffsetMs-1)>.1;i++)await new Promise(r=>setTimeout(r,25));
              assert(Math.abs(echoCancellationUI.diagnostics().targetGain-quieter.targetGain)<.0001,'Delay change was mislearned as volume: '+JSON.stringify({before:quieter,after:echoCancellationUI.diagnostics()}));
              assert(Math.abs(echoCancellationUI.diagnostics().delayOffsetMs-1)<.1,'One-ms path change was not aligned');
              echoFixture.delay.delayTime.value=.041;
              for(let i=0;i<120&&Math.abs(echoCancellationUI.diagnostics().delayOffsetMs-6)>.1;i++)await new Promise(r=>setTimeout(r,25));
              assert(Math.abs(echoCancellationUI.diagnostics().delayOffsetMs-6)<.1,'Six-ms path change was not aligned');
              await new Promise(r=>setTimeout(r,200));assert(read().rms<.002,'Retimed echo was not cancelled');
              echoFixture.delay.delayTime.value=.035;
              for(let i=0;i<120&&Math.abs(echoCancellationUI.diagnostics().delayOffsetMs)>.1;i++)await new Promise(r=>setTimeout(r,25));
              assert(Math.abs(echoCancellationUI.diagnostics().delayOffsetMs)<.1,'Reverse path change was not aligned');
              probeGain.gain.value=0;probe.stop();probe.disconnect();probeGain.disconnect();
              await new Promise(r=>setTimeout(r,800));
              const tonal=ctx.createOscillator(),tonalGain=ctx.createGain();tonal.frequency.value=220;tonalGain.gain.value=.05;
              tonal.connect(tonalGain);tonalGain.connect(state.playbackMixer.referenceOutput);tonal.start();
              echoFixture.voiceGain.gain.value=.03;
              await new Promise(r=>setTimeout(r,1200));
              assert(Math.abs(echoCancellationUI.diagnostics().targetGain-quieter.targetGain)<.0001,'Same-F0 singer changed the model gain');
              const preserved=read();assert(Math.abs(1200*Math.log2(preserved.hz/220))<10&&preserved.rms>.018,'Same-F0 voice not preserved after auto adjustment');
              tonal.stop();tonal.disconnect();tonalGain.disconnect();
              echoFixture.voiceGain.gain.value=1.5;
              await new Promise(r=>setTimeout(r,700));
              assert(echoCancellationUI.diagnostics().status==='clipping','Clipping was not disclosed');
              assert(activeRecognitionSettings().rmsThreshold===Number.MAX_VALUE,'Clipped input was allowed into pitch scoring');
              window.echoVolumeResult={frozen,louder,quieter,afterLouder,afterQuieter,preserved};

"""

def diagnostic_checks(ws, OUT, verified=True):
    evaluate(ws,229,'window.expectedDiagnosticVerified='+('true' if verified else 'false'))
    evaluate(ws,230,"""(async()=>{
      if(document.querySelector('.echo-test-details').textContent.includes('locale')||!document.querySelector('.echo-recording-note').textContent.includes('best audio automatico'))throw Error('Speaker settings misrepresent diagnostic storage');
      const authFetch=window.ChoirAuthFetch;
      window.diagnosticRequests=[];window.failDiagnosticOnce=true;window.holdDiagnostic=false;
      window.ChoirAuthFetch=async(path,options)=>{
        if(String(path).startsWith('/api/echo-diagnostics')&&options?.method==='POST'){
          diagnosticRequests.push({path,body:options.body,headers:options.headers});window.diagnosticBlob=options.body;
          if(window.failDiagnosticOnce){window.failDiagnosticOnce=false;return Response.json({error:'temporary_failure'},{status:503});}
          if(window.holdDiagnostic)await new Promise(resolve=>{window.releaseDiagnostic=resolve});
        }
        return authFetch(path,options);
      };
      document.getElementById('settings-audio-output-standard').click();
      openDetectorSettings('basic');
      await new Promise(resolve=>setTimeout(resolve,80));
      if(expectedDiagnosticVerified&&(!echoCancellationUI.ready()||state.microphoneStatus!=='active'))throw Error('Base closed the calibrated chain');
      document.querySelector('.echo-test-details').open=true;
      document.getElementById('echo-test-open').click();
      for(let i=0;i<100&&!document.getElementById('echo-test-dialog').open;i++)await new Promise(resolve=>setTimeout(resolve,20));
      if(!document.getElementById('echo-test-dialog').open)throw Error('Diagnostic did not open');
      if(!document.getElementById('echo-test-start').disabled)throw Error('Missing explicit consent');
      if(!automaticBestStatusText().includes('Sospeso'))throw Error('Speaker recording suspension not disclosed');
    })()""")
    def diagnostic_shots(suffix,live=False):
        for width,height,name in [(1366,768,'desktop'),(390,844,'mobile')]:
            command(ws,231,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':False})
            time.sleep(.15)
            layout=evaluate(ws,232,"""(()=>{
              const d=document.getElementById('%s'),r=d.getBoundingClientRect();
              return {visible:r.height>0,inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
                overflow:d.scrollHeight>d.clientHeight+2,wide:document.documentElement.scrollWidth>innerWidth,
                buttonHeight:document.getElementById('%s').getBoundingClientRect().height};
            })()""" % ('echo-test-live' if live else 'echo-test-dialog','echo-test-stop' if live else 'echo-test-close'))
            assert layout['visible'] and layout['inside'] and not layout['overflow'] and not layout['wide'] and layout['buttonHeight']>=44,layout
            shot=command(ws,233,'Page.captureScreenshot',{'format':'png','fromSurface':True})
            (OUT/f'{name}-diagnostic-{suffix}.png').write_bytes(base64.b64decode(shot['data']))
    diagnostic_shots('ready')
    evaluate(ws,234,"""(async()=>{
      document.getElementById('echo-test-close').click();
      if(document.getElementById('echo-test-dialog').open)throw Error('Empty diagnostic did not close');
      await echoDiagnosticsUI.open();
      document.getElementById('echo-test-consent').click();document.getElementById('echo-test-start').click();
      for(let i=0;i<300&&(!echoDiagnosticsUI.isBusy()||!state.clock.running||document.getElementById('echo-test-dialog').open);i++)await new Promise(r=>setTimeout(r,20));
      if(!echoDiagnosticsUI.isBusy()||!state.clock.running||document.getElementById('echo-test-dialog').open)throw Error('Diagnostic playback did not start: '+document.getElementById('echo-test-status').textContent);
      await new Promise(r=>setTimeout(r,1500));
    })()""")
    diagnostic_shots('live',True)
    diagnostic=evaluate(ws,235,"""(async()=>{
      const $=id=>document.getElementById('echo-test-'+id),assert=(x,m)=>{if(!x)throw Error(m)};
      $('stop').click();
      for(let i=0;i<200&&(!$('dialog').open||$('retry').hidden);i++)await new Promise(r=>setTimeout(r,20));
      assert(echoDiagnosticsUI.hasPending()&&$('dialog').open,'No diagnostic retained');
      assert(state.microphoneStatus==='idle'&&!state.clock.running,'Diagnostic retained microphone or playback');
      $('close').click();assert($('dialog').open&&$('status').textContent.includes('Riprova'),'Unsaved diagnostic could be lost');
      $('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));assert($('dialog').open,'Escape discarded capture');
      const buffer=await diagnosticBlob.arrayBuffer(),v=new DataView(buffer),bytes=v.getUint32(40,true),offset=44+bytes;
      const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,offset+8,v.getUint32(offset+4,true))));
      assert(meta.pieceId===new URLSearchParams(location.search).get('piece'),'Diagnostic contains the wrong piece');
      assert(v.getUint16(20,true)===3&&v.getUint16(22,true)===4,'Invalid channel format');
      assert(meta.frames>v.getUint32(24,true)&&meta.frames*16===bytes,'Missing synchronized PCM');
      assert(meta.pitchFrames.length>0&&meta.echo.impulse.length>0&&meta.mixer.voices,'Missing live provenance');
      assert(meta.stoppedReason==='stopped','Incorrect diagnostic stop reason');
      assert(meta.echoLifecycleStart?.schemaVersion===1&&meta.echoLifecycleEnd?.events.length,'Missing pre/post lifecycle');
      assert(meta.echoLifecycleStart.events.some(e=>e.reason==='diagnostic-microphone-start'),'Missing diagnostic start checkpoint');
      assert(meta.pcmContinuity.capturedFrames===meta.frames&&!meta.pcmContinuity.discontinuous,'Invalid PCM continuity report');
      assert(meta.pcmContinuity.lastFrameExclusive-meta.pcmContinuity.firstFrame===meta.frames,'PCM frame gap');
      let reference=0,raw=0,processed=0,identity=0;
      for(let i=0;i<meta.frames;i++){
        const a=v.getFloat32(44+i*16,true),b=v.getFloat32(48+i*16,true),c=v.getFloat32(52+i*16,true),p=v.getFloat32(56+i*16,true);
        raw+=a*a;reference+=b*b;processed+=c*c;identity+=(a-meta.echo.gain*p-c)**2;
      }
      assert(raw>0&&reference>0&&processed>0,'Empty diagnostic audio');
      assert(Math.sqrt(identity/meta.frames)<1e-7,'Captured channels are not aligned with the active subtraction');
      assert(meta.echo.calibrationVerified===expectedDiagnosticVerified,'Wrong acoustic provenance');
      if(!expectedDiagnosticVerified)assert(meta.echo.gain===0&&Math.sqrt(identity/meta.frames)<1e-7,'Unverified correction changed the voice');
      window.diagnosticReport={pieceId:meta.pieceId,buildVersion:meta.buildVersion,calibrationVerified:meta.echo.calibrationVerified,frames:meta.frames,sampleRate:meta.sampleRate,pitchFrames:meta.pitchFrames.length,rawRms:Math.sqrt(raw/meta.frames),referenceRms:Math.sqrt(reference/meta.frames),processedRms:Math.sqrt(processed/meta.frames)};
      return diagnosticReport;
    })()""")
    diagnostic_shots('retry')
    evaluate(ws,238,"""(async()=>{
      window.holdDiagnostic=true;document.getElementById('echo-test-retry').click();
      for(let i=0;i<100&&!window.releaseDiagnostic;i++)await new Promise(r=>setTimeout(r,20));
      if(!document.getElementById('echo-test-instruction').textContent.includes('Salvataggio'))throw Error('Missing saving state');
      document.getElementById('echo-test-close').click();
      if(!document.getElementById('echo-test-dialog').open)throw Error('Closed while saving');
    })()""")
    diagnostic_shots('saving')
    evaluate(ws,239,"""(async()=>{
      window.holdDiagnostic=false;releaseDiagnostic();
      for(let i=0;i<300&&echoDiagnosticsUI.hasPending();i++)await new Promise(r=>setTimeout(r,20));
      if(echoDiagnosticsUI.hasPending()||document.getElementById('echo-test-instruction').textContent!=='Test salvato')throw Error('Upload did not confirm persistence: '+document.getElementById('echo-test-status').textContent);
      if(diagnosticRequests[0].path!==diagnosticRequests[1].path||diagnosticRequests[0].body!==diagnosticRequests[1].body)throw Error('Retry changed the capture');
      if(diagnosticRequests[1].headers['X-Diagnostic-Consent']!=='capture-store-share-v1')throw Error('Missing storage consent');
      const latest=await PersonalRecordings.echoDiagnostics(new URLSearchParams(location.search).get('piece'));
      if(latest.diagnostics.length!==1)throw Error('No saved diagnostic in owner API');
      const stored=await (await ChoirAuthFetch(latest.diagnostics[0].audioUrl)).arrayBuffer();
      const original=await diagnosticBlob.arrayBuffer();
      const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value))).join(',');
      if(await hash(stored)!==await hash(original))throw Error('Persisted PCM differs from capture');
    })()""")
    diagnostic_shots('result')
    evaluate(ws,240,"""(async()=>{
      document.getElementById('echo-test-done').click();
      if(document.getElementById('echo-test-dialog').open)throw Error('Saved capture did not close');
      await echoDiagnosticsUI.open();
      if(document.getElementById('echo-test-delete').hidden)throw Error('Saved diagnostic not available after reopening');
      document.getElementById('echo-test-delete').click();
      for(let i=0;i<100&&!document.getElementById('echo-test-delete').hidden;i++)await new Promise(r=>setTimeout(r,20));
      document.getElementById('echo-test-close').click();
      await echoDiagnosticsUI.open();
      document.getElementById('echo-test-close').click();
      window.diagnosticReport.directUpload=true;window.diagnosticReport.retry=true;window.diagnosticReport.exactStoredPcm=true;window.diagnosticReport.ownerDeletion=true;
    })()""")
    encoded=evaluate(ws,236,"""(async()=>{const a=new Uint8Array(await diagnosticBlob.arrayBuffer());let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(s)})()""")
    (OUT/'diagnostic-smoke.wav').write_bytes(base64.b64decode(encoded))
    return evaluate(ws,241,'window.diagnosticReport')

def main():
    # Compatibility entry point; the former separate speaker dialog is gone.
    import sys
    from browser_audio_calibration_smoke import main as unified_main
    if "--extended" not in sys.argv: sys.argv.append("--extended")
    unified_main()

if __name__ == "__main__": main()
