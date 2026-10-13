# TASK — Creazione MusicXML SATB + organo da spartito

Voglio che tu realizzi una trascrizione musicale accurata del brano che ti allego e mi restituisca un **file `.xml` MusicXML completo e importabile in MuseScore 4**.

Non limitarti a fare OCR o a copiare meccanicamente ciò che credi di vedere: devi ragionare musicalmente e verificare la coerenza della trascrizione.

## 1. Informazioni sul brano

Titolo: `[TITOLO]`

Autore/compositore: `[AUTORE]`

Tonalità: `[TONALITÀ, se nota]`

Metro: `[METRO, se noto]`

Organico desiderato:
- Soprano
- Contralto
- Tenore
- Basso
- Organo a due pentagrammi

File sorgente allegato:
`[PDF / immagini / MusicXML precedente / altri spartiti di riferimento]`

Eventuali file aggiuntivi sono da considerare come materiale di verifica e confronto.

## 2. Gerarchia delle fonti

Usa questa priorità:

1. note effettivamente scritte sul pentagramma;
2. alterazioni in chiave e accidenti;
3. armonia e accordi indicati;
4. contesto tonale e conduzione melodica;
5. eventuali altri spartiti di riferimento;
6. testo completo riportato in fondo allo spartito, se presente.

Se una lettura visiva produce una nota chiaramente incoerente con tonalità, accordo, linea melodica o altre parti, **non accettarla automaticamente**: ricontrolla posizione sul rigo, chiave, alterazioni e contesto armonico.

Non correggere però arbitrariamente una nota solo perché musicalmente insolita: usa il ragionamento musicale come controllo dell'interpretazione grafica.

## 3. Accuratezza delle altezze

Questo è il requisito più importante.

Per ogni nota verifica attentamente:

- chiave utilizzata;
- linea/spazio corretto del pentagramma;
- ottava;
- alterazioni in chiave;
- accidenti locali;
- eventuali alterazioni di cortesia;
- coerenza con l'accordo;
- coerenza con le altre voci;
- andamento melodico precedente e successivo.

Fai particolare attenzione all'errore di leggere una nota sulla linea/spazio immediatamente superiore o inferiore.

Non trasporre implicitamente il materiale.

Se il brano è, per esempio, in Mi bemolle maggiore o Re maggiore, usa la tonalità come prior musicale, ma non come scusa per modificare ciò che è realmente scritto.

## 4. SATB

Crea quattro parti vocali indipendenti:

Soprano  
Contralto  
Tenore  
Basso

Usa registri vocali plausibili.

Quando nello spartito è presente vera armonizzazione SATB, trascrivila fedelmente.

Quando invece compare una strofa o sezione affidata a un solista e io richiedo che venga cantata da tutto il coro, usa questa regola:

- Soprano: melodia originale;
- Contralto: stessa melodia originale;
- Tenore: stessa melodia un'ottava sotto quando necessario;
- Basso: stessa melodia un'ottava sotto quando necessario.

In queste sezioni NON inventare armonizzazioni SATB se la richiesta è di mantenerle monodiche/unisono.

Parametro per questo brano:

`[STROFE MONODICHE: SÌ / NO / SOLO MISURE ...]`

## 5. Testo e sillabazione

Trascrivi anche il testo cantato.

Usa innanzitutto le sillabe sotto le note per determinare l'allineamento temporale.

Se in fondo allo spartito è presente il testo completo, usalo per verificare:

- parole;
- apostrofi;
- accenti;
- errori di OCR;
- sillabazione;
- parole mancanti.

Il testo completo NON determina automaticamente l'allineamento ritmico: per quello devi seguire le sillabe presenti sul pentagramma.

Fai particolare attenzione ai casi in cui più parole o sillabe devono essere cantate sulla stessa nota.

Se MusicXML rende problematico un passaggio come:

`ti of-`

puoi usare una forma compatta leggibile, per esempio:

`ti'of`

oppure un'altra soluzione MusicXML musicalmente sensata, purché l'allineamento del testo rimanga corretto.

Controlla esplicitamente che le sillabe importanti cadano sulla battuta e sul movimento giusti.

## 6. Ritmo

Per ogni battuta verifica:

