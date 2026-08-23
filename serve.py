#!/usr/bin/env python3
"""Development server for the web version.

    python3 web/serve.py

Plain `python3 -m http.server` lets the browser cache app.js and style.css,
which during development means editing a file, reloading, and seeing the old
version — with no error to explain why. Phones are the worst for this: there
is no easy hard-reload on iOS Safari.

So this server tells the browser never to cache anything. It is for
development only; the deployed site should cache normally.

It also prints the LAN address, since the point of the web version is trying
it on a real phone.
"""

import http.server
import socket
import socketserver
from pathlib import Path

PORT = 8000
ROOT = Path(__file__).resolve().parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Serve only this folder, never the whole project: the repo sits one
        # level up and has no business being on the network.
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One tidy line per request instead of the default noise.
        print(f"  {self.address_string()}  {fmt % args}")


def lan_address() -> str:
    """This machine's address on the local network, for testing on a phone."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))  # no packets sent; just picks the route
        return sock.getsockname()[0]
    except OSError:
        return "unknown"
    finally:
        sock.close()


def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        print(f"Serving {ROOT}")
        print(f"  this Mac:   http://localhost:{PORT}")
        print(f"  your phone: http://{lan_address()}:{PORT}   (same Wi-Fi)")
        print("Caching is disabled — a normal reload always gets the latest.")
        print("Ctrl+C to stop.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
