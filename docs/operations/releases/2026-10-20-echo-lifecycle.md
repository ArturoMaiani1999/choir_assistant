# Staging: integrità della calibrazione e storico del filtro audio

**Status:** pubblicato e verificato; seguito dal rilascio con preparazione del Worker  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Risultato

Il test diagnostico conserva lo storico precedente alla registrazione e
distingue il guadagno applicato da quello proposto dal controllo automatico.
Sono registrati motivi e identità delle transizioni del filtro. La cattura
segnala intervalli PCM mancanti, senza dichiararli continui.

L'invalidazione annulla i target di guadagno programmati prima di disattivare
la sottrazione. Il caricamento fallito di un worklet può essere ritentato
sullo stesso contesto. La guida vocale esclude le letture duplicate dello
stesso quantum audio, mantenendo i controlli di completezza e validazione.

## Pacchetto e rollback

- Origine: `https://staging.epistrophe.it`.
- Worker: `choir-assistant-auth-staging`, configurazione `wrangler.jsonc`.
- Build: `20261020-104105-46c4b97f1322-dirty`, 1.293 file.
- Asset congelati: `artifacts/echo-lifecycle/release`.
- Manifest SHA-256:
  `b2ee61b57bab39391d270a0b99936c7686a1135116829157701fbe7bf7e0abdb`.
- Versione: `3bb5cdb1-57ab-417c-ac43-3b41edd70f44`, attiva al 100%.
- Deployment: `d7a8a80b-5179-4a37-a4d0-60edce4c733c`.
- Tag: `echo-lifecycle-2026-10-20`.
- Rollback: `d07da8e9-e2e8-474b-be1a-580a84c3a27e`.

Pacchetto derivato dall'ultimo rilascio Home, sostituendo cinque moduli audio
e i riferimenti/versione. Home e altri asset conservati. Nessuna migrazione.
Pubblicato lo stesso pacchetto verificato usando `--assets`.

## Verifiche e limiti

TypeScript, 89 test applicativi, 32 test audio/calibrazione, 12 test build,
audit riferimenti/manifest e dry-run Worker superati. Browser con Web Audio
e Worker reali, percorso acustico sintetico: guida nel brano, guida da Home,
cinque riaperture di Base, riverifica dopo caricamento brano e controlli di
rilascio microfono superati. Registrazione/upload/retry confronta il PCM
ricevuto dal server locale con l'originale e verifica la cancellazione del
test. Screenshot 1366×768 e 390×844 ispezionati; nessun cambio di layout.

Dopo il deploy: accesso e configurazione 200, navigazione anonima 302 con
contesto conservato, catalogo/API/modulo protetti 401; `no-store` verificato.
Evidenze in `artifacts/echo-lifecycle/post-deploy.json`.

Il Samsung è collegato via ADB/CDP ma non ha ancora completato una nuova
misura acustica: errori DNS/rete impediscono il caricamento dei moduli e poi
l'accesso. I circa 34 dB del browser sono simulati; nessun miglioramento
quantitativo sul dispositivo reale è dichiarato. Prossimi passi nel
[protocollo sperimentale](../../engineering/pitch-tracking/echo-experiment-protocol.md).

Questa è la condizione al momento del primo rilascio. Le misure successive
sono nello [studio sul S25+](../../engineering/pitch-tracking/s25-calibration-probe-2026-10-20.md);
il [rilascio successivo](2026-10-20-echo-worker-ready.md) prepara il Worker
prima dei rumori e distingue i due timeout.
