# Calibrazione minima del microfono

**Aggiornamento 19 ottobre 2026:** la UI usa ora
[Calibra audio](unified-audio-calibration.md), una routine unica con misura del
percorso acustico se necessaria e guida vocale compatta. Applicazione e riuso
sono automatici. La guida originale di 30 s descritta sotto rimane una
baseline del core nei test.

**Stato:** v2 con guida di 30 secondi e livello audio dal vivo, 2026-10-18.

## Piano e criteri

1. Core puro e Worker: acquisire lo stesso formato PCM/finestra del detector live;
   estrarre una sola volta YIN e confrontare gate energetici/di qualità limitati.
2. Guida di 30 secondi: preparazione 4 s, silenzio 4 s, preparazione 3 s,
   vocale libera 5 s, pausa 4 s, preparazione 3 s, vocale più piano 4 s,
   pausa finale 3 s. Ogni fase mostra istruzione, countdown e azione successiva.
   Escludere preparazione e 500 ms ai confini per reazione e riverbero.
3. Usare soltanto primo silenzio/vocale per costruire e selezionare candidati.
   Usare seconda vocale/pause per verifica separata, senza scegliere un altro
   candidato in base a questa verifica. Confrontare anche il tracker live.
4. Rifiutare clipping, acquisizione incompleta, clock interrotto o insufficiente
   separazione voce/rumore. Nessuna correzione verso una nota attesa. Frequenze,
   smoothing, conferme e hold non sono parametri da ottimizzare con questa guida.
5. Applicazione esplicita dopo conferma di avere seguito i segnali. Baseline
   conservata se il beneficio non è sufficiente o la verifica peggiora.
6. Profilo locale per utente e ingresso, con versione del detector e settings
   effettivi. Nessun PCM o identificativo hardware inviato al server. Riutilizzo
   esplicito dopo controllo del silenzio; reset e cambio ingresso invalidano
   l'applicazione. La calibrazione non attraversa dispositivi o utenti.
7. Test DSP sintetici, ciclo di vita, isolamento/salvataggio; smoke browser e
   ispezione visiva a 1366×768 e 390×844; build statica e regressioni live.

## Contratto scientifico

Balanced accuracy = media di recall voiced e specificità unvoiced. Le etichette
sono gli intervalli della guida, con conferma dell'utente: sono riferimenti
deboli, non ground truth acustico. Nessuna misura viene presentata come
accuratezza F0 o massimo teorico. Note sbagliate e vibrato devono restare visibili.
Il controllo negativo non prova che una F0 sia corretta né che il dispositivo
sia calibrato per l'intero range vocale. Il beneficio reale su altri utenti e
microfoni richiede il corpus indipendente del report di ricerca.

## Implementazione

- `frontend/microphone_calibration.js`: core puro, etichette temporali, controllo
  qualità, replay del vero `PitchSmoother`, selezione e compatibilità del profilo.
- `frontend/microphone_calibration_worker.js`: un solo passaggio del detector YIN
  sui frame, poi riuso di Hz/clarity/RMS per quattro configurazioni; nessun DSP
  costoso sul main thread. Il Worker viene terminato a completamento/annullamento.
- `frontend/microphone_calibration_ui.js`: acquisizione, dialogo, cancellazione,
  profili locali e verifica del rumore. Nessuna route o servizio nuovo.
- `frontend/app.js`: riconoscimento e tracker consumano l'overlay calibrato;
  le preferenze manuali rimangono intatte e vengono ripristinate al reset.
  La prova resta utilizzabile senza calibrazione. Questa v2 riguarda la pagina
  **Prova**; Voice Lab e pYIN offline conservano i propri percorsi.

Ingresso: stesso MediaStream mono e richieste EC/NS false, AGC true del live
nel percorso cuffie. La modalità altoparlanti sperimentale usa AGC false e
PCM trattato dal [filtro con riferimento](reference-echo-cancellation.md);
si verificano i settings effettivi, senza cambiare DSP del browser a metà misura.
Finestra 2048 campioni, nessun resampling o MediaRecorder, lettura ogni 20 ms
(50 Hz nominali). Il timestamp usa il centro del frame nell'AudioContext,
non il numero di tick JavaScript. Il live ha invece un massimo di 60 Hz con
backpressure del Worker: i tempi delle conferme non sono identici. La misura
non certifica attacchi rapidi o latenza live. I margini di 500 ms sono espliciti.
Il PCM transitorio occupa circa 12,3 MB per 1500 frame (limite 1800); viene trasferito al Worker
e poi rilasciato. Il microfono viene spento già durante l'analisi finale.

### Decisione e controlli

