# Dalla registrazione del dominio allo staging di Epistrophe

**Status:** lezione operativa e registro di avanzamento
**Owner:** project maintainer
**Last reviewed:** 2026-10-16
**Ambiente descritto:** staging, non produzione pubblica

Questa guida ricostruisce i passaggi eseguiti per preparare
`staging.epistrophe.it` con Cloudflare Workers, D1, R2 e Clerk. È pensata sia
come materiale per una lezione sia come procedura ripetibile. Il runbook
normativo rimane
[Consumer authentication deployment](consumer-auth-deployment.md): in caso di
contrasto prevale il runbook.

## 1. Obiettivi della lezione

Al termine si deve saper spiegare:

- la differenza tra registrar, registro, DNS autorevole e hosting;
- perché lo staging usa un sottodominio e risorse separate;
- come Cloudflare, Clerk, D1 e R2 collaborano senza avere lo stesso ruolo;
- perché autenticazione e autorizzazione sono due controlli distinti;
- quali dati sono pubblici, quali sono segreti e quali non devono entrare in Git;
- come leggere correttamente gli stati `Pending`, `Unverified` e
  `Awaiting deployment`.

## 2. Architettura risultante

```text
Registro .it
  -> delega epistrophe.it ai nameserver Cloudflare

Cloudflare DNS
  -> staging.epistrophe.it              -> Worker Epistrophe
  -> clerk.staging.epistrophe.it        -> Clerk Frontend API
  -> accounts.staging.epistrophe.it     -> Clerk Account Portal
  -> record email/DKIM                  -> infrastruttura email Clerk

Browser
  -> Clerk: dimostra il controllo dell'indirizzo email
  -> Worker: verifica sessione, origine e claim firmati
  -> D1: decide se il membro è attivo e quali ruoli/gruppi possiede
  -> asset statici: spartiti, JSON e audio protetti
  -> R2 privato: registrazioni personali e immagini di performance
```

La frase chiave della lezione è:

```text
Clerk autentica la persona.
D1 autorizza il membro.
Il Worker applica entrambe le decisioni prima di servire i dati.
```

Un account Clerk valido non concede automaticamente accesso al repertorio.

## 3. Vocabolario essenziale

| Termine | Significato nel progetto |
|---|---|
| Registrar | OVHcloud, presso cui è stato acquistato `epistrophe.it`. |
| Registro | Registro `.it`, che pubblica la delega del dominio nella zona `it`. |
| DNS autorevole | Cloudflare, dopo l'attivazione della zona. |
| Nameserver | Server che rispondono ufficialmente per i record del dominio. |
| Record CNAME | Alias DNS usato per collegare i sottodomini ai servizi Clerk. |
| Proxy Cloudflare | Passaggio del traffico HTTP attraverso Cloudflare; non va abilitato sui CNAME richiesti da Clerk. |
| Staging | Ambiente realistico ma isolato nel quale verificare il rilascio prima della produzione. |
| D1 | Database SQL che conserva membri, ruoli, gruppi e metadati. |
| R2 | Object storage privato per file non adatti a D1. |

## 4. Registrazione del dominio

È stato scelto e registrato `epistrophe.it` presso OVHcloud. Cloudflare Registrar
non offriva la registrazione diretta del TLD `.it`; questo non impedisce di
usare Cloudflare come provider DNS e piattaforma di esecuzione.

Le responsabilità restano separate:

```text
OVHcloud conserva la registrazione e i dati del dominio.
Cloudflare gestisce i record DNS e ospita il Worker.
```

Non è necessario acquistare hosting tradizionale da OVH per eseguire il Worker.

## 5. Creazione della zona Cloudflare

Nel pannello Cloudflare è stato aggiunto `epistrophe.it` come zona con setup
DNS completo ed è stato scelto il piano **Free**. La scansione iniziale non ha
trovato record, situazione normale per un dominio nuovo.

I nameserver assegnati da Cloudflare sono:

```text
augustus.ns.cloudflare.com
violet.ns.cloudflare.com
```

Nel pannello OVH sono stati sostituiti i nameserver predefiniti OVH con questi
due valori. Devono essere gli unici nameserver registrati. DNSSEC deve rimanere
disattivato durante il cambio; potrà essere attivato in Cloudflare e poi presso
il registrar soltanto dopo che la delega sarà stabile.

