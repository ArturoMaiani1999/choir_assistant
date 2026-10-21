# Audit dei flussi di navigazione

**Status:** nove rilievi corretti, verificati localmente e pubblicati su staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Esito

L'audit iniziale ha rilevato perdita di orientamento tra superfici: alcuni
ritorni riaprono una schermata generica, dimenticano la battuta o lasciano
selezionato un brano diverso da quello appena analizzato. Su mobile manca anche
l'accesso manuale all'analisi dalla prova in pausa. Il solo conteggio dei clic
non intercetta questi problemi.

I nove rilievi sono stati corretti. La richiesta successiva ha precisato il
menù progressivo, la preferenza SATB persistente, la toolbar mobile inizialmente
aperta e la separazione fra accesso e uscita. La verifica usa asset musicali
reali e dati di account sintetici; il login Clerk reale non è stato eseguito.

Pubblicazione su `staging.epistrophe.it` completata il 2026-10-20, inclusa la
migrazione della preferenza SATB. Versione, rollback e verifiche sono nel
[registro del rilascio](../operations/releases/2026-10-20-navigation-ux.md).

## Correzioni e verifica

| Rilievo | Comportamento implementato |
| --- | --- |
| N01 | **Analisi** visibile in pausa anche su mobile, con area touch di 44 px |
| N02 | Ritorno dalla partitura allo stesso brano, parte e beat, in pausa |
| N03 | Listener dei comandi disponibili prima dell'avvio audio |
| N04 | **Repertorio** in un clic, anche con toolbar mobile chiusa; scroll ricordato |
| N05 | **Prova questo brano** / **Prova da qui**, senza avvio del microfono |
| N06 | Tre modalità iniziali interamente visibili, nessuna configurazione audio per entrare negli esercizi |
| N07 | Cronologia coerente fra menù esercizi e preparazione, ritorni sicuri dal take |
| N08 | Sfondo inerte, focus nell'analisi e restituito al comando di apertura |
| N09 | Mixer chiudibile con backdrop, Escape o controllo esplicito |

Il menù segue **Scegli brano → Brani assegnati / Tutti i brani**, oppure
**Mostra partiture**, oppure **Esercizi vocali**. La parte vocale viene chiesta
al primo ingresso nella prova e rimane nel profilo; il catalogo esistente
costituisce l'ingresso custom. Il menù non mostra mai la superficie musicale
sottostante. **Il mio profilo** è la prima impostazione e contiene SATB e
uscita; `/sign-out` presenta **Annulla / Esci** separatamente dal login.

Verifica ripetibile: `python scripts/browser_navigation_smoke.py`.
Il controllo usa clic reali, due viewport (1366×768 e 390×844), API sintetiche
e un sostituto locale dell'SDK per verificare la pagina di uscita. Lo script
storico `browser_navigation_audit.py` ora inoltra a questa regressione.
Gli screenshot aggiornati sono in `artifacts/navigation-fixes`; ad esempio
[menù mobile](../../artifacts/navigation-fixes/home-390.png),
[prova mobile](../../artifacts/navigation-fixes/practice-390.png) e
[uscita](../../artifacts/navigation-fixes/logout-390.png).
La prova musicale non viene avviata nei ritorni: il test verifica zero richieste
del microfono e il recupero di beat 16. Lo smoke del laboratorio verifica
separatamente preparazione, guida vocale, pad, interruzioni e risultati.

Sono stati aggiunti il ritorno dall'uscita al contesto precedente e **Riprova**
nel repertorio. Resta da verificare il percorso di completamento del profilo
da un repertorio privo di sezione, oltre al login con Clerk reale.
Le sezioni successive conservano le evidenze e i conteggi dell'audit iniziale.

## Nome e metodo dell'analisi

Il nome utile per questa attività è **audit dei flussi di navigazione**, o
**user flow audit**, con valutazione dell'**efficienza del compito** (*task
efficiency*) e del **costo di interazione** (*interaction cost*). Fa parte di
una valutazione euristica dell'usabilità. Il *cognitive walkthrough* aggiunge
la domanda: «Una persona al primo utilizzo capirebbe quale azione scegliere e
riconoscerebbe di essere arrivata nel posto giusto?».

