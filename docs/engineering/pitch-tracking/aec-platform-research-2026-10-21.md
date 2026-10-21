# AEC delle chiamate e confronto con la cancellazione della base

**Status:** research; platform baseline prioritized, no new device result  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

## Conclusione operativa

Prima di estendere il DSP proprietario, confrontare sul S25+ la cancellazione
attuale con l'AEC esposto da Chrome/Android, da solo. Misurare separatamente
eco residuo e conservazione della voce cantata. Non sommare due cancellatori
nel primo confronto: un filtro H appreso sul microfono grezzo non descrive
il microfono già trattato da un AEC adattivo.

Il codice corrente in `frontend/app.js` richiede `echoCancellation:false` e
`noiseSuppression:false`; con gli altoparlanti richiede anche AGC disabilitato.
Il modello H resta congelato dopo il fit, con aggiornamenti conservativi del
guadagno e del ritardo. Non è la catena completa di un AEC per chiamate.
Il confronto con un AEC alternativo era previsto in E7: anticiparlo ora.

## Che cosa sappiamo delle app e delle piattaforme

Non è stata trovata una descrizione pubblica sufficientemente dettagliata
della catena WhatsApp per attribuirle uno specifico algoritmo, modello
neurale o percorso Samsung. Il comportamento riferito dall'utente è una
osservazione utile, non identifica da solo il componente responsabile.

Android documenta `AcousticEchoCanceler`, collegato alla sessione AudioRecord,
e il preprocessing per `VOICE_COMMUNICATION`. La scelta del percorso e degli
effetti dipende dalle regole del prodotto. Il codice ufficiale dell'SDK
Android WebRTC include il controllo dell'AEC di piattaforma; non dimostra
che una specifica versione di Chrome o WhatsApp usi quel percorso sul S25+.

