# Repertorio della build privata

`repertoire.json` Ã¨ una allowlist intenzionalmente vuota. Un brano entra nella
build soltanto con una voce esplicita e con `publication_approved: true`:

```json
{
  "pieces": [
    {
      "id": "identificativo-in-frontend-library-assets",
      "publication_approved": true,
      "rights_note": "Licenza/autorizzazione o pubblico dominio: riferimento verificabile"
    }
  ]
}
```

La build fallisce se la lista Ã¨ vuota, se manca l'approvazione o se la nota sui
diritti Ã¨ assente. Questo evita che materiale presente nel repository venga
pubblicato per errore.
