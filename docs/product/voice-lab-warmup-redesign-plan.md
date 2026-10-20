# “Allena la tua voce”: piano di riprogettazione

**Status:** implementato e verificato; contratto corrente  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Scopo del documento

Questo documento definisce il rifacimento dell'area **Allena la tua voce** come
strumento per:

1. riscaldare la voce con brevi pattern tonali;
2. allenare scale e arpeggi maggiori/minori a velocità controllata;
3. passare gradualmente dall'imitazione sonora alla costruzione mentale degli
   intervalli;
4. misurare intonazione, stabilità e precisione ritmica senza trasformare il
   riscaldamento in un esame.

Il documento nasce come proposta e ora registra il contratto implementato. Le
estensioni future restano separate dai requisiti dell'MVP corrente.

## Stato di implementazione

L'ingresso **Allena la voce** è una delle tre modalità del menù principale,
visibile senza scroll a 390×844. Non richiede la scelta preventiva di un brano
o della modalità di ascolto. Il menù esercizi torna al **Menù** dell'app.
Indietro/Avanti del browser attraversano scelta e preparazione; uscire da un
take ferma audio e microfono. Avanti ripristina la preparazione e non avvia
una registrazione. BPM e variante scelti restano associati alla preparazione.
La preferenza SATB del profilo viene usata anche nel laboratorio; estensione
personalizzata e impostazioni specifiche restano disponibili nel laboratorio.

Il rifacimento è stato completato il 2026-10-14:

- il vecchio catalogo di attività non è più raggiungibile né incluso nella
  build;
- scala, arpeggi alternati e orecchio interno usano il nuovo schema v2;
- gli arpeggi possono essere eseguiti in stato fondamentale, primo rivolto,
  secondo rivolto oppure come routine completa delle tre posizioni;
- l'orecchio interno include richieste casuali di un grado singolo, con livello
  base diatonico e livello avanzato cromatico;
- l'interfaccia desktop e mobile usa una timeline comune per audio, score,
  piano roll e analisi;
- la banca pubblica contiene quattordici campioni Muse Sounds Choir per i cue
  variabili, centoventi frasi complete guidate, otto pad e ottantotto frammenti
  di spartito incisi da MuseScore;
- scale e arpeggi guidati usano una singola interpretazione legata, con
  fraseggio e dinamica renderizzati da MuseScore; non ricominciano il campione
  a ogni nota;
- i cue campionati condividono una breve risposta d'ambiente nel browser, così
  la coda della nota precedente può convivere con l'attacco successivo;
- la plume usa l'anticipo condiviso di 270 ms e conserva sul piano roll tutta
  la storia della take, senza dissolvere i segmenti più vecchi;
- il vecchio documento didattico è stato archiviato.

Revisione didattica del 19 ottobre 2026:

- ogni preparazione mette in primo piano lo spartito e una spiegazione concreta:
  Fa è la nota 1; nella scala si sale fino a 5 e si torna a 1;
- il pentagramma con note reali e numeri resta visibile anche in Orecchio
  interno, fin dall'inizio. Questa richiesta sostituisce la precedente politica
  del template con soli gradi; soltanto il confronto sul piano roll resta nascosto;
- il comando testuale `Esercizi` torna alla scelta dei percorsi anche durante
  canto e risultato. `Prepara` torna alla configurazione. L'uscita interrompe
  audio e microfono e non salva la prova incompleta;
- la preparazione spiega anche arpeggi, nota singola e nota iniziale dei rivolti;
  la dimostrazione è disponibile in `Istruzioni` e le posizioni dell'accordo
  sono espandibili;
- scala e accordi richiedono la stessa voce guida renderizzata come frase legata
  e, se attivo, il pad armonico. Un download fallito mostra un errore con la
  possibilità di riprovare, invece di degradare silenziosamente il timbro o
  eliminare l'accompagnamento. Anche per estensioni personalizzate, una frase
  non presente nella banca viene segnalata e non sostituita con campioni separati;
- la preparazione usa impaginazione senza card, spartito avorio e controlli
  laterali su desktop; su mobile li dispone in sequenza con `Comincia` in basso.
  Le opzioni espanse possono richiedere scorrimento intenzionale.

Verifica della revisione: browser smoke a 1366×768 e 390×844, screenshot dei
quattro tipi di preparazione, canto/risultato e controllo della banca audio.

### Preparazione e istruzioni del 20 ottobre 2026

Il contratto corrente sostituisce le precedenti indicazioni di preparazione
mobile a scorrimento: scala, accordi e orecchio interno stanno nel primo
viewport a **1366×768** e **390×844**, con spartito dominante, velocità
e `Comincia` sempre raggiungibili. Il ritorno `Esercizi` è testuale; i pulsanti
precedente/successivo sono eliminati. Le impostazioni usano soltanto un
ingranaggio con nome accessibile. Non compaiono più i tre passi statici,
`Come leggo lo spartito?` e la nota sull'attivazione del microfono.

La revisione visiva del 20 ottobre usa il fondo inchiostro già presente,
con note e pentagramma bianco caldo, anche durante canto e nelle istruzioni.
Questa scelta sostituisce intenzionalmente il foglio avorio nel laboratorio
per ridurre la luminosità. Lo spartito di preparazione ha altezza compatta
(260 px desktop, fino a 190 px mobile), senza estendersi per riempire lo schermo;
velocità e `Comincia` seguono la musica senza vuoti artificiali. L'SVG inciso
resta invariato: il foglio bianco delle immagini viene reso trasparente con
un filtro, mentre nella dimostrazione i tracciati chiari mantengono l'ocra
per la nota attiva. Dimensioni dei controlli e assenza di scroll sono preservate.

