# Practice UX specification

**Status:** canonical
**Owner:** project maintainer
**Last reviewed:** 2026-10-22

Status: stable frontend decisions, 9 September 2026.

## Product hierarchy

Il metronomo dei brani parte attivo al 30% quando non esiste una preferenza
salvata per il brano e la parte. Volume personalizzato e disattivazione restano
memorizzati; il comando on/off ripristina l'ultimo livello positivo della prova,
oppure il 30% se il metronomo è stato riaperto spento.
Il click usa lo stesso contesto e percorso d'uscita della base, anche con
Bluetooth. La precedente compensazione fissa di 160 ms è rimossa: il metronomo
segue i beat della traccia, indipendentemente dal ritardo visivo del piano roll.
Verifica locale: `python scripts/browser_metronome_smoke.py`, con il server
frontend sulla porta 5173; copre valori iniziali, preferenze salvate, on/off e
tempi alle velocità 80%, 90% e 100%. Screenshot a 1366×768 e 390×844 in
`artifacts/metronome`.

Practice is one non-scrolling rehearsal instrument inside `100dvh`, ordered as:

1. compact toolbar: exit, piece/part, speed, accompaniment, settings;
2. selected-part score viewport with a conventional moving score cursor;
3. live pitch lane with a fixed `NOW` line and more future than history;
4. compact transport: previous measure, play/pause, next measure, measure, volume.

Practice always shows one selected vocal part. The full score belongs to the separate, vertically scrolling `score-viewer.html` reading mode and never replaces or reduces the active rehearsal view. La toolbar della prova con spartito e piano roll non mostra **Mostra partitura**; la lettura completa resta raggiungibile da **Mostra partiture** nel menù iniziale.

## Ingresso e navigazione

Il menù iniziale presenta soltanto tre modalità, tutte visibili senza scroll
a 1366×768 e 390×844: **Scegli brano**, **Mostra partiture**, **Esercizi vocali**.
I tre comandi sono centrati sullo sfondo animato di [Lissajous](relax-mode.md),
senza finestra introduttiva. Profilo e impostazioni sono riuniti nell'angolo
superiore destro. I comandi sono subito disponibili anche al primo ingresso.
Con movimento ridotto la scena è ferma e il menù appare subito.
**Scegli brano** apre la scelta **Brani assegnati** / **Tutti i brani**; il secondo
ingresso usa il catalogo esistente, senza introdurre un caricamento di file.
Ogni passo mostra soltanto le proprie scelte e un ritorno **Indietro** in alto
a sinistra, nella posizione del marchio della Home. Dal catalogo si torna alla
scelta tra assegnati e tutti i brani, conservando il brano selezionato; da questa
scelta si torna alle modalità iniziali. Il catalogo di lettura torna direttamente
alle modalità. La scelta della provenienza
non ripete titolo e sottotitolo; la curva mantiene posizione, dimensioni e tempo
della Home anche su mobile. Il catalogo conserva il titolo **Tutti i brani**.
Il titolo riceve il focus per annunciare il passo agli screen reader, senza
un bordo visivo perché non è un controllo. Pulsanti, link e campi mantengono
il focus visibile da tastiera.
La parte SATB viene chiesta al primo ingresso in una prova e poi ricordata nel
profilo dell'account, per brani assegnati, catalogo e laboratorio vocale.

Il repertorio presenta **Brani assegnati**, parte vocale e progressi sintetici,
seguiti da righe di brani con stato e apertura della prova. Non mostra saluto,
"Il mio repertorio", "Da preparare", spiegazioni dello stato o firma animata.
Riusa Georgia per l'unico titolo di pagina e il sans del sistema per controlli,
brani e metadati; non usa pannelli annidati o uno sfondo decorativo.
**Scelta brani** apre direttamente `index.html?menu=sing`, senza tornare al
menù iniziale; **Menù** rimane disponibile in alto a sinistra. Lo stato vuoto
offre un accesso al catalogo tramite la stessa scelta. Verificati stati vuoti
e popolati a 320, 360, 390, 430, 768 e 1366 px, oltre al percorso prova/ritorno.

