# Private deployment runbook

**Status:** active — pre-production
**Owner:** project maintainer
**Last reviewed:** 2026-09-28
**Target:** static site protected by Cloudflare Access One-time PIN

Aggiornare le caselle man mano: `[ ]` da fare · `[x]` fatto.
Prezzi, limiti e nomi dei menu di Cloudflare cambiano: dove indicato "verificare", controllare la documentazione ufficiale al momento dell'uso.

| Fase | Stato |
|---|---|
| 0 · Diritti e repertorio autorizzato | ⬜ Bloccante: serve la scelta/autorizzazione del titolare |
| 1 · Build statica privata | 🔶 Implementata e collaudata; attende allowlist autorizzata e smoke E2E finale |
| 2 · Account/dominio/Pages | ⬜ Da configurare |
| 3 · Header di sicurezza | ✅ Generati automaticamente dalla build |
| 4 · Cloudflare Access OTP | ⬜ Da configurare prima di rendere raggiungibile il sito |
| 5–6 · Collaudo e onboarding | ⬜ Da iniziare |

---

## Release workflow

Il flusso professionale usa tre ambienti distinti e promuove lo stesso artefatto:

```text
sviluppo locale -> dist/ locale -> staging protetto -> produzione protetta
```

1. Sviluppare e diagnosticare con `python scripts/serve_frontend.py`.
2. Approvare diritti e contenuto di ogni voce in `deploy/repertoire.json`.
3. Eseguire una sola volta `python scripts/build_dist.py`.
4. Provare quella build con
   `npx wrangler pages dev dist --local-protocol=https`.
5. Caricare la stessa `dist/` in una preview già protetta da Access:
   `npx wrangler pages deploy dist --project-name choir-assistant --branch=staging`.
6. Registrare versione, hash del manifest, dispositivi e risultato del collaudo.
7. Promuovere la stessa directory, senza ricostruirla, con
   `npx wrangler pages deploy dist --project-name choir-assistant`.

Se una correzione modifica un file, il candidato precedente è scartato: si
genera una nuova build e si ripete l'intero collaudo. Le preview Pages sono
pubbliche per impostazione predefinita; configurare Access prima di caricarvi
repertorio reale.

---

## 1. Obiettivo e architettura

Un sito **non pubblico**, raggiungibile solo dai ~20 coristi autorizzati, senza database, senza gestione password e senza esporre il PC.

```text
corista ──HTTPS──> Cloudflare Access (cancello: email in allow-list + codice PIN)
                        └──> Sito statico (Cloudflare Pages)
                                 ├─ app (HTML/CSS/JS)
                                 └─ bundle musicali già approvati (JSON/SVG/audio/manifest)

Il tuo PC (MAI esposto): MuseScore, OMR, ingestione, admin, sorgenti .mscz
   └─ produce la build ──> comando di deploy ──> Pages
```

Cosa resta identico: analisi del microfono, take e preferenze restano **solo nel browser** del corista. Nessun audio lascia il dispositivo.

Cosa NON si fa: non si pubblica `scripts/serve_frontend.py`, non si espongono endpoint admin, non si genera nulla on-demand da richieste pubbliche.

---

## 2. Fase 0 — Cancello prima di pubblicare: diritti sul repertorio

- [ ] Decidere quali brani vanno online. I brani di Marco Frisina risultano protetti (autore vivente, spartiti pubblicati da Paoline Edizioni). Non risulta alcuna rinuncia ai diritti.
- [ ] Scrivere a Paoline Edizioni (ed eventualmente all'ufficio dell'autore) chiedendo una **licenza scritta** per: uso didattico, coro chiuso di ~20 persone, visualizzazione online di spartito e basi audio, durata e territorio.
- [ ] Nel frattempo pubblicare solo repertorio libero o proprio (es. polifonia sacra antica reincisa da fonti libere) oppure nulla di protetto.
- [ ] Se nel coro ci sono minori: prevedere informativa e consenso dei genitori (soglia del consenso digitale in Italia: 14 anni, da verificare).

Un cancello privato riduce l'esposizione ma non rende lecita la pubblicazione di materiale protetto. Non è consulenza legale.

---

## 3. Fase 1 — Build di produzione (la fa l'agente sul repo)

Obiettivo: una cartella `dist/` che contiene **solo** ciò che il corista deve scaricare.

**Decisione di produzione:** CREPE/ONNX resta uno strumento di test locale. È troppo pesante per l'esperienza dei coristi e non entra nella build privata. In produzione restano v1 e il filtro della sola visualizzazione.