La **profondità di navigazione** (*click depth*) misura i passaggi necessari
per raggiungere una destinazione. Non viene imposto un massimo arbitrario:
una scelta comprensibile, un consenso o la protezione di dati non salvati
possono giustificare un passaggio. Sono invece frizioni i passaggi che
obbligano a cercare un comando fuori contesto o ricostruire una scelta già fatta.

I conteggi qui sotto partono dalla superficie indicata, includono l'apertura
dei menù e distinguono lo scorrimento dai clic. Non includono accesso
all'account, autorizzazione del browser al microfono o immissione di testo.

## Ambiente e copertura

- Codice frontend locale corrente; asset musicali reali della build `dist`.
- Chromium con profilo temporaneo, a **1366×768** e **390×844**.
- Account, assegnazioni e risultati sintetici serviti solo da un server locale.
  Nessun accesso ai dati reali dei coristi, nessuna scrittura sul servizio.
- Browser: scelta brani, repertorio, prova, menù, impostazioni, registrazione
  personale e analisi nei due viewport; partitura e Direzione su desktop;
  cronologia del laboratorio vocale.
- Lettura del sorgente: ritorni, routing, chiusure, account e stati di errore.
- **29 screenshot**, osservazioni JSON e uno script ripetibile. Gli hash dei
  sorgenti controllati non sono cambiati durante l'ultima esecuzione.

Per ispezionare le schermate successive delle analisi su mobile, lo script
apre il dialogo tramite JavaScript: l'accesso reale dalla prova è proprio il
problema N01. Questa forzatura non viene conteggiata come un percorso disponibile.
Non sono stati valutati il login Clerk reale, la revisione amministrativa,
la qualità sonora o sessioni di canto complete.

Evidenze:

- [Osservazioni e misure](../../artifacts/navigation-audit/observations.json).
- [Script ripetibile](../../scripts/browser_navigation_audit.py):
  `python scripts/browser_navigation_audit.py` dopo aver preparato `dist`.
- [Sistema visivo](ui-design-system.md) e skill `frontend-skill` come criteri
  di leggibilità, gerarchia e progressive disclosure.

## Rilievi ordinati per priorità

P1 indica un accesso mancante, un blocco o una perdita di contesto nella prova.
P2 indica un percorso utilizzabile ma scomodo o incoerente. P3 indica una
difformità circoscritta. Non sono stime statistiche di frequenza: l'audit non
sostituisce un test con coristi reali.

| ID | Priorità | Compito e comportamento attuale | Costo / impatto | Esito proposto |
| --- | --- | --- | --- | --- |
| N01 | P1 | Aprire manualmente l'analisi dalla prova in pausa su mobile | `Mostra analisi` è nascosto anche con toolbar espansa; il menù non offre un ingresso equivalente | Un ingresso visibile e raggiungibile anche su mobile |
| N02 | P1 | Consultare la partitura e riprendere la prova | 2 clic per andare e tornare, ma la posizione passa da beat 16 a beat 0 | Tornare allo stesso brano, parte e punto della prova |
| N03 | P1 | Usare i controlli della partitura con audio inizialmente bloccato dal browser | Primo clic su Mixer senza effetto; contesto audio ancora sospeso | Collegare i controlli prima di attendere lo sblocco audio |
| N04 | P2 | Tornare ai brani assegnati dopo aver aperto un brano dal repertorio | 2 clic desktop, 3 su mobile con toolbar chiusa; ingresso sotto Impostazioni o attraverso il selettore | Ritorno contestuale al repertorio in 1 clic |
| N05 | P2 | Passare dall'analisi di un best alla pratica di quel brano | 2 chiusure, poi ricerca del passaggio; analizzando un altro brano la prova resta sul precedente | `Prova questo brano` / `Prova da qui` con destinazione esplicita |
| N06 | P2 | Raggiungere il laboratorio dalla selezione iniziale | Su mobile l'ingresso è sotto la piega; a preferenza audio scaduta si apre un secondo dialogo prima del menù esercizi | Ingresso autonomo agli esercizi; configurazione audio al momento pertinente |
| N07 | P2 | Tornare dalla preparazione al menù esercizi con Indietro del browser | Si esce dal laboratorio e si torna alla prova precedente | Stessa gerarchia di ritorno per pulsanti interni e cronologia |
| N08 | P2 | Navigare da tastiera nell'analisi a schermo intero | Tab può raggiungere `Rimuovi` nella pagina Direzione sottostante | Focus nell'analisi e ritorno al comando che l'ha aperta |
| N09 | P3 | Chiudere il Mixer della partitura cliccando fuori | Il dialogo resta aperto; serve `Chiudi` o Escape | Stesso comportamento di backdrop degli altri dialoghi |

