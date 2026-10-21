# Choir Assistant: sistema UX/UI

**Status:** canonical  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Direzione

Il nome pubblico del prodotto è **Xynon**: usarlo nei titoli delle pagine,
nelle firme dell'interfaccia e nei testi di accesso, uscita e informativa.
La rinomina conserva palette, tipografia e gerarchia musicale esistenti.
I domini e i registri storici di Epistrophe identificano l'ambiente precedente.

Choir Assistant è una sala prove digitale sobria. La musica è il contenuto
principale: fondo inchiostro, spartito avorio, ambra per l'azione primaria,
ciano per voce e focus, verde solo per esiti positivi. L'interfaccia deve
sembrare calma, precisa e musicale, non un pannello amministrativo.

Nel laboratorio vocale lo spartito usa una variante compatta sul fondo
inchiostro, con notazione bianco caldo e nota attiva ocra, per limitare la
luminosità delle superfici di preparazione e istruzioni.

La gerarchia nasce da spazio, allineamento, scala e contrasto. Bordi, ombre e
contenitori si usano solo quando chiariscono un confine o un'interazione.

## Gerarchia e composizione

- Ogni schermata ha un solo compito dominante e una sola azione primaria.
- La navigazione usa etichette testuali, senza frecce decorative. I controlli
  espandibili usano testo o `+` / `−`. I simboli musicali, di riproduzione e le
  indicazioni dei tasti nella guida da tastiera conservano il loro significato.
- Spartito, piano roll o attività corrente occupano la maggior parte del primo
  viewport. Controlli e spiegazioni restano secondari.
- Usare sezioni, righe e divisori prima delle card. Una card è appropriata solo
  quando l'intero contenitore è un oggetto o un'azione.
- Non annidare card per creare gerarchia. Non aggiungere colore se bastano
  spazio e tipografia.
- Usare al massimo un colore d'accento dominante per stato o superficie.

## Testi e progressive disclosure

- Etichette e titoli devono far capire il flusso anche senza leggere paragrafi.
- Il testo visibile serve a orientare, indicare uno stato o consentire una
  decisione. Una spiegazione accessoria va dietro un pulsante `(i)` o in una
  sezione espandibile.
- Il testo di supporto visibile è normalmente una frase breve. Eliminare
  ripetizioni tra titolo, descrizione e stato.
- I comandi descrivono l'azione: “Condividi”, “Riascolta”, “Salva”. Algoritmi,
  formati e vincoli tecnici appartengono ai dettagli.
- Consensi e conseguenze irreversibili devono restare espliciti e accessibili;
  la brevità non deve nascondere una scelta importante.

## Dialoghi

- Il contenuto essenziale deve stare nel primo viewport a 1366x768 e 390x844.
  I flussi secondari possono essere espandibili e scorrere quando aperti.
- Testata breve, chiusura riconoscibile, sezioni senza cornici ridondanti,
  azione primaria evidente.
- `×`, `Escape` e click sul backdrop chiudono il dialogo e riportano al contesto
  precedente. Se esistono dati non salvati, la chiusura resta bloccata e il
  messaggio indica in una frase cosa scegliere.
- All'apertura il focus deve entrare nel dialogo; alla chiusura deve tornare al
  controllo che lo ha aperto, usando il comportamento nativo quando possibile.
- Le spiegazioni `(i)` funzionano con hover, focus e tocco e hanno un nome
  accessibile specifico.

## Interazione e accessibilità

- Area utile minima dei controlli touch: 44x44 px.
- Focus da tastiera sempre visibile; il colore non è l'unico segnale di stato.
- Le animazioni durano poco e chiariscono ingresso, cambio di stato o relazione
  spaziale. Con `prefers-reduced-motion` diventano istantanee.
- Errori e operazioni in corso restano vicini all'azione; i successi brevi
  possono usare un toast e non occupano spazio permanente.
- Nessuno scroll orizzontale dell'intero documento a 390 px.

## Firma armonica e superfici calme

Il precedente sfondo luminoso «a respiro» è eliminato da Repertorio, Direzione
e laboratorio vocale: il fondo rimane inchiostro uniforme. La Lissajous bicolore
della [Home](home.md) è l'unica firma animata condivisa; la Home conserva la
composizione grande e Relax mantiene la sua superficie contemplativa dedicata.

- Nel Repertorio la firma è esclusa: brani e avanzamento restano l'unico
  contenuto, senza area decorativa riservata in fondo alla pagina.
- Tutto il laboratorio vocale, compresa la scelta esercizi, resta privo della
  firma piccola su desktop e mobile. Restano le tre illustrazioni dei percorsi.
- Direzione, prova, registrazione, partitura, risultati, analisi e impostazioni
  restano privi della firma piccola.

La pagina [About](home.md#about-e-missione) riusa la firma 3D compatta al posto
della X nel marchio Xynon. È un'eccezione intenzionale dedicata all'identità;
il testo della missione resta integralmente visibile con lettura a scorrimento.

La firma della Home, il marchio About e la superficie di Relax rispettano movimento ridotto,
sospensione in background e ritorno da BFCache. La loro animazione è
un'eccezione intenzionale alla regola generale delle sole animazioni funzionali.

Le tre illustrazioni dei percorsi vocali costituiscono un'ulteriore eccezione
intenzionale: curve piane monocromatiche ferme con pallino e scia sul tracciato,
anche su mobile, secondo il [contratto del laboratorio](voice-lab-warmup-redesign-plan.md).
Non sostituiscono la firma condivisa; rispettano movimento ridotto e sospensione
fuori vista, in background, con dialoghi e nelle fasi di concentrazione.

Verifica locale su sorgenti e build fingerprintata:
`python scripts/browser_ambient_smoke.py` (anche con `--dist --directory`),
oltre agli smoke di Home,
Direzione e istruzioni vocali. Screenshot di Repertorio e laboratorio a
1366×768 e 390×844 in `artifacts/ambient-curve`, compresa l'assenza della
firma nel Repertorio e in tutto il laboratorio vocale.

## Definizione di completato

Una modifica frontend è completa soltanto quando:

1. rispetta questa guida e riusa i token esistenti;
2. il percorso principale è comprensibile scandendo titoli, stati e pulsanti;
3. desktop e mobile non hanno clipping né scroll evitabile nello stato iniziale;
4. mouse, touch, tastiera, backdrop ed `Escape` hanno comportamento coerente;
5. il browser smoke più vicino passa e gli screenshot dei viewport interessati
   sono stati ispezionati visivamente.

## Struttura consigliata per un prompt frontend

Un prompt efficace definisce esito e criteri verificabili, non soltanto
“rendilo bello”. Usare questo schema:

> Implementa **[obiettivo utente]** nella superficie **[pagina/flusso]**.
> Segui `AGENTS.md`, `docs/product/ui-design-system.md` e `frontend-skill`.
> Mantieni **[elemento principale]** dominante e riusa i pattern esistenti.
> La gerarchia deve essere **[contenuti visibili in ordine]**; nascondi i dettagli
> secondari con progressive disclosure. Comportamenti richiesti: **[mouse,
> touch, tastiera, chiusura, stati]**. Verifica a 1366x768 e 390x844, esegui
> **[test pertinente]** e ispeziona gli screenshot prima di concludere.

Per una modifica ampia aggiungere anche tre frasi: tesi visiva, gerarchia dei
contenuti e tesi d'interazione. Se mancano, devono essere formulate prima di
scrivere codice.

