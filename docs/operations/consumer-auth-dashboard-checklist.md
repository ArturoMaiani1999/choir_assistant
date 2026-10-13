# Consumer authentication dashboard checklist

**Status:** external release gate; not yet executed
**Owner:** project maintainer
**Last reviewed:** 2026-10-13

Questa checklist copre i controlli che il repository non può applicare né
verificare autonomamente. Ogni casella va compilata sul tenant reale indicando
data, ambiente, responsabile e un riferimento a evidenza privata. Screenshot,
email, token, ID account e dettagli di fatturazione non vanno committati.

## Registro ambiente

| Campo | Staging | Produzione |
|---|---|---|
| Hostname canonico | da compilare | da compilare |
| Clerk instance | da compilare | da compilare |
| D1 database | da compilare | da compilare |
| Commit/versione Worker | da compilare | da compilare |
| Data verifica | da compilare | da compilare |
| Verificatore | da compilare | da compilare |

## Account amministrativi

- [ ] MFA resistente al phishing/passkey attiva su Cloudflare, Clerk e casella
  email amministrativa.
- [ ] Nessun account amministrativo condiviso; ruoli minimi e recovery code
  custoditi offline.
- [ ] Token API limitati all'ambiente e senza permessi globali non necessari.
- [ ] Almeno due destinatari controllano notifiche di sicurezza e di quota.

## Clerk

- [ ] Piano Hobby confermato nella pagina Subscription/Billing; nessun upgrade
  o add-on a pagamento attivo.
- [ ] L'app accetta soltanto codice email o magic link; password, telefono/SMS,
  social login e collegamento automatico di identità sono disabilitati.
- [ ] Cambio dell'email primaria da parte dell'utente disabilitato.
- [ ] Protezione bot/attack e protezione contro enumeration abilitate.
- [ ] Origini, redirect e domini autorizzati limitati all'hostname canonico.
- [ ] Claim sessione `primaryEmail` configurato esattamente come nel runbook.
- [ ] Durata sessione e revoca verificate con un account di prova.
- [ ] Nessun Backend API secret inserito nel Worker o nel frontend.
- [ ] Mittente email, dominio e template controllati contro phishing e spoofing.

## Cloudflare Workers e D1

- [ ] Account sul piano Free confermato; Workers Paid e prodotti/add-on non
  necessari non sono attivati.
- [ ] `workers.dev` disabilitato, preview URL disabilitati e un solo custom
  domain corrisponde a `APP_ORIGIN`.
- [ ] La route passa sempre dal Worker prima degli Static Assets.
- [ ] Database D1 di staging e produzione distinti; binding e secret distinti.
- [ ] Il superamento delle quote del piano scelto è stato verificato: durante la
  beta si preferisce un errore/indisponibilità a un addebito automatico.
- [ ] Notifiche di quota e sicurezza configurate; controllate anche dopo cambi
  di piano, perché gli alert non equivalgono a un tetto di spesa.
- [ ] Log e analytics non registrano email, JWT, cookie, codici login o HMAC key.
- [ ] Regole anti-abuso/rate limit definite per richieste anomale, senza
  ostacolare spartiti e audio legittimi; testate soltanto entro lo scope ammesso.

## Mailing list e privacy

- [ ] Lista sorgente conservata fuori da Git in storage cifrato con backup.
- [ ] Il dry-run riporta il numero previsto di coristi e non stampa indirizzi.
- [ ] Ogni `--replace` usa un export completo e `--confirm-replace-count`.
- [ ] Aggiunta, revoca e ripristino provati con indirizzi canary, non reali.
- [ ] Informativa privacy, tempi di conservazione e procedura di cancellazione
  coprono Clerk, D1, log e lista operatore.

## Controllo economico

- [ ] Stato dei metodi di pagamento verificato su entrambi i provider.
- [ ] Nessun servizio trial destinato a convertirsi automaticamente senza una
  decisione registrata.
- [ ] Soglie d'uso controllate manualmente con cadenza mensile e prima di eventi
  che possono generare picchi di login o download.
- [ ] Ogni attivazione di un piano pay-as-you-go ha budget alert multipli e un
  responsabile; è documentato che gli alert possono arrivare dopo il consumo.
- [ ] Data, autore e motivazione di ogni variazione tariffaria sono riportati
  nell'implementation tracker.

## Incidenti minimi da provare

1. **Corista da revocare:** disattivare il digest D1 e verificare il `403` alla
   richiesta successiva; poi revocare anche la sessione Clerk se necessario.
2. **Lista errata:** non ripetere modifiche alla cieca; conservare evidenze,
   recuperare l'ultimo export valido e riapplicarlo con conferma numerica.
3. **HMAC key esposta/persa:** generare una nuova key, aggiornare il secret e
   rigenerare tutti i digest dalla lista privata in una finestra coordinata.
4. **Account amministrativo compromesso:** revocare sessioni/token, ruotare i
   secret, congelare deploy e billing, quindi esaminare audit log e versioni.
5. **Uso o costo inatteso:** disabilitare la route o ripristinare Access se
   serve contenere l'evento; non attivare un piano a pagamento sotto pressione
   senza identificare prima origine e impatto.

## Esito

Il gate è superato solo quando tutte le caselle applicabili sono completate e
le eccezioni hanno owner, scadenza e rischio accettato per iscritto. Collegare
qui soltanto l'identificativo del verbale privato, non le evidenze sensibili.
