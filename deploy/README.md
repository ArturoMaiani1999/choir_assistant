# Repertorio della build privata

`repertoire.json` è l'allowlist esplicita dei brani pubblicabili. Un brano entra
nella build soltanto con `publication_approved: true` e una nota sui diritti
realmente verificabile:

```json
{
  "pieces": [
    {
      "id": "identificativo-in-frontend-library-assets",
      "publication_approved": true,
      "rights_note": "Licenza scritta del titolare, 2026-10-03, riferimento archivio CORO-001"
    }
  ]
}
```

Non copiare l'esempio e non lasciare `TODO`, `TBD` o altro testo segnaposto.
La build fallisce se la lista è vuota, se manca l'approvazione o se la nota sui
diritti è assente o ancora generica. Questo evita che materiale presente nel
repository venga pubblicato per errore.
