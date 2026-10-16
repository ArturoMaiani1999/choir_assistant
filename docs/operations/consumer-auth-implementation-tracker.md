# Consumer authentication implementation tracker

**Status:** active
**Owner:** project maintainer
**Last reviewed:** 2026-10-13
**Branch:** `feature/consumer-auth`

Questo documento registra motivazione, piano, stato ed evidenze del passaggio
da Cloudflare Access Zero Trust all'autenticazione consumer con mailing list
autorizzata. Non certifica che il sistema sia già attivo in produzione.

## Motivazione

Cloudflare Access è adatto a identità workforce e applicazioni aziendali, ma il
caso d'uso di Choir Assistant è diverso: coristi esterni autorizzati dal
responsabile del coro. Il limite gratuito di 50 utenti Zero Trust renderebbe un
coro di 56 persone economicamente sproporzionato rispetto all'infrastruttura.

L'obiettivo è permettere a un numero molto maggiore di persone di autenticarsi
come utenti consumer senza trasformarle in seat Zero Trust. L'autenticazione e
l'autorizzazione restano separate:

```text
Clerk verifica: questa persona controlla questa email?
D1 verifica: questa email è autorizzata dal responsabile del coro?
Worker decide: può ricevere HTML, JSON, spartiti e audio?
```

Per "open access" si intende quindi **registrazione/login consumer aperti**,
non accesso anonimo al repertorio. Un account Clerk valido non concede da solo
alcun contenuto protetto.

## Obiettivi e non-obiettivi

### Obiettivi

- Eliminare il conteggio dei coristi come seat Cloudflare Zero Trust.
- Mantenere la mailing list sotto il controllo del maintainer.
- Proteggere ogni asset, inclusi URL diretti di SVG, JSON e audio.
- Non inserire email dei coristi o segreti nel repository.
- Fallire in modo chiuso in caso di errore di autenticazione o D1.
- Rendere staging, verifica indipendente, rollback e costi controllabili.

### Non-obiettivi

- Il browser non può impedire a un utente autorizzato di salvare o registrare
  contenuti già ricevuti.
- Questa fase non introduce pagamenti, abbonamenti o account pubblici premium.
- Il server locale di authoring non viene pubblicato su Internet.
- Il cutover non avviene finché staging e revisione di sicurezza non passano.

## Decisione architetturale

```text
browser
  -> Clerk email code / magic link
  -> sessione firmata
  -> Cloudflare Worker
       1. verifica firma, scadenza, issuer e origine prevista
       2. normalizza l'email verificata
       3. calcola HMAC-SHA-256
       4. richiede digest attivo in D1
       5. serve l'asset soltanto dopo entrambe le verifiche
```

La lista sorgente rimane un CSV/file privato esterno alla repo. D1 conserva
soltanto digest HMAC pseudonimi. Cloudflare Access rimane davanti alla produzione
attuale fino al cutover e costituisce il rollback immediato.

## Criteri di accettazione

- [x] Richiesta anonima HTML: redirect al login senza body protetto.
- [x] Richiesta anonima diretta a JSON/SVG/audio: `401`, mai asset o HTML login.
- [x] Identità Clerk valida ma assente da D1: `403`.
- [x] Membro D1 attivo: asset servito con cache privata disabilitata.
- [x] Errore D1/HMAC: `503` senza invocare l'asset binding.
- [x] Revoca D1 efficace dalla richiesta successiva.
- [x] Return URL limitati a percorsi same-origin.
- [x] Nessun secret Clerk backend nel Worker.
- [x] Richieste su hostname alternativo rifiutate prima di auth e asset.
- [x] Deploy bloccato se `workers.dev`, preview o route canonica sono errati.
- [x] Sessioni Clerk impersonate e claim email malformati rifiutati.
- [x] Sostituzione completa della lista protetta da conferma numerica.
- [ ] Solo hostname di produzione/staging esplicitamente previsti raggiungibili.
- [ ] Protezioni anti-abuso e limiti di spesa verificati nei dashboard reali.
- [ ] Test end-to-end con account autorizzato, non autorizzato e revocato.
- [ ] Revisione indipendente con esito go/no-go registrato.
- [ ] Cutover del dominio e verifica anonima post-cutover.

