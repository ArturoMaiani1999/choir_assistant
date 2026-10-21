# Xynon: aggiornamento completo e pagina About

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Risultato

Su richiesta del maintainer viene distribuita una build completa del codice
attuale, comprendente tutte le modifiche locali. Include About con il testo
della missione rivisto nel repository, il marchio con Lissajous 3D al posto
della X, il collegamento in fondo al menù e gli aggiornamenti di navigazione,
repertorio, laboratorio vocale, piano roll, metronomo, calibrazione audio,
gestione del pitch, Bluetooth e recupero dell'avvio.

Lo smoke About confronta il testo pubblicabile con il sorgente editoriale,
senza imporre il precedente numero di paragrafi. Il testo attuale ne contiene
sei. La sospensione fuori vista è verificata anche quando il testo breve
lascia il marchio parzialmente visibile a fine scroll.

## Distribuzione

- Origine: `https://staging.xynon.it`.
- Worker: `choir-assistant-xynon-staging`; configurazione `wrangler.xynon.jsonc`.
- Versione: `0287d25b-3ffe-4bf3-92ec-7b178b52dde2`, 100% del traffico.
- Pubblicazione: 21 ottobre 2026, 23:54 CEST.
- Tag: `latest-update-2026-10-21`.
- Artefatto verificato: `artifacts/latest-update-release/release`.
- Build: `20261021-215012-6811032c1db7-dirty`.
- File: 1311; brani: 19; asset nuovi/modificati caricati: 19.
- Manifest SHA-256:
  `ab0fe23ad0c8154a782e69a02bb424749b1b107b18ccdcd1db96ed4af61fcba6`.
- Worker del dry-run SHA-256:
  `cd1bb7ce49eb2393ba63ec787c36a8ec8941b7bf57eb3fbba281e28ce7a2e061`.
- Versione precedente per rollback: `30e7f65e-d3ff-48da-b6a6-2812f490209a`.

Il deploy usa l'esatto pacchetto sottoposto agli smoke, senza ricostruirlo.
Non erano presenti migrazioni D1 in attesa; non sono stati modificati i secret.

```powershell
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/latest-update-release/release --tag latest-update-2026-10-21 --message "Deploy complete Xynon update: About mission, navigation, vocal exercises, audio and startup recovery"
```

## Verifiche

- TypeScript, 112 test applicativi e 72 test audio/calibrazione superati.
- Altri 19 test dedicati a Lissajous e lifecycle del Worker pitch superati.
- 16 test della build e 7 test di configurazione superati; documentazione valida.
- Integrità SHA-256 e inventario completo del manifest verificati; dry-run
  Wrangler con i binding dedicati Xynon superato.
- Smoke di navigazione, uscita e rilascio del microfono superato sui sorgenti.
- Smoke sull'esatto artefatto: Home e About, repertorio, avvio e riuso della
  cache, istruzioni vocali, metronomo e piano roll superati. Home coperta su
  undici viewport; About e superfici principali a 1366×768 e 390×844.
- Screenshot About desktop/mobile ispezionati con l'ultima revisione del testo.
- Registro remoto conferma versione e traffico al 100%.
- Browser anonimo con Clerk reale: login e registrazione caricati, layout
  desktop/mobile senza overflow e senza errori JavaScript/CSP. Root al login;
  accesso, registrazione e uscita rispondono 200 con cache `no-store`.
- Catalogo, spartiti, audio, API, About e laboratorio vocale rispondono 401
  alle richieste anonime JSON. I file pubblici di avvio e autenticazione
  corrispondono agli hash del manifest e usano la cache prevista.

I flussi autenticati sono verificati localmente con account sintetici;
lo smoke remoto non effettua un accesso con codice email e non certifica
il comportamento acustico su dispositivi fisici. Evidenze e log in
`artifacts/latest-update-release`; screenshot locali nelle directory degli
smoke corrispondenti.
