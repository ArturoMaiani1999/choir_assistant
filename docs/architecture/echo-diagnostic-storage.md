# Salvataggio dei test di rientro

**Status:** implemented and deployed on staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Esperienza

Non serve una calibrazione riuscita per registrare il test. Se manca un
modello acustico verificato si acquisiscono comunque i quattro canali, con
sottrazione disattivata (guadagno zero) e segnale trattato uguale al grezzo.
Il chunk `chAI` dichiara `echo.calibrationVerified:false`, gain 0 e valori di
qualità nulli; nessun filtro scaduto viene riattivato. Se il modello è pronto
si acquisisce il trattamento effettivo con `calibrationVerified:true`. Il
consenso, la durata, lo scope per coro/account e la scadenza restano uguali.

Il test usa lo stesso dialogo e la stessa acquisizione della diagnosi locale,
ma non richiede download o allegati. Prima dell'avvio l'utente autorizza
registrazione, salvataggio e condivisione per diagnosi con direttori del
proprio coro e assistenza tecnica autorizzata. Dopo al massimo 60 secondi
il microfono si chiude e parte automaticamente l'invio. “Test salvato”
compare solo dopo la conferma del server. Un errore conserva il Blob nella
pagina e offre Riprova salvataggio oppure Scarta; navigare via può perderlo.
Non si afferma una persistenza offline dopo la chiusura della pagina.

Ogni utente conserva un test per brano: il nuovo test sostituisce il precedente,
come dichiarato nei dettagli e nello stato quando ne esiste già uno. Riaprendo
il dialogo l'utente vede che il test esiste e può eliminarlo. Non serve
una conferma di cuffie: questa risorsa contiene intenzionalmente il rientro.
Il best audio personale mantiene il proprio contratto e resta separato.

I quattro canali PCM condividono il clock: microfono grezzo, uscita app,
microfono trattato, previsione non scalata del rientro. Pitch e impostazioni
sono nel chunk JSON `chAI`; il bridge del rilevatore non ha precisione di
timestamp campione per campione. La forma WAV float32 preserva anche i picchi
oltre ±1, senza normalizzazione o compressione con perdita.

## Accesso e ciclo di vita

`echo_diagnostics` in D1 è il puntatore autorevole, con owner e coro derivati
dalla sessione Clerk e dal membro attivo. Il client non sceglie owner o chiave
R2. Il bucket privato usa `echo-diagnostics/<coro>/<membro>/<brano>/<uuid>.wav`.
Non esistono link pubblici. La risorsa non entra negli aggregati o nel voto.

- `POST /api/echo-diagnostics`: WAV binario, contesto repertorio validato,
  `X-Diagnostic-Consent: capture-store-share-v1`, UUID stabile durante i retry.
- `GET /api/echo-diagnostics?pieceId=...`: test dell'utente per quel brano.
- `GET` e `DELETE /api/echo-diagnostics/<id>`: lettura ed eliminazione owner.
- `GET /api/cockpit/echo-diagnostics?pieceId=...` e `GET .../<id>`: sola lettura,
  direttori dello stesso coro, membro proprietario attivo. Section viewer e
  altri cantori non accedono.

Tutte le risposte sono no-store. L'ingresso nel Worker mantiene i controlli
autenticazione, allowlist e Origin per le mutazioni. La scadenza di sette
giorni viene verificata ad ogni lettura; il cron elimina successivamente
righe scadute e oggetti, quindi l'inaccessibilità precede la rimozione fisica.
Trigger D1 accodano oggetti sostituiti/eliminati. Un candidato incompleto
entra prima nella coda con ritardo di un giorno, così un'interruzione non
lascia un oggetto orfano senza un percorso di pulizia. Il cleanup non rimuove
oggetti ancora referenziati da una riga. Le eliminazioni fallite sono ritentate.

L'operatore di assistenza può leggere soltanto un test attivo e consentito
tramite `scripts/fetch_echo_diagnostic.py`, senza copiare cookie o rendere
pubblico R2. Il comando esige un UUID specifico e verifica owner, scadenza
e prefix della chiave. Il recupero usa il profilo Cloudflare autorizzato
ed è limitato alla diagnosi richiesta dall'utente.

## Limiti e consistenza

La richiesta ha limite 100000000 byte, quattro canali IEEE float32, frequenza
8–96 kHz e massimo 60 secondi. Header WAV e provenienza finale sono verificati
incrementalmente; il Worker non materializza il PCM in RAM. La coda passa
attraverso FixedLengthStream e R2, con pressione sul produttore e verifica
della lunghezza. I metadati hanno limite 7 MB. Il client usa un timeout di
tre minuti: se la conferma si perde, riprova con lo stesso UUID e Blob.
L'oggetto è immutabile e D1 viene aggiornato solo dopo l'upload valido. La
conferma idempotente evita un secondo upload per un UUID già salvato.
Upload simultanei mantengono il test il cui commit termina per ultimo;
i trigger accodano i candidati sostituiti.

Il browser conserva fino a circa 46 MB/min a 48 kHz, più memoria transitoria
per l'encoding WAV; il limite serve a una prova diagnostica breve. Non è una
funzione di registrazione lunga o un meccanismo di calibrazione automatica
dell'accuratezza F0. Il nuovo salvataggio non modifica il detector o i gate.

## Verifica

Test API: consenso, formato e provenienza, upload falliti R2/D1, byte PCM
preservati, idempotenza, sostituzione, isolamento owner/coro/ruolo, scadenza
e pulizia. Il browser usa il percorso Web Audio con stanza sintetica e
un Worker workerd locale con D1/R2 locali per l'invio reale. Simula un primo
errore di rete, ritenta lo stesso Blob, verifica SHA256 rileggendo il file
persistito e prova l'eliminazione owner. UI ispezionata a 1366×768 e 390×844.

Rilascio staging: Worker `6e60a279-408e-44ca-8fea-46c457eb0c65`, build
`20261019-192000-46c4b97f1322-dirty`, manifest SHA256
`f087295ebe118cce68771f77600b90c5862c099c40e7f30be59abc0233b653a6`.
Migrazione additiva `0010_echo_diagnostics.sql`, nessuna modifica alle
registrazioni personali esistenti. La prima versione del salvataggio diretto
era `6bd351ac-d0c0-4fb3-a9fa-d5541c7683ab`; il candidato finale aggiorna anche
i testi nelle impostazioni. Rollback prima della funzione:
`ea2ceb46-7868-436e-a524-227e221a19e5`, che ignora le nuove tabelle.
Artefatti di accettazione e screenshot: `artifacts/echo-upload/`.
77 test applicativi, 24 calibrazione/echo, 12 packaging, suite frontend e
backend e controlli documentali/configurazione passano. Passano smoke dist,
review, navigazione piano roll e upload con errore/retry. I trasferimenti
di 60 secondi a 48 e 96 kHz sono riletti con SHA256 identico ed eliminati
nel solo ambiente locale. Non sono stati caricati test sintetici nel profilo
reale del cantante. Nessuna modifica al detector è inclusa in questo flusso.