## Piano e stato

Legenda: `DONE` implementato e verificato localmente; `IN PROGRESS` in lavorazione;
`EXTERNAL` richiede account/dashboard; `BLOCKED` non eseguibile senza prerequisito;
`TODO` non iniziato.

| Fase | Stato | Attività | Evidenza/uscita |
|---|---|---|---|
| 0 | DONE | Isolare il lavoro dal branch `deploy` | worktree e branch `feature/consumer-auth` |
| 1 | DONE | ADR e threat model | ADR-0004 e security review |
| 2 | DONE | Worker authn/authz fail-closed | `src/auth.ts`, `src/authorization.ts`, `src/worker.ts` |
| 3 | DONE | D1 allowlist a digest HMAC | migration e script di sincronizzazione |
| 4 | DONE | Login Clerk locale e redirect sicuri | pagine auth e bundle ClerkJS locale |
| 5 | DONE | Mediazione completa Static Assets | `run_worker_first=true`, test 401/403/range/cache |
| 6 | DONE | Hardening host, claim e gestione lista | test e guardie di deploy |
| 7 | DONE | Guardrail anti-abuso e anti-costo documentati | checklist dashboard e runbook incidenti |
| 8 | IN PROGRESS | Creare Clerk production/staging e D1/R2 reali | Risorse create e membro sincronizzato; verificare CNAME Account Portal |
| 9 | IN PROGRESS | Deploy su hostname staging separato | Worker distribuito; collaudo account interattivo ancora necessario |
| 10 | BLOCKED | Pen test autorizzato e remediation | report indipendente; dipende da fase 9 |
| 11 | BLOCKED | Cutover produzione | approvazione esplicita; dipende da fase 10 |
| 12 | BLOCKED | Rimozione Access per i coristi | solo dopo verifica cutover e rollback |

## Guardrail economici richiesti

- Mantenere Clerk sul piano Hobby e Workers/D1 sul piano Free durante la beta.
- Non aggiungere un metodo di pagamento a Clerk se non per scelta deliberata.
- Non attivare Workers Paid, R2, Images, Stream, Argo o add-on implicitamente.
- Configurare notifiche quota e sicurezza verso almeno due indirizzi.
- Se in futuro si passa al pay-as-you-go, creare budget alert multipli e
  considerare gli alert informativi, non un hard spending cap.
- Registrare ogni cambio piano in questo tracker con data, autore e motivazione.

## Registro di implementazione

### 2026-10-16 — provisioning dello staging `epistrophe.it`

- Registrato `epistrophe.it` presso OVHcloud e creata la zona Cloudflare Free.
- Impostati presso il registrar `augustus.ns.cloudflare.com` e
  `violet.ns.cloudflare.com`; dopo il checkpoint iniziale `pending`, la zona è
  diventata `active` e la delega è stata verificata via Cloudflare e Google
  DNS-over-HTTPS.
- Creato D1 `choir-assistant-auth-staging`, applicate tutte le migrazioni fino
  a `0005_personal_recordings.sql` e collegato il binding `AUTH_DB`.
- Attivato R2 e creato il bucket privato
  `choir-assistant-performances-staging`, senza accesso pubblico né custom
  domain.
- Creata l'app Clerk Epistrophe, configurati email code only, blocco modifica
  email, claim `primaryEmail` e protezioni anti-abuso.
- Creata un'istanza Clerk Production secondaria per
  `staging.epistrophe.it` e inseriti in Cloudflare i cinque CNAME Clerk in
  modalità DNS only.
- Valorizzati Frontend API origin e publishable key nel Worker; la chiave RSA
  del JWKS pubblico Clerk è stata installata come secret `CLERK_JWT_KEY`.
  Il collaudo interattivo ha poi dimostrato che `@clerk/backend@3.23.2` richiede
  anche `CLERK_SECRET_KEY` all'ingresso di `authenticateRequest()`: il secret
  Production è stato aggiunto come binding Cloudflare senza inserirlo nei file.
