# Xynon: caricamento del repertorio

**Status:** pubblicata su staging Xynon; verifiche remote anonime completate.  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Problema e intervento

La pagina `/repertorio` attendeva il download di `session-client.js`, la richiesta
di configurazione e l'inizializzazione Clerk prima di caricare i dati. Il solo
bundle di sessione pesa 1.555.562 byte prima della compressione. Le tre richieste
successive a profilo, assegnazioni e catalogo ripetevano autenticazione e controlli;
profilo e assegnazioni risolvevano separatamente lo stesso membro.

Il repertorio è di sola lettura e ora usa il cookie di sessione già presente con
`credentials: same-origin`, senza client Clerk nel percorso iniziale. Il Worker
verifica sessione, origine e lista autorizzata come prima. L'uso del cookie per
le richieste nella stessa origine è previsto dalla
[documentazione Clerk](https://clerk.com/docs/guides/development/making-requests).

`GET /api/progress/repertoire` restituisce in un'unica risposta parte vocale,
permesso di navigazione alla Direzione, assegnazioni con avanzamento e metadati
dei soli brani assegnati. Le identità di membro e coro derivano dalla sessione,
non dai parametri della richiesta. La lettura del catalogo tramite binding
ASSETS e la query delle assegnazioni avvengono in parallelo.

Il frontend invia `Accept: application/json`, non segue handshake nel fetch e
torna al login esistente su `401` o redirect, conservando la destinazione.
Il limite di 15 secondi impedisce un'attesa indefinita; **Riprova** permette un
nuovo tentativo. Gli errori non mostrano messaggi interni del server né un
contemporaneo indicatore di caricamento. Il layout è invariato.

## Risultato verificabile

| Costo iniziale del repertorio | Prima | Dopo |
| --- | ---: | ---: |
| JavaScript, prima della compressione | 1.561.430 byte | 6.532 byte |
| JavaScript, gzip locale | 588.666 byte | 2.476 byte |
| Richieste applicative per i dati | 3 | 1 |
| Risoluzioni del membro per questi dati | 2 | 1 |
| Inizializzazione Clerk nella pagina | necessaria | esclusa |

La riduzione del JavaScript iniziale supera il 99,5%. I byte gzip sono calcolati
localmente e non rappresentano una misura della compressione scelta da Cloudflare.
Login e altre pagine continuano a usare il client di sessione esistente.
Cache dei dati, protezione dei materiali musicali, database, secret e binding
non sono modificati. Non servono migrazioni.

## Verifiche

- TypeScript e 95 test applicativi superati, compresi cookie, isolamento di
  membro/coro, preferenza vocale, catalogo non disponibile e negazione di accesso.
- 60 test audio/calibrazione e 14 test della build superati.
- Smoke completo di navigazione superato: repertorio/prova/ritorno, preferenza
  SATB, uscita e rilascio microfono; layout vuoti/popolati da 320 a 1366 px.
- Smoke mirato su sorgenti e build fingerprintata: una richiesta con cookie,
  nessun client di sessione, retry da tastiera, `401`, handshake `307`, timeout.
- Screenshot finali ispezionati a 1366×768 e 390×844: nessun clipping o scroll
  orizzontale; stato d'errore con azione **Riprova** e senza falso caricamento.
- Con dati sintetici locali e rete mobile simulata a 1,6 Mbit/s, latenza 150 ms
  e CPU 4×, la lista è comparsa in circa 0,57 s nell'ultima osservazione. Questa
  misura non include D1 remoto o una sessione Clerk reale e non è una promessa
  sul tempo di caricamento dello staging.
- Build, verifica degli hash del manifest e dry-run Wrangler completati.

Evidenze browser: `artifacts/repertoire-performance/built/result.json` e screenshot
nella stessa cartella. Sonda ripetibile:

```powershell
python scripts/browser_repertoire_smoke.py --directory artifacts/xynon-repertoire-performance/release
```

## Artefatto pubblicato

- Destinazione: `https://staging.xynon.it`.
- Build: `20261021-151121-6811032c1db7-dirty`.
- Asset: `artifacts/xynon-repertoire-performance/release` (1.298 file, incluso
  manifest; hash verificati per tutti i 1.297 file elencati dal manifest).
- Manifest SHA-256: `78fbe2738a8860113c72199edc552a1ac3e3249d7a9938dc6e8d46b1ac1fbebb`.
- Worker SHA-256: `9b6dd067fb5b2e9339732bdd5b2156ae1438d306a108df93ab135fc9437ed4bd`.
- Versione remota verificata prima della pubblicazione:
  `21d4e0b5-412b-44b1-8b3a-00bf02c25dba`, traffico 100%, utilizzabile per rollback.

Il confronto con il pacchetto remoto `xynon-contextual-back-release` conferma
modifiche soltanto al repertorio e ai riferimenti della nuova versione runtime.
Dal confronto delle sette sorgenti applicative nella source map del Worker
precedente risulta cambiato soltanto `src/progress.ts`. Il contesto di ritorno
pubblicato nel rilascio precedente è conservato.

Comando eseguito per pubblicare asset e Worker già verificati, senza ricostruire
il bundle dalle sorgenti:

```powershell
npx wrangler deploy artifacts/xynon-repertoire-performance/worker/worker.js --no-bundle --config wrangler.xynon.jsonc --assets artifacts/xynon-repertoire-performance/release --tag repertoire-performance-2026-10-21 --message "Load repertoire with one cookie-authenticated request and no ClerkJS startup bundle"
```

## Pubblicazione e controlli remoti

Pubblicazione completata il 21 ottobre 2026 alle **17:26 CEST** sul solo
`staging.xynon.it`. Versione `0ee35f73-a318-44b3-9bb8-721fe7b5b102`, traffico
100%, tag `repertoire-performance-2026-10-21`. Caricati sette asset nuovi o
modificati; 1.290 già presenti. Il tempo di avvio Worker dichiarato da Wrangler
è 5 ms e non rappresenta il tempo di caricamento della pagina.

Chrome reale con profili temporanei ha verificato login a 1366×768 e 390×844,
senza errori JavaScript/CSP o overflow. Il primo tentativo mobile è rimasto su
**Caricamento accesso…** oltre il limite dello smoke; una ripetizione isolata
ha caricato correttamente il modulo. In questa ripetizione il solo download
di `auth-client.js` ha richiesto **27,1 secondi**. Il login rimane quindi un
problema di prestazioni separato: il suo bundle non è modificato da questo
rilascio. Il timeout iniziale è conservato fra le evidenze, non conteggiato
come verifica superata al primo tentativo.

Verificati anche registrazione, pagine pubbliche, CSP Xynon, `no-store`, ritorno
al login da `/repertorio`, e `401` per API del repertorio, profilo, catalogo,
bundle, SVG, MP3 e nuovo script del repertorio nel browser anonimo.
La configurazione pubblica espone soltanto la publishable key prevista.
Non sono modificati dati, secret, migrazioni o ambiente Epistrophe.

Evidenze in `artifacts/xynon-repertoire-performance`: `deployment.json`,
`browser.json`, `browser-first-attempt.json`, `browser-mobile-retry.json`
e screenshot desktop/mobile. Rimane la misura con una sessione reale di un
corista: apertura elenco, rientro dal brano e nuovo tentativo dopo scadenza
della sessione. Le prove locali di questi flussi sono descritte sopra.