Il repertorio è una vista di sola lettura: usa il cookie di sessione già verificato
dal Worker e una sola richiesta privata a `/api/progress/repertoire` per parte
vocale, assegnazioni, avanzamento e titoli. Non scarica il client Clerk né attende
la sua inizializzazione. I controlli di sessione e lista autorizzata restano sul
server; dati personali e materiali musicali mantengono `no-store`.
Con sessione scaduta o handshake richiesto torna al flusso di accesso conservando
la destinazione. Un errore o un'attesa oltre 15 secondi mostra **Riprova**, senza
lasciare contemporaneamente un messaggio di caricamento. La disposizione visiva
e il ritorno alla prova restano quelli descritti sopra.

Verifica mirata: `python scripts/browser_repertoire_smoke.py`, anche con
`--directory` sull'artefatto di release. Copre cookie stessa origine, richiesta
unica, sessione scaduta, redirect di handshake, timeout, retry da tastiera e stati
vuoti/popolati a 1366×768 e 390×844. Sono prove con dati sintetici locali;
la latenza autenticata del servizio remoto richiede una verifica dopo il deploy.

La prova apre la toolbar anche su mobile. **Menù**, oppure **Repertorio** se
il brano arriva da lì, è un ritorno diretto. Con toolbar chiusa resta un
controllo equivalente sopra lo spartito. Il menù iniziale nasconde l'intera
superficie musicale già dal primo rendering e prima di riaprirsi, senza
fotogrammi intermedi di spartito o piano roll. Non è un dialogo accessorio:
senza una prova caricata non può essere chiuso su una superficie vuota;
con una prova caricata offre **Torna alla prova**, Escape e backdrop.

I precedenti collegamenti diretti alla partitura dalla prova conservano brano,
parte, beat e inizio della valutazione nel collegamento **Torna alla prova**.
Il ritorno resta in pausa
senza richiedere il microfono. La partitura aperta dal menù torna al **Menù**.
Il comando **Analisi** è visibile anche nella prova mobile in pausa; l'analisi
offre **Prova questo brano** o **Prova da qui** per passare esplicitamente al
brano e al passaggio osservati. Il ritorno alla lista si chiama **Risultati**.

Nella partitura, Spazio fuori dai controlli avvia o mette in pausa l'ascolto.
Quando il focus è su un pulsante, Spazio e Invio attivano quel pulsante;
nei campi e nei dialoghi la scorciatoia globale non avvia l'audio.

## Profilo e uscita

**Il mio profilo** è raggiungibile dal menù iniziale. Le impostazioni della
prova contengono solo Mixer, La mia registrazione, Base e Avanzate. Il profilo
contiene, in ordine, parte SATB, nome, cognome e
**Esci dall’account**. La preferenza vocale personale non modifica sezione
ufficiale, gruppi o autorizzazioni.

**Esci dall’account** apre `/sign-out`: titolo **Esci da Xynon?**, azioni
**Annulla** e **Esci**. Annulla conserva il contesto della prova; Esci chiude
la sessione e porta alla pagina di accesso separata. `/sign-in` e `/sign-up`
mantengono le istruzioni per accedere o registrarsi; una sessione già valida
prosegue direttamente verso la destinazione richiesta.
Audio e microfono vengono fermati prima di navigare. Registrazioni manuali
non salvate e acquisizioni in corso richiedono prima una decisione esplicita.

Le pagine pubbliche condividono la firma Xynon e i token esistenti. Il modulo
Clerk si adatta alla larghezza interna del contenitore anche a 390 px, senza
sporgere dal pannello. La rinomina non cambia l'autenticazione né i consensi.
Il nome tecnico locale `epistrophe-pitch-lab` è conservato come chiave IndexedDB
di compatibilità per non perdere registrazioni presenti nel browser; non è
un'etichetta mostrata all'utente.

