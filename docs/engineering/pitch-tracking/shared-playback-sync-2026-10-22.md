# Metronomo, SATB e cursore: sincronizzazione condivisa

**Status:** corretto e verificato localmente; controllo fisico Bluetooth da ripetere  
**Last reviewed:** 2026-10-22

Segnalazione: click in anticipo sulla base con Bluetooth, voci percepite prima
dell'organo, cursore dello spartito leggermente a scatti. Il telefono non è
collegato durante questo intervento; le misure sotto sono digitali sul PC.
Nessuna nuova distribuzione eseguita.

## Cause riscontrate nel codice

- In Cuffie il metronomo creava un AudioContext separato, con latenza d'uscita
  potenzialmente diversa da quello del mixer, più un offset fisso di 160 ms.
- Il piano roll interpolava `currentTime`, ma `renderScore(snapshot.beat)`
  conservava le letture grezze. Il cursore poteva quindi fermarsi per più frame.
- La partitura completa estrapolava senza limite dal tempo di avvio, con
  `max(mediaTime, start + elapsed)`: poteva avanzare anche durante un blocco audio.
- Le tracce SATB partivano all'evento `play` del master, che può precedere
  `playing` e l'effettiva disponibilità dell'accompagnamento. Le correzioni
  ogni `timeupdate` accettavano una singola differenza di 80 ms come drift.

Questi riscontri identificano percorsi fragili, senza dimostrare da soli
quale abbia prodotto ogni differenza percepita nel percorso fisico Bluetooth.

## Modifiche

Click nello stesso AudioContext e bus della base; offset predefinito zero.
Le preferenze di volume/mute sono conservate, il ritardo del piano roll resta
indipendente e i vecchi 160 ms salvati non vengono ripristinati. Il riferimento
della cancellazione comprende il click anche nel nuovo percorso condiviso.

Spartito della prova e piano roll leggono una sola posizione interpolata per
frame: solo il piano roll applica il proprio ritardo. La vista completa usa
lo stesso interpolatore limitato, azzerato da pause, seek, rate e sorgenti nuove;
il buffering blocca la previsione. Dati vocali e valutazione restano sul clock media.

`MediaElementMixer.playTogether()` attende `canplay` su tutte le tracce e le
avvia dallo stesso punto. La preparazione è annullabile e un errore lascia
le tracce ferme. Il master in `waiting` ferma le voci; `playing` le riprende
allineate. Una differenza superiore a 40 ms deve ricorrere con lo stesso segno
in almeno tre osservazioni per 300 ms prima di correggere una traccia.
La partitura completa riusa le stesse funzioni del mixer.

L'intervento conserva layout, controlli e gerarchia visiva; nessuna eccezione
al design system. Il movimento resta funzionale alla lettura musicale.

## Misure dei file musicali

`browser_mix_sync_probe.py --asset-onsets` decodifica gli MP3 originali di Santo
con Chrome a 48 kHz. Cinque file con 4.551.575 campioni ciascuno, durata
94,824479 s. Gli attacchi isolati esaminati iniziano circa 51–64 ms dopo il
timestamp di partitura alla soglia dell'1% del picco locale. Le soglie più alte
mostrano tempi differenti, coerenti con inviluppi diversi dei timbri.

Non emerge un anticipo fisso SATB rispetto all'accompagnamento in questa
verifica. Il controllo degli attacchi non è una certificazione di tutti i
transitori del brano; non giustifica spostare arbitrariamente i file musicali.
I file non sono stati modificati. Evidenza: `artifacts/mix-sync/asset-onsets.json`.

## Misure del grafo

Il nuovo probe inserisce lo stesso WAV sintetico a impulsi nel master e nei
quattro media element vocali, attraverso il mixer reale. Un solo Worklet
cattura simultaneamente le cinque sorgenti prima del gain: si confronta il
PCM, senza assumere che le proprietà `currentTime` siano una misura del suono.
Il percorso fisico è muto; nessun microfono aperto.

Con `--metronome`, il click viene catturato su un sesto ingresso dello stesso
Worklet; il bus di uscita è reindirizzato a un sink muto durante il test.

- Baseline locale e candidato: scarto SATB/master zero alla risoluzione della
  correlazione, 0,125 ms. Questo caso già bufferizzato non riproduce il sintomo
  fisico e non è presentato come un prima/dopo del Bluetooth.
- Candidato sui sorgenti: click rispetto agli impulsi di riferimento +6,875,
  +4,5 e +2,146 ms.
- Candidato compilato: +6,875, +4,5 e +10,146 ms. L'aggancio del click conserva
  il polling RAF, quindi il test non promette un metronomo sample-accurate.

Evidenze `baseline.json`, `shared-metronome.json` e `built-shared-metronome.json`
in `artifacts/mix-sync/`. Il test ora richiede segnale su ogni ingresso,
scarto tra tracce ≤2 ms e click entro 40 ms per il caso sintetico locale.

## Regressioni

- Typecheck e 112 test API passati. Suite audio/calibrazione passata; aggiunti
  cinque test su attesa del master, annullamento, errore del decoder,
  timestamp oscillanti e correzione del drift persistente.
- Smoke metronomo: default 30%, volume/mute salvati, impulsi a 80/90/100%,
  offset zero. Screenshot desktop e mobile generati.
- Clock media sintetico a passi di 100 ms: spartito della prova e piano roll
  circa 60 avanzamenti/s e zero posizioni ripetute, a 1366×768 e 390×844.
- Vista completa con clock a 10 Hz: cursore circa 60 avanzamenti/s, pausa
  invariata dopo 250 ms, nessun errore pagina, negli stessi viewport.
- Smoke pan/zoom, tastiera/touch, nota sintetica e checkpoint del piano roll
  passato. Il test prepara la scelta audio recente richiesta dalla UI attuale.

Gli stessi probe del mixer e del movimento sono eseguiti anche sugli asset
fingerprintati di `artifacts/mix-sync/build`, con sola sessione locale fittizia.
Questa build comprende modifiche preesistenti del workspace e non è distribuita.

Lo smoke geometrico `browser_score_viewer_layout_smoke.py` sulla sorgente di
Qui credit si ferma perché trova un solo sistema, anziché più sistemi attesi
dal fixture; non certifica quindi il centraggio delle righe. Il nuovo test
del movimento usa la partitura Ave verum e verifica direttamente la posizione
del cursore e la pausa. La modifica non cambia il calcolo della geometria.

## Controllo rimanente

Ripetere con Samsung e AirPods collegati, verificando build attiva, grafo e
percorso A2DP, e confrontando ascolto del click, SATB e accompagnamento dopo
avvio/seek/buffering. Le misure digitali del PC non includono codec, profili
Bluetooth, adattamenti hardware o la latenza delle cuffie dell'utente.

Riferimento tecnico: [W3C Media Timed Events](https://www.w3.org/TR/media-timed-events/#using-timeupdate-events-from-the-media-element)
descrive l'aggiornamento non uniforme di `currentTime`; la
[specifica Web Audio](https://www.w3.org/TR/webaudio-1.0/) distingue tempo del
contesto e uscita del dispositivo. I test qui misurano il grafo direttamente,
senza dedurre la latenza acustica dalla differenza di clock.
