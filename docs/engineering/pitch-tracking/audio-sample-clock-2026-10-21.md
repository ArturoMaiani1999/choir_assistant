# Conteggio dei campioni e timestamp Worklet

**Status:** deployed to staging; physical device verification pending  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Problema e modifica

L'[isolamento con riferimento numerato](platform-aec-device-2026-10-21.md)
mostra che `currentFrame` può ripetersi mentre il PCM continua regolarmente.
La contesa del grafo riproduce il fenomeno anche senza microfono reale,
metronomo dell'app o offset visivo. Scartare quel blocco o interrompere la
cattura perde dati validi; azzerare il monitor ostacola il delay follower.

`audio_sample_clock.js` conta la lunghezza di ogni callback, ancorandosi al
primo frame osservato. Registrazione diagnostica, misura acustica e monitor
usano questo tempo dei campioni. Un timestamp arretrato aumenta `skewCount`
e `maxLagFrames`, senza eliminare PCM o storico. I timestamp in avanti oltre
il contatore locale rimangono discontinuità conservative: non sono prova
autonoma di campioni persi, ma non vengono ricuciti silenziosamente.

Il registratore conserva il prefisso contiguo, compresa la coda parziale già
acquisita, prima di segnalare un salto in avanti. Una partenza oltre il frame
programmato viene rifiutata. La misura acustica rifiuta anch'essa partenza
tardiva e salto durante la cattura; può riancorarsi prima del tratto utile.

Il monitor conserva la politica di una sola finestra in prestito al Worker,
senza backlog. Allegando un riepilogo del clock a ogni finestra, mantiene
telemetria limitata nel journal di osservazione, senza espellere la storia
di calibrazione e routing. Il guadagno della voce, i gate di ammissione e le
note bersaglio non cambiano.

## Interruzioni effettive e limiti

Un evento `AudioContext.statechange` invalida H, programma il guadagno di
sottrazione a zero, azzera i follower e riancora il monitor con un nuovo epoch.
Una risposta Worker precedente non può riabilitare il modello. Il resume
richiede una nuova verifica acustica. Il listener viene rimosso al detach.

Il salto in avanti del monitor invalida un modello verificato. Prima del
fit, la cattura acustica indipendente decide la propria integrità: un semplice
riancoraggio iniziale del monitor non può annullare una misura valida.
La registrazione diagnostica termina su statechange, salva soltanto il
prefisso consegnato e rimuove il listener; non unisce i due lati del resume.

Durante suspend, `AudioParam.value` può riportare l'ultimo valore renderizzato.
Il controllo verifica subito modello invalido e target zero, e controlla il
valore renderizzato dopo resume. La prima versione del test controllava
erroneamente il valore renderizzato mentre il rendering era fermo.

Il contatore non identifica perdite upstream di ADC, sistema operativo,
AEC nativo o MediaStream. La continuità verificata con PCM numerato riguarda
il riferimento digitale in quel grafo; non certifica la cattura acustica.
Questa modifica non dimostra che i precedenti salti fisici di circa 40 ms
o gli errori di pitch del telefono siano risolti. AEC di piattaforma ancora
solo nel probe, non attivato per default nell'app.

## Verifiche

- Typecheck e 89 test API passati; 52 test DSP/lifecycle passati. Copertura
  aggiunta per timestamp ripetuti/recuperati, quattro canali numerati, avvii
  non allineati o tardivi, limiti parziali, salti in avanti, epoch, sospensione,
  rimozione listener, telemetria senza invalidazione e salvataggio del prefisso.
- `artifacts/audio-sample-clock/candidate-1`: tre catture browser da 960.000
  campioni, zero errori di sequenza su ogni campione e nessun errore di cattura.
  Nella prova di contesa, 156 callback con timestamp arretrato; massimo ritardo
  del timestamp 13.568 campioni, mentre il riferimento rimane contiguo.
- `platform-smoke/result.json`: Santo e click, raw e AEC nativo con microfono
  sintetico, 816.000 campioni per condizione; uno e due timestamp arretrati,
  zero salti in avanti, tracce terminate, nessun profilo vocale verificato.
