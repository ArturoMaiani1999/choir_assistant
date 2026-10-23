# Xynon: prova esplicita AEC all

**Status:** published opt-in trial; held-note failure reproduced in actual app  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-22

## Risultato

Il link `https://staging.xynon.it/?piece=chi-ci-separera&part=P3&aec=all`
richiede `echoCancellation:{exact:'all'}` nel normale grafo dell'app.
Senza il flag rimane il percorso booleano true. Il flag non si salva come
preferenza e rimane nell'URL quando si cambia brano nella prova.
Lo stato esistente mostra **Rientro · prova all**. Nessun selettore o pannello
aggiuntivo; spartito e piano roll rimangono dominanti.

L'attach, il controllo acustico e lo stato operativo verificano il modo
effettivo, NS false e AGC false. Il browser non può sostituire true a `all`
senza produrre un errore. Non cambiano sottrazione, detector, soglie o scoring.
La firma della calibrazione contiene già il valore effettivo del processing:
il profilo `all` viene salvato separatamente e non modifica quello normale.
Al primo utilizzo di `all` serve la guida unica.

Questa è una prova della variante candidata, non una dichiarazione di
risoluzione della [perdita delle note tenute](../../engineering/pitch-tracking/s25-held-voice-loss-2026-10-22.md).
Il seguito reale ha riprodotto la perdita anche con `all`: la variante
non viene promossa a default.

## Esito della prova reale sul brano

Dopo la guida riuscita, la prima esecuzione è esclusa dal confronto vocale:
l'utente conferma di non avere cantato affatto. Rimane utile come baseline
in silenzio: 92 finestre live con pitch su 937 osservate durante Play.
Non attribuire il segnale forte nel finale a una voce che non era presente.

L'utente chiede una ripetizione veloce, riceve l'indicazione di una vocale
continua di 10 secondi dall'avvio della base e riferisce **fatto**. In questa
seconda esecuzione AEC `all` è confermato durante tutta la prova. La nota è
riconosciuta inizialmente intorno a 220 Hz; l'ultima finestra di livello non
nulla è a circa 2,15 s da Play osservato. Da 3 s alla pausa, tutte le 212
finestre di livello osservate contengono zeri e nessuna misura live ha pitch.
Timer sempre attivo e nessun track muted nelle osservazioni.

Queste sono finestre Analyser sovrapposte, rilevate ogni circa 50 ms, non
blocchi PCM disgiunti da confrontare direttamente col precedente 98,5%.
Nessun PCM viene salvato in queste due prove. I tempi di canto sono etichette
deboli guidate dall'utente, non ground truth pre-AEC simultanea. La prova
applicativa non conferma il beneficio osservato nell'acquisizione dedicata:
`all` non costituisce la correzione del problema della nota tenuta.

Evidenze: `phone-play-invalid-no-singing.json`, `phone-play-result.json`,
`phone-play-analysis.json`, `phone-play.png` e `user-labels.json`. Il
microfono è idle dopo la pausa; l'osservatore è rimosso automaticamente.

## Verifiche

- 11 test AEC/probe: modo reale distinto da richiesto, rifiuto di fallback
  silenzioso, NS/AGC, cambio modo durante la misura, journal e sottrazione zero.
- 20 test calibrazione e ciclo Worker superati; sintassi e documentazione valide.
- Smoke browser completo sul pacchetto esatto con ingresso sintetico:
  guida `all`, etichetta visibile, riuso dopo ricarica, 142 finestre vocali
  live, volume, isolamento account/microfono, interruzioni e annullamento.
- Controllo separato senza flag: AEC true, experimental false, guida e
  47 finestre vocali durante Play. I dati sintetici non certificano AEC reale.
- I primi due smoke completi incontrano un errore di import da Worker
  terminato durante annullamento. Il fixture ora distingue gli errori di
  Worker già terminati da quelli attivi; ignora solo i primi, continuando
  a verificare rilascio delle risorse e tutti gli errori attivi. Il terzo
  smoke completo passa. Nessun cambiamento alla gestione Worker pubblicata.
- Screenshot della guida, Base e prova a 1366×768 e 390×844 ispezionati;
  nessun nuovo layout o clipping introdotto dall'etichetta.
- Samsung reale: la nuova pagina carica senza trasporto USB alternativo
  degli asset. Una prima acquisizione reale nel grafo dell'app conferma
  `echoCancellation:'all'`, NS/AGC/voiceIsolation false, 48 kHz.
  Questa verifica non emette suoni e lascia aperta la guida con microfono idle.
- Guida reale successivamente completata dall'utente: AEC `all` operativo,
  profilo attivo, residuo RMS del controllo 0,0000268. Il confronto degli hash
  dello storage conferma tutti i profili precedenti identici e una sola nuova
  voce. La guida conserva il microfono attivo per il brano, come previsto.
  Il valore del residuo non è ERLE né una misura di conservazione del canto
  durante la base. Evidenze: `phone-guide-result.json` e
  `phone-profile-preservation.json`.
- Inventario, hash, riferimenti e dry-run verificati. Backend identico alla
  release precedente; nessun cambiamento a database, account o secret.

Evidenze in `artifacts/aec-all-trial/`: pacchetto, ricetta, diff isolati,
`browser-all-complete/result.json`, `browser-normal/result.json`,
`phone-capture-check.json`, `phone-state.json` e registro del deploy.

## Distribuzione

- Origine: `https://staging.xynon.it`, config `wrangler.xynon.jsonc`.
- Versione: `c8fd1100-909b-4889-bcf5-1efdfa08faff`, 100%.
- Pubblicazione: 22 ottobre 2026, 19:03 CEST.
- Artefatto: `artifacts/aec-all-trial/release`.
- Build: `20261022-165757-9cf44a36476d-dirty-aec-all-trial`.
- File: 1310; brani: 19; asset nuovi/modificati: 7.
- Manifest SHA-256: `4c0ae07e72bae903e3e29bbd6ebcbfd05e62f0fcec0dbed7b11f24d0e10148c2`.
- Worker SHA-256: `cd1bb7ce49eb2393ba63ec787c36a8ec8941b7bf57eb3fbba281e28ce7a2e061`.
- Base e rollback: `da8faba5-c951-4080-b7ef-da7ea53f17d5`.

Sovrapposte solo quattro modifiche puntuali nell'app, il ramo AEC nativo e
runtime/riferimenti all'artefatto congelato About logo. Gli altri lavori locali,
compresi i nuovi preset del pitch e della sincronizzazione, restano esclusi.
La prima lettura immediata del registro dopo upload era ancora sulla versione
precedente; la verifica successiva conferma la nuova versione al 100%.
