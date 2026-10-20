# Santo: test recuperato del 20 ottobre 2026

**Stato:** acquisizione reale verificata; diagnosi F0 aperta. Nessuna modifica
al detector o al salvataggio distribuita durante questo controllo.

## Salvataggio

L'utente segnalava attese lunghe e retry falliti. La pagina è stata mantenuta
aperta per conservare il Blob. Durante il controllo remoto un successivo POST
ha restituito 200, outcome `ok`, 2.584 ms di wall time e 555 ms di CPU nel
Worker, senza eccezioni. D1 conferma il commit alle 09:14:17 UTC del 20 ottobre
(11:14:17 in Italia). L'utente ha confermato l'esito «fatto».

Questo dimostra il successo del retry osservato, non identifica la causa dei
tentativi precedenti né misura il tempo totale atteso sul telefono prima
dell'invocazione del Worker. Non si attribuisce il problema alla connessione
o a R2 senza evidenza. Non sono stati richiesti download/import all'utente.

Test `9cc77206-95a8-479b-8eb0-24838275842f`, membro Arturo del precedente test,
brano `santo-frisina`, 60 s, 48 kHz, 2.880.000 frame, quattro canali float32,
48.144.080 byte. Recuperato e verificato con gli strumenti già autorizzati;
SHA-256:
`7907ea512cb7ac59e92345a32ca664347376a1869d6352bb3d7688972140b59c`.

## Prima verifica acustica

La provenienza indica build `20261020-084501-46c4b97f1322-dirty`, inizio
acquisizione 09:06:43 UTC, `echo.calibrationVerified:false`, gain 0,
validationDb/noiseRms nulli, impulso nullo. Il segnale trattato è identico al
grezzo campione per campione e la previsione del rientro è interamente zero.
Questa prova registra dunque voce più rientro senza sottrazione applicata;
non misura il comportamento del filtro attivo, né una sua soppressione della
voce. Rimane utile per identificare offline il percorso app → stanza → mic.

RMS grezzo/trattato 0,08710, picco 0,95941; riferimento RMS 0,01171, picco
0,16894. Non si conclude assenza di distorsione hardware dalla sola assenza
di campioni sopra uno. 3.738 callback pitch, 2.144 con trackedHz presente:
non sono misure di recall o accuratezza F0 senza etichette indipendenti.

Mixer: master 0,62; organo 0,4; soprano/contralto/basso 0,5; tenore 1;
metronomo 0,3; normalizzazione 1/sqrt(5). AEC, noise suppression e AGC
dichiarati disattivati. Il volume del sistema non è esposto in questi dati;
L'utente ha confermato per questa registrazione introduzione senza canto,
poi parte del tenore, volume circa 75% invariato durante la prova.

## Esplorazione e limiti

Un modello causale esplorativo fino a 750 ms, stimato sul solo intervallo
2–10 s e verificato a 10–16 s, riduce 2,70 dB sul train ma peggiora di 2,35 dB
sul tratto tenuto separato. Non supera quindi una verifica indipendente e
non è un candidato da installare. L'introduzione silenziosa è stata poi
confermata dall'utente. I dati di canto non contribuiscono al modello.

La correlazione semplice con la base ha massimi intorno a 151,5 ms nei primi
secondi e 154,5 ms nel successivo tratto; essendo materiale musicale periodico,
questi massimi non dimostrano da soli un cambiamento fisico della latenza.
L'analisi successiva verifica la coerenza tra bande e un'ablazione su dati
separati, descritta sotto. Non identifica la causa fisica del cambiamento.
Non si adotta un ritardo fisso, un modello stimato sul canto o una correzione
verso le note dello spartito. Non si modificano le regioni ammesse dal live.

## Verifica separata del cambiamento di ritardo

Il nuovo esperimento usa tre intervalli disgiunti dell'introduzione confermata:
stima della risposta a 2–6 s, aggiornamento del solo ritardo a 8–10 s,
verifica tenuta separata a 10–16 s. Il modello è un FIR causale di 4.096 tap
a 16 kHz, ritardo iniziale di 140 ms, regolarizzazione 0,002. I parametri
dell'esperimento restano espliciti nel report: non è un confronto esaustivo
tra modelli, né una validazione su un altro dispositivo.

La correlazione spettrale pesata trova lo stesso spostamento di **+3,0 ms**
(48 campioni a 16 kHz, 144 a 48 kHz) in tre bande indipendenti:

| Banda | Picco a 2–6 s | Picco a 8–10 s | Variazione |
| --- | ---: | ---: | ---: |
| 100–700 Hz | 153,6875 ms | 156,6875 ms | +3,0 ms |
| 700–2.000 Hz | 151,5 ms | 154,5 ms | +3,0 ms |
| 2.000–6.000 Hz | 150,75 ms | 153,75 ms | +3,0 ms |