### N01 — Accesso all'analisi assente su mobile

Nella prova caricata e in pausa, `#show-feedback` è disponibile su desktop e
non è visibile a 390 px. Espandere la toolbar non lo fa comparire. Nel menù
Impostazioni c'è `La mia registrazione`, che riguarda l'audio personale, ma
non un ingresso equivalente ai best e alla relativa analisi.

Questo rilievo riguarda l'apertura manuale in pausa: non dimostra che l'analisi
automatica a fine esecuzione non funzioni.

La regola mobile di [styles.css](../../frontend/styles.css) nasconde in modo
generale `.mode-button`; manca un'eccezione per questo comando. Screenshot:
[toolbar mobile espansa](../../artifacts/navigation-audit/practice-mobile-toolbar-expanded.png),
[stessa prova su desktop](../../artifacts/navigation-audit/practice-from-repertoire-1366.png).

Accettazione: dalla prova in pausa si raggiunge l'analisi manuale anche su
mobile, con un controllo riconoscibile di almeno 44 px; non è necessario
avviare e completare una nuova esecuzione per trovare i risultati.

### N02 — La partitura interrompe il punto di studio

Riproduzione: aprire Ave verum, avanzare quattro volte con `Battuta successiva`,
aprire `Mostra partitura`, quindi premere `Canta brano`.

La misura osservata passa da **beat 16 / 15 secondi** a **beat 0 / 0 secondi**.
Il brano e la parte P3 sono rimasti gli stessi nella prova; la parte viene
recuperata dalla preferenza locale, non dal collegamento di ritorno.

Il collegamento in [score_viewer.js](../../frontend/score_viewer.js), funzione
`openPiece`, conserva solo `piece`. Il caricamento della pratica in
[app.js](../../frontend/app.js), funzione `loadPracticePiece`, ricrea il clock
e azzera il checkpoint.

Accettazione: consultare e chiudere la partitura ripristina il contesto della
prova, mantenendola in pausa. Cambiare deliberatamente brano nella partitura
deve rendere esplicita la destinazione del ritorno.

### N03 — Controlli visibili prima che l'inizializzazione sia finita

Nel profilo Chrome nuovo, senza il flag che permette autoplay, la partitura
risulta già visibile e l'audio ha metadata disponibili (`readyState = 4`).
Il primo clic reale su Mixer non apre il dialogo. Il contesto Web Audio risulta
`suspended`. Dopo uno sblocco del contesto con gesto utente simulato attraverso
CDP, lo stesso controllo funziona.

La causa suggerita dal sorgente è l'attesa di `mixer.resume()` in `applyMix`,
raggiunta da `openPiece`, prima di collegare i listener dei comandi in
`initialize`. È un'inferenza dal flusso e dal risultato del probe; non è una
verifica su tutti i browser o sui profili abituali dei coristi.

Riferimenti: [score_viewer.js](../../frontend/score_viewer.js) e
[media_mixer.js](../../frontend/media_mixer.js). Probe JSON: `viewerFirstClick`.

Accettazione: Mixer, zoom e selezione del brano rispondono anche con audio
sospeso. Lo sblocco audio viene richiesto quando l'utente avvia l'ascolto.

### N04 — Il repertorio è trattato come un'impostazione

Il repertorio apre correttamente il brano nella parte del corista in un solo
clic. Il viaggio di ritorno non conserva questa provenienza:

```text
Desktop: prova → Impostazioni → Il mio repertorio
Mobile, toolbar chiusa: prova → mostra comandi → Impostazioni → Il mio repertorio
Alternativa desktop: prova → Scelta brani → Brani assegnati
```

Su mobile `Scelta brani` non compare: il selettore si apre toccando il titolo
del brano nella toolbar espansa. Anche questo percorso richiede tre azioni
prima del repertorio.

Il problema non è solo il clic aggiuntivo: l'utente cerca una destinazione di
navigazione tra regolazioni di audio e microfono. La provenienza non è presente
nel link prodotto da `practiceHref` in [repertorio.js](../../frontend/repertorio.js).