- Generata una chiave HMAC casuale a 256 bit e installata come secret
  `AUTH_EMAIL_HMAC_KEY`; la copia operatore è stata salvata nel password manager
  protetto e rimossa dagli appunti dopo la conferma.
- Il dry-run del primo membro ha validato CSV, ruolo e gruppo. Il primo invio
  reale è stato annullato da D1 prima della scrittura perché gli script
  includevano `BEGIN`/`COMMIT` espliciti; rimossi i delimitatori, mantenuto il
  batch atomico gestito da D1 e aggiunti test di regressione.
- Ripetuto l'invio reale: D1 ha elaborato 8 query nel batch e la verifica
  aggregata ha trovato un membro attivo, ruolo `singer`, gruppo `tenori` e un
  evento `member_sync`, senza leggere o stampare email e digest.
- Distribuito `choir-assistant-auth-staging` esclusivamente sul custom domain
  `staging.epistrophe.it`, versione
  `37e5ecc7-bb7d-4bcc-b6d9-f3498b7a9145`. Il controllo anonimo ha restituito
  `302` per la pagina HTML, `200` per `/auth/config` e `401` per gli asset
  protetti. Il CNAME `accounts.staging`, inizialmente assente dal DNS pubblico,
  è stato confermato nel pannello e ha iniziato a propagarsi; il Frontend API è
  già coerente sui resolver controllati.
- Corretto il loop di redirect del primo accesso: il Worker riscriveva il
  percorso canonico `/sign-in` in `/sign-in.html`, che Static Assets riportava
  a `/sign-in` con `307`. La versione
  `1a494914-6f23-439d-8b55-7a927e07e494` serve ora `/sign-in` con `200`.
- Corretto anche il caricamento dell'interfaccia Clerk: con ClerkJS 6.39 il
  pacchetto `@clerk/ui` va fornito separatamente a `clerk.load()`. La versione
  definitiva include `@clerk/ui@1.40.0` nel bundle locale, evitando che il
  bootstrap grafico dipenda da un secondo script remoto. Chrome headless ha
  confermato campo email e pulsante di continuazione nella versione
  `6b5877c1-193d-482b-9f05-ecdeaffe8c7b`.
- Diagnosticato il successivo errore generico di accesso: Cloudflare e Google
  DNS risolvono correttamente il Frontend API Clerk, mentre il DNS del router
  della workstation (`192.168.1.1`) conserva ancora `NXDOMAIN`. Forzando nel
  solo test la risoluzione pubblica, lo stesso deploy monta correttamente il
  form; non è quindi una regressione del Worker.
- Terminata la propagazione anche sul resolver ordinario: un nuovo profilo
  Chrome, senza override né DNS sicuro configurato manualmente, monta il form
  Clerk. Il corista deve soltanto aprire `https://staging.epistrophe.it` e usare
  email e codice; le procedure DNS restano esclusivamente diagnostica tecnica.
- Localizzata in italiano l'interfaccia Clerk e aggiunta una pagina locale
  `/sign-up` per il primo accesso. I collegamenti `Registrati` e `Accedi`
  restano ora su `staging.epistrophe.it`, senza dipendere dall'Account Portal;
  versione `a4cea358-abfb-4b34-87fd-a9bcfda1bace`.
- Diagnosticato il rientro immediato al login dopo una registrazione riuscita:
  il Worker scartava il redirect e gli header dello stato Clerk `handshake`.
  Il middleware ora inoltra la risposta `307` prima dell'autorizzazione D1 e
  dispone di un test di regressione dedicato; correzione distribuita nella
  versione `7697df4b-df67-49b7-a907-2be74bc2e9de`.
- Il supporto all'handshake era necessario ma non sufficiente. La telemetria
  sicura ha isolato l'errore `Missing Clerk Secret Key`, prima mascherato dal
  redirect anonimo. Dopo aver passato `CLERK_SECRET_KEY` a
  `createClerkClient()`, la versione
  `69c6af57-5972-44d4-aa6f-c257c37e776f` ha superato il collaudo reale con
  account autorizzato fino all'apertura dell'app.
