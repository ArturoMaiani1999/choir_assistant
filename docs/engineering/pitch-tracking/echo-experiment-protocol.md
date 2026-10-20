# Protocollo sperimentale prioritizzato: cancellazione sul S25+

**Status:** causal candidate tested; two fresh device attempts reveal voice-analysis stall and 40 ms training jump; live holdout incomplete
**Owner:** project maintainer
**Last reviewed:** 2026-10-20

## Scopo e criterio di priorità

Portare la cancellazione reale di Santo a una riduzione utile senza perdere
voce piano, attacchi o note in unisono con la base. La
[matrice delle variabili](echo-isolation-plan.md) resta l'inventario completo;
questo documento stabilisce quali esperimenti eseguire prima, quando fermarsi
e quale modifica giustifica ogni risultato.

Ordine deciso da quattro fattori qualitativi: evidenza già osservata,
ampiezza del danno possibile, costo della prova e capacità di distinguere
due cause che richiedono interventi diversi. Non sono assegnate probabilità
numeriche senza dati. Un filtro assente e un riferimento incompleto possono
annullare tutta la cancellazione; un piccolo errore di soglia non li risolve.

| Ordine | Esperimento | Evidenza / impatto | Costo e dipendenza | Decisione principale |
| --- | --- | --- | --- | --- |
| 0 | E0: integrità e stato degli archivi | Due registrazioni reali già disponibili | Nessun nuovo intervento utente; eseguito | Separare filtro assente da filtro applicato male |
| 1 | E1: ciclo di vita e stato realmente applicato | Filtro assente in tutta la prova del 20/10; impatto totale | Log + riproduzione di transizioni; priorità immediata | Correggere invalidazione/collegamento prima di valutare il DSP live |
| 2 | E2: allineamento e sue variazioni | Disallineamento in entrambe le prove; grandi recuperi offline | Replay disponibile; conferma sul telefono dopo E1 | Stabilizzare la catena e seguire il ritardo, distinguendo salto da deriva |
| 3 | E3: completezza del riferimento, in particolare metronomo | Sintomo riferito; basso costo di esclusione | Audit digitale già avviabile; prova acustica dopo E1 | Correggere routing o trattare il residuo come problema acustico |
| 4 | E4: limite del modello lineare dopo riallineamento | Restano solo circa 10–13 dB nei confronti esistenti | Probe in silenzio, catena verificata | Migliorare identificazione oppure passare a E5 |
| 5 | E5: risposta dipendente dal livello e non linearità | Plausibile al 75%, non ancora dimostrata | Tre livelli; avviare dopo E2, per non confondere ritardo e distorsione | Adattamento della risposta, modello diverso o limite d'uso misurato |
| Gate | E6: preservazione della voce e accuratezza F0 | Conseguenza critica di ogni modifica | Test controllati per ogni candidato; canto reale prima della release | Accettare o scartare il candidato, indipendentemente dai dB |
| 6 | E7: robustezza e confronto con AEC alternativo | Generalizzazione e scelta architetturale | Dopo un candidato utile; anticipare benchmark se E4/E5 mostrano un limite strutturale | Consolidare il core o sostituirlo sulla base di un confronto omogeneo |

E6 non è rinviato alla fine: i controlli vocali sintetici accompagnano ogni
modifica. Viene rinviato soltanto il costo di chiedere un nuovo canto reale
finché il candidato non supera i test acustici e controllati.

## E0 — Audit degli archivi, risultato acquisito

Artefatto privato: `artifacts/echo-experiment-priority/archive-state-audit.json`.
Fonti identificate da UUID e SHA256 negli studi
[19 ottobre](santo-real-device-2026-10-19.md) e
[20 ottobre](santo-real-device-2026-10-20.md).

- **19/10:** 3.747 callback; filtro dichiarato pronto per tutta la prova,
  gain 1; stato automatico per 11 callback, poi waiting per 3.736, dal tempo
  circa 0,211 s. La sottrazione e la convoluzione erano già state verificate
  numericamente. Il difetto dominante osservato è il disallineamento di
  24,92 ms, non un errore di segno o del convolutore in quella registrazione.