Per nameserver esterni come `*.ns.cloudflare.com` non si configura un glue
record del dominio. Se il registrar mostra un campo opzionale **IP associato**,
non va inventato un indirizzo: un IP trasmesso al Registro `.it` deve
corrispondere agli indirizzi reali del nameserver.

## 6. Preparazione della configurazione Worker

La configurazione di staging in `wrangler.jsonc` è stata separata dalla
produzione storica:

```jsonc
{
  "name": "choir-assistant-auth-staging",
  "workers_dev": false,
  "preview_urls": false,
  "routes": [
    { "pattern": "staging.epistrophe.it", "custom_domain": true }
  ],
  "vars": {
    "APP_ORIGIN": "https://staging.epistrophe.it",
    "CLERK_FRONTEND_API_ORIGIN": "https://clerk.staging.epistrophe.it",
    "CLERK_PUBLISHABLE_KEY": "pk_live_Y2xlcmsuc3RhZ2luZy5lcGlzdHJvcGhlLml0JA=="
  }
}
```

Le due variabili Clerk sono pubbliche e sono state valorizzate dopo
l'attivazione del dominio Clerk. La publishable key incorpora l'hostname del
Frontend API e può essere consegnata al browser; non è la Secret Key Clerk.
`workers_dev=false` e `preview_urls=false` impediscono che hostname alternativi
aggirino il controllo sull'origine canonica.

## 7. Database D1 di staging

È stato creato il database:

```text
choir-assistant-auth-staging
database_id: e3a39346-1c15-4cf1-8223-449a6ef98fad
binding Worker: AUTH_DB
```

Comandi usati:

```powershell
npx wrangler d1 create choir-assistant-auth-staging
npx wrangler d1 migrations apply choir-assistant-auth-staging --remote
```

Sono state applicate tutte le migrazioni da `0001` a `0005`, incluse quelle
per RBAC, audit, pulizia oggetti e registrazioni personali. Il controllo del
2026-10-16 restituisce `No migrations to apply`.

D1 non contiene registrazioni audio. Contiene dati strutturati e riferimenti
agli oggetti conservati in R2.

## 8. Bucket R2 privato

R2 è stato attivato nell'account Cloudflare e poi è stato creato:

```text
bucket: choir-assistant-performances-staging
binding Worker: PERFORMANCE_BUCKET
location: EEUR
storage class: Standard
```

Comando usato:

```powershell
npx wrangler r2 bucket create choir-assistant-performances-staging
```

Il bucket è privato: non è stato attivato l'accesso pubblico e non gli è stato
associato un dominio R2. Il Worker applicherà regole differenti ai prefissi
`performances/` e `recordings/`.

## 9. Applicazione Clerk Development

È stata creata l'applicazione Clerk **Epistrophe** sul piano Hobby. La schermata
di installazione Next.js non è stata usata, perché il progetto contiene già
un'integrazione ClerkJS personalizzata.

### 9.1 Metodo di autenticazione

In **Configure > User & authentication > Email**:

- `Sign-up with email`: attivo;
- `Require email address`: attivo;
- `Verify at sign-up`: attivo;
- `Email verification code`: attivo;
- `Email verification link`: disattivato;
- `Sign-in with email`: attivo;
- accesso con codice email: attivo;
- telefono, username, social login e password: disattivati;
- modifica dell'indirizzo email da parte dell'utente: disattivata.

Queste restrizioni sono importanti perché il Worker tratta l'email verificata
come collegamento iniziale con il membro D1.

### 9.2 Claim nel token di sessione

In **Configure > Sessions > Customize session token**, sul token standard
`__session`, è stato configurato:

```json
{
  "primaryEmail": "{{user.primary_email_address}}"
}
```

Non è stato creato un JWT template separato. Il Worker legge questo claim dal
token firmato e rifiuta claim mancanti, malformati o sessioni di impersonazione.

### 9.3 Protezioni anti-abuso

In **Configure > Protect > Protections**:

| Controllo | Stato |
|---|---|
| Lockout policy | Enabled |
| User enumeration protection | Enabled |
| Require Device Intelligence checks | Enabled |
| Challenge suspicious sign-ups | Enabled |
| Block disposable email addresses | Enabled |
| Block email subaddresses | Disabled intenzionalmente |
| Device Trust | non configurato, perché riguarda il login con password |

I subaddress come `nome+etichetta@example.org` non sono bloccati per evitare
falsi positivi; l'autorizzazione D1 richiede comunque la precisa identità
prevista dall'operatore.

