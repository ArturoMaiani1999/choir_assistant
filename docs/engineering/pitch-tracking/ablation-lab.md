# Pitch Detection Ablation Lab

**Stato:** implementato nel Cockpit, non distribuito  
**Owner:** project maintainer  
**Ultima verifica:** 2026-10-18

## Scopo

Diagnosi, risultati su audio reale, benchmark e comandi riproducibili aggiornati:
[Ricerca pYIN del 18 ottobre 2026](research-2026-10-18.md). Il decoder originale
resta una baseline selezionabile; non usare la copertura come accuratezza.

Il Pitch Detection Lab confronta sullo stesso audio la traiettoria YIN live
salvata, YIN offline raw, lo stesso output dopo gate/tracker configurabili e
pYIN offline. Serve a separare tre cause di perdita: assenza di un candidato
acustico, rifiuto dei gate e rifiuto o conferma ritardata del tracker. Non
modifica detector né scoring live descritti in [Core live](live-core.md).

## Architettura implementata

```text
R2 privato -> route autorizzata -> Web Audio decode -> PCM mono
                                                   |
                                                   v
IndexedDB <- audio+algoritmo+versione+config <- Web Worker
                                                   |
                     YIN raw -> gate/tracker -------+
                     pYIN candidati -> Viterbi -----+
                                                   |
                                                   v
             piano roll condiviso + inspector + metriche + JSON/CSV
```

- `frontend/pitch_lab_core.js`: DSP puro, configurazione, hash, metriche e
  segmentazione; è eseguibile nel browser e da Node.
- `frontend/pitch_lab_worker.js`: calcolo cancellabile fuori dal main thread e
  avanzamento per fasi.
- `frontend/pitch_lab.js`: decode locale, cache IndexedDB, esperimenti,
  playback, grafico, inspector ed export.
- `frontend/piano_roll.js`: base grafica unica, condivisa con prova e analisi.
- `src/recordings.ts`: audio al direttore soltanto con opt-in e stesso coro.

Ogni risultato contiene algoritmo e versione, hash di configurazione e audio,
sample rate, frame/hop length, timestamp, F0 raw/tracked, RMS, clarity,
confidence, voiced probability pYIN, rejection reason, alternativa d'ottava e
tempo CPU. Una proprietà non prodotta dall'algoritmo vale `null`, non un numero
inventato.

## Accesso, consenso e privacy

Le registrazioni sono private per default. Il corista può selezionare
«Condividi con il direttore per l'analisi tecnica» al salvataggio. La migrazione
`0008_pitch_lab_recording_consent.sql` registra opt-in e timestamp.

Le route `/api/cockpit/recordings` richiedono `director`, filtrano per il
`choir_id` del chiamante, espongono solo righe opt-in con proprietario attivo e
servono R2 con `private, no-store` e `nosniff`. Non esistono URL pubblici e
l'audio non viene trasmesso a servizi esterni. Il pulsante **Pitch Lab** compare
solo quando esiste l'audio autorizzato della stessa persona e parte.

## pYIN del Lab

Per ogni frame centrato il Lab calcola differenza YIN e CMND, estrae tutti i
minimi locali nel range F0 e li rifinisce per interpolazione parabolica. La
massa delle soglie deriva dalla CDF Beta; per ogni soglia viene distribuita sui
trough ammessi tramite prior Boltzmann. La massa residuale senza trough va al
minimo globale. I candidati quantizzati in bin di pitch entrano in un modello
temporale voiced/unvoiced decodificato via Viterbi.

I default seguono `librosa.pyin`: 100 soglie, Beta `(2,18)`, Boltzmann `2`,
risoluzione `0,1` semitoni, transizione massima `35,92` ottave/s, switch `0,01`
e probabilità senza trough `0,01`.

### Decoder e differenze da librosa

- il decoder predefinito usa due copie V/UV della griglia e transizioni
  triangolari normalizzate per riga, calcolate soltanto nella banda ammessa;
- il vecchio decoder sparso con un solo stato UV rimane nel preset
  **pYIN originale (diagnosi)**: era una divergenza errata, non equivalente al
  modello completo, e provocava dropout anche con candidati validi;
