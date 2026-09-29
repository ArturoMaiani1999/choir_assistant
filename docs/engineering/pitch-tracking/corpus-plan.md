# Piano di registrazione benchmark — voce tenore

Stato: MVP di acquisizione locale implementato; comparatori e analisi offline
restano da realizzare. Questo documento definisce come acquisire un primo
corpus locale e riproducibile con la voce del proprietario del progetto. La
modalità non modifica detector, scoring o il normale flusso di Practice.

## Obiettivo

Costruire un set di registrazioni realistico per confrontare lo stimatore F0,
il tracker e lo scoring, partendo da una voce tenorile intonata e controllata.
Il corpus deve consentire di rispondere a domande misurabili:

- quanto è accurata la F0 grezza su canto reale;
- con quale ritardo vengono riconosciuti attacchi e cambi di nota;
- quante ottave false, dropout e falsi vocalizzati produce ogni variante;
- se tracking e scoring segnalano ancora errori intenzionali invece di
  ricondurre artificialmente la voce alla nota scritta.

Le registrazioni saranno dette **take di riferimento eseguiti da esperto**.
Non sono automaticamente ground truth acustica campione per campione: lo
spartito descrive l'intenzione, mentre vibrato, attacco e intonazione effettiva
vanno conservati e, per campioni selezionati, revisionati indipendentemente.

## Decisione UX: sì a una modalità esplicita

Introdurre una modalità dedicata, non un semplice uso del pulsante **Campione**.
Nome proposto: **Benchmark voce**; azione primaria: **Registra take**.

Motivo: un take di benchmark richiede metadati, protocollo, stato della
registrazione e immutabilità dei parametri che non devono essere confusi con
un normale esercizio o con un campione che l'utente considera riuscito.

Il pulsante deve essere visibile solo in una sezione diagnostica/di sviluppo
(ad esempio accanto a `Campione`, o dentro il suo dialog), non nella barra
principale del percorso normale di prova. Aprendolo, il dialog mostra:

1. selettore di scenario e ripetizione;
2. parte, brano, battute e versione dello score, bloccati per il take;
3. checklist cuffie/microfono e livello del segnale;
4. un'azione primaria `Registra e avvia dal principio`, che arma il microfono,
   inizia il take, chiude il dialog e avvia il playback;
5. una barra persistente `Interrompi take` visibile sopra la prova durante la
   registrazione, seguita da `Ascolta`, `Accetta` e `Scarta` al termine;
6. indicatore inequivocabile di registrazione e di take non ancora approvato.

La modalità non deve cambiare il detector né applicare un prior dello spartito:
deve osservare e salvare. Tutti i dati restano in IndexedDB sul browser salvo
un futuro comando esplicito di esportazione; nessun upload implicito.

## Regola di acquisizione

Per ogni take registrare contemporaneamente l'audio PCM/originale disponibile
e la telemetria del detector corrente. La registrazione deve usare un solo
clock documentato (tempo audio in secondi), e associare a ogni frame il punto
della finestra a cui il timestamp si riferisce.

Conservare almeno:

```text
take ID, scenario ID, ripetizione, data/ora
piece ID, part ID, intervallo di battute, score version ID, timeline hash
browser, sistema operativo, device/microfono dichiarato, sample rate
impostazioni getUserMedia (AGC, noise suppression, echo cancellation)
versione/codice/configurazione di estimatore e tracker
audio registrato e suo hash
timestamp audio, RMS, F0 raw, qualità/clarity, voicing, candidati se presenti
F0 tracciata, stato di incertezza, target al frame, decisione di scoring
azione finale: accettato, scartato, annotato; note libere
```

Raw F0 e pitch filtrato devono essere due stream distinti e non sovrascritti.
Una nuova esecuzione dello stesso algoritmo deve produrre un nuovo risultato
derivato, mai riscrivere la telemetria originale del take.

## Preparazione dell'ambiente

Fissare una configurazione per una sessione intera e registrarla nei metadati:

- cuffie cablate o Bluetooth documentato; nessun altoparlante per le condizioni
  “pulite”;
- stesso microfono, distanza indicativa (es. 15–20 cm) e guadagno del sistema;
- browser e versione annotati; chiudere applicazioni che possono usare il
  microfono;
- ambiente ragionevolmente silenzioso; annotare rumore o riverbero insoliti;
- una prova di livello e una nota tenuta prima della sessione;
- non normalizzare, ridurre il rumore o modificare il file audio dopo la
  registrazione. Ogni elaborazione offline è un derivato separato.

Registrare poi una seconda condizione controllata con leakage da altoparlante o
rumore moderato: serve a misurare la fragilità reale, non a contaminare il set
pulito.

## Scenari iniziali

Ogni scenario ha un ID stabile, un intervallo fissato di brano/battute e almeno
tre ripetizioni. Registrare prima condizioni pulite, poi quelle difficili.

