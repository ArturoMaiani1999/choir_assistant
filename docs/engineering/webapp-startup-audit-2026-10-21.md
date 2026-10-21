# Avvio lento e blocchi intermittenti della webapp

Data: 21 ottobre 2026. Indagine in sola lettura sugli staging Xynon ed
Epistrophe; nessuna pubblicazione, modifica delle sessioni o dei dati.

## Esito

Il caricamento lento del login è riprodotto nel browser reale. Il costo
dominante nei tentativi lenti è il download del bundle applicativo che
incorpora Clerk, non le successive chiamate alla Frontend API di Clerk.

È riprodotta separatamente una Home completamente nera quando la promessa
di inizializzazione della sessione rimane pendente. Il codice non impone una
scadenza a questa attesa e apre il menù soltanto dopo aver ottenuto il profilo.
Questo spiega un possibile blocco apparente anche con connettività presente.

La segnalazione dell'utente riguarda episodi intermittenti su più pagine,
mentre durante l'indagine il servizio è tornato a funzionare. Non è stata
osservata una sessione autenticata durante uno di quegli episodi: download,
rinnovo della sessione e database non possono essere attribuiti come causa
unica di tutti gli episodi. La parte login e la dipendenza bloccante della
Home sono dimostrate; il contributo del database resta da misurare.

## Misure remote anonime

Chrome headless con profili temporanei, senza usare account o cookie reali.
Desktop 1366×768; mobile 390×844 con DPR 3. La disponibilità del modulo è
misurata dalla navigazione alla comparsa del primo campo nel contenitore Clerk.

| Tentativo | Modulo disponibile | Download auth-client.js | Corpo compresso | Corpo decodificato |
| --- | ---: | ---: | ---: | ---: |
| Xynon, profilo nuovo desktop | 15,67 s | 13,13 s | 1.069.817 B | 3.283.575 B |
| Xynon, rientro nello stesso profilo | 0,92 s | 0,25 s | 1.070.368 B | 3.283.575 B |
| Epistrophe, profilo nuovo desktop | 12,06 s | 9,10 s | 1.070.274 B | 3.283.575 B |
| Xynon, altro profilo nuovo desktop | 26,41 s | 23,29 s | 1.070.334 B | 3.283.575 B |
| Xynon, mobile sintetico, rete 1,6 Mbit/s e CPU 4× | 7,28 s | 5,55 s | 1.069.787 B | 3.283.575 B |

I tentativi desktop iniziali Xynon/Epistrophe sono stati eseguiti in parallelo:
non costituiscono un confronto controllato fra i due servizi. Il secondo
profilo nuovo Xynon ha confermato il ritardo anche senza quel confronto.
Il mobile è un'emulazione, non una misura su telefono fisico. La variabilità
fra queste osservazioni non permette una stima del percentile del servizio.

Nei tentativi desktop, `/auth/config` richiede 35–564 ms; le richieste Clerk
`/v1/environment` e `/v1/client` richiedono individualmente 38–490 ms e si
sovrappongono. Non sono emersi errori JavaScript né long task sopra 50 ms
in quei tentativi. Nel mobile sintetico è presente un long task da 114 ms,
insufficiente a spiegare da solo l'attesa di diversi secondi.

Il tempo al primo byte dello script nei due tentativi Xynon lenti è circa
319 e 417 ms. La maggior parte dei 13–23 secondi è successiva al primo byte:
non è evidenza di un Worker che impiega tutto quel tempo ad avviarsi.
Il bundle di login è pubblico e questo percorso non interroga D1.
Rete di trasporto, edge e percorso locale possono contribuire al download;
queste misure non isolano quale componente determina la variabilità.

## Cache e dimensioni

Una richiesta HEAD dal browser ha restituito per `/auth-client.js`:

```text
Cache-Control: public, max-age=31536000, immutable, no-store
Content-Encoding: zstd
```

Le regole generiche `/*.js` e specifiche `/auth-client.js` in
`scripts/build_dist.py` producono direttive contrastanti. Il rientro ha
comunque trasferito nuovamente circa 1,07 MB: lo 0,92 s osservato non è una
prova che il browser abbia conservato il bundle in cache. Anche
`session-client.js` ha una regola esplicita `no-store`. Il Worker impone
`private, no-store` a tutti gli asset protetti, inclusi script e CSS con hash:
ogni navigazione ricrea quindi una parte consistente del costo di rete.

Il bundle login locale ricostruito ha esattamente la dimensione del corpo
decodificato remoto. Il metafile esbuild attribuisce circa 1,56 MB a
`@clerk/clerk-js/dist/clerk.mjs`; il resto comprende UI, React, localizzazioni
e altre dipendenze. Compaiono anche componenti di configurazione SSO e
organizzazioni. Non è un piccolo bootstrap per il solo accesso via email.

Costi degli script referenziati dal pacchetto pubblicato documentato in
`artifacts/voice-lab-recovery/release-current`:

| Pagina | Script iniziali | Byte non compressi | Gzip locale | Client sessione |
| --- | ---: | ---: | ---: | --- |
| Home / prova | 28 | 2.216.376 | 762.712 | sì |
| Laboratorio vocale | 11 | 1.746.286 | 639.670 | sì |
| Direzione | 8 | 1.726.817 | 634.598 | sì |
| Repertorio | 1 | 6.532 | 2.476 | no |
| Partitura | 4 | 53.759 | 15.452 | no |

