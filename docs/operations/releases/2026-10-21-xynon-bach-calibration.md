# Xynon: archi di Bach nella calibrazione

**Status:** pubblicato su staging Xynon  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Risultato

La calibrazione iniziale con altoparlanti riproduce due passaggi di archi
del Preludio in Do maggiore BWV 846 di Bach, al posto dei fruscii. Le prime
due battute sono ricreate in MuseScore 4 con MuseScore Basic, a 120 BPM.
Partitura modificabile e MusicXML: `misc/audio-calibration/`; export mono
PCM16 a 48 kHz e licenza/attribuzioni: `frontend/audio-calibration/`.

Ogni passaggio dura 2 s, con una pausa di 1 s; il controllo acustico conserva
8 s e l'intera guida circa 30 s. Energia media equivalente al rumore precedente,
picchi controllati, dissolvenze di 35 ms. Soglie del residuo e detector vocale
invariate. I buffer sono caricati e validati prima della cattura; gli errori
interrompono la preparazione senza suoni e liberano il microfono.

Il profilo salvato continua a riattivarsi senza nuova guida. Per ascoltare
volontariamente il nuovo segnale: **Base → Rivedi calibrazione → Ricalibra**.
La catena custom tecnica usa ancora il suo rumore: il cambiamento riguarda
il controllo AEC nativo. Vedi [proprietà e limiti](../../engineering/pitch-tracking/musical-calibration-probes.md).

## Pacchetto isolato

- Origine: `https://staging.xynon.it`.
- Versione: `6b7091bb-5a31-4161-a7a1-f2cd9a616ccf`, 100% del traffico.
- Configurazione: `wrangler.xynon.jsonc`.
- Artefatto: `artifacts/musical-calibration/release-isolated`.
- Build: `20261021-160612-6811032c1db7-dirty-bach-strings`.
- File: 1303; 19 brani.
- Manifest SHA-256: `2f061999ebd699b888ca268a3d6053422588498be23d4a46c4d2b379ed849c94`.
- Worker SHA-256: `9b6dd067fb5b2e9339732bdd5b2156ae1438d306a108df93ab135fc9437ed4bd`.
- Versione precedente per rollback: `d45a274d-1d51-40a6-b9eb-e63b073f9a50`.

Il pacchetto parte dall'esatta release precedente e contiene soltanto
caricatore/buffer musicali, istruzioni, link ai crediti e riferimenti
fingerprintati. Sono esclusi gli altri lavori locali su app, metronomo,
piano roll e stile dei risultati. Il Worker è identico alla release precedente;
non cambiano D1, R2, credenziali o dati dei cantanti. La ricetta ripetibile
`artifacts/musical-calibration/prepare_release.py` verifica gli hash di base
e copia soltanto i moduli della modifica. Il manifest finale non contiene
file aggiuntivi non dichiarati.

```powershell
npx wrangler deploy --config wrangler.xynon.jsonc --assets artifacts/musical-calibration/release-isolated --tag bach-calibration-2026-10-21
```

## Verifiche

- TypeScript, 95 test applicativi e 64 test DSP/lifecycle superati.
- 14 test della build, incluse risorse audio fingerprintate, superati.
- PCM effettivo: durata, energia, picchi ed estremi nulli verificati. Il gate
  conserva passaggio/rifiuto per residuo sintetico basso/forte, sia con musica
  sia con rumore e ritardo acustico sintetico.
- Decoder: rifiuto dei dati errati, cache, retry e caricamento indisponibile
  prima della cattura verificati.
- Smoke Chromium dell'esatto pacchetto: i due AudioBufferSource sono di 2 s,
  inizi distanti 3 s e RMS previsto. Guida, risultati, Play, riuso, ricarica,
  isolamento account/microfono e interruzioni superati.
- Smoke generale superato sul pacchetto isolato con il valore di metronomo
  della release pubblicata, 50 ms. Lo smoke corrente dell'altra sessione
  aspetta 160 ms: il wrapper locale modifica soltanto questa aspettativa,
  conservando tutte le altre asserzioni. Non si distribuisce quel cambiamento.
- Screenshot della guida a 1366×768 e 390×844 ispezionati senza clipping
  o scroll nel flusso iniziale; partitura MuseScore ispezionata.
- Configurazione, audit del manifest e dry-run Wrangler superati.
- Deploy completato: 13 asset nuovi/modificati. Registro remoto conferma
  la versione indicata al 100% del traffico.
- Accesso Clerk remoto verificato a 1366×768 e 390×844 senza overflow o
  errori JavaScript/CSP. Catalogo, API e i due nuovi WAV rispondono 401
  da anonimo. Il modulo di registrazione è risultato intermittentemente
  fermo su caricamento nello smoke remoto; i file di autenticazione sono
  identici alla release precedente e non fanno parte di questo intervento.
  La ripetizione finale dello smoke completo è passata, inclusa registrazione,
  pagine di accesso/uscita 200 e protezione 401 di spartiti, audio e API.

Il Samsung non era collegato: manca il confronto acustico reale fra musica
e rumore sul dispositivo. I test sintetici e del browser non certificano
l'adattamento interno dell'AEC del telefono. Evidenze, spettro, log di export,
partitura renderizzata e report browser in `artifacts/musical-calibration/`.