`Istruzioni` apre un dialogo HTML/SVG e avvia una sola dimostrazione, usando
spartito, parte vocale, BPM e rivolto selezionati:

1. la chiave compie piccoli salti balistici con gravità `0,75 × 9,8 m/s²`
   mentre si ascolta la frase Muse Choir; le note restano spente;
2. il 4/4 salta sui quattro battiti di preparazione e quattro pallini sopra
   il pentagramma indicano l'ingresso;
3. `Segui le note`: la melodia Muse Choir viene riprodotta insieme al metronomo
   e le note diventano ocra una alla volta. Non compare la frase «Canta su la».
   Il microfono resta spento e non si produce un risultato.

Per Orecchio interno si ascolta soltanto la fondamentale, senza anticipare la
melodia; il grado singolo resta evidenziato per i suoi quattro battiti.
La coda naturale della frase termina prima del count-in e della fine della
dimostrazione. Un clock AudioContext
comune governa suono ed evidenziazioni. Con movimento ridotto i salti sono
eliminati, mantenendo fasi, battiti ed evidenziazione delle note.

Al termine è disponibile `Rivedi`. Chiusura esplicita, Escape e backdrop fermano
immediatamente l'audio e restituiscono il focus a `Istruzioni`. Anche uscita
dalla pagina e passaggio in background fermano la dimostrazione; un download
tardivo non può riattivarla. Gli errori offrono `Riprova`.

Eccezione intenzionale di accessibilità: a ingrandimenti del testo o altezze
inferiori ai viewport di verifica, contenuto e controlli restano raggiungibili
con scorrimento invece di essere tagliati. Le impostazioni e i dettagli del
risultato mantengono il proprio scorrimento quando necessario.

Verifica: `python scripts/browser_voice_lab_instructions_smoke.py`, smoke
esistente del laboratorio e della navigazione; screenshot in
`artifacts/voice-lab-instructions-*.png` e `artifacts/voice-lab-{scale,chords,ear,degree}-*.png`.

Evidenza automatica:

- `node frontend/voice_lab_core.test.js`;
- `python scripts/build_voice_lab_assets_test.py`;
- `python -m unittest scripts.check_voice_lab_artifacts_test`;
- `python scripts/check_voice_lab_artifacts.py`;
- `python scripts/browser_voice_lab_smoke.py`;
- `python scripts/build_dist.py`.

## Decisione di prodotto proposta

La precedente esperienza centrata su `Trova la nota`, riconoscimento di
intervalli, canto di due note e disegno vocale viene eliminata integralmente e
sostituita da una struttura più semplice e coerente:

- **Riscaldamento con modello**: la melodia è ascoltata prima alla stessa velocità scelta;
  durante il canto restano la fondamentale e il metronomo, mentre il target è
  visibile;
- **Orecchio interno**: si ascolta soltanto la fondamentale e si leggono note e
  gradi sul pentagramma; il confronto dell'intonazione sul piano roll appare dopo;
- **Trasposizione controllata**: dopo ogni scala l'utente decide se riprovare,
  salire di un semitono o terminare, sempre entro l'estensione dichiarata.

Questa è una riscrittura del modello didattico e dell'interfaccia, non una
riscrittura indiscriminata della tecnologia. È opportuno conservare i componenti
già verificati che non incorporano la vecchia didattica:

- acquisizione del microfono e pitch detector;
- smoothing e plume della voce rilevata;
- clock basato su `AudioContext`;
- profilo vocale SATB ed estensione personalizzata;
- registrazione locale della take;
- generazione MusicXML/MuseScore/SVG;
- funzioni di analisi in cent e gestione del segnale incerto.

Vanno invece rimossi dall'esperienza utente tutti i percorsi attuali:
`Trova la nota`, `Tieni la nota`, `Riconosci intervalli`, `Canta intervalli` e
`Disegna`. Vengono sostituiti anche catalogo, navigazione, timeline, scoring a
una/due note, scheduler adattivo e riepiloghi legati alle vecchie competenze.

## Terminologia musicale

Nel prodotto conviene usare nomi precisi:

- `1–2–3–4–5–4–3–2–1` è un **pentacordo maggiore ascendente e discendente**,
  non una scala maggiore completa;
- `1–3–5–3–1` è un **arpeggio di triade**;
- nella triade maggiore il terzo grado è `3M`;
- nella triade minore il terzo grado è `3m`;
- la quinta è giusta in entrambi i pattern ed è indicata semplicemente come `5`;
- la fondamentale è sempre `1`.

L'interfaccia può usare “Scala 1–5” come etichetta breve, spiegando una volta che
si tratta del pentacordo maggiore.

## Catalogo MVP degli esercizi

### 1. Scala 1–5 guidata

Pattern:

```text
1  2  3  4  5  4  3  2  1
```

Caratteristiche proposte:

- modo maggiore;
- una nota per pulsazione;
- velocità selezionabile: `Lento · 60 BPM`, `Medio · 80 BPM`,
  `Rapido · 100 BPM`;
- melodia target ascoltata prima alla velocità dell'esercizio con timbro
  MuseScore Muse Sounds Choir;
- durante l'esecuzione, metronomo alla velocità scelta e fondamentale continua;
- nessuna melodia target udibile durante la take;
- spartito reale, nomi dei gradi e target sul piano roll;
- voce rilevata sovrapposta al target;
- feedback al termine dell'intero pattern, non dopo ogni nota.

Durata del solo pattern, con semiminima come unità:

| Velocità | Durata di 9 note |
|---|---:|
| 60 BPM | 9,0 s |
| 80 BPM | 6,75 s |
| 100 BPM | 5,4 s |

### 2. Arpeggio guidato

Pattern maggiore:

```text
1  3M  5  3M  1
```

Pattern minore:

```text
1  3m  5  3m  1
```

Caratteristiche proposte:

- routine con quattro esecuzioni alternate:
  `maggiore → minore → maggiore → minore`;
- le stesse tre velocità `60 / 80 / 100 BPM`;
- una nota per pulsazione;
- modello ascoltato prima alla velocità dell'esercizio e non riprodotto durante la take;
- metronomo e fondamentale udibili durante la take;
- spartito, gradi, piano roll e feedback con lo stesso contratto della scala;
- qualità dell'accordo sempre esplicita prima della partenza.

Durata del solo pattern: 5,0 s a 60 BPM, 3,75 s a 80 BPM e 3,0 s a
100 BPM.

### 3. Orecchio interno

L'utente seleziona uno dei pattern precedenti. L'app:

1. dichiara tonalità, qualità e pattern;
2. esegue la sola fondamentale come riferimento;
3. lascia una breve pausa di memorizzazione;
4. dà il count-in;
5. mostra la sequenza dei gradi e il momento esatto in cui cantarli;
6. mostra lo spartito ma non riproduce la melodia target durante la take;
7. traccia soltanto la voce dell'utente;
8. al termine rivela melodia target, scostamenti e punti da riprovare.

L'interpretazione UX raccomandata è questa:

- durante la take, i gradi (`1`, `2`, `3`, `4`, `5` oppure `3m` / `3M`)
  accompagnano le note reali sul pentagramma;
- lo spartito mostra ritmo, altezze e gradi fin dalla preparazione;
- il piano roll mostra griglia, tastiera, linea `ORA` e plume dell'utente, ma
  nessuna banda target né etichetta collocata all'altezza corretta;
- dopo la take, il piano roll rivela le altezze reali e sovrappone la voce registrata.

La plume della voce dell'utente resta visibile in tempo reale anche in questa
modalità.

La scelta privilegia il supporto didattico alla lettura: le note sono visibili,
ma la melodia non viene eseguita e il confronto sul piano roll arriva alla fine.

### 4. Grado singolo

Questo esercizio è disponibile esclusivamente in modalità `Orecchio interno`.
L'app presenta la fondamentale di Fa, mostra il grado richiesto sul pentagramma
e non esegue mai la nota target prima o durante la take. Il corista mantiene il
grado per quattro pulsazioni; target sul piano roll e scostamento appaiono
soltanto nel confronto finale.

I livelli implementati sono:

- **Base**: quattro richieste casuali senza ripetizione tra `2`, `3`, `4`, `5`;
- **Avanzato**: dodici richieste casuali senza ripetizione, una per ogni
  semitono sopra la fondamentale fino all'ottava.

Le alterazioni usano una doppia etichetta enarmonica per rendere esplicite
entrambe le letture: `♯1 / ♭2`, `♯2 / ♭3`, `♯4 / ♭5`, `♯5 / ♭6` e
`♯6 / ♭7`. L'ordine viene generato da un seed conservato nella routine: resta
stabile durante una sessione, cambia quando si avvia una nuova routine ed è
riproducibile nei test.

## Flusso utente proposto

La schermata iniziale evita l'attuale raccolta eterogenea di attività e presenta
tre ingressi:

1. `Riscaldamento`;
2. `Orecchio interno`;
3. `Routine di oggi`.

### Configurazione minima

Prima della prova si scelgono:

- pattern: scala 1–5, arpeggi oppure grado singolo;
- per gli arpeggi: stato fondamentale, primo rivolto, secondo rivolto o tutte
  le posizioni;
- per il grado singolo: livello base o avanzato;
- velocità: 60, 80 o 100 BPM;
- fondamentale di riferimento: Fa, con ottava adattata al ruolo e
  all'estensione; il pentacordo è in Fa maggiore, mentre la triade può essere
  di Fa maggiore o Fa minore;
- a 60, 80 e 100 BPM: partenza dalla tonalità di riferimento;
- dopo ogni take: scelta esplicita fra ripetere, salire di un semitono o
  terminare, fino a tre semitoni sopra il punto di partenza;
- modalità: guidata oppure orecchio interno.

Il ruolo SATB e l'estensione rimangono nelle impostazioni. Le opzioni impossibili
devono essere disabilitate prima dell'avvio, non corrette silenziosamente.

### Stati di una prova

```text
configurazione
  → presentazione
  → riferimento
  → count-in
  → esecuzione
  → analisi
  → confronto
  → continua / riprova / termina
```

- `presentazione`: pattern, tonalità, qualità, BPM e numero della ripetizione;
- `riferimento`: melodia completa al BPM scelto nel riscaldamento con modello,
  sola fondamentale in modalità orecchio interno;
- `preparazione`: quattro pulsazioni allo stesso tempo del modello e della take,
  così l'attacco è metricamente chiaro;
- `esecuzione`: clock unico per audio, linea `ORA`, registrazione e scoring;
- `analisi`: nessuna modifica visiva che anticipi il risultato;
- `confronto`: target rivelato, plume conservata e feedback per segmento;
- `continua`: stessa configurazione trasposta secondo la routine.

Pausa, annullamento, cambio esercizio e cambio velocità invalidano la prova in
corso. Una prova interrotta non alimenta le statistiche di competenza.

### Revisione UX — approvata e implementata

L'attuale schermata espone contemporaneamente catalogo, parametri, timeline e
risultato. È efficiente per chi conosce già il sistema, ma richiede a un ragazzo
di interpretare troppe decisioni prima di capire cosa fare. La revisione
proposta usa divulgazione progressiva e quattro ambienti distinti:

```text
Scegli l'allenamento → Prepara → Canta → Guarda com'è andata
```