Relax mode è rimosso dalla webapp: non esistono più la pagina, gli asset
dedicati o collegamenti nelle impostazioni della prova, della Home e del laboratorio.

## Temporal model

During real accompaniment, `MediaPlaybackClock` reads `HTMLAudioElement.currentTime`; this audio-derived score time is authoritative for score cursor, pitch timeline, transport and mock voice samples. RAF only redraws. The selected-part score is one horizontal continuous system: its cursor follows score time and the sheet translates only enough to keep that cursor visible. In the pitch lane, `NOW_X_RATIO = 0.375` stays fixed and events move right-to-left. These positions are intentionally not geometrically aligned.

Spartito e piano roll interpolano la sola posizione di presentazione fra le letture
audio, così le posizioni ripetute di Chrome con Bluetooth non fermano il cursore e le note
per più frame. Conserva il ritardo visivo impostato e riancora su pausa,
ricerca, buffering e cambio velocità; dopo 120 ms senza avanzamento audio
interrompe la previsione. La valutazione e i campioni vocali usano ancora il
tempo media. L'interpolazione è parte del movimento funzionale della prova,
senza transizioni decorative o nuovi controlli. Vedi la
[verifica sul Samsung](../engineering/pitch-tracking/bluetooth-playback-fix-2026-10-21.md).
Il cursore dello spartito usa il tempo interpolato senza il ritardo aggiuntivo
del piano roll. Anche Mostra partitura usa l'interpolazione limitata: pausa,
seek e buffering interrompono o riancorano il movimento. SATB e accompagnamento
attendono i decoder prima dell'avvio coordinato; una singola lettura irregolare
non provoca più una ricerca nelle tracce vocali. Verifiche e limiti nel
[controllo di sincronizzazione](../engineering/pitch-tracking/shared-playback-sync-2026-10-22.md).

Measure selection stores two positions: playback begins at the preceding performance occurrence and evaluation begins at the selected occurrence. The frontend represents the distinction; scoring remains mocked.

## Pitch semantics

### Diagnostica del rientro

La sezione Assistenza e test audio e il suo comando di registrazione sono
rimossi dalle impostazioni. La calibrazione resta l'unico percorso audio
visibile. Le API e i dati diagnostici salvati conservano il proprio
[contratto di salvataggio](../architecture/echo-diagnostic-storage.md);
non vengono cancellati da questa semplificazione.

### Calibrazione e pitch

La voce calibrata rimane valida nella stessa sessione passando da Home al
brano e riaprendo Base. La navigazione interna non chiude il microfono
appena verificato. Con AEC del dispositivo, caricare un altro brano sulla
stessa catena live conserva la verifica. Base distingue il profilo vocale
salvato dal percorso AEC attivo: riattivare il percorso non equivale a una
nuova misura acustica. Dopo una nuova acquisizione il profilo compatibile si
riapplica automaticamente, senza chiedere un nuovo controllo all'utente.
Il riuso riavvia anche l'analisi vocale: il microfono aperto da solo non
garantisce che la voce venga elaborata e disegnata. La correzione del ciclo
live non richiede di ripetere la calibrazione salvata.
Se il Worker del pitch non risponde entro 1,5 secondi, l'analisi riprende
automaticamente nella pagina con lo stesso detector e le stesse soglie.
Non apre una nuova guida e non modifica il profilo. Le risposte tardive del
Worker abbandonato non aggiornano la voce corrente.

Per la diagnosi delle note tenute esiste una prova esplicita con `?aec=all`:
usa AEC `all` solo nella pagina aperta e mostra **Rientro · prova all**.
L'URL conserva il flag quando cambia il brano. Senza il flag rimane AEC
normale; la scelta non viene salvata come preferenza del dispositivo.
Settings effettivi diversi da quelli richiesti non sono accettati. Il profilo
vocale di `all` ha una catena distinta: il primo utilizzo richiede la guida
unica, conservando il profilo normale. Non è una garanzia di preservazione
del canto; è il percorso per verificarla nel grafo reale dell'app.

