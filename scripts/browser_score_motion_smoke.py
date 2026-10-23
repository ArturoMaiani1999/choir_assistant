"""Full-score cursor interpolation and pause with deliberately coarse media time."""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
import websocket
from browser_practice_smoke import CHROME, command, evaluate


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:5173/score-viewer.html?piece=ave-verum')
    args=parser.parse_args();out=Path('artifacts/mix-sync');out.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='score-motion-',ignore_cleanup_errors=True) as profile:
        process=subprocess.Popen([str(CHROME),'--headless=new','--disable-gpu','--autoplay-policy=no-user-gesture-required',
            '--remote-allow-origins=*','--remote-debugging-port=0',f'--user-data-dir={profile}',args.url],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        socket=None
        try:
            port_file=Path(profile)/'DevToolsActivePort'
            for _ in range(120):
                try:port=port_file.read_text().splitlines()[0];break
                except (OSError,IndexError):time.sleep(.05)
            pages=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            socket=websocket.create_connection(next(p for p in pages if p['type']=='page')['webSocketDebuggerUrl'],timeout=20)
            for _ in range(150):
                if evaluate(socket,1,"!!document.querySelector('.viewer-measure-hit')&&document.querySelector('#viewer-audio')?.readyState>=1"):break
                time.sleep(.1)
            else:raise RuntimeError('Full score did not initialize')
            evaluate(socket,2,"""(()=>{
              window.motionErrors=[];addEventListener('error',e=>motionErrors.push(e.message));addEventListener('unhandledrejection',e=>motionErrors.push(String(e.reason)));
              const audio=document.querySelector('#viewer-audio'),d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
              Object.defineProperty(audio,'currentTime',{configurable:true,get(){return Math.floor(d.get.call(this)*10)/10},set(t){d.set.call(this,t)}});
            })()""")
            results=[]
            for width,height in [(1366,768),(390,844)]:
                command(socket,3,'Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':width<700})
                result=evaluate(socket,4,"""(async()=>{
                  const audio=document.querySelector('#viewer-audio'),pages=document.querySelector('#viewer-pages'),button=document.querySelector('#viewer-play');
                  button.click();for(let i=0;i<120&&audio.paused;i++)await new Promise(r=>setTimeout(r,25));
                  if(audio.paused)throw Error('Score playback did not start');await new Promise(r=>setTimeout(r,300));
                  const samples=[],start=performance.now();await new Promise(resolve=>{const tick=t=>{
                    samples.push({wall:t,raw:audio.currentTime,visual:Number(pages.dataset.playbackSeconds)});
                    if(t-start>=1800)resolve();else requestAnimationFrame(tick)};requestAnimationFrame(tick)});
                  button.click();const frozen=Number(pages.dataset.playbackSeconds);await new Promise(r=>setTimeout(r,250));
                  const elapsed=(samples.at(-1).wall-samples[0].wall)/1000;
                  return {viewport:[innerWidth,innerHeight],rafFps:(samples.length-1)/elapsed,
                    visualFps:samples.slice(1).filter((s,i)=>s.visual>samples[i].visual+1e-6).length/elapsed,
                    rawFps:samples.slice(1).filter((s,i)=>s.raw>samples[i].raw+1e-6).length/elapsed,
                    paused:audio.paused,pauseDelta:Number(pages.dataset.playbackSeconds)-frozen,errors:motionErrors};
                })()""")
                assert result['visualFps']>result['rafFps']*.9,result
                assert result['rawFps']<15,result
                assert result['paused'] and result['pauseDelta']==0 and not result['errors'],result
                shot=command(socket,5,'Page.captureScreenshot',{'format':'png','fromSurface':True})
                (out/f'full-score-{width}x{height}.png').write_bytes(base64.b64decode(shot['data']))
                results.append(result)
            (out/'full-score-motion.json').write_text(json.dumps(results,indent=2),encoding='utf-8');print(json.dumps(results))
        finally:
            if socket:socket.close()
            process.terminate();process.wait(timeout=5)


if __name__=='__main__':main()
