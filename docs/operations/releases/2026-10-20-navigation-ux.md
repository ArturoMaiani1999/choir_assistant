# Staging: navigazione, profilo SATB e uscita

**Status:** pubblicato e verificato su staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Distribuzione

- Destinazione: `https://staging.epistrophe.it`, Worker
  `choir-assistant-auth-staging`, configurazione `wrangler.jsonc`.
- Versione attivata: `3550ab33-d1b7-40ca-a95a-38d48a498732`.
- Tag: `navigation-ux-2026-10-20`.
- Build immutabile: `20261019-213213-46c4b97f1322-dirty`, 1.287 file,
  19 brani. Istanza personale con modifiche locali non committate.
- SHA-256 di `deployment-manifest.json`:
  `aec60da9d9fcffb59cbc4d566b30daa56385bc94697ea6f348595d5375bdd61c`.
- Migrazione remota applicata prima del Worker:
  `0011_preferred_voice_part.sql`. Nessuna migrazione residua; colonna
  `preferred_voice_part TEXT` verificata sul database di staging.
- Versione precedente per rollback:
  `89847875-944e-487b-83ca-b3a2ea05de65`. La colonna aggiuntiva è compatibile
  con il codice precedente e non richiede una migrazione inversa.

## Contenuto

Menù progressivo con tre modalità, scelta assegnati/custom nel canto, parte
SATB persistente nel profilo, toolbar mobile inizialmente aperta, ritorni
contestuali e pagina di uscita separata. Il ritorno dalla partitura conserva
il punto della prova; l'analisi offre un accesso diretto alla pratica.
Il dettaglio dei rilievi è nell'[audit di navigazione](../../product/navigation-ux-audit.md).

## Verifiche

- Typecheck e 89 test applicativi; 26 test di calibrazione/rientro audio.
- Test JavaScript di pratica, clock, rilevatore, filtro, harness e mixer.
- 30 test backend; 16 test di configurazione/sincronizzazione, 3 test del
  controllo artefatti vocali e 12 test della build.
- Audit artefatti vocali, documentazione, `git diff --check` e audit dipendenze:
  nessuna vulnerabilità nota riportata.
- Verifica degli hash di tutti i file dell'artefatto e dry-run del Worker.
- Smoke di navigazione con clic reali a 1366×768 e 390×844, dati sintetici
  locali e simulazione dell'SDK per la pagina di uscita.
- Smoke Chromium della stessa `dist/`, senza ricostruire: pratica, microfono,
  mixer, trasporto, partitura e tastiera; nessuna richiesta esterna o errore.
  L'autenticazione è sostituita soltanto nel server locale di test.
- Dopo il deploy: pagine protette → login (`302` con `Accept: text/html`);
  catalogo, bundle, audio e `/api/me` anonimi → `401`; login e uscita → `200`;
  `/sign-out.html` → URL canonico `/sign-out` (`307`). Risposte `no-store`;
  pagine pubbliche di accesso/uscita identiche all'artefatto, con CSP.

Evidenze locali: `artifacts/navigation-release/post-deploy.json` e screenshot
in `artifacts/navigation-fixes`. Non è stato eseguito un nuovo login Clerk
con un account reale dopo la pubblicazione. La produzione protetta da Access
non è stata modificata.