- Importata in modalità incrementale una seconda lista privata: 26 voci sono
  state deduplicate in 25 indirizzi validi e aggiunte senza `--replace`. La
  verifica aggregata finale ha trovato 26 membri attivi, 26 digest distinti e
  nessun record incompleto; sorgente temporanea e appunti sono stati eliminati.
- La procedura e la diagnostica sono documentate in
  [epistrophe-staging-deployment-lesson.md](epistrophe-staging-deployment-lesson.md).

### 2026-10-13 — mantenimento temporaneo di Cloudflare Access

- Poiché il coro resta sotto 50 utenti attivi, il cutover Clerk/D1 è rinviato.
- Il codice consumer-auth rimane disponibile sul branch, senza risorse cloud
  create e senza modificare la produzione.
- Aggiunta una configurazione distinta `wrangler.access.jsonc` per continuare
  a distribuire in sicurezza il sito statico sul Worker storico protetto da
  Cloudflare Access.
- Distribuita la build `20261013-123910-46a41678c1a9` come versione Cloudflare
  `e8ef1ab0-b213-4031-abd8-ee46abd62d44`. Root, `library.json` e bundle diretto
  restituiscono `302` anonimo; il test autenticato resta manuale.

### 2026-10-11 — baseline consumer-auth

- Implementati Clerk session verification, D1 allowlist, HMAC email digest,
  login, CSP, protezione asset, sync lista, build guard e test automatici.
- Creati runbook di deployment e security review.
- Nessuna risorsa cloud creata e nessuna produzione modificata.

### 2026-10-13 — hardening pre-staging

- Creato questo tracker prima delle ulteriori modifiche.
- Il Worker richiede l'origine canonica prima di servire anche le route
  pubbliche; hostname alternativi ricevono `421`.
- Disabilitati `workers.dev` e preview; il pre-deploy richiede un unico custom
  domain uguale a `APP_ORIGIN`.
- Normalizzato e validato il claim email firmato; le sessioni Clerk con claim
  di impersonazione `act` sono rifiutate.
- `--replace` richiede il conteggio esatto validato tramite
  `--confirm-replace-count`; il dry-run resta non distruttivo.
- Creata la checklist esterna per tenant, anti-abuso, privacy, incidenti e
  controllo costi. Le relative caselle restano aperte fino allo staging reale.

## Evidenze di verifica

Le esecuzioni devono indicare data, commit e risultato; non usare soltanto la
presenza di un test come prova che il deployment reale sia sicuro.

