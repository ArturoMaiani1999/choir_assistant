# S25+: prima acquisizione controllata della calibrazione

**Status:** tre probe acquisiti; calibrazione accettata a 8/15; salto di ritardo riprodotto a 11/15; tracking live da implementare e validare  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Dati e condizioni

Samsung S25+, Chrome, Santo, account e parte del tenore della prova. Telefono
fermo, silenzio e volume di sistema circa 75% confermati dall'utente. Il valore
non è stato letto dal sistema operativo. Master dell'app al 62%: riferimento
del probe con picco circa 0,04960. Due rumori indipendenti, 3–6 s e 7–9 s,
più preparazione e code. Sono stati acquisiti 480.000 frame per canale a
48 kHz, microfono e riferimento app sullo stesso worklet. Nessun canto.

Build: `20261020-104105-46c4b97f1322-dirty`. Artefatto privato:
`artifacts/echo-lifecycle/device-probe-20261020-105630/capture.npz`.
SHA-256: `4a3fb9f332091a9ca79149de82bba820846790a3c4adacf67cc7946cf46a1634`.
La guida è stata fermata prima di richiedere il canto. Il test non modifica
registrazioni o punteggi di esecuzione.

L'acquisizione automatica è ripetibile con
`python scripts/probe_android_calibration.py --run`, dopo conferma di silenzio,
posizione e volume. Richiede ADB con forward CDP su 9223 e Chrome in primo
piano. Il solo comando senza `--run` legge lo stato, senza avviare audio.

## Risultati acquisiti

| Misura | Risultato | Limite dell'interpretazione |
| --- | --- | --- |
| Ritardo del picco, primo e secondo rumore | 150,125 ms in entrambi | Picco della risposta; non è la somma delle latenze dichiarate dalle API |
| Ritardo in finestre di 250 ms, banda 100 Hz–10 kHz | circa 150,277–150,280 ms | Stima GCC pesata; valore diverso dal picco della risposta per il diverso peso spettrale |
| RMS microfono durante i rumori | circa 0,213–0,230 | Scala digitale normalizzata; nessuna misura SPL |
| Picco microfono | 1,0 | Al limite di rappresentazione dell'ingresso |
| Campioni con valore assoluto ≥0,98 | 5 / 480.000 | 3 nel primo rumore e 2 nel secondo; non dimostra che tutto il residuo sia causato dal clipping |
| Esito dell'algoritmo di produzione sul computer | `clipping`, filtro assente | Il veto scatta anche con un solo campione sopra soglia |
| Replay dello stesso PCM nel Worker del telefono | `clipping`, risposta in circa 817 ms | Include creazione/caricamento del Worker; non è un benchmark isolato del fit |

Nelle finestre di questo probe non emerge un salto ampio del ritardo. Questa
osservazione dura soltanto 10 s e riguarda la fase di calibrazione: non
dimostra stabilità al Play, con il brano o durante il canto. Le stime in
bande diverse hanno offset costanti per la risposta acustica/frequenziale;
non vanno interpretate come quattro latenze indipendenti del dispositivo.

## Sensibilità offline: veto clipping escluso

Per capire se i dati contengano un percorso identificabile è stato eseguito
un secondo fit offline della stessa implementazione, escludendo soltanto il
veto iniziale sui campioni ≥0,98. Nessuna modifica al codice distribuito e
nessun filtro di questo esperimento applicato sul telefono.

Il modello ricava H esclusivamente dal primo rumore e dalla sua coda,
3–7 s; 7–10 s rimane il secondo segnale indipendente. Risultati:

- riduzione sul train: **18,50 dB**;
- riduzione sul secondo segnale: **17,87 dB**;
- picco di H: **150,125 ms**;
- RMS del silenzio usato dal fit: circa **0,00234**.

È un'analisi esplorativa su acquisizione non qualificata. Non autorizza a
ignorare la saturazione in produzione, né soddisfa l'obiettivo di almeno
20 dB del protocollo. Non ci sono label F0 e non è stata misurata la
preservazione della voce. Il grafico è nell'artefatto privato
`probe-analysis.png`; risultati in `desktop-fit.json`,
`desktop-fit-clipping-sensitivity.json` e `phone-worker-replay.json`.

## Blocco operativo distinto dal DSP

Il primo tentativo completo sul telefono ha acquisito il PCM, ma il Worker
non ha consegnato un risultato entro il limite di analisi. Lo storico mostra
annullamento circa 26 s dopo l'inizio della misura. Il successivo replay
risponde rapidamente: non c'è evidenza che serva semplicemente aumentare il
timeout di calcolo. Caricamento e scheduling iniziali restano cause possibili;
il log precedente non permette di distinguerle.

Sono inoltre stati osservati errori DNS, una traccia MP3 rimasta in errore
dopo il ripristino della rete e sospensione della scheda quando Android
mostrava un'altra app. Sono problemi separati dal modello acustico. Il
rilascio successivo prepara e verifica il Worker prima di emettere rumore,
registrando caricamento, disponibilità, analisi, risultato e timeout come
eventi distinti. Il veto clipping e il fit restano invariati.

## Confronto sulla stessa nuova build: 8/15 e 11/15

Dopo la correzione del caricamento sono stati acquisiti altri due probe sulla
build `20261020-110249-46c4b97f1322-dirty`. Stesso core acustico, master al 62%,
stessi semi e intervalli dei rumori. Telefono fermo e silenzio riconfermati.
ADB legge il volume effettivo prima/durante/dopo e lo ripristina a 11/15.
Ogni misura apre una nuova catena e identifica un nuovo H: non è un confronto
fra due livelli con un filtro già stimato all'altro livello.

