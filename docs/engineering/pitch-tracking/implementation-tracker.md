# Piano di implementazione — Pitch Tracking
### choir_assistant · separazione display/scoring, filtro adattivo, test automatici (implementation tracker)

Aggiornare la tabella sotto man mano che le fasi avanzano: ⬜ Da iniziare · 🔶 In corso · ✅ Completata.

| Fase | Descrizione | Stato |
|---|---|---|
| 0 | Hook di test programmatici | ✅ Completata |
| 1 | Separazione `DisplayPitch` / `TrackedPitch` | ✅ Completata |
| 2 | Filtro adattivo (One Euro) sulla visualizzazione | 🔶 Implementato — efficacia reale da ritarare |
| 3 | Stato provvisorio/confermato in UI | ✅ Completata |
| 4 | Corpus reale + gate di adozione CI | 🔶 In corso — attende nuovi take reali |
| 5 | Hop di acquisizione costante (AudioWorklet) | ⬜ |

**Vincolo non negoziabile, valido per tutte le fasi:** `TrackedPitch` (input dello scoring) non cambia mai comportamento nelle fasi 0-3. v1 puro resta sempre selezionabile e bit-identico alla baseline registrata, per rollback immediato.

---

## Ambiente dell'agente

- **Node**: algoritmi puri, fixture sintetiche a verità nota — fonte di verità primaria per le metriche.
- **Playwright**: accesso completo all'app reale (E2E), per validare che i refactor non cambino nulla a runtime, per il take reale, e più avanti per i test di timing/hop.
- **Corpus reale**: take `T01 · take 1 · o-sacrum · P3` (tenore), già presente nell'harness "Analisi locale". La sua traccia CREPE (v5) è usata come **riferimento di regressione relativa** (stimatore diverso da v1, utile a incrociare), non come ground truth acustica assoluta.

---

## Fase 0 — Hook di test programmatici

L'harness di analisi offline esiste già (pagina "Analisi locale", pannello Algoritmi/Sintesi del confronto). Va reso interrogabile dai test senza scraping del testo in UI.

**Task:**
1. Esporre in build dev/test `window.__pitchTestHooks`:
   - `loadSyntheticTake(pcm: Float32Array, sampleRate: number, groundTruth: {tSec, hz}[]): takeId`
   - `runAlgorithm(takeId, algorithmId): { trackedPitch, displayPitch, confirmationStates, rawCandidates }` — array frame-level `{tSec, hz, clarity, confidence, voiced}`
   - `getMetrics(takeId, algorithmId)` — estendere il modulo metriche già dietro "Sintesi del confronto" con: `jitterCents`, `settlingTimeMs`, `overshootCents`, `octaveErrorRate`
2. Generatore fixture sintetiche (Node, riusabile da Playwright): `steadyTone`, `stepChange` (piccolo <300¢ / medio 300–1200¢ / ottava), `vibratoTone`, `harmonicRichTone`, `silenceGap`.
3. Congelare baseline: eseguire v1 su tutte le fixture + sul take reale T01/P3, salvare `baseline_v1_metrics.json` (versionato in repo).

**Acceptance:**
- [x] `loadSyntheticTake` + `runAlgorithm('v1')` restituiscono dati frame-level via browser automation, per ogni fixture, senza errori.
- [x] `baseline_v1_metrics.json` generato e versionato.

---

## Fase 1 — Separare `DisplayPitch` da `TrackedPitch`

**Task:**
1. Introdurre tipo `DisplayPitch` distinto da `TrackedPitch`. Inizialmente `DisplayPitch = TrackedPitch` (passthrough puro) — zero cambi di comportamento.
2. Il rendering del piano roll (traccia "Tracking v1") legge da `DisplayPitch`. Lo scoring continua a leggere **solo** da `TrackedPitch`.

**Acceptance (bloccanti):**
- [x] **No-leakage contract (Node):** su tutte le fixture sintetiche, output di scoring identico bit-a-bit prima/dopo il refactor.
- [x] **Regressione E2E (browser):** su T01/P3, `getMetrics(..., 'v1')` (errore mediano, % voce tracciata, salti >700¢) identico a `baseline_v1_metrics.json`, diff = 0.

---

## Fase 2 — Filtro adattivo (One Euro Filter) solo su `DisplayPitch`

**Task:**
1. `oneEuroFilter.js` puro, parametri configurabili (`minCutoff`, `beta`, `dCutoff`).
2. Applicare **esclusivamente** su `DisplayPitch`.
3. Aggiungere `v1 + display-filter` come nuova voce nel pannello Algoritmi, riusando l'infrastruttura di confronto esistente (accanto a v1…v5).

