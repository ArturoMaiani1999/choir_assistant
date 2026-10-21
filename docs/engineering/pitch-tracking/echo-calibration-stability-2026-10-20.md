# Stabilità della calibrazione sul S25+

## Problema e candidato

Le due acquisizioni precedenti separano una catena stabile a 153,0625 ms da
una catena che passa da 128,5208 a 168,5208 ms durante il training. Il secondo
fit non supera la verifica. Il primo supera il fit, ma la guida si arresta
nell'analisi vocale. Sono due problemi distinti.

Il candidato prepara il Worker vocale prima dei suoni, con timeout di
caricamento di 12 s e di analisi di 15 s. Non cancella il profilo salvato
in caso di errore e non lo considera nuovamente verificato.

Il controllo del training cerca cambiamenti confermati di ritardo, usando
solo finestre precedenti al segnale indipendente di verifica. Se trova un
cambio, ripete automaticamente una sola volta la misura sulla stessa
catena aperta. Un secondo fallimento interrompe il controllo. Non modifica
le soglie del fit, il segnale vocale o i criteri del pitch detector.

Parametri e comportamento utente sono descritti nella
[calibrazione unica](unified-audio-calibration.md).

## Evidenza di sviluppo

- Le due registrazioni reali sono classificate rispettivamente come stabile
  e instabile. I report `stability-candidate.json` sono nelle directory
  `device-confirmation-20261020-121437` e `device-confirmation-20261020-121959`,
  sotto `artifacts/echo-delay-tracking/`.
- Test sintetici a 32, 44,1, 48 e 96 kHz riconoscono salti di entrambi i segni
  di 40 ms, anche con percorso acustico invertito. Cambiare il holdout non
  cambia la decisione. Silenzio e percorso stabile non provocano ripetizioni.
- Il browser, con Web Audio e Worker reali, passa da 35 a 75 ms durante il
  primo training. La guida ripete una volta, applica un solo modello e stima
  75 ms; riduzione indipendente 34,29 dB. È una catena sintetica.
- Percorso normale: 34,30 dB, riuso del profilo, cinque riaperture di Base,
  Play, annullamento, cambio dispositivo, background e permesso tardivo.
- Worker vocale senza risposta di disponibilità: nessun suono di misura,
  microfono rilasciato. Worker disponibile ma senza risposta all'analisi:
  timeout, microfono rilasciato e nessun risultato applicato.
- Typecheck e 89 test API passati; suite DSP/calibrazione e test aggiuntivo
  del limite di una ripetizione passati; 12 controlli packaging passati.
  Screenshot desktop 1366×768 e mobile 390×844 ispezionati.

Artefatti browser e pacchetto: `artifacts/echo-calibration-stability/`.
Il primo collaudo del timeout usava un'attesa totale troppo breve per
comprendere la guida più 15 s: attesa corretta e collaudo ripetuto con esito
positivo. Il limite di analisi del prodotto non è stato allungato.

## Limiti e prossima misura

Questo candidato non amplia il follower live oltre ±20 ms e non implementa
un pilot audio. Prima di cambiare il tracking durante il canto, la misura
successiva deve completare calibrazione e acquisizione live a quattro
canali, con rumore indipendente e metronomo. Tutti i tentativi, compresi
quelli rifiutati e ripetuti, vengono conservati negli artefatti del probe.

L'obiettivo resta almeno 20 dB sul rumore di verifica, riportando separatamente
gli attacchi, l'intervallo completo e il metronomo. Il canto reale richiede
una verifica successiva: i risultati sintetici non dimostrano assenza di
falsi negativi o accuratezza F0 sul telefono.

## Prima prova reale del candidato

Artefatti: `artifacts/echo-calibration-stability/device-confirmation-1`.
Volume iniziale 3/15, misura a 8/15, ripristino verificato a 3/15.
La prima calibrazione supera il fit con 24,31 dB training e 20,94 dB
verifica, ritardo stabile a 134,48 ms. Il Worker vocale risponde in 532,5 ms,
ma rifiuta il riuso del profilo. La guida completa riparte e ripete anche
la misura acustica: 24,26/19,10 dB, ritardo stabile a 153,15 ms.
Questa seconda misura non è il retry per instabilità: entrambi i training
sono stabili. Il test viene fermato alla richiesta di canto. Nessun
holdout live a quattro canali è stato acquisito in questa prova.

Per isolare l'acustica, il probe dispone ora di `--acoustic-only`, attraverso
`microphoneCalibrationUI.measureAcoustic()`. L'ingresso tecnico usa apertura
microfono, warmup e misura della guida, senza verificare o salvare il profilo
vocale. Non aggiunge un pulsante alle impostazioni dell'utente. Chiusura e
annullamento rilasciano la sessione; il probe esegue sempre cleanup e
ripristino del volume.

Il collaudo locale di questo ingresso registra 480.000 campioni per ciascuno
dei quattro canali a 48 kHz, senza errori, con profilo vocale non verificato.
Questo abilita la prossima misura; non è evidenza di qualità acustica reale.