## 10. Istanza Clerk Production dedicata allo staging

Dal pulsante **Go to prod** è stata creata l'istanza Production clonando le
impostazioni Development.

Configurazione scelta:

```text
Application domain: staging.epistrophe.it
Application type: Secondary application
```

La modalità Secondary mantiene l'infrastruttura dello staging sotto il proprio
sottodominio:

```text
app:            staging.epistrophe.it
Frontend API:   clerk.staging.epistrophe.it
Account Portal: accounts.staging.epistrophe.it
email:          sottodomini tecnici sotto staging.epistrophe.it
```

La futura applicazione pubblica su `epistrophe.it` avrà configurazione e chiavi
Clerk proprie; le credenziali di staging non verranno riutilizzate.

Il Worker usa tre valori Clerk con responsabilità diverse:

- `CLERK_PUBLISHABLE_KEY` identifica pubblicamente l'istanza ed è consegnata al
  browser;
- `CLERK_JWT_KEY` è la chiave pubblica RSA usata per verificare localmente la
  firma dei token;
- `CLERK_SECRET_KEY` è il segreto backend richiesto dalla versione corrente di
  `@clerk/backend` per inizializzare `authenticateRequest()` e gestire i flussi
  di refresh/handshake.

La Secret Key non sostituisce la verifica JWT e non deve mai essere inserita in
`wrangler.jsonc`, nel repository, nei log o nel frontend. È installata soltanto
come Worker secret.

## 11. Record DNS richiesti da Clerk

Sono stati inseriti nella zona Cloudflare cinque record CNAME, tutti con
**TTL Auto** e **DNS only**:

| Nome Cloudflare | Destinazione |
|---|---|
| `clerk.staging` | `frontend-api.clerk.services` |
| `accounts.staging` | `accounts.clerk.services` |
| `clkmail.staging` | `mail.jbmmuz7h125a.clerk.services` |
| `clk._domainkey.staging` | `dkim1.jbmmuz7h125a.clerk.services` |
| `clk2._domainkey.staging` | `dkim2.jbmmuz7h125a.clerk.services` |

Cloudflare mostra un avviso generico che invita ad attivare il proxy. Per
questi record va ignorato: Clerk deve poter verificare direttamente i CNAME e
richiede la modalità DNS only durante la configurazione.

Non sono ancora stati creati record per `www` o per l'apice `epistrophe.it`.
Il record applicativo `staging.epistrophe.it` sarà gestito dal custom domain del
Worker durante il deploy.

## 12. Come interpretare lo stato di attesa

Al checkpoint del 2026-10-16 coesistono tre messaggi differenti.

### 12.1 Cloudflare: da `Pending Nameserver Update` ad `Active`

Durante il primo checkpoint l'API Cloudflare riportava:

```text
zone: epistrophe.it
type: full
plan: Free Website
status: pending
created_on: 2026-10-15T22:22:16Z
assigned nameservers:
  augustus.ns.cloudflare.com
  violet.ns.cloudflare.com
```

Il nameserver autorevole del TLD `.it`, oltre ai resolver `1.1.1.1` e
`8.8.8.8`, restituiva inizialmente `NXDOMAIN`: la delega non era ancora
pubblicata. Cloudflare indica che un dominio appena registrato può richiedere
fino a 24 ore prima che la delega compaia.

Il 2026-10-16 Cloudflare ha inviato l'email di attivazione. La successiva
verifica API ha restituito:

```text
status: active
activated_on: 2026-10-15T23:07:42Z
```

Query DNS-over-HTTPS indipendenti verso Cloudflare e Google hanno confermato
entrambi i nameserver assegnati. La delega è quindi completata.

### 12.2 Clerk Domains: `Unverified`

Durante la fase `pending` i CNAME erano salvati nel pannello Cloudflare ma non
erano ancora raggiungibili dal DNS pubblico. Dopo l'attivazione, query fresche
verso Cloudflare e Google hanno confermato tutti e cinque i CNAME Clerk.

Clerk può continuare a mostrarli temporaneamente come `Unverified` mentre
esegue il proprio controllo e richiede i certificati TLS. Non vanno ricreati e
non va attivato il proxy arancione.

Alle 23:13 UTC del 2026-10-15 il Frontend API
`https://clerk.staging.epistrophe.it` rispondeva già `200 OK` con TLS valido.
Nello stesso checkpoint il certificato del portale
`accounts.staging.epistrophe.it` risultava ancora in provisioning. Questo stato
intermedio è normale: i due certificati possono diventare disponibili in
momenti diversi.

