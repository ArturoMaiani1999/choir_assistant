# Relax mode

**Status:** pubblicato e verificato su staging; superficie contemplativa  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Esperienza

**Impostazioni → Relax mode**, nella prova e nel laboratorio vocale, apre una
pagina senza scroll. La curva occupa la superficie principale; ritorno,
pausa e schermo intero restano secondari. **La curva** rivela formula e guida.
Il ritorno conserva il contesto della prova in pausa. Prima di uscire dalla
prova si applicano gli stessi blocchi delle altre navigazioni per acquisizioni
in corso o registrazioni non salvate.

La tesi visiva è un filo di luce setoso nel nero, con ciano, verde tenero,
ocra, rosa e lilla ispirati al disegno di riferimento. Il nero puro e la
policromia del solo disegno sono eccezioni intenzionali alla superficie
inchiostro dell'app; tipografia, focus ciano e azione ambra mantengono i
pattern esistenti. Non vengono aggiunte immagini, librerie esterne o audio.

## Curva e movimento

Le coordinate sono esattamente `x=sin(t)`, `y=sin(2t)`, `z=sin(3t)`.
Una camera prospettica ruota lentamente; il colore e i filamenti seguono la
curva. Si può trascinare la figura per cambiarne l'orientamento, anche in pausa;
le frecce da tastiera offrono la stessa rotazione quando la scena ha il focus.
Il punto procede a metà della precedente velocità (`SPEED = 0.25`); la
rotazione automatica della camera è il 30% più veloce. I due ritmi sono
indipendenti e conservano la posa iniziale. Ogni fotogramma ridisegna gli
ultimi 40 secondi reali, con opacità
decrescente fino a zero: non si accumulano tracce permanenti. L'ingresso
di Relax mode mostra già una scia completa, senza attendere il riempimento iniziale.
La durata doppia mantiene la lunghezza geometrica della scia a velocità
dimezzata. Filamenti continui e scia separata, disegnata come nastri che si
assottigliano fino a zero, eliminano le giunzioni interne. Composizione
luminosa additiva e campionamento parametrico fisso evitano il riordinamento
instabile dei segmenti. Il supersampling viene ridotto esplicitamente con
filtraggio di alta qualità verso il Canvas al DPR nativo; un limite di
otto milioni di pixel per superficie contiene il costo della scena grande.
Buffer interno e geometria sono riusati nello stesso RAF, senza nuove librerie
o asset. Il buffer viene rilasciato durante il cleanup.

La [Home di Xynon](home.md) riusa questa stessa animazione 3D, con scia,
filamenti e alone, limitando la palette a ciano e ocra. La curva occupa l'area
separata dalle azioni prevista dal layout responsive e parte senza attesa.
Profilo e impostazioni sono riuniti nel disclosure dell'header. La palette
multicolore e i controlli specifici di Relax mode rimangono invariati.

I controlli si attenuano dopo inattività e riappaiono al tocco, al passaggio
del puntatore o al focus. Pausa congela scena e scia. Spazio fuori dai
controlli alterna pausa e ripresa; Escape chiude prima i dettagli, poi lascia
gestire al browser lo schermo intero o torna alla superficie precedente.
Schermo intero è disponibile soltanto nei browser che lo supportano.

Con `prefers-reduced-motion` la pagina parte ferma, senza transizioni; si può
avviare esplicitamente il movimento. Il rendering si arresta in background
e all'uscita. Non si aprono microfono o contesti audio. I comandi hanno aree
touch di almeno 44 px e focus da tastiera visibile.
