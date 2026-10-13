# Handoff — trasformare Choir Assistant in una web app pubblica con SSO

**Data:** 28 settembre 2026  
**Destinatario:** esperto/a di web application, sicurezza e deployment  
**Obiettivo:** portare l'attuale prototipo locale a una beta pubblica, con accesso SSO e protezione adeguata, iniziando se possibile da questo PC Windows senza costi infrastrutturali ricorrenti. Questo documento non autorizza la pubblicazione: prima servono le decisioni su dominio, identità, repertorio e privacy.

## 1. Sintesi esecutiva

Il repository contiene un prototipo di esercitazione corale funzionante in browser. L'analisi dell'intonazione del microfono e le registrazioni di benchmark sono oggi locali al browser; le partiture, gli SVG e le basi vengono invece preparati localmente dal PC con MuseScore e serviti da un piccolo server Python.

Non è un'applicazione pubblicabile nello stato attuale. Il server `scripts/serve_frontend.py` è un server di sviluppo/prototipo, privo di autenticazione, autorizzazione, protezione CSRF, audit utenti, database, rate limit e isolamento dei processi. Espone inoltre endpoint di amministrazione che accettano file e avviano conversioni/programmi locali. Non va esposto direttamente su Internet, né dietro un tunnel, senza prima separare e proteggere tali funzioni.

La strada pragmatica è:

1. trasformare il frontend in un sito statico/pubblico che consuma solo asset musicali già pubblicati;
2. introdurre un backend API vero con ruoli e SSO (utente e amministratore);
3. mantenere amministrazione, upload PDF e conversioni su un servizio separato, inizialmente non pubblico;
4. pubblicare la beta da questo PC dietro reverse proxy/tunnel HTTPS, con database e backup locali;
5. spostare poi frontend, API, database e worker su hosting gestito senza cambiare il contratto applicativo.

## 2. Stato verificato del repository (28/09/2026)

### Componenti presenti

| Area | Stato attuale | Implicazione per il web pubblico |
|---|---|---|
| Frontend | HTML/CSS/JavaScript senza framework in `frontend/`; pratica, score, audio, microfono e benchmark. | Può diventare PWA/static frontend, ma occorrono build, CSP, dipendenze pinning e gestione sessione. |
| Pitch/microfono | `getUserMedia`, Web Audio, YIN v1 e confronto CREPE/ONNX; l'audio non viene oggi caricato. | È un buon default privacy-by-design; HTTPS è obbligatorio per il microfono fuori da `localhost`. |
| Dati locali | Preferenze in `localStorage`; take/registrazioni in IndexedDB (`choir-ground-truth`). | Nessuna sincronizzazione fra dispositivi né backup; bisogna decidere se i take resteranno locali. |
| Server | `scripts/serve_frontend.py`, Python stdlib `ThreadingHTTPServer`, default `127.0.0.1:5173`. | Non è idoneo come application server pubblico. |
| Libreria | legge `sheets/*/*.mscz`, genera al primo accesso MusicXML, SVG, MP3, JSON sotto `frontend/library-assets/`. | La generazione on-demand è costosa e non va eseguita nella richiesta pubblica. Pubblicare solo bundle pre-generati e approvati. |
| Admin/ingestione | endpoint POST per PDF e MSCZ, esecuzione MuseScore/FFmpeg/Codex; dati in `data/ingestions/`. | Va eliminato dal piano dati pubblico e accessibile solo a un ruolo admin, idealmente su host/rete distinti. |
| Backend di dominio | contratti Python per score/ingestion; documentazione propone FastAPI + SQLite poi PostgreSQL. | È una buona base concettuale, ma non esiste ancora una API di produzione né persistenza utenti/sessioni. |
| Dipendenza esterna | `onnxruntime-web@1.23.0` è caricato da jsDelivr in `frontend/index.html`. | Per affidabilità, privacy e CSP va preferito asset locale/versionato con hash; se resta CDN, CSP/SRI e valutazione del fornitore. |

