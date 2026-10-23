# Home di Xynon

**Status:** canonical; pubblicato su staging Xynon, build verificata in locale

**Owner:** project maintainer  
**Last reviewed:** 2026-10-22

## Composizione

### Caricamento e recupero

Prima del menù compare soltanto **Caricamento…** sul fondo nero esistente.
Il controllo parte prima degli script principali: copre anche un download
che rimane in attesa. Dopo 15 secondi mostra **Il caricamento richiede troppo
tempo.** e **Riprova**; un errore esplicito mostra **Caricamento non riuscito.**.
Il comando ricarica lo stesso indirizzo, conservando brano, parte e provenienza.
Se l'avvio termina nel frattempo, lo stato scompare automaticamente.
La superficie sottostante resta inerte fino alla disponibilità del menù o
del profilo richiesto. Il controllo ha focus visibile e altezza minima di
44 px; non aggiunge animazioni. La Home non procede senza il profilo dopo
un errore di inizializzazione.

Lo stesso recupero copre login e pagine applicative. Nel login l'errore e
**Riprova** sostituiscono il solo messaggio di attesa all'interno del modulo,
senza coprire il resto della pagina. Le richieste di configurazione, avvio
Clerk e rinnovo token hanno una scadenza; gli upload non vengono ripetuti
automaticamente. Il codice statico può essere conservato in cache, mentre
profilo, progressi e materiali musicali richiedono sempre accesso al server.

Verifica: `python scripts/browser_startup_smoke.py`, anche con
`--directory artifacts/startup-cache/release`, e smoke di Home e navigazione.
Dettagli tecnici nel [registro della modifica](../operations/releases/2026-10-21-startup-cache-recovery.md).

### Menù

La Home separa identità e funzione: firma armonica bicolore sul nero e tre
azioni immediatamente disponibili, senza introduzione bloccante. Il nero puro
resta un'eccezione intenzionale al fondo inchiostro del sistema condiviso.
Xynon identifica l'header; il profilo è l'unica utilità in alto a destra.

Da 900 px la scena occupa il 55% delle colonne disponibili, le azioni il 45%,
con un gap di 32 px e una composizione larga al massimo 1120 px. I pulsanti
sono larghi al massimo 320 px, alti almeno 56 px, distanziati di 16 px.
**Scegli brano** usa ocra attenuata; **Mostra partiture** e **Esercizi vocali**
usano superfici quasi nere e bordi neutri. Il gruppo non ha un pannello.

Sotto 900 px la curva precede le azioni. Sotto 600 px l'header mostra solo
l'icona profilo e la curva è limitata a 280 px e al 32% dell'altezza dinamica.
Tra 600 e 899 px arriva a 320 px e al 34% dell'altezza. I passi successivi
riusano lo stesso Canvas, con posizione, dimensioni e tempo invariati tra
menù, scelta della provenienza e catalogo. Il cambio di passo ridisegna anche
la scena in pausa o con movimento ridotto, senza riavviarla.
I tre pulsanti iniziali sono larghi al massimo 232 px sotto 900 px;
catalogo e scelta della provenienza conservano lo spazio per i propri controlli.
Sulle altezze ridotte lo scroll dei passi più densi è naturale, senza
rimpicciolire la curva per farli entrare.

La scelta tra **Brani assegnati** e **Tutti i brani** non mostra titoli o
sottotitoli ripetuti. Nei passi successivi **Indietro** sostituisce Xynon in alto
a sinistra e torna al passo precedente: dal catalogo alla provenienza, dalla
provenienza alle tre modalità. La scelta del brano viene conservata.
La lettura torna direttamente alle modalità; la scelta SATB torna al catalogo
o al repertorio se proviene da un brano assegnato. Nel repertorio e negli
esercizi vocali il ritorno diretto resta **Menù**. Il titolo del passo resta disponibile
per il focus e gli screen reader. Brano e relativi asset vengono preparati
solo entrando nel catalogo o nella scelta della parte.

