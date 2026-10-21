# Xynon: rimozione del pulsante Vista

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

Il piano roll non crea più il pulsante **Vista** né il suo pannello sovrapposto,
nella prova e nelle analisi. Trascinamento, rotella, pizzico touch, ripristino
e ascolto delle note da tastiera restano disponibili. La modifica era già
presente nei sorgenti e nel [contratto della prova](../../product/practice-experience.md);
questo rilascio la porta nell'ambiente online.

## Distribuzione

- Origine: `https://staging.xynon.it`.
- Worker: `choir-assistant-xynon-staging`, configurazione `wrangler.xynon.jsonc`.
- Versione: `b5c1d94d-9ef6-4a5d-91a2-ac0d945e22a0`, traffico 100%.
- Pubblicazione: 21 ottobre 2026, 18:47 CEST.
- Tag: `remove-view-2026-10-21`.
- Artefatto: `artifacts/xynon-no-view/release`.
- Build: `20261021-164603-6811032c1db7-dirty-no-view`.
- File: 1304; 19 brani.
- SHA-256 manifest: `5f74257acdbd026a559903b57ebcb8e311bf7cf1ec67a36645d10788eec10885`.
- SHA-256 Worker: `9b6dd067fb5b2e9339732bdd5b2156ae1438d306a108df93ab135fc9437ed4bd`.
- Rollback: `3e3a6439-7f82-4e64-9682-3951cadb9fe3`.

Il pacchetto parte dalla release delle [curve con scia](2026-10-21-xynon-vocal-trails.md),
verificandone gli hash. Cambiano soltanto `piano_roll.js` e i riferimenti
fingerprintati/runtime; tutti gli altri asset e il Worker conservano i contenuti
pubblicati. Ricetta ripetibile: `artifacts/xynon-no-view/prepare_release.py`.

## Verifiche

- `browser_piano_roll_smoke.py` passato sull'esatto pacchetto a 1366×768 e
  390×844: assenza di Vista, zoom ancorato indipendente sugli assi, trascinamento,
  pizzico touch, ascolto della nota trasposta, tastiera e blocco dell'esplorazione
  durante la riproduzione. Verificate anche analisi best e registrazioni locali.
- Screenshot di prova e analisi ispezionati, senza clipping o overflow.
- Manifest, riferimenti locali, configurazione e dry-run Wrangler verificati.
- Deploy completato con 7 asset nuovi/modificati; registro remoto al 100%.
- Controllo Chromium remoto: accesso 200, root verso login, API e nuovo modulo
  piano roll protetti con 401 da anonimo. I gesti autenticati sono verificati
  sul pacchetto locale con dati sintetici.

Evidenze e script in `artifacts/xynon-no-view/`.