Screenshot: [ritorno al selettore generico](../../artifacts/navigation-audit/return-from-repertoire-1366.png),
[menù mobile](../../artifacts/navigation-audit/settings-menu-390.png).

Accettazione: un brano aperto dal repertorio offre un ritorno diretto al
repertorio, conservandone posizione e contesto; la navigazione principale resta
accessibile con la toolbar mobile chiusa o attraverso un comando chiaramente nominato.

### N05 — Dall'analisi manca un passaggio diretto alla pratica

Il percorso desktop per aprire un best è breve: `Mostra analisi` →
`Apri analisi`, con eventuale scorrimento della lista. Il ritorno usa invece
`Analisi` → `Chiudi`, quindi bisogna cercare nuovamente il passaggio e avviare
la prova. Non c'è un comando che trasformi il punto osservato nell'analisi in
un punto da esercitare.

La lista `I miei` include best di brani diversi. Nel probe è stato aperto il
best di **O sacrum convivium** partendo dalla prova di **Ave verum**. Tornando
alla prova rimane **Ave verum**. Conservare la prova precedente può essere
legittimo; manca però un'azione distinta per esercitare il brano appena analizzato.

Riferimenti: `loadOwnPerformances` e `openPerformanceAnalysis` in
[app.js](../../frontend/app.js). Probe: `otherBestTitle`, `pieceAfterOtherBest`.
Screenshot: [ritorno alla prova precedente](../../artifacts/navigation-audit/other-best-return-practice.png).

Accettazione: il ritorno alla lista si chiama `Risultati`; un'azione separata
`Prova questo brano`, o `Prova da qui` con un passaggio selezionato, apre il
brano, la parte e la battuta corretti senza avviare automaticamente il microfono.

### N06 — Gli esercizi sono subordinati alla scelta del brano

Nel selettore iniziale mobile, il blocco introduttivo, il repertorio e i due
campi del brano precedono i tre ingressi. `Allena la voce` arriva sotto il
bordo visibile del dialogo. La testata della prova sottostante non è utilizzabile
finché il dialogo è aperto.

Inoltre, senza una conferma audio valida, cliccare `Allena la voce` apre
`Come ascolti l'audio?` sopra il selettore, prima ancora di raggiungere il menù
degli esercizi. Sono due dialoghi aperti. Il laboratorio ha poi il proprio
passaggio di configurazione vocale al primo avvio.

È appropriato raccogliere configurazioni necessarie; è scomodo interrompere
una semplice navigazione verso il catalogo. Il costo è un clic più lo
scorrimento per trovare l'ingresso, e un'ulteriore scelta quando la conferma
audio non è valida.

Screenshot: [selettore mobile](../../artifacts/navigation-audit/picker-390.png),
[dialogo intermedio](../../artifacts/navigation-audit/voice-entry-audio-prompt.png).
Riferimento: `bindLibraryPicker` in [app.js](../../frontend/app.js).

Accettazione: `Brani assegnati`, `Scegli un brano` ed `Esercizi vocali` sono
destinazioni distinte e immediatamente riconoscibili. Le scelte di ascolto
restano nel punto in cui servono alla prova, preservando le relative correzioni
di latenza.

### N07 — Indietro del browser salta il menù esercizi

I nuovi pulsanti interni `Esercizi`, `Precedente`, `Successivo` e `Prepara`
risolvono la navigazione esplicita. Resta però un comportamento diverso per
Indietro del browser o del dispositivo: da `#prepara` si torna alla pagina
di pratica precedente, senza attraversare `#scegli`.

`showScreen` in [voice_lab.js](../../frontend/voice_lab.js) usa
`history.replaceState`; i cambi di schermata non producono voci della
cronologia e non esiste un gestore di ripristino dei relativi stati.
Il probe ha eseguito anche il ritorno alla voce precedente della cronologia.

Accettazione: tornare indietro dalla preparazione riapre il menù; durante una
take interrompe in sicurezza audio e microfono; la cronologia non deve creare
riavvii accidentali di registrazioni né un numero eccessivo di tappe tecniche.

### N08 — Il focus resta fuori dall'analisi a schermo intero

