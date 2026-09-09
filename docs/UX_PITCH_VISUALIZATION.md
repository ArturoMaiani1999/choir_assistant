# Visualizzazione dell'intonazione

## Decisione

Lo spartito e il segnale del cantante hanno due ruoli diversi e non devono
essere rappresentati con lo stesso linguaggio grafico.

- **Target:** resta simbolico e discreto. La battuta proviene dalla timeline e
  la nota attesa dal MusicXML normalizzato. Nella vista della singola parte un
  cursore circolare viene posizionato sulla testa di nota renderizzata tramite
  un mapping evento-grafema, non tramite una stima lineare del beat.
- **Voce:** resta un segnale continuo. Viene mostrata come curva nel tempo su
  un asse logaritmico in hertz, senza trasformarla in note sul pentagramma.

Disegnare una testa di nota per ogni stima del microfono introdurrebbe una
quantizzazione che il detector non ha realmente eseguito. Vibrato, glissando,
attacchi e rumore sembrerebbero note editoriali e potrebbero confondere il
corista.

## Gerarchia dell'interfaccia

1. Partitura e battuta corrente.
2. Nota target, frequenza target e frequenza vocale istantanea.
3. Traccia degli ultimi otto secondi: target color ambra, voce color turchese.
4. Indicatore sintetico in cent per la correzione immediata.
5. Metriche diagnostiche nei dettagli tecnici.

## Asse e casi limite

L'asse verticale usa una scala logaritmica, coerente con la percezione
musicale. L'intervallo normale include un'ottava sotto e una sopra il target;
si espande quando la voce esce da tale intervallo, così il segnale non viene
tagliato senza spiegazione.

- silenzio: interruzione della curva, nessun valore inventato;
- segnale instabile: curva interrotta e messaggio neutro;
- assenza di target/rest: la voce può essere mostrata, ma non viene valutata;
- oltre ±200 cent: messaggio “molto alta/bassa” e distanza in semitoni;
- prossimità a ±1200 cent: possibile distanza di un'ottava segnalata senza
  presumere che il cantante abbia commesso un errore;
- frequenza fuori dai limiti del detector: nessun clamp presentato come dato
  reale.

## Accessibilità

Il colore non è l'unico canale: Hz, cent, stato testuale e legenda sono sempre
presenti. Gli aggiornamenti frequenti del grafico non vengono inviati al live
region; solo il consiglio sintetico è annunciabile.
