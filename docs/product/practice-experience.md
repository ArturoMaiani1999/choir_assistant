# Practice UX specification

**Status:** canonical
**Owner:** project maintainer
**Last reviewed:** 2026-10-20

Status: stable frontend decisions, 9 September 2026.

## Product hierarchy

Practice is one non-scrolling rehearsal instrument inside `100dvh`, ordered as:

1. compact toolbar: exit, piece/part, speed, accompaniment, settings;
2. selected-part score viewport with a conventional moving score cursor;
3. live pitch lane with a fixed `NOW` line and more future than history;
4. compact transport: previous measure, play/pause, next measure, measure, volume.

Practice always shows one selected vocal part. The full score belongs to the separate, vertically scrolling `score-viewer.html` reading mode and never replaces or reduces the active rehearsal view.

## Ingresso e navigazione

Il menù iniziale presenta soltanto tre modalità, tutte visibili senza scroll
a 1366×768 e 390×844: **Canta brani**, **Vedi partitura**, **Allena la voce**.
I tre comandi sono centrati sullo sfondo animato di [Lissajous](relax-mode.md),
senza finestra introduttiva. Profilo e ingranaggio occupano l'angolo superiore
destro. Solo il primo ingresso nel browser mostra prima la curva dal centro
e rivela i comandi dopo un secondo; ritorni e successive aperture sono immediati.
Con movimento ridotto la scena è ferma e il menù appare subito.
**Canta brani** apre la scelta **Brani assegnati** / **Brani custom**; il secondo
ingresso usa il catalogo esistente, senza introdurre un caricamento di file.
Ogni passo mostra soltanto le proprie scelte e un ritorno **Indietro**.
Il titolo riceve il focus per annunciare il passo agli screen reader, senza
un bordo visivo perché non è un controllo. Pulsanti, link e campi mantengono
il focus visibile da tastiera.
La parte SATB viene chiesta al primo ingresso in una prova e poi ricordata nel
profilo dell'account, per brani assegnati, catalogo e laboratorio vocale.

La prova apre la toolbar anche su mobile. **Menù**, oppure **Repertorio** se
il brano arriva da lì, è un ritorno diretto. Con toolbar chiusa resta un
controllo equivalente sopra lo spartito. Il menù iniziale nasconde l'intera
superficie musicale già dal primo rendering e prima di riaprirsi, senza
fotogrammi intermedi di spartito o piano roll. Non è un dialogo accessorio:
senza una prova caricata non può essere chiuso su una superficie vuota;
con una prova caricata offre **Torna alla prova**, Escape e backdrop.

La partitura aperta dalla prova conserva brano, parte, beat e inizio della
valutazione nel collegamento **Torna alla prova**. Il ritorno resta in pausa
senza richiedere il microfono. La partitura aperta dal menù torna al **Menù**.
Il comando **Analisi** è visibile anche nella prova mobile in pausa; l'analisi
offre **Prova questo brano** o **Prova da qui** per passare esplicitamente al
brano e al passaggio osservati. Il ritorno alla lista si chiama **Risultati**.

Nella partitura, Spazio fuori dai controlli avvia o mette in pausa l'ascolto.
Quando il focus è su un pulsante, Spazio e Invio attivano quel pulsante;
nei campi e nei dialoghi la scorciatoia globale non avvia l'audio.

## Profilo e uscita

**Il mio profilo** è la prima voce di Impostazioni ed è raggiungibile anche
dal menù iniziale. Contiene, in ordine, parte SATB, nome, cognome e
**Esci dall’account**. La preferenza vocale personale non modifica sezione
ufficiale, gruppi o autorizzazioni.

**Esci dall’account** apre `/sign-out`: titolo **Esci da Epistrophe?**, azioni
**Annulla** e **Esci**. Annulla conserva il contesto della prova; Esci chiude
la sessione e porta alla pagina di accesso separata. `/sign-in` e `/sign-up`
mantengono le istruzioni per accedere o registrarsi; una sessione già valida
prosegue direttamente verso la destinazione richiesta.
Audio e microfono vengono fermati prima di navigare. Registrazioni manuali
non salvate e acquisizioni in corso richiedono prima una decisione esplicita.

**Impostazioni → Relax mode** apre la [scena contemplativa](relax-mode.md)
con curva di Lissajous 3D e ritorno al punto della prova in pausa.

## Temporal model

