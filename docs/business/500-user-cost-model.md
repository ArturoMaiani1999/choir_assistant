# Modello economico con 500 utenti

**Status:** planning baseline  
**Owner:** project maintainer  
**Last reviewed:** 2026-10-05  
**Currency:** EUR

Questo documento stima ricavi, costi e fabbisogno economico dei primi due anni
di un servizio commerciale di Choir Assistant con 500 coristi paganti. Non è un
preventivo legale o fiscale: le condizioni definitive dipendono dai contratti
con SIAE e con gli editori e dall'inquadramento fiscale del titolare.

## 1. Risultato sintetico

Nello scenario base, 500 coristi pagano 20 EUR all'anno e accedono a un catalogo
protetto. Lo sviluppo software, la preparazione degli spartiti e la produzione
delle tracce sono svolti dal titolare e hanno costo monetario pari a zero.

| Voce | Anno 1 | Anno 2 |
|---|---:|---:|
| Incassi, IVA inclusa | 10.000 | 10.000 |
| Ricavi al netto dell'IVA | 8.197 | 8.197 |
| Costi economici | 14.750 | 12.350 |
| **Risultato operativo prima di imposte e contributi** | **-6.553** | **-4.153** |

La conclusione è che **20 EUR per utente non sostengono un catalogo protetto con
i minimi ipotizzati**, neppure con 500 utenti. Il prezzo di pareggio indicativo
è circa:

- 37 EUR IVA inclusa per utente nel primo anno;
- 31 EUR IVA inclusa per utente dal secondo anno.

Questi prezzi non remunerano il lavoro del titolare e non comprendono imposte e
contributi personali.

## 2. Assunzioni

| Parametro | Assunzione |
|---|---:|
| Utenti paganti | 500 |
| Dimensione media del coro | 25 coristi |
| Cori clienti | 20 |
| Prezzo al pubblico per utente/anno | 20 EUR IVA inclusa |
| Incasso per coro/anno | 500 EUR IVA inclusa |
| Fatturazione | un pagamento annuale per coro |
| Territorio | Italia |
| Pubblicità | assente |
| Download permanente | assente |
| Audio | tracce prodotte internamente |
| Sviluppo e produzione editoriale | svolti dal titolare, 0 EUR di cassa |
| Regime IVA usato dal modello | ordinario, aliquota ipotizzata 22% |

I 10.000 EUR incassati includono l'IVA. Il ricavo economico è quindi:

```text
10.000 / 1,22 = 8.196,72 EUR
```

Nel regime forfettario il calcolo cambia: non si addebita normalmente l'IVA, ma
l'IVA pagata ai fornitori non è recuperabile. Lo scenario deve essere rifatto
con il commercialista dopo aver scelto l'inquadramento.

## 3. Diritti musicali

### 3.1 SIAE

Il modello usa la tariffa standard italiana pubblicata nelle Condizioni
Generali di Licenza Musica Online 2026 per lo streaming in abbonamento:

- minimo trimestrale: 900 EUR, al netto dell'IVA;
- minimo annuale, con quattro trimestri: 3.600 EUR;
- aliquota: 15% degli introiti lordi al netto dell'IVA;
- minimo per stream: 0,003 EUR.

Il minimo è un anticipo: si paga il maggiore fra il minimo garantito e il
compenso calcolato con aliquote e utilizzi, non la loro somma. Con 8.196,72 EUR
di ricavi netti, il 15% è 1.229,51 EUR e resta inferiore al minimo; il costo
usato nel modello è quindi 3.600 EUR.

La classificazione deve essere confermata per iscritto da SIAE. L'articolo 18.5
delle condizioni consente una negoziazione specifica quando il servizio non
rientra nelle fattispecie standard.