- **20/10:** 3.738 callback tutte unverified/ready=false, prima osservazione
  circa 0,203 s. Nel profilo catturato gain 0 e H nullo; processed identico a
  raw. Non c'è una transizione da filtro valido a invalido nel minuto registrato.
  L'evento da cercare è precedente all'acquisizione.
- Entrambe hanno 125 snapshot con una sola configurazione mixer e una sola
  configurazione input esposta. Questo non dimostra stabilità del DSP nascosto.
- Il campo gain dei callback vale 1 anche nella prova disattivata: è lo stato
  del follower, non il coefficiente effettivo della sottrazione. Il prossimo
  log deve distinguere questi valori.

I due test hanno build diverse. Non costituiscono un A/B controllato né
dimostrano che una release abbia trasformato un errore di 25 ms in uno di 3 ms.

## E1 — Il filtro attraversa le transizioni corrette?

**Ipotesi:** il modello viene invalidato, perso o non collegato fra esito
della calibrazione e uso. **Controllo:** stessa build, stesso account/input,
nessun cambio di volume o posizione, modello appena verificato.

Registrare un breve storico prima dell'avvio diagnostico: operazione e reason
code, frame/tempo audio, firma di stream/contesto/route, ID di H, età del profilo,
ready, stato del follower, guadagno richiesto e coefficiente applicato.
Conservare gli eventi di cambiamento del modello/guadagno; uno snapshot iniziale
non descrive una catena adattativa per tutta la registrazione.

Provare separatamente:

1. calibrazione nel brano → chiusura → Play;
2. calibrazione dalla Home → apertura brano → eventuale riverifica → Play;
3. apertura/chiusura Base e apertura/chiusura diagnostica;
4. stop/riapertura microfono, background/resume e reload;
5. scadenza TTL simulata nei test, poi controllo della motivazione sul device.

Cinque ripetizioni dei percorsi 1–3. Nei percorsi 4–5 non imporre persistenza
di un filtro su una catena cambiata: verificare invalidazione motivata e
recupero previsto prima di dichiarare la cancellazione pronta.

**Pass:** zero discordanze fra stato pronto e modello applicato; nessuna
invalidazione inspiegata; identità `processed = raw − g × prediction` entro
errore numerico della pipeline. Il solo test diagnostico può acquisire raw
senza filtro, ma deve dichiararlo. **Esito negativo:** intervenire sul ciclo
di vita e ripetere solo i percorsi falliti più le regressioni pertinenti.

### E1 — Strumentazione e verifiche del 20 ottobre

Disponibile su staging nella build `20261020-104105-46c4b97f1322-dirty`:

- Storico in RAM per account, con identificativi anonimi di contesto, traccia,
  grafo e modello; motivi espliciti di attach, detach e invalidazione.
  Le osservazioni frequenti hanno un buffer separato: non espellono gli
  eventi di applicazione del modello. Massimo 384 eventi; conteggio degli
  eventi espulsi. Esportazione con il consenso del test diagnostico.
- `appliedGain`, `targetGain` e `followerGain` distinti. Il tempo/frame degli
  eventi indica il comando sul main thread, non una lettura sample-exact
  dell'automazione. Un evento `model-applied` identifica il comando e il
  modello; la verifica del coefficiente avviene anche negli snapshot seguenti.
- L'invalidazione annulla l'automazione del guadagno prima di azzerare la
  sottrazione. Il solo aggiornamento di `.value` non elimina un target già
  programmato. Correzione riprodotta in test; non ancora attribuita alle
  registrazioni archiviate.
- Snapshot dello storico all'inizio e alla fine del test; continuità del PCM
  verificata sui frame reali del render. Un quantum mancante interrompe la
  cattura con errore esplicito.

Passano il percorso completo dal brano, quello dalla Home con riverifica
acustica e cinque cicli di Base, più cattura/upload/retry con confronto del
PCM salvato sul Worker locale. Il percorso sintetico misura circa 34 dB;
questo valore non è un risultato del Samsung. Sono coperte anche scadenza,
cambio account, annullamento, background e permesso microfono tardivo.

