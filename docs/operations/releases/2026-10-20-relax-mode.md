# Staging: Relax mode

**Status:** pubblicato e verificato su staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Distribuzione

- Destinazione: `https://staging.epistrophe.it`, Worker
  `choir-assistant-auth-staging`, configurazione `wrangler.jsonc`.
- Versione finale: `18768e58-cbb3-4dbe-b543-784d5d283fed`, attiva al 100%.
- Tag: `relax-mode-2026-10-20`.
- Build: `20261019-224526-46c4b97f1322-dirty`, 1.290 file e 19 brani,
  da istanza personale con modifiche locali non committate.
- SHA-256 del manifest:
  `bf663981367a5d3694fc59d11f7677cb82fc7f75608cf3317c57a84c1616ade1`.
- Nessuna migrazione o modifica alle autorizzazioni.
- Rollback prima della feature: `340e587e-86a0-4eb0-8ae0-1aef4821a32f`.
  La versione intermedia `0f3edcca-3a81-4c82-9665-8cd40a5112f5` è sostituita
  dal completamento del recupero della battuta anche senza cache della pagina.

## Contenuto e verifica

**Impostazioni → Relax mode** nella prova e nel laboratorio vocale apre la
[scena di Lissajous](../../product/relax-mode.md): nero puro, colori del
riferimento, rotazione 3D, scia di cinque secondi, pausa, schermo intero e
orientamento con trascinamento o frecce. Nessuna libreria grafica esterna.

Typecheck, 89 test applicativi, 12 test della build, controllo documentazione
e diff superati. Smoke di navigazione e smoke della scena a 1366×768 e
390×844: nessuno scroll o controllo tagliato; scia di cinque secondi,
pausa/ripresa, rotazione, dettagli, schermo intero e movimento ridotto.
Ritorno a beat 16 verificato anche dopo ricarica completa, senza richieste
del microfono. Verificati entrambi gli ingressi nelle impostazioni.

La stessa `dist/` pubblicata supera sia lo smoke specifico
`python scripts/browser_relax_smoke.py --dist` sia quello completo della
build con asset reali e API/autenticazione sintetiche soltanto locali.
Hash di tutti i file verificati prima della distribuzione.
Screenshot in `artifacts/relax-mode`; controlli anonimi dopo il deploy in
`artifacts/navigation-release/post-deploy.json`. Login Clerk con account reale
non ripetuto. Il Worker storico protetto da Access non è stato modificato.
