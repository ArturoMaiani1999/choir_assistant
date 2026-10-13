"""Decode every published audio stem in Chromium and check for silent/duplicate channels."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

from browser_dist_smoke import CHROME, command, evaluate

BASE = "https://127.0.0.1:8788"
ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe-audio", nargs="+", help="Decode selected same-origin audio paths only")
    parser.add_argument("--report-only", action="store_true", help="Report silent channels without failing early")
    args = parser.parse_args()
    pieces = [item["id"] for item in json.loads((ROOT / "deploy/repertoire.json").read_text(encoding="utf-8"))["pieces"]]
    with tempfile.TemporaryDirectory(prefix="choir-audio-audit-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu", "--ignore-certificate-errors",
            "--remote-allow-origins=*", "--remote-debugging-port=0",
            f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        socket = None
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(120):
                if port_file.exists():
                    break
                time.sleep(.05)
            else:
                raise RuntimeError("Chromium non avviato")
            port = port_file.read_text(encoding="utf-8").splitlines()[0]
            pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(item for item in pages if item.get("type") == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=90)
            command(socket, 1, "Page.enable")
            command(socket, 2, "Runtime.enable")
            command(socket, 3, "Page.navigate", {"url": BASE})
            time.sleep(.8)
            if args.probe_audio:
                expression = """(async () => {
                  const paths = PATHS, context = new AudioContext(), result = {};
                  try {
                    for (const path of paths) {
                      const response = await fetch(path);
                      const samples = (await context.decodeAudioData(await response.arrayBuffer())).getChannelData(0);
                      let power = 0, count = 0;
                      for (let i = 0; i < samples.length; i += 256) { power += samples[i] ** 2; count++; }
                      result[path] = Math.sqrt(power / count);
                    }
                    return result;
                  } finally { await context.close(); }
                })()""".replace("PATHS", json.dumps(args.probe_audio))
                print(json.dumps(evaluate(socket, 4, expression), ensure_ascii=False), flush=True)
                return 0
            for index, piece_id in enumerate(pieces, 10):
                expression = """(async () => {
                  const piece = PIECE;
                  const root = `/library-assets/${piece}`;
                  const manifest = await (await fetch(`${root}/audio-manifest.json`)).json();
                  const context = new AudioContext();
                  try {
                    const filenames = [manifest.full_mix_file, manifest.accompaniment_file,
                      ...Object.values(manifest.voice_stems)].filter(Boolean);
                    const decoded = {};
                    for (const file of filenames) {
                      const response = await fetch(`${root}/${file}`);
                      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
                      decoded[file] = (await context.decodeAudioData(await response.arrayBuffer())).getChannelData(0);
                    }
                    const rms = {};
                    for (const [file, samples] of Object.entries(decoded)) {
                      let power = 0, count = 0;
                      for (let i = 0; i < samples.length; i += 256) { power += samples[i] ** 2; count++; }
                      rms[file] = Math.sqrt(power / count);
                    }
                    const correlation = {};
                    const base = decoded[manifest.accompaniment_file];
                    if (base) for (const file of Object.values(manifest.voice_stems)) {
                      const voice = decoded[file];
                      let dot = 0, aa = 0, bb = 0;
                      for (let i = 0; i < Math.min(base.length, voice.length); i += 256) {
                        dot += base[i] * voice[i]; aa += base[i] ** 2; bb += voice[i] ** 2;
                      }
                      correlation[file] = dot / Math.sqrt(aa * bb);
                    }
                    return { rms, correlation };
                  } finally { await context.close(); }
                })()""".replace("PIECE", json.dumps(piece_id))
                result = evaluate(socket, index, expression)
                if (not result or any(level <= .0001 for level in result["rms"].values())) and not args.report_only:
                    raise AssertionError(f"{piece_id}: stem silenzioso o non decodificabile: {result}")
                if any(abs(value) > .95 for value in result["correlation"].values() if value is not None) and not args.report_only:
                    raise AssertionError(f"{piece_id}: stem vocale troppo simile alla base: {result}")
                print(json.dumps({"piece": piece_id, **result}, ensure_ascii=False), flush=True)
        finally:
            if socket:
                socket.close()
            process.terminate()
            process.wait(timeout=10)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