- [Android: AcousticEchoCanceler](https://developer.android.com/reference/android/media/audiofx/AcousticEchoCanceler)
- [AOSP: preprocessing](https://source.android.com/docs/core/audio/implement-pre-processing)
- [WebRTC: effetti Android](https://webrtc.googlesource.com/src/+/refs/heads/main/sdk/android/src/java/org/webrtc/audio/WebRtcAudioEffects.java)

Microsoft documenta per Teams cancellazione dell'eco con AI e gestione della
conversazione simultanea. Zoom documenta la combinazione predefinita di
riduzione del rumore e cancellazione dell'eco, ma anche il rischio di alterare
audio musicale: la modalità high fidelity disabilita AEC e postprocessing.
Apple distingue esplicitamente il voice processing da un'opzione di ingresso
con eco cancellato destinata a segnali più generali, su hardware supportato.
Queste sono evidenze di compromessi e possibilità, non prove per Android.

- [Teams: miglioramenti AI](https://www.microsoft.com/en-us/copilot/blog/2022/06/13/how-microsoft-teams-uses-ai-and-machine-learning-to-improve-calls-and-meetings/)
- [Zoom: audio professionale](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059985)
- [Apple: ingresso con eco cancellato](https://developer.apple.com/documentation/avfaudio/avaudiosession/setprefersechocancelledinput(_:))

## Meccanismi verificabili nel codice WebRTC AEC3

La catena utilizza il segnale di riproduzione come riferimento, stima il
ritardo con matched filter e aggregazione di osservazioni affidabili e
include rilevamento di deriva dei clock. Due filtri adattivi, coarse/refined,
stimano la risposta e gestiscono cambiamenti del percorso. Dopo la
sottrazione lineare, un estimatore dell'eco residuo e un soppressore spettrale
applicano attenuazioni con una stima della voce locale.

Questo spiega perché il solo confronto con una sottrazione lineare fissa
è incompleto. La soppressione residua può migliorare l'assenza percepita di
eco anche quando il modello lineare è imperfetto; non garantisce la
conservazione del canto debole, sostenuto o in unisono.

- [Stima del ritardo](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/aec3/echo_path_delay_estimator.cc)
- [Filtri adattivi](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/aec3/subtractor.cc)
- [Sottrazione e soppressione residua](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/aec3/echo_remover.cc)

Se il video viene riprodotto dallo stesso dispositivo e il riferimento AEC
include quel percorso, il cancellatore può identificarne il rientro usando
la forma d'onda nota, anche se contiene altre voci. Se manca quel riferimento,
una riduzione può dipendere da soppressione del rumore, isolamento della voce,
direttività o cambiamenti del volume. Non attribuire ogni riduzione ad AEC.

## Browser: riferimento locale e capacità effettive

Lo standard distingue `echoCancellation:true` (scelta del browser), `false`,
`"remote-only"` (audio da PeerConnection) e `"all"` (tentativo di cancellare
la riproduzione del sistema). L'intent ufficiale di Chromium pianifica i
nuovi valori per Chrome 141 anche su Android. La dichiarazione dello standard
e la pianificazione del rilascio non provano disponibilità ed efficacia sulla
versione installata del telefono.

Registrare versione, capabilities, constraint richiesto, settings effettivi
ed eventuali errori. Provare `"all"` solo se supportato; utilizzare un vincolo
esatto nel test per rilevare un fallback. `getSupportedConstraints()` da solo
non dimostra il supporto di uno specifico valore. `true` non prova che base
Web Audio, media element, altre schede o altre applicazioni siano inclusi.

- [W3C: Media Capture and Streams](https://w3c.github.io/mediacapture-main/#dom-echocancellationmodeenum)
- [Chromium: intent delle modalità AEC](https://groups.google.com/a/chromium.org/g/blink-dev/c/x5nfoaUAUWY/m/Gl9bZ8ErAQAJ)

## Esperimento prioritario, con il minimo di ripetizioni

Tre condizioni iniziali, NS e AGC richiesti disabilitati e settings registrati:

1. ingresso senza cancellazione, come baseline;
2. AEC Chrome/Android, senza sottrazione proprietaria;
3. sottrazione proprietaria, senza AEC del browser.

Le condizioni devono essere sequenziali, fermando e riaprendo l'acquisizione:
non presumere che due stream simultanei permettano AEC diverso sullo stesso
microfono. Registrare il riferimento digitale effettivamente riprodotto e
l'ingresso ottenuto. Blocchi con lo stesso segnale e ordine alternato
distinguono in parte gli effetti di riscaldamento/storia del dispositivo.

Prima fase senza canto: rumore, metronomo, base breve, due livelli digitali
con volume hardware e posizione costanti. Confrontare energia in ingresso,
residuo, singoli attacchi e stabilità del ritardo, dichiarando la variabilità
tra acquisizioni. Non chiamare ERLE una semplice differenza fra catture di
catene diverse; un AEC di piattaforma può impedire di acquisire simultaneamente
il segnale grezzo precedente al trattamento.

Seconda fase, per i candidati utili: voce sola e voce con base, includendo
vocale sostenuta, piano, attacchi, respiri, vibrato, unisono e note differenti.
Confrontare copertura sulle finestre vocali prestabilite, F0, salti e
troncamenti. Le note dello spartito non sostituiscono un riferimento di F0.
Non accettare più dB se derivano dalla soppressione della voce.

Se l'AEC di piattaforma conserva il canto e riduce il rientro, preferirlo
alla crescita del codice proprietario. Se cancella bene la base ma danneggia
la voce, confrontare il solo AEC lineare di un motore maturo, valutando poi
un soppressore residuo più conservativo. Se non riceve il riferimento locale,
verificare routing/capacità prima di giudicare l'algoritmo.

Le misure S25+ già disponibili (16,6 dB sul rumore, 2,6 dB sul metronomo
parziale) restano risultati del trattamento proprietario. Non costituiscono
un confronto con l'AEC Chrome/Android. Nessuna modifica DSP o deploy è stata
eseguita per questa ricerca e nessun nuovo audio è stato acquisito.
