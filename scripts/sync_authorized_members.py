"""Synchronize a private email list to D1 without uploading plaintext addresses."""

from __future__ import annotations

import argparse
import csv
import hashlib
import hmac
import os
import secrets
import shutil
import subprocess
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECRET_ENV = "CHOIR_AUTH_EMAIL_HMAC_KEY"


def normalize_email(value: str) -> str:
    return unicodedata.normalize("NFKC", value.strip()).lower()


def digest_email(email: str, secret: str) -> str:
    return hmac.new(secret.encode(), normalize_email(email).encode(), hashlib.sha256).hexdigest()


def read_addresses(path: Path) -> list[str]:
    if not path.is_file():
        raise ValueError(f"File non trovato: {path}")
    rows: list[str] = []
    if path.suffix.casefold() == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as source:
            reader = csv.DictReader(source)
            if not reader.fieldnames or "email" not in {name.casefold() for name in reader.fieldnames}:
                raise ValueError("Il CSV deve avere una colonna 'email'")
            email_column = next(name for name in reader.fieldnames if name.casefold() == "email")
            rows = [row.get(email_column, "") for row in reader]
    else:
        rows = path.read_text(encoding="utf-8-sig").splitlines()
    normalized = sorted({normalize_email(value) for value in rows if value.strip()})
    invalid = [value for value in normalized if "@" not in value or value.startswith("@")]
    if invalid:
        raise ValueError(f"Indirizzi non validi: {len(invalid)}")
    if not normalized:
        raise ValueError("La lista autorizzati è vuota")
    return normalized


def sql_for(digests: list[str], replace: bool) -> str:
    timestamp = datetime.now(timezone.utc).isoformat()
    # A SQL file is submitted by Wrangler as one D1 batch. D1 manages the
    # transaction for that batch and rejects explicit transaction controls.
    statements: list[str] = []
    if replace:
        statements.append(
            "UPDATE authorized_members SET active=0, updated_at='{0}', revoked_at='{0}' "
            "WHERE active=1;".format(timestamp)
        )
    for digest in digests:
        member_id = f"m_{digest[:32]}"
        display_name = f"Corista {digest[:8]}"
        statements.append(
            "INSERT INTO authorized_members(email_digest,active,added_at,updated_at,revoked_at,member_id,choir_id,display_name) "
            f"VALUES('{digest}',1,'{timestamp}','{timestamp}',NULL,'{member_id}','choir_primary','{display_name}') "
            "ON CONFLICT(email_digest) DO UPDATE SET active=1, "
            f"updated_at='{timestamp}', revoked_at=NULL, "
            "member_id=COALESCE(authorized_members.member_id,excluded.member_id), "
            "choir_id=COALESCE(authorized_members.choir_id,excluded.choir_id), "
            "display_name=COALESCE(authorized_members.display_name,excluded.display_name);"
        )
    return "\n".join(statements) + "\n"


def validate_replace_confirmation(
    replace: bool,
    dry_run: bool,
    member_count: int,
    confirmed_count: int | None,
) -> None:
    if confirmed_count is not None and not replace:
        raise ValueError("--confirm-replace-count richiede --replace")
    if replace and not dry_run and confirmed_count != member_count:
        raise ValueError(
            "--replace richiede --confirm-replace-count uguale al numero di membri validati "
            f"({member_count})"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="CSV con colonna email, oppure file con una email per riga")
    parser.add_argument("--database", default="choir-assistant-auth-staging")
    parser.add_argument("--replace", action="store_true", help="revoca chi non compare nella lista fornita")
    parser.add_argument(
        "--confirm-replace-count",
        type=int,
        help="conferma obbligatoria: numero esatto di membri della lista completa",
    )
    parser.add_argument("--local", action="store_true", help="aggiorna il database Wrangler locale")
    parser.add_argument("--dry-run", action="store_true", help="calcola i digest senza modificare D1")
    args = parser.parse_args()

    secret = os.environ.get(SECRET_ENV, "")
    if len(secret) < 32:
        raise ValueError(f"Impostare {SECRET_ENV} con lo stesso segreto di almeno 32 caratteri usato dal Worker")
    addresses = read_addresses(args.source.resolve())
    validate_replace_confirmation(
        args.replace,
        args.dry_run,
        len(addresses),
        args.confirm_replace_count,
    )
    digests = [digest_email(email, secret) for email in addresses]
    if args.dry_run:
        print(f"Validati {len(digests)} membri; nessun dato inviato")
        return 0

    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=f"-{secrets.token_hex(6)}.sql", delete=False,
        ) as temporary:
            temporary.write(sql_for(digests, args.replace))
            temporary_path = Path(temporary.name)
        npx = shutil.which("npx")
        if not npx:
            raise ValueError("Node/npm non trovato; eseguire npm install")
        command = [
            npx, "wrangler", "d1", "execute", args.database,
            "--local" if args.local else "--remote", "--file", str(temporary_path),
        ]
        subprocess.run(command, cwd=ROOT, check=True)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()
    print(f"Sincronizzati {len(digests)} membri; replace={args.replace}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Sincronizzazione non eseguita: {error}")
        raise SystemExit(2) from None