### Endpoint attuali da non pubblicare così come sono

`/api/ingestions`, `/api/ingestions/<id>/revision`, `/api/import-musescore`, `/api/musescore-source`, `/api/transpose` e l'accesso ai job non hanno autenticazione/autorizzazione. Alcuni ricevono PDF/MSCZ, scrivono file e invocano MuseScore, FFmpeg o Codex CLI. Il controllo dell'estensione e del limite di 25 MB non è una difesa sufficiente contro file ostili, abuso o esecuzioni onerose.

Anche `/api/library/<id>/bundle` non va mantenuto con la semantica attuale per utenti anonimi: può avviare esportazioni MuseScore e scrivere asset. La produzione deve servire manifest e file già immutabili da storage, mai creare asset durante una richiesta del cantante.

## 3. Architettura-obiettivo minima

```text
browser del cantante
  └─ HTTPS + SSO (OIDC) ──> reverse proxy / WAF
                                 ├─ frontend statico/PWA
                                 └─ API pubblica (FastAPI o equivalente)
                                      ├─ PostgreSQL/SQLite MVP: utenti, ruoli, sessioni, catalogo,
                                      │  consenso e risultati aggregati
                                      └─ storage: soli bundle musicali pubblicati e immutabili

browser admin ── SSO + ruolo admin ──> admin API separata
                                           └─ coda/worker isolato: PDF/MSCZ -> OMR/MuseScore/FFmpeg
                                               └─ storage privato, antivirus/sandbox, audit e review
```

Principi non negoziabili:

- La verifica SSO al bordo (proxy/Access) è utile, ma ogni API deve verificare token/sessione e ruoli propri: `singer` non può chiamare endpoint `admin` nemmeno conoscendone l'URL.
- I bundle cantanti devono essere derivati da una `ScoreVersion` approvata e pubblicata, con manifest/versione/hash. Il repository già adotta questo principio a livello di progetto.
- Il worker che apre file musicali/PDF o invoca OMR non deve avere credenziali del database, token SSO amministrativi né accesso in scrittura ai bundle pubblicati.
- Le basi e le partiture devono essere servite come oggetti immutabili/versionati; API e cache non devono esporre directory del PC.
- Nessun audio di microfono deve uscire dal browser salvo un consenso separato e una funzione esplicita di upload. Per la beta è consigliato mantenerlo locale.

## 4. SSO e modello di accesso da implementare

Usare OpenID Connect (OIDC) con Authorization Code + PKCE. Non implementare password, reset password o provider OAuth proprietari nel progetto.

Modello iniziale:

| Ruolo | Permessi |
|---|---|
| `anonymous` | landing/privacy/cookie policy, nessuna partitura o base se il repertorio non è liberamente distribuibile. |
| `singer` | leggere bundle pubblicati autorizzati, usare pratica e salvare dati solo localmente; facoltativamente vedere i propri risultati sincronizzati. |
| `admin` | gestione repertorio, review, pubblicazione e accesso agli audit. |
| `operator` (facoltativo) | avviare/rivedere job senza poter pubblicare. |

Decisioni che servono prima dell'implementazione:

- provider: un provider OIDC ospitato oppure Keycloak/self-hosted; selezionare almeno Google e Microsoft/Entra solo se coerenti con il pubblico reale;
- criterio di iscrizione: aperta, allow-list per email/dominio, invito, oppure approvazione manuale;
- raccolta dati minima: normalmente `sub` stabile del provider, email verificata solo se necessaria, nome visualizzato opzionale; non usare la foto profilo;
- ciclo di vita: logout, revoca accesso, cancellazione account e retention degli audit;
- non affidarsi al solo dominio email per il ruolo admin: assegnare i ruoli lato applicazione/database e registrarne le modifiche.

Per una beta gratuita è possibile usare il piano gratuito di un provider OIDC o Keycloak su una piccola VM/PC, ma va verificato al momento della scelta il limite di MAU, i domini consentiti e il contratto del provider. L'SSO non richiede intrinsecamente un servizio a pagamento; supporto, SLA, gestione utenti e ridondanza sì, se richiesti.