ADB/CDP è stato connesso al S25+ reale. Nei primi due tentativi la misura non è
partita: caricamento dei worklet fallito, `ERR_NAME_NOT_RESOLVED`, poi errori
di rete e sessione non pronta; dopo il cambio rete Chrome ha mostrato
`DNS_PROBE_FINISHED_NO_INTERNET` durante l'accesso. Questi errori non spiegano
da soli i difetti DSP degli archivi. Dopo il ripristino è stato acquisito il
[primo probe reale](s25-calibration-probe-2026-10-20.md): ritardo circa 150 ms,
5 campioni al limite di saturazione e nessun modello accettato. Il replay del
Worker risponde in circa 817 ms con `clipping`, mentre l'avvio precedente
aveva raggiunto il timeout. Il rilascio successivo verifica la disponibilità
del Worker prima dei suoni e distingue caricamento da elaborazione.
Evidenze private in `artifacts/echo-lifecycle/device-*.json` e nella cartella
del probe indicata nello studio.

Il confronto successivo sulla stessa nuova build è ora acquisito: a 8/15
calibrazione accettata con 22,81 dB di verifica e ritardo stabile; a 11/15 un
campione supera la soglia precauzionale, e nell'analisi senza veto emerge un
salto di ritardo di 6 ms durante il secondo rumore. Correggere solo il tempo
recupera −3,08 → 21,94 dB nel tratto successivo alla correzione. Sull'intero
holdout la correzione tardiva raggiunge solo 1,95 dB: non è ancora un esito
utile live. **E2 mantiene la priorità**; il volume non è dimostrato come causa
del salto. Dettagli, SHA e replay nello studio collegato.

## E2 — Quanto recuperiamo correggendo esclusivamente il tempo?

**Ipotesi:** il guasto principale è temporale. **Controlli:** stessa risposta
H, stesso riferimento, stesso volume, telefono fermo e nessun canto.
Stimare il ritardo in bande disgiunte per ridurre l'ambiguità della musica.

Confronto abbinato sugli stessi PCM:

- A: filtro congelato;
- B: solo guadagno;
- C: solo ritardo;
- D: ritardo più guadagno.

Tutte le stime devono precedere il tratto valutato. Non retroapplicare
un adattamento a campioni precedenti e non cambiare H durante questo confronto.
Il resampling simmetrico dell'esperimento archivistico non vale come prova
di causalità del futuro algoritmo live.

Sul device usare probe indipendenti prima/dopo warmup, Play e resume. Per il
primo screening basta una sequenza breve; estendere a 60–120 s solo se rimane
il dubbio di deriva. A misure stabili corrisponde un offset; gradini indicano
salti; una pendenza persistente giustifica una stima della deriva. Conservare
contatori frame e diagnostiche di buffering per attribuire il cambiamento,
non solo il massimo della correlazione.

**Decisione:** un recupero mediano di almeno 3 dB rispetto ad A su tre prove
nuove rende prioritaria la correzione temporale. È una soglia di utilità del
progetto, non significatività statistica. Riportare tutti gli esiti e i
peggioramenti. Se C migliora quanto D e B non aiuta, implementare prima il
ritardo; se dopo il riallineamento resta <20 dB, proseguire E4/E5. Non confondere
il successo relativo con il raggiungimento dell'obiettivo assoluto.

Un cambiamento di ritardo durante il canto non autorizza a riapprendere H dalla
voce. Il comportamento quando la stima non è identificabile va valutato in E6;
non chiamare recupero la semplice chiusura del gate del pitch.

## E3 — Il riferimento contiene davvero ciò che esce?

**Ipotesi:** un ramo, in particolare il metronomo, sfugge al riferimento o
subisce una trasformazione a valle. **Intervento:** attivare una sola sorgente
alla volta: metronomo, organo, P1, P2, P3, P4, poi mix completo.

Auditare connessioni, mono/downmix, normalizzazione, pitch shift, mute/master
e possibili playback duplicati. Per il metronomo raccogliere almeno 20 click;
misurare finestre per evento, inclusa la coda, oltre alla media globale.

