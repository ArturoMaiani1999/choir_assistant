# Home di Epistrophe

**Status:** canonical; pubblicato e verificato su staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Composizione

La Home separa identità e funzione: firma armonica bicolore sul nero e tre
azioni immediatamente disponibili, senza introduzione bloccante. Il nero puro
resta un'eccezione intenzionale al fondo inchiostro del sistema condiviso.
Epistrophe identifica l'header; il profilo è l'unica utilità in alto a destra.

Da 900 px la scena occupa il 55% delle colonne disponibili, le azioni il 45%,
con un gap di 32 px e una composizione larga al massimo 1120 px. I pulsanti
sono larghi al massimo 320 px, alti almeno 56 px, distanziati di 16 px.
**Canta brani** usa ocra attenuata; **Vedi partitura** e **Allena la voce**
usano superfici quasi nere e bordi neutri. Il gruppo non ha un pannello.

Sotto 900 px la curva precede le azioni. Sotto 600 px l'header mostra solo
l'icona profilo e la curva è limitata a 280 px e al 32% dell'altezza dinamica.
Tra 600 e 899 px arriva a 320 px e al 34% dell'altezza. I passi successivi
riusano il flusso esistente con una scena ancora più piccola.

Sotto 601 px di altezza si riducono gap e margini, conservando i target touch.
Tra 700 e 899 px di larghezza e fino a 500 px di altezza si torna alle due
colonne, con gap di 24 px: il landscape breve offre larghezza sufficiente e
non deve riservare una seconda riga alla curva. Le safe area e `100dvh`
partecipano alla composizione; se lo spazio si esaurisce è consentito lo
scroll naturale, senza nascondere contenuti.

## Firma e movimento

Su richiesta esplicita del maintainer è stata ripristinata l'animazione
precedente: `lissajous.js` usa nuovamente lo stesso renderer 3D di Relax mode,
con `x = sin(t)`, `y = sin(2t)`, `z = sin(3t)`, proiezione prospettica,
rotazione lenta della camera, filamenti e scia mobile di venti secondi reali.
Il movimento conserva la velocità precedente (`SPEED = 0.5`). L'alone morbido
e i filamenti sono un'eccezione intenzionale alla versione iniziale del redesign:
la precedente modulazione planare risultava visivamente quasi statica.

La sola Home usa due colori, senza interpolare una palette multicolore:
`--home-voice` e `--home-target` sono alias di `--cyan` e `--amber`, gli stessi
token della prova. Le due semionde della curva assegnano ciano e ocra ai
segmenti, ai rispettivi filamenti, all'alone e al punto in movimento.
La scia parte già popolata anche con movimento ridotto. La geometria è centrata
e dimensionata nell'area assegnata dal layout approvato; margini e spessore dei
filamenti si adattano alla scena compatta su mobile.

Il DPR è limitato a 1.5 su mobile e 2 sugli altri viewport. Non si aprono
microfono, AudioContext o Worker. Il rendering si ferma fuori dalla Home,
dietro un altro dialogo, fuori dal viewport, in background e in pausa.
Con movimento ridotto parte statico e si arresta anche quando la preferenza
cambia; resta disponibile la ripresa esplicita. Observer, listener e RAF
vengono rilasciati all'uscita definitiva, preservando il ritorno da BFCache.
Il comportamento grafico di Relax mode rimane quello documentato separatamente.

## Profilo e impostazioni

Il disclosure nativo `details` riunisce profilo, impostazioni esistenti
(pausa, Relax mode, Base, Avanzate) e uscita dall'account. Non esiste più la
gear separata. La sezione Impostazioni raggruppa i controlli senza duplicarli.
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
- `python scripts/browser_relax_smoke.py`: rendering Relax, drag e frecce,
  pausa, movimento ridotto, ritorno alla prova e impostazioni del laboratorio.
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