La baseline è il riconoscimento effettivamente attivo (anche un precedente
profilo compatibile). Le varianti usano soltanto primo silenzio/prima vocale:

1. baseline;
2. RMS `max(0,000001, min(0,01, 0,5 * P20(voce), max(0,000002, 2 * P95(rumore))))`;
3. stessa soglia RMS e confidence minima fino a 0,20;
4. stessa soglia RMS, confidence fino a 0,10 e clarity fino a 0,40.

Si conserva esplicitamente il floor di confidence originale: in `detectPitch`
la soglia RMS ≥0,001 disattiva altrimenti il floor automatico 0,36. Questa
discontinuità non deve introdurre un secondo gate durante la calibrazione.
`yinThreshold`, frequenze, mediana, EMA, conferme e hold non vengono ottimizzati.

Si sceglie il massimo di balanced accuracy sul solo train; a parità resta la
configurazione precedente/più semplice. Si controlla **quel solo vincitore**
sulla seconda parte; la verifica può rifiutarlo ma non scegliere un altro
candidato. Servono recall ≥0,80 e specificità ≥0,90 in entrambe le parti,
guadagno train ≥0,02, balanced accuracy di verifica non inferiore alla baseline
e peggioramento di recall/specificità non oltre 0,02. Se non c'è beneficio ma
la baseline supera entrambi i controlli, viene confermata la baseline.

Prima della selezione si richiedono separazione di livello (P20 voce normale
>2× P95 rumore iniziale; voce più piano >1,5×), copertura minima di ogni fase,
nessun salto di acquisizione >150 ms e assenza di clipping significativo
(frazione media sopra 0,99 ≤0,005, nessun frame valutato con frazione >0,08).
Sono criteri iniziali conservativi, non soglie fisiologiche o SNR calibrato.

### Profili e invalidazione

Il profilo contiene solo parametri, versioni, dati aggregati e stime di verifica.
La chiave separa account e catena d'ingresso. L'identificativo del microfono è
hashato con sale casuale locale; deviceId/groupId originali e user agent non
vengono salvati, combinati in fingerprint o inviati al server. La catena include
sample rate di traccia/contesto, canali, AGC, NS ed EC effettivi. In assenza di
identificazione/crypto persistibile si consente soltanto il profilo di sessione;
il sale viene mantenuto anche in memoria se lo storage non è disponibile.

Un profilo salvato scade dopo 7 giorni. Dopo reload, per riattivarlo occorre
**Dettagli e profilo locale → Cerca profilo salvato → Verifica profilo · 8 s**:
4 s di preparazione e 4 s di silenzio, entrambi con countdown.
Il nuovo P95 del rumore non deve superare `max(0,000002, 2 * P95 originale)` e
i falsi allarmi raw sul tratto centrale (4,5–7,5 s della guida breve) devono
restare ≤10%. Un controllo
negativo non verifica la sensibilità alla voce, quindi il testo invita a
ripetere la guida se voce/ambiente cambiano. Non viene dichiarata una nuova BA.

La verifica vale 30 minuti e viene conservata in memoria fra riaperture del
medesimo ingresso. Alla scadenza torna il preset manuale alla successiva pausa,
senza cambiare algoritmo nel mezzo di una prova in corso. Cambio account,
ingresso/settings, dispositivo scollegato, modifica manuale del detector o
reset disattivano l'overlay. Il reset elimina soltanto i profili dell'account
corrente. Gli eventi di enumerazione subito dopo il permesso rispettano la
protezione già presente nell'app; durante la misura si confrontano comunque
continuamente settings e traccia effettiva, e si annulla se cambiano.

## Verifica eseguita

```powershell
npm run check
python -m unittest discover -s scripts -p build_dist_test.py
python scripts/serve_frontend.py --port 5188
# In un altro terminale:
python scripts/browser_microphone_calibration_smoke.py
python scripts/browser_privacy_mixer_smoke.py --url http://127.0.0.1:5188/
python scripts/browser_personal_recording_smoke.py --url http://127.0.0.1:5188/
```

`npm run check` include typecheck, 72 test esistenti e 11 test della calibrazione:
selezione/hold-out, mantenimento della baseline, rifiuti, transizioni sconosciute,
nota libera/vibrato, ingresso PCM reale al detector, isolamento/expiry, riuso e
una fixture completa a 48 kHz, tempi e separazione dei tratti di preparazione.
Passano inoltre le regressioni `pitch_detector`
e `pitch_shared` e 12 test di packaging con gli import del Worker fingerprintati.

