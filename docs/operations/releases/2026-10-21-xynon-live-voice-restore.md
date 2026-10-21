# Xynon: analisi vocale ripristinata con il profilo salvato

**Status:** pubblicato su staging Xynon; ripristino live confermato sul Samsung  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Problema e correzione

Durante il riuso nativo, `adapter.startMicrophone()` apre l'ingresso e ferma
il Worker/ciclo live per preparare la calibrazione. Quando trova un profilo
salvato, `verifyPlayback()` salta la guida, quindi non passa per il suo evento
di chiusura che normalmente richiama `resumeAnalysis()`. Il microfono resta
attivo, ma la voce non viene elaborata né disegnata durante il brano.

Il percorso di ripristino ora richiama esplicitamente `resumeAnalysis()`
dopo `changed()`. Il profilo, le soglie, l'AEC e i criteri di ammissione
rimangono invariati. Non occorre rifare la calibrazione.

La segnalazione iniziale associava il difetto al segnale musicale. In via
conservativa, la guida torna ai due fruscii indipendenti della versione
precedente (2 s, ampiezza 0,08, seed 173/957); non richiede più download o
decodifica musicale. Il difetto live è riprodotto anche con i fruscii, prima
della correzione del riuso: non è prova che gli archi cancellassero la voce.
Gli asset musicali restano nell'artefatto per confronto, senza uso nel runtime.
Il nuovo profilo registra il tipo di segnale, senza invalidare quelli esistenti.

## Evidenza Samsung

Chrome sul S25+ è ispezionato via USB, con sessione reale. Il telefono è
al volume 6/15, lasciato invariato. La rete lasciava molti moduli in attesa;
sono stati forniti via CDP gli esatti file statici pubblicati, verificati
contro il manifest, senza fixture di identità/API o alterazioni dei dati.

Nel confronto guidato di 25 s, nessun PCM è esportato o salvato e non si
avviano registrazioni/best. Il test ripristina posizione, traccia e tentativo.
La stessa acquisizione attraversa canto senza base e con Santo:

- senza base: 75/86 finestre riconosciute dal detector diretto;
- con base: 72/91 finestre riconosciute dal detector diretto;
- nel pitch live: zero finestre vocali in entrambe le fasi;
- la calibrazione precedente e quella nuova hanno le stesse soglie.

Le finestre guidate includono gli attacchi e non sono ground truth di recall
o intonazione. Il segnale può comunque subire attenuazione AEC: questa prova
isola il mancato avvio software e non certifica la trasparenza acustica.

### Conferma dopo la correzione

Due tentativi brevi sono esclusi dall'analisi: l'utente ha dichiarato di non
aver cantato. La guida è stata quindi resa manuale con **Sono pronto**, 12 s
di preparazione e fasi vocali da 8 s; la seconda preparazione dura 10 s.
La guida temporanea conserva chiusura, Escape, countdown e indicazione
esplicita CANTA/STOP; non modifica la UI distribuita dell'app.

L'utente ha confermato di aver iniziato la seconda vocale appena è partita
Santo, durante l'intervallo etichettato dal protocollo come attesa. Le etichette
automatiche di quella fase non descrivono quindi silenzio effettivo:

- canto senza base: 111 finestre con F0 diretto e 102 con pitch live su 121;
- canto durante l'avvio di Santo: 152 finestre con F0 diretto e 142 con pitch
  live su 156; mediana del detector diretto circa 181 Hz;
- timer di analisi attivo in tutte le finestre, sullo stesso ingresso;
- profilo riutilizzato, nessuna nuova calibrazione e nessun cambio volume.

Il conteggio conferma che il pitch live riceve nuovamente la voce anche con
la base. Non costituisce recall misurata, confronto di livelli identici,
accuratezza in cent o ERLE. I tratti dichiarati silenziosi dalla guida non
sono utilizzabili per stimare falsi positivi senza la correzione delle etichette.

Per escludere l'attesa del download del Worker come interferenza, il codice
pubblicato di detector e Worker, verificato con SHA-256, è stato fornito via
USB a un Worker Blob locale con dipendenza inclusa. L'algoritmo è invariato;
questo verifica il ciclo live e non il download normale del Worker sul telefono.
L'adattatore temporaneo viene rimosso al termine. Non sono stati salvati PCM,
registrazioni o tentativi; posizione, traccia e stato della prova sono ripristinati.
Evidenze: `phone-voice-comparison-long-guide.json`,
`phone-long-guide-analysis.json`, `phone-worker-transport.json` negli artefatti.

## Pacchetto

- Origine: `https://staging.xynon.it`.
- Configurazione: `wrangler.xynon.jsonc`.
- Versione: `5a4e9e06-e4df-4890-89ac-a9d7b64d7108`, traffico 100%.
- Pubblicazione: 21 ottobre 2026, 19:40 CEST.
- Artefatto: `artifacts/calibration-noise-restore/release-fixed`.
- Build: `20261021-173715-6811032c1db7-dirty-live-voice-restore`.
- File: 1304; 19 brani.
- SHA-256 manifest: `1e775eb374c8809927033f759d30184d5d2d7332197041b8ec1e039b4d7d340b`.
- SHA-256 Worker: `9b6dd067fb5b2e9339732bdd5b2156ae1438d306a108df93ab135fc9437ed4bd`.
- Base e rollback: `9a964cd2-bad8-4d91-a69e-922683efe796`.

Il pacchetto deriva dall'esatto [rilascio testata](2026-10-21-xynon-exercise-header.md).
Cambiano caricatore del segnale, coordinatore calibrazione, copy/crediti della
guida e riferimenti fingerprintati/runtime. Non include altri lavori locali.

## Verifiche

- Prima della correzione, il nuovo test fallisce dopo ricarica con timer
  assente, microfono attivo e pitch nullo. Dopo la correzione: timer attivo
  e 141 finestre vocali nella traccia, senza ripetere la guida.
- 64 test audio/lifecycle e 14 test della build superati. PCM del rumore
  confrontato campione per campione con la versione precedente a tre frequenze.
- Guida completa con Worker reali, passaggio Home→brano, riuso, ricarica,
  isolamento account/microfono, interruzioni e annullamento verificati.
- Segnale di preparazione indisponibile: nessun suono, microfono rilasciato.
- Screenshot della guida a 1366×768 e 390×844 ispezionati senza clipping.
- Manifest, riferimenti e dry-run Worker verificati; fixture solo locali.
- Deploy completato con 7 asset nuovi/modificati; registro remoto conferma
  la versione al 100%. La versione corretta è caricata nella sessione reale
  del Samsung e conserva il profilo esistente.
- Lo smoke anonimo remoto non è interamente passato: due esecuzioni sono
  rimaste sul caricamento Clerk (prima desktop, poi mobile), senza errore
  JavaScript/CSP. Nel secondo tentativo il login desktop era caricato.
  I file di autenticazione e il Worker sono identici alla base; i risultati
  parziali sono conservati. Non si dichiara verificato il login anonimo completo.

Evidenze e ricetta in `artifacts/calibration-noise-restore/`.

```powershell
python scripts/browser_audio_calibration_smoke.py --native-aec --url http://127.0.0.1:5217/?piece=santo-frisina&part=P3
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/calibration-noise-restore/release-fixed --tag live-voice-restore-2026-10-21
```
