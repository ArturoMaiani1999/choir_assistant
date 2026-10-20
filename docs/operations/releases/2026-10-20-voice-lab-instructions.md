# Staging: istruzioni vocali animate

**Status:** pubblicato e verificato su staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Distribuzione

- Destinazione: `https://staging.epistrophe.it`, Worker
  `choir-assistant-auth-staging`, configurazione esplicita `wrangler.jsonc`.
- Versione iniziale: `90039c95-2f85-4801-8586-5dd2e0d57367`.
- Tag Worker: `voice-lab-instructions-2026-10-20`.
- Build immutabile: `20261019-221836-46c4b97f1322-dirty`, 1.287 file,
  19 brani, da istanza personale con modifiche locali non committate.
- SHA-256 del manifest:
  `aea049c36727d810a9cb97a7e14f96eed6aa1c61c134d6e0273a8fbaaa6a37b8`.
- Nessuna migrazione da applicare; schema remoto verificato prima del deploy.
- Versione precedente per rollback: `3550ab33-d1b7-40ca-a95a-38d48a498732`.
- Il Worker storico protetto da Access non è stato modificato.

## Contenuto e verifica

Preparazione vocale senza scroll nei viewport di verifica; istruzioni HTML/SVG
con audio, salti della chiave e del 4/4, count-in e note ocra. Impostazioni con
ingranaggio e navigazione testuale. Contratto e verifiche visuali nel
[documento del laboratorio](../../product/voice-lab-warmup-redesign-plan.md).

Prima del rilascio: typecheck, 89 test applicativi, 26 test audio, 16 test di
configurazione/sincronizzazione, audit dipendenze senza vulnerabilità note,
predeploy e dry-run. Gli smoke del laboratorio, delle istruzioni, della
navigazione e del cockpit sono passati durante l'implementazione.

Verificati gli hash di ogni file della build e lo smoke Chromium della stessa
`dist/`, senza ricostruire prima della pubblicazione. Il test della partitura
ora carica esplicitamente anche le immagini differite fuori schermo prima di
verificarle; nessuna modifica al caricamento del prodotto. Pratica, microfono,
mixer, trasporto, partitura e tastiera passano senza errori o richieste esterne.

Dopo il deploy: versione Worker attiva confermata, pagine protette con redirect
al login, catalogo/audio/API anonimi negati, login e uscita disponibili,
`Cache-Control: no-store` e CSP verificati. Le pagine pubbliche corrispondono
all'artefatto. Evidenze in `artifacts/voice-lab-release/post-deploy.json`.
Le prove autenticate sono locali con dati sintetici; non è stato eseguito un
nuovo login Clerk reale dopo la pubblicazione.

## Correzione della sequenza, 20 ottobre

- Versione attiva al 100%: `e54627a4-1e2e-47d4-a362-6b720e4f1760`.
- Tag Worker: `voice-lab-listen-follow-2026-10-20`.
- Build: `20261019-224914-46c4b97f1322-dirty`, 1.290 file, 19 brani.
- SHA-256 del manifest:
  `4c7bad4865fd46c4d4c87700432708e93736a1dc07a01cff6be331e2413bbee7`.
- Rollback: `90039c95-2f85-4801-8586-5dd2e0d57367`.

Nell'ascolto iniziale salta solo la chiave, senza evidenziare note. Dopo i
quattro battiti, `Segui le note` riproduce melodia e metronomo con evidenziazione
ocra sincronizzata. La frase sul canto su la è rimossa. Orecchio interno
conserva il riferimento della sola fondamentale.

Smoke delle istruzioni a 1366×768 e 390×844 aggiornato: assenza di note attive
per tutta la prima fase, seconda frase audio all'inizio della fase finale,
metronomo e note sincronizzati, chiusure e microfono spento. Screenshot
ispezionati; build immutabile verificata con hash, browser smoke e dry-run.
Verifiche anonime dopo pubblicazione superate e versione attiva confermata.
Evidenze in `artifacts/voice-lab-follow-release/post-deploy.json`.