**Pass digitale:** nessuna uscita dell'app assente dal riferimento e nessuna
trasformazione non rappresentata. **Se fallisce:** correzione del routing.
**Se passa ma restano click:** confronto acustico a timing corretto; residui
dipendenti dal livello vanno a E5, residui da risposta incompleta vanno a E4.
Non introdurre un notch sulle frequenze del click o della nota attesa.

## E4 — Il modello lineare è sufficiente nelle condizioni stabili?

**Ipotesi:** il limite residuo è un'identificazione insufficiente, non
necessariamente distorsione. Usare probe a larga banda con rapporto
segnale/rumore misurabile; separare identificazione, scelta dei parametri e
verifica finale. Misurare il fondo senza uscita prima e dopo.

Confrontare il filtro attuale con una piccola famiglia predefinita di risposte
causali, dopo riallineamento. Scegliere lunghezza/regolarizzazione su dati di
sviluppo; congelare la scelta prima di aprire la nuova verifica. Applicare
il modello scelto anche a musica e click tenuti separati.

**Se ≥20 dB sono ottenuti su probe e musica:** integrare il miglioramento di
identificazione e passare E6. **Se funziona sul probe ma non sulla musica:**
controllare livello/crest factor e stazionarietà prima di chiamarlo non linearità.
**Se il residuo è già al fondo:** riportare il limite di misura. **Se resta
correlato e sopra il fondo:** E5 o risposta acustica ancora variabile.

## E5 — Il volume modifica soltanto la scala o anche il percorso?

Telefono fisso; PCM digitale fisso. Tre livelli Android, circa 35/55/75%,
registrando gli step reali; ripetere in ordine alternato, per esempio
55→35→75, 75→55→35, 35→75→55, con uguale assestamento. Questo limita la
confusione fra livello e andamento nel tempo. Riallineare ogni prova.

Confrontare prima H comune con solo fattore di scala, poi H specifica del
livello su dati separati. Analizzare armoniche/intermodulazione su probe
adatti e picchi del metronomo, non dedurre clipping dall'assenza o presenza
di soli campioni digitali sopra uno.

**Scala sufficiente:** lavorare sul gain follower. **H diversa ma stabile:**
serve seguire la risposta, con controllo del double talk. **H per livello
ancora insufficiente e residui non lineari ripetibili:** valutare un modello
adeguato o un intervallo di volume supportato. Un numero percentuale del
volume non è una misura di SPL e non si trasferisce fra dispositivi.

## E6 — Il miglioramento conserva la voce?

Per ogni candidato, usare base registrata e voce indipendente nota, con F0
uguale/diversa, fasi diverse, voce piano, attacchi e pause. In questa fase
il percorso acustico e la voce nota consentono di distinguere le componenti.
La sottrazione lineare congelata preserva algebraicamente la voce: il test
più discriminante deve includere anche le decisioni di adattamento.

Controllare perdita vocale ≤0,5 dB; F0 stabile con mediana ≤10 cent e p95
≤30 cent rispetto al riferimento; errori agli attacchi/respiri separati.
Sono target proposti, non proprietà dimostrate del canto reale. Ripetere
il replay pitch-only con maschera invariata e fallback, quindi verificare
voicing completo su etichette indipendenti: stessi frame ammessi non dimostrano
da soli accuratezza F0 né eliminazione dei falsi positivi.

Un candidato che aumenta i falsi negativi osservati o apprende la voce viene
scartato anche se migliora molto i dB. Prima della distribuzione serve una
prova reale sul dispositivo; un buon risultato sulle miscele non ne prende
il posto. Niente correzione verso lo spartito o smoothing che nasconda errori.

## E7 — Quando estendere o cambiare architettura

Provare movimento, route, riavvii, volume variabile, carico e secondo device
solo dopo una baseline utile. Per ogni condizione fare tre ripetizioni e
riportare anche i fallimenti, il tempo di recupero e le finestre non valutabili.

