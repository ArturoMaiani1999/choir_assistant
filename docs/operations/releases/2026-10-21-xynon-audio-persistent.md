# Xynon: profilo vocale ricordato e riferimento volume 50%

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Comportamento

La prima guida altoparlanti indica **Imposta il volume del dispositivo al 50%**,
con istruzione di usare i tasti del telefono/computer. La prova mostra un
promemoria discreto dello stesso livello vicino ai controlli di Play. Il 50%
è consigliato, non letto o verificato dalla webapp. Mixer e metronomo restano
regolabili e non fanno ripartire la calibrazione.

Il profilo vocale compatibile si conserva senza scadenza per calendario,
isolato per account, browser e catena del microfono. Alla riapertura Play
acquisisce l'ingresso, verifica i settings effettivi e applica il profilo della
catena acquisita. L'AEC nativo torna operativo senza una guida, fruscii o
verifiche in silenzio obbligatorie. Base mostra **Profilo voce salvato** e
**Rivedi calibrazione**; **Ricalibra** è volontario.

`operational` del percorso nativo verifica account, track live, contesto e
AEC true/NS false/AGC false. È separato da `ready`/`calibrationVerified`:
il ripristino non finge una nuova misura del residuo e non mostra nuove
percentuali o dB. La diagnostica conserva questa distinzione. Un profilo
diverso per account, microfono, catena, detector o preferenze non si riusa.
Il percorso custom tecnico mantiene la sua misura esplicita.

## Artefatto

- Destinazione: `https://staging.xynon.it`.
- Versione pubblicata: `d45a274d-1d51-40a6-b9eb-e63b073f9a50`, 100% del traffico.
- Configurazione: `wrangler.xynon.jsonc`.
- Artefatto congelato: `artifacts/xynon-audio-persistent/release`.
- Build: `20261021-153305-6811032c1db7-dirty`.
- File: 1298, 19 brani; tutti gli hash corrispondono al manifest.
- SHA-256 manifest: `1802cebe2bc7730711981e82ff3e7d513c3559d79316e264da91f7adb49b02a6`.
- SHA-256 Worker: `9b6dd067fb5b2e9339732bdd5b2156ae1438d306a108df93ab135fc9437ed4bd`.
- Versione precedente per rollback: `0ee35f73-a318-44b3-9bb8-721fe7b5b102`.

Il confronto con la release repertorio precedente conferma modifiche soltanto
all'app, ai moduli di calibrazione/AEC, al CSS della prova, al markup della
guida e ai riferimenti fingerprintati/runtime. Musica, pagine del repertorio,
navigazione e Worker hanno gli stessi contenuti del rilascio precedente.
Non servono migrazioni, importazioni utenti o variazioni dei secret.

```powershell
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/xynon-audio-persistent/release --tag audio-persistent-2026-10-21
```

## Verifiche

- TypeScript, 95 test applicativi e 61 test DSP/lifecycle superati.
- Test specifici: profilo vecchio di un anno ancora valido, isolamento per
  account/catena/versione, route operativa senza falsa misura acustica,
  track terminata, account differente e settings effettivi incompatibili.
- Smoke Chromium della build: prima guida, riapertura Base, riuso dopo stop,
  profilo invecchiato di un anno, cambio livelli base/metronomo, ricarica
  completa e Play senza nuova guida superati con altoparlanti.
- Un altro microfono e un altro account non riusano il profilo; tornando
  all'ingresso/account originali il profilo resta disponibile.
- Annullo, background, cambio dispositivo, permesso tardivo, Escape,
  backdrop e ritorno focus superati.
- Con cuffie: prima guida, riuso senza scadenza, ricarica e Play senza guida,
  variazioni dei livelli e lifecycle superati. Da Home: prima guida e passaggio
  al brano sulla stessa catena, senza seconda richiesta, superati.
- Smoke generale della build: Worker pitch, mixer, trasposizione, analisi,
  navigazione e lettore partiture superati senza errori o richieste esterne.
- Screenshot di Base, guida, risultati e prova a 1366×768 e 390×844
  ispezionati; flusso principale senza clipping o scroll del dialogo.
- Validazione configurazione, audit manifest e dry-run Wrangler superati.
- Deploy completato: 11 asset nuovi/modificati. Registro remoto conferma
  la versione indicata al 100%. HTML di accesso identico al pacchetto,
  con cache `no-store`.
- Smoke remoto con Clerk reale: accesso desktop/mobile e registrazione
  disponibili senza errori JavaScript/CSP o overflow. Root verso login,
  pagine di accesso/uscita 200; catalogo, bundle, SVG, MP3 e API anonimi 401.

Le prove audio del browser usano un segnale sintetico e verificano flusso,
persistenza e lifecycle. Non certificano la cancellazione acustica dopo
variazioni del volume fisico: la conferma sul Samsung resta una prova reale.
Evidenze in `artifacts/xynon-audio-persistent/`.
