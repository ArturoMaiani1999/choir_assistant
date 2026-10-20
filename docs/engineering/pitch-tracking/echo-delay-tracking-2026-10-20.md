# Correzione causale delle variazioni di ritardo del rientro

**Status:** implemented; controlled checks passed; two fresh device attempts incomplete, including a 40 ms training delay jump  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Problema e decisione

Il [probe S25+](s25-calibration-probe-2026-10-20.md) a 11/15 mostra un salto
di 288 campioni, 6 ms a 48 kHz, durante il secondo segnale. Un coefficiente di
volume non corregge quel disallineamento. La prima modifica segue quindi E2
del [protocollo](echo-experiment-protocol.md): riallineare la sola previsione
del rientro. Non vengono corretti gli Hz verso lo spartito né introdotte
nuove soglie di ammissione del pitch per coprire il transitorio.

Il probe ad alto livello è stato rifiutato dal veto esistente a 0,98. Il suo
filtro di sensibilità viene usato **solo offline**: non diventa una calibrazione
valida e non viene applicato sul telefono. I dati sono già stati ispezionati;
sono sviluppo, non una conferma cieca del candidato.

## Implementazione

`frontend/echo_delay.js` contiene osservatore, conferma e linea di ritardo.
Il grafo diventa riferimento → H congelato → ritardo variabile → sottrazione.
Il ramo microfono conserva coefficiente 1 e non attraversa la linea di ritardo.

- Monitor a finestre continue di 8.192 campioni, passo minimo 1.024; un solo
  pacchetto trasferibile in volo. Mentre il Worker elabora, la storia continua:
  il prossimo pacchetto contiene i campioni più recenti, senza coda arretrata.
- Correlazione pesata a banda larga; ricerca relativa entro ±20 ms,
  interpolazione a 1/8 di campione, esclusione di uscite periodiche/tonali,
  picchi ambigui e campioni oltre soglia.
- Due porzioni temporali devono confermare il miglioramento. Durante canto
  simultaneo serve inoltre accordo del ritardo in tre bande disgiunte e una
  verifica spettrale robusta in ciascuna porzione. La maschera spettrale esiste
  soltanto nello stimatore: non filtra né silenzia i bin del microfono.
- Due osservazioni successive coerenti prima di un comando. Osservazioni
  vecchie oltre 350 ms, epoche precedenti, discontinuità e intervalli oltre
  250 ms non possono completare una vecchia candidatura.
- Due tap fissi con crossfade di 15 ms sulla previsione. Si evita di variare
  continuamente la velocità del segnale. Il Worklet conferma il frame effettivo
  di completamento; solo allora riparte una finestra pulita.
- Headroom causale fino a 32 ms, eliminando al massimo 0,01% dell'energia
  iniziale di H e riverificando gli stessi intervalli train/holdout con le
  soglie originali 15/12 dB. Il limite negativo effettivo dipende da questa
  riserva; mai si legge un campione futuro del microfono.
- Il follower del guadagno conserva finestre non sovrapposte e le proprie
  regole conservative. Un pacchetto che comanda un riallineamento non può
  contemporaneamente avviare un adeguamento del guadagno sul vecchio percorso.

Il tracking del ritardo non alza il gate del pitch e non introduce una pausa
obbligatoria durante il riallineamento. Rimangono i controlli preesistenti per
clipping, errori e adeguamento del volume. In condizioni non identificabili
il ritardo resta fermo: non è garantito il recupero durante qualsiasi musica.

## Replay causale del PCM reale

Comando riproducibile: `node scripts/benchmark_echo_delay.cjs CAPTURE_FOLDER`;
il modello rifiutato richiede esplicitamente `--rejected-model`.
Il replay usa i moduli di produzione, blocchi da 128 campioni, 10,67 ms di
ritardo simulato Worker/comando e il crossfade di 15 ms. Il controllore parte
a 7 s, dopo l'intervallo usato per identificare H. Non accede alla F0 vera,
allo spartito o ai campioni futuri per decidere l'aggiornamento.

| Probe di sviluppo | Tratto | Ritardo fisso | Tracking causale | Aggiornamenti |
| --- | --- | ---: | ---: | --- |
| 8/15, modello valido | 7–10 s | 22,88 dB | 22,88 dB | nessuno |
| 11/15, modello rifiutato, sensibilità offline | 7–10 s, incluso transitorio | −1,82 dB | 8,73 dB | +6 ms a 7,672 s |
| stesso probe alto | 8,3–10 s, dopo assestamento | −3,08 dB | 22,00 dB | medesimo aggiornamento |

Il caso stabile non viene spostato arbitrariamente. Il recupero del salto è
causale, ma **8,73 dB sull'intero tratto non soddisfano il target di 20 dB**.
I 22 dB dopo assestamento non vanno presentati come prestazione dell'intera
prova. Il ritardo simulato del Worker non misura il carico del S25+.