### Metriche su fixture sintetiche (verità nota → decisive)

| Metrica | Fixture | Condizione di pass |
|---|---|---|
| Jitter (¢, std dev) | `steadyTone`, vari SNR | < baseline_v1 × 0.7 |
| Settling time, salto <300¢ | `stepChange` piccolo | ≤ settling(`TrackedPitch`) |
| Settling time, salto 300–1200¢ | `stepChange` medio | ≤ settling(`TrackedPitch`) |
| Settling time, ottava | `stepChange` ottava | ≤ settling(`TrackedPitch`) |
| Overshoot/undershoot | tutti gli `stepChange` | ≤ overshoot(baseline_v1) |
| Preservazione vibrato | `vibratoTone` | ampiezza residua ≥ 70% dell'input |
| Octave-error rate | `harmonicRichTone` | invariato o migliore vs baseline |

Eseguire ogni riga su una **griglia** (≥5 frequenze × 3 livelli di rumore), non un caso singolo.

### Test su take reale (Playwright — regressione relativa vs CREPE)

- [x] Errore mediano `DisplayPitch` vs traccia CREPE non peggiora rispetto a quello di `TrackedPitch` (baseline).
- [x] Salti >700¢ di `DisplayPitch` ≤ quelli registrati per v1 in baseline (il filtro non deve introdurre nuovi octave-flip).

### Gate Fase 1-2 (blocca il merge)
- [x] Tutti i test Fase 0 e Fase 1 passano
- [x] Tutte le 7 condizioni sintetiche passano sulla griglia 5×3; jitter migliorato, nessuna metrica oltre soglia
- [x] Test E2E su take reale T01/P3 passano
- [x] v1 puro resta selezionabile e bit-identico alla baseline registrata

---

## Fase 3 — Stato provvisorio/confermato in UI

**Task:**
1. Esporre `confirmationState: 'provisional' | 'confirmed'` sincronizzato con la logica di conferma esistente (3 frame per salti >300¢, 5 per ottave).
2. Nel rendering, stile visivo distinto per i segmenti provvisori (tratteggio, opacità ridotta), che "si solidifica" alla conferma.

**Acceptance:**
- [x] Su ogni categoria di `stepChange`, il numero di frame marcati `'provisional'` coincide con la policy dichiarata nel codice, tolleranza ±1 frame per arrotondamento dell'hop.
- [x] Nessun frame `'provisional'` per salti <300¢ (devono risultare `'confirmed'` da subito, come da policy attuale).
- [x] Test E2E: `confirmationStates` restituiti da `runAlgorithm` mostrano transizione provisional→confirmed coerente con `stepChange` sintetici, senza intervento manuale/visivo per verificarlo.

---

## Fase 4 — Corpus reale + gate di adozione CI

**Task:**
1. Raccogliere 3–5 take reali aggiuntivi con reference indipendente (annotazione esperta o segnale a F0 nota), includendo esplicitamente casi di errore intenzionale (E01/E02 — note sbagliate volutamente cantate).
2. `scripts/runBenchmarkSuite.js`: esegue ogni variante (v1 baseline, v1+display-filter, eventuali candidati futuri) sull'intero corpus (sintetico + reale) e produce un report tabellare: errore F0 mediano in cent, octave-error rate, voicing precision/recall, latenza di transizione (p50/p95), jitter.

**Acceptance / gate CI:**
- [ ] Script di confronto candidato vs baseline su tutte le metriche chiave; la build fallisce se una qualunque peggiora oltre tolleranza dichiarata (es. octave-error rate non aumenta; p95 latenza non oltre +X ms; jitter migliora o resta invariato).
- [ ] **Test critico, non aggirabile:** ogni caso E01/E02 nel corpus resta segnalato come errore dallo scoring per tutte le varianti testate. Se una variante "nasconde" un errore intenzionale, il gate fallisce **sempre**, a prescindere dalle altre metriche.

---

## Fase 5 — Hop di acquisizione costante (AudioWorklet)

**Task:**
1. Spostare l'acquisizione del buffer da RAF a `AudioWorklet`/worker dedicato, con hop costante (10–20 ms, da tarare).
2. DSP pesante fuori dal callback real-time del worklet (worker separato, trasferimento buffer efficiente).