**Impostazioni → Base** presenta una sola domanda, **Come ascolti la base?**:
**Cuffie Bluetooth** oppure **Altoparlanti o cuffie con cavo**. Nessuna opzione
è selezionata senza una conferma valida. Il pulsante **(i)** spiega ritardo,
allineamento e rientro; è accessibile con hover, focus e tocco e si chiude con
Escape. La prima opzione usa il percorso cuffie e imposta **Anticipo della
traccia vocale** nelle impostazioni avanzate a **190 ms**, anche al ripristino
del brano e dei valori predefiniti;
la seconda usa il percorso standard con AEC del dispositivo, che copre anche
gli altoparlanti. Questa scelta non seleziona l'uscita del sistema operativo.

La conferma è conservata nel browser per **24 ore esatte**, anche dopo una
ricarica o chiusura della scheda. La lettura non prolunga la scadenza. Alla
scadenza lo stato diventa **Da scegliere** senza interrompere la prova in
corso; alla successiva apertura di un brano viene mostrata la domanda.
Un link diretto al brano segue la stessa regola. Anche Play e Calibra audio
richiedono una scelta valida, senza aprire il microfono prima della conferma.
Chiudere la domanda con ×, Escape o backdrop lascia il brano in pausa e non
conferma nessun dispositivo. La scelta precedente di sessione non viene
trasformata automaticamente in una conferma giornaliera. Se lo storage non
è disponibile, la scelta vale nella pagina aperta e viene comunque fatta scadere.

**Calibra audio** è l'unica azione primaria delle impostazioni. Il profilo
vocale salvato resta separato dalla scelta giornaliera: confermare di nuovo
lo stesso dispositivo non forza una nuova calibrazione. Cambiando catena o
microfono si verifica nuovamente la compatibilità. Su Android, con cuffie
Bluetooth, viene preferito il microfono del telefono quando disponibile.

**Aspetto dello spartito** è aperto per impostazione predefinita; contiene
la dimensione del testo e il colore della carta. Le impostazioni Base e la
domanda d'ingresso entrano nel primo viewport a 1366×768 e 390×844, con target
utili di almeno 44 px. I dialoghi supportano ×, Escape e backdrop.
Verifica: `python scripts/browser_settings_smoke.py`, anche con
`--directory artifacts/settings-redesign/release`, e
`node --test scripts/audio_output.test.cjs`. Screenshot e report in
`artifacts/settings-redesign`.

Nelle impostazioni avanzate, **Aspetto scia** sostituisce il nome tecnico
«Aspetto plume v1». L'intensità predefinita è **160%**, anche con Ripristina
predefinito. Il precedente valore predefinito salvato del 175% migra al 160%;
le altre intensità personalizzate restano salvate. Una scelta esplicita del
175% dopo questa migrazione viene conservata. Il laboratorio vocale riusa
le stesse preferenze della scia.

La prima guida completa dura circa 30 secondi con altoparlanti o cuffie con cavo
e 25 con cuffie Bluetooth.
Con altoparlanti, prima di avviarla si legge **Imposta il volume del dispositivo
al 50%**, con l'indicazione di usare i tasti del telefono o del computer.
Il promemoria **Volume dispositivo consigliato: 50%** è rimosso dal trasporto
della prova, sia con altoparlanti sia con cuffie. Il riferimento rimane nella
guida iniziale; non rappresenta una misura del
volume fisico e non richiede ricalibrazione al cambio volume. I livelli di mixer
e metronomo restano regolabili. Un eventuale avviso prima dell'apertura del brano,
da confermare con **OK**, è una collocazione futura ancora da definire.
Durante countdown e risultati il richiamo al volume della guida è nascosto.
L'istruzione corrente e il countdown della fase dominano; seguono il prossimo
passo e il grafico del livello microfonico (RMS, −72..0 dBFS). Con movimento
ridotto il grafico diventa una barra fissa. Solo le istruzioni, non ogni tick
del timer, sono annunciate. L'analisi mostra uno stato senza un countdown
fittizio. La nota cantata è libera e comoda: non serve imitare un riferimento.