During real accompaniment, `MediaPlaybackClock` reads `HTMLAudioElement.currentTime`; this audio-derived score time is authoritative for score cursor, pitch timeline, transport and mock voice samples. RAF only redraws. The selected-part score is one horizontal continuous system: its cursor follows score time and the sheet translates only enough to keep that cursor visible. In the pitch lane, `NOW_X_RATIO = 0.375` stays fixed and events move right-to-left. These positions are intentionally not geometrically aligned.

Measure selection stores two positions: playback begins at the preceding performance occurrence and evaluation begins at the selected occurrence. The frontend represents the distinction; scoring remains mocked.

## Pitch semantics

### Diagnostica del rientro

Il test è disponibile anche se la calibrazione non è verificata: non può
essere bloccato proprio dalla condizione da diagnosticare. Servono un brano
aperto, Uso gli altoparlanti attivo e il consenso esplicito. Senza modello
verificato non si sottrae nulla; lo stato e i metadati dichiarano che il
trattamento è escluso. Non si chiede di ripetere la guida per registrare.

In **Base → Assistenza e test audio**, il best audio automatico è dichiarato
sospeso: la preferenza può restare attiva, ma si salva solo il grafico.
**Registra test rientro** offre invece un consenso esplicito al salvataggio e una
registrazione fino a 60 secondi. Il dialogo usa il pattern della calibrazione:
istruzione, consenso, Avvia test e Play, dettagli espandibili. Durante la prova
lo spartito resta dominante con una barra compatta di tempo residuo e stop.
Al termine il test si salva automaticamente nel profilo, condiviso per la
diagnosi con direttori e assistenza autorizzata per sette giorni. Non richiede
download o allegati. Il nuovo test sostituisce quello precedente dello stesso
brano; l'utente può eliminarlo riaprendo il dialogo. Se l'invio fallisce,
Riprova salvataggio usa gli stessi dati; Scarta li abbandona. La chiusura X,
Escape e backdrop resta bloccata durante il salvataggio o con dati pendenti,
con una breve spiegazione. Dopo il successo chiude normalmente. Vedi il
[contratto di salvataggio](../architecture/echo-diagnostic-storage.md).
I quattro canali audio sono sincronizzati; i dettagli tecnici restano dietro
disclosure. Vedi il [contratto diagnostico](../engineering/pitch-tracking/santo-echo-study-2026-10-19.md)
e i [criteri di qualità musicale](musical-performance-quality.md).

### Calibrazione e pitch

La voce calibrata rimane valida nella stessa sessione passando da Home al
brano e riaprendo Base. La navigazione interna non chiude il microfono
appena verificato. Il caricamento del brano può cambiare il percorso audio:
al Play parte allora solo il controllo acustico in silenzio di circa 10 s,
automaticamente, senza ripetere le vocali. Base distingue il profilo vocale
salvato dal rientro ancora da verificare. Dopo una nuova acquisizione si
mantiene invece la verifica breve completa del profilo compatibile.

**Impostazioni → Base → Calibra audio** avvia una sola routine per microfono,
voce e, se selezionati, altoparlanti. Base presenta questa come unica azione
primaria, seguita da uscita audio e **Uso gli altoparlanti**. Assistenza e test
sono espandibili; dimensione testo e colore carta sono sotto **Aspetto dello
spartito**. Il dialogo ha chiusura esplicita, Escape e backdrop.

La guida completa dura circa 35 secondi con altoparlanti e 25 con cuffie.
L'istruzione corrente e il countdown della fase dominano; seguono il prossimo
passo e il grafico del livello microfonico (RMS, −72..0 dBFS). Con movimento
ridotto il grafico diventa una barra fissa. Solo le istruzioni, non ogni tick
del timer, sono annunciate. L'analisi mostra uno stato senza un countdown
fittizio. La nota cantata è libera e comoda: non serve imitare un riferimento.

Con altoparlanti la prima acquisizione misura ritardo e risposta con due
fruscii indipendenti mentre l'utente tace. Seguono vocale normale, pausa,
vocale più piano e pausa, con preparazione esplicita. Le regolazioni si
applicano automaticamente solo se superano la verifica indipendente; non
ci sono ulteriori conferme Applica/Cerca profilo/Verifica profilo. I risultati
mostrano recall vocale, specificità delle pause e balanced accuracy della
guida, dichiaratamente diverse dall'accuratezza delle note, più la riduzione
del rientro verificata. Il ritardo misurato resta nei dettagli.

