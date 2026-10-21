# S25+: confronto AEC completo e voce piano con click

**Status:** measured on device; native AEC remains probe-only  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Condizioni

Samsung S25+ collegato via ADB/CDP, Chrome 155, staging build
`20261021-080519-6811032c1db7-dirty`. È la release con conteggio campioni
e [controlli espliciti del clock](audio-sample-clock-2026-10-21.md).
Ogni misura è preceduta dalla disponibilità dell'utente; telefono fermo,
Chrome visibile. Un solo microfono per volta. Volume media iniziale 0/15,
impostato a 8/15 o 11/15 e ripristinato a 0/15 dopo ogni prova.

NS, AGC e voiceIsolation risultano false; ingresso e contesto mono a 48 kHz,
latency esposta 40 ms. Il DSP interno della piattaforma non è osservabile:
non assumere che `noiseSuppression:false` escluda ogni soppressione residua
incorporata nell'AEC. Nessun filtro custom applicato in queste misure.
Nessun nuovo deploy, nessun profilo o storico vocale aggiornato.

## Ingresso grezzo → AEC normale → AEC all → grezzo

`artifacts/aec-platform-comparison/device-20261021-clock-1`: quattro catture
da 13 s / 624.000 campioni. Tutte complete, zero skew/gap osservati, nessun
mute/unmute. Le modalità effettive riportano false, true, "all", false.
Nessun campione del microfono supera ±0,98; picchi raw circa 0,698.

Due fruscii indipendenti ai secondi 2 e 5, poi click della funzione reale
dell'app a livello 15% e 30%. Riferimento digitale acquisito sul bus reale.
La variazione fra i due raw, dopo normalizzazione per energia del riferimento,
è 0,072 dB sul fruscio basso e 0,047 dB su quello alto. Sui gruppi di click
è invece -2,39 e -3,32 dB: le baseline non sono copie identiche.

AEC normale: attenuazione sequenziale apparente 68,63 dB nella regione del
fruscio basso, dove rimane un residuo non nullo; silenzio digitale nelle
regioni complete del fruscio alto e dei due gruppi di click. AEC all:
silenzio digitale sui due fruscii e sui click alti, residuo non nullo sui
click bassi con attenuazione sequenziale apparente 35,92 dB.

Sono confronti fra acquisizioni successive, **non ERLE simultaneo**. Il
silenzio digitale non autorizza dB infiniti o una misura finita arbitraria:
il report conserva `relativeAttenuationDb:null`. La regione del fruscio
basso omette il primo avvio dei suoni; non estendere il risultato a convergenza
istantanea o all'intera registrazione. Non emerge un vantaggio necessario
di "all" rispetto alla modalità normale in queste condizioni.

La correlazione globale del primo fruscio nelle due catture raw ha picco
causale circa 179,29 e 153,33 ms. È una differenza fra due aperture della
catena; non una misura di variazione dinamica all'interno della stessa
registrazione. Non usare la latency esposta di 40 ms come ritardo acustico.

## Santo + metronomo + vocale piano

Entrambe le catture vocali durano 17 s / 816.000 campioni e completano con
zero skew/gap, mute/unmute e clipping. Guida: 7 s silenzio, 6 s vocale,
4 s silenzio. Brano Santo, estratto 18–35 s ricostruito in PCM dai cinque
MP3 attuali con guadagni effettivi del mixer, master 62%. Organo 40%,
soprano/contralto/basso 50%, tenore 100%; metadata registrano hash e guadagni
lineari. Click 30% ai secondi 3/4/5, 8/9/10 e 14/15. Non sono transizioni
dei decoder MediaElement né una verifica di un brano intero.

Analisi fissa YIN su finestre 2048/hop 1024, RMS 0,002 e soglia YIN 0,18.
Le finestre guidate escludono 500 ms ai bordi. Non è necessariamente la
configurazione attiva del detector della sessione utente e non è pYIN.

| Prova | Volume | Voce centrale ammessa | Pause guidate ammesse | Mediana F0 |
| --- | --- | --- | --- | --- |
| `device-soft-music-20261021-clock-1` | 8/15 | 212/232 | 35/419 | 172,91 Hz |
| `device-soft-music-20261021-clock-11` | 11/15 | 232/232 | 0/419 | 261,80 Hz |

