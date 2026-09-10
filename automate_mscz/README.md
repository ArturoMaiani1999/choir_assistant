# Automazione MSCZ

Questa cartella è una coda persistente: ogni PDF presente al livello principale viene elaborato una volta. Avvio o ripresa:

```powershell
python scripts/run_automate_mscz.py
```

La console mostra eventi Codex sintetici e un heartbeat ogni 30 secondi. Lo stesso output viene aggiunto a `reports/worker.log`; il JSONL completo di ciascun tentativo viene scritto in tempo reale sotto `.work/<brano>/reports/attempt-N/events.jsonl`.

Per osservare un worker già avviato con una versione precedente:

```powershell
python scripts/watch_automate_mscz.py
```

Il worker usa un solo processo Codex alla volta, con `gpt-5.6-sol` e reasoning `high`. Ogni bozza viene aperta ed esportata da MuseScore 4 e deve contenere note, testo e una parte denominata Organo. Una bozza che fallisce i controlli viene affidata nuovamente a Codex per una correzione.

Risultati:

- `output/*.mscz`: file che hanno superato i controlli automatici;
- `job-state.json`: stato persistente, usato per riprendere il lavoro;
- `reports/feasibility-report.md`: esito leggibile e blocker;
- `.work/`: file intermedi, log Codex e validazioni MuseScore.

In caso di rate limit/capacità esaurita il job attende 15 minuti e riprova per un massimo predefinito di 24 ore. Un problema globale di autenticazione/modello ferma la coda e viene riportato. I risultati restano bozze da approvare manualmente.

Il lock `.worker.lock` impedisce due esecuzioni contemporanee. Dopo un arresto anomalo verificare che non esista un worker attivo e riavviare con `python scripts/run_automate_mscz.py --force-unlock`.

Codex viene cercato nel `PATH` e, su Windows, nell’estensione OpenAI di VS Code. Per indicare un eseguibile diverso impostare `CHOIR_CODEX_EXECUTABLE` prima dell’avvio.
