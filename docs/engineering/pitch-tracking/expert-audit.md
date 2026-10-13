# choir_assistant — Audit e piano tecnico per pitch detection e scoring

**Destinatario:** esperto esterno di F0/pitch tracking vocale e team di sviluppo<br>
**Ambito:** DSP, rilevazione monofonica della frequenza fondamentale (F0), tracking temporale e valutazione dell'intonazione nel browser.
**Stato del documento:** revisione del codice effettuata il **2026-09-27**. La baseline descritta nelle sezioni 1–3 è verificata contro `frontend/pitch_detector.js`, `frontend/app.js`, `frontend/score_runtime.js` e i test Node disponibili. Il repository era in worktree modificato: prima di una valutazione riproducibile, consegnare all'esperto un commit/tag o un archivio dello snapshot effettivamente eseguito, non il solo hash di `HEAD`.

**Limite essenziale dell'evidenza:** i dati correnti di benchmark confrontano il pitch con il target MusicXML; non costituiscono una ground truth acustica frame-per-frame. Le cifre in cent e i salti servono a generare ipotesi, non a dimostrare l'accuratezza assoluta di un estimatore F0.

## 1. Contesto e obiettivo

`choir_assistant` è una piattaforma privata di studio corale. Il riferimento musicale canonico è il MusicXML approvato, derivato da un `.mscz` verificato da un amministratore; una timeline di esecuzione collega le note dello spartito al playback. La webapp offre feedback di intonazione per una **singola voce** acquisita dal microfono, idealmente con l'accompagnamento nelle cuffie. L'analisi rimane locale nel browser.

Attualmente `frontend/pitch_detector.js` implementa uno stimatore F0 ispirato a YIN, seguito da regole euristiche di filtraggio e scoring. Il sistema è dichiaratamente un prototipo e il repository conserva una legacy Flutter solo come riferimento.

## Stato sperimentale corrente

