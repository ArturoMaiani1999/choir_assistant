# Cache del codice e recupero dell'avvio

**Status:** pubblicato su staging Xynon; verifiche remote anonime completate  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Problema e comportamento

L'indagine sui [blocchi intermittenti](../../engineering/webapp-startup-audit-2026-10-21.md)
ha riprodotto un login da 26 secondi e una Home nera quando l'avvio della
sessione resta pendente. Il codice Clerk veniva riscaricato nei rientri;
le attese non avevano una scadenza applicativa.

Ora JS/CSS con hash vengono conservati nella cache del browser. Il login e
il controllo di avvio sono pubblici; gli altri script restano protetti alla
richiesta e vengono conservati solo nella cache privata del browser. Un
cambio dei contenuti produce un URL nuovo, senza richiedere la pulizia manuale
della cache. Gli alias storici di autenticazione restano disponibili con
rivalidazione, anche per HTML aperto durante un rilascio.

Un controllo sincrono leggero, caricato prima dei bundle principali, mostra
**Caricamento…**. Dopo 15 secondi offre **Riprova**; gli errori espliciti
offrono lo stesso comando immediatamente. Il comando ricarica lo stesso URL,
senza perdere query o destinazione. Se l'avvio termina prima del nuovo
tentativo, il messaggio scompare automaticamente. Il login riusa lo spazio
del proprio stato, mentre la Home usa il fondo nero esistente.

La Home non prosegue silenziosamente senza il profilo se il suo caricamento
fallisce. Configurazione, inizializzazione Clerk e rinnovo token hanno
scadenze da 15 secondi per passaggio; le letture API hanno un limite di
20 secondi dopo l'ottenimento del token. L'interfaccia offre comunque il
recupero dopo 15 secondi complessivi, anche durante il download del bundle.
Trasferimenti audio e upload conservano la politica del chiamante e non
vengono ripetuti automaticamente. L'annullamento richiesto dal chiamante
rimane rispettato durante il fetch delle API. Anche l'uscita ha un limite
di 15 secondi e riabilita il proprio comando se non riesce.

## Politica di cache

| Risorsa | Politica |
| --- | --- |
| Login, configurazione pubblica, HTML protetto, API, audio, partiture, manifest musicali | `no-store` (con `private` per gli asset protetti) |
| JS/CSS applicativi nella root con hash di 12 caratteri | `private, max-age=31536000, immutable` dopo autorizzazione |
| Bundle login, CSS login e controllo di avvio con hash | `public, max-age=31536000, immutable` |
| Alias non versionati `auth-client.js`, `session-client.js` | `no-cache`, pubblici/privati secondo la rotta |
| Errori, sessione assente, membro disattivato | nessuna applicazione della cache immutabile |

Le regole generiche della build per JS/CSS sono `no-cache`; il Worker
imposta esplicitamente la politica per i file con hash. Questo evita
l'header precedente che combinava `immutable` e `no-store`.
Il codice privato non varia per cookie/token: rinnovare il cookie non
invalida una copia identica del codice. Il browser può conservare quel codice
dopo l'uscita; i materiali musicali e i dati richiedono sempre il server.

Non sono cambiati allowlist, controlli di origine, chiavi, permessi,
database, bucket o rinnovo della sessione. Nessuna migrazione.

## Verifiche

- TypeScript e 112 test applicativi superati, compresi timeout SDK/token,
  token rinnovato, annullamento, upload senza scadenza delle letture, cache
  privata e diniego di accesso per anonimi o membri disattivati.
- 16 test build superati: hash del bundle, alias compatibili, riferimenti
  locali, audit dei contenuti e regole di cache.
- Smoke Home e navigazione superati: menù, prova, partitura, mixer, SATB,
  uscita e rilascio del microfono. Lo smoke di navigazione ora attende anche
  la rimozione dello stato di avvio prima di interagire con la pagina.
- Smoke del laboratorio sulla build: sessione scaduta, download con token
  rinnovato, errore esplicito, nuovo tentativo e rilascio microfono superati
  su desktop e mobile.
- Smoke di recupero su sorgenti e build a 1366×768 e 390×844: download
  fermo, configurazione non disponibile, SDK pendente, nuovo tentativo da
  tastiera e cache riutilizzata. I timeout sono accelerati soltanto nel
  browser di prova; i dati di account e Clerk sono sintetici.
- Screenshot ispezionati nei due viewport: messaggio e azione visibili,
  nessun overflow orizzontale; pulsante di almeno 44 px e focus visibile.
  Lo stato iniziale non aggiunge animazioni. I layout sani sono invariati.
- Worker reale in Wrangler locale, bundle login completo: prima apertura
  **1.074.507 byte trasferiti**, seconda apertura **0 byte**; header della
  risorsa `public, max-age=31536000, immutable`. HTML login e `/auth/config`
  restano `no-store`. Per isolare il test della cache, `/auth/config` è stato
  bloccato nel browser; non è una verifica di login con account reale.