PCM e report rimangono privati in `artifacts/echo-lifecycle/device-probe-*`;
gli hash originali sono nello studio del probe. Ogni esecuzione produce
`causal-delay-replay.json` e `causal-delay-prediction.f32`.

## Voce nota e browser

Sei miscele controllate: voce 220 Hz a due livelli, tre fasi, base contenente
anche 220 Hz e 246,94 Hz più eccitazione larga, percorso che passa da 0 a
+6 ms e poi a −6 ms. Confronto su **284 finestre vocali prefissate per caso**,
stesse impostazioni YIN prima/dopo. Il controller deve decidere anche durante
il canto; non basta applicare un filtro statico.

- Nessuna finestra ammessa dal detector precedente diventa un falso negativo.
- Falsi negativi residui: 14–17/284, contro 220/284 senza riallineamento.
- Mediana e p95 dell'errore sui frame riconosciuti: circa 0,015 e 0,016 cent.
  Questi numeri escludono i falsi negativi; non sono accuratezza complessiva.
- Componente vocale conservata entro 0,5 dB, con differenza numerica prossima
  a zero nei casi provati. Segnali solo tonali non insegnano un ritardo falso.

È una voce sinusoidale nota, non un corpus di canto umano né una prova di
correzione di tutti i semitoni errati già accettati. Restano i transitori
e servono metronomo/musica separati e canto reale per quantificare quei casi.
Rapporto: `artifacts/echo-delay-tracking/voice-quality.json`.

Smoke Chrome con Worker/Worklet reali: guida unica, cinque riaperture Base,
volume ×2/×0,5, salti 1/6 ms e ritorno, voce all'unisono, clipping e cleanup;
upload diagnostico con retry, byte identici e cancellazione del proprietario.
Il percorso sintetico statico verifica circa 34 dB. Home → brano e timeout
di caricamento superati separatamente. Nessuna nuova azione di calibrazione;
musica dominante, aggiornamento automatico, dettagli nello stato esistente.
Screenshot 1366×768 e 390×844 nei rapporti browser dell'artefatto.

## Conferma ancora necessaria

Congelare il pacchetto, misurare sul S25+ senza cambiare volume/posizione,
registrare raw/riferimento/previsione/trattato e tempi del tracking. Separare
probe, musica e metronomo; conservare fallimenti e transitori. Ripetere ai
livelli effettivi 8/15 e 11/15 prima di sostenere robustezza al 75%. Nessuna
riduzione del veto clipping per far passare il test. Un nuovo canto serve
soltanto dopo la conferma acustica, per valutare attacchi e errori F0 reali.

## Primo tentativo di conferma sul dispositivo

Build congelata `20261020-115221-46c4b97f1322-dirty`, S25+ su Chrome, volume
temporaneo 8/15, originale 11/15 ripristinato e verificato. Acquisizione
`device-confirmation-20261020-121437`: 480.000 campioni a 48 kHz, picco 0,6996,
zero campioni oltre 0,98. Modello accettato: train 24,86 dB, verifica 23,14 dB,
picco della risposta a 153,06 ms. Il filtro è realmente applicato nel grafo.

Il tentativo si interrompe dopo 55 s, durante l'analisi della verifica vocale
breve: **nessun holdout indipendente post-calibrazione o click viene acquisito**.
Il fallimento non viene escluso dal registro e i 23,14 dB non sono presentati
come esito del test live ancora mancante. Microfono rilasciato al termine;
audio recuperato dalla RAM senza chiedere di scaricare file.

1.107 risposte del Worker live: RTT mediano 1,30 ms, p95 3,90 ms, massimo
11,90 ms, nessuno oltre 350 ms. Sono tempi di messaggistica/calcolo/completamento
osservati dal main thread, non una misura isolata della CPU o del render audio.
Un Worker vocale separato completa poi 400 finestre tratte dal PCM reale in
430,7 ms di elaborazione, 1.313 ms totali. Il ritardo iniziale non viene quindi
attribuito al solo costo DSP; caricamento o mancata risposta restano da isolare.
Il test di calcolo incompleto non modifica o convalida il profilo vocale.

Artefatti privati: `artifacts/echo-delay-tracking/device-confirmation-20261020-121437`,
`device-voice-worker-check.json`. SHA-256 del PCM recuperato `calibration.npz`:
`387f6cbfdf21577a2551d4c4729043735578f21f72ba9a64912fdb2dd8e069af`.

## Secondo tentativo: salto durante l'identificazione

Stessa build, volume effettivo 8/15 e silenzio confermato dall'utente.
`device-confirmation-20261020-121959`: picco 0,6869, nessun campione oltre
0,98; calibrazione rifiutata, train 2,13 dB e verifica 1,80 dB. Anche qui
nessun holdout live o metronomo viene avviato. Volume 11/15 ripristinato.

