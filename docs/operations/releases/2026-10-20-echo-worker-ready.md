# Staging: verifica dell'analisi prima dei segnali di calibrazione

**Status:** pubblicato; verificato nel browser e nell'avvio di due probe reali sul S25+  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Risultato

La guida prepara il Worker e attende una risposta prima di avviare i rumori.
Se caricamento/import non termina entro 12 secondi, si ferma nella fase
Preparazione audio, con un errore distinto dall'analisi del PCM. Il Worker
pronto viene conservato per analizzare la registrazione; non viene scaricato
dopo i dieci secondi di misura. Annullamento impedisce un avvio tardivo.

Lo storico distingue caricamento, disponibilità, avvio dell'analisi,
risultato e timeout. Il fit, il veto clipping, le soglie del pitch e il
controllo del guadagno restano quelli del rilascio precedente.

La modifica segue il [primo probe reale sul S25+](../../engineering/pitch-tracking/s25-calibration-probe-2026-10-20.md):
PCM acquisito ma risultato assente nel limite iniziale, poi replay dello
stesso PCM con risposta `clipping` in circa 817 ms. Il tempo di calcolo
non spiega da solo il primo timeout; la nuova strumentazione permette di
distinguere le fasi senza far ripetere prima una misura acustica.

## Pacchetto

- Worker: `choir-assistant-auth-staging`, `wrangler.jsonc`.
- Origine: `https://staging.epistrophe.it`.
- Build: `20261020-110249-46c4b97f1322-dirty`, 1.293 file.
- Asset congelati: `artifacts/echo-lifecycle/release-worker-ready`.
- Manifest SHA-256:
  `394aa534c28c172bff1928f6a2d510bad0c5035429acae5b143e617dab097236`.
- Versione: `ff91f78c-5193-4f1c-9c2f-3c72b68c104b`, attiva al 100%.
- Deployment: `1dd091f2-3754-436c-8284-1b6bef8ed452`.
- Tag: `echo-worker-ready-2026-10-20`.
- Rollback: `3bb5cdb1-57ab-417c-ac43-3b41edd70f44`.

Derivato dal pacchetto precedente verificato, sostituendo tre moduli audio
e i riferimenti/versione. Home conservata. Nessuna migrazione.

## Verifiche

TypeScript, 89 test applicativi, 33 test audio/calibrazione, integrità del
manifest e riferimenti locali superati. Smoke completo da Home con passaggio
al brano e smoke nel brano con cattura, upload/retry, confronto del PCM
salvato e cancellazione del test superati. I test includono cinque riaperture
di Base e la gestione di devicechange, background e permessi tardivi.
Il test unitario non permette alcun avvio della cattura prima del messaggio
di disponibilità del Worker, neppure se la risposta arriva dopo annullamento.
Lo smoke con `--worker-loading-check` verifica preparazione e timeout senza
avviare la cattura acustica, messaggio corretto e rilascio del microfono.

Screenshot 1366×768 e 390×844 ispezionati. La composizione e il countdown
esistenti sono conservati; la preparazione usa uno stato di attesa esplicito.
Test e screenshot in `artifacts/echo-lifecycle/worker-ready-*-smoke`.

Dopo deploy: login/configurazione 200; navigazione anonima 302 conservando
il contesto; API/catalogo/nuovi moduli 401; tutte le risposte `no-store`.
Evidenza: `artifacts/echo-lifecycle/worker-ready-post-deploy.json`.

Due nuovi probe reali sulla build completano caricamento e analisi: a 8/15
calibrazione accettata con 22,81 dB sul secondo segnale, a 11/15 rifiuto
esplicito per un picco sopra soglia. Nel secondo emerge anche un salto di
ritardo di 6 ms, isolato offline; il tracking live resta da implementare e
validare. La riduzione del probe non dimostra il comportamento durante il
canto o dopo cambi di latenza. Dati e limiti nello studio collegato.