Evidenze in `artifacts/startup-cache`: `source/`, `built/`,
`worker-cache.json` e `release/`. Nessun cookie o token reale nelle prove.

Pacchetto finale locale: build `20261021-183143-6811032c1db7-dirty`,
1.308 file. Verificati tutti i 1.307 hash elencati dal manifest e i riferimenti
al controllo di avvio nelle dieci pagine. Dry-run del Worker con gli asset
finali completato; bundle in `artifacts/startup-cache/worker/`. Il dry-run
non pubblica il pacchetto.

```powershell
python scripts/build_dist.py --worker-config wrangler.xynon.jsonc --output artifacts/startup-cache/release
python scripts/browser_startup_smoke.py
python scripts/browser_startup_smoke.py --directory artifacts/startup-cache/release
python scripts/browser_navigation_smoke.py
python scripts/browser_home_smoke.py
```

Il primo accesso deve ancora scaricare il bundle Clerk completo. La modifica
riduce i trasferimenti ripetuti e rende recuperabili le attese; non dichiara
risolta la causa di ogni episodio intermittente né una riduzione del peso
iniziale del login.

## Pubblicazione su staging Xynon

Pubblicato il 21 ottobre 2026 alle **20:36 CEST** su
`https://staging.xynon.it`, versione `5964d742-c01a-4a1d-9a42-4bf98070f02b`,
traffico 100%, tag `startup-cache-2026-10-21`.
Rollback: `8675e5a3-7801-4e28-ada5-b71660e70dae`.

Il confronto predeploy ha individuato modifiche locali estranee nel primo
pacchetto: metronomo, Lissajous, navigazione e piano roll. Il pacchetto
pubblicato deriva quindi dall'esatta release attiva del recupero Worker pitch,
con le sole modifiche di cache e avvio. Conserva audio, detector, recupero
Worker pitch, grafica e navigazione già pubblicati. Nella source map backend
risulta modificato soltanto `src/worker.ts` rispetto al Worker precedente.

- Artefatto: `artifacts/startup-cache/staging-release`.
- Build: `20261021-183445-6811032c1db7-dirty-startup-cache`.
- File: 1.308, incluso manifest; tutti i 1.307 hash verificati.
- SHA-256 manifest: `94c12e68e665865aecfe0779f3acd9c94abee66904df63467cbc972422d91cf5`.
- SHA-256 Worker: `cd1bb7ce49eb2393ba63ec787c36a8ec8941b7bf57eb3fbba281e28ce7a2e061`.
- Smoke di recupero e degli esercizi ripetuti sull'artefatto isolato: superati.
- Caricati 19 asset nuovi o modificati; 1.288 già presenti.

Pubblicati gli artefatti verificati senza ricostruire dalle sorgenti:

```powershell
npx wrangler deploy artifacts/startup-cache/staging-worker/worker.js --no-bundle --config wrangler.xynon.jsonc --assets artifacts/startup-cache/staging-release --tag startup-cache-2026-10-21 --message "Cache versioned frontend code and recover stalled startup with timeout and retry"
```

Verifiche remote in Chrome con profili temporanei:

- Login desktop disponibile dopo 2,60 s al primo accesso e 0,73 s al rientro.
  Download del bundle: 1.072.515 byte la prima volta, **0 byte** al rientro.
  Sono osservazioni singole, non una promessa sui tempi del servizio.
- SHA-256 del bundle login e dei due file di avvio uguali al pacchetto;
  header `public, max-age=31536000, immutable` senza direttive contrastanti.
- HTML login e `/auth/config` ancora `no-store`; alias `auth-client.js`
  rivalidato con `public, no-cache`.
- Risposte anonime `401` con `no-store` per catalogo, bundle musicale, MP3,
  profilo, repertorio API, script applicativo e client di sessione privato.
- Il primo tentativo mobile è scaduto oltre 45 secondi durante il download
  del bundle, senza arrivare alle chiamate Clerk. Lo screenshot conferma il
  nuovo messaggio di attesa lunga e **Riprova**, senza overflow. Questo
  tentativo è conservato come fallimento del caricamento, non come login riuscito.
  L'instabilità del primo download resta quindi aperta.
- Una ripetizione mobile in un altro profilo ha avuto ancora un primo
  download bloccato; alla successiva apertura il modulo è comparso in
  3,05 s. Screenshot mobile del modulo e del recupero ispezionati a
  390×844; nessun errore JavaScript o overflow.

Report e screenshot: `live-desktop/`, `live-mobile/`, `live-mobile-retry/`,
`live-verification.json`, `deployment.json`, `deployment.log` e
`staging-isolation.json` in `artifacts/startup-cache/`.
I controlli remoti sono anonimi; i flussi autenticati sono verificati con
fixture locali. Nessuna modifica a Epistrophe, dati, secret o migrazioni.
