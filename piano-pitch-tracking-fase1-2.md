# Piano di implementazione — Pitch Tracking
### choir_assistant · separazione display/scoring, filtro adattivo, test automatici (implementation tracker)

Aggiornare la tabella sotto man mano che le fasi avanzano: ⬜ Da iniziare · 🔶 In corso · ✅ Completata.

| Fase | Descrizione | Stato |
|---|---|---|
| 0 | Hook di test programmatici | ⬜ |
| 1 | Separazione `DisplayPitch` / `TrackedPitch` | ⬜ |
| 2 | Filtro adattivo (One Euro) sulla visualizzazione | ⬜ |
| 3 | Stato provvisorio/confermato in UI | ⬜ |
| 4 | Corpus reale + gate di adozione CI | ⬜ |
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
- [ ] `loadSyntheticTake` + `runAlgorithm('v1')` restituiscono dati frame-level via Playwright, per ogni fixture, senza errori.
- [ ] `baseline_v1_metrics.json` generato e committato.

---

## Fase 1 — Separare `DisplayPitch` da `TrackedPitch`

**Task:**
1. Introdurre tipo `DisplayPitch` distinto da `TrackedPitch`. Inizialmente `DisplayPitch = TrackedPitch` (passthrough puro) — zero cambi di comportamento.
2. Il rendering del piano roll (traccia "Tracking v1") legge da `DisplayPitch`. Lo scoring continua a leggere **solo** da `TrackedPitch`.

**Acceptance (bloccanti):**
- [ ] **No-leakage contract (Node):** su tutte le fixture sintetiche, output di scoring identico bit-a-bit prima/dopo il refactor.
- [ ] **Regressione E2E (Playwright):** su T01/P3, `getMetrics(..., 'v1')` (errore mediano, % voce tracciata, salti >700¢) identico a `baseline_v1_metrics.json`, diff = 0.

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

- [ ] Errore mediano `DisplayPitch` vs traccia CREPE non peggiora rispetto a quello di `TrackedPitch` (baseline).
- [ ] Salti >700¢ di `DisplayPitch` ≤ quelli registrati per v1 in baseline (il filtro non deve introdurre nuovi octave-flip).

### Gate Fase 1-2 (blocca il merge)
- [ ] Tutti i test Fase 0 e Fase 1 passano
- [ ] Almeno 5 delle 7 metriche sintetiche migliorano; nessuna peggiora oltre soglia
- [ ] Test E2E su take reale T01/P3 passano
- [ ] v1 puro resta selezionabile e bit-identico alla baseline registrata

---

## Fase 3 — Stato provvisorio/confermato in UI

**Task:**
1. Esporre `confirmationState: 'provisional' | 'confirmed'` sincronizzato con la logica di conferma esistente (3 frame per salti >300¢, 5 per ottave).
2. Nel rendering, stile visivo distinto per i segmenti provvisori (tratteggio, opacità ridotta), che "si solidifica" alla conferma.

**Acceptance:**
- [ ] Su ogni categoria di `stepChange`, il numero di frame marcati `'provisional'` coincide con la policy dichiarata nel codice, tolleranza ±1 frame per arrotondamento dell'hop.
- [ ] Nessun frame `'provisional'` per salti <300¢ (devono risultare `'confirmed'` da subito, come da policy attuale).
- [ ] Test E2E: `confirmationStates` restituiti da `runAlgorithm` mostrano transizione provisional→confirmed coerente con `stepChange` sintetici, senza intervento manuale/visivo per verificarlo.

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
