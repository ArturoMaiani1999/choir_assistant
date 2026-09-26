# choir_assistant — Audit e piano tecnico per pitch detection e scoring

**Destinatario:** Codex / agente di sviluppo  
**Ambito:** DSP, rilevazione monofonica della frequenza fondamentale (F0), tracking temporale e valutazione dell'intonazione nel browser.  
**Stato del documento:** *audit preliminare basato sulla descrizione dell'architettura fornita dal committente*. **Non è un audit del codice effettivamente ispezionato.** Prima di implementare modifiche, leggere il repository e verificare ogni dettaglio riportato di seguito.

## 1. Contesto e obiettivo

`choir_assistant` è una piattaforma privata di studio corale. Il riferimento musicale canonico è il MusicXML approvato, derivato da un `.mscz` verificato da un amministratore; una timeline di esecuzione collega le note dello spartito al playback. La webapp offre feedback di intonazione per una **singola voce** acquisita dal microfono, idealmente con l'accompagnamento nelle cuffie. L'analisi rimane locale nel browser.

Attualmente `frontend/pitch_detector.js` implementa uno stimatore F0 ispirato a YIN, seguito da regole euristiche di filtraggio e scoring. Il sistema è dichiaratamente un prototipo e il repository conserva una legacy Flutter solo come riferimento.

**Domanda ingegneristica:** come aumentare affidabilità e correttezza musicale del feedback, senza introdurre latenza avvertibile, consumo CPU eccessivo o dipendenza da servizi remoti?

**Indicazione di progetto:** non sostituire subito YIN con un modello neurale. Separare e misurare tre problemi diversi:

1. **Stima acustica F0:** quale fondamentale è supportata dal segnale? È presente voce?
2. **Tracking:** come collegare le ipotesi F0 tra frame senza eliminare salti legittimi, attacchi e vibrato?
3. **Valutazione musicale:** quanto la performance rilevata corrisponde alla nota e al tempo previsti dal MusicXML?

Un miglioramento del numero 2 o del numero 3 non implica necessariamente che il numero 1 sia migliore. Nel benchmark i tre livelli vanno esaminati separatamente.

## 2. Baseline dichiarata da verificare nel codice

| Componente | Comportamento dichiarato |
|---|---|
| Input | Buffer microfonico da 4.096 campioni, letto in corrispondenza degli animation frame; sample rate nativo browser |
| Stima F0 | YIN-style squared difference e cumulative mean normalized difference (CMND), ricerca 70–1.000 Hz |
| Selezione | Primo minimo discendente sotto soglia CMND `0.42`, interpolazione parabolica su tre punti |
| Silenzio | Scarto quando RMS `< 0.001` |
| Qualità | `clarity = 1 - CMND(minimum)`; `confidence` = clarity moltiplicata per un termine di livello saturato a RMS `0.08` |
| Accettazione | Clarity ≥ `0.45`, confidence ≥ `0.30`; tre frame vocalizzati per conferma; rilascio dopo tre frame respinti |
| Filtro | Mediana di tre frame in pitch logaritmico; smoothing esponenziale `α = 0.65` all'avvio e `α = 0.30` dopo |
| Salti | Fino a 300 cent immediati; salti maggiori confermati da tre frame coerenti entro 100 cent; ottave confermate da cinque frame |
| Valutazione | Comparazione con la nota MusicXML attiva dopo un grace period di attacco; «in tune» entro ±30 cent, «centred» entro ±12 |
| Denominatore | Frame non vocalizzati/incerti esclusi dalla percentuale di intonazione |
| Acquisizione | Microfono mono; echo cancellation e noise suppression disabilitati; automatic gain control abilitato |

**Attenzione:** la selezione di un minimo con CMND `< 0.42` implica già una clarity `> 0.58`, se quella stessa CMND viene usata anche nel controllo successivo. In questo percorso la soglia `clarity ≥ 0.45` è quindi ridondante. Verificare se esistano fallback che invalidano tale conclusione: non rimuovere la soglia senza ispezione.

Una finestra di 4.096 campioni rappresenta circa 85,3 ms di audio a 48 kHz. **La durata della finestra non coincide automaticamente con la latenza end-to-end:** quest'ultima comprende acquisizione, scheduling dei frame, elaborazione, conferma del tracking e rendering. Va misurata empiricamente.

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

## 8. Roadmap operativa per Codex

### Fase 0 — Ispezione e baseline **prima delle modifiche**

- Leggere `frontend/pitch_detector.js` e le sue chiamate dalla Practice UI, il sistema di score/timeline e la gestione del microfono.
- Leggere `docs/LEGACY_PITCH_TRACKING_AUDIT.md`, `docs/PRACTICE_UX_SPEC.md`, `docs/PRACTICE_REDESIGN_PLAN.md`, `docs/PLAYBACK_SYNC_AUDIT.md`, `docs/IMPLEMENTATION_PLAN.md`.
- Confermare nel codice tutti i dettagli della sezione 2; segnalare discrepanze e dipendenze nascoste.
- Identificare dove sono applicati grace period, matching delle note, calcolo denominatore, gestione pause e trasposizione di ottava delle parti monodiche.
- Definire **una sola** fonte di timestamp e un metodo per misurare la latenza end-to-end.
- Congelare una baseline riproducibile: test esistenti, fixture, parametri, risultati e commit di riferimento.

**Deliverable:** nota tecnica sintetica con mappa dei moduli, rischi reali verificati e piano di modifica minimo. Nessun cambio comportamentale in questa fase.

### Fase 1 — Osservabilità e benchmark

