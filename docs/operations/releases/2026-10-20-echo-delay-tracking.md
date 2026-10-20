# Staging: candidato per il tracking del ritardo del rientro

**Status:** experimental candidate deployed; two fresh attempts expose 40 ms training jump and voice-analysis stall; live confirmation incomplete  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-20

## Comportamento

La previsione del rientro segue automaticamente variazioni relative di ritardo
confermate a banda larga. Il ramo microfono resta diretto, H congelato e la
guida mantiene un solo comando Calibra audio. Nessun nuovo gate del pitch
durante il riallineamento. La regolazione del volume rimane indipendente;
un comando di ritardo scarta la stima di volume calcolata sul vecchio percorso.

Lo [studio del candidato](../../engineering/pitch-tracking/echo-delay-tracking-2026-10-20.md)
descrive algoritmo, dati, criteri di rifiuto e limiti. È una versione per la
conferma sul dispositivo, non la dimostrazione che il canto di Santo sia risolto.

## Pacchetto

- Origine: `https://staging.epistrophe.it`.
- Worker: `choir-assistant-auth-staging`, configurazione `wrangler.jsonc`.
- Build: `20261020-115221-46c4b97f1322-dirty`, 1.295 file.
- Pacchetto congelato: `artifacts/echo-delay-tracking/release`.
- Manifest SHA-256:
  `8c5bde509ddf98e1119ab22332dd098443d353e749b646a11266e69acde1e18e`.
- Versione: `ea423848-4d39-4947-a40e-1aed025bcbcd`, attiva al 100%.
- Deployment: `f86bc761-6c17-45d9-8e4e-5c1b1494b5c1`.
- Tag: `echo-delay-tracking-2026-10-20`.
- Rollback: `ff91f78c-5193-4f1c-9c2f-3c72b68c104b`.

Derivato dal pacchetto precedente, cambiando solo sei moduli audio e relativi
riferimenti/versione. Home e altri asset conservati; bundle Worker identico
al dry-run precedente, SHA-256
`b99cad71a3a7e5a8ceaeabbefeca7582aebac1e703527c212d23f398b2f2b051`.
Nessuna migrazione, modifica ai consensi o dati reali caricati da questo deploy.

## Verifiche e risultati

TypeScript, 89 test applicativi, 40 test audio/calibrazione, mixer, 12 test
packaging, audit documentazione/riferimenti/integrità e dry-run superati.
Il primo tentativo dei test Python usava un percorso di import errato;
esecuzione corretta `python scripts/build_dist_test.py`: 12/12.

Browser sul pacchetto congelato: guida completa da Home e passaggio al brano,
guida in Santo, cinque riaperture Base, volumi ×2/×0,5, ritardi +1/+6 ms e
ritorno, voce all'unisono, clipping, invalidazioni e rilascio. Test cloud locale:
consenso, invio, retry dopo errore con gli stessi byte, lettura del PCM salvato
e cancellazione del proprietario. Nessun fixture di autenticazione distribuito.

Un primo smoke esteso confrontava il valore istantaneo del guadagno ancora in
rampa con un campione successivo. L'assert confronta ora il guadagno comandato,
che è il dato corretto per verificare che il ritardo non insegni un volume
diverso; restano le verifiche del residuo dopo assestamento. Il test finale
sulla versione pubblicata passa. Prove in `artifacts/echo-delay-tracking/`:
`browser-final`, `browser-home`, `browser-loading` e `voice-quality.json`.

Screenshot 1366×768 e 390×844 ispezionati: Base e risultato senza clipping o
scroll predefinito; gerarchia, CTA unica e dettagli espandibili conservati.
Nessun cambio di layout. La verifica sintetica statica produce 34,3 dB.

Replay causale del PCM reale: percorso stabile a 8/15 conserva 22,88 dB, senza
aggiornamenti inutili. Nel probe 11/15 il salto di 6 ms viene seguito a
7,672 s: intero 7–10 s da −1,82 a 8,73 dB; dopo assestamento da −3,08 a
22,00 dB. **Il modello alto era rifiutato per picco e viene forzato solo
nella sensibilità offline.** Non è una calibrazione che questa release accetta.

Sei test con voce nota, 284 finestre prefissate ciascuno: zero falsi negativi
introdotti sui frame ammessi dalla baseline, ma 14–17 falsi negativi residui
per caso durante i transitori. Preservazione vocale entro 0,5 dB nei casi
provati. Non è un risultato su canto umano o una nuova conferma cieca.

Dopo deploy: accesso/configurazione 200, pratica anonima 302 con contesto
conservato, API/catalogo/moduli 401; `no-store` verificato per tutte le risposte.
Evidenza: `artifacts/echo-delay-tracking/post-deploy.json`.

## Prossima conferma

Al controllo successivo ADB non vede più il telefono. Richiesto di ricollegarlo
e aprire Chrome; nessuna nuova misura acustica viene dichiarata. La prova
successiva congela build, posizione e volume, verifica prestazioni/carico
reali e separa musica/metronomo. Il target ≥20 dB sull'intero tratto resta
aperto; il solo valore dopo assestamento non basta per chiuderlo.

Alla riconnessione vengono eseguiti due tentativi sulla stessa build: il primo
accetta H a 23,14 dB ma non termina l'analisi vocale; il secondo rifiuta H a
1,80 dB, con salto di 40 ms durante il training, senza clipping sopra soglia.
Il test indipendente di rumore/metronomo non parte. Entrambi conservati;
microfono rilasciato e volume 11/15 ripristinato. Nessun nuovo deploy in questa
fase: il recupero a 24,06 dB con training stabile è soltanto un'ablation offline.
Risultati, limiti e criteri del prossimo candidato nello studio collegato.
