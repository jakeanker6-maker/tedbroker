"""Dev server for the prototype: no caching, so CSS/JS edits show on reload.
Usage: python3 serve.py [port]   (default 8765)"""
import http.server, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.ThreadingHTTPServer(("", port), NoCache).serve_forever()
