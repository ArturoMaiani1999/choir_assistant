# TASK — Trascrizione MusicXML per Choir Assistant da PDF

Voglio che tu trascriva accuratamente lo spartito PDF allegato e mi restituisca un **file `.xml` MusicXML completo, strutturalmente valido e importabile in MuseScore 4**.

Il file sarà usato da Choir Assistant per generare parti vocali, timeline, spartiti SVG e audio. Non basta quindi ottenere una pagina visivamente simile: altezze, durate, tonalità, modo, testo, parti e navigazione devono essere codificati semanticamente nel MusicXML.

Non limitarti a fare OCR o a copiare meccanicamente ciò che credi di vedere. Ragiona musicalmente, ma non inventare silenziosamente ciò che la fonte non sostiene.

## 1. Dati del brano

- Titolo: `[TITOLO]`
- Autore/compositore: `[AUTORE]`
- Tonica/tonalità dichiarata: `[ES. RE]`
- Modo dichiarato: `[major / minor / da rilevare]`
- Alterazioni in chiave attese: `[ES. 2 diesis / da rilevare]`
- Metro iniziale: `[ES. 4/4 / da rilevare]`
- Tempo iniziale: `[INDICAZIONE E BPM, se noti]`
- Lingua del testo: `[ITALIANO / LATINO / ALTRO]`
- Sezioni monodiche richieste: `[NO / SÌ / MISURE O SEZIONI]`
- Strofe multiple da linearizzare: `[NUMERO E MISURE DEL BLOCCO / da rilevare]`
- File sorgente principale: `[PDF ALLEGATO]`
- Fonti aggiuntive: `[EVENTUALI IMMAGINI, MUSICXML O ALTRI SPARTITI]`

Se tonalità, modo, metro o tempo non sono forniti, rilevali dalla fonte e dichiarali nel report finale. Se rimangono dubbi, scegli l'ipotesi più sostenuta e segnala la misura o la pagina interessata.

## 2. Contratto di output

Genera **un solo file principale**:

`[nome-brano].xml`

Requisiti obbligatori:

- XML UTF-8 ben formato;
- MusicXML `score-partwise` versione 4.0;
- importabile in MuseScore 4 senza errori strutturali;
- brano completo, senza `TODO`, ellissi, misure omesse o frammenti dimostrativi;
- nessun Markdown, commento esplicativo o testo estraneo dentro il file XML;
- titolo e compositore valorizzati semanticamente;
- cinque parti esattamente nell'ordine e con gli ID indicati sotto;
- stesso numero e stessa numerazione di battute in tutte le parti;
- note, pause, testi, cambi di metro/tonalità/tempo e navigazione codificati come dati musicali, non come semplici parole decorative.

Lascia a MuseScore l'impaginazione ordinaria: evita coordinate come `default-x`, `default-y`, `relative-x` e `relative-y`, margini copiati dal PDF o interruzioni di sistema/pagina forzate, salvo quando siano davvero necessarie. Questi dati grafici sono fragili e non devono sostituire la struttura musicale.

Non generare un `.mscz` fittizio e non dichiarare di avere verificato MuseScore se non hai realmente aperto il file. Il progetto `.mscz` e i preset specifici di MS Basic verranno configurati localmente dopo l'importazione. Nel MusicXML usa strumenti e MIDI standard semanticamente appropriati; non inventare estensioni proprietarie MuseScore.

## 3. Struttura obbligatoria delle parti

Usa questi ID e nomi senza cambiarli:

| ID | Nome parte | Abbreviazione | Struttura |
|---|---|---|---|
| `P1` | `Soprano` | `S` | una parte vocale |
| `P2` | `Contralto` | `A` | una parte vocale |
| `P3` | `Tenore` | `T` | una parte vocale |
| `P4` | `Basso` | `B` | una parte vocale |
| `P5` | `Organo` | `Org.` | una sola parte con due pentagrammi |

Non accorpare SATB in una sola parte e non dividere l'organo in due parti separate.

Per `P5`, nella prima battuta usa semanticamente:

- `<staves>2</staves>`;
- pentagramma 1 in chiave di violino;
- pentagramma 2 in chiave di basso;
- `<staff>1</staff>` e `<staff>2</staff>` sulle note e pause pertinenti;
- voci e `<backup>`/`<forward>` corretti, senza alterare la durata della battuta.

