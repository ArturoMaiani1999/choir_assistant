# Core live della pitch detection

**Stato:** descrizione canonica del runtime  
**Owner:** project maintainer  
**Ultima verifica sul codice:** 2026-10-17

Questo documento descrive il percorso che produce il pitch usato durante la
prova. Non descrive gli algoritmi offline del benchmark. Nel live di produzione
lo stimatore è **YIN-style v1**; CREPE/ONNX è soltanto diagnostico e non entra
né nel tracking né nel punteggio.

```text
microfono -> frame PCM -> gate RMS -> YIN/CMND -> gate qualità
           -> continuità + mediana + EMA -> TrackedPitch -> scoring
                                           |
                                           +-> One Euro -> DisplayPitch
```

## 1. Acquisizione

[`toggleMicrophone()`](../../../frontend/app.js) richiede una traccia mono con:

- `echoCancellation: false`;
- `noiseSuppression: false`;
- `autoGainControl: true`;
- `channelCount: 1`.

Il browser può non rispettare integralmente questi vincoli. Il segnale entra in
un `AnalyserNode` con `fftSize = 2048` e `smoothingTimeConstant = 0`. Ogni frame
contiene quindi gli ultimi 2048 campioni: circa 46,4 ms a 44,1 kHz o 42,7 ms a
48 kHz. L'app non applica high-pass, compressione, finestra, resampling o
denoise propri prima del detector.

Il loop tenta una lettura ogni `1000/60 ms`. Esiste però un solo job YIN in
volo: se il worker è ancora occupato, il tick successivo viene saltato. La
cadenza reale è quindi **al massimo 60 frame/s** e dipende dal dispositivo. Se
il Web Worker non è disponibile, lo stesso calcolo viene eseguito sul main
thread.

## 2. Stima F0 per frame

[`detectPitch()`](../../../frontend/pitch_detector.js) esegue, nell'ordine:

1. Calcola l'RMS sul frame. Se `RMS < rmsThreshold`, restituisce `hz = null`.
2. Sottrae la media del frame, eliminando la componente continua.
3. Per ogni ritardo `tau` calcola la squared difference di YIN e poi la
   cumulative mean normalized difference, o **CMND**.
4. Cerca il **primo** `tau` nel range 70–1000 Hz con
   `CMND(tau) < yinThreshold`; prosegue fino al minimo locale discendente.
   Se non lo trova, il frame è unvoiced. Non sceglie il minimo globale.
5. Raffina `tau` con interpolazione parabolica e calcola `Hz = sampleRate/tau`.
   Una stima fuori da 70–1000 Hz è scartata.
6. Produce:
   `clarity = 1 - CMND(tau)` e
   `confidence = clarity * max(levelFloor, clamp(RMS / 0.08, 0, 1))`.

Preset correnti definiti in
[`pitch_shared.js`](../../../frontend/pitch_shared.js):

| Parametro | Normale | Voce debole |
|---|---:|---:|
| RMS predefinito | 0,000002 | min(soglia scelta, 0,00003) |
| `yinThreshold` | 0,42 | 0,68 |
| `minClarity` | 0,45 | 0,32 |
| `minConfidence` | 0,30 | 0,10 |
| floor del livello nella confidence | 0,36 automatico | 0,68 |

Il controllo RMS non è dunque l'unico gate di una voce debole. In modalità
normale, quando il moltiplicatore resta sul floor 0,36, serve
`clarity >= 0,30/0,36 = 0,833` per superare anche la confidence. Una voce può
quindi essere ben sopra la soglia RMS ma risultare ancora non affidabile.

## 3. Tracking causale

[`PitchSmoother.update()`](../../../frontend/pitch_detector.js) accetta il raw
pitch soltanto se `hz` esiste e supera entrambi i gate di clarity e confidence.
Poi applica queste regole, senza consultare la nota della partitura:

- avvio: almeno 3 frame affidabili e coerenti entro 100 cent (220 cent in
  modalità voce debole);
- pitch già agganciato, spostamento fino a 300 cent: mediana degli ultimi 3
  pitch in semitoni, poi EMA; gli alpha correnti sono 0,65 sia fast sia slow;
- salto oltre 300 cent: 3 candidati coerenti prima della conferma;
- salto d'ottava, cioè 1200 ± 180 cent: 5 candidati coerenti;
- frame non affidabile, modalità normale: output subito non accettato; lo
  stato interno viene rilasciato dopo 3 frame, ma `TrackedPitch` ha già un gap;
