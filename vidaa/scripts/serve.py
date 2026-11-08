#!/usr/bin/env python3
"""Serve the built SmartTube VIDAA app to a TV on the local network.

The TV loads the app as a normal web tile installed by Sidee. This helper is
only a static file server; it has no TV credentials and no write access.

Examples:
    python3 scripts/serve.py dist 8090
    python3 scripts/serve.py dist 8090 --bind 0.0.0.0
"""
from __future__ import annotations

import argparse
import functools
import http.server
import mimetypes
import os
import socket
import sys

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("image/svg+xml", ".svg")


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "SmartTubeVIDAA/0.1"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        if not self.server.quiet:
            super().log_message(fmt, *args)


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, quiet=False):
        self.quiet = quiet
        super().__init__(address, handler)


def lan_address() -> str:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            # No packet is sent; the kernel selects the LAN interface.
            sock.connect(("1.1.1.1", 80))
            return sock.getsockname()[0]
        finally:
            sock.close()
    except OSError:
        return "127.0.0.1"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("directory", nargs="?", default="dist", help="built app directory (default: dist)")
    parser.add_argument("port", nargs="?", type=int, default=8090, help="TCP port (default: 8090)")
    parser.add_argument("--bind", default="0.0.0.0", help="bind address (default: 0.0.0.0)")
    parser.add_argument("--quiet", action="store_true", help="do not log each request")
    args = parser.parse_args()

    directory = os.path.abspath(args.directory)
    index = os.path.join(directory, "index.html")
    if not os.path.isfile(index):
        print("Build the app first: npm install && npm run build", file=sys.stderr)
        return 2
    if not 0 < args.port < 65536:
        print("Port must be between 1 and 65535.", file=sys.stderr)
        return 2

    handler = functools.partial(Handler, directory=directory)
    try:
        server = Server((args.bind, args.port), handler, quiet=args.quiet)
    except OSError as error:
        print(f"Cannot listen on {args.bind}:{args.port}: {error}", file=sys.stderr)
        return 1

    address = lan_address()
    print("SmartTube for VIDAA is being served from " + directory)
    print(f"On this computer:  http://127.0.0.1:{args.port}/")
    print(f"On your TV:        http://{address}:{args.port}/")
    print("In Sidee, install SmartTube and enter the TV address above.")
    print("Keep this window open while the TV uses the app. Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
