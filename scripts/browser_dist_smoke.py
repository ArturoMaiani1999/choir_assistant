"""Smoke-test the static release candidate in a real Chromium instance."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

import websocket

CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def command(socket, call_id, method, params=None):
    socket.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
    while True:
        message = json.loads(socket.recv())
        if message.get("id") != call_id:
            continue
        if message.get("result", {}).get("exceptionDetails"):
            raise RuntimeError(message["result"]["exceptionDetails"])
        return message.get("result", {})


def evaluate(socket, call_id, expression):
    result = command(socket, call_id, "Runtime.evaluate", {
        "expression": expression,
        "returnByValue": True,
        "awaitPromise": True,
    })
    return result["result"].get("value")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--url",
        default="https://127.0.0.1:8788/?piece=ave-verum&part=P3",
    )
    args = parser.parse_args()
    expected_origin = f"{urlsplit(args.url).scheme}://{urlsplit(args.url).netloc}"
    sys.stdout.reconfigure(encoding="utf-8")

    with tempfile.TemporaryDirectory(prefix="choir-dist-smoke-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu",
            "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required",
            "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
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
                raise RuntimeError("Chrome non si è avviato")
            port = port_file.read_text(encoding="utf-8").splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(tab for tab in tabs if tab.get("type") == "page")
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=20)
            command(socket, 1, "Page.enable")
            command(socket, 2, "Runtime.enable")
            command(socket, 3, "Page.addScriptToEvaluateOnNewDocument", {"source": r"""
              window.__releaseSmokeErrors = [];
              addEventListener('error', event => window.__releaseSmokeErrors.push({
                kind: 'error', message: event.message || 'resource error',
                resource: event.target?.src || event.target?.href || null
              }), true);
              addEventListener('unhandledrejection', event => window.__releaseSmokeErrors.push({
                kind: 'rejection', message: String(event.reason?.message || event.reason)
              }));
              addEventListener('securitypolicyviolation', event => window.__releaseSmokeErrors.push({
                kind: 'csp', message: event.violatedDirective, resource: event.blockedURI
              }));
              const nativeFetch = window.fetch.bind(window);
              window.fetch = (...args) => nativeFetch(...args).then(response => {
                if (!response.ok) window.__releaseSmokeErrors.push({
                  kind: 'fetch', message: String(response.status), resource: response.url
                });
                return response;
              });
            """})
            command(socket, 4, "Page.navigate", {"url": args.url})

            call_id = 10
            for _ in range(160):
                ready = evaluate(socket, call_id, """Boolean(
                  typeof state !== 'undefined' && state.runtime && state.bundleManifest
                  && document.querySelector('#score-image')?.complete
                  && document.querySelector('#score-image')?.naturalWidth
                )""")
                call_id += 1
                if ready:
                    break
                time.sleep(.1)
            else:
                diagnostics = evaluate(socket, call_id, """({
                  loading: document.querySelector('#score-loading')?.textContent,
                  scoreSource: document.querySelector('#score-image')?.currentSrc,
                  scoreComplete: document.querySelector('#score-image')?.complete,
                  scoreNaturalWidth: document.querySelector('#score-image')?.naturalWidth,
                  runtimeReady: typeof state !== 'undefined' && Boolean(state.runtime),
                  bundleReady: typeof state !== 'undefined' && Boolean(state.bundleManifest),
                  pageTitle: document.querySelector('#piece-title')?.textContent,
                  errors: window.__releaseSmokeErrors
                })""")
                raise AssertionError(
                    "La pagina di pratica non è pronta: "
                    + json.dumps(diagnostics, ensure_ascii=False)
                )

            microphone = evaluate(socket, call_id, """(async () => {
              await toggleMicrophone();
              await new Promise(resolve => setTimeout(resolve, 700));
              const result = {
                status: state.microphoneStatus,
                worker: Boolean(state.pitchWorker),
                workerDisabled: state.pitchWorkerDisabled
              };
              await stopMicrophone();
              return result;
            })()""")
            call_id += 1
            result = evaluate(socket, call_id, """(() => ({
              mode: window.ChoirRuntimeConfig?.mode,
              buildVersion: window.ChoirRuntimeConfig?.buildVersion,
              pieces: state.library.map(piece => piece.piece_id),
              bundlePiece: state.bundleManifest?.piece_id,
              published: state.bundleManifest?.published,
              selectedPart: state.runtime?.selectedPartId,
              transposeChoices: document.querySelector('#transpose')?.options.length,
              diagnosticsHidden: document.querySelector('#benchmark')?.hidden
                && document.querySelector('#admin-review')?.hidden,
              scoreReady: Boolean(document.querySelector('#score-image')?.naturalWidth),
              audioSource: document.querySelector('#backing-audio')?.currentSrc,
              errors: window.__releaseSmokeErrors,
              resources: performance.getEntriesByType('resource').map(entry => entry.name)
            }))()""")

            external = []
            for resource in result["resources"]:
                parsed = urlsplit(resource)
                if parsed.scheme in {"data", "blob", ""}:
                    continue
                origin = f"{parsed.scheme}://{parsed.netloc}"
                if origin != expected_origin:
                    external.append(resource)

            assert result["mode"] == "production", result
            assert result["pieces"] == ["ave-verum"], result
            assert result["bundlePiece"] == "ave-verum" and result["published"] is True, result
            assert result["selectedPart"] == "P3", result
            assert result["transposeChoices"] == 1 and result["diagnosticsHidden"], result
            assert result["scoreReady"] and "/library-assets/ave-verum/" in result["audioSource"], result
            assert microphone == {"status": "active", "worker": True, "workerDisabled": False}, microphone
            assert not result["errors"], result["errors"]
            assert not external, external
            print(json.dumps({
                "buildVersion": result["buildVersion"],
                "piece": result["bundlePiece"],
                "part": result["selectedPart"],
                "resourceCount": len(result["resources"]),
                "microphone": microphone,
                "externalRequests": external,
                "errors": result["errors"],
            }, ensure_ascii=False, indent=2))
        finally:
            if socket is not None:
                socket.close()
            process.terminate()
            process.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
