# Santo: audit, benchmark e nuova acquisizione diagnostica

**Status:** measured audit + controlled synthetic experiment; real-device diagnosis pending audio  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-19

## Evidenza disponibile

La nuova prova condivisa di Santo Frisina, Tenore P3, del 19 ottobre 2026
alle 09:03 italiane contiene PNG e traiettoria, ma nessun audio personale.
La verifica scoped su D1/R2 trova la pratica e la performance del profilo
Arturo Maianovksi; non trova una registrazione personale di Santo.
Il profilo omonimo Arturo Maiani appartiene a un'altra identità e non è
stato usato come sostituto.

La traiettoria ha 1954 campioni, di cui 143 con confidence zero. Il percorso
di condivisione disegnava anche questi candidati, benché non accettati dal
runtime. Ora il grafico interrompe la linea sulle osservazioni rifiutate o
provvisorie e conserva quelle ammesse, comprese le deboli e le note errate.
Il salvataggio delle nuove tracce conserva anche le interruzioni; le metriche
derivate usano TrackedPitch, non DisplayPitch. Non vengono riscritti i PNG
già condivisi. Le tracce storiche prive di flag sono lette conservativamente;
non è possibile ricostruirne ogni decisione live.

La traccia storica scarta gli intervalli senza target: non permette quindi
di quantificare i falsi positivi dell'introduzione. Non contiene PCM,
parametri completi del mixer o pitch grezzo. La dichiarazione di canto
eccellente orienta l'indagine ma non sostituisce una verità F0 indipendente.

Il best audio automatico richiede cuffie. L'attivazione del rientro dagli
altoparlanti lo rendeva ineleggibile senza mostrare chiaramente che la
preferenza salvata era sospesa. La UI ora lo dichiara sia nella sezione
altoparlanti sia nello stato del best automatico. Nessun audio può essere
recuperato retroattivamente dal PNG o dalla traiettoria.

## Riferimento e riproduzione controllata

Livelli riferiti dall'utente: organo 40%, soprano 50%, contralto 50%,
tenore 100%, basso 50%, metronomo circa 30%. Il fixture usa gli MP3 reali
distribuiti dalla webapp e il click ricostruito dall'inviluppo del mixer,
a 68 BPM. Hash delle sorgenti e assunzioni sono nel manifest generato.

Comandi:

```text
python scripts/prepare_santo_echo_benchmark.py
node scripts/benchmark_santo_echo.cjs artifacts/santo-research-2026-10-19/fixture artifacts/santo-research-2026-10-19/benchmark.json
```

Il master 62% è un'assunzione, non un dato riferito. Decode libsndfile,
resampling polyphase 44.1→48 kHz, mono, velocità 100%, nessuna trasposizione:
non sono una cattura bit-identica dell'uscita Chrome del telefono.
La voce è sintetica e indipendentemente etichettata dall'oscillatore, con
convergenza di attacco, vibrato e respiri. Il percorso acustico è simulato
con tap noti: il riferimento previsto è quindi un oracle favorevole, non
la calibrazione realmente misurata sul Samsung S25+.

Finestra 2048, hop 1600 (30 Hz), durata 70 s. Si riusa il rilevatore live
con i parametri normali predefiniti. Questo è un'ablation e non replica
il gain follower, il gate dinamico e il profilo microfono della prova reale.
I confini misti ±40 ms sono ignoti e non vengono conteggiati come pause.

L'esperimento `reference_pitch_probe.cjs` proietta localmente il segnale
trattato sul riferimento previsto e sulla sua derivata; usa il residuo solo
come ipotesi F0. Non modifica PCM, target o maschera voce/pausa e conserva
il risultato precedente se non trova un'ipotesi. Non è caricato nel browser.

## Risultati e decisione

Valori assoluti in cent, sullo stesso insieme di frame ammessi. Il controllo
raw è necessario: parte del vantaggio rispetto a TrackedPitch deriva dalla
rimozione del ritardo di smoothing sul vibrato, non dalla cancellazione.

| Caso | Raw mediana / P95 | Proiezione mediana / P95 |
| --- | --- | --- |
| Voce pulita | 1.10 / 1.62 | 2.10 / 9.62 |
| Percorso coincidente | 1.10 / 1.62 | 2.10 / 9.62 |
| Rientro ×2 | 1.98 / 6.65 | 2.11 / 9.55 |
| Rientro ×6 | 11.47 / 53.23 | 2.29 / 9.92 |
| Ritardo +32 campioni | 3.54 / 13.62 | 3.07 / 11.83 |
| Ritardo +128 campioni | 3.20 / 12.46 | 3.22 / 12.29 |
| Non linearità | 1.68 / 4.56 | 2.21 / 9.41 |
| Solo click ×4 | 1.16 / 9.23 | 1.09 / 1.66 |
| Voce volutamente errata +95 cent | 2.41 / 12.70 | 1.30 / 6.17 |