Microfono, grafo di sottrazione, contesti e decoder della base sono già
attivi durante la misura e restano attivi per il Play. La base rimane muta
nel warmup e la posizione dello spartito non avanza. Il risultato dichiara
che il microfono resta attivo. Chiusura durante la misura, annullamento,
background e stop rilasciano le risorse. Il profilo vocale locale è isolato
per account/browser/catena; a una nuova apertura il pulsante unico ripete la
misura acustica e riverifica in silenzio il profilo compatibile (circa 20 s).
Un controllo di rumore fallito fa ripartire automaticamente la guida completa.
Le percentuali dopo il riuso restano quelle della guida vocale originale.

La risposta acustica non viene riutilizzata su una nuova acquisizione. Il
filtro è congelato durante il canto e la base in modalità altoparlanti è mono;
il riferimento comprende mixer, trasposizione e metronomo. L'adattamento
conservativo del solo guadagno non può apprendere segnali tonali o double
talk. Posizione, volume forte, percorsi cambiati e DSP hardware restano limiti
sperimentali. Il best audio resta sospeso con altoparlanti; il test diagnostico
con consenso e salvataggio cloud rimane facoltativo sotto Assistenza.

Audio della calibrazione temporaneo e locale; parametri vocali ricordati per
7 giorni, sessione verificata 30 minuti, misura acustica 10 minuti fuori prova.
Il flusso predefinito deve stare a 1366×768 e 390×844 senza clipping o scroll;
i dettagli aperti possono scorrere. Vedi il
[contratto unico](../engineering/pitch-tracking/unified-audio-calibration.md)
e i [limiti della sottrazione](../engineering/pitch-tracking/reference-echo-cancellation.md).

- Pitch is represented as fractional MIDI/semitones: `69 + 12 * log2(hz / 440)`.
- Every semitone has equal vertical distance. Note names, not Hz, label the axis.
- Target notes are duration blocks; their lyric is attached when provided.
- A continuous singer path shares the same time/pitch plane, integrating pitch and onset information.
- Target blocks include configurable attack-grace metadata and a restrained tolerance corridor.
- Main readout is note, signed cents and `centrato` / `crescente` / `calante`. Hz is diagnostic only.
- Thresholds and rendering ratios live in configuration, outside drawing logic.

Canvas is used for the pitch lane because it handles a continuous high-frequency trajectory without producing a large DOM. Its backing store is scaled to `devicePixelRatio`; geometry and accessible text remain in the DOM.

The pitch Y viewport is stable for one performance occurrence. Its range is calculated from the previous occurrence through two lookahead occurrences, with a two-semitone margin and nine-semitone minimum span. It changes only at occurrence boundaries, avoiding frame-by-frame scale jumps.

## Esplorazione del piano roll

In pausa e a fine prova, il piano roll si esplora trascinando su entrambi gli
assi. La rotella ingrandisce il tempo; Maiusc + rotella ingrandisce l'altezza;
Ctrl/Cmd + rotella e il pizzico touch ingrandiscono entrambi. Lo zoom resta
ancorato al punto indicato. Il menu **Vista**, secondario e sovrapposto al
piano roll, offre regolazioni indipendenti **Tempo** e **Altezza**, percentuali,
**Reimposta vista** e istruzioni. Le regolazioni hanno aree touch di 44 px.
I limiti di zoom sono 25–2000% sul tempo in pausa, 100–2000% nelle analisi,
e 25–800% sull'altezza. L'intervallo verticale resta fermo mentre si esplora;
non segue le battute attraversate. Il limite live di quattro battute su mobile
si applica durante la riproduzione; in esplorazione si può allargare la vista.

Toccare un blocco della melodia riproduce soltanto quella nota con un timbro
sintetico di riferimento: non è un estratto della registrazione né della base.
La prova usa trasposizione, durata e volume correnti (durata di ascolto
limitata a 0,15–2 secondi). Le analisi usano l'altezza rappresentata sul piano
roll; la revisione locale include la trasposizione del take. Una nuova nota
interrompe la precedente, senza sovrapporle. Trascinamenti, pizzichi e gesti
annullati non fanno suonare note. L'ascolto non avvia microfono o base.

