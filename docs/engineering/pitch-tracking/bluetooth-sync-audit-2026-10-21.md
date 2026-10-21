# Verifica sincronizzazione Bluetooth

**Status:** scatti del clock e cambio di percorso confermati sul Samsung; attenuazione acustica non misurata  
**Last reviewed:** 2026-10-21

## Esito

L'utente ha precisato che il volume della base è bassissimo e il movimento
del piano roll sembra avere meno FPS rispetto all'ascolto senza cuffie.
I preset temporali descritti sotto non spiegano questi due sintomi: cambiano
la posizione della scia, senza cambiare guadagno o frequenza del rendering.
La prima prova senza microfono non poteva escludere il problema segnalato.

La successiva verifica USB sul Samsung SM-S9360 con AirPods conferma clock
media intermittentemente irregolare a fronte di rendering regolare a 60 fps,
e il passaggio A2DP → SCO usando l'ingresso Bluetooth di default. Il microfono
esplicito del telefono conserva l'uscita A2DP. I guadagni del mixer restano
invariati; l'attenuazione acustica riferita dall'utente non è stata misurata.
Risultati fisici nella terza verifica in fondo al documento.

La segnalazione iniziale di disallineamento è compatibile con il modello attuale.
La scelta Bluetooth corregge la posizione temporale della scia di soli 50 ms
aggiuntivi, senza misurare il percorso cuffie/microfono. Non basta a garantire
l'allineamento di una catena Bluetooth diversa da quella assunta dal preset.
La prova locale non identifica né quantifica il ritardo delle cuffiette
dell'utente e non riproduce il loro percorso fisico.

| Valore | Cavo/dispositivo | Bluetooth |
| --- | ---: | ---: |
| Ritardo piano roll rispetto al clock media | 270 ms | 270 ms |
| Correzione del timestamp visuale della scia | −270 ms | −320 ms |
| Misura automatica della latenza nel percorso visuale | assente | assente |

I valori sono i default della sessione pulita. I cursori avanzati consentono
di modificarli manualmente tra 0 e 600 ms; il cambio connessione reimposta
soltanto la correzione della scia. La preferenza connessione vive nella scheda
e non seleziona né rileva l'uscita del sistema operativo.

## Riscontro nel codice

- `frontend/score_runtime.js`, `MediaPlaybackClock.snapshot()`: posizione
  derivata da `HTMLAudioElement.currentTime`.
- `frontend/app.js`, `currentPianoRollBeat()`: sottrae il ritardo piano roll,
  corretto per la velocità di riproduzione.
- `visuallyAdvancedPitchBeat()`: sottrae 270/320 ms al timestamp della voce.
  La scelta Bluetooth non interviene sul movimento dei blocchi melodici.
- `startPitchAnalysisLoop()` / `analyseMicrophone()`: il timestamp del campione
  è il beat media al momento della lettura dell'Analyser, prima della risposta
  Worker; non viene corretto per la latenza dell'ingresso Bluetooth.
- `echo_cancellation_ui.js` conserva `baseLatency` e `outputLatency` nella
  diagnostica, senza usarli per l'allineamento del piano roll.

La correzione della scia modifica solo la rappresentazione: non corregge i
timestamp conservati o la selezione del bersaglio usata dalla valutazione.
La verifica presente non certifica l'allineamento della valutazione Bluetooth.

## Prove ripetibili

```powershell
python scripts/serve_frontend.py --skip-library-prebuild --port 5173
python scripts/browser_bluetooth_sync_probe.py
python scripts/browser_piano_roll_smoke.py
```

Il probe usa la pagina reale e un profilo browser temporaneo, senza microfono,
registrazioni o invii. Base e metronomo sono muti. I report `outputLatency`
iniettati di 0/150/300 ms sono valori sintetici: non aggiungono buffer audio
e non simulano un dispositivo o un ingresso Bluetooth. Il test caratterizza
il difetto attuale; le asserzioni sui valori fissi andranno riviste quando
verrà implementata una compensazione.

Evidenza: `artifacts/bluetooth-sync/result.json`.

- Dodici combinazioni: velocità 1×/0,8×, connessione standard/Bluetooth,
  latenza riportata 0/150/300 ms. L'allineamento resta invariato al variare
  della latenza riportata: ritardo piano roll 270 ms, scia 270/320 ms.