Per il Tenore, se la fonte usa la comune chiave di violino ottavata, usa una chiave G sulla seconda linea con `<clef-octave-change>-1</clef-octave-change>`. Le altezze `<pitch>` devono comunque rappresentare il **suono reale**, non un'ottava grafica errata.

Ogni `<note>` dovrebbe avere un ID univoco e stabile, per esempio `P1-M001-N001`. Non riutilizzare lo stesso ID.

## 4. Tonalità e modo — requisito tassativo

In `<attributes><key>` non omettere mai `<mode>`.

Devi scrivere esplicitamente, in ogni parte alla prima battuta e a ogni cambio di tonalità:

```xml
<key>
  <fifths>2</fifths>
  <mode>major</mode>
</key>
```

oppure, per esempio, per Si minore:

```xml
<key>
  <fifths>2</fifths>
  <mode>minor</mode>
</key>
```

Regole:

- `<fifths>` rappresenta il numero di alterazioni in chiave: positivo per diesis, negativo per bemolli;
- `<mode>` deve essere esattamente `major` oppure `minor`, in minuscolo;
- non dedurre il modo dal solo numero di alterazioni: Re maggiore e Si minore hanno entrambi `<fifths>2</fifths>`, ma modo diverso;
- il modo deve rappresentare la tonalità effettiva del brano, verificata con tonica, cadenze e armonia;
- le alterazioni melodiche/armoniche del modo minore restano accidenti locali: non modificare impropriamente `<fifths>`;
- se avviene una modulazione reale con cambio d'armatura, inserisci il nuovo `<key>` nella misura esatta e in tutte le parti;
- se cambia soltanto l'armonia senza nuova armatura, non inventare un cambio di `<key>`.

Nel report finale indica sempre: **tonica, modo e valore di `<fifths>` usato**.

## 5. Gerarchia delle fonti e metodo di lettura

Usa questa priorità:

1. note, pause e simboli effettivamente scritti sul pentagramma;
2. chiave, armatura e accidenti locali;
3. metro, stanghette, legature e raggruppamento ritmico;
4. testo sillabato sotto le note;
5. armonia verticale, basso e accordi indicati;
6. contesto tonale e conduzione melodica;
7. eventuali spartiti di confronto;
8. testo completo riportato in fondo allo spartito.

Se una lettura visiva sembra incoerente, ricontrolla linea/spazio, chiave, ottava, accidente e contesto armonico. Il contesto serve a verificare la lettura, non ad autorizzare correzioni arbitrarie di note insolite ma realmente scritte.

Un cambio di rigo o di pagina non crea automaticamente una nuova battuta, una pausa o una ripetizione. Ricostruisci la continuità musicale attraverso i sistemi.

## 6. Accuratezza delle altezze

Per ogni nota verifica:

- chiave e numero di pentagramma;
- linea/spazio;
- ottava reale;
- alterazioni in chiave;
- accidenti locali e loro validità fino alla stanghetta;
- eventuali alterazioni di cortesia;
- accordo verticale e conduzione delle parti;
- andamento melodico precedente e successivo.

In MusicXML l'alterazione sonora deve essere presente in `<pitch><alter>…</alter></pitch>`; il solo elemento grafico `<accidental>` non modifica l'altezza. Usa `<accidental>` quando serve anche visualizzare l'accidente.

Non trasporre implicitamente il brano e non correggere automaticamente una nota solo perché è dissonante.

## 7. SATB e sezioni monodiche

Trascrivi fedelmente le quattro linee indipendenti quando la fonte presenta vera armonizzazione SATB.

Se una sezione è esplicitamente richiesta monodica per tutto il coro:

- Soprano: melodia originale;
- Contralto: melodia originale;
- Tenore: stessa melodia all'ottava reale inferiore quando necessario;
- Basso: stessa melodia all'ottava reale inferiore quando necessario.

Non inventare armonizzazioni in una sezione richiesta all'unisono e non trasformare in unisono una sezione SATB presente nella fonte.

Mantieni registri vocali plausibili, ma segnala un'eventuale altezza insolita invece di cambiarla senza evidenza.

## 8. Ritmo, durate e voci MusicXML

Scegli un valore `<divisions>` sufficiente a rappresentare esattamente tutte le durate del brano senza arrotondamenti.

Per ogni battuta e parte verifica:

- somma temporale coerente con il metro;
- durata `<duration>` intera rispetto a `<divisions>`;
- coerenza tra `<duration>`, `<type>` e `<dot/>`;
- pause esplicite, senza silenzi impliciti ambigui;
- legature di valore corrette;
- anacrusi;
- gruppi irregolari realmente presenti;
- fermate e cambi di metro.

Non compensare errori inserendo pause casuali e non usare tuplets solo perché tre note compaiono nello stesso movimento: in 6/8, 9/8 e 12/8 tre crome sono una suddivisione ordinaria, non una terzina.

Per l'anacrusi usa una misura con `implicit="yes"` e la sua durata reale, uguale in tutte le parti. Non riempirla artificialmente fino alla durata nominale del metro.

Per accordi simultanei, la prima nota avanza il cursore e le successive usano `<chord/>`. Per voci simultanee o per i due pentagrammi dell'organo usa `<backup>` con durata esatta. Non usare `<backup>` per nascondere una misura temporalmente incoerente.

## 9. Legature, articolazioni e notazione

Per ogni legatura di valore usa entrambi i livelli richiesti per una buona interoperabilità:

- `<tie type="start|stop"/>` direttamente nella nota;
- `<notations><tied type="start|stop"/></notations>`.

Gli start/stop devono essere bilanciati, sulla stessa altezza e nella voce corretta.

Inserisci slur, fermate, dinamiche e articolazioni quando sono chiaramente presenti. Non aggiungere decorazioni in quantità superiore alla fonte. Distingui sempre una slur di frase da una tie di valore.

## 10. Testo e sillabazione

Usa le sillabe sotto le note come fonte primaria dell'allineamento ritmico. Usa il testo completo eventualmente stampato in fondo soltanto per verificare ortografia, apostrofi, accenti e parole mancanti.

Per ogni sillaba usa semanticamente:

```xml
<lyric number="1">
  <syllabic>begin</syllabic>
  <text>Si</text>
</lyric>
```

I valori ammessi di `<syllabic>` sono `single`, `begin`, `middle`, `end`. Usa `<extend/>` per melismi o prolungamenti. Non duplicare una sillaba sulle note legate che non hanno un nuovo attacco testuale.

Mantieni una codifica coerente di elisioni e apostrofi. Se più parole sono realmente cantate sullo stesso attacco, usa un testo compatto leggibile senza spostarle su note diverse.

Controlla che le sillabe importanti cadano sulla battuta e sul movimento corretti in tutte le parti vocali.

### Una sola linea di testo: strofe linearizzate

Nella partitura risultante deve comparire **sempre una sola linea di testo sotto ogni parte vocale**. Non codificare mai strofe diverse come più versi sovrapposti alla stessa nota.

Quindi:

- ogni `<note>` può contenere al massimo un solo elemento `<lyric>`;
- usa soltanto `<lyric number="1">` oppure ometti `number`; non creare `<lyric number="2">`, `<lyric number="3">` e così via;
- se il PDF stampa due o più strofe sotto lo stesso blocco musicale, duplica l'intero blocco di misure una volta per ciascuna strofa;
- assegna alla prima copia soltanto il testo della prima strofa, alla seconda soltanto il testo della seconda strofa, ecc.;
- duplica in modo identico e sincronizzato **tutte e cinque le parti**, comprese le quattro voci SATB, le pause e i due pentagrammi dell'organo;
- assegna alle copie nuovi numeri di misura coerenti e nuovi ID univoci per note e misure;
- duplica anche un eventuale ritornello dopo ogni strofa soltanto quando questo corrisponde all'ordine reale di esecuzione richiesto;
- elimina dal blocco linearizzato i segni di ripetizione che lo farebbero eseguire ulteriormente e produrrebbero strofe duplicate due volte.

Esempio concettuale: se le misure 5–12 hanno tre linee di testo corrispondenti a tre strofe, il MusicXML deve contenere tre copie consecutive del blocco musicale 5–12, ciascuna con una sola strofa. Non deve contenere una sola copia con tre elementi `<lyric>` per nota.

Questa espansione deve produrre un'unica timeline lineare, leggibile e sincronizzabile da Choir Assistant. Prima di duplicare, verifica con attenzione quali misure appartengono davvero alla strofa e quali a introduzione, interludio o ritornello.

## 11. Tempo

