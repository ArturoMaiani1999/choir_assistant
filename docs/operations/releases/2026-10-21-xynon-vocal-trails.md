# Xynon: curve ferme e scia del pallino

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

Le tre Lissajous degli esercizi vocali mantengono forma e orientamento fissi.
Il pallino percorre ogni curva in 12 secondi e lascia una scia monocromatica
di quattro secondi, sempre più tenue e sottile verso la coda. Il tracciato
completo resta al 16% di opacità, così il pallino sembra disegnarlo. La scia
segue il percorso effettivo anche agli incroci e fra due giri. Con movimento
ridotto torna visibile la curva completa statica e la scia è nascosta.

## Distribuzione

- Origine: `https://staging.xynon.it`.
- Worker: `choir-assistant-xynon-staging`, configurazione `wrangler.xynon.jsonc`.
- Versione: `3e3a6439-7f82-4e64-9682-3951cadb9fe3`, traffico 100%.
- Pubblicazione: 21 ottobre 2026, 18:40 CEST.
- Tag: `vocal-trails-2026-10-21`.
- Artefatto: `artifacts/xynon-vocal-trails/release`.
- Build: `20261021-163825-6811032c1db7-dirty-vocal-trails`.
- File: 1304; 19 brani.
- SHA-256 manifest: `a898c6343f7f51f4ba015eb1e83a2c7fff89c05624732fc2454f2c8352a50d9e`.
- SHA-256 Worker: `9b6dd067fb5b2e9339732bdd5b2156ae1438d306a108df93ab135fc9437ed4bd`.
- Rollback: `85621992-3d89-4043-9f57-e5f252a4d908`.

La ricetta `artifacts/xynon-vocal-trails/prepare_release.py` parte dall'esatto
[rilascio delle curve](2026-10-21-xynon-vocal-curves.md), verificandone tutti
gli hash. Cambiano soltanto renderer, stili delle illustrazioni e riferimenti
fingerprintati/runtime. Il Worker coincide con quello già pubblicato.

```powershell
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/xynon-vocal-trails/release --tag vocal-trails-2026-10-21
```

## Verifiche

- Smoke completo del laboratorio sui sorgenti superato: scelta, preparazione,
  canto e risultato, oltre alle nuove asserzioni su curve ferme e scia.
- Smoke dell'esatto pacchetto a 1366×768 e 390×844 superato: pallino sul
  tracciato, testa della scia coincidente col pallino, colore uniforme,
  dissolvenza progressiva, movimento ridotto, sospensione nei dialoghi e
  nelle fasi successive alla scelta, assenza di errori JavaScript.
- Screenshot desktop/mobile del pacchetto ispezionati senza clipping o overflow.
- Configurazione, manifest, riferimenti locali e dry-run Wrangler verificati.
- Deploy completato con 7 asset nuovi/modificati; registro remoto al 100%.
- Smoke Chromium remoto completo passato: accesso desktop/mobile e registrazione,
  pagine pubbliche 200, root verso login, nessun errore JavaScript/CSP o overflow;
  API, laboratorio e asset (compreso il nuovo renderer) protetti con 401 da anonimo.
  La prima esecuzione era rimasta sul caricamento Clerk senza errori; la
  ripetizione completa è passata. I file di autenticazione sono identici
  al rilascio precedente. Entrambi gli esiti sono conservati negli artefatti.

Evidenze e script ripetibili in `artifacts/xynon-vocal-trails/`.
