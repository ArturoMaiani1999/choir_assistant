# Xynon: supersampling e filamenti continui

**Status:** pubblicato su staging Xynon
**Owner:** project maintainer
**Last reviewed:** 2026-10-21

## Risultato

La Lissajous usa un unico tracciato per filamento e lobo. La scia luminosa
è separata e si assottiglia fino a sparire, senza giunzioni tra piccoli
stroke. Una superficie interna in supersampling viene ridotta esplicitamente
con filtraggio di alta qualità verso il Canvas al DPR nativo. La sola
riduzione CSS accentuava il moiré sui fili più sottili e viene evitata.

Sui viewport verificati il rendering interno passa da 1× a 2× su desktop
e da 3× a 3,75× su mobile, con limite di densità 4× e otto milioni di pixel
per superficie. La superficie è riusata nello stesso RAF e rilasciata
all'uscita. Colori, velocità, duetto e distribuzione nelle pagine conservano
il contratto di [Home](../../product/home.md) e [Relax](../../product/relax-mode.md).

## Distribuzione

- Origine: `https://staging.xynon.it`.
- Worker: `choir-assistant-xynon-staging`; configurazione `wrangler.xynon.jsonc`.
- Versione: `b7439e83-ac2e-45e3-8a09-cd2f0266c8d8`.
- Traffico: 100%; pubblicazione 21 ottobre 2026, 15:00 CEST.
- Tag: `lissajous-smooth-2026-10-21`.
- Artefatto: `artifacts/xynon-lissajous-smooth-release/release`.
- Build: `20261021-125917-6811032c1db7-dirty-lissajous-smooth`.
- File: 1297; 19 brani.
- Renderer: `lissajous.792b95b4e712.js`.
- SHA-256 manifest:
  `c7c16aa3f78c78372657709f80e6498295b8b202bff6c1966fc8796961cc742b`.
- SHA-256 Worker:
  `b99cad71a3a7e5a8ceaeabbefeca7582aebac1e703527c212d23f398b2f2b051`.
- Rollback: `19f4eb39-bb2b-482d-b629-6695d52a6580`.

L'artefatto deriva dall'esatto pacchetto del
[rilascio precedente](2026-10-21-xynon-lissajous.md): cambiano soltanto il
renderer, la versione runtime e i relativi riferimenti HTML fingerprintati.
Worker, musica, audio, autenticazione e tutti gli altri asset restano identici;
le altre modifiche locali non sono incluse. Non si applicano migrazioni o
modifiche ai secret. Pubblicati otto asset nuovi/modificati, senza ricostruire:

```powershell
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/xynon-lissajous-smooth-release/release --tag lissajous-smooth-2026-10-21
```

## Verifica

- Undici test dedicati: stati, tempi, velocità indipendenti, filamenti
  interi, supersampling, budget di pixel, sospensione e cleanup.
- TypeScript, 89 test applicativi e 60 test audio/lifecycle superati.
- Smoke Chromium sull'esatto artefatto: Home in undici viewport, Relax e
  firma compatta su desktop/mobile. Duetto, colori, movimento ridotto,
  visibilità e navigazione superati. Screenshot 1366×768 e 390×844 ispezionati.
- Confronti prima/dopo alle stesse pose e dimensioni conservati in
  `artifacts/lissajous-smooth`. Probe di 90 frame: mediana circa 16,7 ms
  su entrambi i viewport; percentile 95 circa 33,3 ms desktop e 16,8 ms
  mobile emulato. Queste misure non certificano un telefono fisico.
- Manifest, file fingerprintati e assenza di file aggiuntivi verificati;
  dry-run con bundle Worker identico al precedente superato.
- Registro remoto conferma la versione al 100%. Browser con Clerk reale:
  login desktop/mobile senza overflow o errori JavaScript/CSP; accesso,
  registrazione e uscita rispondono 200, la root porta al login. Catalogo,
  spartiti, audio e API restano protetti con 401 da anonimo; cache `no-store`.

La resa autenticata è verificata sulla build con account sintetico locale;
il controllo nel proprio account su staging richiede una sessione Clerk
reale. Evidenze di distribuzione e controlli remoti in
`artifacts/xynon-lissajous-smooth-release`.
