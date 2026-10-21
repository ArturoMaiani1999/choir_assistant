# Xynon: ritorno contestuale nella scelta dei brani

**Status:** pubblicato su staging Xynon
**Owner:** project maintainer
**Last reviewed:** 2026-10-21

## Risultato

Il controllo in alto a sinistra nella scelta dei brani si chiama **Indietro**.
Dal catalogo **Tutti i brani** riapre la scelta tra assegnati e catalogo,
conservando il brano selezionato. Dalla provenienza torna al menù iniziale.
La lettura torna direttamente al menù; la scelta SATB torna al catalogo o,
per un primo ingresso da assegnazione, al repertorio. La curva mantiene
posizione, dimensioni e tempo durante questi passaggi.

## Distribuzione

- Origine: `https://staging.xynon.it`; configurazione `wrangler.xynon.jsonc`.
- Worker: `choir-assistant-xynon-staging`.
- Versione: `21d4e0b5-412b-44b1-8b3a-00bf02c25dba`; traffico 100%.
- Pubblicazione: 21 ottobre 2026, 16:51 CEST.
- Tag: `contextual-back-2026-10-21`.
- Artefatto: `artifacts/xynon-contextual-back-release/release`.
- Build: `20261021-144951-6811032c1db7-dirty-contextual-back`.
- File: 1298; 19 brani.
- SHA-256 manifest:
  `f5c662f65bba1abaf5796ccb78afc1685bf87e2556f7968dad86119177961d7b`.
- SHA-256 Worker:
  `b99cad71a3a7e5a8ceaeabbefeca7582aebac1e703527c212d23f398b2f2b051`.
- Rollback: `9b8dca73-a7ae-4086-8ae3-587c2b0d3900`.

Il pacchetto deriva dal [rilascio navigazione](2026-10-21-xynon-navigation.md).
Cambiano solo etichetta, gestore del ritorno, versione runtime e riferimenti
HTML fingerprintati. Worker e tutti gli altri asset sono identici.

## Verifica

Smoke di navigazione superato a 1366×768 e 390×844, incluso catalogo →
provenienza → catalogo con brano conservato. Smoke Home superato su undici
viewport sia sui sorgenti sia sull'esatto pacchetto fingerprintato: ritorni
contestuali, lettura, target touch, focus, curva invariata e movimento ridotto.
Screenshot desktop/mobile ispezionati; dry-run e audit del manifest superati.

Il registro remoto conferma la versione al 100%. Browser con Clerk reale:
accesso desktop/mobile senza overflow o errori JavaScript/CSP; pagine di
accesso/registrazione/uscita disponibili e catalogo, spartiti, audio e API
protetti da accesso anonimo. Flussi autenticati verificati con fixture locali;
la prova con codice email resta legata a una sessione reale di un corista.
Evidenze in `artifacts/xynon-contextual-back-release`.
