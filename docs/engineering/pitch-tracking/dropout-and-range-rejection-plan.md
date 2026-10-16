# Continuità del pitch: dropout e range rejection

**Status:** proposta tecnica, non ancora attiva a runtime  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-14

## Obiettivo

Rendere la traccia vocale più continua quando il cantante è lontano dal
microfono, senza trasformare la partitura nella risposta che il rilevatore deve
produrre e senza nascondere note realmente sbagliate.

Il caso guida è una finestra con 10 osservazioni nella quale 6 sono coerenti e
4 sono mancanti o palesemente anomale. Le 6 osservazioni buone possono sostenere
una breve riparazione della **sola visualizzazione**, purché il buco sia corto,
non attraversi una pausa o un attacco e le osservazioni ai suoi lati siano
coerenti. Il conteggio `6/10`, da solo, non è sufficiente: quattro campioni
consecutivi possono rappresentare un vero cambio di nota o un errore cantato.

## Diagnosi dell'implementazione attuale

In modalità normale il preset usa `minClarity = 0.45`,
`minConfidence = 0.30` e `weakSignalHoldFrames = 0`. La modalità voce debole
abbassa le soglie e mantiene invece l'ultima stima fino a 6 frame.

La discontinuità visiva nasce da questa sequenza:

1. `PitchSmoother.update()` rifiuta immediatamente un frame che non supera
   chiarezza e confidence;
2. con `weakSignalHoldFrames = 0`, quel frame non riceve un valore mantenuto;
3. `applyPitchEstimate()` imposta subito `trackedPitch` e `displayPitch` a
   `null`;
4. `plumeSegments()` chiude il segmento alla prima osservazione non valida.

Di conseguenza anche un solo calo momentaneo di confidence produce un taglio
visibile. Il `releaseFrames = 3` interno non evita il taglio: conserva per poco
lo stato del tracker, ma il frame resta `accepted = false` e la UI lo tratta
come assente.

Il problema non è quindi soltanto il *pitch fuori range*. Ci sono almeno quattro
classi diverse da distinguere:

| Classe | Esempio | Trattamento candidato |
|---|---|---|
| segnale non vocalizzato | silenzio, consonante, pausa | lasciare il vuoto |
| dropout di qualità | F0 plausibile ma confidence appena sotto soglia | recuperabile se sostenuto dal contesto |
| outlier isolato | octave flip o minimo YIN spurio | scartare dalla visualizzazione |
| cambio reale | intervallo, portamento o nota sbagliata persistente | confermare e mostrare, non correggere verso lo spartito |

## Vincoli di sicurezza musicale

Devono restare separati tre flussi:

- **Raw candidate:** ciò che lo stimatore acustico ha osservato, incluse
  chiarezza, confidence e motivo di rifiuto;
- **TrackedPitch:** il dato acustico confermato consumato dallo scoring;
- **DisplayPitch:** una rappresentazione che può colmare piccoli buchi e
  attenuare outlier per rendere leggibile la plume.

La prima sperimentazione deve modificare soltanto `DisplayPitch`. Il target
MusicXML non deve mai cancellare un campione dallo scoring perché è lontano
dalla nota attesa: quella distanza potrebbe essere precisamente l'errore che
l'app deve insegnare a correggere. I casi E01/E02 del corpus, cantati
intenzionalmente fuori nota, restano un gate bloccante.

## Che cosa significa "range della parte"

Si distinguono tre concetti, con permessi diversi:

1. **Estensione globale della parte:** minimo e massimo di
   `runtime.targetEvents`, inclusa la trasposizione corrente. Può fornire una
   guardia molto larga, inizialmente `min - 3 semitoni` / `max + 3 semitoni`.
2. **Tessitura dichiarata dal cantante:** utile in futuro, ma non è oggi un
   dato affidabile e obbligatorio. Non va inventata dal nome S/A/T/B.
3. **Nota locale attesa:** non è un range di verità. Può segnalare attacchi e
   pause o agire come prior debole, ma non deve imporre il pitch corretto.

Anche la guardia globale non autorizza un rifiuto permanente. Un candidato
fuori estensione, se persiste per più frame coerenti, va promosso a possibile
evento reale e reso visibile. Questo conserva ottave errate e note sbagliate.

## Proposta: finestra robusta con stati espliciti

### 1. Usare il tempo, non soltanto il numero di campioni

Il loop mira a 60 analisi/s, ma worker, carico del browser e deduplicazione dei
campioni rendono la cadenza variabile. "10 campioni" può quindi coprire durate
diverse. La policy dovrebbe essere espressa come una finestra temporale di
circa `180–220 ms`, conservando `10` come massimo iniziale di osservazioni.

Parametri iniziali da sottoporre a benchmark, non valori di produzione:

```text
windowMs             = 200
maxObservations      = 10
minimumSupport       = 6
maxRepairGapMs       = 80
partRangeMarginCents = 300
neighbourhoodCents   = 150
```

### 2. Classificare ogni osservazione

- `trusted`: supera le soglie normali ed è coerente con la traiettoria;
- `recoverable`: possiede un `rawHz`, è nel range globale e fallisce di poco
  chiarezza/confidence;
