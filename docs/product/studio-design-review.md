# Studio: direzione visiva e verifica UX

**Status:** canonical
**Owner:** project maintainer
**Last reviewed:** 2026-09-28

## Criteri di progetto

La musica occupa il centro della schermata. Fondo scuro, spartito chiaro,
accento caldo per avanzare, verde acqua per la voce. Tipografia di sistema
per i controlli e serif per il repertorio. Nessun asset remoto richiesto.

Un comando deve descrivere ciò che permette di fare. Formati, algoritmi e
strumenti diagnostici appartengono alle opzioni avanzate. Gli errori reali
rimangono visibili; gli annunci di successo della pipeline non occupano spazio.

Ogni risultato offre una prossima azione e conserva il contesto musicale.
L'ingresso permette di scegliere brano e parte oppure accedere all'allenamento.
Il ruolo precedentemente scelto viene mantenuto.

## Tracker

- [x] Foglio condiviso `frontend/studio.css` per prova e laboratorio.
- [x] Selezione repertorio con gerarchia editoriale e accesso al laboratorio.
- [x] Barra della prova semplificata e strumenti avanzati raccolti nel menu.
- [x] Feedback compatto, spartito visibile e azione successiva esplicita.
- [x] Correzione riepilogo ultima nota e riavvio allenamento guidato.
- [x] Eliminazione traccia residua all'apertura del nuovo esercizio.
- [x] Verifica screenshot desktop e telefono; corretti comandi fuori viewport,
      regole mobile che nascondevano impostazioni e avviso di orientamento che
      alterava la griglia della prova.
- [x] Contrasto dei comandi, focus tastiera e movimento ridotto definiti.

## Verifica ripetibile

Avviare `python scripts/serve_frontend.py --port 5188`, poi eseguire
`python scripts/browser_studio_review.py` e
`python scripts/browser_voice_lab_smoke.py`.

Il primo acquisisce cinque stati a 1440×900, 1366×768 e 390×844 e controlla
overflow e posizione dell'azione principale. Le immagini in
`artifacts/studio-review/` richiedono anche ispezione visiva: il solo test dei
rettangoli non rileva una gerarchia debole o sovrapposizioni interne.
Il secondo verifica il percorso funzionale, inclusi count-in e passaggio al brano.

Questa verifica non sostituisce prove con coristi: comprensione dei comandi,
leggibilità durante il canto e gestione del respiro richiedono uso reale.