- `candidate-calibration-3/result.json`: guida completa, cinque riaperture di
  Base, voce sintetica all'unisono, gain x2/x0,5, retiming +1/+6 ms e ritorno,
  clipping, suspend/resume, riuso breve, background, devicechange, permesso
  tardivo, Escape/backdrop/focus. Riduzione holdout sintetica circa 34 dB;
  non è una misura dell'altoparlante S25+.
- `final-calibration/result.json`: pacchetto finale, 15.900 mutazioni del grafo
  dopo la calibrazione, 51 timestamp arretrati nel monitor, massimo 512
  campioni. Modello e guadagno conservati; suspend/resume invalida e richiede
  verifica. Riuso e lifecycle della guida completano il controllo.
- Screenshot 1366×768 e 390×844 ispezionati: guida e risultato senza clipping,
  dettagli espandibili e azione primaria esistenti. Nessun nuovo controllo,
  testo o layout introdotto nella UI.

La prima esecuzione estesa fallisce sulla F0 sintetica. Lo stesso controllo
sulla release precedente fallisce a 227,05 Hz per una sorgente 220 Hz, RMS
0,02168, fit acustico 34,30 dB e clock raw precedente. Conservato in
`baseline-calibration/failed-live-check.json`. Il candidato nella terza prova
completa tutti i controlli e preserva 220,002 Hz dopo gli adeguamenti. Questa
intermittenza preesistente non viene cancellata dal report né attribuita
automaticamente al clock: richiede un confronto simultaneo prima/dopo il
ponte MediaStream fra i due contesti dell'app.

Il pacchetto finale aggiunge soltanto il modulo clock e aggiorna i tre
Worklet, i loro proprietari UI e i riferimenti fingerprintati/versione.
Nessun asset musicale o detector modificato. Bundle Worker server invariato,
SHA-256 `b99cad71a3a7e5a8ceaeabbefeca7582aebac1e703527c212d23f398b2f2b051`.

Distribuzione e rollback nel [registro rilascio](../../operations/releases/2026-10-21-audio-sample-clock.md).

## Confronto digitale simultaneo del ponte MediaStream

Il successivo collegamento USB espone MTP e la porta seriale Samsung, ma
nessuna interfaccia ADB: le misure fisiche non vengono avviate. In attesa del
controllo Debug USB, `scripts/browser_audio_bridge_probe.py` confronta sul PC
una stessa sorgente sintetica 220 Hz / ampiezza 0,03 attraverso tre percorsi
simultanei: diretto, MediaStream nello stesso contesto, MediaStream fra due
contesti. Entrambi i contesti a 48 kHz; uscita fisica muta, nessun microfono,
nessun accesso al telefono. Origini dei due contesti indipendenti.

`artifacts/audio-bridge/probe-1`: 720.000 campioni per percorso, 702 finestre
di pitch per percorso. Mediana 220,00184 Hz e zero finestre oltre ±10 cent.
Questa prima versione non campiona in parallelo gli AnalyserNode.

`probe-stress-1` aggiunge contesa del grafo e letture Analyser ogni circa
17 ms. Ancora 720.000 campioni e 702 finestre Worklet per percorso; 872
finestre Analyser per percorso. Zero finestre oltre ±10 cent sia nel PCM
catturato sia nell'Analyser. I due canali catturati nel primo contesto
registrano 209 callback con timestamp arretrato, massimo 7680 campioni;
nessun salto in avanti o errore di cattura. Il secondo contesto non registra
anomalie del clock. Differenza massima dal riferimento circa 0,016 cent.

Il ponte minimo, anche sotto questa contesa, non riproduce la F0 alterata
vista nello smoke dell'app completa. Non attribuire quindi l'intermittenza
al solo fatto di avere due contesti o al timestamp arretrato. Il prossimo
confronto deve osservare simultaneamente segnale sintetico originale,
uscita della sottrazione e ingresso del detector nel grafo completo. Le
prove non certificano MediaStream su Android, AEC nativo, ADC o altri carichi.