- `outlier`: è isolata, fuori range o lontana dalla mediana robusta locale;
- `unvoiced`: nessuna evidenza periodica sufficiente;
- `transition`: un nuovo cluster coerente che può diventare una nota reale.

Per `recoverable` non va fissata subito una nuova soglia unica. La prima griglia
di test dovrebbe esplorare `minClarity 0.35–0.45` e
`minConfidence 0.15–0.30`, sempre richiedendo il sostegno della finestra. In
questo modo una voce debole ma coerente può essere recuperata senza ammettere
automaticamente tutto il rumore ambientale.

### 3. Applicare la regola 6/10 con guardrail

Una breve riparazione di `DisplayPitch` è ammessa soltanto se:

- almeno 6 delle ultime 10 osservazioni, oppure l'equivalente nella finestra di
  200 ms, formano un cluster coerente;
- il buco da riempire non supera 80 ms;
- prima e dopo il buco il pitch appartiene allo stesso intorno, inizialmente
  entro 150 cent;
- il buco non attraversa cambio di `takeId`, pausa, arresto, attacco della nota
  o transizione già marcata come provvisoria;
- non viene unito un salto melodico reale oltre 300 cent.

Gli outlier isolati possono essere identificati con mediana + MAD/Hampel in
semitoni. Una sequenza coerente che si allontana dalla mediana non è un outlier:
entra nello stato `transition` e viene confermata con l'isteresi già esistente.

### 4. Riparare senza inventare una nota

Per il live sono possibili due strategie complementari:

- **hold causale breve:** mantenere l'ultimo `DisplayPitch` affidabile per
  2–3 frame quando la storia precedente è stabile;
- **interpolazione retrospettiva:** quando arriva il prossimo campione
  affidabile entro 80 ms, aggiornare i soli punti visivi del piccolo buco con
  un'interpolazione in semitoni.

La seconda strategia non modifica campioni raw o scoring e non aggiunge latenza
audio. Se il campione successivo non arriva o conferma un nuovo cluster, il
tratto mantenuto viene chiuso e resta visivamente incerto, non trasformato in
una falsa nota lunga.

Pseudocodice orientativo:

```text
range = [minPitchDellaParte - 300 cent, maxPitchDellaParte + 300 cent]
window = osservazioni degli ultimi 200 ms, massimo 10
support = cluster robusto più numeroso nella window

if current è trusted:
    conferma il punto display
else if support.count >= 6
        and current è recoverable oppure outlier isolato
        and durataBuco <= 80 ms
        and nessuna pausa/attacco/transizione:
    produci display-held provvisorio
else:
    lascia un gap

se un nuovo cluster persiste:
    trattalo come pitch reale, anche se è fuori dal range della parte

TrackedPitch e scoring non leggono mai i punti display-held/interpolati.
```

## Piano di implementazione e verifica

### Esperimento A — osservabilità, nessun cambio UX

Registrare per ogni frame: `rawPitch`, `trackedPitch`, `displayPitch`, stato di
voicing, `rejectionReason`, posizione rispetto al range globale, appartenenza al
cluster e durata del dropout. Prima di scegliere le soglie, contare quante
interruzioni dipendono da `low-confidence`, `unvoiced`, octave flip o carico del
worker.

### Esperimento B — candidato display-only

Implementare la finestra come componente puro e confrontabile nell'harness.
Attivarla come variante, non come sostituzione della baseline. Provare:

1. hold adattivo di 2 e 3 frame;
2. Hampel causale + hold;
3. hold + riparazione retrospettiva entro 60/80 ms;
4. griglia delle soglie `recoverable` indicata sopra.

### Esperimento C — eventuale modifica del tracking

Solo dopo il corpus reale si può valutare se i campioni `recoverable` debbano
aumentare anche la copertura dello scoring. Questa fase deve usare un tracker
audio-only o un prior musicale debole e deve continuare a rilevare E01/E02. Non
va ottenuta copiando la nota attesa nei buchi.

## Metriche e criteri di adozione

Confrontare ogni candidato sulla stessa sorgente audio e sugli stessi timestamp:

- copertura voiced e percentuale di tempo con plume continua;
- numero, durata mediana e p95 dei gap durante note sostenute;
- precision/recall del voicing su pause e consonanti;
- octave-error rate e falsi interventi sui veri salti;
- latenza p50/p95 di attacchi e cambi di nota;
- conservazione di almeno il 70% dell'energia del vibrato 4–7 Hz;
- nessuna unione attraverso pause o `takeId` differenti;
- nessun errore intenzionale E01/E02 nascosto allo scoring;
- risultati separati per modalità normale e voce debole, distanza dal
  microfono, dispositivo e presenza di accompagnamento.

Il candidato è adottabile solo se aumenta la continuità sulle note sostenute
senza peggiorare pause, attacchi, veri intervalli e rilevazione degli errori.

## Decisione consigliata

Il primo cambiamento da prototipare non è un hard gate sulla nota corrente
della partitura. È un **bridge adattivo display-only**, sostenuto da maggioranza
robusta e range globale largo, con massimo 60–80 ms di riparazione. In parallelo
va misurata la causa dei dropout. Solo i dati possono stabilire se il passo
successivo sia abbassare lievemente le soglie normali, cambiare la confidence o
migliorare l'acquisizione a hop costante.
