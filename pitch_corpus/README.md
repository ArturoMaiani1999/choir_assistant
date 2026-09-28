# Corpus pitch reale

Questa cartella è il punto d'ingresso della Fase 4. Il gate CI richiede almeno tre file JSON con riferimento F0 indipendente; fra questi devono esserci casi il cui `id` contiene `E01` ed `E02` e `intentionalError: true`.

Schema minimo:

```json
{
  "id": "E01-take-1",
  "independentlyReferenced": true,
  "intentionalError": true,
  "frames": [
    {
      "tSec": 0.02,
      "trackedHz": 220.1,
      "rawHz": 220.3,
      "clarity": 0.9,
      "confidence": 0.85,
      "voiced": true,
      "referenceHz": 220.0,
      "scoreTargetHz": 246.94
    }
  ]
}
```

- `referenceHz`: F0 acustica annotata o misurata indipendentemente; `null` indica non-voce.
- `scoreTargetHz`: nota prescritta dalla partitura, necessaria per E01/E02.
- `trackedHz`/`rawHz`: output v1 acquisito insieme al take.

Non inserire fixture sintetiche in questa cartella: `scripts/runBenchmarkSuite.js --ci` la considera esclusivamente corpus reale.
