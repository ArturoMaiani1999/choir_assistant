# Staging: continuità della calibrazione e test diagnostico

**Status:** pubblicato e verificato su staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Problemi e comportamento

Il passaggio Home → brano fermava il microfono, invalidando il modello H
appena acquisito. Base poteva fermarlo nuovamente in pausa. Il risultato
appariva perso; inoltre il test diagnostico richiedeva proprio il modello
valido che la navigazione aveva invalidato, impedendo di registrare il problema.

La navigazione interna conserva ingresso e profilo vocale verificato. Il
caricamento dei decoder invalida solo H, escludendo la sottrazione; al Play
parte il controllo acustico di circa 10 s in silenzio e poi la prova riprende,
senza chiedere nuovamente le vocali. Base mantiene la sessione aprendo le
impostazioni, ma background, stop e navigazione fuori pagina rilasciano tutto.
Il profilo locale è riconoscibile anche prima di riaprire il microfono,
senza presentarlo come verificato sul dispositivo corrente. La preferenza
altoparlanti si ricorda per account/browser, separatamente da H.

Il test diagnostico richiede brano, altoparlanti e consenso, non una
calibrazione riuscita. In assenza di H verificata si registrano comunque
uscita e microfono, con sottrazione a guadagno zero, trattato uguale al
grezzo e `echo.calibrationVerified:false`. Nessun filtro scaduto viene
applicato per permettere la registrazione. Con H verificata resta disponibile
la registrazione del trattamento reale.

## Verifiche e confine

- Typecheck, 89 test API, 26 test DSP/calibrazione e 12 test packaging.
- Smoke Web Audio/Worker: Home senza brano, calibrazione completa, caricamento
  Ave verum conservando esattamente stream/context e profilo, Play con sola
  verifica acustica, nessun Worker vocale eseguito nuovamente, Base con
  sessione mantenuta, stop e annullamento.
- Smoke con brano, riuso del profilo locale, cambio dispositivo, background,
  permesso tardivo, chiusura/focus superato.
- Test diagnostico senza precedente calibrazione: consenso, registrazione,
  salvataggio locale D1/R2 con handler reale, retry dopo 503 sugli stessi byte,
  audio riletto identico, provenienza non verificata esplicita e rimozione.
  RMS grezzo e trattato identici, senza filtro applicato.
- Screenshot a 1366×768 e 390×844, stato del profilo salvato e test senza
  calibrazione, in `artifacts/calibration-session-fix/`.

Nel cloud al controllo del 20 ottobre risultava ancora solo il test reale
di Santo del 19 ottobre (`b04e8621-73fc-4906-86d7-c32e752b2450`). Non esisteva
una nuova acquisizione della prova con volume al 75%: il blocco del test è
coerente con quanto segnalato. Non si dichiara risolto né misurato il problema
di falsi positivi e scarti F0 nella nuova prova. Nessuna soglia o correzione
verso lo spartito è aggiunta per nasconderli; serve la nuova registrazione.

## Pacchetto

- Build `20261020-084501-46c4b97f1322-dirty`, 1.293 file e 19 brani.
- Asset congelati: `artifacts/calibration-session-fix/release`.
- Manifest SHA-256:
  `90120a46bd7ac0f44198d078aa1d533d4a7bcce74575086db89e7b3ab632d46d`.
- Home e Relax sono quelli già pubblicati: le modifiche parallele a quelle
  superfici nel workspace non fanno parte di questo deploy. Index conserva
  il markup distribuito e aggiorna soltanto i riferimenti agli asset audio.
- Rollback: `d14f1391-54d6-42c8-99d0-b4f0507fcb34`.
- Versione pubblicata: `88cffe87-d4b9-488c-9c02-0455c1ce5152`.
- Nessuna migrazione o modifica al contratto di autorizzazione.

Il pacchetto congelato supera lo smoke Home → brano e il test cloud senza
calibrazione, oltre allo smoke generale Ave verum/Partitura. Dopo il deploy:
login e configurazione pubblica 200; pratica anonima reindirizzata mantenendo
Santo/tenore; API e asset protetti 401, tutte risposte `no-store`. Evidenze in
`artifacts/calibration-session-fix/post-deploy.json`. Login interattivo Clerk
con account reale non ripetuto; autorizzazione simulata solo nel fixture locale.
