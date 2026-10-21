# AEC nativo e selezione armonica live

**Status:** deployed to Epistrophe staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-21

Ambiente: `https://staging.epistrophe.it`, configurazione `wrangler.jsonc`.
Xynon e produzione non vengono distribuiti.

Prima versione: `6024e2ae-9cf4-41f9-b5f7-e6360e9c3209`, build
`20261021-090851-native-aec-live`, pacchetto
`artifacts/native-aec-live/release-verified`. SHA-256 manifest
`4e4f6aa69cb12c73aa302eb8a76535b8c49b6bfa3d735a185ac725dfbd28a064`.
Rollback alla release clock `34d941eb-7da7-44ca-94db-5691550c7eab`.

Il percorso altoparlanti richiede AEC true, NS/AGC false e ne verifica i
settings; non concatena il filtro custom. La guida controlla il residuo
per 8 s e la voce per 22 s, circa 30 s totali. Il detector confronta periodi
armonici con evidenza acustica forte, senza spartito o futuro.

L'aggiustamento finale isola l'ammissione originale del tracker dalla
frequenza scelta. Pacchetto `artifacts/native-aec-live/release-admission`,
build `20261021-092308-native-aec-live`; SHA-256 manifest
`aeb27b3846af8cbb792c3eb925fec730bc064ccceff3309a22c6e69b1cb04586`.
Il profilo vocale creato nella prima versione resta compatibile.
Versione finale `3d7f9e84-6d4d-4244-9779-fc4397418161`, 100% del traffico;
rollback immediato `6024e2ae-9cf4-41f9-b5f7-e6360e9c3209`. Per tornare alla
catena custom precedente usare invece `34d941eb-7da7-44ca-94db-5691550c7eab`.

Entrambi i pacchetti derivano dalla release clock congelata, con copia dei
soli moduli audio e modifiche esplicite all'app congelata. Non includono i
lavori concorrenti su marchio/Home. `prepare.py` e i report `*-isolation.json`
documentano i 12 moduli/pagine modificati. Musica, altri moduli e inventario
conservati; riferimenti fingerprintati controllati, nessun import obsoleto.
Bundle server invariato, SHA-256
`b99cad71a3a7e5a8ceaeabbefeca7582aebac1e703527c212d23f398b2f2b051`.

149 test (89 API, 60 DSP/lifecycle), typecheck e sintassi passati. Browser
con guida completa/riuso, apertura Base, Home→brano, sospensione e chiusure;
confronto custom con voce all'unisono, gain e retiming passato. Screenshot
1366×768/390×844 ispezionati. Replay con impostazioni reali conserva esattamente
il gate e il tracker sulle due registrazioni: nessuna finestra ammessa persa.

S25+: prima guida rifiutata per residuo alto, con disconnessione ADB che ne
impedisce l'export. Nessuna soglia allentata; prova acustica seguente passa,
poi guida completa raggiunge Audio pronto, voce 100%, pause 90%, media 95%
sulle etichette guidate. Non è accuratezza F0. Volume ripristinato a 5/15;
microfono rimasto attivo al successo come dichiarato nella UI. Questa guida
precede l'ultimo aggiustamento del tracker, collaudato poi su PCM e browser.

Il controllo anonimo post-deploy verifica sign-in/configurazione 200,
redirect HTML al login con contesto, API/manifest/moduli 401 e `no-store`.
Evidenze in `artifacts/native-aec-live`; il [contratto tecnico](../../engineering/pitch-tracking/native-aec-live-2026-10-21.md)
riporta limiti, risultati incompleti e verifiche ancora necessarie sul canto
di un brano intero. L'AEC può alterare il timbro e non elimina ogni ambiguità
armonica; non è dichiarato un miglioramento universale di accuratezza.
