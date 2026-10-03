# Development workflow

**Status:** canonical
**Owner:** project maintainer
**Last reviewed:** 2026-10-03

## Principles

- Develop and diagnose against the local server; never expose it publicly.
- Keep source, generated authoring artifacts and release artifacts distinct.
- Make one reviewable change at a time and preserve unrelated worktree changes.
- A release candidate is immutable: test the same `dist/` that is promoted.
- Code, tests and affected canonical documentation change together.

## Local loop

```powershell
git status --short
python scripts/serve_frontend.py
```

Open `http://127.0.0.1:5173`. Use this environment for score generation,
administrative review, benchmark analysis and optional CREPE diagnostics.

## Required checks

Run the checks relevant to the change; before a release run the full set:

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

With `scripts/serve_frontend.py` running:

```powershell
python scripts/browser_practice_features_smoke.py
python scripts/browser_sync_smoke.py
python scripts/browser_backing_smoke.py
```

With the production `dist/` served by Wrangler on its default local URL:

```powershell
python scripts/browser_dist_smoke.py
```

Any obsolete assertion in a smoke test must be repaired or explicitly recorded;
a partially executed script is not a passing test.

## Change lifecycle

1. Start from a clean understanding of `git status`; do not overwrite unrelated
   changes.
2. State the user-visible or architectural acceptance criteria.
3. Implement the smallest cohesive change.
4. Add or update automated checks at the nearest stable boundary.
5. Exercise the changed workflow in a browser when UI, audio or timing changes.
6. Update canonical documentation and add an ADR for durable trade-offs.
7. Review `git diff --check`, the diff itself and generated artifacts before
   committing.

## Release-candidate loop

1. Confirm rights and editorial approval for every allowlisted piece. A generic
   or placeholder `rights_note` is a release blocker.
2. Confirm `git status --porcelain` is empty. Production builds refuse a dirty
   worktree; `--allow-dirty` exists only for local diagnostics and marks the
   resulting build as non-publishable.
3. Regenerate each changed browser bundle with
   `python scripts/build_library_bundle.py <piece-id>`.
4. Generate `dist/` once with `python scripts/build_dist.py`.
5. Preview it locally with `npx wrangler dev --assets dist --local-protocol=https`.
6. Deploy that exact directory to a protected staging preview.
7. Record build version, manifest hash, devices and acceptance results.
8. Promote the same directory to production; do not rebuild between approval
   and promotion.

The detailed checklist is in [private-deployment.md](private-deployment.md).
The operating model for branches, beta users, feedback and incidents is in
[choir-beta-operations.md](choir-beta-operations.md).

## Definition of done

A change is done when implementation, relevant tests and canonical docs agree;
no known failing check is hidden; no diagnostic-only feature leaks into the
production bundle; and rollback is possible from Git plus the deployment
manifest.