**Acceptance:**
- [ ] Deviazione standard dell'intervallo tra frame consecutivi, misurata via Playwright con CPU throttling simulato, inferiore a quella osservata con RAF (soglia iniziale proposta: <3ms, da calibrare sui dati reali).
- [ ] La finestra di conferma (Fase 3) diventa prevedibile: documentare il range di latenza osservato invece di stimarlo nel caso peggiore.

---

## Note per l'agente

- Ogni fase è indipendentemente mergeable: non passare alla fase successiva se il gate della fase corrente non è verde.
- Le soglie numeriche indicate sono punti di partenza, non valori definitivi — vanno ricalibrate quando il corpus reale della Fase 4 sarà disponibile.
- Aggiornare la tabella di stato in cima al documento a ogni fase completata, così il documento resta un tracker vivo e non solo un piano statico.

---

## Registro di implementazione

### 2026-09-27 — Fasi 0–3

- **Fase 0:** aggiunti `frontend/pitch_test_harness.js`, fixture deterministiche, metriche estese e hook dev/test. Congelata `baseline_v1_metrics.json`, inclusa la take reale `T01 · take 1 · o-sacrum · P3` letta da una copia isolata dell'IndexedDB locale.
- **Fase 1:** introdotti `TrackedPitch` e `DisplayPitch`; il punteggio legge esclusivamente `TrackedPitch`, mentre plume e readout leggono `DisplayPitch`. Gli hash v1 e le metriche reali restano identici alla baseline.
- **Fase 2:** aggiunto `frontend/one_euro_filter.js` e variante `v1 + display-filter`, selezionabile insieme a v1 puro. Griglia automatica: 5 frequenze × 3 rumori, tutte le condizioni verdi; jitter mediano `0,001918¢` contro `0,006972¢`, p95 settling invariato a `296 ms`, nessun nuovo salto. Su T01/P3 l'errore mediano verso CREPE è identico: `7,283697¢` per tracking e display.
- **Confronto visivo:** nell'Analisi locale del take esistente sono disponibili i toggle `v1` e `v1+ display`; la seconda traccia è verde chiaro e può essere sovrapposta o isolata rispetto alla baseline e a CREPE.
- **Fase 3:** esposti e testati gli stati provisional/confirmed; conteggi osservati: salto 200¢ = 0, salto 700¢ = 3, ottava = 4. La plume provvisoria è tratteggiata e attenuata; il readout mostra “transizione in verifica”.
- **Automazione browser:** il repository non include Playwright; i test E2E usano Chromium via CDP, coerentemente con gli smoke test già presenti, esercitando la stessa pagina e lo stesso IndexedDB reale.

### 2026-09-27 — Fase 4 in corso

- Aggiunto `scripts/runBenchmarkSuite.js`: confronto baseline/candidato, report tabellare, soglie di regressione e sentinelle E01/E02 non aggirabili.
- Il gate `--ci` resta intenzionalmente rosso finché `pitch_corpus/` non contiene almeno 3 take reali con riferimento indipendente, inclusi E01 ed E02. Questi dati richiedono nuove registrazioni/annotazioni e non vengono sostituiti con fixture sintetiche.
- La Fase 5 non è stata avviata, come richiesto dal vincolo sequenziale del piano.

### 2026-09-28 — Navigazione audio nell'analisi locale

- Il piano roll del benchmark ora funziona anche da testina di riproduzione: clic per selezionare un punto, `Riproduci da qui` (o doppio clic/spazio) per avviare e pausa dallo stesso comando.
- La conversione fra posizione audio e beat usa i timestamp dei frame registrati, quindi resta sincronizzata anche in presenza di cambi di tempo; durante il play la testina viene aggiornata a ogni frame e segue automaticamente la vista quando è applicato lo zoom.

### 2026-09-28 — Audit di non banalità del filtro sul take reale

- Escluso un bug di plumbing: sul take T01/P3 `DisplayPitch` viene calcolato dal filtro ed è numericamente distinto da `TrackedPitch` in 4.781/6.605 frame confrontabili.
- Il cambiamento è però sostanzialmente nullo: differenza mediana `3,84e-13¢`, p95 `0,135¢`, massimo `0,846¢`; lo scarto mediano da CREPE resta quindi identico (`7,283697¢`).
- Causa identificata: `snapThreshold = 0,01` semitoni (1¢) resetta il One Euro Filter nel `57,62%` delle transizioni vocali adiacenti. Anche `beta = 0` resta quasi neutro per effetto dei reset (p95 `0,852¢`).
- Controllo diagnostico con snap disabilitato e `beta = 0`: il filtro agisce (p95 `10,537¢`, massimo `136,148¢`) ma peggiora lo scarto mediano da CREPE a `7,781¢`, quindi questa configurazione non è adottabile.
- `scripts/inspect_local_pitch_take.py --crepe` ora include un guardrail `nonTrivial`: richiede almeno `0,05¢` di differenza mediana oppure `1¢` al p95, oltre ai conteggi sopra `0,1¢` e `1¢`. La configurazione corrente risulta intenzionalmente non banale = `false` e la Fase 2 resta in revisione per efficacia reale.