- durata complessiva compatibile con il metro;
- valori delle note;
- pause;
- punti di valore;
- legature di valore;
- anacrusi;
- terzine o gruppi irregolari;
- eventuali fermate;
- cambi di metro.

Non compensare errori ritmici inserendo pause casuali.

Ogni misura deve risultare formalmente e musicalmente consistente.

## 7. Organo

Aggiungi una parte di organo completa su due pentagrammi:

- mano destra in chiave di violino;
- mano sinistra in chiave di basso.

Se il PDF contiene già l'accompagnamento d'organo, trascrivilo il più fedelmente possibile.

Se l'accompagnamento non è completamente disponibile e devo quindi ricostruirlo, usa le armonie del brano e scrivi un accompagnamento idiomatico, semplice ma musicalmente credibile.

Evita di limitarti a duplicare meccanicamente le quattro voci del coro.

L'accompagnamento deve:

- sostenere l'armonia;
- non coprire le voci;
- utilizzare voicing plausibili;
- rispettare basso armonico e rivolti;
- seguire le cadenze;
- evitare salti innaturali;
- mantenere una buona conduzione delle parti.

Quando opportuno puoi usare:

- note lunghe;
- accordi;
- controcanti molto semplici;
- movimento interno;
- legature di frase.

Preferisci una scrittura sufficientemente legata, soprattutto quando il file verrà utilizzato per generare audio in MuseScore: evita un accompagnamento eccessivamente "a blocchi" e staccato se lo stile del brano richiede continuità.

## 8. Legature e articolazioni

Inserisci dove chiaramente presenti o musicalmente necessarie:

- legature di valore;
- legature di frase;
- fermate;
- dinamiche;
- articolazioni.

Non inventare però una quantità eccessiva di indicazioni non presenti nella fonte.

Per l'organo, se opportuno, utilizza legature di frase per rendere il playback più naturale.

## 9. Generazione MusicXML e progetto MuseScore (.mscz)

Genera due file:

1. `[nome-brano].xml` — MusicXML completo, compatibile con MuseScore 4.
2. `[nome-brano].mscz` — progetto MuseScore nativo, con gli strumenti e i suoni di playback già configurati.

### 9.1 Assegnazione obbligatoria dei suoni

Nel file `.mscz`, configura esattamente i seguenti timbri nel Mixer di MuseScore:

| Parte | SoundFont | Suono |
|---|---|---|
| Soprano | MS Basic | Vocal Aah |
| Contralto | MS Basic | Vocal Aah |
| Tenore | MS Basic | Vocal Aah |
| Basso | MS Basic | Vocal Aah |
| Organo | MS Basic | Fast Strings |

**Queste assegnazioni sono obbligatorie, non semplici suggerimenti.**

Non utilizzare Muse Sounds, strumenti orchestrali automatici, Grand Piano o i suoni scelti automaticamente da MuseScore al posto di quelli specificati.

Per la parte d'organo, mantieni due pentagrammi ma utilizza **Fast Strings su entrambi**, preservando la scrittura musicale originale.

Il nome della parte sulla partitura deve rimanere "Organo", anche se il suono utilizzato per il playback è Fast Strings.

### 9.2 Procedura di configurazione

Dopo aver generato il MusicXML:

1. Importalo in MuseScore 4.
2. Configura nel Mixer il SoundFont MS Basic per ogni parte.
3. Seleziona esplicitamente il preset Vocal Aah per tutte le voci SATB.
4. Seleziona esplicitamente Fast Strings per l'organo.
5. Salva il progetto in formato `.mscz`.
6. Riapri il file salvato e controlla che le assegnazioni siano persistenti.
7. Verifica che tutte e cinque le parti producano audio e che nessuna sia silenziata.

Non considerare sufficiente impostare soltanto i General MIDI Program nel MusicXML: la configurazione effettiva deve essere presente nel file MuseScore nativo.

Se è possibile automatizzare la configurazione intervenendo sul progetto MuseScore, utilizza un metodo verificato e compatibile con la versione installata. Non inventare comandi CLI o attributi XML non supportati.

### 9.3 Verifica del playback

Controlla che:

- le quattro voci utilizzino tutte Vocal Aah;
- il timbro dell'organo sia Fast Strings;
- non vi siano note mancanti o strumenti muti;
- le note lunghe dell'accompagnamento risultino sostenute correttamente;
- il playback non alteri le altezze scritte;
- il salvataggio del progetto mantenga i timbri selezionati.

