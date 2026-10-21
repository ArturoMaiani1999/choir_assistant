"""Read-only, anonymous startup measurements in Chrome; never saves cookies/tokens.

Example: python scripts/browser_startup_audit.py --url https://staging.xynon.it/sign-in
Local synthetic profiles can use --ready with the existing navigation fixture server.
"""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import tempfile
import threading
import time
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

import websocket

from browser_dist_smoke import CHROME, command, evaluate

ROOT = Path(__file__).resolve().parents[1]
OBSERVER = """
window.startupAudit={errors:[],longTasks:[],readyAt:null};
addEventListener('error',e=>startupAudit.errors.push(e.message||'resource error'));
addEventListener('unhandledrejection',()=>startupAudit.errors.push('unhandled rejection'));
new PerformanceObserver(list=>{for(const e of list.getEntries())
  startupAudit.longTasks.push({start:e.startTime,duration:e.duration});
}).observe({type:'longtask',buffered:true});
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='https://staging.xynon.it/sign-in')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/startup-audit')
    parser.add_argument('--attempts', type=int, default=2)
    parser.add_argument('--timeout', type=float, default=45)
    parser.add_argument('--mobile', action='store_true')
    parser.add_argument('--slow-network', action='store_true')
    parser.add_argument('--cpu-rate', type=float, default=1)
    parser.add_argument('--home-fixture', action='store_true', help='Synthetic local profile, no real authentication')
    parser.add_argument('--session-delay', type=float, default=0, help='Simulate pending authentication in the local fixture (seconds)')
    parser.add_argument('--ready', default="!!document.querySelector('#clerk-sign-in input')")
    args = parser.parse_args()
    server = None
    if args.home_fixture:
        from browser_navigation_audit import Handler
        class StartupHandler(Handler):
            def do_GET(self):
                if self.path == '/session-client.js' and args.session_delay:
                    shim = ('window.ChoirAuthReady=new Promise(r=>setTimeout(r,'
                            + str(args.session_delay * 1000) + '));'
                            'window.ChoirAuthFetch=async(...args)=>{await window.ChoirAuthReady;return fetch(...args)};')
                    return self.send_body(shim.encode(), 'text/javascript')
                return super().do_GET()
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(StartupHandler, directory=str(ROOT / 'frontend')))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        args.url = f'http://127.0.0.1:{server.server_port}/'
        args.ready = "document.querySelector('#piece-picker-dialog')?.open"
    args.output.mkdir(parents=True, exist_ok=True)
    observations = []
    with tempfile.TemporaryDirectory(prefix='choir-startup-audit-') as profile:
        process = subprocess.Popen([
            str(CHROME), '--headless=new', '--remote-allow-origins=*',
            '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank',
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / 'DevToolsActivePort'
            for _ in range(120):
                if port_file.exists():
                    break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            socket = websocket.create_connection(next(t for t in tabs if t['type'] == 'page')['webSocketDebuggerUrl'], timeout=20)
            command(socket, 1, 'Page.enable')
            command(socket, 2, 'Network.enable')
            command(socket, 3, 'Emulation.setDeviceMetricsOverride', {
                'width': 390 if args.mobile else 1366, 'height': 844 if args.mobile else 768,
                'deviceScaleFactor': 3 if args.mobile else 1, 'mobile': args.mobile,
            })
            command(socket, 4, 'Emulation.setCPUThrottlingRate', {'rate': args.cpu_rate})
            if args.slow_network:
                command(socket, 5, 'Network.emulateNetworkConditions', {
                    'offline': False, 'latency': 150, 'downloadThroughput': 200_000,
                    'uploadThroughput': 93_750, 'connectionType': 'cellular4g',
                })
            command(socket, 6, 'Page.addScriptToEvaluateOnNewDocument', {
                'source': OBSERVER + '\nsetInterval(()=>{if(startupAudit.readyAt===null&&('
                + args.ready + '))startupAudit.readyAt=performance.now()},50);',
            })
            for attempt in range(args.attempts):
                command(socket, 7, 'Page.navigate', {'url': args.url})
                deadline = time.monotonic() + args.timeout
                while time.monotonic() < deadline:
                    state = evaluate(socket, 8, 'window.startupAudit?.readyAt != null')
                    if state:
                        break
                    time.sleep(.2)
                result = evaluate(socket, 9, """(()=>({
                  page:location.origin+location.pathname,
                  ...window.startupAudit,
                  elapsed:performance.now(),
                  status:document.querySelector('#auth-status')?.textContent,
                  overflow:document.documentElement.scrollWidth>innerWidth,
                  navigation:performance.getEntriesByType('navigation').map(e=>({
                    ttfb:e.responseStart-e.requestStart,domInteractive:e.domInteractive,
                    domContentLoaded:e.domContentLoadedEventEnd,load:e.loadEventEnd,
                    encoded:e.encodedBodySize,decoded:e.decodedBodySize})),
                  resources:performance.getEntriesByType('resource').map(e=>({
                    url:new URL(e.name).origin+new URL(e.name).pathname,
                    start:e.startTime,ttfb:e.responseStart?e.responseStart-e.requestStart:null,
                    duration:e.duration,transfer:e.transferSize,encoded:e.encodedBodySize,
                    decoded:e.decodedBodySize,protocol:e.nextHopProtocol})),
                }))()""")
                result.update(attempt=attempt + 1, browserCache='fresh profile' if attempt == 0 else 'same profile revisit')
                if result.get('readyAt') is None:
                    result['timedOut'] = True
                observations.append(result)
                if args.home_fixture and result.get('readyAt') is not None:
                    result['motion'] = []
                    for paused in (False, True):
                        if paused:
                            evaluate(socket, 12, "document.querySelector('#home-pause').click()")
                        sample = evaluate(socket, 13, """new Promise(resolve=>{
                          const start=performance.now(),times=[];let last=start;
                          function frame(now){times.push(now-last);last=now;
                            if(now-start<3000)requestAnimationFrame(frame);else{
                              times.sort((a,b)=>a-b);
                              resolve({frames:times.length,elapsed:now-start,
                                p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],
                                max:Math.max(...times),
                                longTasks:startupAudit.longTasks.filter(e=>e.start>=start)});
                            }}requestAnimationFrame(frame);
                        })""")
                        sample['paused'] = paused
                        result['motion'].append(sample)
                elif not args.home_fixture:
                    result['authScriptHeaders'] = evaluate(socket, 14, """fetch('/auth-client.js',{method:'HEAD'}).then(r=>({
                      status:r.status,cache:r.headers.get('cache-control'),encoding:r.headers.get('content-encoding'),
                      length:r.headers.get('content-length'),vary:r.headers.get('vary')
                    })).catch(()=>null)""")
                screenshot = command(socket, 10, 'Page.captureScreenshot', {'format': 'png'})['data']
                (args.output / f'attempt-{attempt+1}.png').write_bytes(base64.b64decode(screenshot))
                summary = {key: result.get(key) for key in ('attempt', 'page', 'readyAt', 'timedOut', 'status')}
                summary['scripts'] = [r for r in result['resources'] if r['url'].endswith('/auth-client.js')]
                if 'motion' in result:
                    summary['motion'] = result['motion']
                print(json.dumps(summary), flush=True)
                command(socket, 11, 'Page.navigate', {'url': 'about:blank'})
        finally:
            (args.output / 'result.json').write_text(json.dumps({
                'syntheticNetwork': args.slow_network, 'cpuRate': args.cpu_rate,
                'mobile': args.mobile, 'observations': observations,
                'syntheticProfile': args.home_fixture, 'sessionDelaySeconds': args.session_delay,
            }, indent=2), encoding='utf-8')
            if socket:
                socket.close()
            process.terminate()
            process.wait(timeout=15)
            if server:
                server.shutdown()


if __name__ == '__main__':
    main()