- Riproduzione media reale a 1366×768 e 390×844 con entrambe le preferenze:
  campionamento RAF e posizione renderizzata registrati integralmente nel JSON.
  Il cambio di preferenza da solo non riproduce un rallentamento del rendering.
- Smoke piano roll passato nei due viewport: pan, zoom, tastiera/touch,
  ascolto della nota e conservazione del checkpoint. Screenshot desktop/mobile
  ispezionati: nessun clipping dei comandi o scroll della pagina.
- Sul PC risultano presenti solo Speakers e Microphone Array Realtek,
  nessun endpoint Bluetooth disponibile. Il microfono resta chiuso nel probe.

## Limiti e seguito necessario

Il test conferma l'assenza di adattamento applicativo alla latenza riportata,
non dimostra un errore acustico di 150 o 300 ms. Non misura quanto il browser
compensi già internamente il media clock, la coda hardware, l'eventuale cambio
di profilo Bluetooth all'apertura del microfono o il costo del detector sul
telefono. Anche il movimento regolare osservato riguarda il PC senza cattura,
non certifica i frame del telefono con cuffiette e microfono attivi.

Per attribuire il ritardo servono dispositivo/cuffie/browser e il confronto
sulla stessa catena fra base ascoltata, passaggio delle note e scia della voce,
con microfono attivo. Distinguere uscita e ingresso prima di cambiare i default:
aumentare il ritardo del piano roll o la correzione della scia produce effetti
diversi e può sovracompensare un percorso già allineato.