1. **Scegli l'allenamento.** Una home con tre grandi carte illustrate:
   `Scalda la voce`, `Accordi e arpeggi`, `Allena l'orecchio`. Ogni carta mostra
   in linguaggio comune obiettivo e durata; BPM, rivolti e gradi non compaiono
   ancora.
2. **Prepara.** Una schermata breve specifica per l'esercizio scelto. Mostra
   soltanto velocità e livello come scelte principali, un'anteprima della
   sequenza e un unico pulsante `Comincia`. Sezione vocale, estensione, volume e
   pad vivono nel pannello Impostazioni.
3. **Canta.** Vista concentrata, senza il catalogo laterale: istruzione grande
   (`Ascolta`, `Preparati`, `Canta`), spartito/piano roll, avanzamento della
   routine e un solo comando secondario `Interrompi`. I termini tecnici come
   target e plume non sono mostrati all'allievo.
4. **Guarda com'è andata.** Feedback qualitativo prima dei numeri, storia
   completa della voce sovrapposta al target e azioni `Riprova` e `Continua`.
   I cent e le metriche dettagliate restano dietro `Vedi dettagli`.

Su mobile, la preparazione occupa il viewport senza scorrimento nello stato
ordinario; la vista di canto mantiene il trasporto in basso. Il
passaggio tra le quattro viste deve usare stato applicativo e routing leggero,
non quattro implementazioni indipendenti, così timeline e sessione non vengono
ricreate accidentalmente.

Il tono visivo consigliato è incoraggiante ma non infantile: illustrazioni
semplici, un colore riconoscibile per ciascun percorso e testo breve. Evitare
stelle, classifiche e mascotte finché non esiste una strategia didattica che
impedisca di premiare la sola precisione a scapito di respirazione e comfort.

Stato al 14 ottobre 2026: il flusso è implementato come un'unica applicazione a
stati, senza duplicare timeline o sessione. La home presenta i tre percorsi
`Scalda la voce`, `Accordi e arpeggi` e `Trova le note`; la preparazione espone
solo le scelte pertinenti; la vista di canto elimina il catalogo laterale; il
risultato mantiene spartito e storia completa della voce, mentre metriche e
segmenti sono raccolti nel pannello espandibile `Vedi dettagli`. Profilo SATB,
estensione, pad e volume della guida sono riuniti in `Impostazioni`. Il layout
mobile mantiene la scelta e la preparazione nei viewport di verifica e usa
una vista concentrata per canto e confronto. Si veda la revisione del 20 ottobre
per il contratto corrente della preparazione.

## Contratto temporale

La timeline deve essere una struttura dati indipendente dal rendering e
dall'audio. Ogni evento contiene almeno:

```text
id, beat, durationBeats, degree, semitoneOffset,
targetMidi, label, audible, evaluated
```

Principi:

- il beat è l'unità canonica; i secondi derivano da `60 / BPM`;
- audio, cursore, piano roll e finestre di scoring leggono la stessa timeline;
- il tempo scelto non richiede asset grafici diversi;
- count-in e pattern sono fasi distinte;
- il cambio BPM è consentito soltanto fra due prove;
- la latenza visiva e quella del microfono restano correzioni separate;
- eventi udibili ed eventi valutati sono sempre distinti nel modello: durante
  la take sono udibili fondamentale e metronomo, mentre vengono valutati i
  segmenti melodici cantati.

Scale e arpeggi usano una nota per semiminima; il grado singolo viene mantenuto
per quattro pulsazioni. Anche il modello usa una nota per semiminima allo stesso
BPM della take. Ritmi diversi, legato/staccato e pattern sillabici sono
estensioni successive.

Il modello non può essere trattato come un count-in generico: il pentacordo ha
nove note e l'arpeggio cinque. La soluzione mantiene separate le fasi `modello`
e `count-in`: conclusa la frase, quattro pulsazioni allo stesso BPM confermano
il tempo e portano a un attacco inequivocabile sul battere.

## Generazione delle altezze e tutela dell'estensione

Ogni pattern è definito come intervalli in semitoni dalla fondamentale:

| Pattern | Offset |
|---|---|
| Scala 1–5 maggiore | `0, 2, 4, 5, 7, 5, 4, 2, 0` |
| Triade maggiore | `0, 4, 7, 4, 0` |
| Triade minore | `0, 3, 7, 3, 0` |

Una fondamentale è valida soltanto se tutti gli eventi rientrano
nell'estensione confortevole impostata. La routine deve quindi:

1. calcolare tutte le fondamentali ammissibili;
2. applicare il passo di trasposizione scelto;
3. fermarsi prima di superare il limite;
4. comunicare in anticipo quante ripetizioni contiene.

La fondamentale di riferimento è Fa. Per il pentacordo identifica Fa maggiore;
per gli arpeggi identifica Fa maggiore o Fa minore secondo la qualità dichiarata.
`Fa` indica qui la classe di altezza, non un'ottava assoluta: il planner sceglie
il Fa nell'ottava più centrale che permette all'intero pattern di rientrare nel
profilo vocale. Per esempio, Soprano e Contralto possono usare un'ottava diversa
da Tenore e Basso pur mantenendo la stessa fondamentale nominale.

A tutte le velocità la routine parte dal Fa di riferimento. Dopo ogni take
l'utente può scegliere di salire cromaticamente di un semitono:

```text
Fa → Fa♯ → Sol → La♭
```

Non esiste più una sequenza automatica né un ritorno forzato verso Fa: ogni
passaggio richiede una decisione dell'utente. L'escursione massima resta di tre
semitoni. Se la tonalità successiva non rientra nell'estensione confortevole, il
comando viene disabilitato e comunica il raggiungimento del limite; il planner
non traspone silenziosamente in modo diverso. La fondamentale iniziale mantiene
un margine di comfort quando l'estensione lo consente.

