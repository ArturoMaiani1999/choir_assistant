# Isolamento dei guasti di cancellazione sul Samsung S25+

**Status:** proposed diagnostic and acceptance plan; not implemented or deployed
**Owner:** project maintainer
**Last reviewed:** 2026-10-20

## Decisione

Il [protocollo sperimentale prioritizzato](echo-experiment-protocol.md)
definisce l'ordine esecutivo, i criteri di decisione e il risultato dell'audit
degli archivi. La matrice seguente resta l'inventario delle variabili.

Prima rendere osservabile e riproducibile la catena effettivamente applicata;
poi separare errore di sincronizzazione, errore di risposta acustica e
distorsione non lineare. Non cambiare le soglie del pitch per compensare
un difetto della sottrazione. La calibrazione normale resta una sola routine.
Il collaudo tecnico esteso non diventa un requisito per ogni cantante.

Due evidenze nel [test reale del 20 ottobre](santo-real-device-2026-10-20.md):

- La catena registrata non applicava alcuna cancellazione. Non è ancora
  identificata la transizione che ha invalidato o escluso il filtro.
- A volume dichiarato invariato, tre bande mostrano uno spostamento di 3 ms
  tra due intervalli silenziosi. Correggere solo il ritardo porta la riduzione
  offline sul tratto separato a circa 10,5 dB a banda intera. Non è una misura
  della cancellazione live né un risultato di accuratezza della voce.

La direzione è un riferimento completo e sincronizzato con il microfono,
una stima sorvegliata di ritardo e guadagno e una risposta acustica adattata
solo su segmenti identificabili senza voce. Il follower corrente modifica
soltanto il guadagno. Una correzione fissa di 3 ms non è una soluzione generale.

## Variabili e prove discriminanti

Questa è la lista delle famiglie di guasto da coprire, non una dichiarazione
che siano tutte presenti nel Samsung. Cambiare una variabile per volta.

| Variabile | Meccanismo possibile | Prova che la isola |
| --- | --- | --- |
| Stato applicato | Opt-in, filtro stimato e filtro realmente collegato non coincidono | Registrare stato e identità di H a fine misura, chiusura, navigazione, Play e inizio test; verificare guadagno negativo e connessioni |
| Invalidazione del profilo | TTL, riapertura stream, cambio account/input, background o route | Ripetere separatamente ogni transizione con reason code e timestamp; confrontare firma del grafo |
| Build/cache/concorrenza | Codice o worker di release diverse | Hash di pagina, core DSP, worklet e modello nell'acquisizione; versioni immutabili |
| Riferimento incompleto | Metronomo, preview o uno stem su un'uscita non osservata; riproduzione duplicata | Organo solo, ogni voce sola, metronomo solo, poi mixer completo; tracciare le sole uscite acustiche previste |
| Trasformazioni del mixer | Mute, pan, master, pitch shift, normalizzazione o limiter dopo il punto di prelievo | Confrontare PCM finale del bus e ingressi del modello; cambiare un controllo alla volta |
| Canali | Due segnali stereo distinti richiedono due percorsi; downmix o polarità errati | Test sinistro/destro/mono e segnale noto; per la modalità mono verificare lo stesso segnale inviato ai canali |
| Ritardo fisso o frazionario | Allineamento sbagliato anche con risposta altrimenti corretta | Probe a larga banda, picchi/fase in bande disgiunte e stima subcampione; holdout separato |
| Salti di ritardo | Buffer o route cambiano a warmup, Play, resume o riapertura | Probe ripetuti prima e dopo ogni evento; ricostruire il ritardo in funzione del tempo |
| Deriva dei clock | Capture/render o attraversamenti fra contesti accumulano sfasamento | 60–120 s senza canto: cercare una pendenza coerente del ritardo, distinta da un salto; stimare ppm solo se la pendenza è dimostrata |
| Trasferimenti e contabilità frame | Resampling, buffer bridge, campioni persi/ripetuti, timestamp callback inadeguati | Contatori di frame PCM, timestamp dei blocchi, start/stop e sample rate; cattura prima/dopo ogni ponte sospetto |
| Guadagno | Volume app, volume Android e guadagno microfono sono variabili diverse | Mantenere il riferimento digitale fisso e variare il solo volume Android; in una prova distinta variare il master dell'app |
| Risposta dipendente dal livello | EQ dinamica, compressione, protezione delle casse, eventuali effetti di sistema | Ripetere la stessa sequenza a tre livelli; confrontare forma di H dopo aver compensato soltanto ritardo e scala |
| Non linearità | Casse/amplificatore/microfono producono armoniche, intermodulazione o clipping | Sweep/multitone e attacchi di metronomo a livelli crescenti, senza canto; misurare residui armonici e rapporto livello/risposta |
| DSP in ingresso | AEC, AGC, denoise, beamforming o route microfono trasformano il segnale | Registrare getSettings/getCapabilities e route; A/B del solo trattamento selezionabile; non dedurre assenza di DSP nascosto da un booleano |
| Posizione/ambiente | Mano, custodia, orientamento, tavolo, distanza, bocca e riflessioni cambiano H | Baseline con telefono fermo; poi una sola variazione geometrica alla volta, senza cambiare volume |
| Contaminazione | Voce, rumore, notifiche o altra app durante la stima | Misurare rumore con uscita ferma; separare probe e holdout; tracciare transitori e rifiutare il fit contaminato |
| Identificazione insufficiente | Base tonale, durata/banda inadeguata, FIR troppo corto/lungo, regolarizzazione o normalizzazione errata | Prima probe indipendenti a larga banda; scegliere parametri sul train e verificare senza ritocchi su un probe diverso |
| Differenza offline/live | Convolver, scaling, fase, latenza o segno implementati diversamente | Confrontare previsione live con convoluzione offline del medesimo riferimento e H; verificare residuo = raw − gain × prediction nello stesso clock |
| Double talk | Adattamento interpreta voce correlata alla base come variazione del percorso | Voce controllata indipendente, stessa F0 e fasi diverse, attacchi e canto piano; controllare aggiornamenti e preservazione, non solo RMS |
| Carico e ciclo di vita | CPU, thermal throttling, risparmio energetico, GC o tab sospesa causano interruzioni | Ripetere baseline normale e sotto carico; contare discontinuità/eventi reali, non attribuire i guasti alla sola temperatura |
| Detector e visualizzazione | Finestra, armonici concorrenti, tracker o allineamento allo spartito causano errori aggiuntivi | Stesso PCM e parametri, F0 raw/tracked/display distinti, replay con regioni ammesse copiate; confronto con voce di riferimento indipendente |

