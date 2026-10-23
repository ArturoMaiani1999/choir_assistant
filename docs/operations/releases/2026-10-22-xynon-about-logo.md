# Xynon: About the logo e toolbar della prova

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-22

## Risultato

Il menù presenta due collegamenti secondari separati: About Xynon per la
missione e About the logo per il simbolo. La nuova pagina riusa il marchio
animato e lo stile editoriale esistenti; spiega le curve di Lissajous, mostra
le coordinate del logo 3D e distingue le figure piane degli esercizi.

Il collegamento Mostra partitura è rimosso dalla toolbar della prova con
spartito e piano roll. Mostra partiture rimane una modalità del menù iniziale;
i precedenti URL della partitura continuano a conservare il ritorno alla prova.

## Distribuzione

- Origine: `https://staging.xynon.it`.
- Worker: `choir-assistant-xynon-staging`, configurazione `wrangler.xynon.jsonc`.
- Versione: `da8faba5-c951-4080-b7ef-da7ea53f17d5`, 100% del traffico.
- Pubblicazione: 22 ottobre 2026, 09:53 CEST.
- Tag: `about-logo-2026-10-22`.
- Artefatto: `artifacts/about-logo-preview/release`.
- Build: `20261022-074839-9cf44a36476d-dirty`, 1310 file e 19 brani.
- Manifest SHA-256:
  `8577d6f8efc3071728f38a5f1cb117cbd3b1caf7385bb865473dea4b0870c5e9`.
- Asset nuovi/modificati caricati: 12.
- Rollback: `c6b69647-84a2-4dd6-8dcb-0aab65663276`.

Distribuito l'esatto artefatto verificato nel turno di implementazione,
senza ricostruirlo; integrità del manifest e sorgenti invariati ricontrollati
prima della pubblicazione. Nessuna modifica a database o secret.

## Verifiche

- TypeScript, 112 test applicativi, 79 test audio/calibrazione e 16 test della
  build superati durante l'implementazione. Audit dipendenze pulito e dry-run
  Wrangler superato prima del deploy.
- Smoke Home sull'esatto artefatto: undici viewport; About e nuova pagina
  del logo a 1366×768 e 390×844, equazioni, tastiera, movimento ridotto e
  ritorno al menù. Navigazione e compatibilità dei precedenti collegamenti
  della partitura superate sui sorgenti. Screenshot Home, prova e pagina
  del logo ispezionati su desktop e mobile.
- Browser remoto anonimo: login e registrazione pronti senza errori
  JavaScript/CSP né overflow; root al login; About, About the logo,
  catalogo, audio, API e codice privato protetti con risposta 401.
- Hash e cache dei file pubblici corrispondenti al manifest verificati;
  registro remoto conferma la nuova versione al 100%.

I flussi autenticati sono verificati localmente con account sintetici.
Evidenze e log in `artifacts/about-logo-preview`.
