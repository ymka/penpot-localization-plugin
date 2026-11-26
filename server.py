"""Small local development server with CORS enabled for Penpot."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parent
ASSETS = {"manifest.json", "plugin.js", "index.html", "ui.js"}


class PluginHandler(SimpleHTTPRequestHandler):
    # Never expose .git, local translation files, or directory listings.
    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        name = path.removeprefix("/")
        if name not in ASSETS or (ROOT / name).resolve() != ROOT / name:
            self.send_error(404, "Not found")
            return None
        return super().send_head()

    def translate_path(self, path):
        return str(ROOT / unquote(urlsplit(path).path).removeprefix("/"))

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    url = "http://localhost:4400/manifest.json"
    print(f"Penpot plugin manifest: {url}", flush=True)
    with ThreadingHTTPServer(("127.0.0.1", 4400), PluginHandler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
