# Piano roll continuo e ascolto Bluetooth su Android

**Status:** implementato e verificato localmente; candidato provato sul Samsung, non pubblicato  
**Last reviewed:** 2026-10-21

## Problema e modifica

L'[audit sul Samsung con AirPods](bluetooth-sync-audit-2026-10-21.md) distingue
due problemi: rendering regolare ma posizione media ripetuta/saltata, e
microfono Bluetooth predefinito che sposta l'uscita musicale da A2DP a SCO.
Il solo offset temporale non corregge nessuno dei due.

`practice_math.js` aggiunge `VisualPlaybackTime`. Il piano roll continua a
disegnare nel RAF esistente; la posizione visiva avanza con tempo monotono
e velocità media tra le osservazioni. Le correzioni di fase sono limitate
al 10% dell'avanzamento per frame; la previsione è limitata a 120 ms rispetto
all'ultima osservazione e si ferma dopo 120 ms senza progressi. Pausa,
buffering/ricerca, rate e sorgente nuovi, discontinuità grandi e intervalli
di frame oltre 250 ms riancorano. Gli eventi media azzerano l'epoch anche
per seek brevi. Non viene creato un secondo ciclo concorrente che ridisegna
lo stesso canvas; non è il detector a decidere quando scorre la musica.

`app.js` usa il tempo interpolato soltanto in `drawPitchLane`. Il cursore
spartito, i timestamp registrati, il bersaglio, il metronomo e la valutazione
mantengono il clock media. Il ritardo visivo e i preset della scia restano
configurabili come prima. Nessuna nuova stima della latenza hardware.

`media_mixer.js` aggiunge l'acquisizione del microfono: Android + Cuffie +
dispositivi Bluetooth/telefono esposti porta alla selezione esatta dell'ingresso
del telefono, con AEC/NS/AGC disattivati. L'ingresso non è identificato tramite
ordine o ID fisso: si usano i percorsi nominati dal browser, verificati sul
Samsung (`Speakerphone` + `Bluetooth headset`). La prima autorizzazione può
richiedere un ingresso transitorio per rendere visibili i nomi: viene fermato
prima della riacquisizione. Una richiesta annullata non riapre ingressi.
L'indisponibilità del telefono selezionato genera un errore anziché riaprire
silenziosamente il microfono delle cuffie. Senza percorsi riconoscibili si
conserva la richiesta originale; non si promette compatibilità universale.

Altoparlanti/AEC e piattaforme diverse da Android conservano il percorso
esistente. Il profilo vocale si confronta con device e settings effettivi:
quello del microfono AirPods non viene applicato al telefono. Non sono cambiati
gain, soglie del detector o dati vocali per aumentare artificialmente il volume.

## Verifica fisica

Samsung SM-S9360, Android 16, Chrome 155, AirPods collegati; origine autorizzata
`staging.xynon.it`, brano Santo. La pagina pubblicata non è stata sostituita:
il probe `--candidate` carica temporaneamente i moduli e le tre funzioni locali
interessate, conserva gli SHA-256 dei sorgenti e li ripristina alla fine.
I normali file musicali vengono scaricati negli stessi media element come
Blob temporanei per isolare gli errori di lettura/seek già osservati online.
Non è una certificazione della consegna MP3 ordinaria.

| Ascolto | Avanzamenti piano roll/s | Posizioni ripetute | Percorso audio |
| --- | ---: | ---: | --- |
| A, implementazione pubblicata | 35,5 | 122 in 5 s | Bluetooth SCO |
| B, correzione candidata | 59,8 | 0 in 8 s | Bluetooth A2DP + microfono telefono |

Entrambe le prove disegnano circa 60 frame/s. Gli stessi livelli app e Android
sono stati conservati. L'utente conferma dopo il confronto: **volume migliorato**.
Non si riporta una misura SPL o un guadagno in dB non misurato.

- `artifacts/bluetooth-sync/samsung-candidate-1`: due condizioni, senza
  microfono e con acquisizione ordinaria candidata; entrambe ~60 avanzamenti/s,
  zero ripetizioni anche con salti del media clock fino a ~92 ms. Output A2DP
  e ingresso fisico `AUDIO_DEVICE_IN_BUILTIN_MIC`, verificati nei dump Android.
- `samsung-listen-a` / `samsung-listen-b`: confronto tabellato e conferma umana.
- `samsung-route-transition`: apertura intenzionale del microfono AirPods,
  quindi riapertura ordinaria con il candidato senza suspend/resume tra le
  condizioni. L'uscita torna da SCO ad A2DP; acquisizione telefono riuscita.
- Le condizioni ripristinano pausa, posizione iniziale, storico, stato prova,
  sorgenti e microfono chiuso. Nessun PCM del microfono salvato o inviato.

## Test e pacchetto

- `npm run typecheck`, 112 test API, 72 test calibrazione/DSP passati. Gli otto
  test nuovi coprono clock a passi di 100 ms alle due velocità, pause/seek/
  rate/background, stall muto, selezione del telefono, permesso iniziale,
  annullamento e telefono non più disponibile.
- Test preesistenti di math, media mixer, score runtime e lifecycle Worker
  passati: il recupero dal Worker mantiene detector e controllo dei buffer.
- `browser_bluetooth_sync_probe.py --clock-step-ms 100 --live-input`: tempo
  vocale sintetico reale nel browser, clock media artificialmente a 10 Hz,
  movimento visuale ~60 Hz, zero ripetizioni. Nei test precedenti senza
  interpolazione la medesima condizione produceva ~10 avanzamenti/s.
- Smoke `browser_piano_roll_smoke.py` su sorgenti e pacchetto compilato a
  1366×768 e 390×844: pan, zoom ancorato, tastiera/touch, nota sintetica,
  invariabilità del checkpoint, nessun errore pagina o overflow. Screenshot
  ispezionati: gerarchia e comandi esistenti conservati. Il testo audio resta
  sotto disclosure; nessuna nuova superficie o controllo.
- `npm run build:xynon`: build locale
  `20261021-213359-6811032c1db7-dirty`, 1308 file, 19 brani. Smoke del clock
  a passi e voce sintetica passato anche sugli asset fingerprintati in
  `artifacts/xynon-dist`, con sola sessione sintetica locale.

La build incorpora anche modifiche preesistenti del workspace; non è stata
distribuita. Per una pubblicazione isolata occorre preparare il pacchetto
della correzione rispetto alla release online. Le misure fisiche del candidato
usano i sorgenti esatti dei moduli modificati, non un deploy remoto.
