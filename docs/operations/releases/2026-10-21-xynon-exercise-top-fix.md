# Xynon: esercizi senza firma e fascia vuota sopra il menù

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

La prima correzione era presente soltanto nei sorgenti locali: la release
online conservava la firma Lissajous e il posizionamento automatico della
testata. Questo rilascio porta entrambe le correzioni su staging.

Il laboratorio non include più il contenitore della firma nell'angolo né i
due script che la inizializzavano. Restano le illustrazioni dei tre percorsi.
Testata, navigazione esercizi e contenuto occupano le righe 1, 2 e 3 nella
stessa colonna. L'inserimento di un contenitore vuoto prima della testata
riproduceva una fascia di 77 px su desktop e 73 px su mobile; ora non sposta
più la barra, che rimane a quota zero.

## Pacchetto

- Origine: `https://staging.xynon.it`.
- Configurazione: `wrangler.xynon.jsonc`.
- Versione: `30e7f65e-d3ff-48da-b6a6-2812f490209a`, traffico 100%.
- Pubblicazione: 21 ottobre 2026, 23:24 CEST.
- Artefatto: `artifacts/voice-lab-top-fix/release`.
- Build: `20261021-212229-6811032c1db7-dirty-exercise-top-fix`.
- File: 1308; tutti gli hash del manifest verificati.
- SHA-256 manifest: `d342a2bf8206636d4f250ef9902d25473c7eb82eda8de94da6f209bb060d6391`.
- SHA-256 Worker: `cd1bb7ce49eb2393ba63ec787c36a8ec8941b7bf57eb3fbba281e28ce7a2e061`.
- Base e rollback: `5964d742-c01a-4a1d-9a42-4bf98070f02b`.

Il pacchetto deriva dall'esatta [release di cache e avvio](2026-10-21-startup-cache-recovery.md).
Cambiano il CSS di navigazione, l'HTML del laboratorio e i riferimenti
fingerprintati/runtime. Tutti gli altri moduli e il Worker conservano gli
hash della base. La pubblicazione usa il Worker congelato con `--no-bundle`.

## Verifiche

- Manifest completo, riferimenti locali, configurazione e dry-run verificati.
- Smoke del layout sull'artefatto a 1366×768, 390×844 e 1920×900: firma
  assente, testata a quota zero anche con un contenitore aggiunto alla griglia,
  nessun overflow o scorrimento aggiuntivo in scelta e preparazione.
- Screenshot desktop/mobile del pacchetto ispezionati in
  `artifacts/ambient-curve/built/`.
- Smoke di sessione del laboratorio sull'artefatto: dimostrazione, avvio,
  token rinnovato, errore di sessione scaduta, nuovo tentativo e rilascio del
  microfono superati su desktop/mobile con identità sintetica locale.
- Registro remoto conferma la nuova versione al 100%; caricati sette asset.
- Smoke remoto anonimo: login e registrazione disponibili nei due viewport,
  redirect e protezione di pagina, API e asset corretti, nessun errore JS/CSP
  o overflow. Il layout autenticato è stato verificato sul pacchetto locale;
  questa verifica remota non usa un account reale.

Ricetta, isolamento, log del deploy e risultati in
`artifacts/voice-lab-top-fix/`.

```powershell
python scripts/browser_ambient_smoke.py --dist --directory artifacts/voice-lab-top-fix/release
python scripts/browser_voice_lab_auth_smoke.py --release artifacts/voice-lab-top-fix/release
python artifacts/voice-lab-top-fix/publish.py
python artifacts/voice-lab-top-fix/live_smoke.py
```
