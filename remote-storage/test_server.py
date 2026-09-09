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

    def history_revision(self, server, name, history_revision):
        return server.request(
            "GET", f"{self.file_path(name)}/history/{history_revision}"
        )

    def rename(self, server, name, new_name, expected_revision=None):
        body = json.dumps({"name": new_name}).encode()
        headers = {
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
        }
        if expected_revision is not None:
            headers["If-Match"] = f'"{expected_revision}"'
        return server.request("PATCH", self.file_path(name), body, headers)

    def test_renames_file_and_complete_history_without_changing_metadata(self):
        old_name = "original plan.excalidraw"
        new_name = "renamed plan.excalidraw"
        first = excalidraw_body("first")
        second = excalidraw_body("second")
        first_revision = revision(first)
        second_revision = revision(second)

        with ServerProcess(self.temporary_directory.name, 1024 * 1024) as server:
            self.assertEqual(self.put(server, old_name, first)[0], 200)
            self.assertEqual(
                self.put(server, old_name, second, first_revision)[0], 200
            )
            source_path = Path(self.temporary_directory.name) / old_name
            source_mtime = source_path.stat().st_mtime_ns

            status, headers, response = self.rename(
                server, old_name, new_name, second_revision
            )
            self.assertEqual(status, 200)
            self.assertEqual(headers["ETag"], f'"{second_revision}"')
            self.assertEqual(
                json.loads(response),
                {
                    "name": new_name,
                    "size": len(second),
                    "updatedAt": json.loads(response)["updatedAt"],
                    "revision": second_revision,
                },
            )
            self.assertEqual(server.request("GET", self.file_path(old_name))[0], 404)
            status, read_headers, current = server.request(
                "GET", self.file_path(new_name)
            )
            self.assertEqual((status, current), (200, second))
            self.assertEqual(read_headers["ETag"], f'"{second_revision}"')
            self.assertEqual(
                (Path(self.temporary_directory.name) / new_name).stat().st_mtime_ns,
                source_mtime,
            )
            status, items = self.history(server, new_name)
            self.assertEqual(status, 200)
            self.assertEqual([item["revision"] for item in items], [first_revision])
            self.assertEqual(
                self.history_revision(server, new_name, first_revision)[2], first
            )
            self.assertEqual(self.history(server, old_name)[0], 404)

    def test_rename_failures_leave_file_and_history_untouched(self):
        source_name = "source file.excalidraw"
        target_name = "target file.excalidraw"
        first = excalidraw_body("first")
        current = excalidraw_body("current")
        target = excalidraw_body("target")
        current_revision = revision(current)

        with ServerProcess(self.temporary_directory.name, 1024 * 1024) as server:
            self.assertEqual(self.put(server, source_name, first)[0], 200)
            self.assertEqual(
                self.put(server, source_name, current, revision(first))[0], 200
            )
            self.assertEqual(self.put(server, target_name, target)[0], 200)

            cases = (
                (source_name, "unused name.excalidraw", None, 428),
                (source_name, "unused name.excalidraw", "0" * 64, 412),
                (source_name, target_name, current_revision, 409),
                (source_name, "../invalid.excalidraw", current_revision, 400),
                (source_name, source_name, current_revision, 400),
                ("missing file.excalidraw", "unused name.excalidraw", current_revision, 404),
            )
            for old_name, new_name, expected_revision, expected_status in cases:
                with self.subTest(status=expected_status, new_name=new_name):
                    self.assertEqual(
                        self.rename(server, old_name, new_name, expected_revision)[0],
                        expected_status,
                    )
                    self.assertEqual(
                        server.request("GET", self.file_path(source_name))[2], current
                    )
                    self.assertEqual(
                        [item["revision"] for item in self.history(server, source_name)[1]],
                        [revision(first)],
                    )

    def test_reads_history_revision_and_rejects_invalid_or_missing_revisions(self):
        name = "preview.excalidraw"
        first = excalidraw_body("first")
        second = excalidraw_body("second")
        first_revision = revision(first)

        with ServerProcess(self.temporary_directory.name, 1024 * 1024) as server:
            status, _, _ = self.put(server, name, first)
            self.assertEqual(status, 200)
            status, _, _ = self.put(server, name, second, first_revision)
            self.assertEqual(status, 200)

            status, headers, body = self.history_revision(
                server, name, first_revision
            )
            self.assertEqual(status, 200)
            self.assertEqual(body, first)
            self.assertEqual(
                headers["Content-Type"], "application/vnd.excalidraw+json"
            )
            self.assertEqual(headers["ETag"], f'"{first_revision}"')

            for invalid_revision in (
                "short",
                first_revision.upper(),
                "g" * 64,
            ):
                status, _, _ = self.history_revision(
                    server, name, invalid_revision
                )
                self.assertEqual(status, 400)

            status, _, _ = self.history_revision(server, name, "0" * 64)
            self.assertEqual(status, 404)
            status, _, _ = self.history_revision(
                server, "missing.excalidraw", first_revision
            )
            self.assertEqual(status, 404)

    def test_create_conflict_returns_revision_for_confirmed_overwrite(self):
        name = "overwrite.excalidraw"
        first = excalidraw_body("first")
        second = excalidraw_body("second")
        first_revision = revision(first)

        with ServerProcess(self.temporary_directory.name, 1024 * 1024) as server:
            status, _, _ = self.put(server, name, first)
            self.assertEqual(status, 200)

            status, headers, body = self.put(server, name, second)
            self.assertEqual(status, 412)
            self.assertEqual(body, b"File already exists")
            self.assertEqual(headers["ETag"], f'"{first_revision}"')

            status, _, _ = self.put(server, name, second, first_revision)
            self.assertEqual(status, 200)
            status, items = self.history(server, name)
            self.assertEqual(status, 200)
            self.assertEqual([item["revision"] for item in items], [first_revision])

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
