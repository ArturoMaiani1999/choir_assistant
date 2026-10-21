# Primo confronto AEC sul S25+, 21 ottobre

**Status:** partial acoustic comparison; normal voice and Santo double-talk captured; soft voice/metronome check pending  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Condizioni e integrità

Staging build `20261020-181027-6811032c1db7-dirty`, Chrome UA 155, Android
S25+ dell'utente, controllato dalla scheda visibile autorizzata via ADB/CDP.
Il campo Android della UA è ridotto e non identifica la versione OS reale.
Nessun nuovo deploy o aggiornamento di profilo per questo esperimento.

Il probe apre una sola acquisizione alla volta. Riferimento e segnali passano
dal bus reale del mixer, con i click della funzione dell'app. NS e AGC sono
richiesti disabilitati e risultano disabilitati nei settings. Raw e AEC
normale hanno entrambi input mono a 48 kHz, latenza esposta 40 ms.
La cattura sincronizzata usa il Worklet diagnostico della build distribuita.

Ordine pianificato: raw → browser AEC → AEC all → raw. Ogni condizione dura
13 s: 2 s iniziali, due fruscii indipendenti a livello digitale 0,5 e 1,
poi due gruppi di click al 15% e 30%. Volume hardware temporaneo 8/15,
iniziale 0/15 e ripristino confermato a 0/15. Ampiezza del fruscio maggiore
0,0496, determinata dal volume master dell'app corrente. Non usare i dB
precedenti del trattamento proprietario come confronto controllato con
questa acquisizione.

Il primo avvio si ferma prima dei suoni perché il bus di riferimento non
era inizializzato dopo il reload. Il probe viene corretto chiamando il
normale metodo del mixer per inizializzarlo. Il tentativo fallito conserva
metadati e ripristino del volume nella cartella `device-20261021-1`.

Artefatti del confronto: `artifacts/aec-platform-comparison/device-20261021-2`.

## Risultato disponibile

- Raw: 624.000 campioni, 13 s completi, picco 0,846, nessun campione ≥0,98.
- AEC normale: prefisso contiguo di 405.504 campioni, 8,448 s. Discontinuità
  del contatore durante il metronomo: expected 1.920.128, actual 1.920.000,
  salto all'indietro di 128 campioni. Il prefisso è conservato senza ricucire
  o ripetere campioni. La sequenza si ferma, quindi AEC all e secondo raw
  non sono ancora misurati in questo tentativo.
- Primo fruscio, inclusa la coda: energia normalizzata per il riferimento
  inferiore di 42,58 dB con AEC rispetto al raw precedente. È attenuazione
  relativa tra acquisizioni successive, non ERLE simultaneo.
- Secondo fruscio: campioni del microfono tutti esattamente zero mentre il
  riferimento riprodotto resta non nullo. Nessun valore finito di dB viene
  assegnato. Prima della verifica vocale non si può escludere una chiusura
  indesiderata dell'ingresso.
- Il metronomo non ha un intervallo completo utilizzabile per il confronto.

La misura è promettente per l'AEC di piattaforma, ma non dimostra ancora
conservazione della voce, accuratezza F0, efficacia durante canto e base o
robustezza dei clock. Il secondo raw pianificato non è stato acquisito:
manca anche il controllo della variabilità tra baseline.

## Strumenti e collaudi

`probe_android_platform_aec.py` prepara e acquisisce; per default legge
soltanto stato/capabilities. `--voice-check` riusa la guida della calibrazione
per vocali senza suoni in uscita. Non verifica né salva un profilo. Il probe
riporta mute/unmute/ended della traccia nelle acquisizioni successive.
`--continue-after-gap` permette di conservare il prefisso dichiarato
incompleto e procedere a una nuova condizione indipendente; non attraversa
una discontinuità nella stessa registrazione.

