# Xynon: audio e calibrazione per la demo

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Flusso

In **Impostazioni → Base** si sceglie **Cuffie / Altoparlanti**, poi si preme
**Calibra audio** e **Avvia controllo**. La guida comprende microfono, voce
e verifica del rientro quando si usano gli altoparlanti. La regolazione si
applica automaticamente; dopo **Fatto** si può iniziare il brano.

Connessione audio, assistenza e aspetto dello spartito sono espandibili.
Cavo/dispositivo è predefinito: non viene richiesta una conferma prima di
Play. Chi usa cuffie o casse Bluetooth lo seleziona in **Connessione audio**;
la preferenza dura per la scheda e non scade durante la prova. Il browser
non rileva o seleziona automaticamente l'uscita del sistema operativo.

Il profilo vocale salvato è distinto dalla verifica dell'ingresso live.
Dopo lo stop non si mostra una verifica ancora attiva sul vecchio microfono:
alla riapertura il profilo compatibile passa il controllo breve in silenzio.
Un controllo fallito richiede la guida completa. Questo corregge anche la
ripetizione superflua della guida con cuffie.

## Pacchetto

Il maintainer ha autorizzato la pubblicazione dello stato corrente completo,
incluse le modifiche esistenti a marchio, Home e firma ambientale. La build
comprende AEC nativo, selezione armonica e conservazione del gate originale
già documentati nel [rilascio audio](2026-10-21-native-aec-live.md).

- Origine: `https://staging.xynon.it`.
- Configurazione: `wrangler.xynon.jsonc`.
- Worker: `choir-assistant-xynon-staging`.
- Versione pubblicata: `60de8556-ad4d-447a-9741-7553595c0062`, 100% del traffico.
- Artefatto congelato: `artifacts/xynon-audio-mvp/release-final`.
- Build: `20261021-094924-6811032c1db7-dirty`.
- File: 1297, senza aggiunte o variazioni rispetto al manifest.
- SHA-256 manifest: `4f4918edfa77cf0c3d62b9fc815c425db7d429c6507fdd105c699d24973d22a1`.
- SHA-256 Worker: `b99cad71a3a7e5a8ceaeabbefeca7582aebac1e703527c212d23f398b2f2b051`.
- Versione precedente per rollback: `a7d0f6d0-7575-4db5-9e72-a3eb95b88952`.

Distribuzione dell'esatto artefatto verificato, senza ricostruzione:

```powershell
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/xynon-audio-mvp/release-final
```

Il rilascio usa D1, R2 e Clerk dedicati a Xynon. Non trasferisce sessioni,
profili locali, registrazioni o progressi dall'origine Epistrophe.

## Verifiche

- TypeScript, 89 test API e 60 test DSP/lifecycle passati.
- 14 test build e 7 test configurazione deploy passati.
- Documentazione e integrità di tutti gli asset verificate.
- Smoke Chromium della build finale: riproduzione, mixer, trasposizione,
  pitch Worker, allineamento, analisi, navigazione e lettore partiture passati.
- Calibrazione con altoparlanti: guida, verifica breve indipendente,
  riapertura Base, interruzione del contesto, Play sulla stessa catena,
  annullamento, cambio dispositivo e permesso tardivo passati.
- Calibrazione con cuffie: guida, riuso del profilo con verifica breve
  indipendente, Play, annullamento e lifecycle passati. La chiusura
  dell'ingresso non conserva una verifica live; non si ripete la guida vocale.
- Home della build finale: calibrazione prima del brano, profilo e ingresso
  conservati entrando nel brano, Play senza seconda guida e riapertura Base
  passati.
- Home, firma ambientale, movimento ridotto e navigazione verificati sulla
  prima build della stessa modifica UI. Screenshot di Base e guida a
  1366×768 e 390×844 ispezionati senza clipping o scroll nel flusso iniziale.
- Dry-run sulla configurazione Xynon passato; binding dedicati confermati.
- Deploy completato: 20 asset nuovi/modificati. Registro deploy conferma
  la versione indicata al 100%.
- Smoke remoto con Clerk reale passato a 1366×768 e 390×844, senza overflow
  né errori JavaScript/CSP. Login, registrazione e uscita rispondono 200;
  la root porta al login. Catalogo, bundle, SVG, MP3 e API anonimi rispondono
  401. HTML di accesso identico al pacchetto, con cache `no-store`.

Le prove browser audio usano ingresso sintetico e permesso fittizio locale;
non misurano l'attenuazione acustica di un nuovo dispositivo. Le evidenze
reali del S25+ restano quelle del rilascio audio precedente. La verifica
autenticata sul nuovo dominio richiede il login con l'email autorizzata.

Evidenze locali: `artifacts/xynon-audio-mvp/`.