Se E4/E5 indicano un limite strutturale, confrontare il core con un AEC
maturo usando gli stessi ingressi sincronizzati e gli stessi criteri vocali.
Un A/B dell'AEC nativo richiede nuove acquisizioni sul device; non è un
semplice replay degli stessi raw se quel percorso non espone contemporaneamente
l'ingresso non trattato. Distinguere sottrazione lineare e soppressione residua.
Scegliere in base a residuo, preservazione, causalità, costo CPU e latenza,
non alla sola energia più bassa.

## Regole di misura e di arresto

- Le registrazioni del 19/20 ottobre sono ormai dati di sviluppo, già
  ispezionati ripetutamente. I tratti originariamente separati restano validi
  per documentare quegli esperimenti, ma non sono una nuova verifica cieca
  per algoritmi successivamente scelti su di essi.
- Congelare build, parametri e segmenti prima di una nuova prova di conferma.
  Conservare tutti i tentativi con esito; nessuna selezione del solo migliore.
- Tre ripetizioni sono uno screening ingegneristico, non dimostrano
  generalizzazione né forniscono migliaia di campioni indipendenti. I frame
  vicini sono correlati: l'unità di replica è la prova/sessione.
- Obiettivo iniziale ≥20 dB su sola base indipendente; nominale 25–30 dB,
  mediana su finestre attive ≥25 dB e p10 ≥20 dB quando il fondo lo consente.
  Riportare separatamente bande, click e rumore di fondo.
- Bloccare l'ottimizzazione DSP live se E1 fallisce, mantenendo possibili le
  analisi offline sul raw. Se E2 risolve la maggior parte del danno, verificare
  subito il candidato prima di costruire un modello non lineare più costoso.
- Non è richiesta un'altra esecuzione cantata per E1–E5. Le prove sul telefono
  dipendono dal collegamento USB/CDP o da una routine diagnostica guidata.
  Tre probe reali sono stati acquisiti via ADB/CDP; il collegamento USB è
  nuovamente assente al controllo successivo. I risultati effettivi e i limiti
  sono nello [studio S25+](s25-calibration-probe-2026-10-20.md).

## Prossimo pacchetto operativo

1. Strumentazione E1, distinzione del guadagno applicato e contatori di frame
   implementati; cinque riaperture Base, Home → brano e diagnostica superati
   nel browser. Conservare la verifica delle transizioni anche sul telefono.
2. Tre probe E2 hanno distinto un percorso stabile a 8/15 da un salto di 6 ms
   a 11/15. Il [candidato causale](echo-delay-tracking-2026-10-20.md) recupera
   il salto nei dati di sviluppo e passa i controlli E6 su voce nota, senza
   nuovi falsi negativi rispetto alla baseline nei casi provati.
3. Confermare il pacchetto congelato sul telefono, quindi separare musica e
   metronomo E3. Nessun nuovo canto per le sole misure E1–E5.
4. Il replay intero con salto resta a 8,73 dB: non ha raggiunto il target 20 dB,
   anche se il tratto assestato arriva a 22 dB. Non presentare il candidato
   come soluzione dimostrata di Santo prima della nuova prova reale.

**Aggiornamento delle priorità dopo la riconnessione:** due nuovi tentativi
sono conservati nello [studio del candidato](echo-delay-tracking-2026-10-20.md).
Il primo verifica H a 23,14 dB ma si ferma nell'analisi vocale; il secondo
mostra un salto di 40 ms durante il training e rifiuta H a 1,80 dB. Nessuno
raggiunge il test live indipendente/metronomo. Una stima offline con storia
causale conservata e perdita sul training stabile recupera 24,06 dB sul
secondo rumore, contro 3,64 dB con lo stesso solver su tutto il training.
La priorità E2 include ora la stazionarietà **prima** dell'accettazione di H,
oltre all'estensione/verifica del tracking live oltre i ±20 ms attuali.
Prima di chiedere altre prove in silenzio, riprodurre questi nuovi casi e
limitare l'attesa del Worker vocale; restano necessari E3 e canto reale.

La raccolta deve evitare di chiedere all'utente di ricordare passaggi interni
o di scaricare/ricaricare file. Le versioni di staging servono a confermare
il candidato, non sostituiscono la misura indipendente.
