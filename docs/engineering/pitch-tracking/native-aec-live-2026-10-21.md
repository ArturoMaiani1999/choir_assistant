# AEC del dispositivo e risoluzione armonica live

**Status:** deployed to Epistrophe staging; native guide verified on S25+  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Catena

Con Uso gli altoparlanti, getUserMedia richiede `echoCancellation:{exact:true}`,
`noiseSuppression:{exact:false}` e `autoGainControl:{exact:false}`. L'attach
controlla i settings effettivi; valori mancanti, diversi o AEC all non sono
accettati. Il browser non compatibile invita a usare le cuffie. La catena
custom rimane disponibile solo con feature runtime `platformAEC:false`,
usata nei confronti tecnici; non c'è un selettore di algoritmo nella UI.

Nessun convolver, filtro H o gain follower custom dopo l'AEC di piattaforma.
Il MediaStream nativo entra direttamente nel contesto del detector, senza
il precedente MediaStreamDestination della sottrazione. Il bus del mixer
rimane disponibile per la misura, per i click e per la diagnostica.

La diagnostica conserva lo schema a quattro canali per compatibilità; con
`echo.strategy:platform`, `echo.inputStage:post-platform-aec` specifica che
anche il canale storico chiamato microphone-raw è già dopo l'AEC. Raw e
processed coincidono, prediction è nullo e il quarto canale è silenzio.
Non interpretarli come coppia pre/post AEC o come ERLE. Le nuove osservazioni
pitch conservano anche `originalHz` e `harmonicResolved` per la diagnosi.

## Verifica unica e riuso

Otto secondi: preparazione 0–2, rumore 2–4, coda, secondo rumore indipendente
5–7, coda finale. Il Worklet acquisisce riferimento e microfono sullo stesso
clock. Verifica lunghezza, valori finiti, riferimento presente e settings
ancora compatibili; residuo RMS aggregato 2–7,8 s ≤0,004 e picco <0,98.
Non stima dB o risposta H. È un controllo assoluto del residuo nelle
condizioni correnti, non un certificato di cancellazione su ogni brano.
Caricamento modulo limitato a 12 s, cattura interrotta oltre 9 s.

Seguono le vocali normale/piano e le pause indipendenti esistenti, 22 s,
con countdown e grafico RMS: circa 30 s totali più elaborazione esplicita.
Si applica il profilo solo dopo i controlli vocali. I profili precedenti
non superano il nuovo detectorVersion `yin-live-harmonics-3`.

Il risultato dichiara AEC del dispositivo attivo, senza inventare dB/ritardo.
L'apertura di Base e Home→brano conservano stream e verifica della stessa
catena; non si richiede di nuovo la voce. Nuova acquisizione, account, stato
del contesto, impostazioni non compatibili e scadenza richiedono verifica.
Il journal RAM è limitato a 256 eventi e viene svuotato al cambio account.

## Selezione causale del periodo

`detectPitch(...,{resolveHarmonics:true})` conserva il primo minimo YIN e il
suo RMS/clarity/confidence. Cerca un minimo locale vicino a due o tre volte
il periodo iniziale, tolleranza 3% (minimo due campioni). Lo usa soltanto se
CMND è ≤25% del primo minimo e migliora di almeno 0,04 in valore assoluto.
Sceglie il primo multiplo con questa evidenza, non il minimo globale che
potrebbe favorire subarmoniche. Il detector predefinito senza opzione resta
invariato; Worker live, fallback e estrazione della calibrazione la attivano.

La selezione del periodo non legge spartito, target, nota precedente o futuro e non
aggiunge una coda temporale. Veri salti d'ottava e glissandi vengono misurati
dal primo frame nuovo. Confidence e voicing restano quelli originari: una
correzione del pitch non può da sola alzare o abbassare il gate. Il tracker
e il filtro di visualizzazione esistenti seguono questa misura. Il controllo
con le impostazioni effettive del telefono ha rilevato tre finestre prima
ammesse, ora respinte dal tracker a causa della diversa frequenza.
`HarmonicPitchSmoother` separa quindi due percorsi: il tracker sulla frequenza
originale determina accepted/stable/confidence; quello sulla frequenza scelta
determina il pitch. Quando il primo ammette e il secondo è in transizione,
usa la frequenza acustica corrente. Nei hold di voce piano mantiene l'ultimo
pitch disponibile, solo nelle finestre ammesse dalla politica originale.
Anche la calibrazione usa questa separazione.
Non è pYIN né il decoder Viterbi offline dell'esperimento precedente.

