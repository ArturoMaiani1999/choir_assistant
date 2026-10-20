"""Read the authorized staging tab through a local ADB/CDP forward.

Does not start playback, microphone capture or change browser settings.
Use adb forward tcp:9223 localabstract:chrome_devtools_remote first.
"""
import argparse
from contextlib import closing
import json
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

import websocket
from browser_practice_smoke import command, evaluate

SNAPSHOT = """(()=>({
  build:typeof RUNTIME_CONFIG!=='undefined'?RUNTIME_CONFIG.buildVersion:null,
  visibility:document.visibilityState,
  echo:typeof echoCancellationUI!=='undefined'?echoCancellationUI?.diagnostics():null,
  lifecycle:typeof echoCancellationUI!=='undefined'?echoCancellationUI?.lifecycle?.():null,
  microphone:typeof state!=='undefined'?state.microphoneStatus:null,
  running:typeof state!=='undefined'?state.clock?.running:null,
  dialogs:Array.from(document.querySelectorAll('dialog[open]')).map(d=>d.id),
  pending:typeof echoDiagnosticsUI!=='undefined'?echoDiagnosticsUI?.hasPending():null,
  diagnosticBusy:typeof echoDiagnosticsUI!=='undefined'?echoDiagnosticsUI?.isBusy():null,
  calibration:document.querySelector('#settings-calibration-status')?.textContent,
  calibrationInstruction:document.querySelector('#calibration-instruction')?.textContent,
  calibrationStatus:document.querySelector('#calibration-status')?.textContent
}))()"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=9223)
    parser.add_argument('--foreground', action='store_true')
    parser.add_argument('--output', type=Path, default=Path('artifacts/echo-lifecycle/device-state.json'))
    args = parser.parse_args()
    pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{args.port}/json', timeout=5))
    allowed = [p for p in pages if p.get('type') == 'page' and
               urlsplit(p.get('url', '')).hostname == 'staging.epistrophe.it']
    if len(allowed) != 1:
        parser.error(f'Expected exactly one staging tab, found {len(allowed)}')
    endpoint = allowed[0]['webSocketDebuggerUrl']
    if urlsplit(endpoint).hostname not in ('localhost', '127.0.0.1'):
        parser.error('CDP endpoint must remain local')
    with closing(websocket.create_connection(endpoint, timeout=15, suppress_origin=True)) as socket:
        if args.foreground:
            command(socket, 1, 'Page.bringToFront')
        result = evaluate(socket, 2, SNAPSHOT)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    summary = {k: v for k, v in result.items() if k != 'lifecycle'}
    summary['lifecycleEvents'] = len((result.get('lifecycle') or {}).get('events', []))
    print(json.dumps(summary, ensure_ascii=True))


if __name__ == '__main__':
    main()
