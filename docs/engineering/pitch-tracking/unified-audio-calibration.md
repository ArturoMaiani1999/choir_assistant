# Calibrazione audio unica

Implementazione del 19 ottobre 2026. Un solo comando in Impostazioni → Base
coordina percorso acustico e riconoscimento voce/pausa. Non modifica il pitch
per avvicinarlo alle note dello spartito e non promette accuratezza F0 dalla
balanced accuracy della guida.

## Catena e durata

Dal 20 ottobre 2026 la routine gestisce anche l'ingresso da Home senza un
brano caricato: il clock può essere assente. Si attiva comunque il mixer per
i fruscii di misura, ma il warmup dei decoder riguarda soltanto un player
esistente e media con sorgente. Stop e annullamento ripristinano il mute del
mixer anche senza clock. Il caricamento successivo del brano segue le normali
regole di invalidazione e verifica della catena. Il caso è coperto dallo
smoke con `--without-piece --url http://127.0.0.1:5190/`.

La routine apre il microfono e il grafo definitivo di sottrazione prima della
misura. Il convolver parte con risposta nulla: il detector ha già il medesimo
MediaStreamDestination e AudioContext che userà durante la prova. Tutti i
media element della base vengono avviati con i guadagni dei canali a zero;
il bus di riferimento resta attivo e può emettere i segnali di misura.

MediaPlaybackClock congela posizione e stato della prova durante il warmup.
I file restano in loop silenzioso per evitare che terminino mentre l'utente
calibra. Al Play si ripristinano posizione, loop e livelli originali senza
riaprire microfono, contesti o decodificatori. Annullamento, stop microfono e
background fermano anche il warmup. Il microfono attivo dopo il successo è
dichiarato nel risultato e nell'indicatore della prova.

Con gli altoparlanti: preparazione/silenzio 3 s, rumore train 3 s, coda 1 s,
rumore indipendente 2 s, coda 1 s. Il Worker stima una risposta causale fino a
750 ms, con train ≥15 dB e holdout ≥12 dB. Ritardo e risposta vengono misurati
per la catena corrente; non si applica un offset Samsung fisso. Il filtro è
installato sul grafo già attivo, che resta aperto. Dopo 350 ms di assestamento
segue la voce.

La guida vocale dura 22 s: silenzio train 3, preparazione 2, vocale normale 5,
pausa holdout 3, preparazione 2, vocale più piano holdout 4, pausa finale 3.
Si escludono 500 ms per lato da ogni etichetta. Il controllo conserva gli
stessi limiti di separazione, clipping, copertura temporale e non inferiorità
di recall/specificità della calibrazione precedente. La voce può scegliere
qualsiasi nota comoda. Nessuna nota dello spartito è una label acustica.

Totale dichiarato: circa 35 s con altoparlanti (32 s di acquisizione più
elaborazione), circa 25 s con cuffie (3 s preparazione +22). L'elaborazione
mostra uno stato esplicito, senza un countdown fittizio. I countdown sono per
fase e la storia del livello audio rimane visibile durante l'acquisizione.

## Riuso e invalidazione

**Robustezza acquisizione, 20 ottobre:** due callback del timer possono leggere
la stessa finestra dell'Analyser nello stesso quantum audio. La guida conserva
una sola finestra per timestamp crescente, invece di inviare duplicati che il
controllo di integrità rifiuterebbe come `capture-incomplete`. I controlli di
copertura, intervalli mancanti e separazione train/holdout restano attivi.
Un caricamento fallito del worklet di misura viene rimosso dalla cache del
contesto: un nuovo tentativo può scaricarlo dopo il ripristino della rete.

Il test del browser con il percorso sintetico passa sia dal brano sia dalla
Home, mantenendo il grafo attraverso cinque riaperture di Base. Questo non
dimostra ancora il comportamento acustico del telefono reale.

**Preparazione verificata, 20 ottobre:** il Worker di analisi risponde a un
messaggio di disponibilità prima di avviare i rumori. Il mancato caricamento
entro 12 s interrompe la preparazione senza acquisizione acustica. Durante
l'attesa compare Preparazione audio, senza countdown fittizio; i countdown
della misura iniziano solo dopo la risposta. Lo stesso Worker resta pronto
per il fit, con un limite separato di analisi di 15 s. Lo storico distingue
le due fasi. Il [primo probe sul S25+](s25-calibration-probe-2026-10-20.md)
documenta la motivazione e i limiti delle misure reali disponibili.

**Correzione 20 ottobre:** passando da Home a un brano e aprendo Base si
conservano il profilo vocale e il microfono nella stessa sessione. Il
caricamento dei decoder invalida soltanto il modello acustico, disattivandone
subito la sottrazione: al Play parte automaticamente la misura in silenzio
di circa 10 s, poi riprende la prova. Non si richiedono di nuovo le vocali.
La riapertura di Base durante la prova pausa la musica e mantiene l'ingresso;
background, uscita dalla pagina e stop esplicito rilasciano comunque tutto.
Base distingue Audio pronto, Voce salvata/rientro da verificare e Profilo
voce salvato. La preferenza di ascolto è ricordata per account sul browser;
non equivale a un modello H valido. Alla riapertura del microfono il modello
acustico rimane da misurare sulla catena attuale.

