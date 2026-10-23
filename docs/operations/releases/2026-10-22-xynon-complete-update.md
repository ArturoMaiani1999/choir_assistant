# Xynon: aggiornamento completo del 22 ottobre

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-22

## Risultato

Distribuite tutte le modifiche applicative presenti nel workspace su richiesta
del maintainer: scelta audio unificata con validità di 24 ore, impostazioni,
navigazione senza pagina Relax separata, testo About e sincronizzazione di
master, voci SATB, metronomo e movimento dello spartito.

La preparazione aggiorna Vitest da 4.1.11 a 4.1.12 e il relativo lockfile per
superare il gate di audit del runbook. Le segnalazioni upstream sono
[registrazione mock](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) e
[traversal su Windows](https://github.com/advisories/GHSA-xp26-3454-mjgp).
Il nuovo audit restituisce zero vulnerabilità.

## Distribuzione

- Origine: `https://staging.xynon.it`.
- Worker: `choir-assistant-xynon-staging`, configurazione `wrangler.xynon.jsonc`.
- Versione: `66fff3f1-9b54-4c7f-b2d9-3eab29ad9949`, 100% del traffico.
- Pubblicazione: 22 ottobre 2026, 00:34 CEST.
- Tag: `full-update-2026-10-22`.
- Artefatto verificato: `artifacts/full-deploy-20261022/release`.
- Build: `20261021-223154-9cf44a36476d-dirty` (identificatore in UTC).
- File: 1309; brani: 19; asset nuovi/modificati caricati: 17.
- Manifest SHA-256:
  `b79b64cb2988252541db526e8a4495e0f07fa9684e81623147a0cabf010966c2`.
- Worker del dry-run SHA-256:
  `cd1bb7ce49eb2393ba63ec787c36a8ec8941b7bf57eb3fbba281e28ce7a2e061`.
- Versione precedente per rollback: `0287d25b-3ffe-4bf3-92ec-7b178b52dde2`.

Pubblicato l'esatto artefatto sottoposto agli smoke, senza ricostruirlo.
Nessuna migrazione D1 in attesa e nessuna modifica ai secret.

```powershell
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/full-deploy-20261022/release --tag full-update-2026-10-22 --message "Deploy all current Xynon changes: audio settings, synchronized playback, navigation and About"
```

## Verifiche e limiti

- TypeScript, 112 test applicativi, 79 test audio/calibrazione e 16 test della
  build superati; altri 17 test di configurazione e sincronizzazione membri
  superati. Documentazione valida e audit dipendenze pulito.
- Integrità e inventario completo del manifest verificati; dry-run Wrangler
  superato con i binding dedicati Xynon.
- Navigazione, ritorno dalla partitura, logout e rilascio microfono verificati
  sui sorgenti a 1366×768 e 390×844.
- Sull'esatto artefatto: Home/About su undici viewport; impostazioni e scelta
  audio con scadenza, chiusure e persistenza; laboratorio vocale; metronomo;
  piano roll con mouse/touch/tastiera; mixer e movimento della partitura;
  avvio con recupero errori e riuso cache. Screenshot desktop/mobile di About,
  impostazioni e prova ispezionati.
- Probe PCM: quattro canali SATB allineati al master, scarto misurato zero;
  offset dei tre click circa 6,875, 4,5 e 10,146 ms nel caso sintetico locale.
- Browser remoto anonimo con Clerk reale: login e registrazione pronti senza
  errori JavaScript/CSP né overflow a 1366×768 e 390×844. Root al login;
  catalogo, bundle, SVG, MP3, API e codice privato rispondono 401. File pubblici
  fingerprintati corrispondenti agli hash del manifest e cache previste.
- Registro remoto conferma versione e traffico al 100%.

I percorsi autenticati sono collaudati localmente con account sintetici.
Non è stato eseguito un login remoto con codice email né un nuovo collaudo
acustico Samsung/AirPods. La segnalazione «Audio non ancora pronto per il
salto» richiede ancora verifica nella sessione interessata: questo rilascio
non certifica risolto il problema di seek/consegna MP3 osservato nell'audit.
Evidenze e log in `artifacts/full-deploy-20261022`.