## Evidenza e limiti

149 test: 89 API e 60 DSP/lifecycle, con settings effettivi, no doppia
sottrazione, dati incompleti/nonfiniti, residuo forte, account, TTL e
cancellazione. Controlli sintetici per armoniche, ampiezze piano, veri
semitoni/ottave, vibrato e attacchi in convergenza. Syntax/typecheck passati.

Replay delle due acquisizioni reali, griglia 2048/hop 1024 e gate fissi
0,002 RMS / 0,18 YIN, script `verify_live_pitch_capture.cjs`:

- 8/15: 296 finestre ammesse prima e dopo; un errore armonico centrale risolto.
- 11/15: 287 prima e dopo; tutte le 16 scelte d'ottava centrali risolte.
- Zero cambi di maschera, RMS, clarity e confidence. La misura live non usa
  il confine della guida. I conteggi centrali sono solo statistiche di verifica.

Non esiste una voce pulita simultanea: non dichiarare accuratezza universale,
né equivalenza di timbro dell'AEC. I casi con fondamentale quasi assente
possono rimanere ambigui. I limiti osservati sul ponte fra contesti rimangono
documentati nello [studio del clock](audio-sample-clock-2026-10-21.md).

Browser: guida completa e riuso, cinque riaperture di Base, suspend/resume,
devicechange, background, permesso tardivo, Escape/backdrop/focus. Home→brano
conserva voce e AEC e avvia la prova senza nuova guida. La regressione custom
passa gain x2/x0,5, retiming +1/+6 ms/ritorno, clipping e voce all'unisono.
Screenshot desktop 1366×768/mobile 390×844 ispezionati, senza clipping o nuovi
controlli. Evidenze in `artifacts/native-aec-live`.

Il pacchetto distribuito deriva dalla release congelata del clock. Copia
solo i moduli audio nominati e applica cinque modifiche esplicite all'app
congelata: non include i lavori concorrenti su marchio/Home e non distribuisce
Xynon. Il bundle server conserva lo SHA-256 precedente. Versione e rollback
nel [registro del rilascio](../../operations/releases/2026-10-21-native-aec-live.md).

## Riscontro sulla guida effettiva del S25+

La prima prova (`device-guide-1`, build 090851) si ferma al controllo del
residuo. Il debug USB cade e impedisce l'export; la riconnessione recupera
il rifiuto, con microfono spento, e permette di ripristinare 5/15. Il motivo
specifico del residuo alto non è isolato: non attribuirlo automaticamente
alla disconnessione. Nessuna soglia allentata.

La prova acustica strumentata `device-acoustic-residual-1` passa sulla stessa
implementazione: 384.000 campioni / 8 s, AEC true, NS/AGC false, residuo RMS
zero nella regione di verifica. Un riancoraggio prima della misura resta
in telemetria; nessun gap attraversato nel tratto utile. Microfono e guida
chiusi dopo il test, volume 5/15 ripristinato.

La guida completa `device-guide-2` raggiunge Audio pronto: voce 100%, pause
90%, balanced accuracy 95% sulle etichette guidate. Non sono stime di
accuratezza F0. AEC true, NS/AGC/voiceIsolation false, 48 kHz mono, latency
esposta 40 ms; residuo RMS 0,00007589 nella verifica. Microfono attivo come
dichiarato nella UI, brano fermo, volume ripristinato da 11/15 a 5/15.
Nessun PCM vocale esportato: soltanto il segmento acustico dei fruscii è
acquisito localmente per la diagnosi.

Il profilo conserva RMS 0,000002, YIN 0,42, clarity 0,45 e confidence 0,30.
Con queste impostazioni, replay dei due audio precedenti: 300/300 e 291/291
frame raw ammessi, confidence invariata, maschera del tracker identica alla
precedente (264 e 214 finestre rispettivamente). Il selettore riduce le F0
centrali oltre 400 Hz da 20 a 15 nel primo audio e da 39 a 1 nel secondo.
400 Hz è una statistica descrittiva di queste due note, mai una soglia
dell'algoritmo. Il risultato diverso da YIN 0,18 dimostra perché non estendere
una verifica ad altre impostazioni senza misurarle: rimangono ambiguità.

La separazione finale della maschera è verificata nei replay, nei test e nel
browser; la guida fisica sopra precede questo aggiustamento e non viene
presentata come sua nuova esecuzione. Il profilo di ingresso resta valido.
