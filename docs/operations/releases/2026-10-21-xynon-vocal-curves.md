# Xynon: curve piane nei percorsi vocali

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

Le illustrazioni di **Scalda la voce**, **Accordi e arpeggi** e **Trova le note**
sono sostituite da Lissajous bidimensionali gialla `1:3`, azzurra `2:3` e viola
`3:4`, con fase relativa `π/2` secondo il riferimento. Ogni curva ruota nel
piano in 60 secondi; un pallino dello stesso colore percorre il tracciato in
12 secondi. Con movimento ridotto restano statiche. Animazione sospesa fuori
vista, in background, durante i dialoghi e nelle fasi successive alla scelta.

## Distribuzione

- Origine: `https://staging.xynon.it`.
- Worker: `choir-assistant-xynon-staging`, configurazione `wrangler.xynon.jsonc`.
- Versione: `85621992-3d89-4043-9f57-e5f252a4d908`, traffico 100%.
- Pubblicazione: 21 ottobre 2026, 18:27 CEST.
- Tag: `vocal-curves-2026-10-21`.
- Artefatto: `artifacts/xynon-vocal-curves/release`.
- Build: `20261021-162509-6811032c1db7-dirty-vocal-curves`.
- File: 1304; 19 brani.
- SHA-256 manifest: `b2a03b0f90d36960b54b2ba56eb3910399a1d889aacd2ecaec838ed76b9def34`.
- SHA-256 Worker: `9b6dd067fb5b2e9339732bdd5b2156ae1438d306a108df93ab135fc9437ed4bd`.
- Rollback: `6b7091bb-5a31-4161-a7a1-f2cd9a616ccf`.

Il pacchetto parte dall'esatto [rilascio Bach](2026-10-21-xynon-bach-calibration.md).
La ricetta `artifacts/xynon-vocal-curves/prepare_release.py` verifica gli hash
di partenza e aggiunge soltanto il renderer SVG, i tre simboli nel laboratorio,
i relativi stili e i riferimenti fingerprintati/runtime. Il confronto del CSS
esclude differenze estranee alle illustrazioni; tutti gli altri asset conservano
gli hash pubblicati. Il Worker è identico alla release precedente.

```powershell
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/xynon-vocal-curves/release --tag vocal-curves-2026-10-21
```

## Verifiche

- Configurazione autenticata valida; TypeScript, 95 test applicativi e 64 test
  audio/calibrazione superati.
- Manifest e riferimenti locali verificati; dry-run Wrangler completato.
- Smoke completo del laboratorio sull'esatto pacchetto fingerprintato passato:
  pallino sul tracciato, colori uniformi, rotazione, movimento ridotto,
  sospensione con dialoghi e uscita dalla scelta, preparazione, canto e risultati.
- Screenshot del pacchetto ispezionati a 1366×768 e 390×844, senza clipping
  delle curve o overflow del documento.
- Deploy completato con 7 asset nuovi/modificati; registro remoto conferma
  la nuova versione al 100% del traffico.
- Smoke Chromium remoto con Clerk reale passato: accesso desktop/mobile,
  registrazione, pagine pubbliche 200, root verso login, assenza di errori
  JavaScript/CSP e overflow. Catalogo, spartiti, audio, API, laboratorio e nuovo
  renderer restituiscono 401 da anonimo.

Il percorso autenticato degli esercizi è verificato sul pacchetto locale con
account sintetico; il controllo remoto usa un browser anonimo. Evidenze,
manifest, screenshot e log in `artifacts/xynon-vocal-curves/`.
