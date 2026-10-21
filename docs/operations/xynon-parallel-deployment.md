# Xynon: staging parallelo a Epistrophe

**Status:** pubblicato; login e protezione asset verificati da browser anonimo  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

Xynon viene preparato come ambiente indipendente. La configurazione esistente
`wrangler.jsonc` continua a distribuire Epistrophe. Per il nuovo ambiente usare
sempre `wrangler.xynon.jsonc`; non cambiare il dominio dell'istanza Clerk Epistrophe.
Il runbook generale rimane [consumer-auth-deployment.md](consumer-auth-deployment.md).

## Configurazione e stato

| Risorsa | Xynon |
|---|---|
| Origine canonica | `https://staging.xynon.it` |
| Clerk Frontend API | `https://clerk.staging.xynon.it` |
| Clerk Account Portal | `https://accounts.staging.xynon.it` |
| Applicazione Clerk | Xynon, istanza Production, Secondary application |
| Configurazione | `wrangler.xynon.jsonc` |
| Worker pubblicato | `choir-assistant-xynon-staging` |
| Database D1 creato | `choir-assistant-xynon-staging` |
| D1 UUID | `7890308a-756b-4bca-94bd-246d849ac915` |
| Bucket R2 creato | `choir-assistant-xynon-performances-staging`, privato |
| Artefatto | `artifacts/xynon-dist/` |

