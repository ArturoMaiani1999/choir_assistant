# Diagnosi del rientro e dei salti brevi segnalati su Santo

**Stato:** audit del codice e riproduzioni sintetiche, 2026-10-18.
Nessuna misura del telefono dell'utente e nessuna modifica al runtime/deploy.

**Aggiornamento:** l'utente conferma Chrome su Samsung S25+ e aumento del
volume dopo la calibrazione. La ricerca per il brano, oltre il solo account
inizialmente indicato, trova il best score condiviso di Santo sotto il profilo
**Arturo Maiani** (77%, copertura 82,371%, 2026-10-18 20:18:40 UTC).
L'immagine è stata scaricata con accesso operatore e ispezionata: mostra
effettivamente escursioni brevi, anche nelle zone indicate. Non esistono trace
di practice_attempts né una registrazione personale associata a quella prova.
Il PNG da solo non permette di ricostruire microfono, riferimento o YIN raw.
Il seguito implementativo è descritto nel
[contratto di adeguamento automatico](reference-echo-cancellation.md#adeguamento-automatico-del-livello).
L'analisi e i numeri sotto descrivono la v1 precedente al follower di guadagno.

## Dati effettivamente disponibili

L'utente segnala metronomo residuo, falsi positivi a volume alto e brevi salti
di un tono durante una nota sostenuta in B 9.1, B 17.1 e B 17.2 di Santo.
Una query remota in sola lettura, limitata al member_id autorizzato di Arturo
Maianovksi, non trova Santo in practice_attempts, best_performances o
personal_recordings. Le sole righe disponibili riguardano O sacrum convivium.
Non sono state consultate registrazioni di altri utenti.

Il grafico corrente può esistere soltanto nel localStorage del dispositivo.
Non equivale a una registrazione audio condivisa. In modalità altoparlanti
la registrazione personale/automatica grezza è disabilitata; modello acustico,
microfono e riferimento restano in RAM. Non è quindi possibile recuperare da
R2 il PCM di questa prova sulla base dei dati attualmente trovati. I tre punti
indicati restano da verificare sulla traccia reale.

## Riscontri sul codice

- `playMetronomeClick()` collega il click a `playbackMixer.referenceOutput`
  quando la riduzione è abilitata. Il riferimento contiene già il metronomo.
- Il modello H è congelato; non segue guadagno, ritardo o deriva del percorso.
  Dopo la misura il microfono viene fermato e riaperto al Play. Settings uguali
  non dimostrano che il ritardo effettivo delle due acquisizioni sia uguale.
  Questo è un rischio da misurare, non una deriva osservata sul telefono.
- Il fruscio ha picco `0.08 * volume_app`; il click arriva a `0.5 * volume_click`
  (accentato), con inviluppo di frequenza e ampiezza molto breve. La verifica
  sul fruscio non verifica separatamente transitori, base reale e livelli forti.
- Il controllo del clipping riguarda soltanto il microfono durante la misura.
  Non esclude un limiter nelle casse né distorsioni a livelli superiori.
- Il gate usa la riduzione RMS globale della verifica per stimare un residuo,
  con hold 300 ms e massimo 0,01. Non misura il vero residuo durante il canto,
  non verifica separatamente le bande e non sa se il filtro è ancora valido.
  Alzare semplicemente il gate scarterebbe anche voci deboli.
- YIN live sceglie un minimo di periodicità in un segnale assunto monofonico.
  La confidence non distingue l'identità del cantante da un residuo periodico.
  Il pYIN del laboratorio offline non è il detector della prova live.
- `PitchSmoother` accetta salti raw fino a 300 cents senza conferma del cambio;
  mediana ed EMA attenuano il disturbo ma non verificano che sia voce. Un tono
  è 200 cents: non attiva la protezione dai salti grandi/d'ottava.

## Esperimento riproducibile

Eseguire dalla root:

```powershell
node scripts/diagnose_echo_cancellation.cjs artifacts/echo-cancellation/diagnosis.json
```

Il comando non legge audio privato né usa rete. Verifica con assert la validità
delle calibrazioni, la base di controllo, la presenza di falsi positivi dopo
un cambio di guadagno e la diversa risposta a spike di uno/due frame.

Si usa il vero core di identificazione, YIN e tracker live, preset normale
corrente, 48 kHz, frame 2048 e hop 800 (60 letture/s). Il percorso sintetico
ha tre tap ritardati, picco a 15,02 ms. La verifica indipendente misura 35,86 dB.
Il gate residuo è riprodotto con allineamento ideale; il trasferimento reale
tra contesti e i suoi eventuali disallineamenti non sono simulati. I segnali
durano tre secondi e generano 178 osservazioni: non è un dataset bilanciato e
non permette di stimare la balanced accuracy del prodotto.

| Caso senza cantante | Riduzione sulla prova | Frame accettati come nota / 178 |
| --- | ---: | ---: |
| Tono, percorso identico | 40,90 dB | 0 |
| Tono, guadagno acustico ×2 dopo misura | 5,95 dB | 176 |
| Tono, ritardo aumentato di 128 campioni (2,67 ms) | −5,67 dB | 176 |
| Note variabili, ritardo aumentato di un campione | 29,21 dB | 91 |
| Metronomo, percorso identico | 36,79 dB | 0 |
| Metronomo, guadagno acustico ×2 dopo misura | 5,93 dB | 8 |

Il modello non lineare è `0.08 * tanh(x / 0.08)` **sia durante la calibrazione
sia durante la prova**, prima dello stesso percorso acustico. Il volume resta
costante: il fruscio debole supera la verifica (21,48 dB), ma il tono più forte
produce solo 11,05 dB di riduzione e 176 falsi frame; sul click la riduzione è
−0,82 dB. Non servono necessariamente un cambio di volume dopo la misura o
clipping digitale del microfono per invalidare il modello lineare.

Il tono a 220 Hz insieme a una voce indipendente a 220 Hz resta intorno a
219,97–220,03 Hz quando il percorso coincide. Con una voce fissa a 220 Hz e
un residuo più forte a 246,94 Hz dopo cambio di guadagno, il tracker accetta
241,82–243,20 Hz: una nota vicina e sbagliata senza alcun cambiamento della voce.
Il caso non dimostra che questo sia successo nei punti di Santo.

L'esperimento di continuità alimenta direttamente il tracker con stime raw
affidabili a 220 Hz, sostituite brevemente da un valore a +200 cents:

| Disturbo raw a 60 Hz | Mediana | Massima deviazione accettata |
| --- | ---: | ---: |
| Un frame | 3 | 0 cents |
| Due frame | 3 | 175,5 cents |
| Tre frame | 3 | 191,425 cents |
| Un frame | 1 | 130 cents |

Un errore per due letture corrisponde qui a circa 33 ms di stime errate; ogni
lettura contiene circa 43 ms di audio e finestre successive si sovrappongono.
Non significa che il disturbo acustico duri esattamente 33 ms. La cadenza reale
su telefono può essere inferiore a 60 Hz. Una sola lettura errata col preset
normale e mediana 3 viene rimossa: non attribuire ogni singolo spike a questa
causa senza conoscere impostazioni e stime raw.

## Interpretazione e prossima verifica

La riproduzione conferma che la v1 può passare la calibrazione e fallire con
base/metronomo nelle condizioni descritte. Non dimostra quali condizioni
fossero presenti nel telefono di Arturo. I precedenti test con stanza lineare
invariata verificavano un caso favorevole; non coprivano questi regressori.

Prima di modificare le soglie o il tracker:

1. Individuare URL, dispositivo/browser e se il volume era già alto durante
   la misura. Recuperare la traccia di Santo se salvata/condivisa, preservando
   le impostazioni e la distinzione fra raw, TrackedPitch e DisplayPitch.
2. Aggiungere una raccolta diagnostica esplicita e limitata: riferimento
   realmente emesso, microfono grezzo e somma trattata sullo stesso clock;
   sample rate, H, tempi di apertura stream, impostazioni e stime raw/tracked.
   Nessun invio implicito o riutilizzo del consenso cuffie per audio grezzo
   con base. Il solo grafico non separa le cause acustiche.
3. Con lo stesso stream aperto, verificare in silenzio base reale e metronomo
   al volume di utilizzo; misurare transitori e bande, non solo un RMS globale.
   Rifiutare la misura se il percorso è non lineare o non ripetibile. Un nuovo
   stream richiede riallineamento/verifica prima di fidarsi di H.
4. Valutare tracking di ritardo/guadagno solo in intervalli verificati senza
   canto, con blocco rigoroso durante double talk. Con voce e base correlate
   non è possibile promettere una separazione perfetta; non apprendere H dalla
   voce, non usare notch né attrazione verso la nota attesa.
5. Per i salti brevi confrontare continuità con baseline su note realmente
   fisse, cambi legittimi di un tono, vibrato e note corte. Misurare falsi
   cambi, omissioni e ritardo d'attacco prima di introdurre una conferma.
   Il rendering da solo non corregge TrackedPitch né lo scoring.

La documentazione [SpeexDSP](https://www.speex.org/docs/manual/speex-manual/node7.html)
spiega l'importanza dell'allineamento e il limite delle distorsioni non lineari.
Il codice [WebRTC AEC3](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/aec3/block_processor.cc)
gestisce separatamente buffer di rendering, stima del ritardo e aggiornamenti
dell'allineamento. Sono riferimenti per l'analisi, non componenti già presenti
in questa implementazione.
