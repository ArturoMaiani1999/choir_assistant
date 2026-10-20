# Qualità musicale e affidabilità delle misure

**Status:** canonical contract; quantitative tolerances pending real-vocal validation  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-19

## Che cosa vogliamo valutare

Una buona esecuzione è intonata, armoniosa e naturale per un ascoltatore.
La coincidenza istante per istante con le note del file non costituisce da
sola questa qualità. All'attacco è ammessa una rapida convergenza verso la
nota; un respiro può abbreviare la durata scritta; il vibrato non è una serie
di errori alternati. Per l'intonazione sostenuta conta anche il centro del
vibrato. Portamenti e consonanti richiedono un contesto musicale.

Questi sono criteri di prodotto. Non fissiamo ancora una durata universale
dell'attacco o una percentuale di nota obbligatoria: serviranno annotazioni
di esecuzioni reali con ascolto, confini e giudizi umani indipendenti. La
tolleranza tecnica corrente in cent e la copertura sono misure separate;
non devono essere presentate come una definizione di perfezione musicale.

## Separare canto e rilevatore

Una deviazione della traiettoria può derivare dalla voce, dal rientro della
base o dal rilevatore. I testi del rapporto descrivono il segnale e invitano
al riascolto prima di attribuire il difetto al cantante. Il target dello
spartito non è una misura della frequenza realmente cantata. Non si corregge
un segnale portandolo verso quel target: una nota davvero sbagliata deve
rimanere sbagliata anche dopo la correzione del rientro.

Le osservazioni provvisorie o rifiutate non diventano note nel grafico
condiviso. Le voci deboli già accettate rimangono visibili. Questo esclude
candidati che il runtime non aveva ammesso; non introduce una nuova soglia
di accettazione o un nuovo filtro sulle deviazioni musicali.

## Accettazione di una correzione del pitch

- Conservare la stessa maschera di frame ammessi per confrontare le sole
  altezze: stessi intervalli, stessi falsi negativi e positivi.
- Misurare errore in cent, outlier e continuità su verità acustica indipendente;
  distinguere attacchi, rilascio, sostegno e vibrato. Un EMA può avere ritardo
  sul vibrato: confrontare anche il raw sulla stessa maschera.
- Includere voce pulita, voce debole, nota errata, stessa frequenza della base,
  metronomo, cambi di volume, ritardo e distorsione.
- Richiedere evidenza su segnali reali prima di promuovere un esperimento.
  Una simulazione favorevole non dimostra il risultato sul telefono.

La riduzione dei falsi positivi durante le pause richiede un confronto
separato della decisione voce/pausa. A maschera invariata i falsi positivi
restano per definizione invariati. Un intervento sulla decisione deve
dimostrare di non peggiorare il richiamo della voce, anche debole, su dati
annotati; non basta che il grafico diventi più ordinato.

## Dati necessari

Per diagnosticare il rientro servono microfono grezzo, riferimento realmente
emesso, segnale trattato e previsione del rientro sullo stesso clock, con
impostazioni e misure live. Il [test diagnostico di Santo](../engineering/pitch-tracking/santo-echo-study-2026-10-19.md)
introduce questa raccolta esplicita. Senza audio la dichiarazione dell'utente
è un'indicazione utile, ma non consente di misurare l'errore del rilevatore.
