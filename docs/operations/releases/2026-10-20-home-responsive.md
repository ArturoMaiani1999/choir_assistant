# Staging: Home responsive bicolore

**Status:** pubblicato e verificato su staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Contenuto

La [Home](../../product/home.md) separa curva e navigazione, con due colonne
su desktop e firma compatta sopra le azioni su mobile. Due tracciati ciano e
ocra riusano i token della prova; la fase cambia lentamente, senza glow o
scie. Profilo, impostazioni e uscita condividono un disclosure accessibile.
Il comando di uscita viene collegato anche prima del caricamento di un brano.

## Pacchetto pubblicato

- Origine: `https://staging.epistrophe.it`.
- Worker: `choir-assistant-auth-staging`, configurazione `wrangler.jsonc`.
- Build: `20261020-084821-46c4b97f1322-dirty`, 1.293 file e 19 brani.
- Asset congelati e collaudati: `artifacts/home-redesign/dist`.
- Manifest SHA-256:
  `8bb224bfc67bbb49238280d928c2d83573ccad074614bda1df20f5354c204440`.
- Versione Worker: `ef241b24-120b-4d4c-a88a-9ab70f4e0625`, attiva al 100%.
- Deployment: `273ec3e8-bb1e-4e0b-b412-09a81602bc9a`.
- Pubblicazione: 20 ottobre 2026, 11:10 CEST.
- Tag versione: `home-responsive-2026-10-20`.
- Rollback: `88cffe87-d4b9-488c-9c02-0455c1ce5152`.

Il deploy usa `--assets artifacts/home-redesign/dist` senza rigenerare il
pacchetto. Tutti i file corrispondono al manifest. Rispetto al precedente
rilascio cambiano soltanto Home, renderer condiviso, binding dell'uscita e
riferimenti agli asset/versione nelle pagine. I file audio e di calibrazione
coincidono con il rilascio precedente. Il bundle Worker compilato è identico
al precedente, SHA-256
`b99cad71a3a7e5a8ceaeabbefeca7582aebac1e703527c212d23f398b2f2b051`.
Nessuna migrazione o modifica alle autorizzazioni.

## Verifiche

- Configurazione autenticata valida, dry-run Worker e integrità del manifest.
- `npm audit --audit-level=moderate`: zero vulnerabilità.
- TypeScript, 89 test applicativi e 26 test DSP/calibrazione superati.
- Undici viewport Home, inclusi 1366×768, 390×844 e 320×568: nessun clipping,
  overflow, sovrapposizione o scroll iniziale; screenshot ispezionati.
- Navigazione, profilo, impostazioni, logout dalla Home e dalla prova,
  preferenza SATB, partitura e ritorno al beat 16 superati.
- Relax mode, pausa/drag, movimento ridotto e ritorni superati anche sulla
  build fingerprintata effettivamente pubblicata.

Dopo il deploy, `/sign-in` e `/auth/config` restituiscono 200. Il login
pubblicato coincide byte per byte con il pacchetto. Le navigazioni HTML anonime
alla Home e alla prova restituiscono 302 verso il login, conservando il
contesto Santo/tenore. Catalogo, API, nuovi CSS/JS della Home e manifest
restituiscono 401. Tutte queste risposte usano `Cache-Control: no-store`.
Cloudflare conferma la versione al 100%. Evidenze in
`artifacts/home-redesign/post-deploy.json`.

Login Clerk interattivo con account reale e comportamento delle safe area e
della barra dinamica su dispositivi fisici non ripetuti; autorizzazione
simulata soltanto nei fixture locali.