- il gate `minVoicedProbability` è esplicito e disattivo nel default scientifico.
  Il preset con gate 0,05 è sperimentale; ha beneficio sintetico, non ancora una
  validazione umana. Candidati e probabilità raw restano esportabili;
- il CMND del Lab conserva la differenza su `N-tau` campioni del modulo
  originale, diversa dalla formulazione librosa 0.11; l'output è interpolato
  anziché soltanto quantizzato sul bin;
- usa frame non padded (`center=False`) per timestamp interpretabili;
- la rimozione DC è attiva in YIN Production e disattiva in pYIN Default.

L'implementazione è originale e non incorpora dipendenze runtime di
librosa/SciPy. Il metodo segue Mauch & Dixon (2014). `librosa 0.11`, licenza
ISC, è soltanto un oracle opzionale di sviluppo.

## Uso

1. Il corista salva una registrazione e abilita l'opt-in tecnico.
2. Nel Cockpit il direttore apre **Analisi**, sceglie parte/corista e poi
   **Pitch Lab**.
3. Sceglie un preset o modifica parametri e preme **Calcola inferenza**.
4. Lascia visibili più curve, trascina, fa zoom sul cursore, seleziona frame o
   segmenti e riproduce l'audio sincronizzato.
5. Le modalità singola, A/B e sweep (massimo sei valori) usano lo stesso PCM.
6. JSON esporta risultati/configurazioni/hash; CSV esporta i frame.

Il ground truth opzionale è un JSON array, o `{ "frames": [...] }`, di
`{startSec, endSec, hz}`; `hz:null` indica unvoiced. Solo in sua presenza il Lab
calcola RPA, raw chroma accuracy, recall/FAR di voicing, octave error rate, MAE
e overall accuracy.

Sono supportati anche `{startSec,endSec,voiced:true}` per annotazioni del solo
voicing. Le aree non annotate restano sconosciute e vengono escluse, non trattate
come silenzio. L'export include precision/F1, percentili in cents, GPE e dropout
sul riferimento effettivamente disponibile. Intervalli sovrapposti sono rifiutati.

La modalità **Ricerca automatica (6 prove)** esegue una ricerca gerarchica nel
Worker sul medesimo PCM. Senza riferimento positivo/negativo/F0 produce solo
diagnostica. Con riferimento sceglie un candidato in-sample, da verificare su
altre registrazioni prima dell'adozione; JSON salva obiettivo, parametri e tempi.
Il CLI `scripts/pitch_research.js` gestisce train/validation/test indipendenti.

### Gerarchia e interazioni

Il piano roll resta dominante; parametri avanzati e candidati del frame sono
espandibili. Il raw pYIN è ora il candidato pre-decoder e si può sovrapporre
alla curva decodificata. Il live salvato è una traccia di display, non un export
completo del raw o del TrackedPitch live. I singoli punti rimangono visibili;
nessuna interpolazione grafica riempie i dropout.

Sono mantenuti mouse/touch per zoom e trascinamento, focus visibile, frecce
destra/sinistra per avanzare di un frame, segmenti ispezionabili da tastiera,
target touch di 44 px, export anche mobile e chiusura con indietro/Escape.
Il Lab è un workspace a pieno schermo, non un dialogo con backdrop.
Su mobile grafico e contesto precedono configurazione e metriche: lo scroll
verticale è intenzionale per questa superficie diagnostica; il documento non
scorre orizzontalmente e la tabella può scorrere nel proprio contenitore.
Verificati e ispezionati screenshot 1366×768 e 390×844.

## Parametri e preset

I tooltip descrivono unità e trade-off. La validazione impedisce range F0
impossibili, Nyquist violato, frame troppo corto, probabilità fuori `[0,1]`,
alpha EMA non validi e più di 400 soglie.

- **YIN Production:** soglia `0,42`, clarity `0,45`, confidence `0,30`, floor
  `0,36`, warm-up `3`, salto `300` cent, conferme `3/5`, mediana `3`, EMA
  `0,65/0,30`.
- **YIN Relaxed Gates:** soglie voce debole e hold di 6 frame.
- **YIN Raw Only:** nessun gate/tracker dopo la stima.
- **YIN No Confidence Gate:** `minConfidence=0`.
- **YIN No Temporal Confirmation:** conferme e smoothing neutralizzati.
- **pYIN Default:** configurazione scientifica sopra descritta.

