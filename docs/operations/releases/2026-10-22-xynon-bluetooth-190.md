# Xynon: anticipo traccia Bluetooth a 190 ms

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-22

## Risultato

La scelta Cuffie Bluetooth imposta Anticipo della traccia vocale nelle
impostazioni avanzate a 190 ms, rispetto ai precedenti 320 ms. Il preset si
applica alla selezione, alla riapertura del brano e al ripristino dei valori
predefiniti. L'impostazione resta regolabile. Il preset standard e il ritardo
del piano roll conservano i rispettivi 270 ms. Nessuna modifica al layout.

## Distribuzione e verifiche

- Origine: `https://staging.xynon.it`.
- Versione: `c6b69647-84a2-4dd6-8dcb-0aab65663276`, 100% del traffico.
- Pubblicazione: 22 ottobre 2026, 09:27 CEST.
- Tag: `bluetooth-190-2026-10-22`.
- Artefatto: `artifacts/bluetooth-190-release/release`.
- Build: `20261022-072545-9cf44a36476d-dirty`, 1309 file e 19 brani.
- Manifest SHA-256:
  `c77fa5319c63c6fa1440ea1fde50ff0b4f8afe84dda00315dc4f0c93458153ac`.
- Rollback: `66fff3f1-9b54-4c7f-b2d9-3eab29ad9949`.

TypeScript, 112 test applicativi, 79 test audio/calibrazione, audit dipendenze
e documentazione superati. Lo smoke impostazioni sull'esatto artefatto verifica
190 ms nello stato, nello slider avanzato e nel valore mostrato dopo ricarica,
a 1366×768 e 390×844; verifica anche scelta, scadenza e chiusura dei dialoghi.
Integrità del manifest e dry-run Wrangler superati. Pubblicato lo stesso
artefatto verificato, senza ricostruirlo.

Il browser remoto anonimo conferma login e registrazione pronti senza errori
JavaScript/CSP né overflow, protezione degli asset e cache/hash pubblici
corretti. Il registro remoto conferma la versione al 100%. Nessun nuovo
collaudo acustico fisico; il valore è il preset richiesto dal maintainer.
Evidenze in `artifacts/bluetooth-190-release`.
