"""Decode a local recording with Chrome's Web Audio decoder, without uploading it.

Usage: python scripts/decode_pitch_audio.py input.webm output.f32
Writes mono float32 little-endian PCM plus output.f32.json metadata.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import subprocess
import tempfile
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import websocket
from browser_practice_smoke import CHROME, command, evaluate


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    source = args.input.resolve()
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(source.parent)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    try:
        with tempfile.TemporaryDirectory(prefix='pitch-decode-') as profile:
            process = subprocess.Popen([str(CHROME), '--headless=new', '--disable-gpu', '--remote-allow-origins=*',
                                        '--remote-debugging-port=0', f'--user-data-dir={profile}', url],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            socket = None
            try:
                port_file = Path(profile) / 'DevToolsActivePort'
                for _ in range(100):
                    if port_file.exists():
                        break
                    time.sleep(.05)
                port = port_file.read_text().splitlines()[0]
                pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=5))
                page = next(p for p in pages if p.get('type') == 'page')
                socket = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=60)
                command(socket, 1, 'Page.enable')
                for _ in range(100):
                    if evaluate(socket, 4, 'location.href').startswith(url):
                        break
                    time.sleep(.05)
                expression = """(async()=>{
                  const ctx=new AudioContext({sampleRate:48000});
                  try {
                    const buffer=await ctx.decodeAudioData(await (await fetch(SOURCE)).arrayBuffer());
                    const pcm=new Float32Array(buffer.length);
                    for(let c=0;c<buffer.numberOfChannels;c++) {
                      const channel=buffer.getChannelData(c);
                      for(let i=0;i<pcm.length;i++)pcm[i]+=channel[i]/buffer.numberOfChannels;
                    }
                    window.decodedPCM=new Uint8Array(pcm.buffer);
                    return {sampleRate:buffer.sampleRate,channels:buffer.numberOfChannels,
                      sampleCount:pcm.length,durationSec:buffer.duration,format:'float32le',decoder:navigator.userAgent};
                  } finally {await ctx.close();}
                })()""".replace('SOURCE', json.dumps(source.name))
                metadata = evaluate(socket, 2, expression)
                args.output.parent.mkdir(parents=True, exist_ok=True)
                with args.output.open('wb') as output:
                    for offset in range(0, metadata['sampleCount'] * 4, 262144):
                        encoded = evaluate(socket, 3, f"btoa(Array.from(decodedPCM.subarray({offset},{offset + 262144}),v=>String.fromCharCode(v)).join(''))")
                        output.write(base64.b64decode(encoded))
                metadata['sourceSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
                metadata['pcmSha256'] = hashlib.sha256(args.output.read_bytes()).hexdigest()
                args.output.with_suffix(args.output.suffix + '.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
                print(json.dumps(metadata))
            finally:
                if socket:
                    socket.close()
                process.terminate()
                process.wait(timeout=10)
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
