# Revisione frontend e UX

Revisione aggiornata il 18 ottobre 2026 su desktop e mobile. La direzione visiva scelta è una sala prove digitale sobria: fondo inchiostro, testo avorio, ambra per le azioni principali, ciano per il focus e verde solo per gli stati positivi. Le superfici operative devono privilegiare spartito, piano roll e dati musicali; i contenitori servono a chiarire la gerarchia, non a riempire la pagina di card.

## Esito per superficie

| Superficie | Desktop | Mobile | Esito e intervento |
| --- | --- | --- | --- |
| Pratica del corista | Buono | Buono | Il piano roll è il contenuto dominante, i controlli restano compatti e i layout hanno test responsive dedicati. |
| Analisi del risultato | Buono | Da monitorare su schermi bassi | Usa il piano roll condiviso, mantiene lo spartito solidale e apre i suggerimenti nel contesto. Aggiunti safe area, focus e riduzione delle animazioni. |
| Direzione | Migliorato | Migliorato | Il programma è una tabella con una riga per brano. La preparazione apre nello stesso contesto chi ha completato e chi deve ancora farlo; la matrice duplicata è stata rimossa. |
| Repertorio personale | Buono | Migliorato | Le card sono giustificate perché ogni brano è un punto di ingresso. Navigazione mobile resa orizzontale e compatta; target tattili e accessibilità uniformati. |
| Laboratorio vocale | Migliorato | Migliorato | Percorso scegliere → preparare → eseguire chiaro. Compattata la preparazione sui desktop bassi e resa persistente l'azione principale su mobile. |
| Visualizzatore spartito | Buono | Buono | Toolbar e zoom hanno focus, safe area e layout responsive già coerenti. |
| Accesso e registrazione | Migliorato | Migliorato | Rimossa la pagina chiara estranea al prodotto; le tre pagine condividono ora un solo foglio di stile coerente con l'app. |
| Revisione amministrativa | Sufficiente | Sufficiente | Aggiunti focus, safe area e riduzione animazioni. Resta volutamente più densa perché è uno strumento interno. |

## Correzioni ad alta priorità completate

1. Una riga per brano nel programma del coro, con ordinamento degli assegnati in testa.
2. Evidenza persistente ma non abbagliante per i brani assegnati.
3. Colonna di preparazione con numero di coristi, percentuale e progress bar.
4. Un solo percorso di analisi del direttore basato sul modulo `PianoRoll`; rimosso il renderer aggregato legacy.
5. Focus da tastiera visibile, target tattili da almeno 44 px, safe area e `prefers-reduced-motion` sulle superfici che ne erano prive.
6. Un solo stylesheet per accesso, registrazione e accesso negato, incluso nel processo di fingerprinting della build.
7. “Comincia” resta interamente visibile nelle preparazioni più dense a 1366 × 768 e diventa un'azione persistente a 390 × 844.
8. Il dettaglio dei coristi si apre dalla preparazione del singolo brano; una sola lista resta espansa e la matrice coristi × repertorio non è più mostrata.

## Miglioramenti successivi consigliati

1. Estrarre i token cromatici e le primitive di shell in un file condiviso. Oggi i valori sono coerenti, ma ripetuti tra `styles.css`, `studio.css`, `cockpit.css` e `repertorio.css`.
2. Aggiungere un'azione “Annulla” dopo la rimozione di un brano dal programma, per evitare conferme bloccanti e rendere l'operazione immediatamente reversibile.
3. Portare anche le primitive del piano roll del laboratorio vocale sul modulo condiviso dove la semantica musicale coincide; il flusso didattico specifico può restare separato.
4. Uniformare la lingua della pagina amministrativa, che contiene ancora etichette in inglese pur avendo istruzioni in italiano.

## Criteri di regressione

- Nessuna pagina deve introdurre scroll orizzontale dell'intero documento a 390 px.
- Le azioni principali mobile devono avere un'area utile di almeno 44 × 44 px.
- L'assegnazione di un brano deve essere riconoscibile senza affidarsi solo al colore: stato testuale, evidenza di riga e descrizione sono presenti insieme.
- Le analisi del corista e del direttore devono usare `frontend/piano_roll.js` per la geometria e il rendering condivisi.
- Le animazioni non essenziali devono diventare istantanee quando il sistema richiede movimento ridotto.