Codifica il tempo iniziale nella prima parte e ogni variazione nel punto esatto. Quando è disponibile un BPM, usa sia l'indicazione metronomica sia `<sound tempo="…"/>`, così il tempo è leggibile da MuseScore e dalla timeline di Choir Assistant.

Esempio:

```xml
<direction placement="above">
  <direction-type>
    <metronome>
      <beat-unit>quarter</beat-unit>
      <per-minute>80</per-minute>
    </metronome>
  </direction-type>
  <sound tempo="80"/>
</direction>
```

Non lasciare il playback a un valore casuale implicito se la fonte fornisce un tempo. Non convertire arbitrariamente un BPM riferito alla semiminima puntata in un BPM riferito alla semiminima.

## 12. Ripetizioni, finali e salti

La struttura di esecuzione è essenziale per sincronizzare spartito e audio. Codifica semanticamente, almeno in `P1` e preferibilmente in tutte le parti:

- ritornelli con `<repeat direction="forward|backward"/>` dentro `<barline>`;
- numero di ripetizioni con `times` quando indicato;
- prima/seconda volta con `<ending>` e `number="1"`, `number="2"` ecc.; usa correttamente `type="start"`, `type="stop"` o `type="discontinue"`;
- Segno e Coda con gli elementi MusicXML appropriati;
- `D.C.`, `D.S.`, `al Fine`, `To Coda` e indicazioni equivalenti come `<direction>` nel punto esatto;
- attributi `<sound>` standard (`dacapo`, `dalsegno`, `tocoda`, `fine`, `coda`, `segno`) quando applicabili.

Non limitarti a scrivere “D.C. al Fine” come testo se puoi anche rappresentarne il significato MusicXML. In generale conserva l'ordine scritto e la navigazione della fonte. L'unica eccezione obbligatoria è una sezione con più strofe stampate come linee di testo sovrapposte: quella sezione deve essere linearizzata duplicando i blocchi come descritto nella sezione 10, senza mantenere anche ripetizioni che causerebbero una doppia esecuzione.

Evita strutture di navigazione annidate o ambigue se non sono chiaramente presenti. Nel report riassumi l'ordine di esecuzione previsto.

## 13. Organo

Se il PDF contiene l'accompagnamento, trascrivilo fedelmente. Ricostruiscilo soltanto se le istruzioni specifiche lo richiedono espressamente.

Se devi ricostruirlo:

- segui armonie, basso, rivolti e cadenze della fonte;
- usa voicing plausibili e buona conduzione delle parti;
- sostieni senza coprire il coro;
- evita salti innaturali e raddoppi meccanici delle quattro parti vocali;
- preferisci una scrittura sufficientemente legata quando lo stile lo richiede;
- indica nel report quali misure sono ricostruite anziché trascritte.

Non usare simboli di accordo al posto delle note effettive dell'organo.

### Suono richiesto per l'organo

Il nome visibile della parte deve rimanere **Organo**, ma il MusicXML deve richiedere per il suo playback il suono **MS Basic — Strings Fast** (chiamato talvolta “Fast Strings”).

Nel `<score-part id="P5">` usa questa configurazione semantica, mantenendo coerenti gli ID dello strumento:

```xml
<score-part id="P5">
  <part-name>Organo</part-name>
  <part-abbreviation>Org.</part-abbreviation>
  <score-instrument id="P5-I1">
    <instrument-name>Strings Fast</instrument-name>
    <instrument-sound>strings.group</instrument-sound>
  </score-instrument>
  <midi-instrument id="P5-I1">
    <midi-channel>5</midi-channel>
    <midi-program>49</midi-program>
  </midi-instrument>
</score-part>
```

`midi-program` in MusicXML è numerato a partire da 1; il valore `49` è quindi intenzionale. Non cambiare `<part-name>Organo</part-name>` in “Strings Fast”: il nome della parte descrive la funzione musicale, mentre `instrument-name` e `instrument-sound` descrivono il timbro di playback.

Questa configurazione MusicXML deve essere presente, ma resta un'indicazione di importazione: dopo la conversione in `.mscz`, verifica realmente nel Mixer di MuseScore che `P5` usi **MS Basic / Strings Fast** e non Grand Piano, Church Organ o Muse Sounds. Non dichiarare verificato il preset se non hai aperto il `.mscz`.