## 5. Piano a fasi

### Fase A — hardening prima di qualunque URL pubblico

1. Non esporre `scripts/serve_frontend.py` alla rete pubblica. Tenere `--host 127.0.0.1`.
2. Creare due eseguibili/servizi distinti: `public-web` (read-only) e `admin-worker` (privato). Non basta nascondere il pulsante “Revisione”.
3. Pre-generare ogni bundle: MusicXML/JSON/SVG/audio/manifest; togliere MuseScore e FFmpeg dal percorso HTTP pubblico.
4. Implementare API con schema validato, autorizzazione per ruolo, log strutturati senza token/dati audio, rate limit e limiti di payload.
5. Per gli upload admin: allow-list MIME verificata sul contenuto, scansione antimalware, quota, file in storage non eseguibile, nome generato dal server, timeout/memoria/CPU, worker non privilegiato e sandbox/VM separata.
6. Implementare security headers: CSP senza `unsafe-inline` quando possibile, `frame-ancestors 'none'`, HSTS dopo HTTPS stabile, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, Permissions-Policy (microfono solo origin necessario), CORS allow-list e CSRF per eventuali cookie.
7. Sostituire la dipendenza CDN ONNX con file distribuiti dall'origine e versione/blocco di integrità verificabili; mantenere inventario licenze/SBOM e scansione dipendenze.
8. Separare segreti dal repository (`.env` non versionato o secret store); ruotare subito qualsiasi token eventualmente già usato su questa macchina. Nessun segreto nel frontend.
9. Aggiungere backup cifrato e test di ripristino per DB, configurazioni, manifest e asset sorgente; il PC è un singolo punto di guasto.
10. Eseguire test di autorizzazione, upload avversario, abuso/rate limit, XSS/CSP, session fixation/logout e test manuale di revoca SSO prima della beta.

### Fase B — beta pubblica dal PC Windows

Configurazione consigliata, a rischio controllato:

- PC dedicato o almeno account Windows dedicato, aggiornamenti automatici, disco cifrato, firewall in uscita/entrata ristretto, nessun accesso RDP pubblico e backup fuori dal PC.
- Reverse proxy/app server di produzione davanti all'API; il processo applicativo ascolta solo `127.0.0.1`.
- Tunnel nominato Cloudflare verso il reverse proxy, senza aprire porte sul router. Cloudflare documenta che il tunnel usa connessioni in uscita, non richiede IP pubblico né porte in ingresso; per hostname pubblico serve un dominio gestito su Cloudflare. Non usare i Quick Tunnel `trycloudflare.com`: sono destinati ai test e hanno limiti documentati.
- Dominio proprio `app.example.it` e HTTPS. Il tunnel fornisce il bordo HTTPS; se si sceglie un reverse proxy raggiungibile direttamente, usare certificati automatici (ad esempio Let's Encrypt, gratuito) e chiudere 80/443 al router salvo necessità deliberata.
- SSO applicativo OIDC e, come difesa aggiuntiva, policy di accesso al bordo per admin. Non usare il bordo come unica autorizzazione.
- Monitoraggio minimo: uptime esterno, spazio disco, CPU/RAM, stato tunnel, errori 4xx/5xx, backup e avvisi. Stabilire chi spegne il servizio in caso di incidente.

Limiti da accettare apertamente nella beta su PC: disponibilità dipende da corrente/connessione/riavvii, nessuna alta affidabilità, capacità limitata, rischio domestico maggiore e update/backup a carico dell'operatore. È adatto a test con gruppo piccolo e consenso informato, non a un servizio con aspettativa di SLA.

### Fase C — migrazione a hosting gestito

Quando la beta mostra uso reale o quando si raccolgono dati utente server-side:

- frontend statico su hosting/CDN;
- API containerizzata o PaaS europeo, almeno due ambienti (staging/production);
- PostgreSQL gestito con backup/PITR; object storage UE per asset;
- job queue e worker isolati, senza accesso pubblico; OMR/MuseScore in container/VM dedicata;
- provider OIDC gestito con MFA per amministratori; centralizzazione log, error tracking e alert;
- infrastruttura dichiarativa, patching, disaster-recovery testato e DPA con i fornitori.

La scelta cloud deve essere guidata da localizzazione dati, DPA, backup, limiti egress/audio, SLA e costo reale, non dal solo prezzo di ingresso.

## 6. Costi: gratis, da valutare, obbligatori per scenario

| Voce | Beta piccola dal PC | Produzione/scala | Nota |
|---|---|---|---|
| Codice frontend/API, FastAPI, SQLite, Keycloak | Può essere gratuita | Può restare gratuita come licenza | Restano costi operativi, patching e competenze. |
| HTTPS | Può essere gratuito | Può essere gratuito | Certificati Let's Encrypt sono gratuiti. |
| Tunnel pubblico | Può essere gratuito | Dipende da funzionalità/traffico | Cloudflare Tunnel è disponibile nei piani; evitare di dedurre che tutte le funzioni Access/streaming siano gratuite. |
| Dominio | Normalmente a pagamento annuale | A pagamento annuale | Serve un dominio proprio per URL stabile, SSO e tunnel nominato. Un sottodominio gratuito è solo una prova, non un prodotto. |
| Hardware/elettricità/connessione | Già disponibili ma non davvero “zero” | N/A | PC dedicato, UPS e backup aumentano affidabilità ma costano. |
| SSO OIDC | Può rientrare in un free tier/self-hosted | Spesso a pagamento a soglia, per SLA/MFA/supporto | Verificare MAU, provider social, domini e DPA al momento dell'acquisto. |
| Database/storage/backup | SQLite + disco locale gratuiti | Normalmente a pagamento | L'audio non va caricato nella beta: evita la voce più variabile. |
| Osservabilità/email transazionale | Free tier possibile | Spesso a consumo | Email serve solo se si inviano inviti/notifiche. |
| Sicurezza/revisione esterna | Non obbligatoria per una demo chiusa, ma consigliata | Da budgetizzare | Pentest, gestione incidenti e supporto diventano necessari in base a rischio/contratti. |
| Diritti su partiture e basi | **Da verificare prima della pubblicazione** | **Potenzialmente obbligatori** | Il software gratuito non concede i diritti sul repertorio. |

Non indicare ora prezzi numerici: piani gratuiti, limiti e listini cambiano. L'esperto dovrà produrre un preventivo con data, valuta, traffico mensile, numero utenti, dimensione asset e paese di residenza dati.

## 7. Privacy, dati personali e repertorio

Questa sezione è una checklist tecnica/prodotto, non consulenza legale.

- Con SSO si trattano almeno identificatori online e dati account. Se si sincronizzano risultati, note vocali o registrazioni, aumenta il perimetro. Applicare minimizzazione, limitazione della conservazione e sicurezza by design.
- La registrazione audio locale è comunque un trattamento nel dispositivo dell'utente; se non lascia il browser, dichiararlo chiaramente. Non aggiungere analytics di terze parti o upload “diagnostici” senza base giuridica, informativa e scelta esplicita.
- Prima della beta pubblica predisporre: titolare e contatto privacy, informativa Art. 13, finalità/base giuridica, elenco fornitori/sub-responsabili, retention, istruzioni per accesso/cancellazione, registro decisioni e procedura incidenti. Se necessario, far verificare da consulente privacy/DPO se audio e funzionalità rendono opportuna una DPIA.
- L'art. 32 GDPR richiede misure tecniche e organizzative adeguate al rischio; HTTPS da solo non soddisfa questo obiettivo. Riferimento ufficiale: [Regolamento (UE) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj).
- La presenza di PDF, SVG di spartito, MusicXML e MP3 può richiedere autorizzazioni di editori/autori e licenze per la comunicazione online/streaming. SIAE indica licenze specifiche per utilizzi online di musica protetta. Verificare per ogni brano diritti su spartito, elaborazione, sincronizzazione/streaming e territorio; conservare prova delle autorizzazioni. Riferimento: [SIAE — musica in streaming e download](https://www.siae.it/it/utilizzatori/online/musica-streaming-download/).
- Inventariare anche le licenze software/modelli: il repository annota CREPE tiny come MIT, mentre la documentazione segnala che l'uso/distribuzione di Audiveris AGPL va valutato prima del deployment.

## 8. Criteri di accettazione della prima beta

La beta può essere resa pubblica solo quando tutti i punti sono veri:

- URL HTTPS stabile, nessuna porta del PC aperta direttamente a Internet e processo origin non raggiungibile dalla LAN pubblica salvo quanto previsto.
- SSO OIDC funzionante: login, logout, utente non autorizzato, revoca, scadenza token e cambio ruolo testati.
- Un cantante non può richiamare API admin, vedere manifest/job privati, caricare file né innescare MuseScore/FFmpeg/Codex.
- Tutti gli asset serviti sono bundle pre-generati, approvati, versionati e autorizzati dal punto di vista del repertorio.
- Microfono su HTTPS funziona; nessun frame/audio viene inviato al server nella modalità standard; informativa e consenso UX sono coerenti con il comportamento reale.
- Backup e ripristino sono stati provati; log e alert esistono; segreti non sono nel repository né nel browser.
- Test automatici e manuali coprono autorizzazioni, sessione, limiti upload admin, headers, rate limit, vulnerabilità dipendenze e flusso di pratica su browser/mobile principali.

## 9. Materiale da consegnare all'esperto e decisioni aperte

Materiale già disponibile:

- `README.md`, `frontend/README.md`, `backend/README.md`;
- `docs/ARCHITECTURE_AUDIT.md` e `docs/INGESTION_PIPELINE.md` per modello score/worker;
- `scripts/serve_frontend.py` per la superficie attuale da sostituire, non da deployare;
- `frontend/app.js`, `frontend/pitch_detector.js`, `frontend/models/CREPE_TINY_LICENSE.md` per il comportamento client e dipendenze;
- `docs/ECCO_MVP_AUDIT.md`, che già esplicita il divario verso persistenza server-side, auth e audit.

Decisioni del committente richieste prima del preventivo finale:

1. Beta aperta a chiunque o solo a coro/invito? Quanti utenti concorrenti e in quali paesi?
2. Quali provider SSO devono essere supportati e quali dati account sono davvero necessari?
3. I take audio e i risultati devono restare solo sul dispositivo o essere sincronizzati? Per quanto tempo?
4. Quali brani/basi sono autorizzati per pubblicazione online e in quale territorio?
5. È accettabile una beta best-effort dal PC, con manutenzione manuale, oppure serve disponibilità garantita fin dal giorno uno?
6. Budget mensile, budget una tantum e chi è responsabile di dominio, Cloudflare/hosting, SSO, privacy e supporto incidenti?

## 10. Riferimenti esterni da ricontrollare alla data dell'implementazione

- [Cloudflare Tunnel — documentazione](https://developers.cloudflare.com/tunnel/): connessione outbound e pubblicazione senza IP pubblico/porte inbound.
- [Cloudflare Tunnel — prerequisiti e Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/): hostname pubblico richiede dominio su Cloudflare; Quick Tunnel è per sviluppo/test.
- [Cloudflare — published applications](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/): distinguere pubblicazione del tunnel da policy Access/SSO e relativi piani.
- [Let's Encrypt — documentazione](https://letsencrypt.org/docs/): certificati gratuiti, da automatizzare e monitorare.
- [GDPR su EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj) e [SIAE online](https://www.siae.it/it/utilizzatori/online/): conferma legale/contrattuale con professionista competente prima del go-live.