| Data | Commit/worktree | Verifica | Risultato |
|---|---|---|---|
| 2026-10-11 | `d9160ea` | typecheck + Vitest | 18 test passati |
| 2026-10-11 | `d9160ea` | dependency audit | 0 vulnerabilità note moderate+ |
| 2026-10-11 | `d9160ea` | Wrangler dry-run | bundle Worker valido |
| 2026-10-11 | `d9160ea` | predeploy con placeholder | deploy correttamente bloccato |
| 2026-10-13 | `f37f1a3` | typecheck + Vitest | 22 test passati |
| 2026-10-13 | `f37f1a3` | test script operativi | 10 test passati |
| 2026-10-13 | `f37f1a3` | `npm audit --audit-level=moderate` | 0 vulnerabilità note |
| 2026-10-13 | `f37f1a3` | Wrangler dry-run | Worker compilato; nessun deploy |
| 2026-10-13 | `f37f1a3` | predeploy con placeholder | deploy correttamente bloccato |
| 2026-10-13 | `f37f1a3` | build completa sito | bloccata: manca il bundle generato di `qui-credit-in-me-non-sitiet` |
| 2026-10-16 | worktree `-dirty` | typecheck + Vitest | 36 test passati |
| 2026-10-16 | worktree `-dirty` | test script operativi | 15 test passati |
| 2026-10-16 | worktree `-dirty` | `npm audit --audit-level=moderate` | 0 vulnerabilità note |
| 2026-10-16 | worktree `-dirty` | build completa sito | `1258` file, `19` brani; build `20261015-232652-5575d40869c3-dirty` |
| 2026-10-16 | worktree `-dirty` | test sync D1 dopo correzione batch | 9 test passati; nessun controllo transazione esplicito |
| 2026-10-16 | worktree `-dirty` | sincronizzazione membro D1 | 8 query riuscite; membro, ruolo, gruppo e audit verificati |
| 2026-10-16 | worktree `-dirty` | deploy staging + smoke test anonimo | versione `37e5ecc7-bb7d-4bcc-b6d9-f3498b7a9145`; redirect/config/protezioni corretti |
| 2026-10-16 | worktree `-dirty` | regressione redirect login + redeploy | 36 test passati; root `302`, `/sign-in` `200`, asset anonimo `401`; versione `1a494914-6f23-439d-8b55-7a927e07e494` |
| 2026-10-16 | worktree `-dirty` | caricamento UI Clerk + browser headless | 36 test passati; form email montato; versione `3089302a-17a2-41cf-b56b-9982951e5c65` |
| 2026-10-16 | worktree `-dirty` | bundle UI Clerk locale + diagnosi DNS | 36 test passati, audit 0 vulnerabilità, form verificato; versione `6b5877c1-193d-482b-9f05-ecdeaffe8c7b`; resolver router ancora in cache negativa |
| 2026-10-16 | worktree `-dirty` | verifica login dopo propagazione | form Clerk montato in Chrome pulito senza override DNS; flusso utente ridotto a URL, email e codice |
| 2026-10-16 | worktree `-dirty` | onboarding locale in italiano | 38 test TypeScript e 11 test build passati; `/sign-in` e `/sign-up` verificati; versione `a4cea358-abfb-4b34-87fd-a9bcfda1bace` |
| 2026-10-16 | worktree `-dirty` | handshake Clerk server-side | 39 test TypeScript, 11 test build e audit pulito; inoltro `307` e cookie coperto da regressione; versione `7697df4b-df67-49b7-a907-2be74bc2e9de` |
| 2026-10-16 | worktree `-dirty` | correzione Secret Key + collaudo autorizzato | 39 test TypeScript passati; eccezione backend eliminata; accesso reale completato; versione `69c6af57-5972-44d4-aa6f-c257c37e776f` |
| 2026-10-16 | dati operatore privati | import incrementale allowlist | 25 indirizzi unici aggiunti; 26 membri attivi totali; 0 revoche e 0 record incompleti |

Il blocco dell'ultima riga precede il cutover e non riguarda il middleware di
autenticazione: `deploy/repertoire.json` pubblica il brano, ma in questo
worktree manca `frontend/library-assets/qui-credit-in-me-non-sitiet/metadata.json`.
Rigenerare il bundle del brano e ripetere la build prima dello staging.

## Azioni manuali del maintainer

Queste attività non devono essere simulate o marcate complete dal codice:

1. creare e proteggere gli account Clerk e Cloudflare con passkey/MFA;
2. creare istanze Clerk separate per staging e produzione;
3. configurare email verification, protezioni anti-bot ed enumeration;
4. creare D1 separati e secret HMAC differenti;
5. custodire la lista email fuori dal repository e nel backup cifrato;
6. verificare piani, metodi di pagamento, quote e destinatari degli alert;
7. autorizzare per iscritto scope e limiti del penetration test;
8. approvare esplicitamente il cutover e verificare il rollback.

## Regola di completamento

Il progetto non è `DONE` quando il codice compila. È completato soltanto quando:

1. tutti i criteri di accettazione sono spuntati con evidenza;
2. la revisione indipendente non contiene finding critici/alti irrisolti;
3. il dominio di produzione è stato verificato anonimamente e con tre classi di
   account (autorizzato, non autorizzato, revocato);
4. il rollback è stato provato;
5. il maintainer ha approvato il cutover nel registro.
