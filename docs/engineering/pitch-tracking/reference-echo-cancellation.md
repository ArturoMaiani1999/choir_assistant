# Riduzione del rientro con riferimento all'uscita

**Aggiornamento 19 ottobre 2026:** la
[calibrazione unica](unified-audio-calibration.md) sostituisce i dialoghi
separati descritti sotto. Misura compatta di 10 s sul grafo definitivo già
aperto, guida vocale di 22 s e applicazione automatica. Il microfono rimane
aperto fino al Play. La vecchia sequenza di 14 s resta una baseline nei test.

**Aggiornamento 20 ottobre:** il [tracking causale del ritardo](echo-delay-tracking-2026-10-20.md)
riallinea automaticamente la sola previsione del rientro. Replay su PCM reale
e test controllati superati; nuova conferma acustica sul dispositivo ancora
necessaria. Non cambia il veto clipping e non aggiunge passi alla guida.

**Stato:** disponibile su staging in modalità sperimentale, 2026-10-18. Validazione sintetica;
resta da collaudare il percorso acustico dei dispositivi reali.

La [diagnosi delle anomalie segnalate su Santo](echo-failure-diagnosis-2026-10-18.md)
documenta limiti riprodotti dopo la prima prova: variazioni di guadagno/ritardo,
risposta non lineare ai livelli forti e salti brevi accettati dal tracker.
Le misure sono sintetiche; la prova reale non risulta nei dati remoti trovati.

**Aggiornamento 19 ottobre:** è ora disponibile il [test reale del telefono](santo-real-device-2026-10-19.md).
Mostra un disallineamento stabile di 24,92 ms fra previsione e rientro, anche
a volume invariato, e un aumento del rientro con la sottrazione attuale.
Il risultato richiede una riverifica della catena corrente prima del canto;
non autorizza un offset fisso per tutti i dispositivi. Le misure sintetiche
sotto restano valide nei propri limiti, ma non dimostrano la catena del Samsung.

## Obiettivo e confine

Ridurre il solo audio emesso dall'app prima del detector live. Non usare
notch, maschere basate sulle note attese, correzione verso lo spartito o
adattamento che possa apprendere la voce mentre l'utente canta.

La risposta H è identificata esplicitamente in silenzio e poi congelata.
Controlli conservativi possono adeguare guadagno e ritardo della previsione,
come descritto sotto e nello studio del 20 ottobre. Non è un AEC adattativo universale. Il filtro può
lasciare residui se cambiano posizione, volume del sistema, latenza, risposta
delle casse o ambiente. Clipping e elaborazioni non lineari riducono
l'affidabilità. Non viene promessa cancellazione perfetta o precisione F0.

## Percorso audio

`MediaElementMixer` espone un bus dopo pitch shifter, guadagni dei canali e
mute; il bus è quello realmente connesso alla destinazione. Nella modalità
altoparlanti l'uscita è mono: la misura identifica un unico percorso, anche
quando il dispositivo ha due casse. La modalità cuffie ripristina la normale
negoziazione stereo. Il metronomo della prova confluisce nello stesso bus.
Un media element che usa il fallback fuori dal mixer blocca la modalità
altoparlanti: non sarebbe presente nel riferimento.

Nel contesto del mixer: `microfono grezzo → somma → MediaStreamDestination`.
Secondo ramo: `bus uscita → Convolver(normalize=false, H) → retimer → guadagno -g → somma`.
La somma viene letta dall'AnalyserNode del detector in un contesto dedicato.
Il microfono non viene collegato agli altoparlanti. La chiusura del microfono
scollega i rami, ferma le tracce temporanee e mantiene vivo il mixer.

Il risultato è `y_pulito = y_microfono - g * retime(H * x_app)`. La componente di voce
entra con coefficiente uno; H non viene aggiornato durante il canto. Frequenze
condivise con la base non sono un criterio per rimuovere la voce. Con errore di
modello rimane però `voce + errore`: un residuo può sommarsi o interferire con
la voce. Per questo la preservazione in test non è una garanzia per ogni stanza.