`analyze_platform_aec.py` confronta solo regioni temporali complete,
normalizza per l'energia del riferimento e segnala il silenzio digitale.
`analyze_platform_voice.py` usa impostazioni fisse del detector su finestre
guidate, con esclusione dei bordi. Le esecuzioni vocali successive non sono
copie dello stesso segnale: ammissione non equivale ad accuratezza F0.

`browser_platform_aec_smoke.py`: cattura reale del browser con microfono
sintetico, raw e AEC, 624.000 campioni ciascuno, riferimento verificato,
NS/AGC disabilitati, tracce terminate e nessun profilo verificato. Variante
voce con riferimento nullo, countdown e screenshot desktop 1366×768/mobile
390×844 ispezionati. Non è una verifica acustica dell'AEC. Il test offline
dell'analisi vocale ammette 233/233 finestre di una sinusoide 220 Hz e 0/233
finestre di silenzio digitale.

Il passo inizialmente previsto era la voce sola con raw, AEC normale e AEC
all, seguito dal test con voce e base simultanee. Le acquisizioni successive
qui sotto coprono AEC normale; AEC all rimane non misurato.

## Voce sola e Santo con AEC normale

Il primo tentativo vocale (`device-voice-20261021-1`) viene annullato
dall'utente, che non aveva compreso la guida. Non usarlo come baseline vocale
né interpretare le finestre senza pitch come falsi negativi del detector.
La guida successiva usa una sola condizione per volta, con preparazione
in silenzio di 7 s, canto 6 s e silenzio finale 4 s.

`device-voice-20261021-2`: AEC normale, voce sola, 816.000 campioni a 48 kHz,
17 s completi senza gap né eventi mute/unmute. RMS nel tratto vocale 0,131.
L'analisi aggiornata usa una griglia comune di finestre da 2048 campioni,
hop 1024, esclude 500 ms dai bordi della fase vocale e ammette 226/232
finestre guidate; nessun pitch ammesso nelle 419 finestre indicate come
silenzio. Mediana F0 154,5 Hz. Il primo resoconto usava una griglia ancorata
all'inizio della fase, 226/233: la differenza è un bordo di finestra, non
un nuovo trattamento del segnale. Non è una misura di accuratezza F0.

`device-music-voice-20261021-1`: AEC normale, estratto Santo 18–35 s,
17 s completi senza gap o eventi mute. Mix ricostruito in PCM mono dai
cinque asset MP3 attualmente caricati (organo e quattro voci), con i guadagni
effettivi del mixer. Hash degli asset, offset e livelli nel report. Nessuna
trasposizione. Il PCM viene riprodotto sul bus reale del mixer; non è una
verifica delle transizioni e delle latenze dei decoder MediaElement.
Picco digitale del mix 0,0563, RMS 0,01047. Metronomo assente in questa prova.

Nel tratto vocale: RMS 0,109, pitch ammesso in 223/232 finestre, nessun pitch
ammesso nelle 419 finestre indicate come silenzio. Mediana F0 175,6 Hz, con
variazioni durante il canto. L'utente conferma di aver cantato **tre note a
caso**: non attribuire la variazione di F0 all'AEC e non confrontare le
mediane delle due esecuzioni come se avesse cantato la stessa nota.

I risultati supportano l'uso dell'AEC di piattaforma come candidato da
valutare prioritariamente. Non dimostrano ancora accuratezza del pitch,
preservazione del timbro, non inferiorità sulla voce piano o sul brano intero.
Volume ripristinato a 0/15 dopo entrambe le prove. Nessun profilo modificato
e nessun cambiamento della cancellazione predefinita dell'app.

## Discontinuità: riscontro sul PC e offset metronomo escluso dal test

Il controllo successivo con musica e click viene interrotto anche sul Chrome
desktop con ingresso sintetico: salto all'indietro di 128 campioni. Non
attribuire il fenomeno specificamente al Samsung. Il controllo della voce
piano con metronomo sul telefono non viene avviato prima di chiarire questa
limitazione del registratore.