Lo smoke usa un MediaStream sintetico locale: interferenza periodica a 100 Hz
con ampiezza 0,0008 e vocale a 220 Hz con ampiezze 0,02 e 0,01. La baseline
riconosce anche il disturbo; il gate adattato raggiunge BA della guida 100%
contro 50%, senza cambiare il minimo di confidence. Questo verifica il
meccanismo, **non prova un beneficio sulla voce umana**.

Verificati nel browser: applicazione solo dopo conferma dei segnali, profilo
locale senza PCM, riuso, reset, isolamento fra account, storico/scoring intatti,
rilascio del microfono, chiusura, Escape, backdrop, ritorno del focus anche
su toolbar mobile ripiegata, cambio dispositivo, pagina nascosta e permesso
concesso in ritardo. Screenshot 1366×768 e 390×844 in `artifacts/calibration/`,
ispezionati: nessuno scroll necessario o clipping nella guida, nel risultato o
nel riepilogo applicato. I dettagli espansi possono scorrere intenzionalmente.

Restano da misurare coristi reali, rumori non stazionari, voci aspirate, estremi
di registro e dispositivi meno potenti. L'etichetta data dall'orario della guida
può essere sbagliata: la conferma dell'utente non sostituisce l'annotazione
indipendente. Per questo non si dichiara raggiunta la massima balanced accuracy.

## UX

Si entra dalle impostazioni della prova. Dialogo con istruzione e countdown
dominanti, indicatore di avanzamento, dettagli espandibili e una sola azione
primaria. La prova e ogni audio dell'app sono fermi; nessuna nota obbligatoria.
Il conto alla rovescia riguarda la fase corrente; la prossima azione è sempre
visibile. La durata totale residua è secondaria. L'utente può interrompere e
ripartire senza chiudere il dialogo.

Durante la guida un grafico mostra circa 8 secondi del livello RMS
effettivo letto dal medesimo AnalyserNode (80 campioni, 10 Hz nominali), su scala fissa
−72…0 dBFS. Non normalizza il rumore verso l'alto e non simula un segnale.
Il superamento di 0,99 di picco attiva per un secondo l'avviso testuale di
saturazione. Livello basso/presente è un feedback energetico, non un giudizio
di pitch o qualità. Il meter accessibile espone livello e stato senza annunciare
ogni campione. Le istruzioni sono annunciate a cambio fase; timer e tempo
totale non vengono letti ogni secondo. Con reduced motion il grafico scorrevole
diventa una barra di livello fissa. I livelli temporanei vengono cancellati
al termine o all'annullamento e non entrano nel profilo salvato.

Il contratto di misura e lo storage passano a versione 2; i profili della
guida precedente non vengono riattivati automaticamente.
Il flusso non è obbligatorio per provare un brano. Chiusura esplicita, Escape,
backdrop, pagina nascosta e cambio dispositivo annullano acquisizione/calcolo,
rilasciano il microfono e mantengono la precedente configurazione. I risultati
non applicati sono temporanei e possono essere scartati senza bloccare la chiusura.

## Verifica prima dell'adozione

Il tuning riguarda YIN live e non promuove pYIN offline a detector della prova.
La configurazione selezionata rimane separata dalle preferenze manuali: il reset
ripristina queste ultime. Saranno registrati esiti dei test, soglie implementate
e limiti residui dopo la verifica.

## Release staging v1 del 2026-10-18 (precedente)

La UI espone recall della voce, specificità delle pause e media bilanciata,
con confronto prima/dopo sulla parte di verifica. La didascalia visibile
chiarisce il riferimento alla guida. Il report aggregato resta nel profilo
locale e si rivede riaprendo la calibrazione attiva, senza riaccendere il
microfono. Dopo reload si consulta cercando il profilo compatibile nei dettagli;
la verifica del silenzio riattiva le impostazioni e conserva le stime originali.

- URL: `https://staging.epistrophe.it/?piece=o-sacrum&part=P3`.
- Percorso: **Prova → Impostazioni → Base → Calibra microfono**.
- Build: `20261018-172445-46c4b97f1322-dirty` (istanza personale di staging).
- SHA-256 del deployment manifest:
  `586f9e29aefc45314637a3274bfd6ef32d7d4d9234394412fb2025eeb576f6ef`.
- Versione Worker: `eecf13fa-d308-4b0d-98f9-b860a12061fc`, 100% del traffico.
- Rollback disponibile: `a2d751f2-06b9-4765-8d3d-bac03cb40e07`.

La stessa `dist/` verificata è stata distribuita senza ricostruzione. Gli hash
dei 1278 file del manifest sono stati ricontrollati prima del deploy. Passano
typecheck, 72 test applicativi, 10 test calibrazione, 12 test packaging, 30 test
backend, 14 test di configurazione/sync/artifact, regressioni DSP/clock, audit
artifact/documentazione e audit npm (0 vulnerabilità).

