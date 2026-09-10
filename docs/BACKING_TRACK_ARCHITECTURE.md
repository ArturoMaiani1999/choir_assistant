# Accompagnamento, clock e cancellazione del rientro

## Risultato implementato

La demo di `Gloria` dispone di quattro basi di prova. Ogni base contiene l’organo e le tre voci non selezionate:

| Parte scelta | Contenuto della base |
| --- | --- |
| Soprano (`P1`) | Contralto, Tenore, Basso, Organo |
| Contralto (`P2`) | Soprano, Tenore, Basso, Organo |
| Tenore (`P3`) | Soprano, Contralto, Basso, Organo |
| Basso (`P4`) | Soprano, Contralto, Tenore, Organo |

La tabella eseguibile completa è `frontend/audio/manifest.json`. Gli MP3 sono in `frontend/audio/`.

## Catena di generazione

`scripts/build_backing_tracks.py` legge esclusivamente la timeline appiattita in `frontend/score-fixtures/gloria-frisina-draft.json`.

1. Gli eventi simbolici di ogni parte diventano uno stem MIDI separato.
2. MuseScore 4 sintetizza ogni stem con lo stesso inizio, tempo e termine.
3. FFmpeg crea un mix per ciascun ruolo, escludendo quel ruolo.
4. Tutti i mix vengono tagliati alla durata canonica della performance: 40 secondi.

Il MIDI è quindi un formato intermedio di rendering. Non è la fonte del target e non viene caricato dalla webapp. La fonte del target rimane il modello simbolico normalizzato.

Comando di rigenerazione:

```powershell
python scripts\build_backing_tracks.py frontend\score-fixtures\gloria-frisina-draft.json data\audio-build frontend\audio
```

## Clock canonico in riproduzione

Durante la prova, `HTMLAudioElement.currentTime` della base è il clock canonico. `MediaPlaybackClock` e `NormalizedScoreRuntime.beatAtSeconds()` applicano la tempo map in un solo punto. Lo stesso snapshot alimenta:

- battuta e movimento correnti;
- cursore sullo spartito;
- lookup della nota target simbolica;
- confronto in tempo reale con il microfono;
- avanzamento della barra di progresso.

Quando l’audio viene messo in pausa o entra in buffering, anche target e spartito si fermano. Non esiste più un clock wall-time di fallback nell’esperienza Practice attiva: se la modalità audio è solo mock, Play non avvia una timeline indipendente.

Il server locale deve supportare richieste HTTP Range affinché `currentTime` sia seekable. Usare `python scripts/serve_frontend.py`, non il server statico base di Python.

## Velocità

Le velocità 100%, 75% e 50% usano `HTMLMediaElement.playbackRate` con `preservesPitch = true`. Non esistono copie lente preregistrate. Poiché il cursore legge sempre `currentTime`, audio, target e microfono restano sullo stesso punto musicale anche a velocità ridotta.

## Cuffie e altoparlante

La modalità più accurata è **Cuffie**:

- `echoCancellation: false`;
- `noiseSuppression: false`;
- `autoGainControl: false`.

Questo evita che l’elaborazione vocale del browser deformi attacchi, vibrato e frequenza fondamentale.

La modalità predefinita della demo è **Altoparlante · eco ridotto** e richiede `echoCancellation: true`. Dopo l’apertura del microfono, la UI controlla `MediaTrackSettings.echoCancellation` e avverte l’utente se il dispositivo non ne conferma l’attivazione. Il volume iniziale è limitato al 55%. È una cancellazione acustica fornita dal browser/dispositivo: può ridurre la base che rientra nel microfono, ma non garantisce la sottrazione perfetta in ogni stanza.

Non è implementata una sottrazione campione-per-campione della base dal microfono. Sarebbe fragile senza conoscere con precisione latenza, risposta degli altoparlanti, riflessioni ambientali e trasformazioni del driver. Inoltre rischierebbe di cancellare componenti della voce del cantante che coincidono con l’accompagnamento.

## Formato audio

La demo usa MP3 stereo, 44,1 kHz, 192 kbit/s. La scelta mantiene i quattro asset intorno a 1 MB ciascuno e viene decodificata nativamente dai browser target. Gli asset verificati durano tutti esattamente 40,000 secondi.

Per una pubblicazione definitiva si potrà aggiungere Opus come sorgente preferita e mantenere MP3 come fallback. Questo non cambia il modello né il clock.

## Limiti attuali dichiarati

- Le basi sono sintetiche e provengono dalla trascrizione OMR **bozza**, non ancora da uno spartito approvato dall’amministratore.
- Le lacune già note nelle battute finali della bozza si riflettono sia nel target sia nella base.
- Non ci sono ancora registrazioni corali o un organo campionato editoriale.
- La cancellazione eco dipende dal browser e dall’hardware; le cuffie restano la condizione affidabile per lo scoring.
- Non sono ancora implementati calibrazione automatica della latenza di ingresso/uscita e mix regolabile per singola voce.

Questi limiti non cambiano il confine architetturale: l’audio è ciò che il cantante ascolta; la verità musicale e il target di valutazione sono simbolici.