- Estrarre una API di stima F0 utilizzabile offline sullo stesso PCM del live, oppure aggiungere un adapter equivalente.
- Salvare nei test raw F0/candidati, CMND/quality, RMS, pitch filtrato, target e timestamp senza sovrascrivere i valori iniziali.
- Inserire fixture sintetiche deterministiche: sinusoidale, segnale armonico, silenzio, cambi di nota, salti d'ottava, vibrato controllato.
- Aggiungere metriche separate per errore acustico, voicing, lag, scoring e copertura.
- Mantenere i take in IndexedDB locale; non introdurre upload impliciti né invio del microfono a terzi.

**Deliverable:** comando/test ripetibile con risultati in formato machine-readable e tabella A/B.

### Fase 2 — Miglioramenti DSP a basso rischio

- Profilare la differenza YIN e il tempo per frame sui dispositivi obiettivo.
- Sperimentare decimazione con filtro antialiasing, finestre e hop, preservando le voci gravi.
- Valutare un comparatore JavaScript indipendente (es. Pitchy/MPM) dietro la stessa interfaccia.
- Eliminare soglie ridondanti **solo dopo** aver verificato il relativo percorso esecutivo.
- Se utile, spostare l'acquisizione su audio clock regolare senza bloccare il real-time audio thread.

**Gate:** adottare una variante soltanto con evidenza di un compromesso migliore tra precisione, latenza e costo, non perché più sofisticata.

### Fase 3 — Tracker e scoring musicale

- Implementare una modalità tracker alternativo *feature-flagged*, senza sovrascrivere il tracker legacy.
- Introdurre target e transizioni consentite come prior **debole** nel tracking.
- Preservare la F0 raw, il disaccordo col target e l'incertezza.
- Separare accuratezza condizionata, copertura e non-valutato.
- Considerare un riassunto robusto del pitch centrale per note sostenute; non usarlo automaticamente per note brevi.
- Testare casi di note sbagliate e di ottave sbagliate, in particolare quando lo score-aware tende a ricondurre l'ipotesi al target.

**Gate:** il tracker deve migliorare stabilità/lag *senza* ridurre la capacità di rilevare errori musicali reali.

### Fase 4 — Benchmark neurale opzionale

- Prototipare fuori dal percorso UI un piccolo modello F0 neurale solo dopo aver misurato le baseline DSP.
- Confrontare su input identici, includendo load time, memoria, inferenza, lookahead, latenza totale e browser supportati.
- Verificare licenze e distribuzione dei pesi, non solo del codice.
- Mantenere il detector DSP come fallback se la rete è troppo pesante o non supportata.

**Gate:** integrare in produzione solo se il miglioramento è significativo per gli scenari reali di canto e non deteriora l'esperienza live sui dispositivi obiettivo.

## 9. Vincoli di prodotto e criteri di accettazione

- **Privacy:** tutta l'elaborazione del microfono rimane locale; niente servizi remoti per l'audio senza una decisione di prodotto esplicita.
- **Separazione:** il MusicXML approvato informa la valutazione, ma non diventa un sostituto della misura del canto.
- **Reversibilità:** versione legacy, nuove implementazioni e parametri confrontabili; fallback disponibile.
- **Performance:** le prestazioni vanno misurate end-to-end e sui dispositivi più deboli previsti, non dedotte dal solo costo di una funzione.
- **Correttezza:** i veri errori di nota e ottava devono restare rilevabili; il silenzio e l'incertezza devono essere dichiarati.
- **Compatibilità:** preservare selezione SATB, convenzione delle ottave monodiche, sync playback e source-of-truth MusicXML approvata.
- **Test:** nessun cambiamento nel sistema di scoring senza fixture e test di regressione sulle note errate e sulle pause.

## 10. Istruzioni operative da passare a Codex

> Esamina prima il repository e verifica le assunzioni di questo audit: il documento deriva da una descrizione, non da una lettura diretta del codice. Non avviare un refactor indiscriminato e non aggiungere nuovi framework senza una necessità misurata. Parti dalla **Fase 0**: mappa il flusso microfono → F0 → tracking → timeline/target → scoring → UI; identifica le regole effettive e i punti di latenza; segnala le discrepanze rispetto alla baseline riportata. Poi proponi la minima sequenza di modifiche verificabili per costruire benchmark e comparatori, preservando la modalità esistente. Se passi all'implementazione, lavora per piccoli commit logici con test e risultati misurabili. Priorità: evitare falsi errori di ottava, riconoscere i salti reali, trattare correttamente vibrato e silenzio, preservare i veri errori del cantante, mantenere una bassa latenza percepita. Non sostituire YIN con una rete neurale prima di aver stabilito e misurato la baseline.

---

### Riferimenti tecnici da verificare durante l'implementazione

- de Cheveigné & Kawahara, **YIN, a fundamental frequency estimator for speech and music**.
- Mauch & Dixon, **pYIN: A Fundamental Frequency Estimator Using Probabilistic Threshold Distributions**.
- McLeod & Wyvill, **A Smarter Way to Find Pitch** (McLeod Pitch Method).
- Kim et al., **CREPE: A Convolutional Representation for Pitch Estimation**.
- Librerie/progetti: **Pitchy**, **aubio**, **CREPE**, **SwiftF0**, **Basic Pitch**.
- **Web Audio API / AudioWorklet** e, per le metriche, **mir_eval.melody**.

*La presenza di un nome in questa lista non implica che licenza, disponibilità, performance o idoneità al browser siano già state verificate per il progetto.*