- frame non affidabile, modalità voce debole: mantiene l'ultimo pitch fino a 6
  frame con motivo `weak-signal-held`.

I salti in verifica hanno motivo `large-jump-transition` o
`octave-transition`: il raw può essere mostrato come provvisorio, ma non entra
nello scoring. I valori confermati sono convertiti in MIDI frazionario con
`69 + 12 * log2(Hz / 440)`.

## 4. Display e scoring

`TrackedPitch` è l'unico dato consumato dallo scoring. `DisplayPitch` passa
anche da un One Euro filter, definito in
[`one_euro_filter.js`](../../../frontend/one_euro_filter.js), che riguarda solo
la resa grafica. Il target MusicXML non corregge e non forza mai la stima.

Durante una prova viene conteggiato soltanto il tempo in cui:

- playback e tentativo sono attivi;
- esiste una nota target e il suo `attackGraceBeats` è terminato;
- `TrackedPitch` è presente.

Il frame è intonato se dista al massimo ±30 cent dal target trasposto. Silenzio
e frame incerti sono esclusi dal denominatore: molti falsi negativi possono
quindi accorciare la quantità di voce valutata senza abbassare direttamente la
percentuale di intonazione.

## Punti da attenzionare nei falsi negativi, anche cantando vicino

1. **Saturazione e AGC.** Troppa vicinanza, soprattutto su vocali forti,
   plosive e bassi, può causare clipping o pumping dell'AGC. L'RMS è alto, ma la
   periodicità si degrada: YIN non trova un minimo o clarity/confidence falliscono.
2. **Gate di confidence nascosto dietro un RMS molto permissivo.** Con il preset
   normale una voce debole o soffiata supera facilmente RMS = 0,000002, ma deve
   avere una clarity molto alta quando `RMS/0,08` è basso. Guardare sempre RMS,
   clarity e confidence insieme.
3. **Note corte e attacchi.** Servono 3 osservazioni coerenti all'avvio; ne
   servono 3 per un salto grande e 5 per un'ottava. Con worker lento questi sono
   frame elaborati, non intervalli fissi da 16,7 ms. Consonanti e onset rumorosi
   possono consumare gran parte di una nota breve.
4. **Range rigido.** Qualunque fondamentale sotto 70 Hz o sopra 1000 Hz è
   sempre rifiutata, indipendentemente da livello e qualità.
5. **Timbro e ambiente.** Voce aspirata, fry, forte vibrato, armoniche dominanti,
   riflessioni ravvicinate o accompagnamento dagli altoparlanti rendono meno
   stabile il primo minimo YIN. Le cuffie riducono soprattutto leakage e falsi
   positivi periodici.
6. **Driver/browser.** Le constraint audio sono richieste, non garantite; un
   microfono diverso da quello atteso, un gain OS basso o DSP proprietario del
   dispositivo possono cambiare il frame prima che arrivi all'app.
7. **Dropout singoli.** In modalità normale un solo frame sotto soglia apre
   subito un gap visivo/scoring; `releaseFrames = 3` non lo nasconde. La modalità
   voce debole riduce i falsi negativi, ma può mantenere una nota vecchia e
   aumentare i falsi positivi.

I falsi positivi più probabili sono invece una sorgente periodica catturata
dagli altoparlanti, un'armonica scelta come fondamentale dal primo minimo YIN e
il mantenimento fino a 6 frame della modalità voce debole. Inoltre, per scelta
di progetto, una nota cantata stabilmente ma diversa dal target viene accettata
dal detector: deve restare visibile affinché lo scoring possa segnalarla come
errore.

## Diagnosi rapida

Il benchmark salva per frame `rms`, `rawHz`, `trackedHz`, `clarity`,
`confidence`, `voicing` e `rejectionReason`. Interpretazione minima:

| Evidenza | Punto di caduta probabile |
|---|---|
| RMS sotto soglia, `rawHz = null` | livello/input/gain |
| RMS sopra soglia, `rawHz = null` | nessun minimo YIN valido o F0 fuori range |
| `rawHz` presente, `low-confidence` | gate clarity/confidence |
| `warm-up` | non ancora 3 candidati coerenti |
| `large-jump-transition` | salto >300 cent non ancora confermato |
| `octave-transition` | salto vicino all'ottava non ancora confermato |
| `weak-signal-held` | pitch precedente mantenuto dalla modalità voce debole |

Per un falso negativo riproducibile, la prima verifica utile è quindi il frame
raw, non la sola linea grafica: distingue acquisizione/RMS, stima YIN e rifiuto
del tracker senza confonderli con il filtro di display o con lo scoring.