## Audio

### Riscaldamento con modello

La melodia target è prodotta con MuseScore Muse Sounds Choir, scegliendo il
banco coerente con il ruolo SATB. Il modello viene eseguito allo stesso BPM
della take, per non indurre il cantore a imitarne una velocità errata. Per le scale, ogni combinazione realmente raggiungibile di
ruolo, fondamentale e tempo viene renderizzata come frase intera con legatura e
una lieve arcata dinamica. Questo conserva transizioni e respiri del motore
Muse Sounds, invece di ricostruire la linea con nove attacchi indipendenti.
La banca corrente contiene 48 frasi di scala: quattro fondamentali consecutive
per ogni ruolo SATB e per ciascuno dei tempi 60, 80 e 100 BPM. A queste si
aggiungono 72 frasi d'arpeggio: maggiore e minore, nelle tre posizioni, ai tre
tempi e per ogni ruolo. La salita manuale non usa quindi il pitch-shifting di
un'intera frase.

Il campionatore cromatico resta il motore dei cue che non possono essere
pre-renderizzati, come i percorsi casuali dell'orecchio interno. Nei percorsi
guidati una frase mancante viene segnalata senza degradare al campionatore.
Le sue voci confluiscono in un unico ambiente breve: la coda non appartiene al
singolo file e non viene interrotta quando parte la nota successiva. I passaggi
melodici usano inoltre una piccola sovrapposizione tra inviluppi.

Nel riscaldamento guidato è disponibile un pad armonico pianissimo, separato
dalla voce e disattivabile da Impostazioni. Accompagna anteprima e count-in di
scale e arpeggi, usa la terza maggiore o minore coerente con l'esercizio, ma
sfuma prima della take per non contaminare il rilevamento microfonico quando si
usano gli altoparlanti. Non viene caricato in Orecchio interno.

Durante la take la melodia target tace. Restano il metronomo e una fondamentale
continua, sempre ottenuta con il timbro corale. La presenza della fondamentale
aiuta l'orientamento tonale ma non sostituisce la parte da cantare.

Anche la fondamentale continua può rientrare nel microfono attraverso gli
altoparlanti e falsare la misura, soprattutto quando l'utente canta il primo
grado o uno dei suoi armonici. Il prodotto deve quindi distinguere:

- uso con cuffie: scoring completo;
- uso con altoparlanti: feedback dichiarato come potenzialmente contaminato,
  oppure esercizio non valutato finché un test di leakage non risulta superato.

Non è professionalmente corretto presentare come voce dell'utente un segnale che
potrebbe provenire dall'app stessa.

### Modalità orecchio interno

Non viene riprodotta l'anteprima melodica. Si ascolta la fondamentale e, durante
la take, restano udibili fondamentale continua e metronomo. Lo spartito è visibile;
il target sul piano roll resta nascosto fino al confronto finale. La plume resta
visibile durante l'esecuzione.

La fondamentale usa una sola sorgente continua dall'ascolto alla fine della
take. Parte a metà del precedente volume di riferimento, resta brevemente in
primo piano e scende gradualmente al livello di sottofondo prima dell'ingresso
del count-in. Non devono esserci silenzio, riattacco o salto di timbro fra le
due fasi.

## Piano roll e spartito

### Modalità guidata

- target a segmenti, mai come glissando continuo;
- grado scritto dentro o sopra ogni segmento;
- plume della voce in primo piano;
- linea `ORA` derivata dal clock audio;
- tastiera/nome delle note come riferimento secondario;
- spartito con note reali e gradi come testo sotto le note.

### Modalità orecchio interno durante la take

- nessuna banda target;
- note reali, gradi e pulsazioni sul pentagramma fin dall'inizio;
- fondamentale dichiarata testualmente come nota 1;
- plume dell'utente visibile, salvo futura opzione “buio completo”.

### Confronto finale

- target rivelato con una transizione esplicita;
- plume della take mantenuta nella stessa geometria;
- segmento selezionabile per riascoltare la registrazione;
- etichetta per ogni grado;
- feedback verbale prima dei cent numerici;
- valori numerici disponibili come dettaglio, non come giudizio principale.

Lo spartito visibile dei pattern viene generato da MusicXML e inciso da
MuseScore 4 in SVG ritagliati. Chiavi, alterazioni, armature, gambi, legature,
linee aggiuntive, spaziatura e numeri dei gradi sono quindi output del medesimo
motore usato per gli spartiti di `Canta brano`, non forme imitate su canvas. La
banca corrente contiene ogni combinazione raggiungibile dai profili SATB
standard; tempo e BPM non producono duplicati perché non cambiano l'incisione.

La vista dell'orecchio interno usa lo stesso SVG MuseScore delle altre modalità.
Il confronto finale aggiunge il target sul piano roll alla voce registrata.

## Analisi e feedback

La prova non può terminare anticipatamente come l'attuale `Trova la nota`: deve
arrivare alla fine della sequenza per valutare tutti i gradi.

Per ogni nota si propone di calcolare:

- copertura di frame vocali affidabili;
- mediana dello scostamento in cent;
- dispersione robusta;
- stabilità nella parte centrale della nota;
- ritardo di attacco;
- eventuale anticipo o ritardo del cambio;
- errore relativo rispetto alla fondamentale e al grado precedente.

Le finestre escludono una breve zona di attacco e una zona simmetrica intorno ai
cambi. A 100 BPM tali zone devono scalare con la durata della nota e non possono
riutilizzare ciecamente i valori pensati per note di 2,4 secondi.

Esiti per singolo segmento:

- `centrato`;
- `vicino`;
- `crescente`;
- `calante`;
- `instabile`;
- `non rilevato`;
- `incerto`.

