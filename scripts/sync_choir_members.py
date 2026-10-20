"""Synchronize private choir identities, groups and scoped roles to D1."""

from __future__ import annotations

import argparse
import csv
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECRET_ENV = "CHOIR_AUTH_EMAIL_HMAC_KEY"
CHOIR_ID = "choir_primary"
VALID_ROLES = {"singer", "section_viewer", "director", "admin"}
VALID_VOICE_PARTS = {"soprano", "contralto", "tenore", "basso"}


@dataclass(frozen=True)
class MemberRecord:
    email: str
    display_name: str
    voice_part: str
    groups: tuple[str, ...]
    roles: tuple[str, ...]
    view_groups: tuple[str, ...]


def normalize_email(value: str) -> str:
    return unicodedata.normalize("NFKC", value.strip()).lower()


def email_digest(email: str, secret: str) -> str:
    return hmac.new(secret.encode(), normalize_email(email).encode(), hashlib.sha256).hexdigest()


def split_values(value: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(item.strip() for item in re.split(r"[;|]", value or "") if item.strip()))


def group_code(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    code = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    if not code or len(code) > 48:
        raise ValueError(f"Gruppo non valido: {value!r}")
    return code


def read_records(path: Path) -> list[MemberRecord]:
    if not path.is_file() or path.suffix.casefold() != ".csv":
        raise ValueError("Serve un CSV privato con almeno la colonna 'email'")
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        fields = {name.casefold(): name for name in reader.fieldnames or []}
        if "email" not in fields:
            raise ValueError("Il CSV deve avere una colonna 'email'")
        records: list[MemberRecord] = []
        seen: set[str] = set()
        for row in reader:
            email = normalize_email(row.get(fields["email"], ""))
            if not email:
                continue
            if "@" not in email or email.startswith("@") or email in seen:
                raise ValueError(f"Email non valida o duplicata: {email!r}")
            seen.add(email)
            raw_name = row.get(fields.get("display_name", ""), "").strip()
            display_name = raw_name or ""
            if len(display_name) > 80 or any(ord(char) < 32 for char in display_name):
                raise ValueError(f"display_name non valido per {email}")
            voice_part = row.get(fields.get("voice_part", ""), "").strip().casefold()
            if voice_part and voice_part not in VALID_VOICE_PARTS:
                raise ValueError(f"Parte vocale non valida per {email}: {voice_part!r}")
            groups = split_values(row.get(fields.get("groups", ""), ""))
            roles = tuple(role.casefold() for role in split_values(row.get(fields.get("roles", ""), ""))) or ("singer",)
            invalid = set(roles) - VALID_ROLES
            if invalid:
                raise ValueError(f"Ruoli non validi per {email}: {', '.join(sorted(invalid))}")
            view_groups = split_values(row.get(fields.get("view_groups", ""), ""))
            if view_groups and "section_viewer" not in roles and "director" not in roles:
                raise ValueError(f"{email}: view_groups richiede section_viewer o director")
            records.append(MemberRecord(email, display_name, voice_part, groups, roles, view_groups))
    if not records:
        raise ValueError("La lista membri è vuota")
    return records


def quoted(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sql_for(records: list[MemberRecord], secret: str, replace: bool) -> str:
    now = datetime.now(timezone.utc).isoformat()
    prepared = []
    group_names: dict[str, str] = {}
    for record in records:
        digest = email_digest(record.email, secret)
        member_id = "m_" + digest[:32]
        display_name = record.display_name or f"Corista {digest[:8]}"
        groups = tuple((group_code(name), name) for name in record.groups)
        view_groups = tuple((group_code(name), name) for name in record.view_groups)
        for code, name in groups + view_groups:
            group_names.setdefault(code, name)
        prepared.append((digest, member_id, display_name, record.voice_part, groups, record.roles, view_groups))

    # Wrangler sends all statements from one SQL file to D1 as a batch. D1
    # wraps that batch in its own transaction and rejects explicit BEGIN,
    # COMMIT and SAVEPOINT statements.
    statements: list[str] = []
    if replace:
        statements.append(
            f"UPDATE authorized_members SET active=0, updated_at={quoted(now)}, revoked_at={quoted(now)} "
            f"WHERE choir_id={quoted(CHOIR_ID)} AND active=1;"
        )
    for code, name in sorted(group_names.items()):
        group_id = "g_" + hashlib.sha256(f"{CHOIR_ID}:{code}".encode()).hexdigest()[:24]
        statements.append(
            "INSERT INTO choir_groups(id,choir_id,code,name,active,created_at,updated_at) VALUES("
            f"{quoted(group_id)},{quoted(CHOIR_ID)},{quoted(code)},{quoted(name)},1,{quoted(now)},{quoted(now)}) "
            "ON CONFLICT(choir_id,code) DO UPDATE SET name=excluded.name,active=1,updated_at=excluded.updated_at;"
        )
    for digest, member_id, display_name, voice_part, groups, roles, view_groups in prepared:
        statements.append(
            "INSERT INTO authorized_members(email_digest,active,added_at,updated_at,revoked_at,member_id,choir_id,display_name,voice_part) VALUES("
            f"{quoted(digest)},1,{quoted(now)},{quoted(now)},NULL,{quoted(member_id)},{quoted(CHOIR_ID)},{quoted(display_name)},{quoted(voice_part) if voice_part else 'NULL'}) "
            "ON CONFLICT(email_digest) DO UPDATE SET active=1,updated_at=excluded.updated_at,revoked_at=NULL,"
            "member_id=COALESCE(authorized_members.member_id,excluded.member_id),"
            "choir_id=excluded.choir_id,"
            "display_name=CASE WHEN authorized_members.profile_completed_at IS NULL "
            "THEN excluded.display_name ELSE authorized_members.display_name END,"
            "voice_part=excluded.voice_part;"
        )
        statements.extend([
            f"UPDATE member_roles SET active=0,revoked_at={quoted(now)} WHERE member_id={quoted(member_id)};",
            f"UPDATE group_memberships SET active=0,updated_at={quoted(now)} WHERE member_id={quoted(member_id)};",
            f"UPDATE performance_view_grants SET active=0,revoked_at={quoted(now)} WHERE viewer_member_id={quoted(member_id)};",
        ])
        for role in sorted(set(roles) | {"singer"}):
            statements.append(
                "INSERT INTO member_roles(member_id,role,active,granted_at,revoked_at) VALUES("
                f"{quoted(member_id)},{quoted(role)},1,{quoted(now)},NULL) ON CONFLICT(member_id,role) "
                "DO UPDATE SET active=1,granted_at=excluded.granted_at,revoked_at=NULL;"
            )
        for code, _ in groups:
            group_id = "g_" + hashlib.sha256(f"{CHOIR_ID}:{code}".encode()).hexdigest()[:24]
            statements.append(
                "INSERT INTO group_memberships(member_id,group_id,active,created_at,updated_at) VALUES("
                f"{quoted(member_id)},{quoted(group_id)},1,{quoted(now)},{quoted(now)}) ON CONFLICT(member_id,group_id) "
                "DO UPDATE SET active=1,updated_at=excluded.updated_at;"
            )
        for code, _ in view_groups:
            group_id = "g_" + hashlib.sha256(f"{CHOIR_ID}:{code}".encode()).hexdigest()[:24]
            statements.append(
                "INSERT INTO performance_view_grants(viewer_member_id,group_id,active,granted_at,revoked_at) VALUES("
                f"{quoted(member_id)},{quoted(group_id)},1,{quoted(now)},NULL) ON CONFLICT(viewer_member_id,group_id) "
                "DO UPDATE SET active=1,granted_at=excluded.granted_at,revoked_at=NULL;"
            )
        audit_details = json.dumps({
            "roles": sorted(set(roles) | {"singer"}),
            "voice_part": voice_part or None,
            "groups": sorted(code for code, _ in groups),
            "view_groups": sorted(code for code, _ in view_groups),
        }, ensure_ascii=True, separators=(",", ":"))
        statements.append(
            "INSERT INTO authorization_audit(id,choir_id,target_member_id,event,details_json,recorded_at) VALUES("
            f"{quoted('audit_' + secrets.token_hex(12))},{quoted(CHOIR_ID)},{quoted(member_id)},'member_sync',"
            f"{quoted(audit_details)},{quoted(now)});"
        )
    return "\n".join(statements) + "\n"


def validate_replace(replace: bool, dry_run: bool, count: int, confirmation: int | None) -> None:
    if confirmation is not None and not replace:
        raise ValueError("--confirm-replace-count richiede --replace")
    if replace and not dry_run and confirmation != count:
        raise ValueError(f"--replace richiede --confirm-replace-count {count}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="CSV privato: email,display_name,voice_part,groups,roles,view_groups")
    parser.add_argument("--database", default="choir-assistant-auth-staging")
    parser.add_argument("--replace", action="store_true", help="revoca anche i membri assenti")
    parser.add_argument("--confirm-replace-count", type=int)
    parser.add_argument("--local", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    secret = os.environ.get(SECRET_ENV, "")
    if len(secret) < 32:
        raise ValueError(f"Impostare {SECRET_ENV} con lo stesso segreto del Worker")
    records = read_records(args.source.resolve())
    validate_replace(args.replace, args.dry_run, len(records), args.confirm_replace_count)
    sql = sql_for(records, secret, args.replace)
    if args.dry_run:
        group_count = len({group_code(name) for record in records for name in record.groups + record.view_groups})
        print(f"Validati {len(records)} membri e {group_count} gruppi; nessun dato inviato")
        return 0
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=f"-{secrets.token_hex(6)}.sql", delete=False) as temporary:
            temporary.write(sql); temporary_path = Path(temporary.name)
        npx = shutil.which("npx")
        if not npx:
            raise ValueError("Node/npm non trovato; eseguire npm install")
        # The HMAC key is needed only to pseudonymize email addresses locally.
        # Never expose it to Wrangler or any other network-capable child process.
        child_environment = os.environ.copy()
        child_environment.pop(SECRET_ENV, None)
        subprocess.run([
            npx, "wrangler", "d1", "execute", args.database,
            "--local" if args.local else "--remote", "--file", str(temporary_path),
        ], cwd=ROOT, check=True, env=child_environment)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()
    print(f"Sincronizzati {len(records)} membri; replace={args.replace}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Sincronizzazione non eseguita: {error}")
        raise SystemExit(2) from None

