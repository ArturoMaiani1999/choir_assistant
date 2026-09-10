"""Serve the frontend with HTTP byte ranges required by HTML media seeking."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import shutil
import tempfile
import threading
import re
import sys
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.choir_assistant.ingestion.codex_musescore import run_codex_draft
from backend.choir_assistant.ingestion.job_store import JobStore, sha256_file
from backend.choir_assistant.ingestion.service import submit_ingestion

DATA_ROOT = ROOT / "data"


class RangeRequestHandler(SimpleHTTPRequestHandler):
    _range: tuple[int, int] | None = None

    def end_headers(self):
        if self.path.split("?", 1)[0].endswith((".html", ".js", ".json")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/ingestions/"):
            parts = self.path.split("?", 1)[0].strip("/").split("/")
            try:
                job_id = parts[2]
                store = JobStore(DATA_ROOT)
                manifest = store.get(job_id)
                if len(parts) == 4 and parts[3] == "draft":
                    draft = store.job_dir(job_id) / "output" / "draft.mscz"
                    if manifest["status"] != "pending_admin_review" or not draft.is_file():
                        raise FileNotFoundError("draft")
                    return self._send_file(draft, f"{manifest['piece_id']}-bozza.mscz")
                return self._send_json(manifest)
            except (FileNotFoundError, ValueError, IndexError):
                self.send_error(HTTPStatus.NOT_FOUND, "Ingestion not found")
                return
        if self.path == "/api/musescore-source":
            source = Path(__file__).resolve().parents[1] / "data/omr-ecco/ecco-mvp.mscz"
            if not source.exists():
                self.send_error(HTTPStatus.NOT_FOUND, "MuseScore source unavailable")
                return
            payload = source.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", 'attachment; filename="ecco-mvp.mscz"')
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        return super().do_GET()

    def _send_json(self, payload, status=HTTPStatus.OK):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _send_file(self, path, filename):
        payload = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            source = open(path, "rb")
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None
        size = os.fstat(source.fileno()).st_size
        start, end = 0, max(0, size - 1)
        range_header = self.headers.get("Range")
        if range_header and range_header.startswith("bytes="):
            requested = range_header.removeprefix("bytes=").split(",", 1)[0]
            first, _, last = requested.partition("-")
            try:
                if first:
                    start = int(first)
                    end = min(int(last) if last else end, end)
                elif last:
                    start = max(0, size - int(last))
            except ValueError:
                source.close()
                self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                return None
            if start > end or start >= size:
                source.close()
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return None
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self._range = (start, end)
        else:
            self.send_response(HTTPStatus.OK)
            self._range = None
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(os.fstat(source.fileno()).st_mtime))
        self.end_headers()
        source.seek(start)
        return source

    def copyfile(self, source, outputfile):
        if self._range is None:
            return super().copyfile(source, outputfile)
        remaining = self._range[1] - self._range[0] + 1
        while remaining:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    def do_POST(self):
        if self.path == "/api/ingestions":
            return self._create_ingestion()
        if self.path.startswith("/api/ingestions/") and self.path.endswith("/revision"):
            return self._upload_revision()
        if self.path != "/api/import-musescore":
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown API route")
            return
        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0 or content_length > 25 * 1024 * 1024:
            self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Upload limit is 25 MB")
            return
        message = BytesParser(policy=default).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + self.rfile.read(content_length)
        )
        upload = next((part for part in message.walk() if part.get_param("name", header="content-disposition") == "file"), None)
        filename = upload.get_filename( ) if upload else ""
        if upload is None or not filename.lower().endswith(".mscz"):
            self.send_error(HTTPStatus.BAD_REQUEST, "Upload an .mscz file")
            return
        root = Path(__file__).resolve().parents[1]
        with tempfile.NamedTemporaryFile(suffix=".mscz", delete=False) as handle:
            temp_path = Path(handle.name)
            handle.write(upload.get_payload(decode=True) or b"")
        try:
            result = subprocess.run(["python", str(root / "scripts/import_musescore_revision.py"), str(temp_path)],
                                    cwd=root, capture_output=True, text=True, timeout=180, check=False)
            payload = {"ok": result.returncode == 0, "output": result.stdout[-4000:], "error": result.stderr[-4000:]}
            self.send_response(HTTPStatus.OK if payload["ok"] else HTTPStatus.UNPROCESSABLE_ENTITY)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            encoded = json.dumps(payload).encode("utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
        finally:
            temp_path.unlink(missing_ok=True)

    def _multipart(self, limit=25 * 1024 * 1024):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > limit:
            raise ValueError("Upload vuoto o superiore a 25 MB")
        content_type = self.headers.get("Content-Type", "")
        return BytesParser(policy=default).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + self.rfile.read(length)
        )

    def _create_ingestion(self):
        try:
            message = self._multipart()
            upload = next((p for p in message.walk() if p.get_param("name", header="content-disposition") == "file"), None)
            piece = next((p for p in message.walk() if p.get_param("name", header="content-disposition") == "piece_id"), None)
            filename = upload.get_filename() if upload else ""
            piece_id = (piece.get_content().strip() if piece else "")
            if not upload or not filename.lower().endswith(".pdf") or not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,63}", piece_id):
                raise ValueError("Servono un PDF e un ID brano in minuscolo (lettere, numeri e trattini)")
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
                temp_path = Path(handle.name)
                handle.write(upload.get_payload(decode=True) or b"")
            try:
                manifest = submit_ingestion(temp_path, piece_id, DATA_ROOT)
                job_dir = JobStore(DATA_ROOT).job_dir(manifest["job_id"])
                stored = job_dir / "input" / Path(filename).name
                current = Path(manifest["source"]["stored_path"])
                if stored != current:
                    current.rename(stored)
                    manifest["source"].update(filename=Path(filename).name, stored_path=str(stored), sha256=sha256_file(stored))
                    manifest["artifacts"][0].update(path=str(stored), sha256=manifest["source"]["sha256"])
                    JobStore(DATA_ROOT).write_manifest(job_dir, manifest)
            finally:
                temp_path.unlink(missing_ok=True)
            JobStore(DATA_ROOT).update(manifest["job_id"], status="queued_for_codex", next_action="wait_for_codex")
            threading.Thread(target=run_codex_draft, args=(manifest["job_id"], DATA_ROOT), daemon=True).start()
            self._send_json({"ok": True, "job_id": manifest["job_id"], "status": "queued_for_codex"}, HTTPStatus.ACCEPTED)
        except (ValueError, OSError) as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def _upload_revision(self):
        try:
            job_id = self.path.strip("/").split("/")[2]
            store = JobStore(DATA_ROOT)
            job_dir = store.job_dir(job_id)
            message = self._multipart()
            upload = next((p for p in message.walk() if p.get_param("name", header="content-disposition") == "file"), None)
            if not upload or not (upload.get_filename() or "").lower().endswith(".mscz"):
                raise ValueError("Carica un file .mscz")
            destination = job_dir / "output" / "admin-revision.mscz"
            destination.parent.mkdir(exist_ok=True)
            destination.write_bytes(upload.get_payload(decode=True) or b"")
            if not destination.stat().st_size:
                raise ValueError("Il file è vuoto")
            manifest = store.get(job_id)
            manifest["artifacts"] = [a for a in manifest["artifacts"] if a["kind"] != "admin_revision_mscz"]
            manifest["artifacts"].append({"kind": "admin_revision_mscz", "path": str(destination), "sha256": sha256_file(destination)})
            manifest.update(status="admin_revision_uploaded", next_action="validate_and_publish")
            store.write_manifest(job_dir, manifest)
            store.append_event(job_dir, {"event": "admin_revision_uploaded", "status": manifest["status"]})
            self._send_json({"ok": True, "job_id": job_id, "status": manifest["status"]})
        except (ValueError, OSError, IndexError) as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5173)
    args = parser.parse_args()
    frontend = Path(__file__).resolve().parents[1] / "frontend"
    handler = lambda *handler_args, **kwargs: RangeRequestHandler(*handler_args, directory=str(frontend), **kwargs)
    print(f"Practice frontend: http://{args.host}:{args.port}")
    ThreadingHTTPServer((args.host, args.port), handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