## Metriche e interpretazione

Senza ground truth acustico il Lab riporta copertura F0, gap, rejection reason,
discontinuità, possibili ottave, tempo target valutabile, distanza in cent dal
target e intonazione condizionata. Le ultime due misurano l'esecuzione rispetto
alla partitura, non l'accuratezza F0. Nessun modello è dichiarato «migliore» in
base alla vicinanza al target.

Le soglie in cent per conteggiare le discontinuità e per evidenziare i
disaccordi tra detector sono configurabili nel gruppo **Analisi** e fanno parte
della configurazione riproducibile dell'esperimento.

`offline-f0-live-gap` identifica intervalli in cui l'offline trova F0 e il live
salvato no. È un indizio, non prova che la stima offline sia corretta.

## Validazione e oracle

`tests/pitch-lab.test.ts` copre sinusoidi a 110/220/440/880 Hz, vibrato, salto
d'ottava, note brevi, silenzio, rumore e fondamentale debole con armoniche
dominanti, oltre a clock, cache, riproducibilità e falsi negativi.

`python scripts/verify_pyin_librosa.py` confronta fixture deterministiche con
`librosa.pyin 0.11.0`, `center=False` e parametri allineati:

| Fixture | mediana differenza F0 | accordo voiced |
|---|---:|---:|
| 220 Hz | 2,61 cent | 100% |
| vibrato | 2,80 cent | 100% |
| salto d'ottava | 2,91 cent | 100% |
| fondamentale debole | 2,59 cent | 100% |

Tolleranze automatiche: mediana ≤35 cent e accordo voiced ≥75%.

## Benchmark CPU

Windows 11 Home, Intel Core Ultra 9 275HX, Node 24.19.0, PCM mono 16 kHz,
2 minuti, frame 2048/hop 512, segnale sintetico modulato:

| Algoritmo | frame | tempo | real-time factor |
|---|---:|---:|---:|
| YIN offline + tracker | 3747 | 4,24 s | 0,035× |
| pYIN + Viterbi | 3747 | 5,03 s | 0,042× |
| Sweep YIN, 4 configurazioni sequenziali | 4 × 3747 | 18,39 s | — |
| Sweep YIN, CMND condivisa | 4 × 3747 | 4,72 s | — |

È lo stesso core DSP del Worker, ma il dato non include decode, rendering e
variabilità del browser. Il benchmark sweep è riproducibile con
`node scripts/benchmark_pitch_lab_sweep.js 120`: sul sistema indicato il riuso
degli intermedi è risultato **3,89×** più veloce, con equivalenza frame-per-frame.

Durante uno sweep il Worker riceve una sola copia del PCM, esegue una sola
conversione di sample rate e conserva una sola matrice CMND per frame. RMS e
CMND vengono poi riutilizzati dalle configurazioni che condividono sample rate,
frame/hop, limiti F0 e preprocessing. Il tempo condiviso viene ammortizzato fra
i risultati e resta disponibile nei metadati `performance` dell'export.

## Limiti noti

- L'audio storico non opt-in resta indisponibile: serve una sostituzione
  salvata con consenso.
- Il riuso CMND vale all'interno del singolo sweep. Le matrici, volutamente
  volatili e potenzialmente grandi, non vengono persistite in IndexedDB né
  conservate dopo la terminazione del Worker.
- Il worker si interrompe terminandolo; un singolo frame in corso non emette un
  checkpoint intermedio.
- PESTO, CREPE, training, GPU e inferenza remota non fanno parte del Lab.
- La migrazione 0008 è stata applicata e verificata sul D1 di staging il
  18 ottobre 2026; non è stata applicata ad ambienti di produzione.
- Nessun deploy è stato eseguito.

## Riferimenti e licenze

- Mauch, M. & Dixon, S. (2014), *pYIN: A Fundamental Frequency Estimator Using
  Probabilistic Threshold Distributions*, ICASSP.
- `librosa.pyin` / `librosa/core/pitch.py` 0.11, licenza ISC, solo oracle.
