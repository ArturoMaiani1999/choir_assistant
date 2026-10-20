# Staging: animazione originale della Home in due colori

**Status:** pubblicato e verificato su staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Correzione

La modulazione planare introdotta dal redesign risultava quasi statica.
Su richiesta del maintainer viene ripristinato il renderer originale:
curva di Lissajous 3D, rotazione della camera, scia di venti secondi,
filamenti e alone. La Home usa esclusivamente ciano e ocra dai token della
prova, senza interpolazioni multicolore. Il punto in movimento usa uno degli
stessi colori. La disposizione responsive approvata viene conservata; la
figura si adatta alla propria area, con filamenti proporzionati su mobile.
Relax mode mantiene la propria palette e animazione.

## Pacchetto

- Origine: `https://staging.epistrophe.it`.
- Worker: `choir-assistant-auth-staging`, configurazione `wrangler.jsonc`.
- Build: `20261020-091643-46c4b97f1322-dirty`, 1.293 file e 19 brani.
- Asset congelati: `artifacts/home-animation-bicolor/dist`.
- Manifest SHA-256:
  `d47144bad5e60572980fec97e77dec4c41a9ad5fd0b0a747fabb75547b42bc10`.
- Versione: `d07da8e9-e2e8-474b-be1a-580a84c3a27e`, attiva al 100%.
- Deployment: `67cb7ec4-918a-418a-810a-db9ea917c095`.
- Pubblicazione: 20 ottobre 2026, 11:18 CEST.
- Tag: `home-motion-bicolor-2026-10-20`.
- Rollback: `ef241b24-120b-4d4c-a88a-9ab70f4e0625`.

Pubblicata esattamente la build verificata con `--assets`, senza rigenerarla.
Worker, applicazione musicale, audio e calibrazione coincidono con il
rilascio precedente; cambiano renderer, visibilità dell'alone Home e
riferimenti fingerprintati/versione nelle pagine. Nessuna migrazione.

## Verifiche

- Smoke Home sulla build: undici viewport, separazione curva/menu, assenza di
  clipping e overflow, tastiera, focus, profilo, impostazioni e voce.
- Il test controlla i colori dei tratti effettivamente disegnati: due soli
  colori. Confronta anche i pixel a distanza di 1,2 secondi: cambiamento
  visibile sia a 1366×768 sia a 390×844. Il solo avanzamento del timer non
  costituisce più una verifica sufficiente dell'animazione.
- Pausa, sospensione dietro dialoghi, fuori vista e in background, ripresa e
  movimento ridotto superati. Zero errori console e zero richieste microfono.
- Smoke Relax sulla build: rendering, drag, frecce, pausa, movimento ridotto,
  impostazioni e ritorno alla prova al beat 16 superati.
- TypeScript, 89 test applicativi, 26 test audio/calibrazione, audit dipendenze,
  integrità manifest, dry-run Worker e documentazione superati.

Screenshot desktop/mobile ispezionati; coppie `animation-start-*` e
`animation-after-*` e rapporto in `artifacts/home-animation-bicolor`.
Dopo il deploy: versione al 100%, login/configurazione 200, navigazione anonima
302 conservando il contesto, catalogo/API/nuovo renderer 401. Tutte le risposte
verificate sono `no-store`; login identico al pacchetto. Evidenze in
`artifacts/home-animation-bicolor/post-deploy.json`.

Login Clerk interattivo e dispositivi fisici non ripetuti; i test della Home
usano autorizzazione sintetica locale.