Le 11 migrazioni da `0001` a `0011` sono applicate al nuovo D1. Il database
contiene 29 membri attivi dopo l'aggiornamento della lista privata. La publishable
key Production fornita dal maintainer è salvata nella configurazione pubblica.
I tre Worker secret sono installati. Il Worker è pubblicato nella versione
`30e7f65e-d3ff-48da-b6a6-2812f490209a`, con
[cache del codice e recupero dell'avvio](releases/2026-10-21-startup-cache-recovery.md), il marchio Xynon, la
[calibrazione audio per la demo](releases/2026-10-21-xynon-audio-mvp.md) e la
[Lissajous in supersampling](releases/2026-10-21-xynon-lissajous-smooth.md),
con [menù compatto e repertorio essenziale](releases/2026-10-21-xynon-navigation.md)
e [ritorno contestuale](releases/2026-10-21-xynon-contextual-back.md), il
[caricamento rapido del repertorio](releases/2026-10-21-xynon-repertoire-performance.md)
e il [profilo vocale ricordato con riferimento volume 50%](releases/2026-10-21-xynon-audio-persistent.md),
con [archi di Bach nella prima calibrazione](releases/2026-10-21-xynon-bach-calibration.md)
e [curve piane nei percorsi vocali](releases/2026-10-21-xynon-vocal-curves.md),
ora [ferme con scia del pallino](releases/2026-10-21-xynon-vocal-trails.md).
Il piano roll [non mostra più Vista](releases/2026-10-21-xynon-no-view.md).
Gli esercizi usano il [rinnovo della sessione per gli audio privati](releases/2026-10-21-xynon-voice-lab-session.md).
Il [promemoria volume è rimosso dalla prova](releases/2026-10-21-xynon-no-volume-reminder.md).
La [testata degli esercizi è allineata alla scelta brano](releases/2026-10-21-xynon-exercise-header.md).
Gli esercizi sono ora [senza firma nell'angolo e senza fascia vuota sopra il menù](releases/2026-10-21-xynon-exercise-top-fix.md).
Il [riuso del profilo riavvia l'analisi vocale](releases/2026-10-21-xynon-live-voice-restore.md),
con fruscii ripristinati per la guida iniziale.
Il [Worker pitch bloccato recupera automaticamente](releases/2026-10-21-xynon-pitch-worker-recovery.md).
L'artefatto corrente congelato è `artifacts/voice-lab-top-fix/release`;
`artifacts/xynon-dist` resta l'uscita predefinita per le build future.

Il cambio nameserver OVH verso `augustus.ns.cloudflare.com` e
`violet.ns.cloudflare.com` è stato verificato pubblicamente. La configurazione
Clerk deve completare la verifica dei cinque CNAME, tutti in modalità DNS only.
Verificare lo stato attuale in Clerk prima del deploy; i certificati e le cache
DNS possono aggiornarsi in momenti diversi.

## Secret e identità

I secret sono specifici di Xynon. Non recuperare quelli di Epistrophe e non
incollare la Secret Key in chat, in Git o in un comando con il valore come argomento.

Per installare la nuova Secret Key, aprire Clerk **Xynon > Production > API keys**
e usare il prompt interattivo di Wrangler nel terminale locale:

```powershell
npx wrangler secret put CLERK_SECRET_KEY --config wrangler.xynon.jsonc
```

Al primo utilizzo Wrangler può chiedere di creare il Worker
`choir-assistant-xynon-staging`: confermare solo quel nome. La creazione iniziale
per installare un secret non equivale alla pubblicazione della webapp completa.

Installare anche:

- `CLERK_JWT_KEY`: chiave pubblica RSA PEM ricavata dal JWKS della nuova
  istanza, `https://clerk.staging.xynon.it/.well-known/jwks.json`;
- `AUTH_EMAIL_HMAC_KEY`: nuova chiave casuale di almeno 32 byte; lo stesso valore deve essere usato nell'importazione
  dei coristi tramite `CHOIR_AUTH_EMAIL_HMAC_KEY`.

I secret mancanti sono stati installati con `scripts/setup_xynon_secrets.ps1`.
La copia HMAC operatore è cifrata tramite Windows DPAPI in
`%LOCALAPPDATA%\ChoirAssistant\Xynon\auth-email-hmac.dpapi`: può essere decifrata
soltanto dal relativo utente Windows. Il password manager non è stato aggiornato;
conservare anche un backup recuperabile prima di cambiare macchina o account.
Lo script riusa la copia locale e non ruota un HMAC già installato.

Ogni `wrangler secret put` deve includere `--config wrangler.xynon.jsonc`.
Verificare soltanto i nomi con:

```powershell
npx wrangler secret list --config wrangler.xynon.jsonc
```

Replicare in Clerk Production le impostazioni documentate nel runbook: codice
email, identificatore email non modificabile, protezioni anti-abuso e claim
`primaryEmail` sul token standard. Verificare il claim anche dopo la clonazione.

Le identità Clerk delle due applicazioni sono indipendenti. `authorized_members`
lega ogni membro anche a `clerk_subject`: condividere il D1 esistente con una
nuova istanza Clerk causerebbe conflitti. Importare la lista privata nel D1
nuovo; non copiare indiscriminatamente i vecchi subject. Registrazioni, profili
e progressi non sono sincronizzati tra i due ambienti. La loro eventuale
migrazione richiede una procedura distinta che preservi associazioni e oggetti R2.

## Lista autorizzata

Con `CHOIR_AUTH_EMAIL_HMAC_KEY` impostato localmente al segreto Xynon, usare il
CSV privato senza passare per chat o Git:

```powershell
python scripts/sync_choir_members.py C:\private\coristi-ruoli.csv --config wrangler.xynon.jsonc --database choir-assistant-xynon-staging --dry-run
python scripts/sync_choir_members.py C:\private\coristi-ruoli.csv --config wrangler.xynon.jsonc --database choir-assistant-xynon-staging
Remove-Item Env:\CHOIR_AUTH_EMAIL_HMAC_KEY
```

Il percorso è un esempio: usare la lista autorevole reale. Non usare `--replace`
per la prima importazione. Il parametro `--config` seleziona il file Wrangler;
`--database` seleziona il D1 destinatario. Servono entrambi per Xynon.

L'importazione iniziale del 2026-10-21 ha validato 28 indirizzi unici e un gruppo,
poi sincronizzato 28 membri in modalità incrementale, senza revoche. Il CSV
originale aveva 29 righe con indirizzo: una coppia duplicata aveva dati identici
salvo parte/gruppo vuoti nella prima riga e `tenore`/`Tenori` nella seconda.
È stata usata una copia privata deduplicata, mantenendo i valori compilati;
il file sorgente originale è rimasto invariato. Percorsi e indirizzi non vengono
registrati nel repository. Nessuna vecchia identità Clerk è stata copiata.

L'aggiornamento successivo del 2026-10-21 ha validato 29 membri, con tutti
i 28 precedenti presenti e un nuovo cantante. Dry-run e sincronizzazione
incrementale sul D1 Xynon sono completati, senza `--replace`. La verifica
successiva conferma 29 attivi, ruoli, appartenenze e grant corrispondenti al
CSV; associazioni Clerk, identità dei membri e preferenze dei profili
esistenti sono conservate. È stata usata la copia HMAC locale cifrata, senza
leggere la clipboard o modificare i secret del Worker. Evidenze aggregate
senza dati personali in `artifacts/xynon-member-sync-20261021/result.json`.

## Build e pubblicazione

```powershell
python scripts/check_deploy_config.py --config wrangler.xynon.jsonc
npm run check
npm run build:xynon
npx wrangler deploy --dry-run --config wrangler.xynon.jsonc --outdir artifacts/xynon-worker-dry-run
```

La build usa il Frontend API del file Worker selezionato anche nella CSP di
`_headers`. Gli asset Xynon sono separati da `dist/` per evitare di usare una
build con la policy dell'altro ambiente. Il Worker continua ad accettare una
sola origine; `workers.dev` e preview URL rimangono disabilitati.

Dopo secret, importazione dei coristi e verifiche previste dal runbook:

```powershell
npm run deploy:xynon
```

Questo comando configura il custom domain del nuovo Worker. Per Epistrophe
rimane valido `npm run deploy`; per la versione storica Access rimane valido
`npm run deploy:access`.

## Verifiche eseguite il 2026-10-21

- Configurazioni Epistrophe e Xynon accettate dal validatore.
- 10 test delle configurazioni di deploy, 14 test della build e 5 test della
  sincronizzazione coristi passati, inclusa selezione esplicita del nuovo ambiente.
- Typecheck, 89 test applicativi e 52 test audio/calibrazione passati.
- Audit dipendenze: zero vulnerabilità segnalate.
- Build `20261021-082232-6811032c1db7-dirty`: 1.296 file, 19 brani; hash
  verificati contro il manifest. Include le modifiche locali presenti nella
  working tree ed è l'artefatto poi pubblicato, senza ricostruire durante il deploy.
- SHA-256 del manifest:
  `d4aca94db9b0fdab43903dc1f9a88a46dfc80e5dcc6349851fd996022352555f`.
- Dry-run Wrangler completato con i soli binding D1/R2 Xynon.
- Smoke Chromium locale di navigazione e uscita passato a 1366x768 e 390x844,
  con fixture Clerk; verifica del rilascio microfono passata. Nessuna modifica
  visiva introdotta da questa preparazione.

## Pubblicazione e verifiche remote

Deploy completato sul custom domain `staging.xynon.it`, versione
`243148d3-471b-4899-88a4-c2e419d1837f`. Il caricamento iniziale degli asset ha
richiesto un retry dopo `ECONNRESET`; è poi terminato correttamente. Il dominio
è servito via HTTPS e gli hostname alternativi Workers/preview sono disabilitati.

Lo smoke Chromium reale, con un nuovo profilo browser e senza sessioni simulate,
ha verificato il caricamento del modulo Clerk a 1366x768 e 390x844, senza errori
JavaScript/CSP né overflow del documento. Questo primo rilascio conservava il
nome prodotto precedente; il successivo aggiornamento
[Xynon: rinomina del prodotto](releases/2026-10-21-xynon-branding.md) sostituisce
il marchio nell'interfaccia. Le configurazioni di deploy Epistrophe sono invariate.

Catalogo, bundle, SVG, MP3 e `/api/me` restituiscono `401` al browser anonimo;
`/auth/config` espone soltanto la publishable key Xynon. Le prove HTTP con un
client Python sono state intercettate dalle protezioni Cloudflare (`403`), perciò
i risultati funzionali attendibili sono quelli ottenuti con Chromium.
Evidenze locali in `artifacts/xynon-release/`.

Il browser conferma inoltre il redirect della root al login, lo stato `200`
delle pagine di accesso/registrazione/uscita, `Cache-Control: no-store`, CSP
con la sola origine Clerk Xynon e caricamento del modulo di registrazione.

Rimane il collaudo autenticato completo con codice email, profilo, riproduzione
audio e registrazioni: richiede un corista reale. Poiché l'istanza Clerk è nuova,
il primo utilizzo richiede la registrazione con un indirizzo della lista autorizzata.
Epistrophe non è stato ridistribuito né modificato da questa procedura.
