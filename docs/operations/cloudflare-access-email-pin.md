# Accesso privato con allowlist email e PIN

**Status:** canonical
**Owner:** project maintainer
**Last reviewed:** 2026-10-04

Questa procedura configura Cloudflare Access davanti al Worker statico di
Choir Assistant. Soltanto gli indirizzi email elencati ricevono un One-time
PIN; spartiti, audio, manifest e asset rimangono tutti dietro lo stesso
cancello.

La lista reale delle email resta nel dashboard Cloudflare. Non copiarla nel
repository, nei log di rilascio o negli screenshot condivisi.

## Risultato atteso

```text
browser anonimo
    -> Cloudflare Access
       -> email presente nella allowlist?
          -> sì: invia PIN monouso -> sessione autorizzata -> Worker
          -> no: nessun PIN utile -> accesso negato
```

La policy va applicata al **Worker** con scope **All traffic**. In questo modo
copre l'indirizzo `workers.dev`, eventuali domini personalizzati e le preview,
senza dover proteggere ogni hostname separatamente.

## 1. Prerequisiti

1. Il Worker `choir-assistant` esiste già.
2. Cloudflare Zero Trust è inizializzato con un team name.
3. Il Worker ha una policy Access temporanea per i membri dell'account
   Cloudflare. Mantenerla durante la configurazione evita di chiudere fuori
   l'amministratore.
4. L'ambito della protezione è **All traffic**, non **Previews only**.

Per verificare il punto 4: **Workers & Pages → choir-assistant → Access**. La
scheda deve mostrare `Worker Access · All traffic`.

## 2. Abilitare One-time PIN

Nelle nuove organizzazioni Zero Trust il provider OTP può non essere creato
automaticamente:

1. Aprire **Zero Trust → Integrations → Identity providers**.
2. Selezionare **Add new identity provider**.
3. Scegliere **One-time PIN** e salvare.

Il PIN è monouso e scade dopo 10 minuti. Cloudflare invia l'email soltanto se
l'indirizzo soddisfa una policy Allow, ma mostra deliberatamente lo stesso
messaggio anche agli indirizzi esclusi per non rivelare la allowlist.

## 3. Creare la policy riutilizzabile

1. Aprire **Zero Trust → Access controls → Policies**.
2. Nella scheda **Reusable policies**, selezionare **Add a policy**.
3. Impostare:
   - **Policy name:** `Coristi autorizzati`;
   - **Action:** `Allow`;
   - **Session duration:** inizialmente `7 days`;
   - **Include → Selector:** `Emails`;
   - **Value:** gli indirizzi completi autorizzati;
   - **Require → Selector:** `Login methods`;
   - **Value:** `One-time PIN`.
4. Salvare.

Usare indirizzi esatti. Non usare **Emails ending in** con domini pubblici
come `gmail.com`, `libero.it` o `outlook.com`: autorizzerebbe chiunque possieda
un indirizzo verificato presso quel provider.

## 4. Collegare la policy al Worker

Creare una reusable policy non basta. Nella tabella delle policy, la colonna
**Used by applications** deve essere maggiore di zero.

1. Aprire **Workers & Pages → choir-assistant → Access**.
2. Selezionare **Manage access**.
3. Confermare **All traffic**.
4. In **Add policy**, selezionare `Coristi autorizzati`.
5. Lasciare temporaneamente selezionata anche la policy per i membri
   dell'account Cloudflare.
6. Selezionare **Apply Access**.
7. Tornare in **Reusable policies** e verificare che `Coristi autorizzati`
   mostri almeno `1` in **Used by applications**.

Più policy Allow applicate alla stessa applicazione sono alternative: basta
che l'utente ne soddisfi una. La policy Cloudflare account è quindi un accesso
amministrativo di riserva, non restringe la allowlist OTP.

## 5. Rendere disponibile il metodo PIN nella pagina di login

Se la pagina mostra soltanto il pulsante **Cloudflare**, la policy email può
essere corretta ma il metodo OTP non è disponibile nell'applicazione:

1. Dalla scheda Access del Worker selezionare **Manage Access app**.
2. Modificare l'applicazione collegata al Worker.
3. Nella sezione **Login methods**, abilitare **One-time PIN**.
4. Disabilitare l'eventuale **Instant authentication** verso Cloudflare, che
   salterebbe la scelta del metodo e reindirizzerebbe subito al login account.
5. Salvare.

La pagina di login deve ora mostrare il campo email o l'opzione One-time PIN.

## 6. Collaudo obbligatorio

Usare una nuova finestra anonima, per non riutilizzare cookie Access esistenti:

1. Aprire `https://choir-assistant.choir-assistant.workers.dev/`.
2. Verificare che appaia Cloudflare Access e non direttamente l'app.
3. Usare un indirizzo presente nella allowlist: il PIN deve arrivare e aprire
   Choir Assistant.
4. Ripetere con un indirizzo non presente: non deve ottenere accesso.
5. Senza sessione, verificare anche un asset diretto:

```powershell
curl.exe -I https://choir-assistant.choir-assistant.workers.dev/library-assets/ave-verum/bundle.json
```

Il risultato atteso è un redirect `302` verso `cloudflareaccess.com` oppure un
diniego, mai `200`. Ripetere il controllo per `/deployment-manifest.json`.

Solo dopo il test OTP riuscito si può rimuovere la policy `Cloudflare account`
se si desidera che anche l'amministratore entri esclusivamente tramite PIN.
Conservarla è accettabile finché l'account Cloudflare ha MFA e soltanto gli
amministratori previsti ne sono membri.

## 7. Gestione della allowlist

Per aggiungere o rimuovere un corista:

1. **Zero Trust → Access controls → Policies**.
2. Aprire `Coristi autorizzati`.
3. Modificare i valori del selettore **Emails** e salvare.
4. Verificare che la policy resti collegata all'applicazione.

La rimozione impedisce nuove autenticazioni, ma una sessione già emessa può
restare valida fino alla sua scadenza. Per una revoca urgente, invalidare anche
la sessione Access dal dashboard e verificare in finestra anonima.

## 8. Diagnosi rapida

| Sintomo | Causa probabile | Correzione |
|---|---|---|
| La login mostra soltanto `Cloudflare` | OTP assente dai provider/metodi dell'app oppure Instant authentication attiva | Aggiungere One-time PIN, abilitarlo nella Access app e disattivare Instant authentication |
| `Coristi autorizzati` mostra `Used by applications: 0` | Policy creata ma non collegata al Worker | Worker → Access → Manage access → Add policy → Apply Access |
| Il PIN non arriva a un corista | Email non identica alla allowlist, policy non collegata, spam o filtro email | Controllare spelling, collegamento della policy e cartelle spam; richiedere un nuovo codice |
| Un indirizzo escluso vede “codice inviato” | Comportamento anti-enumerazione previsto | Verificare il mancato arrivo e il diniego dopo l'inserimento di un codice non valido |
| Il sito si apre senza login | Scope errato o policy rimossa | Ripristinare **All traffic** e verificare anonimamente root e asset diretto |
| Il test continua a usare la vecchia identità | Cookie/sessione Access già presenti | Usare una nuova finestra anonima o revocare la sessione |

## Riferimenti ufficiali

- Cloudflare Access for Workers:
  https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- One-time PIN:
  https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
- Gestione delle Access policy:
  https://developers.cloudflare.com/cloudflare-one/access-controls/policies/policy-management/
- Limiti Access:
  https://developers.cloudflare.com/cloudflare-one/account-limits/
