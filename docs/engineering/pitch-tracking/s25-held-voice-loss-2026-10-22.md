# S25+: voce tenuta azzerata durante la base

**Status:** reproduced on device; root narrowed to AEC-enabled capture, fix not validated  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-22

## Risultato

La scomparsa della nota segnalata su **Chi ci separerà**, tenore P3, è
riprodotta sul Samsung S25+ in Chrome, build
`20261022-074839-9cf44a36476d-dirty` di `staging.xynon.it`.
Durante il canto dichiarato continuo dall'utente, l'ingresso dopo AEC
diventa quasi interamente zero digitale quando entra la base. Il detector
riceve già questo segnale: abbassare le soglie non recupera la voce.

Con AEC disattivato il canto resta nel segnale, anche con la base. La
modalità `all` è promettente in una cattura separata ma non è ancora una
soluzione convalidata nel grafo dell'app. Nessuna modifica della catena
pubblicata, del profilo o delle soglie deriva da queste prove.

## Protocollo e provenienza

- Collegamento ADB/CDP autorizzato, solo scheda Xynon; una cattura microfonica
  per volta. Volume Android invariato a **8/15**, master dell'app 62%,
  metronomo 30%. Nessuna modifica dei livelli persistenti.
- Un pulsante manuale **Sono pronto**, 12 s di preparazione, una sola
  vocale continua per 12 s, STOP e 3 s finali. La prima prova è annotata
  dall'utente: nessuna pausa o respiro durante la base.
- Uscita silenziata sul bus finale fino a 15 s, attiva fra 15 e 21 s,
  quindi silenziata. Rampe di 10 ms; riferimento digitale acquisito dopo
  il guadagno del bus. La voce è richiesta fra 12 e 24 s.
- Il Worklet esistente acquisisce il microfono e il riferimento sullo
  stesso clock di campionamento: **27 s, 1.296.000 campioni a 48 kHz**
  per ciascuna delle tre prove complete. Nessun forward gap o evento
  mute/unmute/ended durante le catture complete.
- NS, AGC e voiceIsolation risultano false in tutte le condizioni;
  echoCancellation risulta rispettivamente true, false, `all`.
- La prima cattura riusa il vero ingresso e il ciclo pitch dell'app. Le
  altre due usano acquisizione dedicata nello stesso contesto del mixer,
  senza avviare il ciclo live o aggiornare la calibrazione dell'app.
- PCM e metadati restano sul PC in `artifacts/held-voice-2026-10-22/`.
  Nessun upload, best, tentativo o registrazione cloud. Alla fine microfono
  idle, Play fermo, gain del riferimento 1 e mute di calibrazione false.

La guida temporanea riusa stile e controlli della calibrazione. Smoke e
screenshot a 1366×768 e 390×844: nessun clipping/scroll iniziale, focus e
target di chiusura da 44 px. Non è un nuovo flusso pubblicato nell'app.

## Misure

La finestra centrale è **15,5–20,8 s**, lontana dall'attacco programmato
della base. La prima colonna misura blocchi PCM non sovrapposti da 10 ms
composti esclusivamente da zeri. L'ultima conta stime F0 dirette: non è una
recall certificata e le frequenze di osservazione sono diverse fra prove.

| Condizione | Blocchi zero / 530 | RMS mediano ingresso | F0 diretto presente |
| --- | --- | --- | --- |
| AEC normale, grafo app | 522 / 530 (98,5%) | 0 | 0 / 332 |
| AEC disattivato, acquisizione dedicata | 0 / 530 | 0,0873 | 82 / 82 |
| AEC `all`, acquisizione dedicata | 10 / 530 (1,9%) | 0,0947 | 81 / 83 |

Nella prima prova, prima della base, RMS mediano 0,1373 e F0 diretto
156/156, mediana 245,49 Hz. Dopo la base, F0 144/144 con mediana 248 Hz,
ma RMS mediano sceso a 0,00189. Il live segue la perdita: 155/156 finestre
prima, nessuna durante, 140/144 dopo. Timer e Worker continuano a elaborare.

L'azzeramento non autorizza un valore finito arbitrario di attenuazione:
il report usa `medianDbFS:null` quando la mediana è zero. Non si calcola ERLE,
non essendoci una coppia pre/post AEC simultanea.

## Limiti del confronto

