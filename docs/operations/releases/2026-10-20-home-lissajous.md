# Staging: Home con Lissajous

**Status:** pubblicato e verificato su staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Contenuto

Home a schermo intero, nero e curva di Lissajous condivisa con Relax mode.
Tre soli comandi centrali, profilo in alto a destra e impostazioni sotto.
Velocità dimezzata, scia di venti secondi reali. Al primo ingresso nel browser
la curva parte dal centro; dopo un secondo compaiono i comandi. La scelta
locale evita l'attesa nei ritorni e nelle successive aperture. Con movimento
ridotto il menù appare immediatamente e la curva è ferma.

## Candidato

- Worker: `choir-assistant-auth-staging`, configurazione `wrangler.jsonc`.
- Build: `20261019-231228-46c4b97f1322-dirty`, 1.293 file, 19 brani.
- Versione Worker: `34ebe62d-8840-4150-a91c-c50aa8e380cb`, attiva al 100%.
- Tag: `home-lissajous-2026-10-20`.
- SHA-256 del manifest:
  `a06fefac000cf7d0564ceda8326fefd63dd921367d457416b1d7ac0408e2415e`.
- Asset isolati: `artifacts/home-release/final`, verificati prima del deploy;
  il comando usa `--assets` per pubblicare esattamente questa copia.
- Nessuna migrazione o modifica alle autorizzazioni.
- Rollback: `18768e58-cbb3-4dbe-b543-784d5d283fed`.

## Verifiche

Typecheck, 89 test applicativi, 12 test della build, documentazione e audit
dipendenze senza vulnerabilità. Navigazione desktop/mobile: catalogo, parte
SATB, profilo, partitura, analisi, uscita e rilascio microfono.
Gli screenshot a 1366×768 e 390×844 sono in `artifacts/relax-mode` e
`artifacts/navigation-fixes` e sono stati ispezionati.

Lo smoke specifico controlla primo ingresso, riapertura immediata, pausa,
impostazioni da Home, focus dopo chiusura, movimento ridotto, scia di venti
secondi, rotazione e ritorno alla battuta 16 anche dopo ricarica. Il server
locale ora supporta le richieste byte range MP3 come gli asset distribuiti,
evitando falsi fallimenti sul seek. I dati di autenticazione restano sintetici
soltanto nel test locale. Login reale non ripetuto.
