import json
import os
import tempfile
import hashlib
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


storage_dir = Path(os.environ.get("STORAGE_DIR", "/data"))
storage_dir.mkdir(parents=True, exist_ok=True)
max_file_size = int(os.environ.get("MAX_FILE_SIZE", str(100 * 1024 * 1024)))
write_lock = threading.Lock()


def revision(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def resolve_file(request_path: str) -> Path:
    name = unquote(request_path.removeprefix("/files/")).strip()
    if not name or name != Path(name).name or not name.endswith(".excalidraw"):
        raise ValueError("Invalid filename")
    return storage_dir / name


class Handler(BaseHTTPRequestHandler):
    def send_text(self, status: int, message: str) -> None:
        body = message.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/files":
            files = []
            for path in storage_dir.glob("*.excalidraw"):
                stat = path.stat()
                body = path.read_bytes()
                files.append(
                    {
                        "name": path.name,
                        "size": stat.st_size,
                        "updatedAt": datetime.fromtimestamp(
                            stat.st_mtime, timezone.utc
                        ).isoformat(),
                        "revision": revision(body),
                    }
                )
            files.sort(key=lambda item: item["updatedAt"], reverse=True)
            body = json.dumps(files).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        try:
            path = resolve_file(parsed.path)
        except ValueError as error:
            self.send_text(400, str(error))
            return
        if not path.is_file():
            self.send_text(404, "File not found")
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.excalidraw+json")
        self.send_header("ETag", f'"{revision(body)}"')
        if parsed.query == "download=1":
            self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_PUT(self) -> None:
        try:
            path = resolve_file(urlparse(self.path).path)
        except ValueError as error:
            self.send_text(400, str(error))
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > max_file_size:
            self.send_text(413, "Invalid file size")
            return
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
            if data.get("type") != "excalidraw" or not isinstance(data.get("elements"), list):
                raise ValueError
        except (json.JSONDecodeError, ValueError, AttributeError):
            self.send_text(400, "Invalid Excalidraw file")
            return
        expected_revision = self.headers.get("If-Match")
        with write_lock:
            current_revision = revision(path.read_bytes()) if path.is_file() else None
            if expected_revision:
                expected_revision = expected_revision.strip('"')
                if expected_revision == "*":
                    if current_revision is not None:
                        self.send_text(412, "File already exists")
                        return
                elif current_revision != expected_revision:
                    self.send_text(412, "File changed since it was opened")
                    return

            descriptor, temporary_name = tempfile.mkstemp(dir=storage_dir)
            try:
                with os.fdopen(descriptor, "wb") as temporary_file:
                    temporary_file.write(body)
                    temporary_file.flush()
                    os.fsync(temporary_file.fileno())
                os.replace(temporary_name, path)
            finally:
                if os.path.exists(temporary_name):
                    os.unlink(temporary_name)
        response = json.dumps({"revision": revision(body)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("ETag", f'"{revision(body)}"')
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def do_DELETE(self) -> None:
        try:
            path = resolve_file(urlparse(self.path).path)
        except ValueError as error:
            self.send_text(400, str(error))
            return
        expected_revision = self.headers.get("If-Match")
        if not expected_revision:
            self.send_text(428, "If-Match revision is required")
            return
        with write_lock:
            if not path.is_file():
                self.send_text(404, "File not found")
                return
            current_revision = revision(path.read_bytes())
            if expected_revision.strip('"') != current_revision:
                self.send_text(412, "File changed since it was listed")
                return
            path.unlink()
        self.send_response(204)
        self.end_headers()

    def log_message(self, message: str, *args: object) -> None:
        print(f"{self.address_string()} - {message % args}")


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
