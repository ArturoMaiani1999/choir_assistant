# Practice frontend

This dependency-free browser milestone proves the singer-facing Practice experience: selected-part notation, fixed-NOW musical pitch lane, deterministic singer trajectory, compact transport and one canonical performance clock.

## Run

```powershell
python scripts/serve_frontend.py
```

Open `http://localhost:5173`. No microphone permission is needed in this milestone; the cyan singer trajectory is deterministic mock data. The `Altre voci` accompaniment uses the existing part-specific backing file. Other accompaniment modes are UI/state mocks.

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

With the local server running:

```powershell
python scripts/browser_practice_smoke.py
python scripts/browser_sync_smoke.py
python scripts/browser_backing_smoke.py
python -m unittest discover -s backend/choir_assistant/tests -t backend
```

The browser suite validates six viewports and writes screenshots to `artifacts/practice-redesign/`.