- **v1** è la baseline live: YIN-style a candidato singolo più `PitchSmoother`.
- **v2** (prior breve e guardia d'ottava sul solo `rawHz`) è stato provato su una take di tenore e non è un candidato live attivo. L'osservazione disponibile è errore dal target invariato e più salti rapidi; senza ID take, intervallo annotato e reference F0 indipendente non è una conclusione generalizzabile.
- **v3** (YIN multi-candidato con decoder temporale) è disponibile nell'analisi offline e non è stato promosso al live. Sulla prova disponibile ha aumentato falsi voicing e salti rapidi; il risultato va ripetuto sul corpus controllato.
- **v4** (MPM/NSDF) è disponibile nell'analisi offline e non è stato promosso al live. La misura riportata su una take è 39 salti oltre 700¢ contro 4 per v1, con mediana di deviazione dal target invariata (19¢). Non chiamare quest'ultima «errore F0» finché manca una reference acustica indipendente.
- **v5** è il confronto **offline** attivo: CREPE tiny in formato ONNX decodifica localmente l'audio WebM/Opus registrato, lo ricampiona a 16 kHz e valuta finestre centrate da 1024 campioni ogni 50 ms. Il confronto associa a ogni frame v5 il frame v1 live temporalmente più vicino: i due stimatori non hanno quindi lo stesso hop né vedono necessariamente lo stesso PCM. Il modello non altera v1 né lo score di gioco.
- **v5 live** è una sonda sperimentale, non un sostituto di v1: esegue un frame CREPE di 1024 campioni ricampionati a 16 kHz sulla finestra recente del microfono, con limite di avvio di 50 ms. Mostra una traccia rosa e registra p50/p95 di inferenza sul browser reale. V1 resta la sola sorgente di scoring.
- **MVP posterior probabilistico** è disponibile solo nell'analisi offline della take: conserva la salience CREPE grezza, calcola un filtro forward audio-only e una variante score-aware con prior attivo soltanto vicino ai confini MusicXML. I tre livelli sono attivabili separatamente; il target non modifica mai la salience e il prior conserva massa per transizioni inattese.

v5 è il primo confronto neurale: serve a capire se gli artefatti agli attacchi e gli scambi tra armoniche sono causati dallo stimatore YIN, prima di ritoccare ancora il tracker live. Il peso del modello è locale, ma ONNX Runtime Web/WASM è al momento caricato da CDN: nessun audio viene inviato in rete, tuttavia la dipendenza runtime non è offline-first.

**Domanda ingegneristica:** come aumentare affidabilità e correttezza musicale del feedback, senza introdurre latenza avvertibile, consumo CPU eccessivo o dipendenza da servizi remoti?

**Indicazione di progetto:** non sostituire subito YIN con un modello neurale. Separare e misurare tre problemi diversi:

1. **Stima acustica F0:** quale fondamentale è supportata dal segnale? È presente voce?
2. **Tracking:** come collegare le ipotesi F0 tra frame senza eliminare salti legittimi, attacchi e vibrato?
3. **Valutazione musicale:** quanto la performance rilevata corrisponde alla nota e al tempo previsti dal MusicXML?

Un miglioramento del numero 2 o del numero 3 non implica necessariamente che il numero 1 sia migliore. Nel benchmark i tre livelli vanno esaminati separatamente.

## 2. Baseline live verificata nel codice

| Componente | Comportamento dichiarato |
|---|---|
| Input | Buffer microfonico da 4.096 campioni, letto in corrispondenza degli animation frame; sample rate nativo browser |
| Stima F0 | YIN-style squared difference e cumulative mean normalized difference (CMND), ricerca 70–1.000 Hz |
| Selezione | Primo minimo discendente sotto soglia CMND `0.42`, interpolazione parabolica su tre punti |
| Silenzio | Scarto quando RMS `< 0.001` per default; l'utente può impostare `0.0001`–`0.01` per parte |
| Qualità | `clarity = 1 - CMND(minimum)`; `confidence` = clarity moltiplicata per un termine di livello saturato a RMS `0.08` |
| Accettazione | Clarity ≥ `0.45`, confidence ≥ `0.30`; tre frame vocalizzati per conferma; rilascio dopo tre frame respinti |
| Filtro | Per default mediana di tre frame in pitch logaritmico; smoothing esponenziale `α = 0.65` all'avvio e `α = 0.30` dopo. RMS, alpha e mediana (1/3/5/7) sono modificabili nella UI e salvati per parte |
| Salti | Fino a 300 cent immediati; salti maggiori confermati da tre frame coerenti entro 100 cent; ottave confermate da cinque frame |
| Valutazione | Comparazione con la nota MusicXML attiva dopo un grace period di attacco; «in tune» entro ±30 cent, «centred» entro ±12 |
| Denominatore | Frame non vocalizzati/incerti esclusi dalla percentuale di intonazione |
| Acquisizione | Microfono mono; echo cancellation e noise suppression disabilitati; automatic gain control abilitato |

**Osservazione verificata:** la selezione del primo minimo con CMND `< 0.42` implica già clarity `> 0.58`; per il percorso live v1 la soglia successiva `clarity ≥ 0.45` è quindi ridondante. La confidence, invece, può ancora rigettare il frame perché include il livello RMS. Non rimuovere la soglia senza test di regressione: conserva comunque semantica diagnostica e compatibilità con i comparatori.

Una finestra di 4.096 campioni rappresenta circa 85,3 ms di audio a 48 kHz. **La durata della finestra non coincide automaticamente con la latenza end-to-end:** quest'ultima comprende acquisizione, scheduling dei frame, elaborazione, conferma del tracking e rendering. Va misurata empiricamente.

### 2.1 Evidenza disponibile e lacune diagnostiche

Il pulsante diagnostico **Benchmark** salva localmente in IndexedDB audio WebM/Opus, configurazione, browser user-agent, sample rate, `audioTimeSec`, beat, RMS, `rawHz`, `trackedHz`, clarity, confidence, voicing, motivo di rigetto e target. Sono presenti test sintetici per tono, soglia RMS, armoniche, MPM/CREPE e guardie d'ottava.

Non sono ancora disponibili: CMND o superficie completa dei candidati v1 nei take; timestamp esplicito del centro della finestra del live; identificativo/misura del microfono e ambiente; export esplicito JSON+audio; annotazione F0/voicing indipendente; misura end-to-end microfono→UI/scoring. Inoltre, dopo il `PitchSmoother`, la confidence salvata per un frame non accettato è azzerata: la clarity e `rawHz` restano, ma non tutta la confidence dell'estimatore raw.

Le metriche visualizzate nell'analisi benchmark calcolano `|1200 log2(f_est/f_target)|` rispetto al target MusicXML. Sono utili per il feedback didattico e per confronti esplorativi a parità di take, ma non distinguono una stonatura reale del cantante da un errore dell'estimatore.

## 3. Principali criticità e ipotesi tecniche

### 3.1 Salti reali confusi con errori di ottava

La regola «salto d'ottava = cinque frame di conferma» riduce alcuni octave flip, ma può ritardare una vera ottava prevista dallo spartito. La frequenza degli animation frame, inoltre, può cambiare sotto carico.

**Direzione:** il tracker può usare la timeline MusicXML per rendere *più plausibile* una transizione attesa, senza imporla. Deve rimanere possibile mostrare e conteggiare una nota sbagliata, anche quando il MusicXML ne prevede un'altra. La nota attesa non deve diventare la misura acustica.

### 3.2 Score con denominatore poco interpretabile

Se i frame non vocalizzati o incerti non contribuiscono al denominatore, una performance frammentaria potrebbe ottenere un'elevata percentuale di intonazione. Separare almeno:

- **Accuratezza condizionata alla presenza di una misura affidabile:** quota di tempo/finestra vocalizzata e valutabile entro la tolleranza.
- **Copertura delle note attese:** quota di tempo musicale atteso per il quale è disponibile una performance attendibile.
- **Non valutato:** durata silenziosa o incerta, esplicitata e non nascosta in uno score aggregato.

Non introdurre penalizzazioni arbitrarie per i frame incerti; distinguere «non sappiamo» da «ha cantato una nota errata». L'eventuale indice riassuntivo va definito e validato con chi cura la didattica musicale.

### 3.3 Vibrato e attacchi

Uno scostamento F0 istantaneo oltre ±30 cent può far oscillare lo score anche con una nota musicalmente centrata. Per le note sufficientemente sostenute, distinguere:

- pitch centrale / tendenza lenta;
- oscillazione periodica del vibrato;
- rumore e octave flip;
- finestra transitoria di attacco, inclusi consonanti e portamenti.

In cent rispetto alla nota obiettivo:

`c(t) = 1200 · log2(f0(t) / f_target(t))`.

Un possibile modello concettuale è `c(t) = μ(t) + v(t) + ε(t)`, con `μ` tendenza lenta, `v` vibrato ed `ε` errore della stima. Non assumere che ogni oscillazione sia vibrato; introdurre la logica solo quando la nota è abbastanza lunga e la F0 è attendibile.

**Architettura consigliata:** traiettoria dettagliata per la visualizzazione, rappresentazione più robusta per lo scoring; nessun filtro che cancelli irreversibilmente il vibrato dalla F0 registrata.

### 3.4 Soglie di qualità e AGC

La `confidence` attuale è un indice euristico, non una probabilità calibrata di correttezza F0. Le soglie di RMS e chiarezza devono essere testate su voci e microfoni diversi. L'AGC può modificare la distribuzione del livello e quindi alterare il termine RMS: verificarne gli effetti e confrontare configurazioni, senza presupporre che disabilitarlo sia sempre meglio.

### 3.5 Audio e UI accoppiati

Il prelievo del buffer a ogni animation frame dipende dalla frequenza di rendering e può diventare irregolare sotto carico o in background. Si suggerisce di separare:

`mic → acquisizione/audio clock → buffer circolare → analisi con hop costante → tracking → stato UI`.

Un `AudioWorklet` può garantire un punto d'ingresso regolare nel grafo audio; **non eseguire automaticamente un DSP costoso nel callback real-time del worklet**. Valutare un worker dedicato, con trasferimento buffer efficiente; usare `SharedArrayBuffer` solo se i requisiti di isolamento della pagina sono soddisfatti e c'è un fallback.

### 3.6 Interferenza dell'accompagnamento

Un rilevatore monofonico non distingue necessariamente una fondamentale proveniente dalla voce da quella proveniente dall'organo o dalla traccia di accompagnamento. Per la fase corrente mantenere le cuffie come raccomandazione; non promettere source separation tramite il solo score-aware tracking.

## 4. Alternative open source da confrontare

Questa sezione propone **candidati**, non un ranking basato su misure del progetto. Verificare stato dei repository, licenze, API e compatibilità browser prima di scegliere.

| Candidato | Ruolo sperimentale | Integrazione e rischi |
|---|---|---|
| **YIN attuale, immutato** | Baseline numerica e comportamentale | Deve rimanere eseguibile per A/B e rollback |
| **YIN ottimizzato / FFT-based difference** | Riduzione del costo, mantenendo metodo interpretabile | Verificare che trasformazioni, ricampionamento e approssimazioni non cambino il comportamento nei bassi |
| **Pitchy / McLeod Pitch Method (MPM)** | Baseline alternativa in JavaScript | Facile prototipazione; confrontare errore d'ottava, voicing e latenza, non solo pitch su note stabili |
| **pYIN (principi o implementazione)** | Candidati F0 con probabilità e tracking temporale | Non assumere che una libreria Python si possa usare direttamente nel browser; costo e latenza da misurare |
| **aubio (YIN, yinfast, yinfft)** | Baseline DSP nativa / potenziale WebAssembly | Verificare porting, licenza e distribuzione prima dell'adozione |
| **CREPE tiny / altro F0 neurale leggero** | Benchmark della robustezza acustica | Integrazione, dimensioni modello, preprocessing, inferenza sul dispositivo, latenza e licenze da verificare |
| **SwiftF0 o equivalenti streaming** | Candidato neurale con pipeline streaming | Distinguere velocità di inferenza da lookahead algoritmico ed effettiva risposta percepita |
| **Basic Pitch** | Riferimento per audio-to-MIDI/trascrizione | Non è una sostituzione diretta del feedback monofonico online con partitura nota |

**Ordine degli esperimenti suggerito:** baseline congelata → alternativa DSP leggera → tracker score-aware → rete neurale soltanto se i risultati giustificano la complessità. Non adottare modelli per novità tecnologica.

## 5. Architettura target proposta

```text
Microfono (mono, browser, locale)
   │
   ▼
Acquisizione audio + timestamp coerenti
   │
   ├── Buffer raw audio / registrazione valutabile
   │
   ▼
F0 estimator intercambiabile
   │   output: timestamp, candidati F0, qualità, voicing, diagnostica
   ▼
Tracker causale
   │   input aggiuntivo: MusicXML + timeline + parte SATB
   │   usa il target come prior debole, non come verità acustica
   ▼
Traiettoria stimata e stato d'incertezza
   │
   ├── Feedback live, bassa latenza
   │
   └── Valutazione musicale separata
          pitch centrale, attacchi, copertura, errori effettivi
```

**Interfaccia logica suggerita** (adattare alle convenzioni del repository):

```ts
type PitchCandidate = {
  hz: number;
  strength: number;        // indice relativo; NON probabilità se non calibrato
};

type PitchFrame = {
  audioTimeSec: number;    // tempo associato al centro/estremo della finestra: documentare
  candidates: PitchCandidate[];
  voiced: boolean | null; // null = incerto
  quality: number;
  rms: number;
};

type TrackedPitch = {
  audioTimeSec: number;
  hz: number | null;
  voicing: 'voiced' | 'unvoiced' | 'uncertain';
  confidence?: number;    // nominare e documentare la semantica
};
```

Preservare **due stream distinti**: ipotesi acustiche grezze e stima filtrata. Entrambi vanno esportabili per il benchmark, con timestamp e configurazione dell'algoritmo. Eventuali cambiamenti nell'API devono essere introdotti dietro adattatori, senza rompere il Practice UX.

### 5.1 Tracker score-aware, senza leakage musicale

Un'opzione è un filtro bayesiano causale o piccolo modello di Markov. Stato concettuale `z_t = (pitch_t, voicing_t)`:

```text
P(z_t | audio_fino_a_t, score)
  ∝ P(osservazione_t | z_t)
    × somma_s [P(z_t | z_{t-1}=s, score)
               × P(z_{t-1}=s | audio_fino_a_{t-1}, score)]
```

Il termine acustico deve poter vincere contro il prior musicale. In particolare:

- un salto previsto può essere confermato più rapidamente **quando l'audio lo supporta**;
- un salto non previsto resta possibile ed è segnalabile come errore;
- nelle pause la voce eventualmente presente non va convertita automaticamente in silenzio;
- dove la F0 è incerta, esplicitare l'incertezza anziché «inventare» la nota prevista;
- non utilizzare il target MusicXML per alterare la F0 prima del calcolo di accuratezza acustica;
- rendere configurabile l'influenza del prior e testarne l'effetto sui **veri errori di intonazione**, non solo su esecuzioni corrette.

Per il feedback online usare un filtro **causale**. Un eventuale Viterbi / smoothing non causale può essere provato nell'analisi **offline** del take, dichiarandone esplicitamente la latenza e la non equivalenza al live.

### 5.2 Coerenza musicale e temporale

Il target deve derivare unicamente dal MusicXML **approvato** e dalla timeline effettiva del playback, non dal PDF/OMR non verificato. Allineare tutti i timestamp (audio clock, playback, target lookup); misurare un eventuale offset del dispositivo o della catena audio.

Per le partiture monodiche, rispettare la convenzione già prevista: soprano/contralto sulla melodia scritta, tenore/basso un'ottava sotto. Non alterare il `.mscz` canonico per rendere coerente il rilevatore.

## 6. Prestazioni: progettazione e misure

**Non confondere** tempo CPU di una stima, ampiezza della finestra, hop, lookahead, ritardo di conferma e latenza end-to-end.

Ipotesi iniziali da *sperimentare*, non impostazioni garantite:

- acquisizione al sample rate nativo e, se utile, resampling antialiasing per un analizzatore a 16 kHz;
- hop audio costante nell'ordine di 10–20 ms;
- finestre eventualmente diverse per voci gravi e acute, senza ridurre il numero di periodi osservati nei bassi;
- rendering UI indipendente dall'hop del DSP;
- DSP CPU leggero in un worker, con `AudioWorklet` dedicato al trasferimento/acquisizione se opportuno;
- soluzione alternativa compatibile con browser/dispositivi senza accelerazione neurale.

Misurare sempre il ritardo **dal cambio acustico effettivo** alla comparsa del pitch corretto nella UI, includendo attacchi e salti di ottava. Riportare mediane, percentili e condizioni hardware. Non scegliere un metodo solo perché «processa più velocemente del real time».

## 7. Piano di benchmark riproducibile

### 7.1 Materiale di test

Usare i take approvati raccolti via `Campione` **solo come materiale disponibile da revisionare**: `self-approved-ground-truth` non equivale a ground truth della F0. Il MusicXML definisce l'intenzione musicale, non la F0 effettivamente prodotta.

Costruire un piccolo set con una reference acustica indipendente: annotazione esperta su sottoinsiemi, riferimento prodotto offline e revisionato, o segnale sintetico con F0 nota. Inserire anche **errori intenzionali** per evitare che il tracker score-aware venga premiato quando nasconde stonature.

Casi da includere:

- soprano, contralto, tenore e basso; note gravi e acute;
- attacchi, consonanti, note brevi, ripetizioni, intervalli ampi e ottave;
- vibrato, portamento, dinamica debole, respirazioni e pause;
- accompagnamento nelle cuffie e, separatamente, leakage da altoparlanti;
- diversi microfoni, browser, condizioni di rumore e carico CPU;
- note erronee volutamente cantate, anche quando il target è chiaro.

### 7.2 Metriche minime

| Dimensione | Metrica |
|---|---|
| F0 acustica | errore assoluto/mediano in cent sui frame vocalizzati con reference |
| Accuratezza | raw pitch accuracy con tolleranza dichiarata; eventualmente overall accuracy |
| Ottave | octave-error rate separato dagli errori generici |
| Voicing | precision/recall, falsi positivi durante il silenzio, durata non valutata |
| Transizioni | latenza mediana e p95 del riconoscimento di nuovi pitch, inclusi salti d'ottava |
| Prestazioni | tempo CPU per hop, uso CPU, memoria, jitter e frame persi |
| Scoring | accuratezza e copertura separate, confronto con valutazioni umane indipendenti |
| Rischio score-aware | frequenza di correzione artificiale di note intenzionalmente sbagliate |

Conservare dati appaiati: stessi input audio, stessa timeline e stessi target per ogni variante. Separare metriche dello **stimatore raw**, del **tracker** e dello **scoring**. Ogni report deve riportare versione del codice, configurazione e dispositivo; evitare conclusioni da pochi esempi scelti a mano.

### 7.3 Esperimenti di ablazione

1. YIN raw attuale vs YIN raw ottimizzato vs Pitchy raw.
2. A parità di stimatore: filtro attuale vs filtro causale alternativo senza spartito.
3. A parità di stimatore: tracker alternativo senza score vs tracker score-aware.
4. Analisi con e senza AGC, quando il browser consente un controllo attendibile.
5. Scoring istantaneo vs scoring robusto su nota, controllando sensibilità ai veri errori.
6. Eventuale modello neurale: beneficio misurato rispetto alla migliore baseline DSP, considerando anche startup, download, memoria e latenza.

## 8. Stato implementativo e prossimi esperimenti

### Già implementato

- baseline v1, telemetria e fixture sintetiche per le guardie d'ottava;
- Benchmark locale con take WebM/Opus e dati frame-by-frame in IndexedDB;
- comparatori offline v2, v3 (YIN multi-candidato), v4 (MPM/NSDF) e v5 (CREPE tiny);
- CREPE live come sonda separata e posterior CREPE audio-only/score-aware solo offline;
- scelta esplicita: v1 rimane l'unico percorso live di feedback e scoring.

### Priorità 1 — rendere l'evidenza valutabile

1. Esportare esplicitamente audio, JSON del take e hash/versione del codice; non inviare mai audio implicitamente.
2. Registrare campioni con timestamp del centro finestra, configurazione completa del tracker e, quando consentito, device/microfono dichiarato.
3. Annotare in modo indipendente piccoli segmenti vocalizzati: on/off voicing, F0 o nota percepita, attacco ambiguo, vibrato, errore intenzionale.
4. Separare nel report deviazione dal target, errore F0 rispetto alla reference, voicing, copertura, salti e latenza.

### Priorità 2 — attribuire la causa dell'imprecisione

1. Riprodurre su stesso audio e stessa reference l'errore raw di YIN, l'effetto del `PitchSmoother` e quello dello scoring.
2. Misurare il jitter del hop RAF, il ritardo finestra→UI e il ritardo di riconoscimento di attacchi, intervalli e ottave vere.
3. Confrontare condizioni pulite, vibrato, consonanti, rumore e leakage; includere gli errori intenzionali E01/E02.
4. Solo dopo scegliere se l'intervento prioritario è: candidati/voicing, tracker, audio clock regolare, oppure un nuovo estimatore.

### Gate di adozione

Una variante può sostituire v1 solo se migliora un compromesso misurato su corpus e dispositivi dichiarati, senza nascondere E01/E02, aumentare la latenza percepita o introdurre dipendenze incompatibili con l'elaborazione locale.

## 9. Vincoli di prodotto e criteri di accettazione

- **Privacy:** tutta l'elaborazione del microfono rimane locale; niente servizi remoti per l'audio senza una decisione di prodotto esplicita.
- **Separazione:** il MusicXML approvato informa la valutazione, ma non diventa un sostituto della misura del canto.
- **Reversibilità:** versione legacy, nuove implementazioni e parametri confrontabili; fallback disponibile.
- **Performance:** le prestazioni vanno misurate end-to-end e sui dispositivi più deboli previsti, non dedotte dal solo costo di una funzione.
- **Correttezza:** i veri errori di nota e ottava devono restare rilevabili; il silenzio e l'incertezza devono essere dichiarati.
- **Compatibilità:** preservare selezione SATB, convenzione delle ottave monodiche, sync playback e source-of-truth MusicXML approvata.
- **Test:** nessun cambiamento nel sistema di scoring senza fixture e test di regressione sulle note errate e sulle pause.

## 10. Domande per l'esperto esterno

1. Considerata la scelta del **primo** minimo CMND sotto 0,42, quale failure mode è più probabile su voce cantata reale: subarmoniche/armoniche, aperiodicità di attacco, formanti o leakage? Quale diagnostica minima permetterebbe di distinguerli?
2. La combinazione di finestra da 4096 campioni, hop RAF variabile, mediana e conferma di 3/5 frame è un compromesso adeguato per tenore/basso e salti melodici? Quali valori o architettura causale suggerirebbe di provare per primi?
3. Come definirebbe voicing, F0 raw e una metrica di accuratezza che non confonda la stonatura del cantante con l'errore dell'estimatore?
4. È preferibile migliorare prima il candidato YIN/voicing, passare a pYIN/MPM/WASM, o impiegare un estimatore neurale streaming? Quale esperimento discriminante a basso costo consiglierebbe?
5. Come separare visualizzazione, feedback immediato e scoring robusto in presenza di attacchi, consonanti, vibrato e portamento?
6. Quali limiti di latenza e quali metriche di transizione sono musicalmente accettabili per il feedback corale live?
7. Il prior score-aware offline è formulato in modo prudente? Quali controlli negativi aggiungerebbe per dimostrare che non corregga artificialmente E01/E02?

### Materiale da allegare alla richiesta

- questo documento e uno snapshot immutabile del codice, in particolare `frontend/pitch_detector.js` e i passaggi microfono/benchmark in `frontend/app.js`;
- audio e JSON di almeno 3–5 take: nota stabile, attacco/consonante, salto reale d'ottava, octave error intenzionale e leakage/rumore;
- browser, sistema operativo, microfono, sample rate, distanza indicativa e impostazioni audio per ogni take;
- segmenti annotati indipendentemente. Il solo MusicXML deve rimanere target musicale, non reference F0;
- risultati separati di v1–v5 sullo stesso materiale, con criterio di associazione temporale dichiarato.

---

### Riferimenti tecnici da verificare durante l'implementazione

- de Cheveigné & Kawahara, **YIN, a fundamental frequency estimator for speech and music**.
- Mauch & Dixon, **pYIN: A Fundamental Frequency Estimator Using Probabilistic Threshold Distributions**.
- McLeod & Wyvill, **A Smarter Way to Find Pitch** (McLeod Pitch Method).
- Kim et al., **CREPE: A Convolutional Representation for Pitch Estimation**.
- Librerie/progetti: **Pitchy**, **aubio**, **CREPE**, **SwiftF0**, **Basic Pitch**.
- **Web Audio API / AudioWorklet** e, per le metriche, **mir_eval.melody**.

*La presenza di un nome in questa lista non implica che licenza, disponibilità, performance o idoneità al browser siano già state verificate per il progetto.*