**Task:**
- [x] Script `scripts/build_dist.py` che copia in `dist/` app e soli bundle presenti nell'allowlist `deploy/repertoire.json` con approvazione esplicita e nota sui diritti.
- [x] Escludere CREPE, modello ONNX e ONNX Runtime dalla build. Il caricamento CDN rimane disponibile esclusivamente nell'ambiente diagnostico locale.
- [x] **Escludere** dalla build: `scripts/`, `data/ingestions/`, sorgenti MusicXML/MSCSZ, `.env`, hook di test e qualsiasi endpoint `/api/*`; Benchmark/Revisione/Neurale sono disabilitati nella UI di produzione.
- [x] Nome degli asset applicativi con hash del contenuto (cache-busting) e `deployment-manifest.json` con versione e hash di ogni file.
- [x] Versione di build visibile nel footer (per capire cosa hanno i coristi).
- [ ] Se servirà la trasposizione online, pre-generare le basi autorizzate nelle tonalità ammesse: la build statica iniziale la limita intenzionalmente a `Originale` perché l'endpoint locale di trasposizione non viene pubblicato.

**Verifiche automatiche sulla `dist/` (fanno parte della build, falliscono se violate):**
- [x] Nessuna occorrenza di `__pitchTestHooks`, `/api/`, `cdn.jsdelivr`, `unpkg`, `localhost`.
- [x] Nessun `.mscz`, `.env`, `.py`, `.map`, `.musicxml`, `.xml`, `.onnx` o runtime ONNX.
- [x] Ogni file ≤ 25 MiB e totale file ≤ 20.000 (limiti di Pages Direct Upload verificati il 2026-09-28).
- [x] Ogni file incluso è registrato con SHA-256 nel manifest di deploy.
- [ ] Test Playwright sulla `dist/` servita in locale: pagina di pratica si carica, microfono richiesto, nessuna richiesta a domini esterni (intercettare la rete e fallire se ce ne sono).

---

## 4. Fase 2 — Account, dominio, hosting

- [ ] Creare un account Cloudflare (email dedicata, **MFA attivo**).
- [ ] (Consigliato) Comprare un dominio e delegare i nameserver a Cloudflare, poi usare un sottodominio tipo `coro.tuodominio.it`. Per una prova iniziale basta l'indirizzo gratuito `*.pages.dev`.
- [ ] Creare il progetto Pages con **Direct Upload** (senza collegare Git, si carica la cartella già costruita):

```bash
npx wrangler login
npx wrangler pages project create choir-assistant --production-branch main
npx wrangler pages deploy dist --project-name choir-assistant
```

- [ ] Collegare il dominio personalizzato dal dashboard (Pages → progetto → Custom domains).
- [ ] Verificare HTTPS attivo (il microfono funziona solo in contesto sicuro).

Alternativa: Workers con static assets, che Cloudflare sta promuovendo insieme a Pages; limiti simili. Verificare quale è consigliato al momento.

**Limiti da ricordare (verificare):** 20.000 file per sito sul piano gratuito e 25 MiB per singolo file. Se le basi audio superano il limite, metterle su R2 con dominio dedicato e proteggere anche quel dominio con Access.

---

## 5. Fase 3 — Header di sicurezza

Creare in `dist/_headers` (Pages lo applica automaticamente):