La proiezione aiuta nei casi di rientro forte e click, ma peggiora voce
pulita, rientro moderato e non linearità rispetto al raw. Anche una selezione
basata sulla clarity non elimina le regressioni. **Non viene adottata live.**
La nota volutamente errata resta tale: l'errore qui è rispetto alla vera
frequenza sintetica, non alla nota scritta.

La maschera è identica per ogni variante per costruzione e per assert:
nessun nuovo falso negativo, ma nemmeno eliminazione dei falsi positivi.
Nel caso ×6 ci sono 290 FN e 68 FP; nel click ×4 48 FN e 4 FP, invariati
tra le varianti. Non è una promessa di sensibilità o accuratezza sul telefono.
Il [contratto di qualità musicale](../../product/musical-performance-quality.md)
separa questi problemi dalla valutazione artistica.

## Test con salvataggio diretto

**Impostazioni → Base → Ascolto dagli altoparlanti → Registra test rientro**,
dopo aver attivato e calibrato la riduzione. Consenso esplicito separato dalla
registrazione personale; nessuna falsa dichiarazione di cuffie. Dopo il consenso
il test viene salvato automaticamente su R2 privato per sette giorni, associato
all'utente e al brano. La preferenza del best audio resta distinta.

Avvia il playback dal punto selezionato, registra al massimo 60 secondi,
mostra il tempo residuo e Termina test. All'arresto mette in pausa e libera
il microfono; la pagina nascosta invia la parte acquisita quando possibile.
Il risultato conferma Test salvato solo dopo risposta del server; in caso
di errore conserva il Blob e offre Riprova salvataggio o Scarta. Non serve
scaricare né allegare file. Riaprendo il dialogo si può eliminare il test.
Il [contratto di salvataggio](../../architecture/echo-diagnostic-storage.md)
descrive isolamento, scadenza, retry, limiti e accesso per assistenza.

Il WAV IEEE float32 ha quattro canali, stesso clock del mixer:

1. microfono grezzo;
2. riferimento reale dell'app, incluso il click;
3. microfono dopo il trattamento;
4. previsione non scalata del rientro.

Non c'è normalizzazione né clipping software: eventuali sovraccarichi restano
misurabili. Un chunk RIFF `chAI` contiene JSON con build, brano/parte, clock,
mixer, gain follower, modello congelato, callback pitch e impostazioni.
I callback pitch attraversano il bridge analyser/worker e non hanno la
precisione di allineamento campione per campione dei quattro canali PCM.
Il volume fisico del telefono non è leggibile via browser: viene osservato
attraverso il percorso acustico, non registrato come valore di sistema.
Esportazione circa 46 MB/min a 48 kHz, temporaneamente più memoria durante
la costruzione del WAV; uso limitato alla diagnosi, non registrazione lunga.

```text
python scripts/fetch_echo_diagnostic.py --id <UUID-del-test-salvato>
```

Il parser verifica formato, lunghezze, provenienza e PCM, quindi estrae quattro
file float32 e un manifest senza resampling. Il file microfono contiene
voce e rientro: l'eventuale annotazione F0 reale richiederà ascolto e verifica,
non la copia automatica delle note dello spartito.

## Rilascio e verifica

Il successivo rilascio con salvataggio diretto è documentato nel
[contratto di storage diagnostico](../../architecture/echo-diagnostic-storage.md).
I dati di rilascio che seguono descrivono la versione iniziale con export
locale e restano come storico; il flusso attuale non richiede allegati.

Staging `staging.epistrophe.it`, versione Worker
`8f8c7d2b-348c-4e37-8c57-51df745440b6`, build
`20261019-073218-46c4b97f1322-dirty`, manifest SHA256
`dfe190fac55276646cf7d5a00ddfb81f62979161114be1ac2006178156cce35e`.
1286 file inclusa la manifest, 19 brani. Rollback:
`261a50d1-9f8d-4a33-97c3-5b26430a29b2`.

Passano typecheck, 72 test applicativi, 24 test calibrazione/echo/diagnostica,
10 suite frontend, 30 test backend, 19 controlli configurazione/artifact e
12 test packaging. Audit dipendenze: zero vulnerabilità. Passano smoke dist,
review e percorso Web Audio reale con stanza sintetica. L'export è validato
anche dal parser Python; il browser verifica l'identità campione per campione
`processed = raw - gain * prediction`, consenso, stop, download, protezione
dei dati non scaricati, background e permesso microfono tardivo annullato.
Screenshot ispezionati a 1366×768 e 390×844, in
`artifacts/echo-santo-release-20261019/` con report del rilascio.

La versione distribuita è lo stesso `dist/` testato, senza rebuild. Modifiche
locali successive a studio.css e alla navigazione di piano_roll.js restano
fuori da questo candidato e non sono state sovrascritte. Il test del confine
di battuta ora ammette solo l'errore numerico di conversione sotto 0.00001
beat; non allarga il comportamento temporale del prodotto.
Login e auth/config rispondono 200, API e manifest anonimi 401, pagina
protetta 302 al login, tutti no-store. Il collaudo autenticato della UI usa
fixture solo loopback; non è stato impersonato l'account remoto. Restano
necessari l'audio reale del telefono e la validazione acustica su quello.