Nella prima prova le 20 finestre vocali non ammesse sono all'inizio del
tratto centrale, fra circa 7,52 e 7,92 s. Le 35 finestre nominalmente di pausa
con pitch sono tutte fra 13,51 e 14,24 s, sulla stessa nota del canto.
L'utente conferma di avere proseguito dopo il segnale: non classificarle
come falsi positivi del rientro. Prima del canto, 0/280 finestre ammesse;
nel tratto 14,5–16,5 s, 0/92. Le etichette grezze e il report non vengono
riscritti: la conferma rimane in `user-labels.json`.

La prova a 11/15 trova pitch in tutte le 232 finestre vocali centrali e in
nessuna delle 419 finestre di pausa, inclusi i click. È copertura della
guida, non prova di accuratezza F0 o di assenza di falsi negativi universale.
Le due note cantate sono diverse; non attribuire al volume le differenze
fra mediane, copertura o numero di errori armonici. Mancano una registrazione
pulita simultanea e un riferimento indipendente della voce.

## Errore distinto: scelta della prima armonica che supera la soglia

Nel tratto centrale a 11/15, 16 finestre vengono stimate a 516–528 Hz mentre
le circostanti restano circa 260 Hz. Nelle stesse finestre, il candidato
vicino a 260 Hz ha CMND molto più basso: per esempio a 10,0147 s, 259,71 Hz
ha CMND 0,00526 contro 0,12446 a 519,82 Hz. `detectPitch` seleziona il primo
minimo sotto soglia, incontrando prima il periodo più corto. Il fondamentale
rimane quindi osservabile nel segnale AEC: non è necessario sopprimere quelle
finestre per risolvere l'ambiguità. Non è dimostrato se l'AEC alteri il rapporto
fra armoniche rispetto alla voce originale, che non è stata acquisita.

`scripts/analyze_platform_pitch_candidates.py` applica i candidati YIN e il
decoder offline Viterbi già presenti nel progetto. Non usa lo spartito, né
la frequenza mediana come bersaglio. Elabora tutti i tratti contigui già
ammessi dal detector; mantiene la maschera originale e usa il pitch raw
come fallback se il decoder non sceglie una frequenza.

- 11/15: tutte le 16 scelte d'ottava nel tratto centrale diventano candidati
  circa 260 Hz. Rimangono 232/232 finestre centrali e 287/287 ammesse su tutto
  l'audio; zero cambi di maschera. La convergenza iniziale 234→242→250 Hz resta
  una convergenza acustica, non viene appiattita sulla nota centrale.
- 8/15: un candidato isolato a 513,07 Hz diventa 169,54 Hz. Rimangono 212/232
  finestre centrali e 296/296 ammesse sull'intero audio; zero cambi di maschera.

Questi risultati non sono una percentuale di accuratezza e non certificano
gli attacchi o altre melodie. Il decoder vede finestre future: prima di
trasferirlo al live serve una versione causale o a ritardo limitato, verificata
su salti d'ottava realmente cantati, cambi di nota, voci piano e respiri.
Vietato implementare un semplice dimezzamento della frequenza o alzare il
gate per nascondere le finestre problematiche.

## Decisione tecnica e prossimi controlli

Il candidato prioritario è AEC nativo normale, con NS e AGC disabilitati e
controllo dei settings effettivi, seguito da selezione robusta dei candidati
F0 sulla stessa maschera di ammissione. Separare questa catena da quella
custom: non concatenare due cancellazioni senza una prova dedicata. L'app
distribuita mantiene per ora la catena custom; AEC nativo e Viterbi sono
ancora rispettivamente probe e analisi offline.

Prima di adottare la nuova catena: confronto di una melodia completa con
ingresso pulito di controllo; test dei veri cambi di nota/ottava per evitare
che la continuità li impedisca; controllo della latenza aggiunta dal decoder;
volume/posizione diversi; startup e resume senza riusare H della catena
precedente. La calibrazione deve verificare la catena effettiva e la voce,
senza imporre i vecchi fruscii per stimare H quando non si usa la sottrazione
custom. Non è necessaria un'altra calibrazione manuale per ciascun algoritmo.

Grafici riproducibili con `artifacts/aec-platform-comparison/plot-clock-device.py`:
`device-clock-and-soft-voice-20261021.png` e
`device-high-volume-candidate-path-20261021.png`, ispezionati.
Tutti gli audio sono locali, nessun invio a R2. Al termine microfono idle,
tracce terminate, musica ferma, guida chiusa e volume ripristinato a 0/15.