### 12.3 Clerk Overview: `Watching for users` / `Awaiting deployment`

Questo stato non dimostra un errore DNS. Significa che l'applicazione non è
ancora stata distribuita con le chiavi Production e non ha ancora generato
traffico utente. Scomparirà soltanto dopo deploy, verifica del dominio e primo
utilizzo valido.

## 13. Diagnostica ripetibile

### 13.1 Verificare la delega pubblica

Su Windows:

```powershell
Resolve-DnsName epistrophe.it -Type NS -Server 1.1.1.1
Resolve-DnsName epistrophe.it -Type NS -Server 8.8.8.8
nslookup -type=ns epistrophe.it dns.nic.it
```

Il risultato atteso, dopo l'attivazione, contiene esclusivamente:

```text
augustus.ns.cloudflare.com
violet.ns.cloudflare.com
```

### 13.2 Verificare i record Clerk

```powershell
Resolve-DnsName clerk.staging.epistrophe.it -Type CNAME -Server 1.1.1.1
Resolve-DnsName accounts.staging.epistrophe.it -Type CNAME -Server 1.1.1.1
Resolve-DnsName clkmail.staging.epistrophe.it -Type CNAME -Server 1.1.1.1
```

### 13.3 Se la delega manca ancora dopo 24 ore

1. Aprire Cloudflare **Overview** e ricopiare i due nameserver assegnati.
2. In OVH verificare che siano presenti soltanto quei due valori.
3. Verificare che DNSSEC sia disattivato e non esista un vecchio record DS.
4. Controllare in OVH **Operazioni in corso** ed eventuali email di errore.
5. Verificare che non sia stato associato manualmente un IP errato ai
   nameserver esterni.