Passano smoke browser della calibrazione su **O sacrum convivium**, registrazione
personale e privacy/mixer, oltre allo smoke completo della release su **Ave
verum**. Quest'ultimo è stato aggiornato per il nuovo primo controllo nelle
impostazioni, per impostare esplicitamente volumi uguali nella prova del full
mix e per mantenere il microfono già attivato durante la prova. Il primo avvio
dello smoke privacy è scaduto durante la build concorrente; ripetuto da solo,
è passato integralmente.

Il browser sulla build usa una fixture locale del profilo Arturo Maianovksi,
tenore/direttore, e audio sintetico. Solo nel server di preview su loopback
sono simulati sessione e risposte API: i file di calibrazione, il Worker DSP e
gli asset della build sono quelli distribuiti. Non è stato eseguito un login
remoto come Arturo né misurata la sua voce. D1 remoto conferma che il membro
è attivo e le migrazioni 0006–0009 risultano applicate; nessuna migrazione o
modifica del profilo è stata necessaria per questa release.

Screenshot della build a 1366×768 e 390×844 in `artifacts/calibration/`:
`desktop.png`, `mobile.png`, `desktop-result.png`, `mobile-result.png`,
`desktop-applied.png`, `mobile-applied.png`. Guida, esito e riepilogo sono stati
ispezionati visivamente; chiusura esplicita, Escape, backdrop e ritorno del focus
restano collaudati. Il checker documentale ora ammette `AGENTS.md` in root,
insieme al README, mantenendo i controlli su metadati e link.

Dopo il deploy: pagina della prova anonima `302` al login con return URL;
login e `/auth/config` `200`; `/api/me`, manifest e JavaScript della calibrazione
anonimi `401`, tutti con `no-store`. La verifica autenticata con voce reale è
ora disponibile all'utente su staging.

## Release staging v2 del 2026-10-18

Guida estesa a 30 secondi, countdown per ogni azione e preparazione, anteprima
della fase successiva, grafico del volume e interruzione esplicita. La verifica
breve di un profilo dura ora 8 secondi. Non si modifica il significato delle
stime voce/pausa né si misura accuratezza F0.

- Build: `20261018-180413-46c4b97f1322-dirty`.
- Manifest SHA-256:
  `1d1f7fd5c3b67e0e1c8cac2d9584d4d2db17fde12ca051a14cb92b666050cb57`.
- Worker: `b5e5c3a1-ac3a-45b7-bda2-06fa7d98421a`.
- Rollback alla v1: `eecf13fa-d308-4b0d-98f9-b860a12061fc`.

La stessa build verificata è stata distribuita su `staging.epistrophe.it`.
Passano typecheck, 72 test applicativi, 11 test calibrazione, 12 test packaging,
30 test backend, 14 test di configurazione/sync/artifact, regressioni DSP/clock,
audit artifact e documentazione, npm audit con 0 vulnerabilità. Passa lo smoke
completo della release su Ave verum; lo smoke calibrazione esercita la vera
durata di 30 secondi su O sacrum convivium con fixture locale di Arturo e audio
sintetico, senza impersonare una sessione remota.

Il browser verifica tutte le otto istruzioni, countdown di preparazione che
avanza, voce almeno 15 dB sopra il rumore della fixture, saturazione, profilo
v2, riuso di 8 secondi, reset, isolamento account, rilascio tracce, chiusura,
interruzione, Escape/backdrop, pagina nascosta e permesso tardivo. Con movimento
ridotto verifica che la barra fissa sia effettivamente disegnata.

Screenshot ispezionati a 1366×768 e 390×844: ingresso, silenzio, canto normale,
canto più piano e risultati, senza clipping o scroll nel flusso principale.
File in `artifacts/calibration/`: `desktop.png`, `mobile.png`,
`desktop-quiet.png`, `mobile-quiet.png`, `desktop-singing.png`,
`mobile-singing.png`, `desktop-soft.png`, `mobile-soft.png`,
`mobile-reduced-motion.png`, oltre a esito e riepilogo applicato.
Il grafico in reduced motion conserva il feedback necessario e rimuove lo
scorrimento. I dettagli espansi possono scorrere intenzionalmente.

Per riprodurre i collaudi audio, avviare gli smoke browser in sequenza. Il
server di preview locale non deve accumulare log in una pipe non consumata:
questo può bloccare l'erogazione degli asset e far fallire l'inizializzazione.
Gli avvii incompleti sono stati ripetuti integralmente dopo la correzione del
solo harness locale; i due smoke finali passano.