Sono somme dei file, non misure di trasferimento remoto. La precedente
ottimizzazione del repertorio è effettiva, ma non alleggeriva tutta l'app.
Il laboratorio ha successivamente riaggiunto il client di sessione per
correggere i download con cookie scaduto: vedere
[continuità di accesso negli esercizi](../operations/releases/2026-10-21-xynon-voice-lab-session.md).
Rimuoverlo indiscriminatamente reintrodurrebbe quel difetto.

Come esperimento di sola build, l'export installato `@clerk/clerk-js/no-rhc`
produce un login da 2.564.597 B e un client sessione da 840.732 B, contro
3.283.575 e 1.555.562 B. Non è una correzione applicata né validata per i
flussi reali: dimostra soltanto che parte del peso dipende dall'entry point.
Gli output dell'esperimento sono negli artefatti, non nel frontend.

## Perché la pagina può sembrare bloccata

In `frontend/app.js`, `initialize()` scarica il catalogo, poi attende
`loadMemberProfile()`. Quest'ultima attende `PerformanceSharing.me()`, che
passa da `ChoirAuthFetch`. In `frontend/session-client.ts`, ogni richiesta
attende prima `ChoirAuthReady` e poi `session.getToken()`.

`ChoirAuthReady` dipende da `/auth/config` e `clerk.load()`. Non c'è un timeout
applicativo per questi passaggi. Un errore che arriva al catch può essere
gestito, ma una promessa ancora pendente non raggiunge il catch. L'apertura
del dialogo Home avviene più avanti: nel frattempo può restare solo il fondo nero.
Anche il download dello script, essendo `defer`, precede l'esecuzione degli
script differiti successivi.

Riproduzione locale: catalogo e script disponibili, profilo sintetico,
inizializzazione della sessione ritardata intenzionalmente di 120 secondi.
Dopo tre secondi il catalogo è già arrivato (14 ms), `/api/me` non è ancora
partita e il menù non è aperto. Lo screenshot mostra una pagina nera.
È una simulazione della dipendenza, non una prova di un disservizio Clerk reale.

Con autenticazione sintetica immediata, la Home locale si apre in circa
1,14 s anche con CPU rallentata 4×. La scena animata aumenta i tempi fra
frame (mediana 18 ms desktop e 12 ms mobile contro circa 6 ms in pausa nel
browser di prova); nei campioni di tre secondi non produce long task.
L'animazione ha un costo, ma il blocco completo della CPU non è riprodotto.

## Altro percorso condiviso da misurare

`src/worker.ts` esegue autenticazione e `isAuthorized()` prima di servire
ogni asset protetto. `isAuthorized()` interroga D1. Per le API segue anche
`resolveMember()`, con query per membro, ruoli, gruppi e permessi.
Una pagina con 28 script, più CSS e dati, genera quindi molte verifiche,
anche per file immutabili. Un rallentamento di questa dipendenza potrebbe
interessare più pagine pur con Internet funzionante.

Non sono stati raccolti tempi D1 autenticati durante un episodio reale.
Non viene quindi dichiarato un guasto D1 o un ciclo di handshake osservato.
Il Worker è predisposto alla verifica JWT con chiave locale; la normale
verifica di firma non richiede necessariamente una chiamata remota a Clerk.

## Priorità degli interventi

1. Rendere visibile e recuperabile l'avvio: mostrare la superficie iniziale
   prima delle attese remote, distinguere sessione e dati, introdurre una
   scadenza e un'azione di nuovo tentativo. Il recupero deve coprire anche
   lo script che non termina il download, non solo il catch dopo `clerk.load()`.
2. Ridurre il costo ripetuto del codice: separare codice statico da contenuti
   musicali privati, definire una politica coerente per script versionati
   e mantenere la verifica dei permessi su dati e materiali protetti.
   Non cambiare indiscriminatamente la cache di tutte le risposte.
3. Ridurre il bundle di autenticazione e caricare il motore musicale quando
   serve. Conservare rinnovo della sessione, uscita e sicurezza dei download.
4. Aggiungere misure separate per autenticazione, autorizzazione D1 e asset
   sul server, e per download/sessione/dati nel browser. Nessun cookie,
   token o indirizzo email nei report. Servono per attribuire il prossimo
   episodio intermittente anziché dedurlo dal solo spinner.

## Ripetibilità e limiti

Sonda aggiunta: `scripts/browser_startup_audit.py`.

```powershell
python scripts/browser_startup_audit.py --output artifacts/startup-audit/xynon-desktop
python scripts/browser_startup_audit.py --mobile --slow-network --cpu-rate 4 --attempts 1 --output artifacts/startup-audit/xynon-mobile-slow
python scripts/browser_startup_audit.py --home-fixture --attempts 1 --cpu-rate 4 --output artifacts/startup-audit/home-desktop-cpu4
python scripts/browser_startup_audit.py --home-fixture --session-delay 120 --timeout 3 --attempts 1 --output artifacts/startup-audit/home-pending-auth
```

Report JSON e screenshot in `artifacts/startup-audit/`. Ispezionati gli
screenshot del login a 1366×768 e 390×844, oltre alla Home nera simulata.
La sonda salva URL senza query, dimensioni, tempi, errori sintetici e pochi
header pubblici; non salva cookie o token. Le prove locali sostituiscono
esplicitamente l'autenticazione e non misurano D1 o una sessione reale.

Questa indagine aggiunge solo sonda e rapporto. Non modifica frontend,
Worker, configurazione di Clerk, cache live o dati. Non è stato eseguito
un deploy e non viene dichiarata una correzione delle prestazioni.
