# Stati UX, interruzioni ed edge case della prova

## Obiettivo

Una prova vocale deve restare comprensibile anche quando il browser, il sistema operativo o il dispositivo interrompono il microfono. Il corista non deve chiedersi se il tempo stia continuando, se la voce venga ancora ascoltata o se la posizione sia stata persa.

Regola principale: quando l’ascolto non è affidabile, il clock musicale si ferma. La posizione viene conservata e l’utente può riprendere con un gesto esplicito.

## Stati della sessione

| Stato | Significato per il corista | Microfono | Clock | Azione primaria |
|---|---|---:|---:|---|
| `idle` | Prova pronta | spento | fermo all’inizio | Avvia la prova |
| `starting` | Richiesta permesso e preparazione audio | in apertura | fermo | Attendi |
| `running` | Prova in corso | acceso | avanza | Metti in pausa |
| `paused` | Pausa richiesta dall’utente | spento | fermo | Riprendi la prova |
| `interrupted` | Browser o dispositivo ha interrotto la prova | spento o non affidabile | fermo | Riprendi la prova |
| `complete` | Fine del timeline | spento | fermo alla fine | Ripeti la prova |
| `error` | Avvio impossibile | spento | fermo | Riprova dopo la correzione |

## Interruzioni prioritarie

### Cambio scheda, app in background o schermo bloccato

Rischio: `requestAnimationFrame` rallenta o si ferma, mentre il clock basato su tempo monotono continuerebbe a saltare in avanti al ritorno.

Comportamento implementato: pausa automatica immediata su `document.visibilityState === "hidden"`; conservazione del beat; rilascio del microfono; messaggio che spiega la sospensione.

### Chiamata, assistente vocale o sospensione dell’audio

Rischio: il sistema sospende l’`AudioContext` o silenzia temporaneamente la traccia.

Comportamento implementato: fermare il clock; mostrare una spiegazione breve; richiedere un gesto per riprendere.

### Microfono scollegato o traccia terminata

Rischio: la UI rimane “In prova” senza ricevere campioni.

Comportamento implementato: passaggio a `interrupted`, clock fermo, indicazione che il microfono non è più disponibile e azione di ripresa.

### Permesso negato

Rischio: errore tecnico poco comprensibile o richiesta ripetuta senza indicazioni.

Comportamento implementato: stato `error`, istruzione per riabilitare il permesso dalle impostazioni del sito, nessun avanzamento del cursore.

### Microfono silenziato

Rischio: stream formalmente attivo ma campioni nulli.

Comportamento implementato: pausa automatica e messaggio che indica le possibili cause di sistema, privacy o tasto fisico.

### Silenzio prolungato

Rischio: il corista non capisce se il microfono funziona o se semplicemente non viene rilevata una nota.

Comportamento implementato: dopo tre secondi di RMS molto basso, mostrare “Non sento ancora la voce” senza fermare il clock. Il silenzio può essere musicalmente corretto e non viene trattato come errore.

### Pausa o assenza di target nello spartito

Rischio: confrontare la voce con un fallback arbitrario, per esempio La4, durante una pausa.

Comportamento implementato: nessun calcolo dei cent quando non esiste un `TargetEvent` attivo; cursore coerente; messaggio “Pausa musicale”; nessuna valutazione negativa.

### Fine esercizio

Rischio: microfono lasciato aperto o cursore oltre l’ultima misura.

Comportamento implementato: clock fermo esattamente alla fine, microfono rilasciato, stato `complete`, posizione valida nell’ultima misura e azione “Ripeti la prova”.

### Score non caricato o JSON non valido

Rischio: avvio della prova con timeline vuoto o dati incoerenti.

Comportamento corrente: fallback simbolico esplicitamente tecnico nel prototipo. Nel prodotto pubblicato resta da implementare il blocco dell’avvio con messaggio di disponibilità. Il target non viene mai derivato dall’audio.

### Orientamento e ridimensionamento

Rischio: il playhead esce dal viewport dopo rotazione dello smartphone.

Comportamento implementato: ricalcolo dello scroll verso la battuta attiva; nessuna modifica del clock.

### Chiusura o ricaricamento pagina

Rischio: microfono lasciato impegnato fino al cleanup del browser.

Comportamento implementato: rilascio esplicito degli stream su `pagehide`. Il salvataggio della posizione sarà introdotto quando esisterà un’identità utente.

## Feedback e tono

- Evitare messaggi colpevolizzanti.
- Distinguere “non sento voce”, “segnale instabile” e “nota non centrata”.
- Non usare solo il colore: ogni stato ha sempre una frase.
- Mantenere Hz, RMS e cents nei dettagli tecnici.
- Usare apostrofi tipografici e accenti italiani corretti nella UI.

## Criteri di accettazione della tranche

1. Nascondere la scheda durante una prova ferma il clock e conserva la posizione.
2. Una traccia muta o terminata non lascia la UI nello stato “In prova”.
3. La ripresa richiede un gesto e riapre il microfono.
4. Durante una pausa simbolica non viene calcolata alcuna deviazione rispetto a La4.
5. Il silenzio prolungato genera un suggerimento, non un errore.
6. La rotazione riporta la nota attiva nel viewport.
7. La fine esercizio chiude il microfono.
