# Santo: diagnosi acustica sul test reale del telefono

**Status:** measured diagnosis; offline correction validated on a separate quiet interval; live fix pending  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-19

## Risultato principale

Il modello del rientro viene applicato con un ritardo eccessivo di **1196
campioni a 48 kHz, pari a 24,9167 ms**, rispetto al percorso della prova reale.
La sottrazione attuale introduce quindi una copia fuori fase della base;
nell'introduzione confermata in silenzio il livello aumenta invece di calare.
Il controllo del solo guadagno non può correggere questo errore temporale.

L'utente conferma: introduzione senza cantare, poi parte del tenore, volume
del telefono invariato dopo la calibrazione e durante il test. Non è quindi
necessario un cambio manuale di volume per osservare il difetto. Il punto
preciso che cambia la latenza nella catena browser/dispositivo resta da
identificare: riapertura del microfono, avvio dei contesti e avvio dei media
sono ipotesi da strumentare, non cause singolarmente dimostrate.

## Dati e integrità

Test di Santo Frisina P3, 19 ottobre 2026 alle 21:34 italiane, durata 60 s,
48 kHz, quattro canali IEEE float32, build
`20261019-192000-46c4b97f1322-dirty`. SHA256 del WAV:
`308dcb8094285fc1ea13a243818cd3814ee5917a6cda6fba568f77c63b65cf38`.
Il file è stato recuperato attraverso il percorso operatore autorizzato,
verificando consenso, scadenza e proprietario, senza cookie o link pubblici.
Audio, metadati estesi e figure restano nella cartella privata ignorata da Git
`artifacts/echo-diagnostics/b04e8621-73fc-4906-86d7-c32e752b2450/`.

Mixer effettivamente registrato: master 62%, organo 40%, soprano 50%, contralto
50%, tenore 100%, basso 50%, metronomo 30%, tutte le voci abilitate,
normalizzazione 1/√5, velocità 100%, trasposizione zero. Il browser dichiara
AEC, noise suppression e AGC disattivati. Questo non prova l'assenza di ogni
DSP interno del telefono, ma esclude le tre opzioni esposte attive.

La relazione `processed = raw - prediction` è verificata campione per campione,
con RMS dell'errore numerico 2,63e−9. Il convolutore corrisponde alla
convoluzione offline di riferimento e H: nessun ritardo aggiuntivo misurato,
errore relativo 3,18e−7. Non è un artefatto dell'export o un extra-delay del
ConvolverNode in questa acquisizione.

RMS globale: raw 0,08297, trattato 0,09153, previsione 0,03816. Il raw non ha
campioni oltre ±1; il trattato ne ha cinque. Un float oltre ±1 non dimostra
clipping fisico, e non attribuiamo a questo la causa principale.

## Misura del disallineamento

Correlazione della previsione registrata con il microfono, su finestre da 2 s,
con ricerca entro ±250 ms: da 2 s in avanti il massimo è sempre a −1196
campioni. Nel primo intervallo l'avvio introduce un transitorio separato,
escluso dalla stima. Nell'introduzione la correlazione senza riallineamento è
vicina a zero; dopo il riallineamento è circa 0,97–0,99. Durante il canto resta
lo stesso ritardo, mentre la correlazione diminuisce per la voce indipendente.
Questo esclude un drift progressivo del clock come spiegazione dominante
del minuto registrato.

H della calibrazione aveva un picco a 184,06 ms e una verifica dichiarata di
20,56 dB; quel successo si riferiva alla catena della calibrazione, non
garantiva quella della prova. In 3747 callback, 3736 risultano “waiting”,
11 “automatic”; gain resta sempre 1. I metadati non conservano la reason
fine del gain worker, quindi non distinguiamo a posteriori ogni rifiuto tra
segnale tonale, voce e percorso cambiato. Il codice rifiuta correttamente un
adattamento ambiguo, ma continua ad applicare il vecchio filtro.

## Confronto indipendente sul rientro

Stima solo sui secondi **2–10** dell'introduzione, verifica separata **10–16**,
prima del canto. Il ritardo e il gain ottimo 1,324 vengono poi congelati per
tutto il file. Nessun target dello spartito entra nella stima. Il gain è un
coefficiente del modello, non una misura del volume di sistema o la prova
che l'utente lo abbia cambiato.

| Variante | Riduzione RMS 2–10 s | Riduzione RMS 10–16 s |
| --- | ---: | ---: |
| Trattamento registrato | −1,93 dB | −1,89 dB |
| Solo riallineamento | 9,38 dB | 9,09 dB |
| Riallineamento + gain congelato | 12,30 dB | 11,64 dB |
| Riallineamento + piccolo FIR sul riferimento | 13,65 dB | 12,81 dB |

Il confronto è rispetto al microfono raw nello stesso intervallo. Nel hold-out
raw RMS 0,04280, trattato 0,05321, ritardo+gain 0,01121: circa **13,53 dB in
meno rispetto al trattamento attuale**, non una percentuale di accuratezza F0.
Il FIR esplorativo ha 11 tap, stima solo sul train e non viene selezionato o
rifittato sulla voce. I residui del click restano visibili: il solo ritardo
non dimostra cancellazione completa, né un modello lineare universale.