Un MP3 ricostruito non basta come riferimento: servono i campioni PCM
realmente emessi, inclusi mixer, metronomo e trasformazioni. La sincronizzazione
col beat è distinta dall'allineamento acustico usato per sottrarre il rientro.
La rete non introduce direttamente un ritardo nel DSP locale; può contribuire
solo tramite buffering/stalli se la riproduzione ne dipende. Un upload lento
è un guasto separato.

## Ordine dei test

1. **Stato e correttezza digitale.** Nessun canto. Ripetere cinque volte
   calibrazione → chiusura impostazioni → brano → Play → riapertura. Provare
   reload/background separatamente: l'eventuale invalidazione deve essere
   esplicita e motivata. Conservare quattro canali sincronizzati, H e guadagno
   applicati; se cambiano durante la prova, servono gli eventi con frame di
   applicazione. Verificare l'identità della sottrazione e il riferimento.
   Se non passa, le misure del filtro applicato non sono interpretabili.
2. **Tempo.** Telefono fermo, volume di prova 75%, nessun canto. Probe a larga
   banda separati per stima e verifica, poi una registrazione di 60–120 s.
   Ripetere con e senza gli eventi di apertura/Play sospetti. Distinguere offset,
   salto, deriva e ritardo del solo callback pitch. Annotare baseLatency e
   outputLatency quando disponibili, senza scambiarli per una misura dell'intero
   anello altoparlante–microfono. Confrontare causalmente modello fisso,
   guadagno solo, ritardo solo, ritardo + guadagno e infine eventuale nuova H.
3. **Livello e distorsione.** Stesso punto, stessa sequenza e stesso PCM digitale
   a circa 35%, 55%, 75% del volume Android, registrando gli effettivi step
   del dispositivo quando accessibili. I valori percentuali non sono SPL né
   guadagni lineari. Separare cambi tra prove da cambi durante una prova.
   Se il limite di riduzione peggiora solo ai livelli alti anche con timing
   corretto, indagare EQ dinamica, limiter e non linearità.
4. **Contenuto.** Metronomo solo, organo solo, ciascuna voce, poi mixer Santo
   dichiarato dall'utente. Nessun canto. Misurare anche i residui brevi e tonali:
   una buona media può nascondere click che fanno saltare la F0.
5. **Voce preservata.** Prima miscele con voce indipendente nota e test sintetici
   controllati, poi canto reale normale/piano, attacchi, respiri e unisono con
   la base. Un'eventuale riproduzione da una seconda cassa è utile ma non sostituisce
   il canto naturale. Una presa vocale ravvicinata separata può fornire F0 di
   riferimento, dopo controllo del suo rientro. Cuffie e casse in due esecuzioni
   diverse sono un controllo utile ma non la stessa voce campione per campione.
6. **Robustezza.** Solo dopo i primi cinque: spostamenti, cambio volume,
   pause/riprese, carico e un secondo dispositivo. Almeno tre ripetizioni per
   condizione di accettazione. A/B con AEC nativo e benchmark AEC maturo solo
   dopo aver validato i riferimenti, usando gli stessi test di preservazione.

La prima fase non richiede una nuova esecuzione cantata. Molti test acustici
sono automatizzabili dopo il consenso e il posizionamento del telefono.
L'accesso remoto non può produrre al posto dell'utente un nuovo canto naturale.

## Metriche e obiettivi proposti

Sono obiettivi del progetto da verificare sul dispositivo, non prestazioni
promesse da Chrome, Android o da un algoritmo standard.

