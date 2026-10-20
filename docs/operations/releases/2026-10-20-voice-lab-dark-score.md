# Staging: spartito vocale scuro e compatto

**Status:** pubblicato e verificato su staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Distribuzione

- Destinazione: `https://staging.epistrophe.it`, Worker
  `choir-assistant-auth-staging`, configurazione `wrangler.jsonc`.
- Versione attiva al 100%: `98846e96-7c02-44f4-8a3a-7db192407341`.
- Tag: `voice-lab-dark-score-2026-10-20`.
- Build: `20261019-230551-46c4b97f1322-dirty`, 1.293 file, 19 brani.
- SHA-256 del manifest:
  `5d48e477ea283b93be80f4480178619053c44fc210065d927c5c66190edbda4c`.
- Rollback: `e54627a4-1e2e-47d4-a362-6b720e4f1760`.

## Modifica e verifica

Nel laboratorio vocale, preparazione, canto e istruzioni mostrano note e
pentagramma bianco caldo sul fondo inchiostro. Il foglio chiaro non occupa più
l'altezza del viewport: la preparazione usa uno spartito compatto, seguito dai
controlli e dall'avvio. La dimostrazione conserva note attive ocra, melodia,
metronomo e sequenza già verificata.

L'eccezione visiva è registrata nel
[contratto del laboratorio](../../product/voice-lab-warmup-redesign-plan.md)
e nel [sistema di design](../../product/ui-design-system.md).

Smoke del laboratorio e delle istruzioni superati; screenshot ispezionati a
1366×768 e 390×844 per preparazione, canto e dimostrazione. Verificati anche
gli arpeggi con opzioni aperte e la nota singola. Nessuno scroll nella
preparazione ordinaria. La stessa build distribuita passa lo smoke delle
istruzioni con `--dist`, lo smoke browser dell'app, hash di tutti i file e
dry-run Worker. Documentazione e diff controllati.

Dopo il deploy: versione attiva confermata; login, redirect, rifiuto degli
accessi anonimi agli asset e API, CSP e `no-store` verificati. Evidenze:
`artifacts/voice-lab-dark-release/post-deploy.json`. Autenticazione interattiva
Clerk reale non ripetuta; i test autenticate usano fixture locali.
