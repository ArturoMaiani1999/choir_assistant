# Laboratorio della Voce: percorso didattico e flusso degli esercizi

**Status:** implementato e verificato; decisioni UX finali ancora da validare con utenti  
**Owner:** project maintainer  
**Last reviewed:** 2026-09-28

## Tracker di esecuzione

Questo documento è anche il tracker canonico del lavoro. Gli elementi vengono
marcati completati soltanto quando esistono implementazione e test automatici.

| Incremento | Stato | Prossimo criterio di uscita |
|---|---|---|
| 1 — Prova breve e sessione iniziale | **completato** | successo anticipato e calibrazione verificati con audio sintetico |
| 2 — Scheduler ear training | **completato** | blocchi bilanciati e ripetizione dilazionata verificati nel browser |
| 3 — Canto degli intervalli | **completato** | coppie reali MusicXML/MSCZ/SVG verificate nel browser |
| 4 — Adattività e repertorio | **completato** | percorso adattivo e ritorno alla frase reale verificati end-to-end |

### Evidenza di verifica

- `node frontend/voice_lab_core.test.js`: 63 asserzioni su generazione,
  stabilizzazione, scheduler, competenze, recenza e repertorio.
- `python scripts/browser_voice_lab_smoke.py`: microfono sintetico, successo
  anticipato, conferma visibile, avanzamento effettivo da `1 di 4` a `2 di 4`,
  calibrazione non valutata, blocchi di ascolto/canto e ritorno alla frase reale
  del brano.
- `node frontend/pitch_shared.test.js`, `pitch_detector.test.js` e
  `vocal_feedback.test.js`: pipeline condivisa e plume verificati.
- `python scripts/build_voice_lab_assets.py`: 1.382 coppie intervallari prodotte
  in MusicXML, MSCZ e SVG da MuseScore.
- `python scripts/build_dist.py`: build privata completa con asset del
  laboratorio e tre brani pubblicati.

### Checklist incremento 1

- [x] Sequenza deterministica di quattro note entro l’estensione confortevole.
- [x] Indicatore di avanzamento `n di 4`.
- [x] Valutatore incrementale con attacco escluso, doppia finestra stabile,
  copertura, dispersione e deriva robuste.
- [x] Completamento anticipato senza attendere il timeout di 30 secondi.
- [x] Attraversamento momentaneo del target escluso dal successo.
- [x] Persistenza del motivo e del tempo di completamento.
- [x] Controllo microfono iniziale libero e non valutato.
- [x] Feedback riuscito non bloccante direttamente sul piano roll.
- [x] Riepilogo finale del blocco con acquisizione e stabilità separate.
- [x] Test browser end-to-end con audio/microfono sintetico per il completamento
  anticipato.

### Checklist incremento 2

- [x] Blocchi da 6, 8, 10 e 12 prove in base al livello.
- [x] Direzioni ascendenti, discendenti e uguali bilanciate nel livello iniziale.
- [x] Intervalli maggiori/minori e direzioni miste nei livelli successivi.
- [x] Modalità armonica separata dalla modalità melodica.
- [x] Massimo quattro alternative visibili per il riconoscimento della distanza.
- [x] Risposta errata reinserita dopo almeno due altre prove, con massimo due
  ripetizioni automatiche.
- [x] Risultati persistiti con distanza, direzione, modalità e riferimento alla
  prova ripetuta.
- [x] Riepilogo del blocco separato per direzione.
- [x] Test unitari dello scheduler e smoke test browser del flusso di risposta.

### Checklist incremento 3

- [x] Blocchi di quattro intervalli con direzioni ascendenti e discendenti
  bilanciate.
- [x] Modalità separate per imitazione guidata, memoria breve e costruzione a
  partire dalla prima nota.
- [x] Difficoltà vincolata al ruolo SATB e all’estensione confortevole.
- [x] Piano roll condiviso con due regioni temporali e indicazione della nota da
  cantare.
- [x] Count-in udibile di quattro pulsazioni, attacco e cambio nota espliciti.
- [x] Segmentazione che esclude attacco iniziale e zona di transizione.
- [x] Feedback distinto per prima nota, seconda nota, errore relativo e durata
  della transizione.
- [x] Distanza relativa corretta riconosciuta anche quando entrambe le note sono
  traslate rispetto al riferimento assoluto.
- [x] Persistenza della modalità, dell’intervallo e delle metriche separate.
- [x] Riepilogo finale del blocco e smoke test browser delle modalità.
- [x] Asset MusicXML, MSCZ e SVG MuseScore coerente con la coppia di note
  effettivamente proposta (non uno spartito intervallo generico).

### Checklist incremento 4

- [x] Stati di competenza distinti (`non_iniziata`, `in_esplorazione`,
  `in_consolidamento`, `stabile`) calcolati su una finestra recente.