| Misura | Volume 8/15 | Volume 11/15 |
| --- | --- | --- |
| Artefatto sotto `artifacts/echo-lifecycle` | `device-probe-20261020-111407` | `device-probe-20261020-111510` |
| Picco microfono | 0,66171 | 0,99179 |
| Campioni con valore assoluto ≥0,98 | 0 | 1 |
| Esito produzione sul telefono | Accettata | Rifiutata: `clipping` |
| Riduzione train | 24,44 dB | 20,91 dB nell'esperimento senza veto |
| Riduzione verifica 7–10 s | **22,81 dB** | **−1,82 dB** nell'esperimento senza veto |
| Ritardo primo rumore | 149,396 ms | 150,354 ms |
| Ritardo nel secondo rumore | Stabile a 149,396 ms | Passa a **156,354 ms**, salto di **288 frame / 6 ms** |

Il campione 0,99179 supera la soglia precauzionale del core ma non dimostra,
da solo, un clipping duro dell'ADC. Il primo probe arrivava invece a 1,0.
I picchi e il salto temporale sono osservazioni distinte. Un solo confronto
ordinato 8→11 non dimostra che il volume causi il salto di ritardo.

SHA-256 degli NPZ:

- 8/15: `457cbc8f9838207fe61f2eb73aa9460c77e0848010f7119125cf51d268c4460b`;
- 11/15: `0e42355c396b8640667d5377c98889bf85a9b910db1487e9b7d2f0a476f8fcab`.

Nel probe accettato lo storico mostra disponibilità del Worker circa 562 ms
dopo l'avvio del caricamento, analisi circa 202 ms dopo l'invio del PCM e
applicazione del modello sul grafo. `appliedGain=1` e modello identificato
sono confermati nello snapshot prima dell'annullamento tecnico della guida.
La guida tecnica viene poi interrotta prima del canto: questo non equivale
a una calibrazione vocale completa salvata per l'uso normale.

## E2: isolamento del salto temporale sullo stesso PCM

Il salto avviene circa a 7,5–7,6 s, durante il secondo rumore. Non sono stati
trovati un tratto di 6 ms di zeri o una copia esatta di un blocco nel segnale;
l'origine hardware, browser o bridge dell'ingresso resta da isolare.

Esperimento di sviluppo sul probe 11/15, con veto iniziale escluso solo nella
VM offline e H rifiutato conservato soltanto per analisi:

1. H stimato con il primo rumore, 3–7 s.
2. Ritardo stimato confrontando previsione e microfono in 7,75–8,05 s:
   **+288 frame / +6 ms**.
3. Previsione ritardata solo da 8,2 s, con transizione di 15 ms; nessuna
   modifica di guadagno, forma di H, microfono o regione temporale valutata.
4. Confronto in **8,3–10 s**: filtro fisso **−3,08 dB**, solo ritardo
   **21,94 dB**. Sul tratto attivo 8,3–8,9 s: −3,03 → 22,91 dB.

La scelta della finestra segue l'esplorazione del dato: è un'ablation di
sviluppo, non una prova cieca. La finestra che stima il ritardo non include
i campioni valutati. Una finestra iniziale 7,2–7,8 s, attraversando il salto,
aveva stimato erroneamente zero: il rilevatore deve trattare i cambi di
regime, non mediare indiscriminatamente le osservazioni.

**Limite decisivo:** sull'intero secondo rumore 7–10 s, la correzione tardiva
porta soltanto −1,82 → **1,95 dB**, perché lascia deteriorato il tratto prima
di 8,2 s. I 21,94 dB successivi non sono l'ERLE dell'intera prova. La prossima
implementazione deve ridurre il tempo di rilevamento/riallineamento e
misurare anche il danno del transitorio. Non ci sono dati vocali in questi
probe e non viene dichiarata accuratezza F0 o preservazione della voce.

Replay ripetibile:

```powershell
python scripts/analyze_android_probe.py artifacts/echo-lifecycle/device-probe-20261020-111407/capture.npz
python scripts/analyze_android_probe.py artifacts/echo-lifecycle/device-probe-20261020-111510/capture.npz --clipping-sensitivity --plot
```

Il comando scrive `analysis.json` e, quando richiesto, `analysis-delay.png`
accanto al dato. Il core distribuito non viene modificato.

## Decisione e prossimo esperimento

La priorità torna a **E2, tracking del ritardo relativo durante l'uso**:
un filtro corretto perde efficacia quando il percorso si sposta di 6 ms.
La calibrazione iniziale deve restare unica; una costante per modello di
telefono o un offset fisso di 6 ms non risolverebbero i cambi osservati.

Il candidato deve stimare unicamente l'allineamento del riferimento noto,
con controllo di eccitazione, confidenza e doppia voce, aggiornare il tempo
della previsione e conservare il coefficiente unitario della voce. I test
devono includere salti positivi/negativi, transizioni, assenza di riferimento,
metronomo, note tonali e canto in unisono. Finestra di stima, latenza di
correzione e qualità dell'intero intervallo vanno riportate separatamente.

E5 resta necessario per i picchi e la dipendenza dal livello, ma questi dati
non autorizzano ad attribuire il fallimento del secondo rumore alla sola
non linearità. Dopo i test causali sul PCM, verificare il candidato sul
grafo reale con i quattro canali, prima senza canto e poi con il gate E6.
L'ordine completo resta nel [protocollo](echo-experiment-protocol.md).