## 13. Output finale e verifica

Consegna entrambi i file:

- `[nome-brano].xml`
- `[nome-brano].mscz`

Il `.mscz` è il file principale per l'utilizzo in Choir Assistant e per l'esportazione audio attraverso MuseScore.

Il `.xml` deve rimanere disponibile come formato interoperabile e modificabile.

Indica nel report finale:

- tonalità e numero di battute;
- parti vocali e accompagnamento generati;
- eventuali sezioni monodiche;
- eventuali punti musicalmente incerti;
- esito del controllo di importazione in MuseScore;
- esito della verifica dei suoni Vocal Aah e Fast Strings.

**Non dichiarare verificata un'assegnazione timbrica se non hai effettivamente controllato il file `.mscz`.** Se l'ambiente non permette di generare o verificare il progetto nativo, consegna il MusicXML e segnala esplicitamente questa limitazione.

## 10. Verifica musicale obbligatoria prima dell'output

PRIMA di consegnare il file, esegui mentalmente una seconda passata indipendente.

Controlla almeno:

- tonalità;
- prima nota di ogni frase;
- ultima nota di ogni frase;
- intervalli melodici sospetti;
- note che sembrano un tono o semitono troppo alte/basse;
- accordi verticali;
- cadenze;
- incroci delle parti;
- ottava di Tenore e Basso;
- completezza delle battute;
- allineamento del testo;
- eventuali sezioni monodiche;
- coerenza organo/coro.

In particolare, quando una nota letta dal PDF sembra dubbia, chiediti esplicitamente:

> È veramente quella linea/spazio del pentagramma, oppure sto leggendo quella immediatamente sopra o sotto?

Poi confrontala con accordo e tonalità.

## 11. Controllo XML

Dopo aver generato il MusicXML:

1. verifica che sia XML ben formato;
2. verifica che tutte le misure abbiano durate coerenti;
3. verifica che non ci siano riferimenti a parti inesistenti;
4. verifica che ties/slurs abbiano start/stop coerenti;
5. verifica che il file sia importabile da MuseScore senza errori strutturali.

Se hai la possibilità di effettuare un controllo automatico del file, fallo.

## 12. Gestione dell'incertezza

NON inventare silenziosamente quando una porzione dello spartito è realmente illeggibile.

Se ci sono 1–5 punti realmente ambigui, usa tutto il contesto musicale disponibile per scegliere la soluzione più probabile.

Se rimane un'incertezza sostanziale, completa comunque il file scegliendo la soluzione musicalmente più supportata, ma indicami alla fine con precisione:

- misura;
- voce;
- nota/testo dubbio;
- interpretazione scelta.

Non usare l'incertezza come motivo per interrompere inutilmente il lavoro.

## 13. Output finale

Voglio come output principale il **file `.xml` scaricabile**.

Nome file:

`[nome-brano].xml`

Non limitarti a incollare il codice XML nel messaggio, a meno che io non lo richieda esplicitamente.

Dopo la generazione dammi anche un brevissimo report con:

- tonalità rilevata/usata;
- numero di misure;
- parti create;
- eventuali sezioni rese monodiche;
- eventuali punti incerti;
- se l'organo è trascritto dalla fonte o ricostruito.

## 14. Indicazioni specifiche per questo brano

`[INSERISCI QUI LE ISTRUZIONI SPECIFICHE]`

Esempi:

- «Il brano è sicuramente in Re maggiore.»
- «Le strofe devono essere monodiche per tutte e quattro le voci.»
- «Tenore e basso devono eseguire la melodia un'ottava sotto.»
- «Il ritornello deve invece mantenere l'armonizzazione SATB originale.»
- «In fondo al PDF trovi il testo completo da usare per verificare le sillabe.»
- «Il secondo PDF contiene la parte d'organo ed è la fonte autorevole per l'accompagnamento.»
- «Il file XML allegato è una base già quasi corretta: non riscrivere inutilmente ciò che è corretto.»
- «Mantieni quanto più possibile la struttura del MusicXML esistente.»
- «Aggiungi legature alla parte d'organo per rendere il playback MuseScore più continuo.»