| ID | Scenario | Istruzione di esecuzione | Cosa misura |
|---|---|---|---|
| T01 | Note tenute | Vocali su 3–5 note del registro tenore | F0 stabile, errore in cent, voicing |
| T02 | Scala e gradi congiunti | Legato e staccato, salita/discesa | transizioni piccole e latenza |
| T03 | Intervalli reali | Frasi del repertorio con salti | tracker causale e attacchi |
| T04 | Ottave | Salti reali di ottava, se nel range comodo | octaves vere vs octave flip |
| T05 | Note brevi e consonanti | Passaggio cantato con testo | onset, dropout e grace period |
| T06 | Vibrato e note sostenute | Naturale, senza forzarlo | robustezza dello scoring |
| T07 | Pause e respirazioni | Frase con silenzi reali | falsi vocalizzati e copertura |
| E01 | Nota errata intenzionale | una nota a ±1 o ±2 semitoni | rilevazione di errori reali |
| E02 | Ottava errata intenzionale | una frase a ottava sbagliata | leakage dello score-aware tracking |
| E03 | Intonazione controllata | circa ±20, ±35 e ±60 cent, se ripetibile | calibrazione della tolleranza |
| N01 | Leakage/rumore | stessa frase, condizione annotata | robustezza non ideale |

Gli errori intenzionali non sono “take peggiori”: sono controlli negativi
necessari. In particolare E01 ed E02 impediscono di dichiarare buono un tracker
che segue lo spartito anziché l’audio.

## Sessione consigliata

Una sessione breve e ripetibile è preferibile a una lunga e affaticante.

1. Creare una sessione con ID e confermare ambiente/dispositivo.
2. Registrare 10–15 secondi di silenzio e una nota test: controllo qualità,
   non materiale musicale.
3. Registrare T01–T07, tre take per scenario; riascoltare subito e annotare
   tosse, errore di avvio o difetto tecnico.
4. Registrare E01–E03 come take distinti ed esplicitamente etichettati.
5. Salvare/accettare solo i take completi; scartare quelli tecnicamente
   inutilizzabili senza cancellare automaticamente il log dell'azione.
6. Terminare con una nota di calibrazione uguale a quella iniziale per rilevare
   cambi di setup o affaticamento.

Non inseguire subito la perfezione: le tre ripetizioni consentono di stimare la
variabilità intra-cantante. Eventuali take “quasi perfetti” vanno marcati come
tali, non promossi automaticamente a verità.

## Riferimento e annotazione

Usare tre forme complementari di riferimento:

1. **Sintetico con F0 nota** per validare esattamente lo stimatore raw.
2. **Score/timeline approvati** per definire target, attacchi e pause musicali.
3. **Revisione umana indipendente** di segmenti scelti delle registrazioni
   tenorili, preferibilmente con ascolto e visualizzazione della F0 raw.

La revisione annota almeno inizio/fine vocalizzato, nota musicale percepita,
eventuale errore intenzionale, attacco ambiguo e vibrato. Non deve usare
l'output del tracker score-aware come fonte di verità.

## Criteri di qualità prima dell'analisi

Un take è utilizzabile se audio, score-version, configurazione e frame log sono
presenti, coerenti temporalmente e riproducibili. Segnalare separatamente:

- audio troppo debole o saturato;
- permesso/dispositivo cambiato durante la sessione;
- accompagnamento udibile nel microfono;
- take interrotto o battute/timeline sbagliate;
- errore vocale non previsto dal relativo scenario.

Un take può restare nel corpus ma essere escluso da una specifica metrica; non
va cancellato per far apparire migliori i risultati.

## Report e gate sperimentali

Per ogni variante confrontare gli stessi audio e gli stessi intervalli.
Riportare separatamente F0 raw, tracker e scoring:

- mediana/p95 dell'errore assoluto in cent sui segmenti revisionati;
- precisione/recall del voicing e durata “incerta/non valutata”;
- octave-error rate;
- latenza mediana e p95 su attacchi, intervalli e ottave;
- copertura, accuratezza condizionata e risultati sulle note volutamente errate;
- CPU, memoria e jitter, oltre alla sola velocità della funzione.

Una variante può sostituire la baseline solo se migliora un compromesso misurato
senza peggiorare la capacità di vedere E01/E02, la privacy locale o la latenza
percepita. La baseline YIN e i suoi parametri restano sempre selezionabili per
un confronto A/B e rollback.

## Stato dell'implementazione e prossimi passi

L'MVP implementato fornisce il pulsante diagnostico `Benchmark`, il dialog con
scenari/ripetizioni/checklist, registrazione WebM/Opus dal microfono, telemetria
per frame e salvataggio dei take/sessioni in IndexedDB. Ogni take ha il formato
versionato `tenor-benchmark-take-v1` e conserva stream raw/tracciato, target,
timestamp e configurazione del detector. Può essere ascoltato, accettato o
scartato prima del salvataggio. I take accettati sono elencati localmente e si
aprono in una pagina interna a schermo intero: il piano roll mostra il tracking
v1 sovrapposto ai target, sincronizzato alla riproduzione dell'audio. Futuri
algoritmi useranno la stessa superficie per confronti visivi sul medesimo take.

Restano, in quest'ordine:

1. test deterministici per il formato `BenchmarkTake` e l'upgrade IndexedDB;
2. export esplicito JSON + audio per l'analisi offline;
3. strumenti di revisione/annotazione di segmenti selezionati;
4. comparatore di detector sulla stessa registrazione;
5. report automatico delle metriche e dei gate descritti sopra.

Questo ordine mantiene Practice utilizzabile e rende ogni passo verificabile.