Fonte: [Condizioni Generali di Licenza Musica Online 2026](https://d2aod8qfhzlk6j.cloudfront.net/SITOIS/SIAE_CGL_Musica_Utilizzazioni_Online_GOAL_a917ec7db5.pdf).

### 3.2 Editore

La licenza SIAE non comprende riproduzione grafica di spartiti e testi,
visualizzazione a schermo, elaborazioni e adattamenti. Per il catalogo di Marco
Frisina e Fabio Massimillo queste facoltà devono essere concordate con i
titolari, presumibilmente tramite Paoline per le opere da essa pubblicate.

Non esiste un listino pubblico applicabile a questa app. Il modello usa una
**ipotesi negoziale**, non un prezzo comunicato da Paoline:

- royalty: 12% dei ricavi netti;
- minimo garantito annuale: 2.500 EUR;
- si applica il maggiore dei due valori.

Il 12% di 8.196,72 EUR è 983,61 EUR. Il modello applica quindi il minimo di
2.500 EUR in entrambi gli anni.

Il contratto dovrà specificare almeno: opere incluse, spartito completo,
singole parti, testi, piano roll, evidenziazione sincronizzata, arrangiamenti,
tracce separate, eventuali trasposizioni, durata, territorio, numero di utenti,
report e diritto di usare nomi e materiali promozionali.

### 3.3 Master e interpreti

Il costo è posto a zero perché le tracce sono prodotte internamente e non si
usano registrazioni Paoline o di terzi. L'autorizzazione editoriale per
l'arrangiamento resta comunque necessaria.

## 4. Costi del primo anno

Gli importi sono costi economici al netto dell'IVA recuperabile, ove
applicabile.

| Categoria | Voce | Anno 1 | Natura della stima |
|---|---|---:|---|
| Diritti | SIAE, minimo annuale | 3.600 | tariffa pubblicata, classificazione da confermare |
| Diritti | Editore, minimo garantito | 2.500 | ipotesi negoziale |
| Pagamenti | Stripe Payments e Billing | 225 | calcolo su 20 pagamenti da 500 EUR |
| Rischio ricavi | rimborsi, insoluti e commissioni perse | 200 | riserva pari al 2% degli incassi |
| Infrastruttura | Workers, D1/R2, dominio, email, monitoraggio, backup | 425 | budget prudenziale |
| Amministrazione | commercialista e adempimenti | 1.200 | stima di mercato |
| Legale | negoziazione/revisione contratti di licenza | 2.500 | una tantum prevalente |
| Privacy | privacy policy, termini, GDPR e contratti fornitori | 1.000 | prima impostazione |
| Avvio | apertura e configurazione amministrativa dell'attività | 400 | una tantum |
| Rischio | RC professionale/cyber | 400 | copertura prudenziale |
| Vendite | sito commerciale, demo, trasferte e promozione | 1.500 | budget lean |
| Qualità | riserva dispositivi e collaudi | 300 | hardware già disponibile |
| Contingenza | spese impreviste | 500 | riserva |
|  | **Totale anno 1** | **14.750** |  |

### Calcolo Stripe

Il modello usa le tariffe pubbliche correnti per carte SEE standard e Billing:

```text
Payments: 1,5% x 10.000 + 0,25 x 20 pagamenti = 155 EUR
Billing:  0,7% x 10.000                         =  70 EUR
Totale                                               225 EUR
```

Fatturare una volta per coro costa meno di 500 transazioni individuali. Il
bonifico annuale potrebbe ridurre ulteriormente il costo, aumentando però la
gestione manuale e il rischio di insoluti.

Fonte: [Stripe Billing e Payments](https://stripe.com/it/billing/pricing).

### Infrastruttura

Il budget di 425 EUR è intenzionalmente superiore al solo hosting. Cloudflare
Workers Paid parte da 5 USD al mese e include 10 milioni di richieste mensili;
a questa scala il costo tecnico dovrebbe restare modesto. Il budget include
anche dominio, posta transazionale, casella aziendale, monitoraggio e backup.

Fonte: [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## 5. Costi del secondo anno

Il secondo anno elimina i costi di apertura e riduce la consulenza legale e
privacy alla manutenzione. Mantiene i minimi dei diritti: non è prudente
considerarli una tantum.

| Categoria | Voce | Anno 2 | Natura della stima |
|---|---|---:|---|
| Diritti | SIAE, minimo annuale | 3.600 | tariffa pubblicata, classificazione da confermare |
| Diritti | Editore, minimo garantito | 2.500 | ipotesi negoziale |
| Pagamenti | Stripe Payments e Billing | 225 | 20 rinnovi annuali |
| Rischio ricavi | rimborsi, insoluti e commissioni perse | 200 | 2% degli incassi |
| Infrastruttura | hosting, dominio, email, monitoraggio, backup | 425 | budget prudenziale |
| Amministrazione | commercialista e adempimenti | 1.200 | ricorrente |
| Legale | manutenzione e rinnovo licenze | 750 | ricorrente |
| Privacy | aggiornamenti documentali | 250 | ricorrente |
| Rischio | RC professionale/cyber | 400 | ricorrente |
| Vendite | rinnovi, acquisizione nuovi cori e promozione | 2.000 | budget lean |
| Qualità | riserva dispositivi e collaudi | 300 | ricorrente |
| Contingenza | spese impreviste | 500 | riserva |
|  | **Totale anno 2** | **12.350** |  |

## 6. Costi posti a zero

Queste attività esistono, ma non generano un esborso perché sono svolte dal
titolare:

| Attività | Costo monetario |
|---|---:|
| sviluppo e manutenzione software | 0 |
| trascrizione e pulizia degli spartiti | 0 |
| arrangiamenti e separazione delle voci | 0 |
| generazione e mastering delle tracce | 0 |
| QA musicale | 0 |
| rendicontazione tecnica SIAE | 0 |
| assistenza di primo livello | 0 |

È utile registrare comunque le ore. A titolo puramente gestionale, 400 ore
annue valorizzate a 25 EUR/ora equivalgono a un costo-opportunità di 10.000 EUR,
ma tale importo non è incluso nei totali.

## 7. Sensibilità al prezzo

La tabella mantiene 500 utenti, minimi SIAE/editore e tutte le altre ipotesi.
Le commissioni di pagamento e la riserva rimborsi crescono con gli incassi.

| Prezzo utente/anno, IVA inclusa | Incassi | Risultato anno 1 | Risultato anno 2 |
|---:|---:|---:|---:|
| 20 | 10.000 | -6.553 | -4.153 |
| 30 | 15.000 | -2.665 | -265 |
| 40 | 20.000 | +1.223 | +3.623 |
| 50 | 25.000 | +5.112 | +7.512 |

Il pareggio matematico è circa 36,9 EUR nel primo anno e 30,7 EUR nel secondo.
Un prezzo commerciale deve essere superiore al pareggio per assorbire tasse,
contributi, oscillazioni dei costi e abbandono degli utenti.

## 8. Scenario alternativo: solo pubblico dominio

Se il servizio contiene esclusivamente composizioni in pubblico dominio,
edizioni utilizzabili, arrangiamenti propri e registrazioni proprie, le due
voci di diritti del modello possono scendere a zero. Restano attribuzioni e
condizioni delle eventuali licenze Creative Commons.

Assumendo che non serva la consulenza contrattuale iniziale da 2.500 EUR per il
catalogo protetto:

| Voce | Anno 1 | Anno 2 |
|---|---:|---:|
| Ricavi netti IVA | 8.197 | 8.197 |
| Costi stimati | 6.150 | 5.500 |
| **Risultato operativo** | **+2.047** | **+2.697** |

Questo scenario mostra perché il catalogo libero è adatto alla validazione:
consente di raggiungere i primi utenti senza attivare minimi di licenza. Prima
di inserire opere protette occorre aver concluso gli accordi scritti.

## 9. Scenario con diritti negoziati senza minimi

Se, per ipotesi, SIAE accettasse il solo 15% dei ricavi netti ed editore il 12%
senza minimi:

| Diritti | Con minimi | Senza minimi |
|---|---:|---:|
| SIAE | 3.600 | 1.230 |
| Editore | 2.500 | 984 |
| Totale | 6.100 | 2.214 |

Il risultato diventerebbe circa -2.666 EUR nel primo anno e -266 EUR nel
secondo. Anche in questo caso, a 20 EUR il margine rimane troppo sottile finché
non si riducono marketing/amministrazione o aumenta il prezzo.

## 10. IVA, imposte, contributi e cassa

Il risultato operativo non è il netto personale del titolare. Sono esclusi:

- imposta sul reddito o imposta sostitutiva;
- contributi INPS;
- eventuale diritto camerale e costi legati allo specifico codice attività;
- acconti fiscali;
- effetti del regime forfettario;
- stipendio o compenso del titolare.

In regime IVA ordinario i costi sono rappresentati al netto dell'IVA
recuperabile, ma le fatture SIAE/editore vanno pagate comprensive d'IVA prima
della liquidazione: serve quindi liquidità aggiuntiva. Il piano di cassa dovrà
essere completato dopo aver ricevuto preventivi reali e scelto il regime
fiscale.

## 11. Dati da sostituire con preventivi

Prima di usare questo documento per una decisione di lancio bisogna sostituire:

1. classificazione e preventivo scritto SIAE;
2. minimo, royalty e perimetro della licenza editore;
3. preventivo del commercialista;
4. preventivo legale e privacy;
5. regime fiscale e previdenziale;
6. prezzo verificato con almeno 10-20 direttori di coro;
7. tasso atteso di rinnovo e numero reale di coristi per coro.

Il modello va aggiornato almeno una volta l'anno e ogni volta che cambia uno dei
contratti di licenza.
