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
| 8 | EXTERNAL | Creare Clerk production/staging e D1 reali | ID, origini e secret nei dashboard |
| 9 | EXTERNAL | Deploy su hostname staging separato | URL staging protetto |
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

### 2026-10-13 — mantenimento temporaneo di Cloudflare Access

- Poiché il coro resta sotto 50 utenti attivi, il cutover Clerk/D1 è rinviato.
- Il codice consumer-auth rimane disponibile sul branch, senza risorse cloud
  create e senza modificare la produzione.
- Aggiunta una configurazione distinta `wrangler.access.jsonc` per continuare
  a distribuire in sicurezza il sito statico sul Worker storico protetto da
  Cloudflare Access.

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
