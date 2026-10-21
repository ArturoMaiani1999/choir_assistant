# Consumer authentication deployment

**Status:** canonical for `feature/consumer-auth`; not yet the live production procedure
**Owner:** project maintainer
**Last reviewed:** 2026-10-20

Per il nuovo ambiente Xynon affiancato a Epistrophe seguire anche
[Xynon: staging parallelo](xynon-parallel-deployment.md), con configurazione,
istanza Clerk, D1 e bucket R2 dedicati.

This runbook provisions the Clerk + D1 authorization path without weakening
the currently deployed Cloudflare Access application. Perform the first deploy
under a distinct Worker name and hostname.

Ultimo rilascio staging: [navigazione, profilo SATB e uscita,
2026-10-20](releases/2026-10-20-navigation-ux.md). La migrazione
`0011_preferred_voice_part.sql` precede la versione del Worker che legge la
preferenza vocale; non cambia la sezione ufficiale o i permessi del corista.

## 1. Local prerequisites

```powershell
npm ci
npm run check
python -m unittest scripts.check_deploy_config_test scripts.sync_authorized_members_test scripts.sync_choir_members_test
```

`npm audit --audit-level=moderate` must report zero known vulnerabilities at
release time. Review lockfile changes explicitly; do not use an unattended
forced audit upgrade.

## 2. Clerk production instance

1. Create a production Clerk application using only email verification code
   or magic-link authentication. Do not enable password, SMS or social login
   without a separate review of account linking and verified identifiers.
2. Disable changes to the primary email identifier by end users.
3. Enable Clerk attack/bot protection.
4. Restrict allowed application origins and redirects to the staging hostname.
5. Configure the session-token custom claim:

```json
{
  "primaryEmail": "{{user.primary_email_address}}"
}
```

6. Record the publishable key, public JWT verification key, backend Secret Key
   and exact HTTPS Frontend API origin. The Secret Key is required by the
   current `@clerk/backend` `authenticateRequest()` flow even when `jwtKey` is
   supplied for networkless signature verification. Keep it out of files and
   install it only as a Worker secret.

The Worker rejects malformed email claims and Clerk impersonation sessions.
The claim is accepted as a verified identifier only because the Clerk tenant
is restricted to email-code/magic-link verification. This dashboard setting is
a release gate, not an optional preference.

Clerk's own allowlist is deliberately not the authorization authority. Users
outside the D1 list may be able to create an identity, but the Worker returns
`403` and never serves repertoire assets.

## 3. Create staging D1

```powershell
npx wrangler d1 create choir-assistant-auth-staging
```

Copy the returned database ID into the staging `wrangler.jsonc`. Replace the
three `REPLACE_WITH_...` values with the real staging origin, Clerk Frontend API
origin and publishable key. Add exactly one custom-domain route matching the
hostname in `APP_ORIGIN`; keep `workers_dev=false` and `preview_urls=false`:

```json
"routes": [
  { "pattern": "staging.example.org", "custom_domain": true }
]
```

The Worker also compares every incoming request origin with `APP_ORIGIN` before
serving public login files or protected assets. Then apply migrations:

```powershell
npx wrangler d1 migrations apply choir-assistant-auth-staging --remote
```

## 4. Secrets

