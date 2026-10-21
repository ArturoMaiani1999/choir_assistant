# Xynon: continuità di accesso negli esercizi vocali

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

Il laboratorio non caricava `session-client.js` e scaricava frasi vocali,
campioni, accompagnamento e spartito delle istruzioni con richieste prive
del token rinnovato. Con cookie scaduto e pagina ancora aperta, il rifiuto
dei file privati bloccava sia la dimostrazione sia `Comincia`. Inoltre il
messaggio di avvio fallito veniva nascosto dal CSS della preparazione.

La pagina ora carica il client di sessione; i download usano `ChoirAuthFetch`.
Gli errori di accesso conservano un messaggio specifico e quello di avvio
resta visibile vicino a `Comincia`. La correzione non modifica il detector
o la calibrazione. Il difetto è riprodotto con identità sintetica; non sono
disponibili i log del precedente errore segnalato sul Samsung, dove l'utente
ha riferito che il funzionamento era già ripreso prima del deploy.

## Pacchetto

- Origine: `https://staging.xynon.it`.
- Configurazione: `wrangler.xynon.jsonc`.
- Versione: `1442c783-0709-4a3c-86a0-148af7ba30b8`, traffico 100%.
- Pubblicazione: 21 ottobre 2026, 18:51 CEST.
- Artefatto: `artifacts/voice-lab-recovery/release-current`.
- Build: `20261021-164945-6811032c1db7-dirty-voice-lab-auth`.
- File: 1304; 19 brani.
- SHA-256 manifest: `96b616f33fed49b42c024354a3c75fc73a5757d4945fdb293daeeeaf22781acd`.
- SHA-256 Worker: `9b6dd067fb5b2e9339732bdd5b2156ae1438d306a108df93ab135fc9437ed4bd`.
- Base e rollback: `b5c1d94d-9ef6-4a5d-91a2-ac0d945e22a0`.

Il pacchetto parte dall'esatto [rilascio senza Vista](2026-10-21-xynon-no-view.md),
che include le curve con scia.
Sono aggiornati soltanto `voice_lab.js`, la regola CSS dell'errore, il client
di sessione referenziato nel laboratorio e i riferimenti fingerprintati/runtime.
Il bundle del client di sessione e il Worker sono identici alla base.
Le modifiche concorrenti non pertinenti non sono incluse.

## Verifiche

- Regressione con cookie scaduto: il vecchio pacchetto fallisce entrambe le
  azioni; quello corretto scarica e decodifica gli audio reali con token.
- Avvio, errore 401 esplicito, nuovo tentativo e rilascio microfono verificati
  a 1366×768 e 390×844. La dimostrazione non apre il microfono.
- Screenshot di istruzioni, esercizio ed errore ispezionati ai due viewport;
  messaggio e `Comincia` sono visibili senza overflow.
- Core del laboratorio e 14 test della build superati.
- Smoke completo superato per scala, arpeggi, gradi, trasposizione, canto,
  risultato e illustrazioni. Dopo l'ultimo aggiornamento concorrente del piano
  roll, pagina e dipendenze del laboratorio coincidono con quelle verificate,
  salvo il numero di build; regressione di accesso e istruzioni sono ripetute
  sul pacchetto finale. Hash, riferimenti e dry-run Worker sono verificati.
- I test browser usano solo identità locali sintetiche; le fixture non vengono
  distribuite. Non sostituiscono un collaudo autenticato sul Samsung.
- Registro remoto conferma la nuova versione al 100%. Smoke Chromium remoto
  superato: login desktop/mobile, registrazione, redirect iniziale, assenza di
  errori JavaScript/CSP o overflow e asset/API ancora protetti con 401 da anonimo.

Il deploy è completato; la raccolta locale del suo output ha avuto un errore
di decodifica Windows. Lo stato remoto è stato verificato prima di qualsiasi
nuovo tentativo e non è stato necessario ripetere la pubblicazione. Il registro
di deployment e il risultato del browser sono in `artifacts/voice-lab-recovery/`.

Comandi ripetibili:

```powershell
python scripts/browser_voice_lab_auth_smoke.py --release artifacts/voice-lab-recovery/release-current
python scripts/browser_voice_lab_instructions_smoke.py --release artifacts/voice-lab-recovery/release-current
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/voice-lab-recovery/release-current --tag voice-lab-session-2026-10-21
```