6. Eseguire il
   [DNS Validator del Registro `.it`](https://www.nic.it/it/gestisci-il-tuo-it/dns-check)
   specificando entrambi i nameserver Cloudflare.
7. Richiedere un nuovo controllo dalla pagina Overview di Cloudflare soltanto
   dopo che il parent `.it` pubblica la delega.

Il Registro `.it` mantiene il dominio in `inactive/dnsHold` quando i server
indicati non superano i controlli di autorità, SOA, NS e codice di risposta; i
controlli vengono ripetuti periodicamente. La procedura è descritta nelle
[Linee guida tecniche del Registro `.it`](https://www.nic.it/sites/default/files/documenti/2024/Synchronous_Technical_Guidelines_v3.2_0.pdf).

Per il significato dello stato Cloudflare e la sequenza di verifica usare la
[guida ufficiale Pending Nameserver Update](https://developers.cloudflare.com/dns/zone-setups/troubleshooting/pending-nameservers/).

### 13.4 D1 rifiuta `BEGIN TRANSACTION` durante la sincronizzazione

Il primo invio reale del CSV ha superato la validazione locale, ma Wrangler ha
interrotto l'operazione prima di scrivere i dati perché D1 non accetta
`BEGIN`, `COMMIT` o `SAVEPOINT` espliciti. Non si tratta di una perdita di
atomicità: Wrangler trasforma le istruzioni contenute nello stesso file SQL in
un batch e D1 gestisce implicitamente la transazione del batch. Se una delle
istruzioni fallisce, la sequenza viene abortita e ripristinata.

La correzione applicata agli script è quindi:

1. mantenere tutte le istruzioni della sincronizzazione nello stesso file;
2. rimuovere soltanto i controlli di transazione espliciti;
3. aggiungere test che vietano `BEGIN`, `COMMIT` e `SAVEPOINT` nel SQL generato;
4. ripetere prima il dry-run e poi l'invio reale.

Riferimenti: [D1 `batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) e
[importazione di file SQL](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

### 13.5 Loop `ERR_TOO_MANY_REDIRECTS` sulla pagina di accesso

Il primo deploy trasformava internamente `/sign-in` in `/sign-in.html`.
Cloudflare Static Assets usa per impostazione predefinita gli URL HTML canonici
senza estensione e risponde a `/sign-in.html` con un `307` verso `/sign-in`.
Le due riscritture opposte generavano quindi un ciclo infinito.

La correzione mantiene `/sign-in` e `/not-authorized` come percorsi canonici e
lascia che il binding Static Assets risolva i corrispondenti file HTML. Dopo il
deploy della versione `1a494914-6f23-439d-8b55-7a927e07e494`, il percorso
anonimo verificato è diventato:

```text
/  --302-->  /sign-in?return_url=%2F  --200-->  pagina Clerk
```

Riferimento: [Cloudflare Static Assets — HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/).

### 13.6 Pagina visibile ma modulo Clerk non disponibile

Dopo la correzione del redirect, la pagina di accesso veniva caricata ma
mostrava il messaggio generico «Accesso temporaneamente non disponibile». Il
collaudo con un browser headless ha rivelato l'errore reale:

```text
Clerk was not loaded with UI components
```

Nella versione Clerk utilizzata, il pacchetto `@clerk/clerk-js` contiene il
motore di autenticazione ma i componenti grafici arrivano dal pacchetto
separato `@clerk/ui`. Un primo rimedio caricava il bundle UI dal Frontend API
Clerk; dipendeva però dalla risoluzione DNS di quel sottodominio già nella fase
di bootstrap. La soluzione più robusta adottata è invece:

1. installare e fissare `@clerk/ui@1.40.0` tra le dipendenze;
2. importare `ClerkUI` da `@clerk/ui/entry` nel client TypeScript;
3. includerlo nel bundle locale con esbuild;
4. passare `{ ui: { ClerkUI } }` a `clerk.load()`;
5. montare infine il componente `SignIn`.

La versione Worker `6b5877c1-193d-482b-9f05-ecdeaffe8c7b` contiene il bundle
UI locale ed è stata verificata con Chrome headless: il DOM risultante contiene
il campo email e il pulsante di continuazione. L'inizializzazione di Clerk deve
comunque raggiungere il Frontend API per leggere l'ambiente e completare il
login.

Riferimento: [Clerk JavaScript Quickstart](https://clerk.com/docs/js-frontend/getting-started/quickstart).

### 13.7 Il DNS pubblico è corretto ma il browser mostra ancora l'errore generico

Il 2026-10-16 Cloudflare DNS-over-HTTPS e Google DNS restituivano correttamente
la catena completa:

```text
clerk.staging.epistrophe.it
  CNAME frontend-api.clerk.services
  CNAME worker.clerkprod-cloudflare.net
  A     172.64.153.110 / 104.18.34.146
```

Il resolver configurato sulla workstation (`192.168.1.1`, cioè il router),
invece, continuava a rispondere `NXDOMAIN`. Anche dopo `ipconfig /flushdns`,
`curl` non riusciva a risolvere l'host. Questo caso dimostra che svuotare la
cache locale non basta quando la risposta obsoleta viene conservata dal DNS a
monte.

La diagnosi è stata confermata senza cambiare il codice: lo stesso browser
headless falliva con il resolver ordinario e montava correttamente il form
Clerk quando il solo hostname veniva indirizzato all'IP pubblico già restituito
dai resolver indipendenti. Il rimedio operativo è usare temporaneamente DNS
sicuro in Chrome oppure impostare sull'interfaccia di rete un resolver pubblico
affidabile, per esempio Cloudflare `1.1.1.1`/`1.0.0.1`; non vanno modificati i
record CNAME già corretti.

Pochi minuti dopo, anche il resolver ordinario ha iniziato a restituire la
catena completa. Un nuovo profilo Chrome, senza override e senza impostazioni
DNS speciali, ha montato correttamente il campo email e il pulsante di accesso.
Il cambio di resolver era quindi una tecnica diagnostica temporanea, non una
procedura da comunicare ai coristi. L'esperienza utente prevista resta:

1. aprire `https://staging.epistrophe.it`;
2. al primo utilizzo scegliere `Registrati` e inserire l'indirizzo email
   autorizzato;
3. inserire il codice ricevuto via email;
4. dagli accessi successivi usare direttamente `Accedi`.

Per non dipendere dal sottodominio Account Portal durante il primo accesso,
registrazione e login sono entrambi ospitati dall'applicazione:
`/sign-up` e `/sign-in`. Il client Clerk è localizzato in italiano e conserva
la destinazione richiesta dopo l'autenticazione.

Se un browser già aperto conserva ancora il vecchio errore, è sufficiente
chiuderlo completamente e riaprirlo. I nuovi utenti non devono configurare DNS,
Cloudflare o Clerk.

Un proxy del Clerk Frontend API sullo stesso dominio eliminerebbe questa
dipendenza, ma è un'opzione avanzata: richiede un percorso proxy, il secret
backend Clerk nel Worker e l'abilitazione esplicita nel pannello Clerk. Non è
necessario per un normale CNAME correttamente propagato e non è stato attivato.

Riferimento: [Clerk — Proxying the Frontend API](https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi).

### 13.8 Login riuscito ma `Continua` torna alla pagina di accesso

Dopo la prima registrazione ClerkJS vedeva correttamente l'utente, mentre la
navigazione alla pagina protetta sembrava non fare nulla. Il pulsante
funzionava: la sequenza osservata era `/` con risposta `302`, seguita nuovamente
da `/sign-in?return_url=%2F`.

Una prima analisi ha individuato una lacuna reale nel Worker: uno stato Clerk
`handshake` non può essere trattato come una normale sessione anonima. Prima di
considerare la richiesta autenticata, il browser può dover visitare il Frontend
API e sincronizzare il cookie di sessione breve sull'applicazione.

`authenticateRequest()` restituisce per questo caso un `Location` e gli header
da inoltrare con una risposta `307`. La prima implementazione riduceva invece
ogni stato non autenticato a un redirect verso `/sign-in`, perdendo handshake e
cookie. Il Worker ora inoltra integralmente la risposta di handshake prima di
eseguire il controllo della allowlist. Questo consente a Clerk di impostare
`__session`, tornare all'URL originale e completare l'autorizzazione D1.
Il supporto all'handshake è stato distribuito nella versione
`7697df4b-df67-49b7-a907-2be74bc2e9de`, ma il collaudo interattivo ha dimostrato
che non era ancora la causa del redirect osservato. Questa è una lezione
importante: una correzione architetturalmente necessaria non va dichiarata
risolutiva finché non supera il percorso utente reale.

Riferimenti: [Clerk `authenticateRequest()`](https://clerk.com/docs/reference/backend/authenticate-request) e
[Clerk — funzionamento dell'handshake](https://clerk.com/docs/guides/how-clerk-works/overview#the-handshake).

### 13.9 `authenticateRequest()` fallisce prima di verificare la sessione

Per separare pulsante, cookie, JWT, claim e allowlist sono stati aggiunti eventi
diagnostici strutturati. Gli eventi riportano soltanto tipo di esito, presenza
dei meccanismi di autenticazione e motivo Clerk; non registrano email, subject,
cookie o token. Con `wrangler tail` è stata osservata la richiesta protetta e,
dopo aver aggiunto anche la telemetria al blocco `catch`, l'errore effettivo è
risultato:

```text
Missing Clerk Secret Key.
```

La configurazione conteneva `CLERK_PUBLISHABLE_KEY` e `CLERK_JWT_KEY`, ma non
`CLERK_SECRET_KEY`. In `@clerk/backend@3.23.2`, `authenticateRequest()` valida
la presenza della Secret Key prima di elaborare una normale sessione token,
anche quando è disponibile la chiave JWT per la verifica locale. Il `catch`
generico del Worker nascondeva l'eccezione trasformandola in un normale redirect
al login; per questo il sintomo assomigliava a un problema di cookie.

La correzione è composta da due parti:

1. aggiungere `CLERK_SECRET_KEY` al contratto `Env` e passarla a
   `createClerkClient()` insieme a publishable key e JWT key;
2. installare la chiave Production in Cloudflare senza passarla come argomento
   o inserirla nei file:

```powershell
npx wrangler secret put CLERK_SECRET_KEY
```

Il secret è stato verificato tramite `wrangler secret list`, che mostra soltanto
il nome del binding. Una richiesta anonima ha poi confermato l'assenza
dell'eccezione; infine l'account autorizzato ha completato login, verifica D1 e
apertura dell'app. La versione collaudata è
`69c6af57-5972-44d4-aa6f-c257c37e776f`.

### 13.10 Aggiunta incrementale di membri autorizzati

Una lista ricevuta dall'operatore conteneva 26 voci e 25 indirizzi unici. Il
file sorgente è stato creato soltanto come file temporaneo coperto dalle regole
`.gitignore`; non è mai stato aggiunto a Git.

L'import è stato eseguito senza `--replace`, quindi ha aggiunto o riattivato i
25 membri senza revocare il membro già presente:

```powershell
python scripts/sync_authorized_members.py <file-privato> --dry-run
python scripts/sync_authorized_members.py <file-privato>
```

`CHOIR_AUTH_EMAIL_HMAC_KEY` è stata letta dal password manager, mantenuta in una
variabile d'ambiente solo per la durata dei due comandi e poi rimossa. D1 ha
ricevuto esclusivamente digest HMAC, non indirizzi email in chiaro. La verifica
aggregata finale ha restituito 26 membri totali, 26 attivi, 0 inattivi, 0 record
incompleti e 26 digest distinti. Gli appunti e il file temporaneo sono stati
eliminati dopo il controllo.

## 14. Cosa resta da fare

L'ordine previsto è:

1. ~~attendere o correggere la delega finché Cloudflare diventa `Active`~~ —
   completato il 2026-10-16;
2. attendere la verifica dei cinque record in Clerk e l'emissione TLS;
3. ricontrollare nell'istanza Clerk Production metodi email, claim e protezioni;
4. ~~acquisire publishable key ed esatto Frontend API origin~~ — completato;
5. ~~sostituire i placeholder pubblici in `wrangler.jsonc`~~ — completato;
6. ~~acquisire e installare nel Worker la chiave JWT pubblica e la Secret Key
   Clerk Production~~ — completato; entrambe sono Worker secrets separati e la
   Secret Key non è mai stata inserita in file o chat;
7. ~~generare `AUTH_EMAIL_HMAC_KEY`, salvarla nel password manager e nel
   Worker~~ — completato; gli appunti sono stati cancellati dopo la conferma;
8. ~~sincronizzare da un CSV privato membri, ruoli e gruppi prima in dry-run~~
   — completato: dopo la correzione delle transazioni esplicite, D1 contiene un
   membro attivo con ruolo `singer`, gruppo `tenori` e relativo evento audit;
9. ~~eseguire check, test, audit e build~~ — completato: 39 test TypeScript,
   0 vulnerabilità moderate+ e build completa di 19 brani;
10. ~~distribuire il Worker sul solo hostname `staging.epistrophe.it`~~ —
    completato; versione corrente collaudata con account autorizzato:
    `69c6af57-5972-44d4-aa6f-c257c37e776f`;
11. account autorizzato collaudato; restano i casi non autorizzato e revocato;
12. completare la revisione di sicurezza prima di qualunque cutover pubblico.

Il collaudo anonimo successivo al deploy ha verificato `302` verso il login per
la pagina HTML, `200` per `/auth/config` e `401` per catalogo e manifest. Un
client Python privo di firma browser ha ricevuto Cloudflare `1010`; ripetendo la
richiesta con una firma browser normale il Worker ha risposto come previsto.
Il CNAME `accounts.staging`, inizialmente assente dal DNS pubblico al checkpoint
post-deploy, è stato confermato nel pannello e si è propagato. Cloudflare,
Google e infine anche il resolver ordinario della workstation vedono il CNAME
Frontend API e i relativi indirizzi IP. Il form di login è stato verificato
senza override DNS. Il 2026-10-16 il collaudo interattivo con account
autorizzato ha raggiunto correttamente l'app; restano da provare in modo
esplicito account non autorizzato e membro revocato.

## 15. Regole sui dati sensibili

- La publishable key Clerk e gli hostname DNS sono pubblici.
- `CLERK_SECRET_KEY` è necessaria al backend, è altamente sensibile e deve
  esistere soltanto nel password manager e nei Worker secrets; non deve essere
  copiata in file versionati, frontend, chat, screenshot o log.
- La chiave JWT usata dal Worker è pubblica dal punto di vista crittografico,
  ma viene gestita come binding separato per evitare errori di configurazione.
- `AUTH_EMAIL_HMAC_KEY` è un vero segreto: va conservato nel password manager e
  mai in Git, chat, screenshot, history o log CI.
- Il CSV dei coristi deve rimanere fuori dal repository e avere un backup
  cifrato controllato dal maintainer.

## 16. Domande utili per la lezione

1. Perché acquistare un dominio non significa avere già un sito online?
2. Perché Clerk non sostituisce D1 nell'autorizzazione?
3. Perché i record Clerk devono essere DNS only mentre l'app può essere
   protetta dal proxy Cloudflare?
4. Perché staging e produzione non devono condividere chiavi e database?
5. Qual è la differenza tra `Unverified` e `Awaiting deployment`?
6. Perché un resolver pubblico non basta per diagnosticare la delega e conviene
   interrogare direttamente il nameserver del TLD?