Il server locale `artifacts/aec-platform-comparison/trace-preview.py` serve
una copia strumentata del solo modulo di cattura: conserva gli ultimi otto
quanta, senza modificare sorgenti frontend o asset distribuiti. SHA-256 della
copia `traced-worklet.js`:
`f774d28af0a048f6f68a30843a0070926ca0d56b0936c87395eda1af112144b4`.

La traccia in `quantum-trace/smoke.json`, riepilogata in
`quantum-trace/summary.json`, registra due callback consecutive con frame
846.848, tempo 17,6426667 s e blocchi di 128 campioni. I dati del riferimento
nei due blocchi **sono diversi** (RMS della differenza 0,01832). Il registratore
si aspettava 846.976 e si ferma. Questo esclude che si tratti semplicemente
dello stesso pacchetto del MessagePort letto due volte; non dimostra ancora
continuità fisica o discontinuità udibile del suono.

L'offset di sincronizzazione del metronomo non entra nel probe:
`renderMetronome()` applica `metronomeOffsetMs` alla posizione musicale,
mentre il probe chiama direttamente `playMetronomeClick()`. Questa funzione
programma il click su `context.currentTime`, senza riscrivere `currentFrame`.
Un click programmato più tardi non spiega da solo un contatore ripetuto.
Non correggere l'offset visivo per nascondere l'errore di cattura.

Il precedente smoke con sola musica è passato; la variante musica/click
fallisce su continuità e resta dichiarata fallita. Gli audio reali completi
di voce sola e voce con Santo rimangono utilizzabili per le proprie regioni.

## Isolamento: timestamp obsoleto con PCM continuo sul PC

Il probe riproducibile `scripts/browser_audio_quantum_probe.py` esegue Chrome
headless con uscita muta e microfono sintetico. Il riferimento assegna a ogni
campione un valore float32 univoco: `(indice + 1) / 2^24`. Un Worklet
indipendente confronta la progressione dei campioni con `currentFrame`.
Questo permette di distinguere una discontinuità del contatore da campioni
duplicati o persi nel riferimento digitale.

Browser effettivo: Chrome 155.0.8059.80, revisione
`43a195105613ac83c21d3f14de279f4a045c7da0`. Nessun telefono usato.

- `artifacts/audio-quantum-isolation/minimal-1`: cinque condizioni da 10 s
  (collegamento diretto, gain nullo, click, microfono/click, due contesti).
  Nessuna anomalia durante il riferimento attivo. Un salto di inizializzazione
  prima del riferimento è mantenuto nel report ma non contato come perdita PCM.
- `recorder-1`: tre condizioni da 12 s con registratore originale, senza
  anomalie. Questi risultati brevi non escludono l'intermittenza.
- `churn-1`: creazione/connessione/disconnessione ripetuta di GainNode, prova
  deliberata di contesa del grafo. Il registratore originale si ferma, mentre
  l'osservatore continua: tutti i 4.518 passaggi fra blocchi del riferimento
  attivo avanzano di 128 campioni. Il contatore presenta invece 535 ripetizioni
  e successivi recuperi, anche maggiori di 256 campioni.
- `churn-2`: controllo → contesa → controllo → contesa, 20 s ciascuno.
  Anche il secondo controllo con normali click riproduce il problema:
  `currentFrame` 810.752 ripetuto, poi 811.008, mentre gli indici PCM avanzano
  sempre di 128. Le prime tracce integrali di questa serie sono state
  sovrascritte dalla seconda ripetizione; `summary.json` conserva tutti e
  quattro i riepiloghi. Le serie successive usano nomi numerati distinti.
