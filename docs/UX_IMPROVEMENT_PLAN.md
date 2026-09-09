# Piano di miglioramento UX/UI

## P0 — Affidabilità percepita

- Stato sessione esplicito e transizioni prevedibili.
- Pausa automatica su background, mute, traccia terminata e audio sospeso.
- Ripresa tramite gesto dell’utente senza perdita del beat.
- Nessuno scoring quando manca un target simbolico.
- Cleanup del microfono alla chiusura della pagina.

Esito atteso: il corista sa sempre se l’app sta ascoltando e se il tempo sta avanzando.

## P1 — Guida all’avvio

- Conto alla rovescia visivo e accessibile.
- Stato dedicato durante la richiesta del permesso.
- Test ingresso rapido prima della prima prova.
- Suggerimento cuffie solo quando sarà presente la guida audio.

Esito atteso: nessun ingresso perso e meno dubbi sul microfono.

## P1 — Spartito reale

- Adapter per renderer MusicXML.
- Mapping stabile tra elementi grafici ed eventi simbolici.
- Auto-scroll centrato sul playhead.
- Lyrics e parte vocale evidenziate.
- Seek toccando una misura.

Esito atteso: lo spartito diventa il vero strumento di navigazione.

## P1 — Trasporto musicale

- Audio guida collegato allo stesso clock del cursore.
- Play, pausa, seek e velocità da un solo controller.
- Velocità 100%, 75% e 50% con intonazione preservata.
- Controlli accessibili con il pollice e in landscape.

Esito atteso: audio, cursore, target e scoring non divergono.

## P2 — Feedback musicale

- Valutazione su finestre temporali, non sul singolo frame.
- Feedback distinto per attacco, sustain, intonazione e ritmo.
- Riepilogo per frase e punti da riprovare.
- Modalità sobria senza classifiche o ricompense invasive.

Esito atteso: il feedback aiuta a studiare invece di distrarre.

## P2 — Personalizzazione del corista

- Selezione parte SATB.
- Trasposizione solo dove musicalmente consentita.
- Ripresa dall’ultima battuta.
- Preferenze di contrasto, dimensione spartito e feedback.

## Ordine di esecuzione

1. Implementare P0 nella schermata corrente.
2. Validare P0 con microfono reale su smartphone.
3. Integrare il renderer MusicXML dietro un adapter.
4. Collegare audio e trasporto al clock canonico.
5. Introdurre scoring per frase e riepilogo.

## Avanzamento al 9 settembre 2026

- [x] Selezione della parte SATB nella schermata principale.
- [x] Prima trascrizione OMR di Gloria disponibile per tutte le parti vocali.
- [x] Spartiti reali renderizzati da MusicXML; rimossa la notazione SVG fittizia.
- [x] Target di intonazione filtrato in base alla parte selezionata.
- [x] D.C. al Fine appiattito nella timeline (20 occorrenze da 12 battute scritte).
- [x] Evidenziazione della battuta e auto-scroll nello spartito.
- [ ] Revisione editoriale delle note e dei ritmi riconosciuti dall’OMR.
- [ ] Inserimento/validazione del testo cantato.
- [ ] Mapping evento-grafema per un cursore preciso sulla singola nota.
- [ ] Interruzioni P0, conto alla rovescia, audio guida e velocità.