I parametri vocali verificati si applicano automaticamente e si ricordano per
account, browser e catena effettiva, includendo modalità cuffie/altoparlanti.
Il deviceId viene salato e hashato. Non si persiste PCM, H o un audio della
calibrazione. Un profilo vocale compatibile entro 7 giorni viene verificato
con 4 s di preparazione e 4 s di silenzio; se non supera il controllo si torna
automaticamente alla guida completa. Le percentuali visualizzate dopo il
riuso restano quelle della guida vocale originale, non nuove stime.

Ogni detach invalida H, anche a deviceId invariato. Alla successiva apertura,
il medesimo comando esegue di nuovo la misura acustica sulla catena corrente
e il controllo vocale breve se compatibile (circa 20 s). Un vecchio profilo H
non autorizza Play con una nuova acquisizione. La sessione vocale scade dopo
30 minuti e H dopo 10 minuti fuori dalla prova. Cambio dispositivo, impostazioni
o account invalida il relativo controllo. Spostamenti e DSP non esposto
rimangono limiti reali: una sola misura iniziale non li può risolvere sempre.

H resta congelata durante il canto. Il precedente adattamento conservativo
del solo guadagno rimane indipendente dalla voce e rifiuta segnali tonali,
double talk, disallineamento o clipping. Non è un AEC universale.

**Tracking del ritardo, 20 ottobre:** la stessa catena include ora un retimer
sul ramo della previsione. Il [candidato e i test](echo-delay-tracking-2026-10-20.md)
documentano conferme a banda larga e recupero causale del salto di 6 ms nei
dati di sviluppo. Non richiede un'altra calibrazione o azione: la guida e la
gerarchia di Base restano identiche. Nessun nuovo gate del pitch durante il
riallineamento. Restano da confermare prestazioni e costo sul S25+ dal vivo.

## Verifica e limiti

`browser_audio_calibration_smoke.py` esercita Worker e Web Audio reali con
percorso acustico sintetico, voce libera, applicazione automatica, continuità
del grafo al Play, riapertura/riuso, annullamento e screenshot 1366×768 e
390×844. I test core verificano latenze diverse, holdout indipendente e
preservazione della voce alla stessa frequenza della base. Rimane necessaria
la nuova prova sul Samsung S25+: questi test non dimostrano che il problema
reale di [Santo](santo-real-device-2026-10-19.md) sia risolto sul telefono.

Il test diagnostico di 60 s rimane sotto Assistenza e test audio; mantiene il
consenso e il salvataggio cloud automatico. Non è un passo della calibrazione.
Dal 20 ottobre può partire anche senza calibrazione verificata: serve proprio
a diagnosticare un percorso che non funziona. In quel caso il ramo sottratto
ha guadagno zero, il segnale trattato coincide col grezzo e i metadati indicano
`echo.calibrationVerified:false`, gain 0 e nessuna qualità dichiarata. Con un
modello verificato si registrano invece i quattro canali del trattamento
effettivo. Non viene mai riattivato un modello scaduto per ottenere un test.

## Rilascio e collaudo

Pubblicato su `staging.epistrophe.it` il 19 ottobre 2026:

- build `20261019-201905-46c4b97f1322-dirty`;
- Worker `89847875-944e-487b-83ca-b3a2ea05de65`, deployment al 100%;
- SHA-256 del deployment manifest:
  `a01264ae00a0d88b80ce97f463e4408f00340db1491494d353423c6c18e139f5`.

Verificati typecheck, 77 test API, 26 test calibrazione/DSP/diagnostica,
10 suite frontend, 12 controlli packaging e 3 test di analisi diagnostica.
Browser: percorso altoparlanti completo, cuffie, riuso breve, Play senza
riapertura, Escape, backdrop/focus, cambio dispositivo, background e permesso
tardivo. I test estesi conservano una voce sintetica a 220 Hz sulla stessa
frequenza della base, seguono guadagni acustici 2 e 0,5 e rifiutano di
apprendere un cambiamento di ritardo o double talk. La misura identifica
35 ms nel percorso sintetico, con circa 34 dB di riduzione indipendente.
Questi numeri descrivono il fixture, non una performance del telefono.

Il test cloud locale verifica accesso dalla UI Base senza perdere il grafo,
consenso, invio, retry dopo 503 con gli stessi byte, lettura dell'audio salvato
con hash identico e cancellazione del proprietario. Screenshot Base, guida,
livello audio e risultato sono in `artifacts/audio-calibration/`, con variante
cuffie in `headphones/`, a 1366×768 e 390×844. Ispezionati senza clipping o
scroll predefinito; dettagli espansi possono scorrere.

Il rilascio usa il pacchetto congelato e collaudato. Le modifiche parallele
alla navigazione/Partitura comparse dopo la build restano nel workspace e
richiedono un proprio collaudo: lo smoke generale aggiornato per quel lavoro
attende il nuovo audio del viewer, assente da questo pacchetto. Nessuna di
quelle modifiche è stata annullata o inclusa durante il deploy.

Dopo il deploy: sign-in e configurazione pubblica 200; pratica anonima
reindirizzata al login conservando brano/parte; API diagnostiche 401 senza
sessione, tutte con `no-store`. Gli asset della pratica sono autenticati:
la verifica anonima non sostituisce una prova con l'account reale. Prossimo
collaudo sul Samsung S25+: Santo, tenore, stesso volume e introduzione senza
cantare, con un nuovo test diagnostico se restano deviazioni.
