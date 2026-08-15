import hashlib
import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import quote


SERVER_PATH = Path(__file__).with_name("server.py")


def excalidraw_body(label: str) -> bytes:
    return json.dumps(
        {"type": "excalidraw", "elements": [], "label": label},
        separators=(",", ":"),
    ).encode()


def revision(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


class ServerProcess:
    def __init__(self, storage_dir: str, max_history_bytes: int) -> None:
        self.storage_dir = storage_dir
        self.max_history_bytes = max_history_bytes
        self.process = None
        self.port = None

    def __enter__(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]
        environment = os.environ.copy()
        environment.update(
            {
                "STORAGE_DIR": self.storage_dir,
                "MAX_FILE_SIZE": str(1024 * 1024),
                "MAX_HISTORY_BYTES": str(self.max_history_bytes),
                "PORT": str(self.port),
            }
        )
        self.process = subprocess.Popen(
            [sys.executable, "-u", str(SERVER_PATH)],
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                output = self.process.stdout.read()
                raise RuntimeError(f"Server exited during startup:\n{output}")
            try:
                status, _, _ = self.request("GET", "/files")
                if status == 200:
                    return self
            except OSError:
                time.sleep(0.02)
        self.stop()
        raise RuntimeError("Server did not start within five seconds")

    def __exit__(self, exception_type, exception, traceback):
        self.stop()

    def stop(self):
        if self.process is None:
            return
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.process.stdout.close()
        self.process = None

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()


class RemoteStorageHistoryTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def file_path(self, name):
        return f"/files/{quote(name)}"

    def put(self, server, name, body, expected_revision="*"):
        headers = {
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
            "If-Match": f'"{expected_revision}"',
        }
        return server.request("PUT", self.file_path(name), body, headers)

    def history(self, server, name):
        status, _, body = server.request(
            "GET", f"{self.file_path(name)}/history"
        )
        return status, json.loads(body) if status == 200 else body

    def test_archives_lists_restores_persists_and_cascades_delete(self):
        name = "persistent.excalidraw"
        first = excalidraw_body("first")
        second = excalidraw_body("second")
        first_revision = revision(first)
        second_revision = revision(second)

        with ServerProcess(self.temporary_directory.name, 1024 * 1024) as server:
            status, _, _ = self.put(server, name, first)
            self.assertEqual(status, 200)
            status, _, _ = self.put(server, name, second, first_revision)
            self.assertEqual(status, 200)

            status, items = self.history(server, name)
            self.assertEqual(status, 200)
            self.assertEqual([item["revision"] for item in items], [first_revision])
            self.assertEqual(items[0]["size"], len(first))
            self.assertTrue(items[0]["archivedAt"].endswith("+00:00"))

            restore_path = (
                f"{self.file_path(name)}/history/{first_revision}/restore"
            )
            status, _, _ = server.request("POST", restore_path)
            self.assertEqual(status, 428)
            status, _, _ = server.request(
                "POST", restore_path, headers={"If-Match": f'"{first_revision}"'}
            )
            self.assertEqual(status, 412)
            status, _, current = server.request("GET", self.file_path(name))
            self.assertEqual((status, current), (200, second))
            status, headers, response = server.request(
                "POST", restore_path, headers={"If-Match": f'"{second_revision}"'}
            )
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(response), {"revision": first_revision})
            self.assertEqual(headers["ETag"], f'"{first_revision}"')
            status, _, current = server.request("GET", self.file_path(name))
            self.assertEqual((status, current), (200, first))

        with ServerProcess(self.temporary_directory.name, 1024 * 1024) as server:
            status, items = self.history(server, name)
            self.assertEqual(status, 200)
            self.assertEqual(
                [item["revision"] for item in items],
                [second_revision, first_revision],
            )
            status, _, current = server.request("GET", self.file_path(name))
            self.assertEqual((status, current), (200, first))
            status, _, _ = server.request(
                "DELETE",
                self.file_path(name),
                headers={"If-Match": f'"{first_revision}"'},
            )
            self.assertEqual(status, 204)
            status, _ = self.history(server, name)
            self.assertEqual(status, 404)
            self.assertFalse(
                (Path(self.temporary_directory.name) / ".history" / name).exists()
            )

    def test_retains_only_fifty_revisions_per_file(self):
        name = "bounded.excalidraw"
        bodies = [excalidraw_body(str(index)) for index in range(52)]
        with ServerProcess(self.temporary_directory.name, 1024 * 1024) as server:
            status, _, _ = self.put(server, name, bodies[0])
            self.assertEqual(status, 200)
            for previous, body in zip(bodies, bodies[1:]):
                status, _, _ = self.put(server, name, body, revision(previous))
                self.assertEqual(status, 200)

            status, items = self.history(server, name)
            self.assertEqual(status, 200)
            self.assertEqual(len(items), 50)
            self.assertEqual(items[0]["revision"], revision(bodies[-2]))
            self.assertEqual(items[-1]["revision"], revision(bodies[1]))

    def test_prunes_oldest_history_to_global_byte_limit(self):
        first_name = "first.excalidraw"
        second_name = "second.excalidraw"
        first_old = excalidraw_body("first-old")
        first_new = excalidraw_body("first-new")
        second_old = excalidraw_body("second-old")
        second_new = excalidraw_body("second-new")
        limit = len(second_old)

        with ServerProcess(self.temporary_directory.name, limit) as server:
            status, _, _ = self.put(server, first_name, first_old)
            self.assertEqual(status, 200)
            status, _, _ = self.put(
                server, first_name, first_new, revision(first_old)
            )
            self.assertEqual(status, 200)
            status, _, _ = self.put(server, second_name, second_old)
            self.assertEqual(status, 200)
            status, _, _ = self.put(
                server, second_name, second_new, revision(second_old)
            )
            self.assertEqual(status, 200)

            status, first_history = self.history(server, first_name)
            self.assertEqual((status, first_history), (200, []))
            status, second_history = self.history(server, second_name)
            self.assertEqual(status, 200)
            self.assertEqual(
                [item["revision"] for item in second_history],
                [revision(second_old)],
            )
            history_files = list(
                (Path(self.temporary_directory.name) / ".history").glob(
                    "*/*.history"
                )
            )
            self.assertLessEqual(
                sum(path.stat().st_size for path in history_files), limit
            )


if __name__ == "__main__":
    unittest.main()