Il browser riceve `echoCancellation:false`, `noiseSuppression:false` e,
solo in questa modalità, `autoGainControl:false`. Se i settings effettivi
dichiarano una di queste elaborazioni attiva, il controllo viene rifiutato.
Non si richiede cancellazione dell'audio di altre app o del sistema operativo.
Eventuale DSP non esposto dall'hardware resta un limite.

## Misura guidata e selezione

Guida di 14 secondi: preparazione in silenzio 4 s, fruscio noto 6 s, coda
1 s, fruscio indipendente 2 s e coda 1 s. Countdown per fase, livello RMS
dal vivo, interruzione esplicita e conferma finale di essere rimasti in silenzio.
I fruscii sono rumore pseudo-casuale diverso, con fade di 512 campioni e
ampiezza massima `0.08 * volume_app`. Non si aumenta il volume del sistema.

Un AudioWorklet raccoglie microfono grezzo e bus sullo stesso clock e frame
iniziale, senza passare da timer JS o MediaRecorder. Un Worker stima una
risposta impulsiva causale lunga fino a 750 ms con deconvoluzione FFT
regolarizzata: `H = Y * conj(X) / (|X|² + lambda)`, lambda uguale a 0,002
dell'energia del riferimento. Si usano solo i secondi 4–11; 11–14 sono hold-out.
La coda di un secondo separa i due esperimenti.

Si rifiutano acquisizioni incomplete/non finite, sample rate non supportato,
clipping sopra 0,98 e riferimento/rientro troppo deboli. Il modello è proposto
soltanto con riduzione RMS ≥15 dB sul train e ≥12 dB sul secondo esperimento.
Il hold-out può rifiutare il filtro, non scegliere un altro iperparametro.
Queste soglie iniziali descrivono il controllo del rientro, non accuratezza
del pitch o qualità musicale percepita.

Un residuo molto basso può ancora essere periodico. Per il solo riconoscimento
pitch, la soglia energetica minima durante l'uscita è quindi
`2 * g * RMS(echo_previsto) * 10^(-riduzione_holdout_dB/20)`, con massimo 0,01 e
hold di 300 ms per il trasferimento fra contesti e la coda. Si conserva il
floor di confidence preesistente quando la soglia RMS supera 0,001.
Questa regola non altera il PCM della voce. Segnali sotto l'incertezza del
modello possono non essere ammessi dal detector, compresa una voce molto debole.

## Adeguamento automatico del livello

L'API volume del media element descrive il volume dell'app, non fornisce alla
pagina il livello dei tasti del telefono. I cambi dell'app sono già a monte
del riferimento. Un cambio del volume di sistema richiede invece una stima
del guadagno acustico effettivo; non si moltiplica H per la posizione di uno
slider HTML né si intercettano presunti eventi dei tasti volume.

Un secondo AudioWorklet raccoglie finestre non sovrapposte di 8192 campioni
di microfono grezzo e previsione **non scalata**, nel contesto del mixer. Non
si confrontano Analyser di contesti diversi. Un solo buffer per canale può
essere in transito: il Worker restituisce gli array al Worklet, senza storico,
salvataggi o rete. Il costo FFT resta nel Worker. Il monitor tace in uscita.
Gli ingressi a zero canali durante il silenzio sono trattati come zeri: la
finestra continua ad avanzare e il controllo può recuperare dopo saturazione
anche nelle pause della base. Gli avvisi di saturazione sono limitati a uno
ogni dieci secondi; lo stato visibile resta aggiornato.