Il riepilogo della sequenza mostra:

- gradi centrati su gradi affidabili;
- tendenza principale, per esempio “le note alte tendono a essere calanti”;
- regolarità dei cambi;
- una sola indicazione operativa;
- possibilità di riprovare la stessa tonalità o continuare la routine.

Un segnale incerto non vale come errore. Nell'orecchio interno vanno conservate
separatamente precisione assoluta e precisione relativa: una sequenza trasposta
tutta della stessa quantità può avere relazioni corrette ma non essere centrata
sulla fondamentale ascoltata.

## Modello dati proposto

Le definizioni devono essere data-driven, non ramificate per nome
dell'esercizio:

```text
PatternDefinition
  id
  name
  family                scale | triad
  quality
  inversion             root | first | second
  chordRootDegree
  bassDegree
  degreeLabels[]
  semitoneOffsets[]
  durationBeats[]

ExerciseDefinition
  schemaVersion
  id
  patternId
  mode                 guided | inner-ear
  bpm                  60 | 80 | 100
  rootMidi
  previewBpm           bpm
  countInBeats
  timeline[]
  targetVisibility
  audioPolicy
  scoringPolicy

ExerciseResult
  schemaVersion
  exerciseDefinition
  roleAndRange
  deviceAndLatencyConfig
  completed
  interruptionReason
  signalReliability
  segmentResults[]
  sequenceSummary
  recordingReference
  startedAt
  completedAt
```

I risultati esistenti `choir-voice-lab:v1` non vanno cancellati. Il nuovo
prodotto usa uno schema e una chiave `v2`; i risultati v1 vengono ignorati dal
nuovo scheduler ma restano recuperabili durante la transizione. Un'eventuale
cancellazione dei dati storici richiede una decisione esplicita separata.

### Contratto dei rivolti

Il modello non deve dedurre che la prima nota cantata sia sempre la fondamentale
dell'accordo. Identità armonica e disposizione vanno rappresentate
separatamente:

- `root`: fondamentale armonica dell'accordo;
- `quality`: maggiore o minore;
- `inversion`: stato fondamentale, primo rivolto o secondo rivolto;
- `bassDegree`: grado più grave della disposizione;
- `degreeLabels`: sequenza effettivamente cantata;
- `semitoneOffsets`: altezze effettive rispetto alla fondamentale armonica.

Sequenze implementate:

| Disposizione | Maggiore | Minore |
|---|---|---|
| Stato fondamentale | `1–3M–5–3M–1` | `1–3m–5–3m–1` |
| Primo rivolto | `3M–5–1–5–3M` | `3m–5–1–5–3m` |
| Secondo rivolto | `5–1–3M–1–5` | `5–1–3m–1–5` |

Le ottave effettive fanno parte degli offset del voicing. Interfaccia, audio,
spartito e scoring leggono la stessa sequenza senza casi speciali per i
rivolti. La routine conserva l'alternanza
`maggiore → minore → maggiore → minore` per ogni posizione selezionata. La
selezione “Tutti” concatena le tre posizioni e produce dodici prove. Quando una
disposizione lo richiede, il planner cambia l'ottava della fondamentale armonica
per mantenere tutte le note cantate nell'estensione dichiarata.

## Architettura proposta

La nuova implementazione dovrebbe separare sei responsabilità:

1. **Catalogo pattern**: definizioni musicali pure e validate;
2. **Routine planner**: fondamentali, trasposizioni, range e ordine delle prove;
3. **Timeline engine**: beat, BPM, count-in, eventi udibili e valutabili;
4. **Audio scheduler**: pianifica tutto sul clock di `AudioContext`;
5. **Renderer**: spartito, corsia dei gradi, piano roll e stato reveal;
6. **Sequence analyser**: segmenta i frame e produce risultati per nota e
   riepilogo.

`voice_lab_core.js` può ospitare inizialmente le parti pure, ma il controller
attuale è già molto esteso. Durante il rifacimento conviene estrarre moduli
dedicati invece di aggiungere altre condizioni su `state.activity`:

```text
voice_lab_patterns.js
voice_lab_timeline.js
voice_lab_analysis.js
voice_lab_session.js
voice_lab_view.js
voice_lab.js              controller sottile
```

La separazione è un obiettivo tecnico, non un requisito per cambiare framework.
Per l'MVP non serve introdurre React o un nuovo sistema di build.

## Strategia per il codice esistente

### Da conservare e adattare

- `pitch_detector.js`, `pitch_shared.js`, `fluid_pitch_trail.js`;
- conversioni MIDI/Hz/cent e analisi robuste riutilizzabili;
- gestione `getUserMedia` e `MediaRecorder`;
- profilo vocale e tastiera dell'estensione;
- caricamento e normalizzazione dei campioni;
- test di isolamento audio e smoke test browser;
- pipeline di build statica e audit degli asset.

### Da sostituire

- tab `Trova la nota`, `Riconosci`, `Canta intervalli`, `Disegna`;
- `buildRepeatTimeline` e completamento anticipato della singola nota;
- sessioni a blocchi basate sulle vecchie competenze;
- configurazione dinamica specifica per attività;
- generazione di esercizi casuali a una o due note;
- feedback e persistenza schema v1 come fonte del nuovo adattamento.

### Da rimuovere soltanto alla fine

Gli asset e il codice legacy vanno rimossi dopo che il nuovo flusso supera test
unitari, smoke test e verifica visuale. La rimozione anticipata renderebbe più
difficile confrontare comportamento audio, latenza e qualità del tracking.

## Piano di implementazione

### Fase 0 — Chiusura delle decisioni

- rispondere alle domande in fondo al documento;
- validare un wireflow desktop e mobile;
- fissare la transizione metrica dopo l'anteprima e l'interazione tra routine di
  arpeggi e trasposizione manuale dopo il confronto;
