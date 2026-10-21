# Xynon: rifinitura della Lissajous

**Status:** pubblicato su staging Xynon
**Owner:** project maintainer
**Last reviewed:** 2026-10-21

## Risultato

La firma Lissajous usa filamenti connessi senza giunzioni puntinate,
campionamento parametrico stabile e composizione luminosa additiva agli
incroci. Su mobile il Canvas segue la densità del dispositivo fino a 3×.
Il punto procede al 50% della velocità precedente e la camera al 130%.
La scia dura 40 secondi per conservarne la lunghezza geometrica. Il duetto
resta di cinque secondi e compare per la prima volta dopo circa 34,7 secondi.

La distribuzione della firma nelle pagine conserva il contratto del
[sistema UX/UI](../../product/ui-design-system.md). Formule e dettagli sono
nei documenti [Home](../../product/home.md) e [Relax](../../product/relax-mode.md).

## Pacchetto e pubblicazione

- Origine: `https://staging.xynon.it`.
- Worker: `choir-assistant-xynon-staging`, configurazione `wrangler.xynon.jsonc`.
- Versione: `19f4eb39-bb2b-482d-b629-6695d52a6580`, 100% del traffico.
- Pubblicazione: 21 ottobre 2026, 13:40 CEST.
- Tag: `lissajous-quality-2026-10-21`.
- Artefatto congelato: `artifacts/xynon-lissajous-release/release`.
- Build: `20261021-113411-6811032c1db7-dirty-lissajous`, 1297 file e 19 brani.
- Renderer: `lissajous.8622c46ac473.js`.
- SHA-256 manifest:
  `d35d1f400798dc318a8ae8f14590f042ef5715623395ad4a898b84f41597f405`.
- SHA-256 Worker:
  `b99cad71a3a7e5a8ceaeabbefeca7582aebac1e703527c212d23f398b2f2b051`.
- Rollback: `60de8556-ad4d-447a-9741-7553595c0062`.

Il candidato deriva dall'artefatto pubblicato del
[rilascio audio](2026-10-21-xynon-audio-mvp.md). Cambiano il renderer,
i riferimenti fingerprintati, la versione della build e i dettagli descrittivi
di Relax. Le altre modifiche locali non sono incluse: Worker, audio,
autenticazione, dati, configurazione e tutti gli altri asset coincidono con
il rilascio precedente. Non vengono applicate migrazioni né modificati secret.

Pubblicato l'esatto artefatto verificato, senza ricostruire:

```powershell
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/xynon-lissajous-release/release --tag lissajous-quality-2026-10-21
```

## Verifica

- Integrità di tutti i file e dei nomi fingerprintati verificata; nessun
  file aggiuntivo rispetto al manifest. Audit dipendenze senza vulnerabilità.
- Undici test dedicati: velocità, continuità delle giunzioni, densità mobile,
  stati, durata del duetto, pause, frame saltati, cleanup e movimento ridotto.
- Smoke Chromium sull'artefatto finale: Home in undici viewport, firma
  compatta e Relax su desktop/mobile. Duetto, sospensione, tastiera, ritorni
  e palette verificati; screenshot ispezionati a 1366×768 e 390×844.
- TypeScript, 89 test applicativi e 60 test audio/lifecycle superati.
- Probe locale di 90 frame: circa 16,7 ms per frame su desktop e viewport
  mobile emulato a DPR 3. Non misura le prestazioni di un telefono fisico.
- Dry-run Xynon e confronto del bundle Worker identico alla versione
  precedente superati. Deploy completato con otto asset nuovi/modificati;
  registro remoto conferma la versione al 100%.
- Browser remoto con Clerk reale: modulo di accesso disponibile a
  1366×768 e 390×844, senza overflow né errori JavaScript/CSP. Accesso,
  registrazione e uscita rispondono 200; la root porta al login. Catalogo,
  bundle, SVG, MP3 e API restano 401 da anonimo; CSP Xynon e cache
  `no-store` sono conservate.

Il rendering autenticato è stato verificato sulla build locale con account
sintetico. La verifica nel proprio account sul dominio pubblicato richiede
una sessione Clerk reale; non vengono simulati accessi sul servizio remoto.
Evidenze in `artifacts/xynon-lissajous-release/` e
`artifacts/lissajous-quality/`.