## Altezze: stessi frame ammessi

Replay del detector del repository, finestra 2048 e parametri realmente
registrati per callback. L'offset del bridge fra PCM e callback è stimato
separatamente confrontando RMS: circa 26 ms. È diverso dal disallineamento
del rientro. Il round-trip YIN corrente rispetto al raw Hz live ha mediana
1,00 cent, 92,5% entro 50 cent; il P95 è 283 cent. La temporizzazione dei
transienti non è quindi perfettamente riproducibile; non trattiamo ogni
singolo callback come una misura campione-esatta dell'app originale.

Ogni variante può cambiare **solo** l'altezza di un frame ammesso live. Se
non trova un candidato, mantiene il pitch originale. Gli assert verificano
maschera identica: nessuna nuova ammissione, nessun buco aggiunto. I falsi
positivi restano per definizione: nell'introduzione 2–16 s, 114 callback su
875 erano ammessi pur in assenza di canto confermata dall'utente.

Su due segmenti contestuali di sostegno, confronto allo spartito (Sol3 circa
196 Hz), usato **solo per descrivere i risultati**, mai come input al detector:

| Segmento | Frame ammessi | Live: sopra target di oltre 100 cent | Ritardo+gain: sopra di oltre 100 cent |
| --- | ---: | ---: | ---: |
| B9, 28,55–29,75 s | 68 | 3 | 0 |
| B17, 57,0–59,1 s | 119 | 4 | 0 |

In B9 anche il controllo YIN corrente senza smoothing ha 4 frame oltre
100 cent, contro zero riallineati; in B17 ne ha 6 contro zero. Il miglioramento
non è quindi spiegato solo dalla rimozione del tracker. Lo spettro mostra
una struttura armonica di sostegno e interferenze del click/base; la correzione
le riduce senza avvicinare artificialmente il pitch alla nota attesa.

La finestra B17 57,0–59,1 s è **esplorativa**, individuata ispezionando il
sostegno prima del respiro. Non è un test indipendente scelto prima di guardare
i dati. La finestra iniziale più ampia 56,8–59,6 s comprende il rilascio:
su quella, ritardo+gain da solo può peggiorare il P95 di accordo allo spartito
(268,9→308,5 cent). Non nascondiamo la regressione e non adottiamo la variante
come soluzione globale. Il respiro non è una nota stonata; la nota può finire
prima della durata scritta. Vedi il [contratto musicale](../../product/musical-performance-quality.md).

Non esiste una registrazione isolata della sola voce o un'annotazione F0
indipendente. Questi numeri descrivono accordo e anomalie del segnale,
**non** accuratezza assoluta del cantante o balanced accuracy del detector.

## Confine della correzione live

Il detector distribuito non è stato modificato da questa analisi. Non si deve
inserire un offset universale di 25 ms o un gain universale 1,324: appartengono
a questa acquisizione. La prova offline anticipa la previsione e usa qualche
campione futuro; la versione live deve invece aggiornare un H **causale**
verificato sulla catena corrente, prima del canto.

Intervento richiesto: riverificare il percorso quando microfono, contesti
audio e pipeline dei media sono tutti attivi, con breve eccitazione nota e
countdown di silenzio, stima/verifica separate. Mantenere congelata la risposta
durante il canto. Serve controllare anche la risposta ai transienti del click.
Una calibrazione prima della successiva riapertura del microfono o dell'avvio
della pipeline media potrebbe riprodurre lo stesso errore.

Registrare per la verifica tecnica reason del monitor, sample rate e latenza
esposta dei contesti/traccia può aiutare a individuare il punto che cambia;
la compatibilità dell'input non deve essere ridotta al solo deviceId.
La riduzione dei falsi positivi delle pause richiede un intervento separato
con verifica del richiamo della voce debole. Non si stringono gate per
nascondere il problema acustico, né si usa lo spartito per correggere la voce.

## Riproducibilità

```text
python scripts/fetch_echo_diagnostic.py --id b04e8621-73fc-4906-86d7-c32e752b2450
python scripts/analyze_echo_diagnostic.py artifacts/echo-diagnostics/b04e8621-73fc-4906-86d7-c32e752b2450
python scripts/probe_santo_alignment.py artifacts/echo-diagnostics/b04e8621-73fc-4906-86d7-c32e752b2450 --quiet-intro-confirmed
node scripts/replay_echo_pitch.cjs artifacts/echo-diagnostics/b04e8621-73fc-4906-86d7-c32e752b2450
python scripts/plot_echo_diagnostic.py artifacts/echo-diagnostics/b04e8621-73fc-4906-86d7-c32e752b2450
python scripts/analyze_echo_diagnostic_test.py
```

Il recupero remoto funziona solo finché consenso e scadenza sono validi.
Dipendenze scientifiche locali: numpy, scipy, matplotlib. Output: audit JSON,
ablation JSON, replay a maschera fissa, contesto delle battute e figure PNG/PDF.
I tre test controllano segno del ritardo, assenza di wrap e coefficiente della
voce indipendente a pari F0 per più fasi/livelli con riferimento congelato.
Non costituiscono una validazione della preservazione vocale su ogni telefono.