Correlazione normalizzata su finestre del riferimento da 150 ms, cercando
nel microfono i successivi 300 ms: il primo tentativo conserva 153,0625 ms
per entrambe le emissioni; il secondo passa da **128,5208 a 168,5208 ms**
fra le finestre centrate sul riferimento intorno a 4,0–4,15 s. Sono **1.920
campioni / 40 ms durante il primo rumore**. Il ritardo rimane poi stabile,
anche sul secondo rumore. Le finestre sovrapposte non localizzano il salto
al campione: l'intervallo temporale è approssimativo, l'ampiezza del salto
è stimata dai due plateau. Correlazione del picco circa −0,43/−0,45; viene
scelto il massimo in valore assoluto, non è scambiata l'inversione di segno
per assenza del riferimento.

Questo fallimento non è spiegato da saturazione sopra la soglia né autorizza
ad accusare un movimento dell'utente. Un unico H stimato su due allineamenti
è un modello inadeguato del tratto finale. Il punto esatto della catena Android
che modifica la latenza non è ancora identificato. Il limite live ±20 ms
del candidato non basta per questo nuovo salto; inoltre il filtro è rifiutato
prima che quel follower possa avviarsi.

### Ablation di sviluppo con storia causale

La semplice riduzione del training a 4,5–7 s con lo stesso fit FFT dà solo
9,16 dB sul secondo segnale; tagli successivi 4,75/5 s danno 8,34/6,94 dB.
Non è stata adottata questa scorciatoia: tagliare la storia del riferimento
introduce un errore al bordo. Questi sono confronti esplorativi, non selezione
di un iperparametro sul test da distribuire.

Un problema lineare regolarizzato a storia completa usa il riferimento
3–7 s e penalizza l'errore del microfono soltanto nel tratto stabile 4,5–7 s.
Supporto causale 750 ms e regolarizzazione 0,002 dell'energia del riferimento;
nessun campione 7–10 s entra nella stima. Risoluzione CG con limite 60 passi:

| Stima offline | Training usato nella perdita | Verifica 7–10 s |
| --- | --- | ---: |
| Fit FFT distribuito | 3–7 s | 1,80 dB |
| Stesso solver CG, perdita su tutto il training | 3–7 s | 3,64 dB |
| Solver CG, perdita sul solo tratto stabile, storia conservata | 4,5–7 s | **24,06 dB** |

Il confronto con lo stesso solver separa l'effetto della selezione temporale
da quello del cambio di stimatore. Il CG su tutto il training converge in
37 iterazioni; quello mascherato raggiunge il limite di 60, senza convergenza
alla tolleranza fissata. Il modello approssimato produce il valore riportato:
non viene dichiarata una soluzione esatta. Il tratto stabile è scelto dopo
l'ispezione del training: è un'ablation di sviluppo, non una nuova verifica
cieca e non è il DSP in funzione sul telefono.

Tempo desktop del solver mascherato circa 1,78 s: non dimostra costo accettabile
nel Worker mobile. Niente modello rifiutato viene riapplicato alla sessione.
Il target ≥20 dB è raggiunto sul secondo rumore in questa ablation, non sul
metronomo, durante il canto o nel test live completo.

Artefatti: `confirmation-delay-comparison.json`, `device-confirmation-delay.png`,
e `fit_stable_train.py` in `artifacts/echo-delay-tracking/`; dati e report dei
solver nella directory del secondo tentativo. SHA-256 di `calibration.npz`:
`1c4a58818180ae550c3e783ac41707fa45016d10f5ce32e0f13db20742da3c67`.
La figura applica il filtro del tratto finale anche prima del salto solo per
illustrare l'incompatibilità dei due regimi: non simula un trattamento causale
disponibile prima della stima.

## Requisiti del prossimo candidato, prima di altre prove umane

1. Gestire disponibilità e timeout del Worker vocale: il primo tentativo non
   deve poter rimanere indefinitamente su Verifica del segnale. Distinguere
   caricamento, elaborazione, risposta e annullamento, preservando il profilo
   precedente senza inventare una verifica riuscita.
2. Rilevare la non stazionarietà durante la calibrazione, con decisioni sul
   solo training. Identificare H sulla catena finale conservando la storia
   del riferimento, oppure ripetere automaticamente una sola misura dopo
   l'assestamento. Non cambiare le soglie per accettare un filtro sbagliato.
3. Verificare salti di almeno ±40 ms e il margine causale negativo effettivo,
   senza traslare la voce o aumentare i falsi negativi per nascondere il residuo.
4. Congelare parametri/build e completare una nuova acquisizione a quattro
   canali con rumore e metronomo separati; soltanto dopo chiedere canto reale.

Non vengono richieste altre ripetizioni in silenzio prima di aver riprodotto
e verificato questi casi sugli audio già acquisiti.