- definire criteri di successo musicali con una persona competente in didattica
  vocale;
- congelare l'MVP e spostare le estensioni nel backlog.

**Uscita:** nessuna ambiguità che modifichi timeline, asset o scoring.

### Fase 1 — Dominio e timeline

- introdurre pattern data-driven;
- implementare validazione del range e trasposizione incrementale richiesta
  dall'utente dopo il confronto;
- produrre timeline deterministiche per 60/80/100 BPM;
- introdurre schema risultati v2;
- aggiungere test unitari di pattern, durata, range e serializzazione.

**Uscita:** gli stessi input producono eventi e durata esatti, senza browser.

### Fase 2 — Scala guidata

- sostituire `Trova la nota` con `Scala 1–5`;
- implementare score con gradi, piano roll segmentato, anteprima a velocità
  doppia, metronomo e fondamentale continua;
- registrare una sequenza completa;
- analizzare nove segmenti;
- verificare desktop, mobile, pausa, annullamento e cambio BPM.

**Uscita:** una scala completa funziona alle tre velocità e in tutte le
estensioni valide.

### Fase 3 — Arpeggi maggiore e minore

- aggiungere i due pattern senza duplicare controller e scoring;
- rendere esplicita la qualità;
- verificare `3M` e `3m` in score, corsia gradi e risultato;
- aggiungere la routine di quattro arpeggi, due maggiori e due minori;
- mantenere `quality`, `inversion` e `bassDegree` separati nel modello;
- coprire con test stato fondamentale, primo e secondo rivolto ed esporre una
  selezione esplicita della posizione nell'interfaccia;

**Uscita:** scala e arpeggi condividono lo stesso motore.

### Fase 4 — Orecchio interno

- introdurre politica audio `root-only`;
- mostrare subito lo spartito e spiegare la fondamentale come nota 1;
- mantenere nascosto il confronto sul piano roll durante la take;
- rivelare il target sul piano roll soltanto a take conclusa;
- distinguere errore assoluto e relativo;
- testare che nessun audio target venga schedulato nella finestra valutata.

**Uscita:** l'utente può completare entrambi i pattern usando solo la
fondamentale.

### Fase 5 — Routine e rifinitura

- concatenare trasposizioni entro il range;
- mostrare avanzamento e punto di arresto;
- aggiungere riepilogo di routine e suggerimento unico;
- validare accessibilità da tastiera e screen reader;
- verificare leakage, latenza e prestazioni su dispositivi reali;
- rimuovere UI, codice e asset legacy non più referenziati;
- aggiornare il documento canonico del percorso didattico.

**Uscita:** nuova area completa, nessun ramo legacy raggiungibile e build entro
i budget di asset.

## Strategia di verifica

### Test unitari

- offset e nomi dei gradi dei tre pattern;
- durate esatte a 60/80/100 BPM;
- fondamentali ammissibili per ogni range SATB;
- routine ascendenti/discendenti e arresto ai limiti;
- segmentazione a tutte le velocità;
- classificazione centrato/crescente/calante/incerto;
- distinzione tra precisione assoluta e relativa;
- migrazione non distruttiva da v1 a v2.

### Test browser

- un clock unico governa audio, cursore e scoring;
- la modalità guidata programma tutti e soli gli eventi target previsti;
- il modello è riprodotto al BPM scelto e non durante la take;
- la modalità orecchio interno non programma alcun evento melodico target;
- fondamentale e metronomo proseguono durante la finestra cantata;
- nessun target appare nel piano roll prima del reveal;
- score e piano roll rivelati corrispondono alla stessa fondamentale;
- cambio velocità non altera le altezze;
- cambio pattern non lascia audio o timer pendenti;
- microfono negato, segnale assente e sospensione della pagina hanno esiti chiari;
- layout utilizzabile a 390×780 e su desktop.

### Validazione musicale

I test automatici non bastano. Servono almeno:

- controllo di un direttore/insegnante sul fraseggio e sulle etichette;
- prova con cantanti di sezioni diverse;
- verifica che la scelta di salire sia disponibile a 60/80/100 BPM e venga
  disabilitata oltre +3 o al limite dell'estensione;
- verifica del timbro guida e del volume del click;
- confronto cuffie/altoparlanti;
- osservazione della comprensibilità della modalità orecchio interno senza
  spiegazioni esterne.

## Criteri di accettazione MVP

1. L'utente seleziona scala o arpeggio, qualità applicabile e uno dei tre BPM.
2. Tutte le note generate rientrano nell'estensione configurata.
3. La modalità guidata riproduce esattamente il pattern scelto nell'anteprima e
   lo visualizza durante la take senza riprodurne la melodia.
4. La modalità orecchio interno riproduce soltanto la fondamentale prima della
   take e nessuna nota target durante la take.
5. Note e gradi sono leggibili sul pentagramma fin dalla preparazione.
6. Dopo la prova il target viene rivelato e allineato alla plume registrata.
7. Il feedback identifica segmenti affidabili e incerti senza convertire questi
   ultimi in errori.
8. I risultati distinguono modalità, pattern, qualità, BPM, fondamentale e
   configurazione effettiva.
9. Interruzioni e cambi di configurazione non salvano prove complete.
10. Test unitari, smoke browser, build statica e audit asset passano.

## Sviluppi successivi

Una volta stabile l'MVP, lo stesso modello abilita:

