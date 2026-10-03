# Choir Assistant

Web application for private choir rehearsal with synchronized notation,
backing audio and browser-local monophonic pitch feedback.

## Current status

The local rehearsal application is functional. A static, authenticated release
for a restricted group of singers is being prepared on the `deploy` branch.
The production build is intentionally fail-closed: no repertoire is included
until it is explicitly authorized in `deploy/repertoire.json`.

Pitch analysis, preferences and locally recorded benchmark takes remain in the
browser. The local administration and score-generation server must never be
exposed to the Internet.

## Run locally

Requirements: Python 3, MuseScore for regenerating musical assets, and FFmpeg
for local audio transposition.

```powershell
python scripts/serve_frontend.py
```

Open `http://127.0.0.1:5173` and use headphones when testing microphone pitch
detection.

## Validate

```powershell
node frontend/practice_math.test.js
node frontend/score_runtime.test.js
node frontend/pitch_detector.test.js
node frontend/one_euro_filter.test.js
node frontend/pitch_test_harness.test.js
python -m unittest discover -s backend/choir_assistant/tests -t backend
python -m unittest scripts.check_voice_lab_artifacts_test
python scripts/build_dist_test.py
python scripts/check_voice_lab_artifacts.py
python scripts/check_docs.py
```

The static release also has a real-browser check. Serve `dist/` with Wrangler,
then run `python scripts/browser_dist_smoke.py`.

Browser smoke tests require the local server to be running. See the
[development workflow](docs/operations/development-workflow.md).

## Documentation

Start from the [documentation index](docs/README.md). The canonical entry
points are:

- [System architecture](docs/architecture/overview.md)
- [Practice experience](docs/product/practice-experience.md)
- [Pitch-tracking engineering](docs/engineering/pitch-tracking/README.md)
- [Development workflow](docs/operations/development-workflow.md)
- [Choir beta operations](docs/operations/choir-beta-operations.md)
- [Private deployment runbook](docs/operations/private-deployment.md)
- [Architecture decisions](docs/decisions/README.md)

Historical audits and superseded plans live under `docs/archive/` and are not
normative.

## Repository boundaries

- `frontend/`: browser application and generated rehearsal bundles.
- `backend/`: score-domain and ingestion foundation.
- `scripts/`: local development, asset-generation, validation and release tools.
- `sheets/`: editable musical sources; never copied wholesale into production.
- `deploy/`: explicit production allowlist and deployment configuration.
- `docs/`: canonical documentation and historical archive.
- `FlutterPitchGame-main/`: legacy reference implementation only.

Unreviewed OMR output is never authoritative. An approved MuseScore/MusicXML
source is required before derived notation or audio can be released.
