# Xynon: menù compatto e repertorio essenziale

**Status:** pubblicato su staging Xynon
**Owner:** project maintainer
**Last reviewed:** 2026-10-21

## Risultato

Le modalità iniziali diventano **Scegli brano**, **Mostra partiture** ed
**Esercizi vocali**. Su mobile i pulsanti sono più compatti e la Lissajous
conserva dimensioni, posizione e tempo tra Home, provenienza e catalogo.
La provenienza non ripete titolo e sottotitolo. Il controllo **Menù** è
condiviso e torna direttamente alle modalità iniziali.

Il repertorio mostra **Brani assegnati**, parte vocale e progressi, seguiti
da righe di brani. Non mostra saluti, titoli ridondanti o firma animata.
**Scelta brani** apre direttamente la provenienza attraverso `?menu=sing`;
gli asset del brano vengono preparati entrando nel catalogo.

## Distribuzione

- Origine: `https://staging.xynon.it`.
- Configurazione: `wrangler.xynon.jsonc`.
- Worker: `choir-assistant-xynon-staging`.
- Versione: `9b8dca73-a7ae-4086-8ae3-587c2b0d3900`; traffico 100%.
- Pubblicazione: 21 ottobre 2026, 16:40 CEST.
- Tag: `navigation-polish-2026-10-21`.
- Artefatto: `artifacts/xynon-navigation-release/release`.
- Build: `20261021-141544-6811032c1db7-dirty`.
- File: 1298; 19 brani.
- SHA-256 manifest:
  `4716a3627f3fe2f5e1b7871c9a9e7139b186946df8c9ff6da26254b4df72d913`.
- SHA-256 Worker:
  `b99cad71a3a7e5a8ceaeabbefeca7582aebac1e703527c212d23f398b2f2b051`.
- Rollback: `b7439e83-ac2e-45e3-8a09-cd2f0266c8d8`.

Il pacchetto è una copia congelata della build già verificata. Il confronto
integrale con il [rilascio precedente](2026-10-21-xynon-lissajous-smooth.md)
conferma soltanto le modifiche a navigazione, repertorio e relativi riferimenti
fingerprintati. Worker, audio, musica, autenticazione e gli altri asset sono
identici. Non sono state applicate migrazioni o modifiche ai secret.

```powershell
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/xynon-navigation-release/release --tag navigation-polish-2026-10-21
```

## Verifica

- TypeScript, 89 test applicativi e 60 test audio/calibrazione superati.
- Smoke Home su undici viewport, inclusi desktop 1366×768, mobile 390×844,
  320×568 e landscape 844×390. Dimensioni, coordinate e pixel della scena
  in pausa restano invariati tra i passi. Verificati focus, movimento ridotto,
  animazione e duetto anche sull'esatta build fingerprintata.
- Smoke navigazione: scelta diretta dal repertorio, prova/ritorno, SATB,
  conservazione battuta, uscita e rilascio microfono. Repertori vuoti e popolati
  verificati a 320, 360, 390, 430, 768 e 1366 px.
- Smoke firma compatta e istruzioni vocali superati. Screenshot delle
  superfici cambiate ispezionati a 1366×768 e 390×844.
- Manifest e nomi fingerprintati verificati; dry-run con Worker identico
  alla versione precedente. Pubblicati 15 asset nuovi/modificati.
- Registro remoto conferma la versione al 100%. Il controllo Chromium con
  Clerk reale verifica login desktop/mobile, assenza di errori JavaScript/CSP
  e overflow, accesso/registrazione/uscita, redirect della root e protezione
  anonima di catalogo, spartiti, audio e API.

I flussi autenticati sono stati verificati con account sintetici locali;
il controllo completo con codice email richiede una sessione reale di un
corista. Evidenze di distribuzione e controlli remoti in
`artifacts/xynon-navigation-release`.