`gainObservation()` divide ogni finestra in due metà con finestra Hann: la
prima propone g, la seconda lo verifica. Sono necessarie almeno cinque delle
sei bande di un'ottava fra 150 e 9600 Hz, con potenza sufficiente e accordo
entro il 2,5%. Si rifiutano riferimento concentrato in pochi bin, periodicità
marcata (anche una vocale ricca di armoniche), variazioni di fase, clipping,
residuo incompatibile e guadagni fuori 0,125–8. Il residuo ammesso è limitato
al 2,5% dell'eco stimato o al rumore misurato nei secondi 2–3,5 della
preparazione silenziosa, comunque mai oltre il 5% dell'eco. Un rumore di
preparazione contaminato non può esentare il cantante dal controllo del residuo.
Le due stime devono concordare entro il 2%; tre finestre consecutive valide
e coerenti confermano l'adeguamento, smussato con costante di 15 ms. Il pitch
attende anche 300 ms di assestamento del grafo e del trasferimento fra contesti.

Un'interruzione, una finestra ambigua, un cambio del candidato o una stima
vecchia annullano la candidatura. Non si applicano osservazioni più vecchie
di 350 ms. Un monitor fermo per oltre 1,5 s blocca il riconoscimento finché
non riprende o si ripete il controllo. Durante la candidatura, saturazione
o guasto il gate del pitch viene chiuso; non si pubblicano note da quei frame.
L'adeguamento invalida l'eventuale calibrazione vocale sul PCM precedente.
La risposta H, il ritardo e lo spettro del filtro non sono appresi dal canto.

La modalità si attiva con lo stesso opt-in sperimentale. Il piano roll mostra
un solo controllo secondario: “Rientro · automatico”, “adeguamento”, “in attesa”,
“volume alto” o “da verificare”. Tocco/click apre il controllo guidato dopo
aver messo in pausa. Il pulsante ha target 44 px, focus e testo accessibili;
non aggiunge animazioni. Dettagli e limiti rimangono nel disclosure esistente.

**Limite essenziale:** un aumento di una base tonale e una voce correlata alla
stessa frequenza non sono distinguibili in modo universale da un microfono.
Il follower rimane fermo nei casi ambigui: non promette di seguire ogni cambio
di volume durante il canto. Voci molto deboli/correlate restano un limite
dell'identificazione, non una garanzia di separazione perfetta. Distorsioni,
spostamenti e nuovi ritardi richiedono ancora la verifica in silenzio. Non si
usa un AEC nativo di sistema: il riferimento resta il solo bus dell'app.

I test verificano aumenti/diminuzioni, interruzioni, voce alla stessa F0,
voce armonica, double talk su uscita larga, ritardi e limiter. Lo smoke browser
cambia il guadagno acustico **a valle** del riferimento; non simula il volume
del telefono cambiando quello della base. Il collaudo sul Samsung S25+ resta
necessario. Non è una misura della balanced accuracy su un corpus reale.

## Stato e ciclo di vita

Opt-in in **Impostazioni → Base → Ascolto dagli altoparlanti → Riduci il
rientro della base**, poi **Calibra altoparlanti**. Il Play chiede il controllo
se la modalità è attiva senza un modello applicato. La scelta Bluetooth/non
Bluetooth resta distinta e riguarda la sincronizzazione visiva.

Filtro e campioni rimangono in RAM. Nessuna API, audio o profilo acustico viene
salvato su browser/R2/server. Il modello appartiene all'account e alla catena
d'ingresso corrente, scade dopo 10 minuti fuori da una prova in corso ed è
invalidato al cambio dispositivo/modo. Input diverso al riavvio del microfono
richiede una nuova misura. Un nuovo filtro invalida la calibrazione delle
soglie della voce: questa può essere eseguita successivamente sul PCM trattato.

Un ritardo può cambiare anche senza modificare i settings esposti: il follower
di livello non lo corregge. Ripetere il controllo dopo cambi di posizione o
percorso audio, o se dopo un cambio di volume resta rientro e il controllo
automatico rimane in attesa. Il riavvio della scheda richiede sempre
una misura nuova. La verifica remota sul dispositivo reale è ancora necessaria.

