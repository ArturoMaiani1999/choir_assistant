# Clock dei campioni nella calibrazione e nel monitor

**Status:** deployed  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

Distribuito soltanto su `staging.epistrophe.it`, con `wrangler.jsonc` e asset
congelati in `artifacts/audio-sample-clock/release-final`.

- Versione Worker: `34d941eb-7da7-44ca-94db-5691550c7eab`.
- Build: `20261021-080519-6811032c1db7-dirty`.
- Rollback: `533dcbe4-a7bb-4e00-94cf-9b1cca73f922`.
- SHA-256 manifest:
  `dd11a2cd946fa258af6da6744fde52bb3883da48c1ce70db24dbfff67abcc7f4`.
- SHA-256 bundle server invariato:
  `b99cad71a3a7e5a8ceaeabbefeca7582aebac1e703527c212d23f398b2f2b051`.

Calibrazione, monitor e diagnostica contano i campioni renderizzati; i
timestamp Worklet temporaneamente arretrati restano telemetria. Un salto in
avanti non viene ricucito. Suspend/resume invalida il modello acustico e una
registrazione interrotta conserva soltanto il prefisso già consegnato.
Nessun nuovo passaggio o controllo UI. AEC nativo ancora solo nel probe.

Il confronto manifest consente soltanto `audio_sample_clock.js`, i tre
Worklet, i due proprietari UI e i riferimenti fingerprintati/versione.
11 asset caricati, altri 1284 riusati; detector e musica invariati.
Configurazione deploy, inventario e hash del pacchetto verificati.

Typecheck e 89 test API passati; 52 test DSP/lifecycle passati. Tre catture
numerate da 960.000 campioni senza errori; Santo/click raw e AEC sintetico
816.000 campioni per condizione, completi anche con timestamp ripetuti.
La guida completa passa con voce sintetica all'unisono, gain x2/x0,5 e delay
+1/+6 ms/ritorno. Lo smoke sul pacchetto finale esegue 15.900 mutazioni del
grafo: 51 timestamp arretrati, massimo 512 campioni, modello conservato.
Suspend/resume, riuso, cinque riaperture di Base, background, devicechange,
permesso tardivo e chiusura/focus verificati. Screenshot 1366×768 e 390×844
ispezionati. Risultati e intermittenza F0 preesistente nello
[studio tecnico](../../engineering/pitch-tracking/audio-sample-clock-2026-10-21.md).

Gli artefatti sono in `artifacts/audio-sample-clock`; `release-check.json`
descrive inventario/hash e `post-deploy.json` i controlli anonimi delle rotte.
Post-deploy: sign-in/configurazione 200, HTML anonimo 302 al login con brano
e parte conservati, API/manifest/moduli protetti 401; tutte le risposte
`no-store`. Cloudflare conferma la nuova versione al 100% del traffico.
Il confronto acustico sul S25+ resta da eseguire: le prove sintetiche non
certificano la riduzione reale del rientro o l'accuratezza F0 sul dispositivo.
