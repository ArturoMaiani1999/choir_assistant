"""Read benchmark metadata from an isolated copy of the app's IndexedDB.

This never opens Chrome on the user's live profile and never changes the source
database. It is a local migration/verification aid for versioning real baselines.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def command(socket, call_id, method, params=None):
    socket.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
    while True:
        message = json.loads(socket.recv())
        if message.get("id") == call_id:
            details = message.get("result", {}).get("exceptionDetails")
            if details:
                raise RuntimeError(details)
            return message.get("result", {})


def evaluate(socket, call_id, expression):
    result = command(socket, call_id, "Runtime.evaluate", {
        "expression": expression, "returnByValue": True, "awaitPromise": True,
    })
    return result["result"].get("value")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--indexeddb", type=Path, required=True,
                        help="Chrome Default/IndexedDB directory to copy read-only")
    parser.add_argument("--url", default="http://127.0.0.1:5173/?pitchTestHooks=1")
    parser.add_argument("--crepe", action="store_true", help="Run the app's local CREPE v5 comparison")
    args = parser.parse_args()
    source = args.indexeddb.resolve()
    if not source.is_dir() or "IndexedDB" not in source.parts:
        raise SystemExit(f"Invalid IndexedDB source: {source}")

    with tempfile.TemporaryDirectory(prefix="choir-pitch-archive-") as profile:
        target = Path(profile) / "Default" / "IndexedDB"
        shutil.copytree(source, target)
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            "--autoplay-policy=no-user-gesture-required",
            "--remote-debugging-port=0", f"--user-data-dir={profile}", args.url,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            for _ in range(120):
                if port_file.is_file():
                    break
                time.sleep(.05)
            if not port_file.is_file():
                raise RuntimeError('Chrome did not expose a DevTools port')
            port = port_file.read_text(encoding="utf-8").splitlines()[0]
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
            page = next(tab for tab in tabs if tab.get("type") == "page" and tab.get("url", "").startswith(args.url.split('?')[0]))
            socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=600)
            try:
                command(socket, 1, "Runtime.enable")
                for _ in range(80):
                    origin = evaluate(socket, 10, "location.origin")
                    if origin == "http://127.0.0.1:5173":
                        break
                    time.sleep(.1)
                if origin != "http://127.0.0.1:5173":
                    raise RuntimeError(f"Unexpected page origin: {origin}")
                for _ in range(80):
                    hooks_ready = evaluate(socket, 11, "Boolean(window.__pitchTestHooks)")
                    if hooks_ready:
                        break
                    time.sleep(.1)
                if not hooks_ready:
                    raise RuntimeError('Pitch hooks did not initialize')
                result = evaluate(socket, 2, """new Promise((resolve, reject) => {
                  const request = indexedDB.open('choir-ground-truth', 2);
                  request.onerror = () => reject(request.error?.message || 'open failed');
                  request.onsuccess = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains('benchmark-takes')) {
                      resolve({stores: [...db.objectStoreNames], takes: []}); return;
                    }
                    const all = db.transaction('benchmark-takes').objectStore('benchmark-takes').getAll();
                    all.onerror = () => reject(all.error?.message || 'getAll failed');
                    all.onsuccess = async () => {
                      const summaries = [];
                      for (const take of all.result) {
                        const frames = take.frames || [];
                        const voiced = frames.filter(f => f.voicing === 'voiced' && Number.isFinite(f.trackedHz));
                        const errors = voiced.filter(f => Number.isFinite(f.targetMidiPitch)).map(f =>
                          1200 * Math.log2(f.trackedHz / (440 * Math.pow(2, (f.targetMidiPitch - 69) / 12))));
                        const sorted = errors.map(Math.abs).sort((a, b) => a - b);
                        const mean = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
                        const jitter = errors.length ? Math.sqrt(errors.reduce((sum, x) => sum + (x - mean) ** 2, 0) / errors.length) : null;
                        let largeJumps = 0;
                        for (let i = 1; i < voiced.length; i += 1) {
                          if (voiced[i].audioTimeSec - voiced[i - 1].audioTimeSec <= .12
                            && Math.abs(1200 * Math.log2(voiced[i].trackedHz / voiced[i - 1].trackedHz)) > 700) largeJumps += 1;
                        }
                        const digestInput = JSON.stringify(frames.map(f => [f.audioTimeSec, f.trackedHz, f.voicing]));
                        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(digestInput)))]
                          .map(x => x.toString(16).padStart(2, '0')).join('');
                        const hookTakeId = __pitchTestHooks.loadRecordedTake(take);
                        summaries.push({
                          id: take.id, scenarioId: take.scenarioId, repetition: take.repetition,
                          pieceId: take.pieceId, partId: take.partId, acceptedAt: take.acceptedAt,
                          durationSec: (take.endAudioTimeSec || 0) - (take.startAudioTimeSec || 0),
                          metrics: {frameCount: frames.length, voicedFrameCount: voiced.length,
                            voicedPercent: frames.length ? voiced.length / frames.length * 100 : 0,
                            medianErrorCents: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
                            jitterCents: jitter, settlingTimeMs: null, overshootCents: null,
                            octaveErrorRate: errors.length ? errors.filter(x => Math.abs(Math.abs(x) - 1200) <= 100).length / errors.length : 0,
                            largeJumpsOver700Cents: largeJumps},
                          hookMetrics: __pitchTestHooks.getMetrics(hookTakeId, 'v1'), streamSha256: hash
                        });
                      }
                      resolve({stores: [...db.objectStoreNames], takes: summaries});
                    };
                  };
                })""")
                if args.crepe:
                    result["crepeComparison"] = evaluate(socket, 3, """(async () => {
                      await refreshBenchmarkArchive();
                      const take = state.benchmark.savedTakes.find(item => item.scenarioId === 'T01'
                        && item.repetition === 1 && item.pieceId === 'o-sacrum' && item.partId === 'P3');
                      if (!take) throw Error('T01/P3 missing');
                      await ensureBenchmarkV5(take);
                      if (!take._v5Frames?.length) throw Error(take._v5Status || 'CREPE produced no frames');
                      const hookId = __pitchTestHooks.loadRecordedTake(take);
                      const baseline = __pitchTestHooks.runAlgorithm(hookId, 'v1');
                      const defaultCandidate = __pitchTestHooks.runAlgorithm(hookId, 'v1 + display-filter');
                      const defaultMetrics = __pitchTestHooks.getMetrics(hookId, 'v1 + display-filter', 'displayPitch');
                      const compare = stream => {
                        let sourceIndex = 0; const errors = [];
                        for (const frame of take._v5Frames) {
                          while (sourceIndex + 1 < stream.length
                            && Math.abs(stream[sourceIndex + 1].tSec - frame.audioTimeSec) <= Math.abs(stream[sourceIndex].tSec - frame.audioTimeSec)) sourceIndex += 1;
                          const current = stream[sourceIndex];
                          if (current?.voiced && Number.isFinite(current.hz) && Number.isFinite(frame.v5Hz))
                            errors.push(Math.abs(1200 * Math.log2(current.hz / frame.v5Hz)));
                        }
                        errors.sort((a, b) => a - b);
                        return {matchedFrames: errors.length, medianErrorCents: errors[Math.floor(errors.length / 2)] ?? null};
                      };
                      const streamDiff = (tracked, display) => {
                        const differences = []; let comparableFrames = 0; let changedFrames = 0;
                        for (let index = 0; index < Math.min(tracked.length, display.length); index += 1) {
                          const left = tracked[index], right = display[index];
                          if (!left?.voiced || !right?.voiced || !Number.isFinite(left.hz) || !Number.isFinite(right.hz)) continue;
                          comparableFrames += 1;
                          const cents = Math.abs(1200 * Math.log2(right.hz / left.hz));
                          differences.push(cents);
                          if (left.hz !== right.hz) changedFrames += 1;
                        }
                        differences.sort((a, b) => a - b);
                        const at = ratio => differences[Math.min(differences.length - 1, Math.floor(differences.length * ratio))] ?? null;
                        const changedOverPointOneCent = differences.filter(value => value > .1).length;
                        const changedOverOneCent = differences.filter(value => value > 1).length;
                        const medianAbsDiffCents = at(.5), p95AbsDiffCents = at(.95);
                        return {comparableFrames, changedFrames, exactIdentity: changedFrames === 0,
                          changedOverPointOneCent, changedOverOneCent,
                          changedOverPointOneCentPercent: comparableFrames ? changedOverPointOneCent / comparableFrames * 100 : 0,
                          changedOverOneCentPercent: comparableFrames ? changedOverOneCent / comparableFrames * 100 : 0,
                          medianAbsDiffCents, p95AbsDiffCents, maxAbsDiffCents: differences.at(-1) ?? null,
                          nonTrivial: medianAbsDiffCents >= .05 || p95AbsDiffCents >= 1};
                      };
                      let previous = null, snapResets = 0, adjacentVoiced = 0;
                      for (const frame of baseline.trackedPitch) {
                        if (!frame.voiced || !Number.isFinite(frame.hz)) { previous = null; continue; }
                        if (previous) {
                          adjacentVoiced += 1;
                          if (Math.abs(1200 * Math.log2(frame.hz / previous.hz)) >= 1) snapResets += 1;
                        }
                        previous = frame;
                      }
                      const candidates = [0, .001, 1, 100, 300].map(beta => {
                        const candidate = __pitchTestHooks.runAlgorithm(hookId, 'v1 + display-filter',
                          {displayFilter: {minCutoff: .05, beta, dCutoff: .2}});
                        return {beta, ...compare(candidate.displayPitch), diffFromTracked: streamDiff(candidate.trackedPitch, candidate.displayPitch)};
                      });
                      const diagnosticLowPass = __pitchTestHooks.runAlgorithm(hookId, 'v1 + display-filter',
                        {displayFilter: {minCutoff: .05, beta: 0, dCutoff: .2, snapThreshold: Number.POSITIVE_INFINITY}});
                      const jumpEvents = (stream, timeKey, hzKey) => {
                        const voiced = stream.map((frame, sourceIndex) => ({frame, sourceIndex})).filter(item => Number.isFinite(item.frame[hzKey]));
                        const jumps = [];
                        for (let index = 1; index < voiced.length; index += 1) {
                          const previousItem = voiced[index - 1], currentItem = voiced[index];
                          const previous = previousItem.frame, current = currentItem.frame;
                          if (current[timeKey] - previous[timeKey] > .12) continue;
                          const cents = 1200 * Math.log2(current[hzKey] / previous[hzKey]);
                          if (Math.abs(cents) > 700) jumps.push({tSec: current[timeKey], beat: current.beat ?? null, cents,
                            sourceIndex: currentItem.sourceIndex, framesSkipped: currentItem.sourceIndex - previousItem.sourceIndex - 1,
                            afterVoicingGap: currentItem.sourceIndex - previousItem.sourceIndex > 1,
                            gapMs: (current[timeKey] - previous[timeKey]) * 1000,
                            current: {hz: current[hzKey], rawHz: current.rawHz ?? null, clarity: current.clarity ?? null,
                              confidence: current.confidence ?? current.v5Confidence ?? null, rejectionReason: current.rejectionReason ?? null},
                            previous: {hz: previous[hzKey], rawHz: previous.rawHz ?? null, clarity: previous.clarity ?? null,
                              confidence: previous.confidence ?? previous.v5Confidence ?? null, rejectionReason: previous.rejectionReason ?? null}});
                        }
                        return jumps;
                      };
                      const fixedWindowExcursions = (stream, timeKey, hzKey, windowSec = .1, thresholdCents = 700) => {
                        const voiced = stream.filter(frame => Number.isFinite(frame[hzKey])).sort((a, b) => a[timeKey] - b[timeKey]);
                        const candidates = [];
                        let segmentStart = 0;
                        for (let index = 0; index < voiced.length; index += 1) {
                          if (index && voiced[index][timeKey] - voiced[index - 1][timeKey] > windowSec) segmentStart = index;
                          let strongest = null;
                          for (let previous = index - 1; previous >= segmentStart; previous -= 1) {
                            const elapsed = voiced[index][timeKey] - voiced[previous][timeKey];
                            if (elapsed > windowSec) break;
                            const cents = 1200 * Math.log2(voiced[index][hzKey] / voiced[previous][hzKey]);
                            if (!strongest || Math.abs(cents) > Math.abs(strongest.cents)) strongest = {cents, elapsedMs: elapsed * 1000};
                          }
                          if (strongest && Math.abs(strongest.cents) > thresholdCents)
                            candidates.push({tSec: voiced[index][timeKey], beat: voiced[index].beat ?? null, ...strongest});
                        }
                        const episodes = [];
                        for (const candidate of candidates) {
                          const current = episodes.at(-1);
                          if (!current || candidate.tSec - current.endSec > windowSec) episodes.push({startSec: candidate.tSec, endSec: candidate.tSec, peak: candidate});
                          else { current.endSec = candidate.tSec; if (Math.abs(candidate.cents) > Math.abs(current.peak.cents)) current.peak = candidate; }
                        }
                        return {definition: `max |delta| within ${windowSec * 1000} ms; voiced gaps >${windowSec * 1000} ms split episodes`, count: episodes.length, episodes};
                      };
                      const v1Jumps = jumpEvents(take.frames.filter(frame => frame.voicing === 'voiced'), 'audioTimeSec', 'trackedHz');
                      const crepeJumps = jumpEvents(take._v5Frames, 'audioTimeSec', 'v5Hz');
                      const onsetFrames = [];
                      let previousTarget = null;
                      for (const frame of take.frames) {
                        if (!Number.isFinite(frame.targetMidiPitch)) { previousTarget = null; continue; }
                        if (frame.targetMidiPitch !== previousTarget) onsetFrames.push({tSec: frame.audioTimeSec, beat: frame.beat,
                          measure: (take.targetEvents || []).find(event => event.onsetBeat <= frame.beat
                            && frame.beat < event.onsetBeat + event.durationBeats)?.measureNumber ?? null});
                        previousTarget = frame.targetMidiPitch;
                      }
                      const posteriorAudioFrames = (take._v5Frames || []).map((frame, index) => {
                        const distribution = take._v5Posteriors?.audio?.[index], grid = take._v5Posteriors?.grid;
                        if (!distribution?.length || !grid?.length) return {...frame, posteriorAudioHz: null};
                        let peak = 0;
                        for (let candidate = 1; candidate < distribution.length; candidate += 1)
                          if (distribution[candidate] > distribution[peak]) peak = candidate;
                        return {...frame, posteriorAudioHz: 440 * Math.pow(2, (grid[peak] - 69) / 12)};
                      });
                      const onsetProfile = (stream, timeKey, hzKey, onsetTime, targetMidi, direction, supportsVoicing) => {
                        const window = stream.map((frame, sourceIndex) => ({frame, sourceIndex}))
                          .filter(item => item.frame[timeKey] >= onsetTime - .1 && item.frame[timeKey] <= onsetTime + .15);
                        let oppositeDepthCents = 0, preOnsetOppositeDepthCents = 0, postOnsetOppositeDepthCents = 0;
                        let belowTargetDurationMs = 0, preOnsetBelowTargetMs = 0, postOnsetBelowTargetMs = 0, firstVoicedAfterGap = false;
                        const targetHz = 440 * Math.pow(2, (targetMidi - 69) / 12);
                        for (let index = 0; index < window.length; index += 1) {
                          const {frame, sourceIndex} = window[index], hz = frame[hzKey];
                          if (!Number.isFinite(hz)) continue;
                          const signed = 1200 * Math.log2(hz / targetHz);
                          const opposite = direction > 0 ? -signed : direction < 0 ? signed : Math.abs(signed);
                          oppositeDepthCents = Math.max(oppositeDepthCents, opposite);
                          if (frame[timeKey] < onsetTime) preOnsetOppositeDepthCents = Math.max(preOnsetOppositeDepthCents, opposite);
                          else postOnsetOppositeDepthCents = Math.max(postOnsetOppositeDepthCents, opposite);
                          if (signed < -100) {
                            const nextTime = window[index + 1]?.frame?.[timeKey] ?? Math.min(onsetTime + .15, frame[timeKey] + .02);
                            const intervalEnd = Math.min(onsetTime + .15, nextTime), intervalStart = Math.max(onsetTime - .1, frame[timeKey]);
                            const pre = Math.max(0, Math.min(intervalEnd, onsetTime) - intervalStart) * 1000;
                            const post = Math.max(0, intervalEnd - Math.max(intervalStart, onsetTime)) * 1000;
                            preOnsetBelowTargetMs += pre; postOnsetBelowTargetMs += post; belowTargetDurationMs += pre + post;
                          }
                          if (supportsVoicing && frame[timeKey] >= onsetTime - .02 && !firstVoicedAfterGap) {
                            const previous = stream[sourceIndex - 1];
                            firstVoicedAfterGap = !previous || !Number.isFinite(previous[hzKey]) || previous.voicing !== 'voiced';
                          }
                        }
                        return {oppositeDepthCents, preOnsetOppositeDepthCents, postOnsetOppositeDepthCents,
                          belowTargetDurationMs, preOnsetBelowTargetMs, postOnsetBelowTargetMs,
                          startsAfterVoicingGap: supportsVoicing ? firstVoicedAfterGap : null};
                      };
                      const scoreOnsets = (take.targetEvents || []).filter(event => Number.isFinite(event.onsetBeat) && Number.isFinite(event.midiPitch));
                      const onsetAnalysis = scoreOnsets.map((event, index) => {
                        const nearest = take.frames.reduce((best, frame) => !best || Math.abs(frame.beat - event.onsetBeat) < Math.abs(best.beat - event.onsetBeat) ? frame : best, null);
                        const onsetTime = nearest?.audioTimeSec, targetMidi = event.midiPitch + (take.transpose || 0);
                        const previousMidi = index ? scoreOnsets[index - 1].midiPitch + (take.transpose || 0) : targetMidi;
                        const direction = Math.sign(targetMidi - previousMidi);
                        return {measure: event.measureNumber ?? null, beat: event.onsetBeat, onsetTime, targetMidi, direction,
                          v1: onsetProfile(take.frames, 'audioTimeSec', 'trackedHz', onsetTime, targetMidi, direction, true),
                          crepe: onsetProfile(take._v5Frames, 'audioTimeSec', 'v5Hz', onsetTime, targetMidi, direction, false),
                          posteriorAudio: onsetProfile(posteriorAudioFrames, 'audioTimeSec', 'posteriorAudioHz', onsetTime, targetMidi, direction, false)};
                      });
                      const unmatchedCrepe = new Set(crepeJumps);
                      const attackComparison = v1Jumps.map(jump => {
                        const nearestCrepe = [...unmatchedCrepe].filter(item => Math.sign(item.cents) === Math.sign(jump.cents))
                          .reduce((best, item) => !best || Math.abs(item.tSec - jump.tSec) < Math.abs(best.tSec - jump.tSec) ? item : best, null);
                        const nearestOnset = onsetFrames.reduce((best, item) => !best || Math.abs(item.tSec - jump.tSec) < Math.abs(best.tSec - jump.tSec) ? item : best, null);
                        const crepeJump = nearestCrepe && Math.abs(nearestCrepe.tSec - jump.tSec) <= .15 ? nearestCrepe : null;
                        if (crepeJump) unmatchedCrepe.delete(crepeJump);
                        return {...jump,
                          crepeJump,
                          onset: nearestOnset && Math.abs(nearestOnset.tSec - jump.tSec) <= .3 ? nearestOnset : null};
                      });
                      state.benchmark.selectedTakeId = take.id;
                      openBenchmarkAnalysis();
                      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                      const canvas = els.benchmarkAnalysisRoll;
                      const visualOverlay = {
                        panelVisible: !els.benchmarkAnalysis.hidden,
                        canvasWidth: canvas.width,
                        canvasHeight: canvas.height,
                        layers: {
                          v1: els.benchmarkAnalysisLayerV1?.checked,
                          display: els.benchmarkAnalysisLayerDisplay?.checked,
                          crepe: els.benchmarkAnalysisLayerRaw?.checked,
                        },
                      };
                      if (!visualOverlay.panelVisible || visualOverlay.canvasWidth < 2 || visualOverlay.canvasHeight < 2
                        || !visualOverlay.layers.v1 || !visualOverlay.layers.display || !visualOverlay.layers.crepe)
                        throw Error(`Visual overlay unavailable: ${JSON.stringify(visualOverlay)}`);
                      return {v5Frames: take._v5Frames.length, v5Status: take._v5Status,
                        trackedVsCrepe: compare(baseline.trackedPitch), defaultDisplayVsCrepe: compare(defaultCandidate.displayPitch),
                        defaultDisplayMetrics: defaultMetrics,
                        defaultDiff: streamDiff(defaultCandidate.trackedPitch, defaultCandidate.displayPitch),
                        snapThresholdActivity: {adjacentVoiced, snapResets, percent: adjacentVoiced ? snapResets / adjacentVoiced * 100 : 0},
                        displayVsCrepe: candidates,
                        diagnosticNoSnap: {...compare(diagnosticLowPass.displayPitch),
                          diffFromTracked: streamDiff(diagnosticLowPass.trackedPitch, diagnosticLowPass.displayPitch)},
                        attackComparison: {v1JumpCount: v1Jumps.length, crepeJumpCount: crepeJumps.length,
                          coincidentWithin150Ms: attackComparison.filter(item => item.crepeJump).length,
                          v1Only: attackComparison.filter(item => !item.crepeJump), events: attackComparison,
                          fixedWindow100Ms: {v1: fixedWindowExcursions(take.frames.filter(frame => frame.voicing === 'voiced'), 'audioTimeSec', 'trackedHz'),
                            crepe: fixedWindowExcursions(take._v5Frames, 'audioTimeSec', 'v5Hz')}},
                        onsetAnalysis,
                        visualOverlay};
                    })()""")
                    geometry = evaluate(socket, 4, """(() => {
                      const canvas = els.benchmarkAnalysisRoll;
                      const rect = canvas.getBoundingClientRect();
                      return {canvasX: rect.left + rect.width * .7, canvasY: rect.top + rect.height * .5};
                    })()""")
                    command(socket, 5, "Input.dispatchMouseEvent", {
                        "type": "mousePressed", "x": geometry["canvasX"], "y": geometry["canvasY"],
                        "button": "left", "buttons": 1, "clickCount": 1,
                    })
                    command(socket, 6, "Input.dispatchMouseEvent", {
                        "type": "mouseReleased", "x": geometry["canvasX"], "y": geometry["canvasY"],
                        "button": "left", "buttons": 0, "clickCount": 1,
                    })
                    selected = evaluate(socket, 7, """({
                      beat: state.benchmark.analysisView.selectedBeat,
                      seconds: els.benchmarkAnalysisAudio.currentTime,
                      label: els.benchmarkAnalysisSelection.textContent,
                    })""")
                    play_button = evaluate(socket, 8, """(() => {
                      const rect = els.benchmarkAnalysisPlaySelection.getBoundingClientRect();
                      return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
                    })()""")
                    evaluate(socket, 9, "els.benchmarkAnalysisPlaySelection.click()")
                    time.sleep(.4)
                    playing = evaluate(socket, 12, """({
                      paused: els.benchmarkAnalysisAudio.paused,
                      seconds: els.benchmarkAnalysisAudio.currentTime,
                      button: els.benchmarkAnalysisPlaySelection.textContent,
                      animationActive: state.benchmark.analysisPlaybackRaf != null,
                    })""")
                    evaluate(socket, 13, "els.benchmarkAnalysisPlaySelection.click()")
                    paused = evaluate(socket, 15, "els.benchmarkAnalysisAudio.paused")
                    if not (selected["seconds"] > 0 and not playing["paused"]
                            and playing["seconds"] > selected["seconds"]
                            and playing["animationActive"] and paused):
                        raise RuntimeError(f"Benchmark transport failed: {selected}, {playing}, paused={paused}")
                    result["benchmarkTransport"] = {"selected": selected, "playing": playing, "paused": paused}
                print(json.dumps(result, ensure_ascii=True))
            finally:
                socket.close()
        finally:
            process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    main()