La [specifica Web Audio](https://www.w3.org/TR/webaudio-1.0/#dom-audiocontext-outputlatency)
definisce `outputLatency` come stima dipendente dal dispositivo;
`getOutputTimestamp()` permette di mappare il tempo del contesto all'uscita.
La semplice differenza con `currentTime` non è una misura affidabile della
latenza. Il [riferimento Chrome](https://web.dev/articles/audio-output-latency)
mostra l'uso della stima per sincronizzare un canvas all'audio Web Audio.
Queste API non misurano da sole l'intera catena voce/microfono/detector.

Nessuna modifica al comportamento dell'app e nessuna distribuzione eseguita.

## Seconda verifica: volume basso e movimento a scatti

Il probe ora distingue i callback RAF dagli avanzamenti effettivi del clock,
registra costo del rendering, costo/attesa del pitch, stato Worker e guadagni
richiesti dal mixer. L'ingresso sintetico è un WAV 220 Hz fornito al dispositivo
fittizio di Chrome: non apre il microfono fisico. La base resta muta nel test;
i guadagni osservati sono quelli richiesti, non una misura acustica del volume.

| Prova | Desktop: RAF / movimento al secondo | Mobile: RAF / movimento al secondo |
| --- | --- | --- |
| Microfono sintetico, Worker, CPU normale | 60 / 60 | 60 / 60 |
| Microfono sintetico, Worker, CPU rallentata 6× | 38 / 38 | 53–58 / 53–58 |
| Microfono sintetico, fallback nella pagina, CPU rallentata 6× | 32–34 / 32–34 | 41–46 / 41–46 |
| Letture del clock quantizzate artificialmente a 100 ms | 60 / 10 | 60 / 10 |

Le escursioni riportano entrambe le preferenze nella singola esecuzione,
non intervalli statistici. Il rallentamento CDP è sintetico e non equivale al
telefono dell'utente. Il confronto non prova un effetto del Bluetooth:
nessun endpoint Bluetooth è collegato nelle quattro condizioni.

Risultati e comandi:

```powershell
python scripts/browser_bluetooth_sync_probe.py --live-input --output artifacts/bluetooth-sync/live-worker.json
python scripts/browser_bluetooth_sync_probe.py --live-input --cpu-slowdown 6 --output artifacts/bluetooth-sync/live-worker-cpu6.json
python scripts/browser_bluetooth_sync_probe.py --live-input --force-pitch-fallback --cpu-slowdown 6 --output artifacts/bluetooth-sync/live-fallback-cpu6.json
python scripts/browser_bluetooth_sync_probe.py --clock-step-ms 100 --output artifacts/bluetooth-sync/stepped-clock.json
```

Tutte le prove passate a 1366×768 e 390×844, con voce rilevata dove prevista,
assenza di overflow e invariabilità dei livelli richiesti. Nel brano di prova
il volume principale è 62%, guadagno della propria parte 0,31 e delle altre
0,155, identici prima/dopo apertura del microfono sintetico e cambio della
sola preferenza standard/Bluetooth. Non viene misurato il guadagno hardware.

Il test con clock quantizzato dimostra un limite della verifica basata sui
soli RAF: un grafico apparentemente a 10 FPS può convivere con 60 callback
al secondo. Non dimostra che il Bluetooth produca quel clock. Bisogna leggere
sia `state.lastSnapshot.performanceTime` sia `media.currentTime` sul dispositivo.

In modalità cuffie `toggleMicrophone()` richiede `autoGainControl: true`,
`echoCancellation: false`, `noiseSuppression: false`, con ingresso di default.
Le impostazioni effettive della sorgente fittizia confermano quei tre valori.
La richiesta AGC, da sola, non dimostra l'attivazione di un profilo telefonico
e non giustifica una modifica delle constraints senza prova sul dispositivo.

Il [codice Chromium Android](https://chromium.googlesource.com/chromium/src/media/+/refs/heads/main/audio/android/audio_manager_android.cc)
mostra percorsi in cui l'apertura di un ingresso con effetti cambia la modalità
di comunicazione e l'uso dell'uscita; altri percorsi con selezione per stream
seguono regole diverse. Su Windows, [Microsoft documenta](https://learn.microsoft.com/en-us/windows-hardware/drivers/bluetooth/bluetooth-classic-audio)
il passaggio a HFP quando viene aperto il microfono Bluetooth Classic.
Questi riferimenti rendono il cambio di profilo una pista da verificare;
non identificano sistema, versione, profilo o causa del volume nel caso reale.

Al momento della seconda verifica ADB non vedeva dispositivi e il PC esponeva solo
Realtek. Per proseguire sul sintomo reale mancano dispositivo, cuffiette e
momento del calo: collegamento cuffie, apertura microfono o avvio della base.
Il riscontro fisico deve confrontare volume e clock nelle stesse condizioni,
senza assumere che un'eventuale perdita di fluidità dipenda dagli offset.

## Terza verifica: Samsung e AirPods via USB

Dispositivo SM-S9360, Android 16, Chrome 155; pagina autorizzata
`staging.xynon.it`, build `20261021-183445-6811032c1db7-dirty-startup-cache`,
brano `santo-frisina`, viewport reale 384×694. Preferenza d'ascolto Cuffie,
connessione memorizzata **standard**, volume app 62%, volume media Android
9/15. Non sono stati cambiati volumi, preferenze persistenti o calibrazioni.

### Movimento del piano roll

Prova `artifacts/bluetooth-sync/samsung-stable-1/result.json`, dopo 2,5 s di
assestamento e con finestre di 4 s, file musicali già scaricati in Blob URL:

| Condizione | Uscita effettiva AudioFlinger | Ingresso effettivo | RAF e disegni/s | Avanzamenti/s | Massimo salto del clock |
| --- | --- | --- | ---: | ---: | ---: |
| Solo ascolto | Bluetooth A2DP, 44,1 kHz | chiuso | 60,1 | 44,9 | 84,4 ms |
| Microfono del telefono, elaborazioni spente | Bluetooth A2DP, 44,1 kHz | built-in, bottom | 60,0 | 43,3 | 82,1 ms |
| Microfono predefinito dell'app | Bluetooth SCO, 48 kHz nel mixer Android | Bluetooth SCO headset | 60,0 | 59,7 | 23,8 ms |

Nelle prime due finestre, rispettivamente 60 e 66 disegni consecutivi
mantengono la stessa posizione, distribuiti nella finestra; non sono 60/66
frame bloccati consecutivamente. Il disegno del piano roll impiega circa
0,6–0,9 ms mediani e 0,9–1,2 ms al percentile 95. Il Worker del pitch resta
attivo. Il risultato esclude il calo della frequenza RAF in queste finestre,
ma conferma avanzamenti disuniformi visibili senza carico grafico elevato.

Il fenomeno è intermittente: `samsung-buffered-1` registra 43,2 e 52,6
avanzamenti/s; `samsung-buffered-2` circa 60 in tutte e tre le finestre.
`samsung-builtin-1` registra 44,8, 45,9 e 31,6. Queste prove non costituiscono
un confronto controllato con Bluetooth disconnesso; verificano gli scatti
riferiti con cuffie collegate, senza attribuirne da sole ogni causa al codec.

### Percorso e volume

Le istantanee `*-media.audio_policy.txt` e `*-media.audio_flinger.txt` della
prova stabile identificano la coppia ingresso/uscita realmente usata:
microfono interno + A2DP contro microfono AirPods + SCO. `dumpsys audio`
può continuare a mostrare `MODE_NORMAL` e il dispositivo media A2DP anche
quando AudioFlinger rende sullo SCO: leggere solo quelle due etichette
avrebbe nascosto il cambio per stream.

Il browser espone ingressi Predefinito, Speakerphone, Headset earpiece e
Bluetooth headset. La selezione temporanea esatta di Speakerphone, con
AEC/NS/AGC spenti, usa `AUDIO_DEVICE_IN_BUILTIN_MIC` e mantiene gli AirPods
come uscita A2DP: è un percorso praticabile da considerare per la correzione.
Spegnere soltanto AGC non ha dimostrato il ritorno ad A2DP: la prova `raw`
in `samsung-buffered-2` rimane sullo SCO.

In tutte le condizioni i guadagni richiesti e applicati restano circa
0,110909 per l'accompagnamento, 0,277272 per la propria parte e 0,138636
per ciascuna altra voce. La base non resta muta per calibrazione. Il cambio
di profilo è verificato e può contribuire al diverso ascolto; non è una
misura SPL né una dimostrazione quantitativa del volume percepito come
bassissimo. I 48 kHz del mixer/Analyser non attestano la banda del codec SCO.

### Consegna audio e isolamento della prova

I primi tentativi con i normali URL incontrano
`PipelineStatus::PIPELINE_ERROR_READ: FFmpegDemuxer: data source error` e seek
che non si completano. Un fetch dello stesso MP3 con `Range: bytes=0-31`
riceve 200, `audio/mpeg`, 1.517.190 byte e nessun Content-Range; il contenuto
inizia con un frame MP3. Il riscontro non identifica da solo cache, rete o
server come causa del fallimento della pipeline.

Per confrontare il routing senza quel problema, il probe scarica gli stessi
file nel browser e usa Blob URL temporanei sugli stessi media element e sullo
stesso mixer. Le misure di clock/routing sono quindi su file bufferizzati;
non certificano risolto il caricamento ordinario. Nessun PCM microfonico
registrato o esportato e nessun risultato inviato. I metadati di timing e i
dump del sistema restano negli artifact locali.

### Ripetibilità e ripristino

```powershell
.\artifacts\android-tools\platform-tools\adb.exe forward tcp:9223 localabstract:chrome_devtools_remote
python scripts/probe_bluetooth_device.py --run --buffer-media --reset-output --phases media builtin input --output artifacts/bluetooth-sync/samsung-stable-1
```

Usare una nuova directory di output; l'app deve essere visibile, in pausa,
con microfono chiuso e senza acquisizioni o dialoghi aperti. Senza `--run`
lo script legge soltanto lo stato. `--run` comporta brevi ascolti reali e
aperture del microfono, non una calibrazione né una registrazione diagnostica.

Il probe ripristina funzioni, sorgenti, storico, stato della prova, constraints
e microfono chiuso; riapre i contesti d'uscita per evitare di lasciarli sul
percorso precedente. Su questa pagina il seek originale può fallire anche
nel ripristino: per posizioni iniziali brevi il tool ripristina con playback
muto da zero, senza valutazione. `samsung-cleanup-check` verifica l'ultima
versione del ripristino con una nuova breve prova.

La posizione iniziale di 2,523352 s è stata ripristinata a 2,530615 s in pausa
prima dell'ultimo controllo; scarto inferiore a un frame. Nessun microfono,
registrazione o probe lasciato attivo. Nessun codice frontend modificato o
distribuito. Per correggere gli scatti occorre intervenire sulla sola
presentazione del clock, conservando l'autorità media per dati e valutazione;
per il percorso musicale occorre gestire esplicitamente l'ingresso telefono
quando l'uscita scelta è Bluetooth.
