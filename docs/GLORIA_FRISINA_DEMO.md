# Gloria di Marco Frisina — stato della demo

## Obiettivo della tranche

Sostituire il pentagramma dimostrativo disegnato nel browser con una prima
trascrizione reale di `sheets/Gloria Frisina.pdf`, rendere disponibili le
quattro parti vocali e collegare il ruolo scelto al target simbolico usato dal
pitch tracking.

## Pipeline eseguita

1. Il PDF è stato elaborato con Audiveris 5.11 sulle pagine musicali 1–3.
2. L'OMR ha prodotto `data/omr-gloria/Gloria Frisina.mxl` e il progetto
   riesaminabile `data/omr-gloria/Gloria Frisina.omr`.
3. `scripts/prepare_gloria_musicxml.py` applica soltanto informazioni leggibili
   con certezza dalla fonte: nomi SATB, organo, titolo, tempo e D.C. al Fine.
4. Il compilatore MusicXML del progetto produce il modello normalizzato in
   `frontend/score-fixtures/gloria-frisina-draft.json`.
5. MuseScore rende le parti vocali in SVG a partire dallo stesso MusicXML in
   `frontend/score-assets/gloria-parts/`.
6. La demo mostra per impostazione predefinita le tre pagine vettoriali esatte
   del PDF; la vista “Solo la mia parte” usa invece la trascrizione OMR.

Il target del pitch tracking proviene quindi dal MusicXML normalizzato e non
dall'audio né dalle immagini SVG.

## Contenuto disponibile

- Soprano (`P1`)
- Contralto (`P2`)
- Tenore (`P3`)
- Basso (`P4`)
- 12 battute scritte
- D.C. al Fine appiattito in 20 occorrenze di esecuzione
- tempo interno a semiminima = 90, equivalente alla semiminima puntata = 45
- tre pagine SVG per ciascuna voce
- vista “Partitura completa” fedele alla fonte, con note e testo originali

Quando si cambia ruolo, la prova viene fermata e riportata all'inizio. La
timeline e tutti i target successivi vengono filtrati sulla parte selezionata.

## Stato editoriale e limiti noti

Questa versione è una **bozza OMR, non approvata**. Non deve essere pubblicata
come spartito definitivo né usata per attribuire valutazioni affidabili.

- Il testo cantato non è stato acquisito dall'OCR.
- Audiveris ha segnalato anomalie ritmiche, soprattutto nelle battute 5 e 9–12.
- Le battute 10–12 usano una notazione recitativa/non strettamente metrica. La
  prima esportazione MusicXML conserva il tono lungo, ma non tutte le cadenze
  finali sono state riconosciute.
- Legature, dinamiche e abbellimenti non sono ancora stati revisionati nota per
  nota.
- L'evidenziazione nella demo identifica la battuta, non la singola testa di
  nota. Il mapping editoriale evento-glyph sarà introdotto con il renderer
  definitivo.

## Criteri per dichiarare la trascrizione completa

- confronto nota per nota e durata per durata con le tre pagine PDF;
- inserimento delle cadenze non riconosciute nelle battute 10–12;
- verifica delle altezze reali del tenore con chiave di violino ottavizzata;
- acquisizione e sillabazione del testo;
- verifica del D.C. al Fine in ascolto;
- approvazione esplicita dell'amministratore e nuova versione immutabile dello
  score.

Fino a quel momento l'interfaccia deve continuare a mostrare l'etichetta
“Bozza OMR da verificare”.

## Artefatti della demo

- `frontend/score-assets/gloria-originale/`: resa vettoriale fedele del PDF.
- `frontend/score-assets/gloria-parts/`: MusicXML e SVG SATB separati.
- `frontend/score-assets/gloria-frisina-draft.musicxml`: bozza simbolica
  post-processata in modo riproducibile.
- `frontend/score-fixtures/gloria-frisina-draft.json`: timeline normalizzata.
- `scripts/prepare_gloria_musicxml.py`: patch dichiarativa dei metadati certi.
- `frontend/score-assets/gloria-parts/glyph-map.json`: mapping fra i 145 eventi
  vocali scritti e le rispettive teste di nota negli SVG MuseScore.
- `scripts/build_score_glyph_map.py`: generatore riproducibile del mapping.