Sotto 601 px di altezza si riducono gap e margini, conservando i target touch.
Tra 700 e 899 px di larghezza e fino a 500 px di altezza si torna alle due
colonne, con gap di 24 px: il landscape breve offre larghezza sufficiente e
non deve riservare una seconda riga alla curva. Le safe area e `100dvh`
partecipano alla composizione; se lo spazio si esaurisce è consentito lo
scroll naturale, senza nascondere contenuti.

## About e missione

Nel passo iniziale del menù, **About Xynon** e **About the logo** sono due
collegamenti secondari affiancati e centrati in fondo al viewport, con area
utile di almeno 44×44 px e focus visibile. Nei
passi di scelta successivi resta nascosto senza modificare la composizione
della curva. Aprono `about.html` e `about-logo.html`; **Menù** riporta alla Home e resta disponibile
anche con JavaScript disabilitato.

La pagina riprende fondo nero, token, caratteri e controllo di ritorno della
Home. In alto il marchio unisce la Lissajous 3D ciano/ocra alla scritta
**ynon**: la curva sostituisce la X, mentre il nome accessibile resta
**Xynon**. Riusa il renderer condiviso in formato compatto, senza duetto.
Movimento ridotto, sospensione fuori vista/in background e ritorno da BFCache
seguono il comportamento della firma principale.

Sotto il marchio compaiono **Perché Xynon** e il testo della missione
rivisto dal maintainer, in sei paragrafi e colonna larga al massimo 640 px.
La lettura scorre naturalmente su desktop e mobile. Testo esteso sempre
visibile e marchio animato sono eccezioni intenzionali alle regole di copy
breve e movimento solo funzionale: questa superficie è dedicata alla missione.
Non aggiunge illustrazioni, contenitori o azioni promozionali.