```text
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: microphone=(self), camera=(), geolocation=()
  Strict-Transport-Security: max-age=31536000

/index.html
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

Note:
- Non serve `'wasm-unsafe-eval'`: CREPE/ONNX non fa parte della distribuzione.
- Se l'app usa stili inline, la CSP potrebbe bloccarli: correggere spostando gli stili in file, non aggiungendo `'unsafe-inline'` senza necessità.
- Attivare HSTS solo quando HTTPS è stabile.
- Testare in un browser con console aperta: ogni violazione CSP compare come errore.

---

## 6. Fase 4 — Cancello d'accesso: Cloudflare Access con One-time PIN

Funzionamento: Access può inviare un codice via email agli indirizzi approvati, in alternativa a un identity provider. Il corista inserisce la propria email, riceve il PIN (valido 10 minuti), lo incolla ed entra. Non servono password né account Google.

- [ ] Attivare Zero Trust dal dashboard Cloudflare (potrebbe richiedere un metodo di pagamento anche per il piano gratuito; verificare). Secondo guide recenti il piano gratuito copre fino a 50 utenti: con 20 coristi dovrebbe bastare (verificare).
- [ ] Zero Trust → Integrations/Settings → Identity providers (o Authentication) → aggiungere **One-time PIN**.
- [ ] Creare un'applicazione **Self-hosted**:
  - hostname: `coro.tuodominio.it`
  - (se esiste) anche `static.tuodominio.it` per gli asset su R2
  - **policy Allow → Include → Emails**: elencare le email **esatte** dei coristi (una per riga).
  - durata sessione: valore ragionevole (es. 7–30 giorni; più lunga = meno attrito, ma la revoca vale alla scadenza).
- [ ] **Non usare** la regola "Emails ending in" con domini pubblici (`@gmail.com`, `@libero.it`, ecc.): farebbe entrare chiunque abbia quel provider. Va bene solo con un dominio tuo.
- [ ] Proteggere anche `choir-assistant.pages.dev` e le URL di preview `*.choir-assistant.pages.dev`, altrimenti restano pubbliche anche se il dominio personalizzato è chiuso. Verificare nel dashboard se Pages offre un'opzione dedicata per la policy di accesso.

---

## 7. Fase 5 — Test di accettazione (prima di invitare nessuno)

- [ ] Finestra anonima → `https://coro.tuodominio.it` → compare la pagina di login Access, non l'app.
- [ ] Email **non** in lista → nessun codice / accesso negato.
- [ ] Email in lista → arriva il PIN (controllare spam) → entra.
- [ ] `curl -I https://coro.tuodominio.it/assets/<file>` senza sessione → redirect al login o 403, **mai 200**.
- [ ] Stesso test su `https://choir-assistant.pages.dev` e su una URL di preview.
- [ ] Il microfono funziona su HTTPS; nessuna richiesta di rete verso domini esterni (DevTools → Network).
- [ ] Nessun errore CSP in console.
- [ ] Prova su: Chrome Android, iPhone Safari, Windows Chrome/Edge, con e senza cuffie Bluetooth (calibrare l'offset, la latenza Bluetooth sfasa base e voce).
- [ ] Rimuovere un'email di prova dalla policy e verificare che, alla scadenza sessione, l'accesso venga negato.

---

## 8. Fase 6 — Onboarding dei coristi

Messaggio tipo:

> Ciao! L'app di studio del coro è qui: https://coro.tuodominio.it
> Inserisci la tua email (quella con cui ti ho registrato), ti arriva un codice: incollalo e sei dentro. Controlla lo spam se non arriva.
> Usa le cuffie, consenti l'uso del microfono quando il browser lo chiede. La tua voce non viene registrata né inviata a nessuno: l'analisi resta sul tuo telefono/computer.
> Se hai problemi scrivimi.

- [ ] Raccogliere le email dei coristi (una per persona, quella che controllano davvero).
- [ ] Informativa breve: chi sei, cosa viene trattato (email per l'accesso, gestita tramite Cloudflare; log di accesso), che l'audio resta locale, nessuna analytics, come chiedere cancellazione (= rimozione dalla lista). Non è consulenza legale: farla rivedere se serve.

---

## 9. Gestione ordinaria

| Operazione | Come |
|---|---|
| Aggiungere/togliere un corista | Modificare la lista email nella policy Access |
| Revocare subito una sessione | Zero Trust → sessioni/utenti → revoca (verificare il menu) |
| Nuovo brano/versione | Approvare `ScoreVersion` → build → `wrangler pages deploy` |
| Tornare indietro | Dashboard Pages → Deployments → ripubblica una versione precedente |
| Aggiornare dipendenze | Audit periodico, riprovare test e build prima del deploy |

Backup (il PC è il punto debole): repository Git remoto privato, copia cifrata fuori dal PC di `sheets/`, `data/` e delle configurazioni; annotare a mano impostazioni di Access e dominio.

---

## 10. Cosa fa l'agente e cosa devi fare tu

| Compito | Chi |
|---|---|
| Script di build, esclusioni, verifiche automatiche, `_headers`, test browser | Agente |
| Account Cloudflare, MFA, dominio, nameserver | Tu |
| Zero Trust, One-time PIN, policy e lista email | Tu (l'agente può guidarti) |
| Licenza con l'editore per i brani protetti | Tu |
| Onboarding e informativa | Tu |

---

## 11. Problemi comuni

- **Il PIN non arriva:** spam/Promozioni, email diversa da quella in lista, errori di battitura.
- **Nella build compare “Neurale” o viene scaricato ONNX:** non distribuire; è una regressione della build e va corretta prima del deploy.
- **Microfono non parte su iPhone:** serve un gesto dell'utente per avviare l'audio; verificare `AudioContext` e permessi Safari.
- **File troppo grande al deploy:** superato il limite di 25 MiB per file → spostare su R2 protetto da Access.
- **Vecchia versione dopo il deploy:** cache/PWA; forzare l'aggiornamento e mostrare la versione di build.

---

## 12. Costi previsti

- Dominio: annuale (unica spesa quasi certa).
- Cloudflare Pages/Access con 20 utenti: verificare che restino nei piani gratuiti al momento dell'attivazione.
- Nessun database, server o SSO a pagamento.

---

## 13. Riferimenti da controllare

- Cloudflare Access — One-time PIN: https://developers.cloudflare.com/cloudflare-one/identity/one-time-pin
- Cloudflare Pages — Direct Upload: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Cloudflare Pages — limiti: https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare Workers — limiti e static assets: https://developers.cloudflare.com/workers/writing-workers/resource-limits/
