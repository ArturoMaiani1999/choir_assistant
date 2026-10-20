# Direzione, repertorio personale e avanzamento

**Status:** implementato e attivo nel pilot staging  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-17

## Scopo

La pagina **Direzione** permette ai direttori di assegnare brani e controllare, usando i
nomi reali, lo stato di avanzamento di ogni corista. Non espone mai l'audio
personale. Usa metriche e traiettorie derivate dal pitch; il PNG del best resta
soltanto una miniatura di compatibilità, non la superficie di analisi.

La schermata iniziale della webapp è il punto di instradamento: il corista può
aprire **Il mio repertorio** oppure scegliere liberamente un qualsiasi brano
pubblicato. Il repertorio personale mostra soltanto i brani assegnati al coro,
lo stato personale, l'ultimo risultato e il numero di completamenti. **Apri
brano** porta direttamente alla prova con la parte vocale registrata nel
profilo. Dalla prova e dal repertorio personale si può sempre tornare alla
scelta dei brani. Lo stato si aggiorna automaticamente: il corista non può
dichiarare manualmente un brano completato.

I ruoli iniziali sono cumulativi:

- ogni membro attivo è anche `singer`;
- Arturo Maiani e Federico Cutrone ricevono `director` e `admin`;
- `director` autorizza la visione musicale dell'intero coro;
- `admin` resta distinto e non concede da solo la visione dei risultati;
- non esiste un pannello pubblico per cambiare ruoli o membri: il provisioning
  continua a usare il CSV operatore privato e il relativo comando di sync.

Le parti canoniche sono `soprano`, `contralto`, `tenore` e `basso`. Ogni
corista ha una sola parte valida per l'avanzamento. Può ascoltare o provare
altre parti, ma quelle prove non alimentano il cockpit.

## Assegnazioni e stati

Il direttore assegna o rimuove un brano da **Direzione**. L'assegnazione vale per
tutto il coro; un brano nuovo nasce non assegnato. Rimuoverlo non cancella la
storia. I tentativi su brani non assegnati non vengono memorizzati.

Gli stati sono:

| Stato | Regola |
|---|---|
| Non iniziato | nessun tentativo significativo |
| In esercizio | almeno 10 secondi di voce riconosciuta oppure 10% di copertura |
| Completato | prova dall'inizio alla fine con almeno 60% di copertura |
| Pronto | prova completata con almeno 75% di copertura e 80% dei campioni entro ±100 cent |

Velocità e trasposizione non impediscono di completare un brano. Il riepilogo
conserva ultimo tentativo, numero di completamenti, best score, best copertura
e massima velocità completata. Gli aggregati, invece, usano soltanto tentativi
comparabili a velocità 100%, tonalità originale e stessa versione dello
spartito.

## Raccolta, consenso e revoca

Il client prepara per il tentativo corrente:

- brano, versione, parte, velocità e trasposizione;
- copertura, durata vocalizzata e score entro ±100 cent;
- campioni pitch limitati e segmenti per occorrenza di battuta;
- conteggio dei campioni fuori tolleranza, senza metrica di oscillazione.

Prima del primo invio appare l'informativa di consenso. Rifiutare non blocca
ascolto e prova. Accettare abilita gli invii automatici dei soli brani
assegnati. Il corista può revocare i dati di un brano da **Mostra analisi → La mia
sezione**: vengono eliminati tentativi, riepilogo e best condiviso; l'audio
personale rimane separato e privato.

## Aggregazione e privacy

Per ogni combinazione coro, brano, versione e parte viene usato l'ultimo
tentativo completo e comparabile di ciascun corista. L'aggregato anonimo per i
coristi viene restituito soltanto con almeno due membri distinti della stessa
parte. Il cockpit autorizzato può invece confrontare le traiettorie individuali
con il nome del corista, come dichiarato nell'informativa di consenso.

Tutte le superfici musicali usano lo stesso modulo `PianoRoll`: prova in tempo
reale, analisi del best, aggregato di sezione e cockpit. Il renderer aggregato
storico è soltanto un adattatore di dati verso questo modulo, non un secondo
grafico. Nell'analisi il piano roll mostra:

- la stessa griglia cromatica e le stesse note obiettivo usate durante la prova;
- per il corista, la propria traiettoria con gli errori direttamente sulle note;
- suggerimenti aperti soltanto cliccando il relativo punto esclamativo;
- per il direttore, le ultime tracce individuali comparabili della stessa parte,
  sovrapposte e attivabili singolarmente;
- partitura, posizione ispezionata e piano roll sincronizzati durante pan e zoom.

Il corista vede nel repertorio personale il proprio avanzamento e, quando apre
la sezione risultati di un brano, il proprio best sul piano roll canonico. Il
direttore vede nomi, riepiloghi e traiettorie pitch individuali comparabili,
raggruppate per parte. Nessuna route di Direzione può leggere
`/api/recordings/*` di un altro membro: il cockpit riceve pitch derivato, mai
audio personale.

## Persistenza e lifecycle

La migrazione `0006_director_cockpit.sql` aggiunge:

- `voice_part` ai membri;
- profilo anagrafico autogestito (`first_name`, `last_name`, `profile_completed_at`): al primo accesso il corista conferma nome e cognome e può correggerli in seguito; email, sezione e ruoli non sono modificabili dal corista;
- accettazione versionata dei termini;
- assegnazioni del repertorio;
- tentativi di pratica con scadenza a 12 mesi;
- riepilogo corrente per membro e brano;
- coda di cleanup per le tracce R2.

Le tracce pitch complete sono JSON privati in R2. D1 conserva metadati e
riepiloghi. Il job giornaliero elimina tentativi scaduti e relativi oggetti.
Il riepilogo resta finché il membro è attivo o finché non revoca i dati; la
politica di disattivazione e cancellazione entro 30 giorni resta applicabile.

## API

```text
GET    /api/progress/consent
POST   /api/progress/consent
GET    /api/progress/assignments
POST   /api/progress/attempts
GET    /api/progress/pieces/{piece_id}/aggregate
DELETE /api/progress/pieces/{piece_id}

GET    /api/cockpit/overview
PUT    /api/cockpit/assignments/{piece_id}
GET    /api/cockpit/pieces/{piece_id}
```

Il prefisso API `/api/cockpit/*` e il percorso web `/cockpit` restano invariati
per compatibilità tecnica; nell'interfaccia il nome mostrato è **Direzione**.

Le mutazioni richiedono sessione valida e `Origin` uguale ad `APP_ORIGIN`.
Le route `/api/cockpit/*` richiedono `director` e filtrano sempre per
`choir_id`. Email, digest e subject Clerk non vengono restituiti.

## Attivazione staging

1. Eseguire typecheck, test, build e smoke test browser.
2. Applicare `0006_director_cockpit.sql` a D1 staging prima del nuovo Worker.
3. Preparare fuori Git il CSV con `email,display_name,voice_part,groups,roles,view_groups`.
4. Sincronizzare almeno Arturo e Federico con ruoli `singer;director;admin` e
   parte `tenore`, usando la stessa chiave HMAC già installata nel Worker.
5. Assegnare da Direzione uno o due brani pilota.
6. Eseguire il pilot con 3–5 persone: consenso, completamento, revoca,
   isolamento audio e soglia aggregata.
7. Controllare D1/R2 e rollback prima di estendere al resto del coro.

Il piano dropout/range rejection rimane una proposta separata: questa
funzionalità usa i campioni prodotti dal tracker corrente e non ne modifica
l'algoritmo.

## Collegamenti

- [Shared performances and scoped authorization](shared-performances-rbac.md)
- [Personal recordings and synchronized pitch replay](personal-recordings.md)
- [Informativa monitoraggio prove](../product/performance-monitoring-privacy-notice.md)
- [Lezione deployment staging](../operations/epistrophe-staging-deployment-lesson.md)
- [Dropout e range rejection](../engineering/pitch-tracking/dropout-and-range-rejection-plan.md)