Da tastiera: frecce per spostarsi, più/meno per lo zoom, Maiusc per l'altezza,
0/Home per reimpostare, Alt + frecce sinistra/destra per scegliere una nota e
Invio per ascoltarla. Il menu Vista si chiude anche con Escape. La ripresa
della prova ripristina la vista live e mantiene il punto di ripresa memorizzato;
navigazione e ascolto non cambiano clock, checkpoint o dati di intonazione.

Nell'analisi del best, spartito, comandi e piano roll rimangono nel primo
viewport anche a 390×844. I suggerimenti secondari proseguono sotto il piano
roll e possono richiedere scroll: è un'eccezione intenzionale riservata alla
revisione, mentre la prova attiva continua a non scorrere. La revisione delle
registrazioni locali riusa gli stessi gesti e controlli; un tocco conserva
anche la selezione del cursore di riascolto già disponibile in quella vista.

Verifica: `scripts/browser_piano_roll_smoke.py` usa input reali mouse/touch,
controlla ancoraggio, assi indipendenti, assenza di ascolti durante pan/pinch,
frequenza della nota trasposta, rilascio audio e invariabilità del checkpoint.
Salva screenshot desktop/mobile in `artifacts/piano-roll/`.

## Score rendering

Practice consumes a dedicated one-staff continuous SVG for the selected part; paged SVG files remain available only as a compatibility fallback and for the separate reading view. The cursor and the piano roll share the canonical playback beat. Score geometry is indexed by written-measure identity, not by performance-occurrence index: repeats therefore return to the same graphical measure instead of advancing into a nonexistent duplicate. Repeat and final barlines are collapsed into one semantic boundary before measure slots are built. The production build must copy each `continuous_part_scores` asset and publish it as `continuous_scores` in the piece bundle; a Chromium smoke test verifies these invariants on desktop and mobile.

This is real draft notation, not arbitrary HTML notation. Horizontal position inside a measure currently follows canonical beat progress between its barlines. A future renderer may expose stable event-to-glyph bounds for note-level highlighting, but it must preserve the same audio-derived clock and written-measure mapping.

The full-score reader derives each system's vertical extent from the SATB and accompaniment staves. On a system transition it centers that complete extent between the sticky toolbar and floating transport. At the start of a wrapped system, horizontal playback begins at the first rendered note (or rest when no note exists), rather than at the barline behind the repeated clef and key signature.

## Asset loading

Changing piece in Practice does not reload the application shell. The client keeps parsed data for at most two pieces, prefetches only the selected part's score at low priority, and asks audio elements for metadata until playback requires media data. It never prefetches the whole repertoire. Library and piece assets carry the immutable release version in their URL; the browser can therefore reuse them safely while a new deployment receives a distinct cache key.

## Responsive behavior

With experimental speaker cancellation enabled, a small 44 px control at the
top right of the pitch lane reports automatic echo level adjustment, pending
verification, or a maintained setting. It opens the existing quiet speaker
check after pausing. It remains secondary to score/pitch and creates no new
panel or page scroll at 1366×768 and 390×844. Narrow-band output, singing and
an incompatible acoustic path freeze the gain; the interface must not imply
that every hardware volume change is compensated. The details disclosure
explains this limit. See the
[automatic level contract](../engineering/pitch-tracking/reference-echo-cancellation.md#adeguamento-automatico-del-livello).

- Desktop/laptop landscape: all four regions visible; pitch lane dominates.
- Mobile landscape: condensed toolbar, score crop and transport; secondary labels collapse; minimum touch targets remain 40px.
- Narrow portrait: concise rotation recommendation, compact score/pitch preview and essential transport remain usable. Orientation is never hard-locked.
- Active Practice never vertically scrolls in the validated target viewports.

## Visual and interaction semantics

- parchment = notation; amber = canonical time/target; cyan = singer trajectory;
- tolerance is conveyed by geometry and texture as well as color;
- feedback is calm and musical; focus is visible; controls are keyboard accessible;
- motion respects `prefers-reduced-motion`.

## Prohibited patterns

No dashboard/card stack, primary Hz axis, separate rhythm graph, gamification, persistent technical explanation, hard-coded piece logic, hard-coded four-part assumptions, full score as the active default, or vertical scrolling during Practice.

Score reconstruction remains governed by the musical normalization/Occam rules in the project request: preserve structural notation, reject unsupported complexity, and record uncertainty rather than silently inventing it.