### Fase 2b — Ritaratura guidata dal residuo F0 reale

Questa sottofase sostituisce il confronto diretto con CREPE come criterio principale per il filtro di visualizzazione.

**Protocollo:**

1. Estrarre dalle note tenute del take reale il residuo F0 rispetto a un contorno ottenuto con passa-basso a fase zero a circa `1,5 Hz`, escludendo i primi `150 ms` di ogni attacco.
2. Analizzare la PSD del residuo separando almeno le bande `2–4 Hz`, `4–7 Hz` (vibrato), `8–10 Hz` e `>10 Hz`. La scelta se attenuare energia nella banda vocale 2–8 Hz è esplicitamente una decisione UX, non una correzione automatica.
3. Costruire fixture direttamente nel dominio `(t, hz)`: residuo reale sovrapposto a note tenute, step e glide con verità nota; aggiungere glitch controllati di 1–3 frame. Non risintetizzare PCM e non rieseguire YIN in questa sottofase.
4. Dividere T01/P3 a metà nel tempo: prima metà per taratura, seconda metà per validazione. Nessun parametro può essere scelto sul risultato della metà di validazione.
5. Confrontare: One Euro ritarato (`snapThreshold` iniziale 80–150¢), Hampel causale + EMA leggera, mediana causale di 5 frame e Hampel + One Euro.

**Metriche primarie:**

- ruvidità: RMS della derivata seconda in cent nelle sole note tenute, dopo l'esclusione degli attacchi;
- lag: ritardo tramite cross-correlazione rispetto a `TrackedPitch`;
- preservazione: energia residua 4–7 Hz e settling sugli step noti;
- glitch: tasso di soppressione per impulsi di 1–3 frame e falsi interventi sugli step reali.

**Regola di scelta, fissata prima della taratura:** un candidato è ammissibile solo se conserva almeno il `70%` dell'energia 4–7 Hz, sopprime almeno l'`80%` dei glitch iniettati oltre 100¢, non peggiora il settling p95 degli step di oltre `20 ms`, non introduce nuovi octave-error e presenta lag di cross-correlazione ≤`40 ms`. Fra i candidati ammissibili vince quello con minore ruvidità RMS sulla metà di taratura. La metà di validazione viene aperta una sola volta per confermare o respingere il vincitore, senza nuova taratura.

Gli intervalli di confidenza al 95% sono ottenuti con bootstrap per **nota tenuta** (2.000 ricampionamenti dei segmenti), mai per frame: i frame consecutivi sono autocorrelati e non costituiscono osservazioni indipendenti. Le soglie iniziali restano versionate; un loro cambiamento richiede una nuova riga nel registro con motivazione, prima di rieseguire il confronto.

CREPE resta un sanity check con tolleranza esplicita di `+1¢`, oppure viene confrontato dopo smoothing non causale a fase zero; non decide più da solo l'adozione del filtro.

Gli affondi in prossimità degli attacchi vengono valutati separatamente: se v1 e CREPE coincidono temporalmente, non vengono cancellati dal filtro ma presentati tramite lo stato `provisional` già introdotto nella Fase 3.

Per ogni onset MusicXML, nella finestra `[onset−100 ms, onset+150 ms]`, il report deve misurare separatamente per v1, CREPE e posterior audio: profondità massima sotto il target, durata sotto `target−100¢` e presenza di una transizione non-vocalizzato→vocalizzato immediatamente precedente. Se il pattern è confinato ai primi `80–120 ms` dopo l'onset di voicing, il candidato UX è uno stato display `provisional-onset`; non si modifica `TrackedPitch`.

La diagnostica è implementata in `inspect_local_pitch_take.py` e separa valori pre-onset e post-onset, per non scambiare la nota precedente (legittimamente lontana dal nuovo target) per un affondo d'attacco. Nessuna regola `provisional-onset` viene attivata finché questa separazione non mostra un pattern post-onset ripetibile.

