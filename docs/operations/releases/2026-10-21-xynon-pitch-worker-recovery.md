# Xynon: recupero del Worker pitch bloccato

**Status:** pubblicato su Xynon staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

Un download del Worker che resta in attesa senza `onerror` lascia il buffer
trasferito e `pitchWorkerInFlight` attivo. Il timer resta acceso ma non produce
nuove misure. È un secondo problema distinto dal
[mancato riavvio dopo il riuso del profilo](2026-10-21-xynon-live-voice-restore.md).

Ogni richiesta ha un timeout di 1500 ms. Alla scadenza si termina il Worker,
si rialloca il buffer e si prosegue nel detector già presente nella pagina,
con le stesse soglie e risoluzione armonica. Il fallback vale per l'acquisizione
corrente; la successiva può riprovare il Worker. Stop, risultato ed errori
cancellano il timeout. Messaggi ed errori tardivi non alterano un Worker nuovo.
Non cambiano AEC, calibrazione salvata o layout.

## Verifiche

- Otto test del ciclo Worker: buffer realmente trasferito, mancata risposta,
  risposta regolare, stop, evento tardivo, errori e fallimento del trasferimento.
- Otto test AEC/probe preesistenti superati; sintassi e documentazione valide.
- Browser con Web Audio reale e ingresso sintetico: guida, riuso dopo ricarica,
  cambi volume, isolamento account/microfono, interruzioni e annullamento.
  Con Worker simulato senza risposte: 96 finestre vocali a 220 Hz nella traccia,
  timer attivo e Worker rilasciato. Fixture di identità solo nel server locale.
- Controllo separato con Worker reale e funzionante: 46 finestre vocali durante
  Play, stesso ingresso e stesse soglie dopo la guida.
- S25+ reale: esecuzione isolata delle esatte funzioni del pacchetto candidato,
  Worker con trasporto normale, segnale sintetico a 220 Hz. Il Worker non
  risponde, il fallback produce 106 misure valide; prima misura dopo 1537 ms,
  mediana 220,0017 Hz, massimo tempo di analisi osservato 14,2 ms.
  Nessun uso del microfono, suono, modifica di stato della webapp o profilo.
- Questo test sul telefono verifica il recupero, non ERLE o qualità del canto.
  Il problema di rete sottostante resta da isolare. La precedente prova con
  canto e base usa trasporto USB del Worker ed è documentata separatamente.
- Pacchetto e riferimenti verificati; dry-run conferma backend invariato.
- Dopo deploy, il Samsung autenticato legge il manifest pubblicato con HTTP
  200 e SHA-256 corrispondente. Una richiesta al nuovo app JS termina invece
  per timeout dopo 7 secondi: non si dichiara verificato il caricamento normale
  completo della nuova app sul telefono. La pagina Esercizi in uso non viene
  ricaricata o modificata. Rimane da diagnosticare l'instabilità di rete/asset.

L'interfaccia è invariata. Gli screenshot prodotti dallo smoke a 1366×768 e
390×844 sono in `artifacts/calibration-noise-restore/worker-recovery-browser`.

## Pacchetto

- Origine: `https://staging.xynon.it`.
- Configurazione: `wrangler.xynon.jsonc`.
- Versione: `8675e5a3-7801-4e28-ada5-b71660e70dae`, traffico 100%.
- Pubblicazione: 21 ottobre 2026, 20:17 CEST.
- Artefatto: `artifacts/calibration-noise-restore/release-worker-recovery`.
- Build: `20261021-181143-6811032c1db7-dirty-pitch-worker-recovery`.
- File: 1304; 19 brani.
- SHA-256 manifest: `bc91b05eab1418eb9f1457ddbc319190e66473216aa7d76aa43e9cdf41baf689`.
- SHA-256 Worker backend: `9b6dd067fb5b2e9339732bdd5b2156ae1438d306a108df93ab135fc9437ed4bd`.
- Base e rollback: `5a4e9e06-e4df-4890-89ac-a9d7b64d7108`.

Il pacchetto deriva dall'esatto rilascio precedente, con sovrapposizione delle
sole funzioni pitch e del relativo campo di stato, runtime e riferimenti.
Non include gli altri lavori locali. Ricetta, hash e risultati diagnostici
in `artifacts/calibration-noise-restore/`.