In un tratto con sola base, misurare
`R = 10 log10(P_microfono / P_residuo) = 20 log10(RMS_microfono / RMS_residuo)`.
Il microfono contiene anche rumore ambiente: il rapporto è una riduzione
operativa, non una stima perfetta della componente di eco. Misurare a parte
il rumore senza uscita; segnalare quando esso limita la misura, senza sottrarre
una potenza stimata instabile o dichiarare un ERLE arbitrariamente alto.
Durante il canto la stessa formula non misura ERLE né preservazione vocale.

| Condizione | Criterio proposto |
| --- | --- |
| Base sola, telefono fermo, percorso verificato, volume di utilizzo fino al 75% | Prima soglia utile ≥20 dB su holdout; obiettivo nominale 25–30 dB se il fondo lo permette |
| Stabilità | Mediana delle finestre di 1 s ≥25 dB e p10 ≥20 dB sui tratti di base attiva, in tutte le ripetizioni; riportare transienti separatamente |
| Metronomo e bande tonali | Stessa verifica per sorgente, energia residua per evento e bande rilevanti al detector; non compensare click falliti con medie di lunghi silenzi |
| Voce debole | Residuo di base preferibilmente ≥15 dB sotto la voce piano di riferimento nelle bande rilevanti; se non verificabile, non promettere preservazione |
| Voce nota durante double talk | Perdita della componente vocale ≤0,5 dB rispetto alla stessa voce senza base, dopo allineamento; nessuna cancellazione appresa dalla voce |
| F0 su voce nota stabile | Scarto mediano dal riferimento ≤10 cent e p95 ≤30 cent, esclusi attacchi/respiri dichiarati; confronto separato dei transienti |
| Voicing | Primo benchmark base-sola: <1% di frame vocali falsamente ammessi e nessuna falsa nota sostenuta >200 ms; registrare hop e conteggi. Sul corpus con voce, sensibilità almeno pari al baseline a parità di esempi, con incertezza statistica riportata |
| Pitch-only | Identica maschera di ammissione quando si valuta la sola correzione F0; fallback esplicito se non c'è proposta. Questo test non può dimostrare la rimozione di falsi positivi di voicing |

20 dB corrispondono a circa dieci volte meno ampiezza RMS del rientro; 30 dB
a circa 31,6 volte. Non bastano da soli se la base supera molto una voce piano.
Il risultato attuale di circa 10,5 dB è insufficiente come traguardo finale.
Le soglie correnti del controllo guidato (15 dB train, 12 dB holdout) restano
quelle del codice fino a una modifica esplicita: questa proposta non le cambia.
Non nascondere una verifica insufficiente alzando il gate del pitch o imponendo
una soppressione che elimini il canto piano. Prima definire un intervallo di
volume supportato e un comportamento di recupero misurato sui dati reali.

## Accesso al dispositivo

Percorso consigliato: S25+ collegato via USB dati allo stesso PC di questa
workspace, Opzioni sviluppatore e Debug USB abilitati, autorizzazione RSA
confermata sul telefono. Chrome desktop espone le schede Android in
`chrome://inspect/#devices`; ADB può inoltrare il socket di debug Chrome a
una porta locale e rendere disponibile il Chrome DevTools Protocol.

Questo consentirebbe di leggere console, stato del grafo e richieste,
interagire con la pagina reale e acquisire diagnostiche autorizzate. Il
collegamento non è già attivo: ADB non è stato trovato nel PATH né nella
posizione SDK standard controllata. Devono essere verificati installazione,
driver e visibilità del dispositivo prima di dichiarare l'accesso disponibile.
Nessun root è richiesto. In caso di problemi di riconoscimento Windows,
verificare il driver USB Samsung ufficiale. Il debug wireless con pairing è
un'alternativa sulla stessa rete, non il primo passo necessario.

Limitare l'automazione alla pagina della webapp; non esporre la porta di
debug su Internet. Disattivare screencast e profiling invasivo durante le
misure temporali di accettazione: lo strumento di osservazione può alterare
il carico. Il debug non garantisce accesso al PCM prima del DSP proprietario
del telefono. Conservare l'attuale consenso esplicito per registrare la voce.

## Fonti primarie

- [SpeexDSP: sincronizzazione, lunghezza del filtro e distorsione](https://www.speex.org/docs/manual/speex-manual/node7.html).
- [WebRTC AEC3: gestione dei buffer, ritardo e clock drift](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/aec3/block_processor.cc).
- [WebRTC AEC3: sottrazione lineare e soppressione residua distinte](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/aec3/echo_remover.cc).
- [Web Audio: baseLatency e outputLatency](https://www.w3.org/TR/webaudio/#dom-audiocontext-outputlatency).
- [Media Capture: capabilities e settings effettivi](https://w3c.github.io/mediacapture-main/).
- [Chrome: debug Android e accesso CDP con ADB](https://developer.chrome.com/docs/devtools/remote-debugging/).
- [Android: ADB, consenso USB e pairing wireless](https://developer.android.com/tools/adb).
- [Driver USB Samsung per Windows](https://developer.samsung.com/android-usb-driver).
