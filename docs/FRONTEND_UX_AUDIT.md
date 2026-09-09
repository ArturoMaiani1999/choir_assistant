# Audit frontend e UX

Data audit: 8 settembre 2026

## Contesto deciso

- Utente primario: corista.
- Dispositivo prioritario: smartphone.
- Attività principale: provare la propria parte seguendo lo spartito con un cursore sincronizzato.
- Tono visivo: equilibrio tra tradizione corale ed energia contemporanea.
- Feedback: sobrio, leggibile, non competitivo in questa fase.
- Lingua dell'interfaccia: italiano.

## Stato osservato

Il frontend attuale è un laboratorio tecnico a pagina singola. Mostra un target simbolico, tre metriche numeriche, un grafico del pitch, due controlli separati per microfono e timeline e informazioni diagnostiche sempre visibili. La palette scura è coerente, ma l'interfaccia comunica uno strumento di sviluppo più che una sessione di prova musicale.

Il detector e il runtime simbolico funzionano. Il problema principale non è quindi la tecnologia di base, ma la gerarchia dell'esperienza: oggi il dato tecnico domina, mentre lo spartito e il flusso del corista sono assenti.

## Gap fondamentali

### 1. Lo spartito non è il centro dell'esperienza

Non esiste ancora un renderer musicale. Il canvas corrente visualizza una traiettoria di frequenza, non la notazione. Per un corista mancano pentagramma, note, testo, parte selezionata, misura corrente e contesto prima/dopo la nota attiva.

Priorità: critica.

### 2. Manca un cursore musicale comprensibile

Misura e beat sono mostrati come testo, ma non sono collegati graficamente alle note. Il cursore scelto sarà una fascia verticale ambra, accompagnata dall'evidenziazione della nota attiva. In futuro il viewport dello spartito dovrà scorrere mantenendo il cursore in una zona stabile dello schermo.

Priorità: critica.

### 3. Il flusso di avvio è frammentato

“Avvia microfono” e “Avvia timeline” sono due azioni tecniche separate. Il corista si aspetta una sola azione: “Avvia la prova”, con gestione automatica di permesso microfono, conto alla rovescia, clock e playback.

Priorità: alta.

### 4. La lingua è inglese e il tono è da prototipo

Titoli, stati, errori, privacy, metriche e benchmark sono in inglese. Espressioni come “Pitch lab”, “development runtime” e “first vertical slice” non appartengono all'esperienza finale. Tutta la microcopy deve essere italiana, naturale e coerente negli accenti e negli apostrofi.

Priorità: alta.

### 5. La gerarchia privilegia frequenze e diagnostica

Hz, cents, RMS, confidence e dettagli della periferica sono utili durante lo sviluppo, ma non devono essere il primo livello informativo. Il corista deve vedere prima: nota attesa, intonazione qualitativa, posizione nello spartito e stato della prova. I dettagli tecnici vanno raccolti in una sezione espandibile.

Priorità: alta.

### 6. Il layout non è realmente mobile-first

Il breakpoint impila due card desktop, ma non ripensa l'interazione per il pollice, l'altezza utile, il viewport dello spartito o i controlli persistenti. Mancano una barra di trasporto raggiungibile, target touch adeguati, safe-area e comportamento in orientamento orizzontale.

Priorità: alta.

### 7. Manca identità emotiva

La palette tecnica ciano/arancio è funzionale ma poco musicale. Non ci sono riferimenti visivi a respiro, voce, carta, direzione o coralità. Serve una direzione sobria: fondo blu-notte, superficie spartito avorio, accento ambra per il tempo e turchese per la voce.

Priorità: media.

### 8. Gli stati dell'esercizio sono incompleti

Sono presenti idle, listening, muted e una stima vocale, ma mancano caricamento spartito, richiesta permesso, conto alla rovescia, pausa, fine esercizio, assenza target, errore score, ripresa e risultato sintetico.

Priorità: alta.

### 9. Feedback visivo poco pedagogico

“Sharp/flat” e cents sono informazioni corrette, ma manca una rappresentazione immediata della direzione di correzione. Serve un indicatore centrale con zona intonata e deviazione laterale, mantenendo i cents come dettaglio secondario.

Priorità: media.

### 10. Accessibilità e leggibilità non sono formalizzate

Mancano focus states evidenti, annunci `aria-live`, preferenza reduced motion, contrasto verificato per tutti gli stati e alternative al solo colore. Anche le dimensioni minime dei controlli su smartphone vanno rese sistematiche.

Priorità: alta.

### 11. Nessuna separazione tra esperienza corista e strumenti di sviluppo

Percorso del PDF, nome della fixture e diagnostica audio compaiono nella schermata principale. Queste informazioni devono restare disponibili, ma dietro un pannello “Dettagli tecnici” o in una route dedicata al laboratorio.

Priorità: media.

### 12. Il renderer reale resta non implementato

La prima tranche visuale può usare un pentagramma SVG semplificato alimentato dagli eventi simbolici. Non va presentato come rendering editoriale dello spartito. Il renderer definitivo dovrà leggere il MusicXML approvato, restituire mapping grafico evento-elemento e supportare lyrics, sistemi, parti e selezione della misura.

Priorità: critica per il prodotto, non bloccante per il prototipo UX.

## Direzione visiva proposta

Nome di lavoro: **Coro Vivo**.

Principi:

- lo spartito è la superficie più luminosa e ampia;
- ambra = tempo, cursore e target;
- turchese = voce rilevata;
- verde tenue = intonazione corretta;
- testo tecnico ridotto e subordinato;
- angoli morbidi ma non giocattolosi;
- tipografia editoriale per titoli musicali e sans-serif leggibile per controlli e dati.

## Piano di esecuzione

### Tranche 1 — rehearsal screen mobile-first

- localizzazione completa in italiano;
- nuova gerarchia con spartito dominante;
- pentagramma SVG di sviluppo alimentato dal runtime;
- playhead verticale e nota corrente evidenziata;
- singola azione “Avvia la prova”;
- feedback vocale sintetico;
- diagnostica raccolta in un pannello espandibile.

### Tranche 2 — trasporto e navigazione

- pausa, ripresa e riavvio;
- seek per misura;
- conto alla rovescia;
- velocità 100%, 75%, 50%;
- clock canonico condiviso con score cursor e scoring.

### Tranche 3 — renderer MusicXML reale

- integrazione di un renderer selezionato;
- mapping tra elementi grafici e `TargetEvent`;
- scorrimento automatico per sistemi;
- lyrics e selezione della parte;
- gestione grafica delle occorrenze ripetute.

### Tranche 4 — sessione e risultati

- feedback per frase e misura;
- riepilogo sobrio della sessione;
- salvataggio locale dei tentativi;
- accessibilità e test su dispositivi reali.

## Criteri di successo della prima tranche

- un corista comprende in meno di cinque secondi cosa fare;
- lo spartito occupa la parte dominante dello schermo;
- avvio e arresto richiedono un solo controllo principale;
- nota attiva e posizione temporale sono visibili sul pentagramma;
- il feedback non richiede di interpretare Hz o RMS;
- tutti i testi visibili sono in italiano corretto;
- detector e target simbolico continuano a funzionare come prima.
