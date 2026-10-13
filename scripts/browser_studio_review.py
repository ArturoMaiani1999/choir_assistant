"""Capture product screens and check usable controls across desktop and mobile."""
import base64
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket
from browser_practice_smoke import command, evaluate, CHROME

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'artifacts' / 'studio-review'
BASE = 'http://127.0.0.1:5188'


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='studio-review-') as profile:
        process = subprocess.Popen([str(CHROME), '--headless=new', '--disable-gpu',
            '--remote-allow-origins=*', '--remote-debugging-port=0',
            f'--user-data-dir={profile}', BASE + '/voice-lab.html'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            port_file = Path(profile) / 'DevToolsActivePort'
            for _ in range(100):
                if port_file.exists():
                    break
                time.sleep(.05)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            socket = websocket.create_connection(next(t for t in tabs if t['type'] == 'page')['webSocketDebuggerUrl'], timeout=15)
            try:
                command(socket, 1, 'Page.enable')
                time.sleep(1)
                reports = []
                for width, height in [(1440, 900), (1366, 768), (390, 844)]:
                    command(socket, 2, 'Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': False})
                    for name, path, action, selector in [
                        ('lab', '/voice-lab.html', "document.querySelector('#lab-settings-close').click()", '#lab-record'),
                        ('listening', '/voice-lab.html', "document.querySelector('#lab-settings-close').click();document.querySelector('[data-activity=ear]').click()", '#lab-answer'),
                        ('answer', '/voice-lab.html', "document.querySelector('#lab-settings-close').click();document.querySelector('[data-activity=ear]').click();document.querySelector('[data-answer]').click()", '#lab-next'),
                        ('practice', '/index.html?piece=o-sacrum', "document.querySelectorAll('dialog[open]').forEach(d=>d.close())", '#toggle-playback'),
                        ('library', '/index.html?piece=o-sacrum', "document.querySelector('#library').click()", '#library-open'),
                    ]:
                        command(socket, 3, 'Page.navigate', {'url': BASE + path})
                        time.sleep(1.5)
                        evaluate(socket, 4, action)
                        time.sleep(.3)
                        report = evaluate(socket, 5, """(() => {
                            const element = document.querySelector(%s), box = element.getBoundingClientRect();
                            return {width:innerWidth, height:innerHeight, box:box.toJSON(), overflow:document.documentElement.scrollWidth > innerWidth,
                              actionVisible: box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth};
                        })()""" % json.dumps(selector))
                        report['screen'] = name
                        reports.append(report)
                        shot = command(socket, 6, 'Page.captureScreenshot', {'format': 'png', 'fromSurface': True})
                        (ARTIFACTS / f'{name}-{width}.png').write_bytes(base64.b64decode(shot['data']))
                        assert not report['overflow'] and report['actionVisible'], report
                print(json.dumps(reports))
            finally:
                socket.close()
        finally:
            process.terminate()
            process.wait(timeout=5)


if __name__ == '__main__':
    main()
