# Xynon: promemoria volume rimosso dalla prova

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

La scritta **Volume dispositivo consigliato: 50%** sopra i controlli di Play
è rimossa, insieme al relativo stile e al codice che la mostrava. Il riferimento
al volume resta nelle impostazioni di ascolto e nella preparazione audio.
Un avviso prima dell'apertura del brano, da confermare con **OK**, rimane una
collocazione futura da definire nel [contratto della prova](../../product/practice-experience.md).

## Distribuzione

- Origine: `https://staging.xynon.it`.
- Worker: `choir-assistant-xynon-staging`, configurazione `wrangler.xynon.jsonc`.
- Versione: `5f7cb177-80bc-49e2-8040-e8f72f771807`, traffico 100%.
- Pubblicazione: 21 ottobre 2026, 18:53 CEST.
- Tag: `remove-volume-reminder-2026-10-21`.
- Artefatto: `artifacts/xynon-no-volume-reminder/release-current`.
- Build: `20261021-165207-6811032c1db7-dirty-no-volume-reminder`.
- File: 1304; 19 brani.
- SHA-256 manifest: `6ac516b2048e62e6d10157b532e4643a2daae13be509385af9f9d7ad155564ab`.
- SHA-256 Worker: `9b6dd067fb5b2e9339732bdd5b2156ae1438d306a108df93ab135fc9437ed4bd`.
- Rollback: `1442c783-0709-4a3c-86a0-148af7ba30b8`.

Il controllo prima del deploy ha rilevato la pubblicazione concorrente della
[correzione di sessione degli esercizi](2026-10-21-xynon-voice-lab-session.md).
Il pacchetto iniziale non è stato distribuito: la ricetta è ripartita dall'esatto
artefatto aggiornato, conservandone gli hash e modificando solo le tre righe
relative al promemoria, più i riferimenti fingerprintati/runtime. I file del
laboratorio e il Worker mantengono la correzione già pubblicata.

## Verifiche

- Smoke del piano roll sull'esatto pacchetto finale a 1366×768 e 390×844 passato:
  zoom ancorato, trascinamento, pizzico, tastiera, ascolto note, analisi e riproduzione.
- Screenshot desktop/mobile ispezionati, senza clipping o overflow.
- Riferimenti al promemoria assenti dai sorgenti; sintassi JavaScript verificata.
- Hash, manifest, riferimenti locali, configurazione e dry-run Wrangler verificati.
- Deploy completato con 7 asset nuovi/modificati; registro remoto al 100%.
- Chromium remoto: accesso 200, root verso login, API e nuovo bundle app
  protetti con 401 da anonimo. Il percorso autenticato è verificato localmente
  con identità sintetica.

Ricetta, pacchetto iniziale non distribuito, pacchetto finale e log sono in
`artifacts/xynon-no-volume-reminder/`.