- `counted-1`: il controllo originale con click si ferma a 598.016 campioni;
  l'osservatore dimostra ancora il riferimento continuo durante l'errore.
  Una variante sperimentale locale del registratore conta i campioni dei
  callback, mantenendo separati i timestamp osservati. Con contesa completa
  960.000 campioni (20 s), con **zero errori nella sequenza di ogni singolo
  campione** e 169 differenze tra contatore locale e timestamp del browser.
  La stessa variante con click completa altri 960.000 campioni senza errori.

Il confronto nell'intera app congelata usa
`artifacts/audio-quantum-isolation/counted-preview.py`, server soltanto locale
con sostituzione del modulo diagnostico. Lo smoke con musica Santo e
metronomo completa due serie raw/AEC, 816.000 campioni per condizione.
Nella seconda serie (`full-app-counted-telemetry/smoke.json`) registra una
discordanza del clock in raw e due in AEC; tutte e tre di 128 campioni.
Le quattro catture completano, rilasciano il microfono e non verificano
profili. È una verifica di acquisizione con microfono sintetico e uscita
muta; non misura attenuazione acustica, pitch della voce o continuità ADC.

Il sorgente Chromium della revisione effettivamente eseguita contiene
`GraphAutoTryLocker` in `UpdateWorkletGlobalScopeOnRenderingThread()`:
l'aggiornamento del frame globale avviene soltanto se il lock è acquisito.
È una spiegazione coerente con ripetizione e recupero osservati, provocati
dalle modifiche del grafo; non abbiamo strumentato il binario C++ per
osservare direttamente il fallimento del lock.
[Sorgente Chromium alla revisione verificata](https://github.com/chromium/chromium/blob/43a195105613ac83c21d3f14de279f4a045c7da0/third_party/blink/renderer/modules/webaudio/base_audio_context.cc#L893).

Impatto sul codice attuale: `echo_diagnostic_worklet.js` interrompe la cattura
su questa differenza. Anche `echo_monitor_worklet.js` scarta lo storico di
8192 campioni e invia `gap`; `echo_cancellation_ui.js` azzera il delay follower.
Un falso gap può quindi interrompere la diagnosi e disturbare il monitoraggio
del ritardo. Non è ancora dimostrato che spieghi gli errori vocali del S25+.

La variante a conteggio resta **solo sperimentale locale**, applicata alla
risposta HTTP del modulo: nessun sorgente frontend o asset distribuito
modificato, nessun deploy. Il conteggio dei callback non misura perdite a
monte nell'ADC, nel sistema operativo o nell'AEC nativo. Non usare questa
prova per dichiarare risolti i salti acustici precedenti di circa 40 ms,
né per ricostruire silenziosamente campioni mancanti.

Direzione: separare il tempo dei campioni dal timestamp segnalato, conservare
telemetria delle differenze e gestire esplicitamente sospensione/cambio
contesto. Verificare poi il monitor e il registratore nell'intera app, prima
del confronto acustico su telefono con voce piano, base e metronomo. L'AEC
nativo rimane il candidato per la cancellazione; questa scoperta riguarda
prima di tutto l'affidabilità della misura e del monitor del sistema custom.

## Consolidamento successivo su staging

Il 21 ottobre la variante viene consolidata nei tre Worklet con telemetria,
rifiuto dei salti in avanti e invalidazione esplicita su suspend/resume.
Il [resoconto dell'implementazione](audio-sample-clock-2026-10-21.md) descrive
test e limiti; il [rilascio staging](../../operations/releases/2026-10-21-audio-sample-clock.md)
identifica pacchetto e rollback. La dicitura «solo locale» nella sezione
precedente descrive la fase sperimentale, prima di questo consolidamento.

Il [confronto successivo sul dispositivo](s25-native-aec-followup-2026-10-21.md)
completa raw/AEC/all/raw e due vocali piano con Santo e metronomo, a 8/15 e
11/15. Distingue la soppressione del rientro dall'ambiguità armonica del
detector; documenta conferma dell'utente sui tempi della prima vocale e
decodifica offline con maschera di ammissione invariata.
