# Staging: calibrazione audio dalla Home

**Status:** pubblicato e verificato su staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Problema e correzione

Da Home, Uso gli altoparlanti seguito da Calibra audio falliva con
`Cannot read properties of null (reading 'beginWarmup')`. La calibrazione
richiedeva un MediaPlaybackClock che esiste solo dopo l'apertura del brano.
Riprodotto sulla build precedente con lo smoke senza brano.

La routine attiva il mixer e i segnali di misura anche senza player; riscalda
i decoder soltanto se esiste un clock e il media ha una sorgente. Stop e
annullamento ripristinano sempre il mute del mixer, anche senza clock. Il
percorso con brano mantiene il grafo aperto fino al Play.

## Pacchetto e verifiche

- Build `20261020-082306-46c4b97f1322-dirty`, 1.293 file, 19 brani.
- Asset isolati in `artifacts/calibration-home-fix/release`, hash di tutti i
  file verificati; deploy con `--assets` sulla stessa copia collaudata.
- Manifest SHA-256:
  `7681bb838705557cc09dba6846bc477c15f41334ec95f52a678f4fab31320f49`.
- Rollback precedente: `34ebe62d-8840-4150-a91c-c50aa8e380cb`.
- Versione pubblicata: `d14f1391-54d6-42c8-99d0-b4f0507fcb34`.
- Typecheck, 89 test API, 26 test calibrazione/DSP, 12 controlli packaging,
  verifica documenti e dry-run Worker superati.
- Smoke reale Web Audio/Worker da Home senza brano: guida completa,
  applicazione, stop, riapertura e annullamento superati.
- Smoke con brano: guida, riuso, Play senza riapertura, cambio dispositivo,
  background, permesso tardivo e focus/chiusura superati.
- Smoke generale della build con Ave verum e viewer Partitura superato.
- Screenshot a 1366×768 e 390×844 in `artifacts/calibration-home-fix/after`
  e `with-piece`, ispezionati; nessun cambiamento di layout richiesto.

Autenticazione e account sono simulati solo nei test locali; nessuna
migrazione o modifica alle autorizzazioni. Non è una nuova misura della
cancellazione sul Samsung reale.

Dopo il deploy: login e configurazione pubblica 200; pratica anonima
reindirizzata al login conservando Santo/tenore; API e asset autenticati 401,
tutte risposte `no-store`. Login pubblicato identico al pacchetto. Evidenze
in `artifacts/calibration-home-fix/post-deploy.json`. Login Clerk interattivo
con account reale non ripetuto.
