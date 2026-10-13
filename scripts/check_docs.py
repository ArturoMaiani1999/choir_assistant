"""Validate the canonical documentation structure and relative Markdown links."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
CANONICAL_DIRS = {"architecture", "product", "operations", "decisions"}
LINK_RE = re.compile(r"\[[^]]*]\(([^)]+)\)")
REQUIRED_METADATA = ("**Status:**", "**Owner:**", "**Last reviewed:**")


def main() -> int:
    errors: list[str] = []
    root_markdown = sorted(path.name for path in ROOT.glob("*.md") if path.name != "README.md")
    if root_markdown:
        errors.append(f"Markdown non ammessi nella root: {', '.join(root_markdown)}")

    for path in sorted(DOCS.rglob("*.md")):
        relative = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding="utf-8")
        under_archive = "archive" in path.relative_to(DOCS).parts
        top_level = path.relative_to(DOCS).parts[0]
        requires_metadata = path == DOCS / "README.md" or top_level in CANONICAL_DIRS
        if requires_metadata and not under_archive:
            for marker in REQUIRED_METADATA:
                if marker not in text:
                    errors.append(f"{relative}: metadato mancante {marker}")
        if under_archive:
            continue
        for target in LINK_RE.findall(text):
            clean = target.split("#", 1)[0].strip()
            if not clean or clean.startswith(("http://", "https://", "mailto:")):
                continue
            resolved = (path.parent / clean).resolve()
            if ROOT != resolved and ROOT not in resolved.parents:
                errors.append(f"{relative}: link fuori repository: {target}")
            elif not resolved.exists():
                errors.append(f"{relative}: link inesistente: {target}")

    if errors:
        print("Documentazione non valida:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Documentazione valida: struttura, metadati e link canonici verificati")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
