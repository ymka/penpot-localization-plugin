"""Exercise HTTP request handling without opening a network socket."""
import io
from pathlib import Path
import sys
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import PluginHandler


class Connection:
    def __init__(self, request):
        self.input = io.BytesIO(request)
        self.output = bytearray()

    def makefile(self, *args):
        return self.input

    def sendall(self, data):
        self.output.extend(data)


class QuietHandler(PluginHandler):
    def log_message(self, *args):
        pass


def request(path, method="GET"):
    connection = Connection(f"{method} {path} HTTP/1.0\r\n\r\n".encode())
    QuietHandler(connection, ("127.0.0.1", 1234), object())
    headers, body = bytes(connection.output).split(b"\r\n\r\n", 1)
    return headers, body


class ServerTests(unittest.TestCase):
    def test_runtime_assets_and_query_strings(self):
        plugin_directory = Path(__file__).resolve().parents[1] / "plugin"
        for asset in ("manifest.json", "plugin.js", "index.html", "ui.js"):
            with self.subTest(asset=asset):
                headers, body = request(f"/{asset}?v=123")
                self.assertIn(b"200 OK", headers)
                self.assertIn(b"Access-Control-Allow-Origin: *", headers)
                self.assertIn(b"Cache-Control: no-store", headers)
                self.assertEqual(body, (plugin_directory / asset).read_bytes())

    def test_private_paths_and_directory_listing_are_denied(self):
        for path in ("/", "/plugin/", "/plugin/manifest.json", "/.git/config",
                     "/.env", "/README.md", "/server.py", "/translations.local.json",
                     "/translations.json", "/translations.json?v=123", "/../manifest.json",
                     "/%2e%2e/manifest.json", "/%2egit/config"):
            with self.subTest(path=path):
                headers, _ = request(path)
                self.assertIn(b"404 Not found", headers)

    def test_symlinked_asset_is_denied(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / "private.json"
            private.write_text('secret')
            (root / "manifest.json").symlink_to(private)
            with patch("server.ROOT", root):
                headers, body = request("/manifest.json")
            self.assertIn(b"404 Not found", headers)
            self.assertNotIn(b"secret", body)

    def test_head_and_preflight(self):
        headers, body = request("/manifest.json", "HEAD")
        self.assertIn(b"200 OK", headers)
        self.assertEqual(body, b"")
        headers, body = request("/manifest.json", "OPTIONS")
        self.assertIn(b"204 No Content", headers)
        self.assertIn(b"Access-Control-Allow-Methods: GET, OPTIONS", headers)
        self.assertEqual(body, b"")


if __name__ == "__main__":
    unittest.main()