Generate one random HMAC key and place the same value in the Worker secret and
in the operator's password manager. Loss of this key requires generating a new
one and re-synchronizing the complete mailing list.

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$hmacKey = [Convert]::ToBase64String($bytes)
$hmacKey | npx wrangler secret put AUTH_EMAIL_HMAC_KEY
npx wrangler secret put CLERK_JWT_KEY
npx wrangler secret put CLERK_SECRET_KEY
Remove-Variable hmacKey,bytes
```

Do not pass secrets as command-line arguments. Confirm that PowerShell
transcription/history and CI logs do not capture piped secret values.
Use `npx wrangler secret list` to verify the three binding names without
printing their values.

## 5. Synchronize authorized members

The input file is private and must live outside the repository. It may be a
CSV with an `email` column or one address per line.

```powershell
$env:CHOIR_AUTH_EMAIL_HMAC_KEY = '<retrieve from password manager>'
python scripts/sync_authorized_members.py C:\private\coristi.csv --dry-run
python scripts/sync_authorized_members.py C:\private\coristi.csv
Remove-Item Env:\CHOIR_AUTH_EMAIL_HMAC_KEY
```

The default operation only adds/reactivates entries. After reviewing the
source list, `--replace` also revokes active digests absent from that list.
Never use `--replace` with a partial export.

Run a dry-run first, record its member count, then repeat that exact count as
an explicit destructive-operation confirmation:

```powershell
python scripts/sync_authorized_members.py C:\private\coristi.csv --replace --dry-run
python scripts/sync_authorized_members.py C:\private\coristi.csv --replace --confirm-replace-count 56
```

Replacement is one D1 transaction and does not delete old rows: missing
members become inactive. Keep the source export so the prior active set can be
restored deliberately if the wrong complete list was supplied.

## 6. Build and stage

Before building the performance-sharing and personal-recording release, create
the private R2 bucket and apply all D1 migrations, including
`0005_personal_recordings.sql`:

```powershell
npx wrangler r2 bucket create choir-assistant-performances-staging
npx wrangler d1 migrations apply choir-assistant-auth-staging --remote
```

The `PERFORMANCE_BUCKET` binding must name that bucket. It contains
group-scoped PNGs under `performances/` and owner-only audio/pitch objects under
`recordings/`; those prefixes do not share authorization rules. Do not enable
public access or attach an R2 custom domain.

Replace the email-only synchronization with a private CSV when roles and choir
groups are ready. Supported columns are:

```csv
email,display_name,groups,roles,view_groups
singer@example.invalid,Mario,Tenori,singer,
viewer@example.invalid,Anna,Contralti,section_viewer,Contralti;Soprani
director@example.invalid,Direttore,,director,
```

`groups` describes where the singer belongs; `view_groups` describes which
groups a `section_viewer` may inspect. Multiple values use `;` or `|`.
`director` sees all groups and `admin` remains a separate role without implicit
performance visibility. The CSV stays outside Git.

```powershell
$env:CHOIR_AUTH_EMAIL_HMAC_KEY = '<retrieve from password manager>'
python scripts/sync_choir_members.py C:\private\coristi-ruoli.csv --dry-run
python scripts/sync_choir_members.py C:\private\coristi-ruoli.csv
Remove-Item Env:\CHOIR_AUTH_EMAIL_HMAC_KEY
```

For a complete authoritative export, use `--replace` only after dry-run and
confirm the exact validated count with `--confirm-replace-count`. Each included
member's omitted roles, memberships and view grants are revoked. Members absent
from the file are revoked only with `--replace`.

The scheduled Worker cleanup removes best-performance rows and PNG objects 30
days after member deactivation, in bounded daily batches.

A clean repository remains preferable for shared releases. The personal
instance may also publish a build marked with the `-dirty` suffix.

```powershell
npm ci
npm run check
npm run build
npm run deploy
```

Do not rename this Worker to `choir-assistant` during staging. The current
Access-protected production Worker is the rollback target.

## 7. Acceptance gates

Test in a new browser profile, not merely an incognito tab with shared browser
state:

1. Anonymous `/` redirects to `/sign-in`.
2. Anonymous `library.json`, a `bundle.json`, SVG and MP3 return `401`, never
   `200` and never the sign-in HTML body.
3. A valid Clerk user absent from D1 receives `403` for root and direct assets.
4. An authorized member can load notation and seek audio using byte ranges.
5. Setting the member inactive blocks the next request.
6. An invalid `return_url=https://attacker.example` cannot redirect off-site.
7. Disconnecting or misbinding D1 returns `503`; no asset is served.
8. CSP has no unexpected report-only violations during login or rehearsal.
9. Browser storage and network traces contain no mailing list or secret key.
10. Requests to `workers.dev`, preview/version URLs or any alternate hostname
    cannot retrieve even `/auth/config`; the canonical Worker returns `421`.

Complete the independent procedure in
[consumer-auth-security-review.md](consumer-auth-security-review.md) and record
the external controls in
[consumer-auth-dashboard-checklist.md](consumer-auth-dashboard-checklist.md).

## 8. Production cutover and rollback

Only after review approval:

1. Create the production D1 database and repeat migration and member sync.
2. Create production-scoped Clerk keys/origins; never reuse development keys.
3. Deploy the reviewed commit as a new Worker version.
4. Move the custom production hostname to the reviewed Worker.
5. Verify root and direct assets anonymously before inviting users.
6. Remove the singer-facing Access application only after successful checks.

Rollback means restoring the hostname to the old Access-protected Worker. Do
not make the new Worker public to "debug" an authentication failure.