Con altoparlanti si richiede l'AEC nativo, con noise suppression e AGC spenti.
Due fruscii indipendenti, ciascuno di 2 secondi con una pausa di 1 secondo,
verificano il residuo mentre l'utente tace. Il controllo completo del rientro
conserva la durata di 8 secondi. I segnali sono generati localmente, senza
scaricare audio musicale; mantengono campioni e livello della versione
precedente all'esperimento con gli archi, sospeso dopo una segnalazione di
perdita della voce sul dispositivo. I passaggi non stimano una risposta da
sottrarre alla voce. Seguono vocale normale, pausa,
vocale più piano e pausa, con preparazione esplicita. Le regolazioni si
applicano automaticamente solo se superano la verifica indipendente; non
ci sono ulteriori conferme Applica/Cerca profilo/Verifica profilo. I risultati
mostrano recall vocale, specificità delle pause e balanced accuracy della
guida, dichiaratamente diverse dall'accuratezza delle note, e lo stato della
riduzione del rientro del dispositivo. Non si mostrano dB di attenuazione o
ritardi non misurati. Un browser che non applica le impostazioni richieste
invita a usare le cuffie.

Microfono, percorso AEC, contesti e decoder della base sono già
attivi durante la misura e restano attivi per il Play. La base rimane muta
nel warmup e la posizione dello spartito non avanza. Il risultato dichiara
che il microfono resta attivo. Chiusura durante la misura, annullamento,
background e stop rilasciano le risorse. Il profilo vocale locale è isolato
per account/browser/catena e non scade per calendario. Alla nuova apertura,
Play apre il microfono, verifica i settings effettivi AEC e ripristina solo
il profilo della catena realmente acquisita: nessun fruscio, vocale o dialogo
di controllo obbligatorio. Le percentuali ricordate appartengono alla guida
originale e non dichiarano una nuova verifica del residuo. **Rivedi calibrazione**
mostra il profilo salvato; **Ricalibra** resta volontario. Profili di altri account,
microfoni, catene, versioni del detector o preferenze incompatibili non si riusano.
La catena custom sperimentale mantiene la propria misura esplicita.

La catena predefinita non concatena la sottrazione custom all'AEC nativo.
La selezione live del pitch confronta candidati armonici solo se il periodo
completo è acusticamente molto più forte; non usa spartito, nota precedente
o finestre future. Il gate di ammissione e la confidence restano invariati.
Posizione, volume forte, percorsi cambiati e DSP hardware restano limiti
sperimentali. Il best audio resta sospeso con altoparlanti; il test diagnostico
con consenso e salvataggio cloud rimane facoltativo sotto Assistenza.

Audio della calibrazione temporaneo e locale; parametri vocali ricordati senza
scadenza finché il browser conserva i dati e la configurazione resta compatibile.
L'applicazione live termina alla chiusura dell'ingresso; il profilo salvato resta
disponibile per il ripristino automatico, anche con cuffie. La misura acustica
iniziale scade dopo 10 minuti fuori prova, ma la scadenza non blocca il percorso
AEC nativo operativo né riapre la guida.
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
ancorato al punto indicato. Il piano roll non mostra il pulsante **Vista** né
il relativo pannello sovrapposto: esplorazione, zoom e ripristino usano i gesti
diretti e la tastiera, nella prova e nelle analisi.
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
Invio per ascoltarla. La ripresa
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