- [x] Nessuna competenza dichiarata stabile con meno di otto osservazioni
  affidabili; una singola take resta esplorativa.
- [x] Selettore deterministico di blocchi basato sulle competenze meno
  consolidate.
- [x] Azione primaria `Allenamento di oggi` con durata stimata e avanzamento fra
  blocchi.
- [x] Ruolo SATB ed estensione applicati anche ai blocchi consigliati.
- [x] Ritorno al brano e alla parte usati più di recente al termine del percorso.
- [x] Estrazione di una frase reale del repertorio e generazione dell’esercizio
  applicativo corrispondente.
- [x] Pesi di recenza e pertinenza del repertorio nel selettore adattivo.
- [x] Test end-to-end dell’intero percorso consigliato, inclusa la transizione al
  brano.

## Obiettivo

Il Laboratorio deve proporre sessioni brevi con un inizio, un obiettivo e una
conclusione riconoscibili. Non è una raccolta statica di pulsanti e non assegna
un voto globale al cantante. Ogni sessione allena una competenza distinta e
spiega perché l’esercizio successivo è utile.

Il percorso segue questa sequenza:

1. ascoltare un riferimento;
2. trovare e stabilizzare una singola altezza;
3. distinguere direzione e distanza fra due altezze;
4. riprodurre vocalmente un intervallo;
5. mantenere la propria altezza mentre cambia il contesto armonico;
6. applicare la competenza a una frase del repertorio.

La progressione automatica è una raccomandazione. L’utente può sempre scegliere
manualmente un livello o un esercizio avanzato.

## Competenze indipendenti

Non deve esistere un unico livello complessivo. La persistenza conserva
separatamente almeno:

| Competenza | Evidenza principale |
|---|---|
| Riproduzione di una nota | acquisizione e centro stabilizzato |
| Stabilità della nota | deriva robusta, dispersione e copertura |
| Direzione melodica | risposta alta/bassa/uguale |
| Riconoscimento degli intervalli | nome, direzione e modalità melodica/armonica |
| Canto degli intervalli | errore assoluto delle note ed errore relativo |
| Memoria dell’altezza | precisione dopo un ritardo senza riferimento |
| Indipendenza corale | precisione con altre parti presenti |

Una competenza passa fra gli stati `non_iniziata`, `in_esplorazione`,
`in_consolidamento` e `stabile`. Lo stato deriva da una finestra di risultati,
non dal numero totale di esercizi svolti.

## Unità minima: una prova

Ogni prova attraversa la stessa macchina a stati:

```text
presentazione → ascolto → attesa → esecuzione → conferma → feedback
                                      ↘ incerto → riprova
```

- `presentazione`: mostra obiettivo, nota/intervallo e spartito;
- `ascolto`: riproduce il riferimento senza aprire implicitamente il microfono;
- `attesa`: consente di riascoltare o iniziare;
- `esecuzione`: mostra piano roll, plume e linea `ORA`;
- `conferma`: verifica che il risultato sia stabile senza fermarsi al primo
  frame corretto;
- `feedback`: riassume l’osservazione e propone l’azione successiva;
- `incerto`: il segnale non permette una valutazione e non conta come errore.

Interrompere o cambiare esercizio invalida la prova. Una prova incompleta non
entra nella progressione.

## Durata adattiva: 30 secondi è un limite, non un obbligo

Il riferimento di una nota singola può rimanere disponibile fino a 30 secondi,
ma la prova termina appena esiste evidenza robusta sufficiente. Il cantante non
deve sostenere una nota già trovata per il resto del timeout.

### Rilevamento del successo anticipato

La decisione usa i frame prodotti dalla pipeline condivisa; non introduce un
secondo pitch tracker. I valori iniziali, configurabili, sono:

| Fase | Criterio iniziale |
|---|---|
| Ignora attacco | primi 250 ms vocalizzati |
| Acquisizione | mediana entro ±35 cent per almeno 350 ms |
| Stabilizzazione | mediana entro ±20 cent per almeno 800 ms |
| Copertura | almeno 70% di frame affidabili nella finestra stabile |
| Dispersione | MAD robusta equivalente ≤18 cent |
| Deriva | variazione robusta ≤18 cent nella finestra stabile |
| Conferma | criteri stabili per due finestre consecutive |

Il completamento può quindi avvenire normalmente dopo circa 1,4–3 secondi di
voce affidabile. Il timeout di 30 secondi serve soltanto a lasciare tempo per
ascoltare, cercare la nota e riprovare senza ricreare l’esercizio.

Non si conclude anticipatamente quando:

- il pitch appare corretto in un solo frame;
- la confidenza è insufficiente;
- il riferimento riprodotto dagli altoparlanti può aver contaminato la misura;
- la voce attraversa il target senza stabilizzarsi;
- una correzione d’ottava non confermata rende ambiguo il risultato.

Se il cantante trova la nota dopo un attacco distante, la prova è completata e
il feedback descrive il miglioramento. L’attacco non trasforma il risultato in
un fallimento.

### Esiti di una prova di intonazione

- `raggiunta`: nota stabilizzata; avanzamento normale;
- `raggiunta_con_correzione`: stabilizzata dopo un avvio distante;
- `vicina_non_stabile`: centro vicino ma non stabilizzato;
- `non_raggiunta`: segnale affidabile ma distante fino al timeout;
- `incerta`: copertura/confidenza insufficiente, senza penalizzazione.

## Prima sessione guidata

La prima esperienza dura circa 4–6 minuti:

1. configurazione ruolo SATB ed estensione confortevole;
2. controllo del microfono con una nota libera, non valutata;
3. quattro prove di pitch tracking su note singole;
4. sei domande di direzione melodica;
5. riepilogo per competenza e proposta della sessione seguente.

Le quattro note non sono quattro estrazioni indipendenti. Il generatore sceglie:

- una nota nel centro dell’estensione;
- una nota 2–4 semitoni sopra;
- una nota 2–4 semitoni sotto;
- una nota casuale nella zona centrale già esplorata.

Nessuna nota si trova nei due semitoni estremi dell’estensione durante la prima
sessione. `Riprova lo stesso` conserva esattamente altezza e modalità e non
aumenta il conteggio delle prove previste.

Il blocco è completato con almeno quattro prove concluse, di cui almeno tre
`raggiunta` o `raggiunta_con_correzione`. Un risultato `incerto` viene
riproposto e non aumenta né successi né errori. Se il criterio non è raggiunto,
la sessione termina comunque con un invito a riprendere, senza bloccare le altre
attività.

## Percorso di riconoscimento degli intervalli

Ogni blocco contiene poche categorie e bilancia le risposte. Il generatore non
deve produrre casualmente sei risposte ascendenti consecutive.

### Livello A — Direzione

- alta, bassa, uguale;
- 6 prove per blocco;
- almeno una prova per categoria;
- consolidamento: almeno 5/6 corrette in due blocchi recenti.

### Livello B — Intervalli di riferimento

- unisono, seconda maggiore, terza maggiore, quinta giusta, ottava;
- inizialmente solo ascendenti;
- 8 prove per blocco;
- massimo quattro opzioni visibili nella stessa domanda;
- consolidamento: almeno 75% su 16 osservazioni affidabili e nessuna categoria
  sotto il 60%.

### Livello C — Maggiore e minore

- seconda e terza maggiore/minore, più gli intervalli consolidati;
- ascendenti e discendenti bilanciati;
- 10 prove per blocco;
- risultati separati per qualità e direzione.

### Livello D — Direzione indipendente

- quarta, quinta, sesta e ottava insieme agli intervalli precedenti;
- riconoscimento del nome indipendentemente dalla direzione;
- 10–12 prove per blocco.

### Livello E — Armonico

- note simultanee;
- progressione separata da quella melodica;
- inizio con unisono, terza, quinta e ottava;
- almeno 12 osservazioni prima di modificare automaticamente la difficoltà.

Una risposta errata è seguita da riascolto, risposta corretta e un esempio
contrastante. Lo stesso intervallo ritorna dopo 2–4 altre prove, non subito,
salvo richiesta esplicita dell’utente.

## Percorso di canto degli intervalli

Il canto degli intervalli viene proposto dopo il primo blocco di note singole e
dopo l’esposizione uditiva agli intervalli coinvolti.

1. **Imitazione guidata:** ascolto di entrambe le note e riproduzione.
2. **Memoria breve:** ascolto completo, pausa di 1–2 secondi, riproduzione.
3. **Costruzione:** viene suonata solo la prima nota; l’utente costruisce la
   seconda conoscendo l’intervallo.
4. **Direzione mista:** stesso intervallo ascendente e discendente.
5. **Applicazione:** intervallo estratto dalla parte del repertorio.

Ogni risultato mantiene distinti:

- errore assoluto della prima nota;
- errore assoluto della seconda nota;
- errore relativo dell’intervallo;
- comportamento della transizione;
- affidabilità delle due regioni stabilizzate.

Due note entrambe 30 cent sotto, con distanza relativa corretta, completano
l’obiettivo relativo ma generano un suggerimento separato sull’intonazione
assoluta. Non vengono classificate come intervallo errato.

## Composizione delle sessioni successive

La schermata iniziale propone una sola azione principale, per esempio
`Allenamento di oggi · circa 5 minuti`. Una sessione contiene 2–4 blocchi:

| Quota | Contenuto |
|---:|---|
| 50% | competenza più fragile con evidenza affidabile |
| 25% | consolidamento di una competenza recente |
| 15% | ripasso distribuito di materiale già appreso |
| 10% | nuova difficoltà o applicazione al repertorio |

Il selettore deterministico assegna a ogni candidato un peso basato su:

```text
priorità = difficoltà_osservata × affidabilità × recenza × pertinenza_repertorio
```

Vincoli:

- nessuna deduzione da una sola take o da meno di tre regioni affidabili;
- massimo due ripetizioni consecutive dello stesso tipo;
- almeno una attività già familiare per sessione;
- gli errori recenti aumentano la frequenza, ma non eliminano il ripasso;
- ruolo SATB ed estensione manuale sono vincoli rigidi di generazione;
- la difficoltà suggerita non impedisce la selezione manuale.

## Feedback fra una prova e l’altra

Il feedback intermedio richiede pochi secondi di lettura:

- osservazione principale;
- una sola indicazione operativa;
- `Riprova` e `Continua`;
- indicatore `2 di 4`, non punteggio o classifica.

Il grafico completo rimane disponibile come dettaglio. Non compare come dialogo
obbligatorio dopo ogni prova riuscita: quando il successo anticipato è chiaro,
una conferma breve appare sul piano roll e la sessione prosegue dopo una pausa
configurabile. Il riepilogo finale mostra competenze allenate, non una
percentuale aggregata di “bravura”.

## Persistenza richiesta

Ogni risultato include:

- definizione e configurazione effettiva dell’esercizio;
- ruolo SATB ed estensione usati;
- modalità guidata, memoria o armonica;
- esito, motivo della conclusione e tempo necessario alla stabilizzazione;
- metriche condivise e affidabilità;
- intervallo, qualità e direzione quando applicabili;
- numero di ripetizione della stessa configurazione;
- eventuale riferimento a brano, parte, battuta ed eventi sorgente.

Il profilo di competenza è derivato dai risultati e può essere ricostruito. Non
deve essere l’unica copia dei dati.

## Ordine di implementazione

### Incremento 1 — Prova breve e sessione iniziale

- estrarre un valutatore incrementale dalla pipeline condivisa;
- implementare acquisizione, stabilizzazione e successo anticipato;
- mantenere 30 secondi come timeout massimo;
- aggiungere contatore `n di 4` e sequenza deterministica delle prime note;
- distinguere completamento, timeout, interruzione e misura incerta;
- evitare il dialogo completo dopo ogni successo.

### Incremento 2 — Scheduler di ear training

- blocchi bilanciati di direzione e intervalli;
- risultati separati per qualità, direzione e modalità;
- ripresentazione dilazionata degli errori;
- criteri di consolidamento documentati e configurabili.

### Incremento 3 — Canto degli intervalli

- segmentazione affidabile delle due note;
- errore assoluto e relativo;
- modalità imitazione, memoria e costruzione;
- count-in udibile di quattro pulsazioni prima della finestra valutata;
- feedback sulla transizione senza penalizzare automaticamente il portamento.

### Incremento 4 — Sessioni adattive e repertorio

- profili per competenza;
- sessione consigliata di circa cinque minuti;
- suggerimenti derivati da almeno tre osservazioni affidabili;
- ritorno alla battuta originale del brano.

## Criteri di accettazione del primo incremento

1. Una nota stabilizzata può concludere la prova prima dei 30 secondi.
2. Un attraversamento momentaneo del target non conclude la prova.
3. Una misura incerta non viene contata come errore.
4. Un attacco distante seguito da stabilizzazione è una correzione riuscita.
5. La prima sessione presenta quattro note entro l’estensione confortevole.
6. Il riepilogo distingue acquisizione e stabilità.
7. `Riprova` conserva la nota; `Continua` usa la configurazione successiva.
8. Interruzione e cambio attività non salvano una prova completa.
9. La stessa pipeline di pitch, configurazione e feedback è usata nel
   Laboratorio e nel repertorio.
10. Tutte le soglie sono raccolte in configurazione e coperte da test con pitch
    stabile, correzione progressiva, vibrato, deriva e segnale incerto.

## Decisioni aperte da validare con utenti

- pausa migliore fra conferma automatica e prova successiva;
- opportunità di avvio automatico del microfono in una sessione già autorizzata;
- quantità di dettaglio numerico nel feedback intermedio;
- ampiezza più confortevole degli intervalli SATB iniziali;
- equilibrio fra riferimento continuo e memoria nelle prime sessioni.

Queste decisioni non cambiano il contratto principale: sessioni brevi,
competenze separate, evidenza affidabile e nessuna permanenza obbligatoria fino
al timeout quando l’obiettivo è già stato raggiunto.