Chiusura, Escape, backdrop, interruzione, pagina nascosta, cambio dispositivo
e permesso tardivo rilasciano il microfono e annullano toni/capture/Worker.
L'app non riproduce il microfono in stanza. La registrazione personale grezza e
quella automatica restano riservate al percorso cuffie; non si salva il rientro
grezzo dichiarandolo una registrazione ripulita.

## Verifiche

`node --test scripts/echo_cancellation.test.cjs` verifica identificazione con
ritardo e riflessioni, hold-out indipendente, rifiuti, mantenimento di una voce
a 220 Hz con base a 220 Hz e fasi diverse, e assenza di sottrazione senza uscita.
Le prove sono incluse in `npm run check`. I test del mixer verificano posizione
del riferimento, ripristino stereo e rifiuto di tracce fuori dal bus; quelli di
packaging verificano gli import fingerprintati di Worker e AudioWorklet.

`python scripts/browser_echo_cancellation_smoke.py` esercita il vero grafo Web
Audio con un percorso sintetico di 35 ms e riflessioni, voce indipendente e la
vera durata della calibrazione. Nei test il controllo misura circa 36 dB di
riduzione sul hold-out; una voce di ampiezza 0,03 rimane a circa 0,021 RMS e
220 Hz. La base da sola lascia circa 0,00016 RMS: il gate di incertezza evita
di accettare la sua nota residua. Questi valori descrivono la fixture, non una
prestazione misurata sulle casse di Arturo.

Screenshot a 1366×768 e 390×844 in `artifacts/echo-cancellation/` per ingresso,
acquisizione ed esito. Dettagli espansi possono scorrere; percorso principale,
countdown, livello e azione devono stare nel viewport. Reduced motion conserva
il meter funzionale senza transizioni decorative.

## Riferimenti tecnici

