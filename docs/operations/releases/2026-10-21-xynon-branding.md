# Xynon: rinomina del prodotto

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Risultato

Il sito `https://staging.xynon.it` mostra Xynon nella Home, nelle pagine di
accesso/registrazione/uscita, nel repertorio, nella direzione, in Relax mode,
nel laboratorio vocale e nei titoli delle schede. Anche il titolo dinamico
della prova e della partitura e il testo dell'informativa usano il nuovo nome.
I sorgenti includono la stessa rinomina nella pagina amministrativa locale.

Palette, gerarchia musicale e interazioni sono quelle già documentate nel
[design system](../../product/ui-design-system.md). Il modulo Clerk è ora
vincolato alla larghezza interna del pannello per evitare che sporga su mobile.
Non sono stati cambiati autenticazione, ruoli o consensi.

## Distribuzione

- Worker: `choir-assistant-xynon-staging`.
- Versione: `a7d0f6d0-7575-4db5-9e72-a3eb95b88952`.
- Versione precedente per rollback: `243148d3-471b-4899-88a4-c2e419d1837f`.
- Artefatto: `artifacts/xynon-branding-dist`, build
  `20261021-084901-6811032c1db7-dirty-xynon-branding`.
- SHA-256 del manifest:
  `e29ac58173ffeb1c2d5d5274c2657fcf9e8902c2fbaf7f6b33309720a9f30280`.

Il rilascio deriva dall'artefatto Xynon già verificato e pubblicato, applicando
soltanto i testi del marchio e il vincolo di larghezza del modulo Clerk. Hash
dei CSS/JS modificati, riferimenti e manifest sono stati rigenerati. I file
musicali e audio hanno gli stessi hash; le altre modifiche locali della working
tree non sono incluse. Pubblicato senza ricostruire con:

```powershell
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/xynon-branding-dist
```

Le build future usano i sorgenti aggiornati tramite `npm run build:xynon`.
Il Worker e le configurazioni dell'altro sito non sono stati ridistribuiti.

## Verifiche

- 14 test della build e validazione della documentazione passati.
- Sintassi JavaScript della prova e del lettore partiture verificata.
- Smoke Chromium di navigazione, ritorno alla prova e uscita passato a
  1366x768 e 390x844.
- Artefatto candidato verificato su Home, repertorio, direzione, laboratorio,
  partitura e Relax nei due viewport, senza errori JavaScript, vecchi nomi
  visibili né overflow del documento; screenshot ispezionati.
- Dry-run Wrangler passato e deploy completato: 15 asset nuovi/modificati.
- Smoke sul sito pubblicato con Clerk reale passato nei due viewport: titolo
  e firma Xynon, modulo contenuto nel pannello, nessun errore JavaScript/CSP.
  Login/registrazione/uscita rispondono `200`; la root porta al login;
  catalogo, bundle, SVG, MP3 e API anonimi restano `401`.

Al controllo finale il resolver di sistema restituiva temporaneamente NXDOMAIN,
mentre Google e Cloudflare DNS-over-HTTPS restituivano gli indirizzi A del
dominio. Lo smoke remoto è stato completato usando soltanto nel browser
headless `--host-resolver-rules` con uno degli IP appena restituiti dal resolver
pubblico. L'hostname HTTPS e la verifica TLS sono rimasti reali. Non sono
stati modificati hosts, cache DNS o configurazioni di rete del computer.

Evidenze locali in `artifacts/xynon-branding-release/`. La verifica autenticata
completa con codice email resta un controllo dell'operatore, come documentato
nel runbook di provisioning.

## Riferimenti conservati

`epistrophe.it` rimane nelle configurazioni del sito precedente e nelle prove
storiche di rilascio. La chiave IndexedDB `epistrophe-pitch-lab` è conservata
per compatibilità con le registrazioni locali esistenti e non è mostrata
nell'interfaccia. Queste stringhe non rappresentano il marchio pubblico.
