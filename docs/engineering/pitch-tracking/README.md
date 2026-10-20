# Pitch-tracking engineering

**Status:** canonical index
**Owner:** project maintainer
**Last reviewed:** 2026-10-20

## Current contract

`TrackedPitch` is the only pitch consumed by scoring. `DisplayPitch` may be
smoothed or shifted visually but must never feed back into scoring. The v1
baseline remains selectable and regression-tested. CREPE/ONNX is an optional
local diagnostic and is not shipped to singers.

## Active documents

- [S25+: prima misura controllata della calibrazione](s25-calibration-probe-2026-10-20.md)
  — tre probe reali, confronto dei livelli, salto di ritardo di 6 ms e ablation temporale.

- [Protocollo sperimentale prioritizzato](echo-experiment-protocol.md)
  — ordine E0–E7, ipotesi, controlli, criteri di esito e decisioni conseguenti.

- [Piano di isolamento della cancellazione sul Samsung](echo-isolation-plan.md)
  — variabili, test discriminanti, obiettivi acustici e vocali, accesso USB.

- [Santo: rientro e variazione del ritardo sul telefono](santo-real-device-2026-10-20.md)
  — test recuperato, introduzione senza canto confermata e verifica offline
  separata del ritardo a regioni di rilevamento invariate.

- [Calibrazione audio unica](unified-audio-calibration.md) — catena audio già
  attiva, misura del ritardo corrente, voce/pausa e riuso automatico.

- [Santo: diagnosi acustica sul telefono](santo-real-device-2026-10-19.md)
  — acquisizione reale, disallineamento di 24,92 ms e replay a maschera invariata.

- [Santo: audit, benchmark e acquisizione diagnostica](santo-echo-study-2026-10-19.md)
  — dati condivisi senza audio, confronto a maschera invariata e WAV locale sincronizzato.

- [Qualità musicale e affidabilità delle misure](../../product/musical-performance-quality.md)
  — attacchi naturali, respiri, vibrato e separazione tra voce e rilevatore.

- [Diagnosi rientro e salti brevi su Santo](echo-failure-diagnosis-2026-10-18.md)
  — audit, riproduzioni sintetiche e dati ancora necessari sul dispositivo.

- [Riduzione del rientro con riferimento all'uscita](reference-echo-cancellation.md)
  — modello acustico congelato, verifica indipendente e preservazione della voce.

- [Tracking causale del ritardo](echo-delay-tracking-2026-10-20.md) — candidato,
  replay del salto di 6 ms, preservazione controllata e limiti della conferma reale.

- [Calibrazione minima del microfono](microphone-calibration.md) — guida locale
  di 30 secondi con countdown per fase, livello audio dal vivo, controllo
  voce/pausa e profili separati per account e ingresso.

- [Ricerca pYIN, diagnosi reale e tuning riproducibile](research-2026-10-18.md) —
  audit del decoder, dati R2 autorizzati, benchmark e limiti della validazione.

- [Pitch Detection Ablation Lab](ablation-lab.md) — YIN raw/tracked e pYIN
  browser CPU, ablation, metriche e oracle librosa.

- [Core live della pitch detection](live-core.md) — pipeline runtime, soglie e
  diagnosi di falsi positivi/negativi.
- [Implementation tracker](implementation-tracker.md)
- [Validation contract](validation.md)
- [Real-vocal corpus plan](corpus-plan.md)
- [Expert audit](expert-audit.md)
- [Octave robustness plan](octave-robustness-plan.md)
- [Dropout and range-rejection plan](dropout-and-range-rejection-plan.md)

The implementation tracker records current execution state. The expert audit
is a snapshot for external review and should be refreshed or date-stamped
before each new submission.