**About the logo** è una pagina separata, con lo stesso marchio animato e la
stessa colonna di lettura. Spiega brevemente che una curva di Lissajous
combina oscillazioni su assi diversi e mostra le equazioni del logo 3D:
`x(t) = sin(t)`, `y(t) = sin(2t)`, `z(t) = sin(3t)`. Distingue il logo dalle
curve piane dei percorsi vocali, che combinano due oscillazioni nei rapporti
1:3, 2:3 e 3:4. La formula corrisponde al renderer condiviso; la definizione
è verificata nel riferimento [Wolfram MathWorld](https://mathworld.wolfram.com/LissajousCurve.html).
La pagina riusa `about.css` e `about.js`, con movimento ridotto e sospensione
del marchio. La lettura può scorrere naturalmente, come nella pagina della
missione: è la stessa eccezione intenzionale per i contenuti editoriali.

Verifica: `python scripts/browser_home_smoke.py`, anche con
`--dist --directory artifacts/about-dist`. Lo smoke copre accesso da tastiera,
ritorno, testo completo, assenza di scroll orizzontale, marchio accessibile,
movimento ridotto, sospensione fuori vista e BFCache a 1366×768 e 390×844;
controlla inoltre che il pulsante non si sovrapponga alle azioni sugli undici
viewport della Home. Verifica anche accesso da tastiera, equazioni, movimento
ridotto e ritorno della pagina del logo. Screenshot `about-top-*`,
`about-full-*` e `about-logo-*` in
`artifacts/home-redesign`.

La pagina e l'ultima revisione del testo sono pubblicate su staging Xynon nel
[rilascio completo del 21 ottobre](../operations/releases/2026-10-21-xynon-complete-update.md).
I due link separati e la pagina **About the logo** sono pubblicati nel
[rilascio del 22 ottobre](../operations/releases/2026-10-22-xynon-about-logo.md).

## Firma e movimento

Su richiesta esplicita del maintainer è stata ripristinata l'animazione
precedente: `lissajous.js` usa nuovamente lo stesso renderer 3D di Relax mode,
con `x = sin(t)`, `y = sin(2t)`, `z = sin(3t)`, proiezione prospettica,
rotazione lenta della camera e filamenti luminosi. Il punto e la scia ora
procedono a metà della precedente velocità (`SPEED = 0.25`); la scia dura
40 secondi per conservare la propria lunghezza geometrica. La camera ruota
il 30% più velocemente; la Home conserva anche il moltiplicatore `5/3`
rispetto a Relax. Posa iniziale e posizione iniziale del punto restano
invariate, con clock di camera e punto separati. L'alone morbido
e i filamenti sono un'eccezione intenzionale alla versione iniziale del redesign:
la precedente modulazione planare risultava visivamente quasi statica.

La Home e la firma compatta delle pagine di scelta usano due colori,
senza interpolare una palette multicolore:
`--home-voice` e `--home-target` sono alias di `--cyan` e `--amber`, gli stessi
token della prova. Le due semionde della curva assegnano ciano e ocra ai
segmenti, ai rispettivi filamenti, all'alone e al punto in movimento.
La scia parte già popolata anche con movimento ridotto. La geometria è centrata
e dimensionata nell'area assegnata dal layout approvato; margini e spessore dei
filamenti si adattano alla scena compatta su mobile.

Il renderer disegna su un Canvas interno in supersampling: almeno 2× sui
viewport di verifica, 1,25 volte il DPR nativo sugli schermi densi, fino a
4× e con un limite di otto milioni di pixel per superficie. Il Canvas
visibile conserva il DPR nativo: `drawImage` con filtraggio di alta qualità
riduce esplicitamente il buffer interno, evitando il moiré che può comparire
con la sola riduzione CSS. Un dispositivo 1× usa normalmente rendering 2×;
un mobile 3× usa rendering 3,75×, senza aumentare la dimensione visiva.

Ogni filamento di ciascun lobo è ora un unico tracciato continuo. La scia
viaggia separatamente su nastri riempiti che si assottigliano fino a zero,
con normali condivise e griglia parametrica fissa. Non ci sono giunzioni
interne tra brevi stroke. La composizione luminosa resta additiva e i colori
dei due lobi rimangono esattamente ciano e ocra. Il buffer interno è riusato
nello stesso RAF e rilasciato all'uscita; non viene letto con `getImageData`.
Non si aprono
microfono, AudioContext o Worker. Il rendering si ferma fuori dalla Home,
dietro un altro dialogo, fuori dal viewport, in background e in pausa.
Con movimento ridotto parte statico e si arresta anche quando la preferenza
cambia; resta disponibile la ripresa esplicita. Observer, listener e RAF
vengono rilasciati all'uscita definitiva, preservando il ritorno da BFCache.
Il renderer condiviso rimane in uso in Home e About dopo la rimozione di Relax mode.

### Duetto nascosto

Una volta per giro, i lobi ciano e ocra diventano due amici che cantano per
cinque secondi. Il riferimento visivo è ciano a sinistra, ocra a destra e
tangente centrale condivisa. Nel renderer attuale questa posa corrisponde a
`yaw = π − atan(1/3) ≈ 161,565°`, anziché 90°: annulla il termine lineare
`cos(yaw) + 3 sin(yaw)` della coordinata orizzontale. Il primo incontro arriva
dopo circa 35 secondi di Home attiva (34,7 s), grazie alla rotazione più rapida.

Il renderer condiviso conserva un solo RAF e tre stati: `ROTATING`, `DUET`,
`RESUMING`. Nei 400 ms prima della posa rallenta con velocità continua;
durante i 5.000 ms del duetto congela il tempo della curva, quindi anche
camera, inclinazione, scia e punto luminoso. I volti appaiono nei primi
400 ms, svaniscono negli ultimi 500 ms, insieme alla deformazione. La ripresa
accelera per 500 ms dalla stessa posa; il prossimo incontro richiede un giro
completo. Le soglie vengono attraversate consumando il delta temporale anche
tra stati: non si confrontano angoli floating point per uguaglianza.

Gli occhi sorridenti e le piccole bocche sono tratti Canvas nei colori dei
lobi, senza asset, audio o nuovi controlli. Posizione e dimensione derivano
dai limiti geometrici di ciascuna semionda e seguono la stessa deformazione.
L'ondeggiamento di circa 3° ha una lieve differenza di fase; spostamento e
derivata si annullano al contatto centrale, preservando la continuità.
Ogni bocca segue una cadenza diversa. Il disegno conserva glow, filamenti,
palette e composizione; il buffer dei punti viene riutilizzato.

I volti occupano il 34% della larghezza del rispettivo lobo, per essere più
leggibili anche su mobile. Il volto ocra è ancorato al 40% dell'altezza del
corpo, quello ciano al 28%; il canto usa intensità `0.4`, con un'apertura
della bocca più contenuta anche alla nuova scala.

Durata, angolo, ampiezza/frequenza, scala/opacità dei volti, intensità del
canto e abilitazione sono centralizzati in `duetConfig` di `lissajous.js`,
con override opzionali per istanza. Pausa, dialoghi, background, fuori vista
e BFCache sospendono anche il tempo del duetto. Con movimento ridotto la
scena aggiuntiva è esclusa anche dopo una ripresa esplicita; un cambio della
preferenza rimuove i volti e mette in pausa. About usa il marchio senza
duetto. Questa breve scena contemplativa è un'eccezione
intenzionale alle animazioni funzionali del sistema UX/UI.

## Profilo e impostazioni

Il disclosure nativo `details` riunisce profilo, impostazioni esistenti
(pausa, Base, Avanzate) e uscita dall'account. Non esiste più la
gear separata. La sezione Impostazioni raggruppa i controlli senza duplicarli.
Relax mode, la sua pagina e i relativi asset sono rimossi dalla webapp.
Nelle impostazioni della prova non compaiono più **Il mio profilo** e
**Brani assegnati**: il profilo resta disponibile dalla Home, i brani dal
percorso **Scegli brano**. La scelta audio è unica e dura 24 ore, secondo il
[contratto della prova](practice-experience.md#calibrazione-e-pitch).
Il simbolo `+` / `−` segue il design system; su mobile resta solo l'avatar.

Tab conserva l'ordine nativo; frecce, Home ed End permettono di scorrere le
azioni. Escape chiude il disclosure e restituisce il focus; click esterno e
uscita del focus lo chiudono. `aria-expanded` e `aria-controls` descrivono il
controllo. Profilo e impostazioni riusano i dialoghi e restituiscono il focus
all'avatar. L'uscita richiama il comando esistente con gli stessi blocchi e
la stessa pagina di conferma; autenticazione, autorizzazioni e Clerk non
cambiano.

Il binding del comando di uscita avviene nell'inizializzazione del profilo,
prima del caricamento di un brano: il comando ora funziona anche al primo
ingresso nella Home. I controlli e il corpo del gestore esistente sono invariati.

## Verifica

Revisione di navigazione del 21 ottobre, verificata localmente: lo smoke Home
controlla coordinate, dimensioni e pixel invariati della curva in pausa tra
menù, provenienza e catalogo su undici viewport, da 320×568 a 1920×1080,
incluso 844×390. Verifica anche etichette nuove, ritorno al passo precedente,
focus, movimento ridotto e persistenza dell'animazione. Build locale in
`artifacts/navigation-polish/dist-final`; smoke Home e firma compatta superati
anche sugli asset fingerprintati. Lo smoke di navigazione verifica il collegamento
diretto dal repertorio alla provenienza e i repertori vuoti/popolati su sei
larghezze. Screenshot desktop/mobile ispezionati in `artifacts/home-redesign`,
`artifacts/navigation-fixes` e `artifacts/ambient-curve`. Superato anche lo smoke
delle istruzioni vocali. Questa revisione è pubblicata su staging nel
[rilascio navigazione](../operations/releases/2026-10-21-xynon-navigation.md).
Il successivo [ritorno contestuale](../operations/releases/2026-10-21-xynon-contextual-back.md)
sostituisce il ritorno diretto con **Indietro**, verificato anche sull'esatto
pacchetto in `artifacts/xynon-contextual-back-release/release`.

Il renderer rifinito è pubblicato su staging Xynon nel
[rilascio supersampling del 21 ottobre](../operations/releases/2026-10-21-xynon-lissajous-smooth.md),
con controlli browser sull'esatto artefatto e verifica remota di accesso.

- Rifinitura dei filamenti: test dedicati sulle giunzioni geometriche,
  velocità del punto al 50%, camera al 130%, supersampling e budget di pixel.
  Lo smoke Home verifica sia DPR nativo sia densità interna e conserva fotogrammi
  desktop/mobile prima e dopo il movimento. Smoke Relax e firma compatta
  coprono anche gli altri consumatori del renderer condiviso.
  Confronti prima/dopo e probe di 90 frame sono in `artifacts/lissajous-smooth`:
  mediana circa 16,7 ms su entrambi i viewport; percentile 95 circa 33,3 ms
  su desktop e 16,8 ms su mobile emulato. È una misura locale, non una
  certificazione delle prestazioni su dispositivi fisici.
- Duetto (21 ottobre, sorgenti locali): `node --test scripts/lissajous.test.cjs`
  verifica posa matematica, durata, rallentamento/ripresa, frame saltati,
  indipendenza dal frame rate, riarmo, sospensione, cleanup, movimento ridotto
  e isolamento da Relax. Lo smoke Home osserva gli stati sul RAF reale e
  controlla cinque secondi di tempo geometrico immobile, pixel animati durante
  la pausa e due soli colori. Screenshot ingresso, canto, ondeggiamento,
  dissolvenza e ripresa a 1366×768 e 390×844 sono in `artifacts/home-duet`;
  ispezionati senza clipping o variazioni di layout. Verificati anche pausa,
  background, BFCache e cambio della preferenza durante il duetto.
- `python scripts/browser_home_smoke.py`: undici viewport, inclusi tutti i
  sette richiesti, 1366×768, 900/899 px e 844×390; nessun overflow, clipping,
  sovrapposizione o scroll iniziale. Target touch di almeno 44 px, pausa,
  movimento ridotto, visibilità, focus, tastiera e ingresso negli esercizi.
  Verifica anche due soli colori nei tratti effettivamente disegnati e un
  cambiamento visibile dei pixel a distanza di 1,2 secondi su desktop/mobile,
  oltre all'avanzamento del timer. Screenshot `animation-start-*` e
  `animation-after-*` conservano i due fotogrammi.
- `python scripts/browser_navigation_smoke.py`: tre percorsi, partitura,
  repertorio, profilo, logout anche dalla Home, SATB e ritorno al beat 16.
- `python scripts/browser_settings_smoke.py`: scelta audio, scadenza di 24 ore,
  impostazioni desktop/mobile e assenza della precedente pagina Relax.
- `npm run check`: TypeScript, 89 test applicativi e 26 test audio/calibrazione.
- `python scripts/build_dist.py --output artifacts/home-redesign/dist`: build
  locale isolata, senza modificare la release esistente; 1293 file e 19 brani.
- Lo smoke Relax passa anche sugli asset fingerprintati della build, con
  `--dist --directory artifacts/home-redesign/dist`.
- `python scripts/check_docs.py` e `git diff --check`: superati.

Screenshot e misure ripetibili sono in `artifacts/home-redesign`; le immagini
`before-1366.png` e `before-390.png` conservano le acquisizioni del precedente
smoke della Home. I test usano asset reali e account sintetici. Restano da
verificare login Clerk reale e safe area/chrome dinamica su dispositivi fisici.
Layout pubblicato su staging il 20 ottobre 2026 nel
[rilascio responsive](../operations/releases/2026-10-20-home-responsive.md).
L'animazione originale bicolore è stata poi ripristinata e pubblicata nel
[rilascio movimento](../operations/releases/2026-10-20-home-motion-bicolor.md),
che riporta versione attiva, rollback e verifiche sulla build e online.
