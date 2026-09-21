# Piano di implementazione — robustezza agli errori d'ottava

## Obiettivo

Ridurre gli sbalzi spurii di ±1 ottava nel pitch tracking browser-local senza
introdurre dipendenze DSP, senza forzare artificialmente la voce sulla nota
scritta e con una latenza aggiuntiva contenuta.

Il punto di intervento primario è `frontend/pitch_detector.js`, in particolare
`PitchSmoother`: il detector YIN continua a produrre una stima per frame, mentre
il smoother decide se quella stima è abbastanza coerente da essere esposta alla
UI e usata dallo scoring.

## Stato di partenza

- detector YIN-style con intervallo 70–1000 Hz;
- soglia RMS, clarity e confidence già disponibili;
- interpolazione parabolica del periodo;
- smoothing EMA nello spazio dei semitoni;
- stabilizzazione dopo 3 frame voiced e rilascio dopo 3 frame unvoiced.

Limite attuale: una stima YIN errata di un'ottava viene passata all'EMA; essa
viene quindi solo attenuata, non rigettata. I picchi possono apparire sia verso
l'alto sia verso il basso.

## Principio di prodotto

Un frame ambiguo deve risultare **non affidabile**, non essere corretto per
farlo sembrare intonato. La nota target può essere usata come contesto leggero
per scegliere tra candidati equivalenti, ma non deve imporre il pitch rilevato.

Tenere separati:

1. `rawHz`: stima non filtrata del detector;
2. `displayHz`: stima stabilizzata mostrata nella lane;
3. `scoringHz`: stima valida per il punteggio; assente quando il frame è
   ambiguo o non sufficientemente affidabile.

Nella prima iterazione `displayHz` e `scoringHz` possono coincidere, purché il
contratto dell'output renda esplicita la qualità del frame.

## Fase 1 — metriche e fixture prima della modifica

### 1.1 Estendere il contratto di output

Aggiungere al risultato di `PitchSmoother.update()`:

- `rawHz` e `rawSemitone`;
- `hz`/`displayHz` stabilizzati;
- `accepted`: il frame è stato accettato dal filtro;
- `rejectionReason`: `unvoiced`, `low-confidence`, `octave-transition`,
  `large-jump-transition` o `null`;
- `candidateFrames`: numero di frame consecutivi per il cambio in attesa.

Non modificare ancora la UI: l'obiettivo è poter verificare le decisioni del
filtro in test e, in seguito, nei log diagnostici opzionali.

### 1.2 Aggiungere test deterministici

Creare o estendere una suite Node per `pitch_detector.js` con sequenze di
stime sintetiche. Non serve simulare il microfono per verificare il filtro di
continuità.

Casi minimi:

| Caso | Input | Atteso |
|---|---|---|
| Nota stabile | 440 Hz ripetuti | valore stabile dopo la warm-up |
| Picco alto isolato | 440, 880, 440 Hz | non pubblicare 880 Hz |
| Picco basso isolato | 440, 220, 440 Hz | non pubblicare 220 Hz |
| Ottava reale | 440 Hz, poi 880 Hz per N frame | cambio dopo conferma |
| Salto melodico non d'ottava | 440 → 493.88 Hz | cambio rapido |
| Glissando | progressione graduale | nessun freeze artificiale |
| Vibrato | ±20–40 cents | traccia fluida, senza falsi rigetti |
| Voce incerta | clarity/confidence bassa | nessun pitch valido |
| Silenzio e rientro | null, poi 440 Hz | rispettare release e warm-up |

Registrare per ogni scenario: frame di accettazione, pitch pubblicato,
rejection reason e massima deviazione in cents.

## Fase 2 — filtro robusto ma leggero

### 2.1 Lavorare nello spazio dei semitoni

Convertire ogni stima in semitoni relativi ad A4:

`s = 12 × log2(hz / 440)`

Le distanze, inclusa l'individuazione dell'ottava, vengono calcolate in cents
o semitoni: non confrontare direttamente differenze in Hz.

### 2.2 Mediana corta anti-spike

Conservare gli ultimi 3 pitch raw validi e calcolarne la mediana in semitoni.
Usare questa mediana come input dell'EMA esistente.

- finestra iniziale: 3 frame;
- escludere frame sotto la soglia minima di confidence;
- non interpolare attraverso frame unvoiced;
- conservare la mediana soltanto per il filtro, mai come presunto pitch raw.

La mediana elimina gli spike singoli con costo computazionale trascurabile e
con una latenza pratica di un frame.

### 2.3 Stato candidato e isteresi

Introdurre nello smoother:

- `stableSemitone`: ultimo valore accettato;
- `candidateSemitone`: nuovo valore in attesa di conferma;
- `candidateFrames`: frame consecutivi coerenti con il candidato.

Proposta di parametri iniziali, tutti configurabili dal costruttore:

| Parametro | Valore iniziale | Significato |
|---|---:|---|
| `smallJumpCents` | 300 | movimento accettabile immediatamente |
| `octaveCenterCents` | 1200 | centro dell'errore da riconoscere |
| `octaveToleranceCents` | 180 | ampiezza della fascia ±1 ottava |
| `octaveConfirmFrames` | 5 | frame coerenti necessari per il cambio d'ottava |
| `largeJumpConfirmFrames` | 3 | frame per altri salti ampi |
| `candidateConsistencyCents` | 100 | distanza massima fra frame candidati |
| `medianWindowFrames` | 3 | dimensione della mediana |

Logica per ogni frame voiced e affidabile:

1. calcolare la mediana locale in semitoni;
2. calcolare la distanza dalla stima stabile;
3. se la distanza è entro `smallJumpCents`, aggiornare subito il valore stabile
   tramite EMA e azzerare il candidato;
4. se la distanza è nella fascia di ±1 ottava, avviare o aggiornare il
   candidato e non cambiare il valore pubblicato;
5. se è un salto ampio diverso dall'ottava, chiedere una conferma più breve;
6. quando il candidato raggiunge il numero necessario di frame coerenti,
   promuoverlo a stabile e riprendere l'EMA;
7. se il candidato non è coerente o ritorna vicino alla nota stabile,
   scartarlo.

Durante l'attesa: mantenere la precedente `displayHz` solo per la continuità
visiva, ma impostare `accepted: false`. Lo scoring non deve assegnare punti al
frame trattenuto.

### 2.4 Gate qualità

Prima della logica di continuità, trattare come unvoiced o non accettabile un
frame con clarity/confidence sotto soglie configurabili. La confidence è un
segnale di ammissione, non un moltiplicatore sufficiente a legittimare una
stima tonalmente implausibile.

Valori iniziali da calibrare su device reali:

- `minClarityForTracking: 0.45`;
- `minConfidenceForTracking: 0.30`;
- RMS invariato nella prima iterazione.

## Fase 3 — integrazione nella UI e nello scoring

1. In `frontend/app.js`, usare solo `estimate.stable && estimate.accepted` per
   aggiungere un punto alla traccia e calcolare cents/readout.
2. Se il filtro sta confermando un salto, non aggiungere un campione nuovo: la
   traiettoria evita segmenti verticali fittizi.
3. Conservare, dietro un flag diagnostico, raw pitch, pitch accettato,
   clarity/confidence e motivo del rigetto. Non esporli nell'interfaccia del
   corista per default.
4. Aggiornare `docs/PITCH_DETECTION_VALIDATION.md` con parametri, semantica di
   `accepted` e limiti noti.

## Fase 4 — miglioramento opzionale: candidati YIN equivalenti

Se gli spike persistono, estendere `detectPitch()` per individuare più minimi
locali della CMND, non solo il primo sotto soglia. Per ogni candidato valido,
calcolare qualità e frequenze equivalenti `f/2`, `f`, `2f` entro il range.

Il smoother sceglie il candidato con costo minimo:

`costo = penalitàCMND + pesoContinuità × distanzaDaStable`

Se un target è disponibile, aggiungere al massimo una penalità debole e
configurabile per la distanza dal target. Questa fase è separata perché cambia
il contratto fra detector e smoother e richiede fixture audio più ricche.

## Fase 5 — validazione su audio e dispositivi

### Fixture audio

Preparare campioni di breve durata per:

- sinusoidi e vocali sintetiche a 110, 220, 440 e 880 Hz;
- nota con armonica dominante che induce fondamentale/ottava errata;
- transizioni di ottava reale;
- vibrato e glissando;
- rumore e leakage della guida;
- attacchi consonantici e silenzi.

### Metriche di accettazione

- zero picchi isolati di ±1 ottava nei test sintetici;
- cambio d'ottava reale riconosciuto entro 150 ms dal tratto stabile;
- nessun peggioramento superiore a 30 ms della latenza percepita per movimenti
  piccoli;
- mediana dell'errore assoluto in cents invariata o migliore;
- riduzione misurabile dei frame con errore oltre 700 cents;
- nessuna regressione su vibrato, glissando o rientro dopo silenzio.

Testare almeno Chrome e un secondo browser, con microfono integrato e un input
esterno se disponibile. Usare cuffie durante il test di leakage.

## Sequenza di consegna

1. Test di unità per le sequenze di stime e nuovo contratto diagnostico.
2. Mediana a 3 frame + gate qualità.
3. Macchina a stati candidato/isteresi e taratura dei parametri.
4. Collegamento di `accepted` a grafico, readout e scoring.
5. Fixture audio, benchmark browser/device e calibrazione.
6. Solo se necessario, selezione multi-candidato nel detector YIN.

## Fuori scope di questa iterazione

- sostituzione completa di YIN con un modello ML;
- AudioWorklet/WASM: utile per carico e latenza, ma non necessario per provare
  la logica anti-ottava;
- quantizzazione del pitch alla nota target;
- modifica dell'algoritmo di scoring musicale oltre alla gestione esplicita dei
  frame incerti.
