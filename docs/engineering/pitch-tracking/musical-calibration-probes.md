# Segnale musicale per il controllo AEC nativo

**Status:** suspended after device regression report; broadband noise restored  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Stato corrente

L'esperimento musicale è sospeso: l'utente ha segnalato che dopo la nuova
calibrazione la voce non veniva più riconosciuta, mentre con il rumore
funzionava. Il nesso causale e lo stadio del problema non sono ancora
confermati da una misura sul telefono. Il runtime ripristina i due segnali
`Core.noise` precedenti, ampiezza 0,08 e seed 173/957, agli istanti 2 e 5 s.
Sono generati nel sample rate del contesto, senza rete o decodifica musicale;
il guadagno corrente dell'app si applica una volta nel bus di uscita.

Soglie vocali, selezione del profilo e impostazioni AEC/NS/AGC restano invariate.
I nuovi profili registrano `speakerProbeId` per distinguere il segnale usato;
i vecchi profili restano compatibili e non si cancellano globalmente. Un
profilo problematico può essere sostituito con **Ricalibra**. I WAV, la
partitura e i test sperimentali restano disponibili per futuri confronti,
ma non vengono usati dalla calibrazione corrente.

Il test confronta campione per campione i buffer runtime con i segnali
preesistenti a 8, 44,1 e 48 kHz. Il confronto musica/rumore sul controllo
assoluto rimane una prova del gate, non dell'AEC reale: non va usato come
criterio sufficiente per ripubblicare la variante musicale.

La successiva diagnosi sul Samsung ha identificato una causa software distinta:
nel riuso del profilo il microfono veniva aperto ma il ciclo di analisi live,
fermato dalla preparazione, non ripartiva. Nel test con Santo il detector
diretto riconosce 72 finestre su 91 nella fase di canto con base, mentre il
pitch live rimane sempre nullo. `verifyPlayback()` ora richiama
`resumeAnalysis()` dopo il ripristino. Questo difetto si riproduce anche con
il rumore già ripristinato e non dimostra una soppressione della voce dovuta
agli archi. Non serve ricalibrare per applicare la correzione.

## Segnale sperimentale e scopo

L'esperimento del controllo nativo iniziale usava due battute del Preludio in Do maggiore
BWV 846 di Bach, arrangiate ed esportate localmente da MuseScore 4 con
MuseScore Basic. Il [sorgente Mutopia](https://www.mutopiaproject.org/ftp/BachJS/BWV846/wtk1-prelude1/)
dichiara Public Domain. L'export degli strumenti MS Basic è accompagnato
dalla licenza MIT e dagli acknowledgement installati con il SoundFont.
Partitura e ricetta sono in `misc/audio-calibration/` e
`scripts/build_calibration_music.py`; non si pubblicano registrazioni altrui.

Il segnale verifica un residuo assoluto dopo l'AEC di piattaforma. Non si
stima una risposta impulsiva, non si misura ERLE e non si certifica il
comportamento su ogni brano o volume. Il percorso custom tecnico continua
a usare rumore a banda larga: un arpeggio non lo sostituisce come stimolo
per l'identificazione di un filtro H.

## Proprietà conservate

- Due passaggi mono di 2 secondi, a 48 kHz PCM16; note in 4/4 a 120 BPM.
- Posizioni: 2–4 s e 5–7 s, dentro la cattura di 8 s già esistente.
- RMS prima del guadagno dell'app: circa 0,046187, equivalente al rumore
  uniforme precedente con ampiezza 0,08 (differenza entro 0,001 dB).
- Picchi dei WAV: circa 0,189 e 0,213; dissolvenze di 35 ms, estremi nulli.
- Il guadagno applica il livello corrente dell'app tra 0 e 1. Nessun
  compressore o limiter e nessuna modifica alle soglie del detector vocale.
- La soglia del residuo resta RMS ≤0,004 nel tratto 2–7,8 s e picco <0,98.

Welch sull'export effettivo: circa 30–35% dell'energia tra 80–300 Hz,
50–53% tra 300–1000 Hz, 14–16% tra 1–4 kHz e 0,18–0,19% tra 4–10 kHz.
È un segnale musicale ricco di armoniche, non uno stimolo a spettro uniforme.
Il controllo privilegia il registro musicale utile; non verifica ogni
frequenza con la stessa energia del precedente rumore.

## Caricamento e interruzioni

`calibration_probe.js` scarica e decodifica solo quando viene richiesta
una misura nativa. Controlla durata, canali, RMS, picco e campioni finiti.
Il caricamento ha un limite di 10 s e la preparazione complessiva 12 s.
La cattura e i suoni non iniziano prima dei buffer disponibili; un errore
è recuperabile e non torna silenziosamente al rumore. La cache è per
AudioContext e scarta i caricamenti falliti. Annullamento, cambio account,
track e contesto conservano le invalidazioni esistenti.

La build include WAV e attribuzioni con nomi fingerprintati; il caricatore
contiene i riferimenti aggiornati. Nessun pacchetto MSCZ, XML o SoundFont
entra negli asset distribuiti. Le istruzioni native parlano di archi e di
due brevi passaggi musicali, con durata e countdown invariati. I crediti
sono nei dettagli, senza competere con l'azione principale.

## Verifica e limite reale

I test eseguono il gate nativo usando il PCM realmente esportato, con
ritardo sintetico e due residui: uno basso e uno forte. Musica e rumore
passano/rifiutano rispettivamente con la stessa soglia. È una verifica
del controllo, non una simulazione dell'adattamento interno dell'AEC.
Sono coperti anche errore di caricamento senza cattura, retry, durata,
energia, decodifica, cancellazione e assenza di nuove misure dichiarate
al riuso del profilo.

Lo smoke Chromium carica i WAV della build e verifica due source da 2 s
separati da 3 s tra gli inizi, livello RMS e provenienza nel journal. Guida,
Play, riuso, ricarica, isolamento di account/microfono e lifecycle restano
coperti. Il confronto acustico musica/rumore sul S25+ rimane da eseguire:
il telefono non era collegato durante questa preparazione. Non si deduce
equivalenza acustica sul dispositivo dai soli test sintetici.