- [Web Audio: ConvolverNode e normalize](https://www.w3.org/TR/webaudio-1.0/#ConvolverNode).
- [Analog Devices: riferimento di uscita e controllo del double talk](https://wiki.analog.com/resources/tools-software/sigmastudio/toolbox/adialgorithms/aec).
- [SpeexDSP: ritardo e limiti delle distorsioni non lineari](https://www.speex.org/docs/manual/speex-manual/node7.html).
- [AEC3: allineamento e deriva temporale](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/aec3/block_processor.cc).

Questi riferimenti motivano l'architettura; questa implementazione non include
SpeexDSP/AEC3 né ne dichiara le prestazioni.

## Release e collaudo del 2026-10-18

- URL: `https://staging.epistrophe.it/?piece=o-sacrum&part=P3`.
- Build: `20261018-200722-46c4b97f1322-dirty`, stessa dist verificata e distribuita.
- Manifest SHA-256:
  `dce198351ea7a3cab3c750907b219b8b3bc14125a07fcd9502fff252accc90b8`.
- Worker: `0a26b193-0726-4bed-bf0d-4e7db388c126`.
- Rollback: `b5e5c3a1-ac3a-45b7-bda2-06fa7d98421a`.

Passano typecheck, 72 test applicativi, 14 test DSP/calibrazioni, mixer,
12 test packaging, 30 test backend, 14 test configurazione/sync/artifact,
regressioni di clock e detector, audit documentazione/artifact e npm audit
con 0 vulnerabilità. Prima del deploy sono stati confrontati tutti gli hash
del manifest e i core asset rigenerati dai sorgenti in una directory temporanea.

Sulla build passano gli smoke di cancellazione del rientro e calibrazione
vocale su O sacrum convivium e lo smoke completo della release su Ave verum;
passano inoltre privacy/mixer e registrazione personale nel server locale.
Gli smoke audio vanno avviati in sequenza: un avvio sovrapposto ha superato
il timeout di caricamento della Partitura; la ripetizione completa isolata è
passata. Il test non è stato indebolito o ignorato.

Sono stati ispezionati screenshot desktop 1366×768 e mobile 390×844 di ingresso,
acquisizione con meter e risultato in `artifacts/echo-cancellation/`. Nessuno
scroll necessario o clipping nel flusso principale; i dettagli espansi possono
scorrere. La modalità rimane opt-in e segnala esplicitamente lo stato sperimentale.

La misura sintetica finale sul percorso di 35 ms produce 35,9 dB di riduzione
di verifica. Voce e base a 220 Hz: voce in uscita circa 0,0211 RMS, frequenza
220,002 Hz. La sola base lascia circa 0,00015 RMS, rifiutata dal gate del detector.
Il test verifica anche assenza di soppressione senza uscita, rilascio del mixer,
interruzione, sfondo, Escape, backdrop, focus, cambio dispositivo, permesso
tardivo, nessun salvataggio dei dati acustici e ripristino stereo.

I test della build usano servizi di autenticazione simulati solo sul server
di preview in loopback; nessun login remoto o rilevamento della voce di Arturo.
Dopo il deploy la pagina anonima reindirizza al login, login e auth/config
rispondono 200 e API/file della cancellazione anonimi rispondono 401, con no-store.
La verifica acustica reale su hardware dell'utente rimane necessaria.

## Release dell'adeguamento automatico, 2026-10-18

- URL: `https://staging.epistrophe.it/?piece=santo-frisina&part=P3`.
- Build: `20261018-211504-46c4b97f1322-dirty`.
- Manifest SHA-256:
  `6c167999959d98e0be91d23e41f8b9ce2b855586e00d30686bbd547448380b9a`.
- Worker: `d9b16883-6f9a-45d5-bdfa-abb1757c2139`.
- Rollback: `0a26b193-0726-4bed-bf0d-4e7db388c126`.

Passano typecheck, 72 test applicativi e 20 test DSP/calibrazione, 12 test di
packaging, controlli configurazione e documentazione. Gli hash di tutti i
1284 file sono verificati contro il manifest, senza file extra; i core asset
sono stati rigenerati in una directory temporanea e confrontati con la dist.
Gli smoke browser sono eseguiti in sequenza sulla stessa dist pubblicata.

Nel grafo Web Audio sintetico, dopo una verifica a 35,86 dB, il guadagno
acustico ×2 viene seguito da g≈2,0216 e quello ×0,5 da g≈0,5061. La base lascia
circa 0,00050 e 0,00013 RMS, senza Hz nel campione letto. La voce a 220 Hz con
base alla stessa frequenza resta a circa 0,02136 RMS e 220,002 Hz. L'adattamento
rimane fermo durante il double talk e dopo un cambio di ritardo. Passano anche
blocco del pitch in saturazione, recupero in silenzio, seconda apertura dello
stream, apertura del controllo dal nuovo pulsante e rilascio di nodi/Worker.
Queste sono misure della fixture, non del Samsung S25+.

Passa lo smoke completo della release su Ave verum, senza errori JavaScript o
richieste esterne. Screenshot su Santo a 1366×768 e 390×844 in
`artifacts/echo-cancellation/`, compresi stato normale, saturazione e dialogo.
Il percorso principale rimane nel viewport; il controllo di stato conserva
44 px di area utile. Espandere i dettagli può richiedere scroll nel dialogo.

Un primo controllo aggiunto per il recupero dopo clipping ha scoperto che
il convolver silenzioso può produrre zero canali: il monitor interrompeva le
finestre e arrivava al watchdog. Il Worklet ora tratta quel caso come zeri;
una regressione dedicata e lo smoke completo verificano il recupero.

Dopo il deploy: pagina di Santo anonima 302 al login, login e auth/config 200,
API e nuovo Worklet anonimi 401; risposte no-store. I servizi di autenticazione
simulati sono rimasti esclusivamente nel server di preview in loopback. Non
sono state cambiate API, migrazioni, consensi o dati R2. Il grafico condiviso
di Santo sotto Arturo Maiani è stato ispezionato, senza audio né stime raw.
Restano da misurare percorso reale del telefono, distorsione ad alto volume,
disallineamenti e cause dei salti del tracker; nessuna precisione reale viene
dedotta dai soli test sintetici.
