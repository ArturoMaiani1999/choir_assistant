# Practice frontend

This dependency-free browser milestone proves the singer-facing Practice experience: selected-part notation, fixed-NOW musical pitch lane, live browser-local singer trajectory, compact transport and one canonical performance clock.

## Run

```powershell
python scripts/serve_frontend.py
```

Open `http://localhost:5173`. Press **Microfono** and grant permission to activate the live pitch detector; the cyan dot at **ORA** confirms the current detected note even before playback begins. The `Altre voci` accompaniment uses the existing part-specific backing file. Other accompaniment modes are UI/state mocks.

The notation and target events come from the current local MuseScore-derived
bundle. They are not automatically approved for publication. See
[`docs/product/practice-experience.md`](../docs/product/practice-experience.md)
for the current product contract. Historical redesign plans and evidence are
kept under `docs/archive/prototype-2026/`.

## Admin MuseScore correction loop

Start the local server with `python scripts/serve_frontend.py --port 5173`, open
`http://127.0.0.1:5173/admin-review.html`, then use **Scarica .mscz** and
**Importa .mscz corretto**. Importing archives the uploaded MuseScore file by
content hash, rebuilds MusicXML, runtime events, SVG geometry, guide audio and
the review manifest, and leaves the resulting bundle in `pending_review` with a
new fingerprint. The importer is intentionally available only on the local
admin server.

## Real-time pitch input

Practice uses `getUserMedia` and Web Audio for browser-local, monophonic pitch
detection. Press **Microfono**, grant permission, and use headphones so the
guide track is not detected as the singer. Microphone access works on the local
`127.0.0.1`/`localhost` server and on HTTPS deployments; the audio stream is
processed in memory and is not uploaded or recorded.

## Validation

The toolbar transposition selector shifts the guide audio and practice targets
by -12 to +12 semitones, including octave presets. The displayed score remains
the original notation and is labelled accordingly. Audio transposition requires
FFmpeg on PATH or the local FFmpeg installation used by the guide builder.
Restart the local server after updating it to enable `/api/transpose`.

Note names and live feedback sit beside NOW. **Esercizio** selects a phrase,
enables automatic repetition with a preceding measure, offers Italian note names,
and provides a microphone level check. Completed attempts report the percentage
of confidently detected singing within ±30 cents; silence and uncertain input
are excluded. Comparisons use the same phrase, speed and transposition.
Part selection, per-part settings and last measure are stored locally.

Feature validation with the local server running:

```powershell
python scripts/browser_practice_features_smoke.py
```

With the local server running:

```powershell
python scripts/browser_practice_smoke.py
python scripts/browser_sync_smoke.py
python scripts/browser_backing_smoke.py
python -m unittest discover -s backend/choir_assistant/tests -t backend
```

## Feedback vocale offline

Le registrazioni conservate nell'archivio locale possono essere aperte nella
vista **Revisione dell'esecuzione** e processate con **Analizza esecuzione**.
La schermata mostra soltanto il riferimento e la traiettoria `v1+ display`; i
confronti diagnostici tra estimatori non fanno parte dell'esperienza utente.
L'analisi usa la traiettoria v1+ già derivata dai frame acquisiti, il clock
audio/partitura e i target compilati dal MusicXML. Per ogni
nota calcola scarto mediano, deriva robusta, stabilità residua, copertura e
confidenza; attacchi e rilasci vengono esclusi in modo proporzionale alla durata.
Il risultato non richiede di aprire un inspector: ogni blocco nota mostra
direttamente un simbolo soltanto quando emerge una difficoltà (`−`, `+`, `↓`,
`↑`, `≈`, `?`). Le note convincenti non ricevono indicatori invasivi e i valori
in cent non sono stampati nella panoramica. Passando il puntatore sulla nota
compare la spiegazione testuale sintetica sopra il grafico.

La valutazione usa tre regimi iniziali configurabili: nota breve (<250 ms),
intermedia (250–700 ms) e tenuta (>700 ms). Le note brevi sono valutate per
altezza prevalente ed evidenza acustica senza inferire una deriva; sulle tenute
sono abilitate anche tendenza lenta e stabilità residua. Affidabilità F0,
allineamento, altezza prevalente e deriva restano misure distinte. Una seconda
scala temporale confronta le note affidabili per rilevare una deriva comune
della frase. La UI ordina queste evidenze e mostra al massimo tre passaggi
prioritari da riascoltare.

Il confronto **Originale/Corretta** elabora localmente il buffer del microfono
con ricampionamento e riallineamento WSOLA a durata invariata. Il confronto
riproduce l'intera registrazione e sposta il centro mediano di ogni nota affidabile,
lasciando originali pause e regioni incerte; non viene offerto quando nessuna
regione possiede dati e allineamento sufficienti. Originale e Corretta usano lo
stesso player: il cursore del piano-roll segue entrambe e un clic sul grafico
sposta la posizione di ascolto.
L'audio originale non viene modificato né duplicato in IndexedDB.

Le soglie iniziali sono raccolte in `vocal_feedback.js` e sono intenzionalmente
conservative in attesa della validazione su un corpus più ampio. Il pitch
shifter browser-local è adatto a confronti didattici con correzioni moderate,
ma non è un algoritmo professionale di preservazione dei formanti.

The browser suite validates six viewports and writes screenshots to `artifacts/practice-redesign/`.