I picchi nelle diverse bande dipendono anche dalla fase della risposta
acustica: non sono tre misure assolute della latenza hardware. La variazione
coerente e il miglioramento sul tratto separato supportano un disallineamento
variabile del percorso riferimento/microfono. Non provano se sia cambiato
un buffer, il routing, la sincronizzazione o il percorso acustico.

Sul tratto silenzioso **10–16 s**, nell'analisi a 16 kHz:

| Sottrazione offline | Riduzione RMS rispetto al grezzo |
| --- | ---: |
| Risposta con ritardo iniziale congelato | −3,81 dB (peggiora) |
| Stessa risposta, solo ritardo aggiornato di +3 ms | +10,59 dB |
| Ritardo e guadagno aggiornati | +10,51 dB |

Il guadagno stimato a 8–10 s è 1,00969: circa +1%. Cambiare solo il volume
non risolve questo disallineamento. La differenza tra risposta congelata e
ritardo aggiornato è circa 14,4 dB sul tratto tenuto separato. Il risultato
non misura l'efficacia della cancellazione live, che nella registrazione era
disattivata. Anche il residuo corretto contiene ancora rientro.

I file per il replay mantengono il microfono originale a 48 kHz: viene
ricampionata soltanto la previsione da sottrarre. L'aggiornamento è applicato
da 10 s, dopo la fine dell'osservazione, con crossfade di 15 ms. Misurando
questi file a banda intera, includendo il crossfade, la riduzione a 10–16 s
è 10,52 dB. Il resampling simmetrico e la convoluzione offline non costituiscono
un'implementazione streaming; non vanno presentati come tali.

## Replay del pitch a regioni invariate

Il replay copia esattamente **2.144 frame ammessi** della registrazione,
senza aggiungerne o rimuoverne. Se la proposta di F0 fallisce, conserva la
misura originale. Non usa lo spartito per correggere le note. A 2–16 s sono
ammessi 200 frame su 875: essendo l'introduzione silenziosa, sono falsi
positivi confermati nel campione, non 200 eventi musicali distinti.
Il confronto a maschera fissa li conserva intenzionalmente e non pretende
di correggere il problema del voicing attraverso una misura del solo pitch.

L'allineamento callback/PCM è stimato dal solo RMS: offset 1.376 campioni
(28,67 ms), errore log-RMS mediano 0,01026. Il roundtrip sul segnale originale
ha errore F0 mediano di 1,06 cent, ma p95 di 392,84 cent; il 93,05% dei frame
con F0 confrontabile è entro 50 cent. I confronti puntuali rimangono quindi
approssimati, soprattutto agli attacchi e nei tratti instabili.

A 18–42 s il ritardo aggiornato cambia di oltre 50 cent 183 dei 1.100 frame
ammessi (11 fallback); a 44–58 s ne cambia 103 su 670 (12 fallback).
**Non sono conteggi di errori risolti:** non c'è un riferimento F0 della voce
isolata. Neppure la minore energia durante il canto dimostra preservazione
della voce. La sottrazione usa esclusivamente un modello della base congelato
prima del canto; test sintetici verificano l'indipendenza del fit dai campioni
successivi e il mantenimento della componente vocale alla stessa frequenza.

## Conseguenza per l'implementazione

L'attuale follower live aggiorna il guadagno ma rifiuta variazioni di fase:
non segue un cambiamento di ritardo. Serve seguire e verificare anche il
ritardo usando il riferimento dell'uscita, con astensione sul materiale
ambiguo e blocco dell'adattamento durante il canto. Un +3 ms fisso per Samsung
non è giustificato. Questo esperimento non modifica né distribuisce il DSP
live, non aggiunge calibrazioni e non attesta ancora la qualità del canto
corretto. Rimane distinta la diagnosi del perché questo test abbia acquisito
una catena non verificata dopo i tentativi di calibrazione dell'utente.

## Riproduzione

```text
python scripts/probe_echo_path_drift.py artifacts/echo-diagnostics/9cc77206-95a8-479b-8eb0-24838275842f --quiet-intro-confirmed
node scripts/replay_echo_pitch.cjs artifacts/echo-diagnostics/9cc77206-95a8-479b-8eb0-24838275842f --path-drift
python scripts/plot_echo_path_drift.py artifacts/echo-diagnostics/9cc77206-95a8-479b-8eb0-24838275842f
python -m unittest discover -s scripts -p "*echo*test.py"
```

Sette test superati: segno e padding del ritardo, accordo tra bande,
indipendenza dai campioni successivi al train, applicazione dopo la fine
dell'osservazione, preservazione sintetica della voce con stessa frequenza.
Nessun cambiamento UI: non richiesti nuovi screenshot desktop/mobile.

Artefatti privati in
`artifacts/echo-diagnostics/9cc77206-95a8-479b-8eb0-24838275842f/`:
manifest, storage, WAV originale, quattro canali, initial-audit e
reference-path-audit, path-drift-ablation, path-drift-pitch-replay,
canali corretti e figura path-drift-study (PNG e PDF).
Il controllo POST redatto senza header/token è in
`artifacts/diagnostic-upload-fix/tail.json`.
