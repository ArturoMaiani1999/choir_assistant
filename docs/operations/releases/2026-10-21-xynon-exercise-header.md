# Xynon: testata degli esercizi allineata alla scelta brano

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

Gli esercizi usavano una barra fissa alta 64 px su desktop e 62 px su mobile,
con margini diversi dalla Home. La testata ora riusa i margini di **Scegli
brano**, inclusa la safe area: i controlli **Menù** e **Indietro** hanno la
stessa posizione e altezza. La riga del laboratorio include il suo divisore
di 1 px; lo spazio del risultato mobile si adegua alla nuova altezza.

La misura locale prima della modifica collocava Menù più in alto di Indietro,
non più in basso come nella segnalazione. Il telefono non era collegato via
ADB: il comportamento della barra del browser sul Samsung non è stato
misurato. La correzione elimina la differenza verificata nel layout delle due
testate senza attribuire una causa non osservata al browser.

Una riduzione di 4 px dello spazio finale della scelta esercizi elimina una
scrollbar inutile di 1–2 px dovuta alle metriche frazionarie del contenuto.
La disposizione dei percorsi, lo spartito e i controlli degli esercizi restano
quelli esistenti. La Home mantiene le coordinate precedenti.

## Pacchetto

- Origine: `https://staging.xynon.it`.
- Configurazione: `wrangler.xynon.jsonc`.
- Versione: `9a964cd2-bad8-4d91-a69e-922683efe796`, traffico 100%.
- Pubblicazione: 21 ottobre 2026, 18:59 CEST.
- Artefatto: `artifacts/voice-lab-header/release-final`.
- Build: `20261021-165801-6811032c1db7-dirty-aligned-navigation`.
- File: 1304; 19 brani.
- SHA-256 manifest: `534a4efffb676404ede7a1551d5cc413a736f46deb8a0fa9485920e25a656d75`.
- SHA-256 Worker: `9b6dd067fb5b2e9339732bdd5b2156ae1438d306a108df93ab135fc9437ed4bd`.
- Base e rollback: `5f7cb177-80bc-49e2-8040-e8f72f771807`.

La ricetta parte dal [rilascio senza promemoria volume](2026-10-21-xynon-no-volume-reminder.md),
conservando la correzione di sessione e tutte le modifiche già pubblicate.
Cambiano solo `navigation.css` e riferimenti fingerprintati/runtime. Il Worker
e gli altri moduli conservano gli hash della base.

## Verifiche

- Confronto browser entrando dal menù: coordinate di Menù e Indietro identiche
  (desktop: top 20 px, sinistra 54,625 px; mobile: top 16 px, sinistra 24 px),
  con target alti 44 px e testate ancorate a top 0.
- Nessuno scorrimento nella scelta esercizi a 1366×768 e 390×844; screenshot
  dei due contesti ispezionati. Preparazione, impostazioni e istruzioni
  conservano i controlli accessibili.
- Manifest, riferimenti locali, dry-run Worker e documentazione verificati.
- Smoke completo del laboratorio superato sul pacchetto finale: scala,
  arpeggi, orecchio interno, trasposizione, canto, risultato, controlli touch,
  tastiera e animazioni. Anche la dimostrazione passa tutti i suoi controlli,
  compresi chiusura, movimento ridotto e nuovo tentativo dopo errore.
- Registro remoto conferma il deploy al 100%; login desktop/mobile,
  registrazione, redirect e protezione di API e asset passano lo smoke remoto,
  senza errori JavaScript/CSP né overflow. Il log di Wrangler conferma il
  successo; la stampa locale del log ha incontrato un errore di encoding
  Windows dopo la pubblicazione, senza necessità di ripeterla.
- Le verifiche autenticate usano account sintetici locali e asset reali;
  nessuna fixture viene distribuita.

Evidenze e ricetta in `artifacts/voice-lab-header/`.

```powershell
python artifacts/voice-lab-header/measure.py artifacts/voice-lab-header/release-final
python scripts/browser_voice_lab_instructions_smoke.py --release artifacts/voice-lab-header/release-final
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/voice-lab-header/release-final --tag exercise-header-2026-10-21
```
