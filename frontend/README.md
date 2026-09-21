# Practice frontend

This dependency-free browser milestone proves the singer-facing Practice experience: selected-part notation, fixed-NOW musical pitch lane, live browser-local singer trajectory, compact transport and one canonical performance clock.

## Run

```powershell
python scripts/serve_frontend.py
```

Open `http://localhost:5173`. Press **Microfono** and grant permission to activate the live pitch detector; the cyan dot at **ORA** confirms the current detected note even before playback begins. The `Altre voci` accompaniment uses the existing part-specific backing file. Other accompaniment modes are UI/state mocks.

The notation and target events come from the current draft fixture and MuseScore exports. They are not an approved publication. See `docs/PRACTICE_UX_SPEC.md`, `docs/PRACTICE_REDESIGN_PLAN.md`, and `docs/PRACTICE_REDESIGN_PROGRESS.md` for decisions and limitations.

## Admin MuseScore correction loop

Start the local server with `python scripts/serve_frontend.py --port 5173`, open
`http://127.0.0.1:5173/admin-review.html`, then use **Scarica .mscz** and
**Importa .mscz corretto**. Importing archives the uploaded MuseScore file by
content hash, rebuilds MusicXML, runtime events, SVG geometry, guide audio and
the review manifest, and leaves the resulting bundle in `pending_review` with a
new fingerprint. The importer is intentionally available only on the local
admin server.

## Real-time pitch input

Practice uses `getUserMedia` and Web Audio for browser-local, monophonic pitch
detection. Press **Microfono**, grant permission, and use headphones so the
guide track is not detected as the singer. Microphone access works on the local
`127.0.0.1`/`localhost` server and on HTTPS deployments; the audio stream is
processed in memory and is not uploaded or recorded.

## Validation

The toolbar transposition selector shifts the guide audio and practice targets
by -12 to +12 semitones, including octave presets. The displayed score remains
the original notation and is labelled accordingly. Audio transposition requires
FFmpeg on PATH or the local FFmpeg installation used by the guide builder.
Restart the local server after updating it to enable `/api/transpose`.

Note names and live feedback sit beside NOW. **Esercizio** selects a phrase,
enables automatic repetition with a preceding measure, offers Italian note names,
and provides a microphone level check. Completed attempts report the percentage
of confidently detected singing within ±30 cents; silence and uncertain input
are excluded. Comparisons use the same phrase, speed and transposition.
Part selection, per-part settings and last measure are stored locally.

Feature validation with the local server running:

```powershell
python scripts/browser_practice_features_smoke.py
```

With the local server running:

```powershell
python scripts/browser_practice_smoke.py
python scripts/browser_sync_smoke.py
python scripts/browser_backing_smoke.py
python -m unittest discover -s backend/choir_assistant/tests -t backend
```

The browser suite validates six viewports and writes screenshots to `artifacts/practice-redesign/`.
