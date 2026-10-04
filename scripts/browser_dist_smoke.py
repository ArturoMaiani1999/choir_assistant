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
from urllib.parse import parse_qs, quote, urlsplit

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
    parsed_url = urlsplit(args.url)
    expected_origin = f"{parsed_url.scheme}://{parsed_url.netloc}"
    query = parse_qs(parsed_url.query)
    expected_piece = query.get("piece", ["ave-verum"])[0]
    expected_part = query.get("part", ["P3"])[0]
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
            command(socket, 5, "Emulation.setDeviceMetricsOverride", {
                "width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False,
            })
            command(socket, 3, "Page.addScriptToEvaluateOnNewDocument", {"source": r"""
              window.__releaseSmokeErrors = [];
              try {
                localStorage.setItem('choir-detector-settings:v1', JSON.stringify({v1PlumeWidth: 1}));
              } catch (_) {}
              window.__getUserMediaCalls = 0;
              if (navigator.mediaDevices?.getUserMedia) {
                const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia = (...args) => {
                  window.__getUserMediaCalls += 1;
                  return nativeGetUserMedia(...args);
                };
              }
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
            resize = evaluate(socket, call_id, """(async () => {
              const before = {score:els.scoreViewport.clientHeight, bitmap:els.pitchLane.height};
              const limits = scoreHeightLimits();
              const target = before.score - 36 >= limits.minimum
                ? before.score - 36 : Math.min(limits.maximum, before.score + 36);
              setScoreHeight(target);
              await new Promise(resolve => requestAnimationFrame(resolve));
              const rect = els.pitchLane.getBoundingClientRect();
              const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
              return {before, score:els.scoreViewport.clientHeight, bitmap:els.pitchLane.height,
                css:rect.height, expected:Math.round(rect.height * dpr)};
            })()""")
            call_id += 1
            result = evaluate(socket, call_id, """(() => ({
              mode: window.ChoirRuntimeConfig?.mode,
              buildVersion: window.ChoirRuntimeConfig?.buildVersion,
              pieces: state.library.map(piece => piece.piece_id),
              bundlePiece: state.bundleManifest?.piece_id,
              published: state.bundleManifest?.published,
              selectedPart: state.runtime?.selectedPartId,
              plumeWidth: state.plumeSettings.width,
              plumeWidthSlider: document.querySelector('#settings-v1-plume-width')?.value,
              plumeWidthLabel: document.querySelector('#settings-v1-plume-width-value')?.textContent,
              transposeChoices: document.querySelector('#transpose')?.options.length,
              diagnosticsHidden: document.querySelector('#benchmark')?.hidden
                && document.querySelector('#admin-review')?.hidden,
              scoreReady: Boolean(document.querySelector('#score-image')?.naturalWidth),
              audioSource: document.querySelector('#backing-audio')?.currentSrc,
              errors: window.__releaseSmokeErrors,
              resources: performance.getEntriesByType('resource').map(entry => entry.name)
            }))()""")
            call_id += 1

            external = []
            for resource in result["resources"]:
                parsed = urlsplit(resource)
                if parsed.scheme in {"data", "blob", ""}:
                    continue
                origin = f"{parsed.scheme}://{parsed.netloc}"
                if origin != expected_origin:
                    external.append(resource)

            assert result["mode"] == "production", result
            assert expected_piece in result["pieces"], result
            assert result["bundlePiece"] == expected_piece and result["published"] is True, result
            assert result["selectedPart"] == expected_part, result
            assert result["plumeWidth"] == 2.5 and result["plumeWidthSlider"] == "250" and result["plumeWidthLabel"] == "250%", result
            assert result["transposeChoices"] == 1 and result["diagnosticsHidden"], result
            assert result["scoreReady"] and f"/library-assets/{expected_piece}/" in result["audioSource"], result
            assert microphone == {"status": "active", "worker": True, "workerDisabled": False}, microphone
            assert resize["score"] != resize["before"]["score"], resize
            assert resize["bitmap"] != resize["before"]["bitmap"] and resize["bitmap"] == resize["expected"], resize
            assert not result["errors"], result["errors"]
            assert not external, external

            viewer_url = f"{expected_origin}/score-viewer.html?piece={quote(expected_piece)}"
            command(socket, call_id, "Page.navigate", {"url": viewer_url})
            call_id += 1
            for _ in range(160):
                viewer_ready = evaluate(socket, call_id, """Boolean(
                  document.querySelectorAll('.viewer-page').length
                  && [...document.querySelectorAll('.viewer-page img')]
                    .every(image => image.complete && image.naturalWidth)
                )""")
                call_id += 1
                if viewer_ready:
                    break
                time.sleep(.1)
            else:
                diagnostics = evaluate(socket, call_id, """({
                  title: document.querySelector('#viewer-title')?.textContent,
                  status: document.querySelector('#viewer-status')?.textContent,
                  pages: document.querySelectorAll('.viewer-page').length,
                  errors: window.__releaseSmokeErrors
                })""")
                raise AssertionError(
                    "La modalità Partitura non è pronta: "
                    + json.dumps(diagnostics, ensure_ascii=False)
                )

            command(socket, call_id, "Emulation.setDeviceMetricsOverride", {
                "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True,
            })
            call_id += 1
            viewer = evaluate(socket, call_id, r"""(async () => {
              const grayPaper = document.querySelector('[data-paper="#e3e8e6"]');
              grayPaper.click();
              window.scrollTo(0, 500);
              await new Promise(resolve => setTimeout(resolve, 150));
              const resources = performance.getEntriesByType('resource').map(entry => entry.name);
              return {
                pageCount: document.querySelectorAll('.viewer-page').length,
                getUserMediaCalls: window.__getUserMediaCalls,
                hasPitchUi: Boolean(document.querySelector(
                  'canvas, audio, #pitch-lane, .pitch-region, #microphone, #microphone-level'
                )),
                forbiddenResources: resources.filter(resource =>
                  /pitch_detector|pitch_shared|fluid_pitch_trail|vocal_feedback|\/app\.[a-f0-9]+\.js/.test(resource)
                ),
                bodyWidth: document.body.scrollWidth,
                viewportWidth: innerWidth,
                toolbarTop: document.querySelector('.viewer-toolbar').getBoundingClientRect().top,
                paperColor: getComputedStyle(document.documentElement).getPropertyValue('--score-paper').trim(),
                savedPaperColor: localStorage.getItem('choir-score-paper:v1'),
                grayPaperPressed: grayPaper.getAttribute('aria-pressed'),
                errors: window.__releaseSmokeErrors,
                resources
              };
            })()""")

            viewer_external = []
            for resource in viewer["resources"]:
                resource_url = urlsplit(resource)
                if resource_url.scheme in {"data", "blob", ""}:
                    continue
                origin = f"{resource_url.scheme}://{resource_url.netloc}"
                if origin != expected_origin:
                    viewer_external.append(resource)

            assert viewer["pageCount"] > 0, viewer
            assert viewer["getUserMediaCalls"] == 0, viewer
            assert not viewer["hasPitchUi"], viewer
            assert not viewer["forbiddenResources"], viewer
            assert viewer["bodyWidth"] <= viewer["viewportWidth"], viewer
            assert abs(viewer["toolbarTop"]) < 1, viewer
            assert viewer["paperColor"] == "#e3e8e6", viewer
            assert viewer["savedPaperColor"] == "#e3e8e6", viewer
            assert viewer["grayPaperPressed"] == "true", viewer
            assert not viewer["errors"], viewer["errors"]
            assert not viewer_external, viewer_external
            print(json.dumps({
                "buildVersion": result["buildVersion"],
                "piece": result["bundlePiece"],
                "part": result["selectedPart"],
                "defaultPlumeWidth": result["plumeWidthLabel"],
                "resourceCount": len(result["resources"]),
                "microphone": microphone,
                "dividerResize": resize,
                "externalRequests": external,
                "errors": result["errors"],
                "scoreViewer": {
                    "pages": viewer["pageCount"],
                    "getUserMediaCalls": viewer["getUserMediaCalls"],
                    "hasPitchUi": viewer["hasPitchUi"],
                    "forbiddenResources": viewer["forbiddenResources"],
                    "externalRequests": viewer_external,
                },
            }, ensure_ascii=False, indent=2))
        finally:
            if socket is not None:
                socket.close()
            process.terminate()
            process.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