Le prove sono successive e il brano continua a essere riprodotto dai decoder
reali. Gli estratti del riferimento non sono identici: correlazione massima
normalizzata dopo passa basso 400 Hz circa 0,36 fra normale/raw e 0,51 fra
normale/`all`, con offset non nullo. Non attribuire tutte le differenze alla
sola stringa `all`. Cambia inoltre il grafo fra la cattura integrata e le
due catture dedicate; non è stata verificata l'identità dell'ingresso fisico
attraverso le diverse modalità. I livelli vocali non sono un riferimento
calibrato e possono variare fra prove.

Un quarto esperimento tenta true → `all` → true sullo stesso track e grafo,
con base già attiva prima della vocale. Chrome rifiuta `applyConstraints`
con **Cannot satisfy constraints** al primo cambio. Rimangono 770.048
campioni di prefisso, conservati in `switch/`, ma il confronto è incompleto
ed escluso. La semplice presenza di `all` nelle capabilities non garantisce
la riconfigurazione di un track esistente.

La localizzazione affidabile è il **percorso di acquisizione con AEC attivo**.
Non è ancora identificato il responsabile interno fra cancellatore,
soppressore residuo, effetti del dispositivo e integrazione del grafo.
La documentazione Android conferma che il preprocessing dipende dalla
sorgente e dal dispositivo; i settings web non espongono ogni dettaglio:
[Android AEC](https://developer.android.com/reference/android/media/audiofx/AcousticEchoCanceler),
[configurazione preprocessing](https://source.android.com/docs/core/audio/implement-pre-processing).
Il [codice Chromium](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/mediastream/media_stream_audio_processing_layout.cc)
distingue gli effetti di piattaforma dal processing WebRTC; non permette
da solo di sapere quale componente abbia azzerato questa registrazione.

## Direzione successiva

**Seguito nel grafo reale:** la [prova URL all](../../operations/releases/2026-10-22-xynon-aec-all-trial.md)
è stata implementata e pubblicata come opt-in. Guida reale riuscita, cattura
`all` confermata e vecchi profili conservati. La successiva ripetizione
guidata di nota continua perde comunque il segnale dopo circa 2,15 s:
da 3 s alla pausa tutte le 212 osservazioni di livello sono zero digitale,
con timer funzionante e track non muted. Non promuovere `all` a default.
Il miglioramento dell'acquisizione dedicata non si trasferisce automaticamente
al grafo dell'app; resta prioritario controllare grafo, estratto e ordine.

Il reset periodico proposto non è una correzione validata: l'API web espone
vincoli di cattura, non un reset o il controllo dell'apprendimento del filtro
interno. Riaprire la cattura può introdurre buchi e perdere l'adattamento del
cancellatore. La stazionarietà della nota è un'ipotesi utile, ma queste prove
non identificano il blocco interno responsabile. La distinzione tra filtro
adattivo e soppressione residua è visibile nel
[codice AEC3](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/aec3/echo_remover.cc);
i controlli web sono definiti nella
[specifica Media Capture](https://www.w3.org/TR/mediacapture-streams/).

1. Confrontare true e `all` in acquisizioni nuove ma con **stesso grafo,
   identico estratto PCM e stessa sequenza di voce/base**. Non contare il
   quarto esperimento come una conferma. Includere un ritorno alla baseline
   per controllare adattamento, ordine e ripetibilità.
2. Verificare separatamente la conservazione di note tenute e l'eco in
   silenzio prima di adottare un percorso alternativo. Un miglioramento
   della voce che reintroduce il pitch della base non basta.
3. Includere il double talk nel controllo di qualità della calibrazione:
   oggi rumore senza canto e vocali senza base possono passare separatamente
   e non rilevare questa regressione. Conservare una sola routine guidata.
4. Se i percorsi esposti dal browser sopprimono il canto, usare ingresso
   non processato e un cancellatore controllabile, validando allineamento
   e preservazione della voce prima della soppressione residua. Non sommare
   tale cancellatore a un ingresso già azzerato dall'AEC.

Non disattivare automaticamente l'AEC in produzione: la prova raw non misura
la qualità di cancellazione e può reintrodurre i falsi positivi precedenti.
Non mantenere una nota disegnata durante il buco: inventerebbe continuità
anche durante respiri e vere pause. La calibrazione non ricostruisce campioni
che non arrivano più al detector.

Evidenze: `result.json`, `capture.npz`, `analysis.json`, cartelle `raw/`,
`all/`, `switch/`, `cleanup.json`, `reference-comparison.json` e grafici
`held-voice.png` / `comparison.png`. Script del protocollo e dell'analisi nella
stessa cartella di artefatti; nessun PCM utente inserito nei sorgenti.