- sequenze casuali di gradi già acquisiti;
- modi minore naturale, armonico e melodico;
- accordi di settima e relativi rivolti;
- pattern ritmici e sillabe vocaliche diverse;
- domanda senza plume live, per evitare autocorrezione visiva;
- memoria con ritardo crescente dopo la fondamentale;
- cambio di tonalità senza nuovo riferimento;
- esercizi derivati da intervalli reali del repertorio;
- armonizzazione: cantare terza o quinta sopra una fondamentale o un accordo;
- adattamento basato sugli specifici gradi fragili, non su un livello globale;
- routine preparate dal direttore del coro.

La progressione didattica suggerita è:

```text
imitazione completa
  → melodia visibile ma non udibile
  → soli gradi e fondamentale
  → richiesta di un grado singolo
  → sequenze imprevedibili
  → applicazione armonica e al repertorio
```

## Rischi principali

| Rischio | Mitigazione proposta |
|---|---|
| La fondamentale continua viene rilevata come voce | cuffie, test leakage, scelta d'ottava e affidabilità dichiarata |
| Il confronto anticipa l'esito | test che il piano roll nasconda il target prima del risultato |
| Finestre troppo corte a 100 BPM | soglie proporzionali alla durata e test sintetici |
| Routine fuori estensione | planner deterministico e margine di comfort |
| Troppi asset statici | template per pattern/root, nessun duplicato per BPM |
| Controller ancora più complesso | moduli separati e logica data-driven |
| Feedback percepito come voto | osservazioni musicali locali, niente punteggio globale |
| Dati storici incompatibili | namespace v2 non distruttivo |

## Decisioni finali dell'MVP

- dopo il modello vengono eseguite quattro pulsazioni allo stesso BPM;
- a 60/80/100 BPM la scala parte da Fa e può salire, su scelta dell'utente, fino
  a La♭; non esiste ritorno automatico;
- gli arpeggi restano sul Fa e alternano
  `maggiore → minore → maggiore → minore` a tutte le velocità;
- metronomo e fondamentale continuano per tutta la take;
- cuffie e altoparlanti sono entrambi consentiti, senza blocchi o avvisi
  penalizzanti;
- il feedback mostra un'indicazione principale e il dettaglio di ogni nota;
- la velocità è sempre scelta manualmente dall'utente;
- i risultati vengono conservati localmente nello schema v2, separati dai dati
  storici v1.

## Decision log

| Data | Decisione | Stato |
|---|---|---|
| 2026-10-14 | Sostituire `Trova la nota` con pattern di riscaldamento | richiesto |
| 2026-10-14 | Tempi selezionabili 60/80/100 BPM | richiesto |
| 2026-10-14 | Aggiungere scala 1–5 e triadi maggiore/minore | richiesto |
| 2026-10-14 | Aggiungere modalità con sola fondamentale e reveal finale | richiesto |
| 2026-10-14 | Eliminare tutte le attività Voice Lab correnti | confermato |
| 2026-10-14 | Anteprima della melodia a velocità doppia | superato |
| 2026-10-14 | Modello e take alla stessa velocità per evitare imitazioni al doppio | confermato |
| 2026-10-14 | Durante la take lasciare metronomo e fondamentale, senza melodia target | confermato |
| 2026-10-14 | Usare Fa come fondamentale di riferimento a 60 e 80 BPM | confermato |
| 2026-10-14 | A 100 BPM salire automaticamente di tre semitoni e tornare | superato |
| 2026-10-14 | Dopo ogni scala, a 60/80/100 BPM, lasciare all'utente la scelta di salire di un semitono | confermato |
| 2026-10-14 | Usare MuseScore Muse Sounds Choir come timbro | confermato |
| 2026-10-14 | Mostrare sempre la qualità maggiore/minore | confermato |
| 2026-10-14 | Routine `maggiore → minore → maggiore → minore` | confermato |
| 2026-10-14 | Target nascosto in corsia neutra con plume live visibile | superato il 19 ottobre per lo spartito; confermato per il piano roll |
| 2026-10-14 | Preparare il modello dati per primo e secondo rivolto | confermato |
| 2026-10-14 | Conservare infrastruttura tecnica già verificata | proposta |
| 2026-10-14 | Quattro pulsazioni al BPM reale dopo l'anteprima | confermato |
| 2026-10-14 | Trasporre solo la scala rapida; arpeggi sempre sul Fa | confermato |
| 2026-10-14 | Consentire l'uso senza cuffie | confermato |
| 2026-10-14 | Introdurre risultati v2 senza cancellare i v1 | implementato |
| 2026-10-14 | Esporre primo e secondo rivolto e una routine con tutte le posizioni | implementato |
| 2026-10-14 | Grado singolo base `2–5` e avanzato cromatico fino all'ottava | implementato |
| 2026-10-14 | Renderizzare le scale guidate come frasi Muse Choir complete | implementato |
| 2026-10-14 | Usare una coda d'ambiente condivisa per i cue campionati | implementato |
| 2026-10-14 | Pad opzionale solo in ascolto/count-in, mai nell'orecchio interno | implementato |
| 2026-10-14 | Applicare alla plume Voice Lab l'anticipo condiviso di 270 ms | implementato |
| 2026-10-14 | Conservare visibile tutta la storia della take | implementato |
| 2026-10-14 | Uniformare gli arpeggi alle frasi Muse Choir continue, con pad maggiore/minore e gradi `3M` / `3m` | implementato |
| 2026-10-14 | Separare scelta, preparazione, canto e risultato | implementato |
| 2026-10-14 | Fondamentale orecchio interno continua, dimezzata e con fade verso il count-in | implementato |
| 2026-10-14 | Sostituire le note canvas visibili con frammenti SVG incisi da MuseScore | implementato |
| 2026-10-19 | Navigazione dedicata, spiegazioni iniziali e spartito sempre visibile anche in Orecchio interno | implementato |
| 2026-10-19 | Segnalare il mancato caricamento di frase corale o pad senza degradazioni silenziose | implementato |