Nel percorso Direzione → Analisi è stato usato un clic reale. L'apertura non
porta il focus dentro la superficie; premere Tab raggiunge **Rimuovi** nella
tabella sottostante, coperta dall'analisi. Escape chiude l'analisi, ma il focus
non torna al pulsante che l'ha aperta.

La superficie è una `section`; `refs.shell.focus()` in
[performance_review.js](../../frontend/performance_review.js) non la rende
focalizzabile. La pagina sottostante non viene resa `inert` e `close` non
memorizza né ripristina il controllo d'origine.

Accettazione: all'apertura il focus entra in un comando dell'analisi; Tab resta
tra i controlli della superficie corrente; alla chiusura si torna al pulsante
Analisi del brano corretto. La stessa regola vale per il corista.

### N09 — Chiusura del Mixer partitura diversa dagli altri dialoghi

Dopo aver sbloccato l'audio per completare l'ispezione di N03, il Mixer della
partitura si apre. Un clic reale all'esterno lascia il dialogo aperto.
`Chiudi` è presente e funziona; manca la gestione del backdrop usata negli
altri dialoghi. Il mixer cambia impostazioni applicate immediatamente e non
presenta dati da salvare che giustifichino il blocco.

Riferimento: `initialize` in [score_viewer.js](../../frontend/score_viewer.js).
Probe: `viewerBackdropStillOpen = true`.

Accettazione: `Chiudi`, Escape e backdrop chiudono e restituiscono il focus
al comando Mixer, come richiesto dal sistema di interazione del progetto.

## Osservazioni secondarie dal sorgente

Questi punti non sono inclusi nei nove rilievi verificati nel browser:

- **Cambio account:** `Account e accesso` apre `/sign-in` senza `return_url`.
  Il client di autenticazione accetta il parametro, ma in sua assenza usa `/`.
  Il ritorno al brano o alla schermata precedente non è quindi espresso dal
  percorso attuale. Da verificare con Clerk reale, incluso il cambio utente.
- **Errori e stati vuoti del repertorio:** il caricamento fallito offre un
  messaggio senza `Riprova`; il profilo incompleto invita a completare il
  profilo senza un collegamento diretto nella pagina. Da verificare con fixture
  dedicate di errore e account senza parte vocale.

## Passaggi che hanno una ragione e vanno conservati

- Aprire un brano assegnato seleziona già la parte corretta: nessun ulteriore
  selettore necessario in quel percorso.
- La toolbar mobile può essere chiusa per dare più spazio alla musica; per
  richiesta successiva dell'utente ora entra aperta. I ritorni restano visibili.
- La registrazione manuale è secondaria rispetto al best automatico:
  l'espansione è coerente con la progressive disclosure. Consenso al
  salvataggio e conferma delle cuffie non sono clic da eliminare.
- I blocchi su una registrazione non salvata o su un invio in corso proteggono
  il lavoro; devono spiegare come proseguire.
- Calibrazioni e parametri avanzati possono restare più profondi delle azioni
  quotidiane. Non serve trasformare la toolbar in una lista di strumenti.

## Direzione proposta e ordine di intervento

Tesi visiva: conservare la sala prove sobria, con musica dominante e una
navigazione compatta che dica dove ci si trova e dove si torna.

Gerarchia: destinazione corrente → contesto del brano/parte → contenuto
musicale → azione del compito; regolazioni e diagnosi restano secondarie.

Interazione: i ritorni conservano il contesto, i dialoghi usano chiusure
coerenti e il focus segue la superficie visibile. Il passaggio tra modalità
non deve avviare audio o microfono automaticamente.

Ordine suggerito:

1. Ripristinare l'accesso mobile all'analisi e rimuovere la dipendenza dei
   controlli della partitura dallo sblocco audio: N01, N03.
2. Conservare il punto di studio e aggiungere ritorni contestuali al repertorio:
   N02, N04.
3. Collegare analisi e pratica con una destinazione esplicita: N05.
4. Rendere autonomo e riconoscibile l'ingresso agli esercizi, allineando il
   comportamento di Indietro: N06, N07.
5. Correggere focus e chiusure condivise: N08, N09.

La verifica successiva dovrebbe misurare completamento del compito, tempo,
ritorni involontari e numero di passaggi con pochi coristi, incluso un
principiante. L'audit identifica i punti da correggere; non dimostra da solo
quali modifiche saranno più facili da capire per gli utenti reali.
