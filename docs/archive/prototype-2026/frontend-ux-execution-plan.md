# Piano di esecuzione frontend e UX

> Historical execution plan for the earlier prototype. Current Practice status and limitations are tracked in `docs/PRACTICE_REDESIGN_PROGRESS.md`.

## Obiettivo

Portare il prototipo tecnico verso una webapp mobile-first per coristi, nella quale lo spartito approvato, il cursore musicale e la propria parte siano il centro della prova. Il feedback vocale deve aiutare senza trasformare l’esperienza in un videogioco.

## Principi

1. Lo spartito simbolico approvato determina sempre target, posizione e cursore.
2. Il microfono determina soltanto la stima della voce del corista.
3. Una sola azione avvia microfono, clock e sessione.
4. Le informazioni tecniche restano disponibili ma non dominano la schermata.
5. Tutta la microcopy rivolta all’utente è in italiano.
6. Smartphone e uso con una mano sono il riferimento principale.

## Fase 1 — Rehearsal shell mobile-first

Stato: implementata nella prima tranche UX.

- identità visiva provvisoria “Intona”;
- spartito simbolico dominante;
- playhead verticale ambra e nota attiva evidenziata;
- confronto nota attesa/voce;
- indicatore d’intonazione direzionale;
- trasporto persistente su smartphone;
- unificazione in “Avvia la prova”;
- pausa, ripresa, reset e completamento;
- diagnostica richiudibile;
- localizzazione italiana;
- focus visibile e reduced motion.

## Fase 2 — Renderer musicale reale

Stato: prima integrazione disponibile, revisione editoriale ancora necessaria.

- valutare e integrare OpenSheetMusicDisplay o Verovio;
- caricare esclusivamente MusicXML appartenente a una versione approvata;
- associare gli elementi SVG del renderer agli ID di `MusicalEvent` e `TargetEvent`;
- mostrare lyrics, sistemi, chiavi, alterazioni e parte selezionata;
- mantenere il cursore in una zona stabile durante lo scorrimento;
- gestire orientamento verticale e orizzontale.

## Fase 3 — Trasporto musicale e guida audio

Stato: da implementare.

- collegare il clock canonico alla riproduzione audio;
- conto alla rovescia prima dell’ingresso;
- play, pausa, ripresa e seek per battuta;
- velocità 100%, 75% e 50% con preservazione dell’intonazione;
- mixer essenziale per parte, accompagnamento e metronomo;
- cuffie raccomandate quando è attiva la guida.

## Fase 4 — Feedback e scoring sobrio

Stato: feedback continuo in tempo reale implementato; scoring aggregato da implementare.

- finestre di tolleranza per onset e sustain;
- distinzione tra assenza di voce, attacco tardivo e intonazione instabile;
- feedback per frase e battuta, non solo per frame;
- riepilogo finale semplice con punti da riprovare;
- nessun target inferito dall’audio.
- voce visualizzata come flusso continuo su asse logaritmico in Hz;
- target simbolico visualizzato come linea a gradini separata;
- gestione esplicita di silenzio, assenza target e voce molto lontana.

## Fase 5 — Selezione repertorio e parte

Stato: selezione SATB implementata nella prova; home repertorio da implementare.

- home del corista con brani assegnati e prove recenti;
- scelta SATB e tessitura;
- ripresa dall’ultima battuta;
- stato offline/cache degli asset;
- separazione completa dalle funzioni amministrative di ingestione e approvazione.

## Fase 6 — Validazione UX

Stato: continuativa.

- test reali su smartphone Android e iPhone;
- prova con coristi di esperienza diversa;
- verifica leggibilità a distanza e con illuminazione variabile;
- controllo VoiceOver/TalkBack e navigazione tastiera;
- misurazione del tempo necessario per iniziare una prova;
- verifica che permessi ed errori del microfono siano sempre comprensibili.

## Prossimo incremento consigliato

Introdurre conto alla rovescia, selezione della battuta iniziale e un clock audio unico. In parallelo, completare la revisione amministrativa del MusicXML di Gloria prima di abilitare valutazioni persistenti.
# Stato tranche accompagnamento (2026-09-09)

- [x] Quattro mix specifici per ruolo: organo + voci non selezionate.
- [x] Controlli italiani per modalità di ascolto, velocità e volume.
- [x] Clock della base condiviso da spartito, target e pitch tracking.
- [x] Pitch preservation a 75% e 50%.
- [x] Pausa coordinata in caso di buffering, perdita del microfono o scheda nascosta.
- [x] Modalità cuffie ad alta fedeltà e modalità altoparlante con cancellazione eco del browser.
- [ ] Calibrazione automatica della latenza round-trip.
- [ ] Mixer di volume separato per organo e ciascuna voce.
- [ ] Sostituzione degli asset bozza con rendering dello spartito approvato.
