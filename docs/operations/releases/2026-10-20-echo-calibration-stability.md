# Calibrazione: disponibilità analisi e ritardo instabile

**Status:** deployed  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

Distribuito su `staging.epistrophe.it` con `wrangler.jsonc`.

- Versione Worker: `893c056f-b5ad-4f1d-8153-1a97885dfbc3`.
- Build: `20261020-175948-6811032c1db7-dirty`.
- Versione precedente: `ea423848-4d39-4947-a40e-1aed025bcbcd`.
- Pacchetto: `artifacts/echo-calibration-stability/release`, 1295 file.
- SHA-256 manifest:
  `6490db0b6571f815f6b9a78c63191a0d7537bbe1e3f74dbf805e3d629a3f9693`.
- SHA-256 bundle Worker, invariato:
  `b99cad71a3a7e5a8ceaeabbefeca7582aebac1e703527c212d23f398b2f2b051`.

La guida prepara l'analisi vocale prima dei suoni, limita le attese e ripete
una sola misura acustica se il training contiene un cambio confermato di
ritardo. Il filtro rifiutato non viene applicato. Dettagli e verifiche:
[studio del candidato](../../engineering/pitch-tracking/echo-calibration-stability-2026-10-20.md).

Il confronto dei manifest limita le variazioni agli asset audio interessati,
ai loro import fingerprintati e ai riferimenti/versione delle pagine.
Home e altri moduli applicativi conservano gli hash precedenti.
Typecheck, test API/DSP, lifecycle, packaging e browser superati.
Controllati screenshot 1366×768 e 390×844.

Dopo il deploy: sign-in e configurazione pubblica 200; navigazione HTML
anonima 302 al login con brano/parte conservati; richieste anonime API,
modulo vocale e pratica senza Accept HTML 401. Tutte con `no-store`.
Report in `artifacts/echo-calibration-stability/post-deploy.json`.

La prima misura reale completa il fit acustico, ma il riuso vocale viene
rifiutato: nessun holdout live acquisito. Risultati e limiti nello studio.
Il follower live resta limitato a ±20 ms.

## Ingresso diagnostico acustico

Secondo rilascio: versione `533dcbe4-a7bb-4e00-94cf-9b1cca73f922`,
build `20261020-181027-6811032c1db7-dirty`, pacchetto
`artifacts/echo-calibration-stability/release-acoustic-probe`.
SHA-256 manifest:
`3f0c3de5ce6efbcb49b4093f0752ae2aedf17ee34df4268b311a286582a9f19d`.
Rollback alla versione `893c056f-b5ad-4f1d-8153-1a97885dfbc3`.

Aggiunge l'ingresso tecnico `measureAcoustic`, senza nuovo pulsante e senza
verifica o salvataggio del profilo vocale. Il probe può misurare il residuo
subito dopo il fit acustico. Collaudo browser: quattro canali da 480.000
campioni, nessun errore, nessun profilo vocale verificato. Typecheck passato.
Il confronto manifest cambia soltanto il modulo guida e riferimenti/versione
delle pagine. Controlli post-deploy 200/302/401 e `no-store` superati.
Nuova prova reale in attesa della disponibilità dell'utente.