**Prima verifica sugli octave-jump:** T01/P3 contiene 6 transizioni v1 oltre 700¢ e 4 CREPE, concentrate nello stesso episodio intorno a `34,6–35,0 s` vicino all'attacco di battuta 12. Il matcher temporale uno-a-uno (`±150 ms`) associa tutti e 4 i salti CREPE a un sottoinsieme dei salti v1. Questo sostiene l'ipotesi di un evento acustico reale in quell'episodio; non dimostra invece che tutti gli affondi visivi osservati nelle altre battute abbiano la stessa origine, perché possono essere sotto 700¢ o separati da gap di voicing.

Il report conserva il vecchio conteggio frame-adjacency solo per compatibilità con la baseline e aggiunge la definizione confrontabile fra stimatori: massimo `|Δ|` entro una finestra temporale di `100 ms`, senza attraversare gap vocali oltre `100 ms`, con rilevazioni contigue raggruppate in un singolo episodio. Per i due eventi v1-only stampa inoltre `rawHz`, `clarity`, `confidence`, `rejectionReason`, distanza temporale e presenza di frame non vocalizzati intermedi.

**Esito v1-only:** i due salti sono i bordi dello stesso plateau d'ottava breve: `219,96→445,15 Hz` a `34,720 s`, seguito da `444,35→217,04 Hz` a `34,760 s`. Non attraversano gap di voicing e non coincidono con un onset; i frame alti hanno clarity circa `0,61–0,63` e confidence circa `0,357`, sensibilmente inferiori ai frame bassi circostanti (clarity `0,94–0,97`, confidence `0,49–0,61`). `rawHz` segue lo stesso raddoppio, quindi il candidato nasce da YIN e viene accettato dal tracker. È un bersaglio naturale per Hampel/mediana o per una guardia di conferma, non per la soppressione degli attacchi.

Con la metrica temporale comune il cluster produce 1 episodio v1 e 2 episodi CREPE: questo conferma che il conteggio 6-vs-4 misurava bordi frame-level, non sei/quattro eventi percettivamente indipendenti.

### 2026-09-28 — Compensazione temporale della visualizzazione live

- Aggiunto nelle Impostazioni l'anticipo temporale della plume v1 (`0–200 ms`, passo `10 ms`, default `60 ms`). Il valore viene salvato nelle preferenze.
- La compensazione modifica soltanto la coordinata temporale disegnata, tenendo conto della velocità di riproduzione e della tempo map; campioni originali, timestamp, `TrackedPitch`, scoring, readout e analisi benchmark restano invariati.
- La linea verticale `ORA` mantiene un pallino dedicato sul `DisplayPitch` istantaneo, non anticipato. Il pallino usa il colore della plume ed è attenuato durante uno stato provvisorio, così la compensazione della traccia storica non elimina il riferimento live.

### 2026-09-28 — Sensibilità per canto a bassissimo volume

- Esteso il minimo regolabile della soglia v1 da `0,0001` a `0,00001 RMS`, mantenendo invariato il default `0,001 RMS` e la mappatura logaritmica dello slider.
- Alla sola soglia personalizzata sotto il default, un segnale molto debole ma chiaramente periodico riceve un pavimento di confidence sufficiente a superare anche il gate del tracker. Il percorso e la baseline alla soglia predefinita restano invariati.

### 2026-09-28 — Preferenze globali e microfono su Play

- Le impostazioni del detector, tracker e plume sono ora salvate in una preferenza globale e condivise fra brani e parti; le preferenze musicali (posizione, frase, velocità, volumi) restano specifiche del brano. Le vecchie impostazioni per-brano vengono migrate automaticamente al primo caricamento.
- L'anticipo temporale predefinito per nuove preferenze e per “Ripristina predefinito” è `200 ms`; un valore già scelto dall'utente non viene sovrascritto.
- Avviando Play, se il microfono non è già attivo, la webapp ne richiede automaticamente l'attivazione prima della riproduzione. Una negazione del permesso viene segnalata ma non impedisce l'ascolto del brano.

Comandi di verifica principali:

```text
node frontend/pitch_detector.test.js
node frontend/one_euro_filter.test.js
node frontend/pitch_test_harness.test.js
node scripts/generate_pitch_baseline.js --verify
node scripts/run_pitch_phase2_grid.js
node scripts/runBenchmarkSuite.js
python scripts/browser_pitch_harness_smoke.py
python scripts/inspect_local_pitch_take.py --indexeddb <Chrome/Default/IndexedDB> --crepe
```
