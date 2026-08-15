import json
import os
import tempfile
import hashlib
import shutil
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


storage_dir = Path(os.environ.get("STORAGE_DIR", "/data"))
storage_dir.mkdir(parents=True, exist_ok=True)
max_file_size = int(os.environ.get("MAX_FILE_SIZE", str(100 * 1024 * 1024)))
max_history_bytes = int(
    os.environ.get("MAX_HISTORY_BYTES", str(1024 * 1024 * 1024))
)
max_history_per_file = 50
history_dir = storage_dir / ".history"
write_lock = threading.Lock()


def revision(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def resolve_file(request_path: str) -> Path:
    name = unquote(request_path.removeprefix("/files/")).strip()
    if not name or name != Path(name).name or not name.endswith(".excalidraw"):
        raise ValueError("Invalid filename")
    return storage_dir / name


def resolve_history_request(request_path: str) -> tuple[Path, str | None]:
    relative_path = unquote(request_path.removeprefix("/files/")).strip()
    parts = relative_path.split("/")
    if len(parts) == 2 and parts[1] == "history":
        return resolve_file(f"/files/{parts[0]}"), None
    if len(parts) == 4 and parts[1] == "history" and parts[3] == "restore":
        history_revision = parts[2]
        if len(history_revision) != 64 or any(
            character not in "0123456789abcdef" for character in history_revision
        ):
            raise ValueError("Invalid history revision")
        return resolve_file(f"/files/{parts[0]}"), history_revision
    raise ValueError("Invalid history path")


def file_history_dir(path: Path) -> Path:
    return history_dir / path.name


def history_entries(path: Path) -> list[Path]:
    directory = file_history_dir(path)
    if not directory.is_dir():
        return []
    return sorted(
        (entry for entry in directory.glob("*.history") if entry.is_file()),
        key=lambda entry: entry.name,
        reverse=True,
    )


def history_timestamp(entry: Path) -> int:
    return int(entry.name.split("-", 1)[0])


def atomic_write(path: Path, body: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as temporary_file:
            temporary_file.write(body)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def archive_current(path: Path) -> None:
    body = path.read_bytes()
    archived_revision = revision(body)
    directory = file_history_dir(path)
    timestamp = time.time_ns()
    destination = directory / f"{timestamp:020d}-{archived_revision}.history"
    while destination.exists():
        timestamp += 1
        destination = directory / f"{timestamp:020d}-{archived_revision}.history"
    atomic_write(destination, body)


def remove_history_entry(entry: Path) -> None:
    try:
        entry.unlink()
    except FileNotFoundError:
        return
    try:
        entry.parent.rmdir()
    except OSError:
        pass


def prune_history() -> None:
    if not history_dir.is_dir():
        return

    for directory in history_dir.iterdir():
        if not directory.is_dir():
            continue
        entries = sorted(directory.glob("*.history"), key=lambda entry: entry.name)
        for entry in entries[:-max_history_per_file]:
            remove_history_entry(entry)

    entries = [
        entry
        for entry in history_dir.glob("*/*.history")
        if entry.is_file()
    ]
    total_bytes = sum(entry.stat().st_size for entry in entries)
    for entry in sorted(entries, key=lambda item: item.name):
        if total_bytes <= max_history_bytes:
            break
        try:
            size = entry.stat().st_size
        except FileNotFoundError:
            continue
        remove_history_entry(entry)
        total_bytes -= size


def history_response(path: Path) -> bytes:
    items = []
    for entry in history_entries(path):
        stat = entry.stat()
        timestamp = history_timestamp(entry)
        items.append(
            {
                "revision": entry.stem.split("-", 1)[1],
                "size": stat.st_size,
                "archivedAt": datetime.fromtimestamp(
                    timestamp / 1_000_000_000, timezone.utc
                ).isoformat(),
            }
        )
    return json.dumps(items).encode()


def find_history_revision(path: Path, history_revision: str) -> Path | None:
    for entry in history_entries(path):
        if entry.stem.split("-", 1)[1] == history_revision:
            return entry
    return None


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

        if parsed.path.endswith("/history"):
            try:
                path, _ = resolve_history_request(parsed.path)
            except ValueError as error:
                self.send_text(400, str(error))
                return
            with write_lock:
                if not path.is_file():
                    self.send_text(404, "File not found")
                    return
                body = history_response(path)
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
            if current_revision is not None:
                archive_current(path)
            atomic_write(path, body)
            prune_history()
        response = json.dumps({"revision": revision(body)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("ETag", f'"{revision(body)}"')
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            path, history_revision = resolve_history_request(parsed.path)
        except ValueError as error:
            self.send_text(400, str(error))
            return
        if history_revision is None:
            self.send_text(400, "Invalid history path")
            return
        expected_revision = self.headers.get("If-Match")
        if not expected_revision:
            self.send_text(428, "If-Match revision is required")
            return
        with write_lock:
            if not path.is_file():
                self.send_text(404, "File not found")
                return
            current_body = path.read_bytes()
            current_revision = revision(current_body)
            if expected_revision.strip('"') != current_revision:
                self.send_text(412, "File changed since it was opened")
                return
            entry = find_history_revision(path, history_revision)
            if entry is None:
                self.send_text(404, "History revision not found")
                return
            restored_body = entry.read_bytes()
            archive_current(path)
            atomic_write(path, restored_body)
            prune_history()
        restored_revision = revision(restored_body)
        response = json.dumps({"revision": restored_revision}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("ETag", f'"{restored_revision}"')
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
            shutil.rmtree(file_history_dir(path), ignore_errors=True)
        self.send_response(204)
        self.end_headers()

    def log_message(self, message: str, *args: object) -> None:
        print(f"{self.address_string()} - {message % args}")


prune_history()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