## 14. Controllo obbligatorio prima della consegna

Esegui una seconda passata indipendente e controlla almeno:

1. XML ben formato e root `score-partwise version="4.0"`;
2. parti `P1`–`P5` presenti una sola volta e nello stesso ordine;
3. stesso numero di misure in tutte le parti;
4. `<fifths>` e `<mode>` presenti e coerenti in ogni parte;
5. tempo iniziale e variazioni codificati;
6. durata di ogni misura coerente con metro, voci e pentagrammi;
7. anacrusi marcata `implicit="yes"` quando presente;
8. prima e ultima nota di ogni frase;
9. intervalli sospetti, accidenti e ottave;
10. accordi verticali, cadenze e incroci delle parti;
11. note reali del Tenore rispetto alla chiave ottavata;
12. ties/slurs con start e stop coerenti;
13. sillabazione, melismi e testo allineati, con una sola linea di testo per nota;
14. ritornelli, finali, Fine, D.C./D.S. e Coda;
15. organo realmente su due pentagrammi dentro `P5`, con parte chiamata `Organo` e playback richiesto `Strings Fast`;
16. assenza di misure vuote, placeholder o parti mute accidentali;
17. eventuali strofe multiple trasformate in copie lineari sincronizzate di tutte le parti, senza versi `number="2"` o superiori;
18. importazione in MuseScore 4, se l'ambiente consente di provarla.

In particolare, per ogni nota dubbia chiediti:

> È davvero su quella linea/spazio, con quella chiave e quell'ottava, oppure sto leggendo la posizione immediatamente superiore o inferiore?

Poi confrontala con armatura, accidente, armonia e frase.

## 15. Gestione dell'incertezza

Non interrompere il lavoro per pochi punti ambigui e non inventare silenziosamente.

Per 1–5 punti dubbi usa tutto il contesto disponibile, scegli l'interpretazione meglio sostenuta e completa il file. Nel report indica per ciascuno:

- pagina/sistema;
- misura;
- parte e voce;
- nota, durata o testo dubbio;
- soluzione scelta;
- motivo e livello di confidenza.

Se una sezione estesa è illeggibile, dichiaralo prima di fabbricare molte battute prive di evidenza.

## 16. Consegna e report finale

Allega il file scaricabile `[nome-brano].xml`. Non limitarti a incollare migliaia di righe XML nel messaggio, salvo mia richiesta esplicita.

Accompagna il file con un report molto breve contenente:

- tonalità: tonica, `major`/`minor` e `<fifths>`;
- metro iniziale ed eventuali cambi;
- tempo iniziale ed eventuali cambi;
- numero di misure, specificando l'eventuale anacrusi;
- parti create e loro ID;
- sezioni monodiche;
- eventuali blocchi duplicati per linearizzare strofe multiple;
- struttura di ripetizioni/salti;
- organo trascritto o ricostruito;
- presenza della configurazione `Strings Fast` per `P5` ed eventuale verifica reale nel Mixer;
- punti incerti;
- esito reale dell'importazione in MuseScore, se verificato.

Non dichiarare verifiche che non hai realmente eseguito.

## 17. Indicazioni specifiche per questo brano

`[INSERISCI QUI LE ISTRUZIONI SPECIFICHE]`

Esempi:

- «Il brano è sicuramente in Re maggiore: usa `<fifths>2</fifths>` e `<mode>major</mode>` in tutte le parti.»
- «Il brano è in Si minore: usa `<fifths>2</fifths>` e `<mode>minor</mode>`, senza confonderlo con Re maggiore.»
- «Le strofe, misure 5–20, devono essere monodiche per tutte e quattro le voci.»
- «Nel PDF sono presenti tre strofe sotto la stessa musica: duplica tre volte il blocco della strofa e usa sempre una sola linea di testo.»
- «Nel ritornello mantieni invece l'armonizzazione SATB originale.»
- «Tenore e Basso eseguono la melodia un'ottava reale sotto nelle sezioni monodiche.»
- «In fondo al PDF trovi il testo completo da usare solo per verificare le sillabe.»
- «Il secondo PDF è la fonte autorevole per l'accompagnamento d'organo.»
- «Il MusicXML allegato è una base quasi corretta: conserva le parti valide e correggi soltanto gli errori verificati.»
- «L'organo deve essere trascritto dalla fonte e non ricostruito.»
