#!/usr/bin/env python3
"""Local preview server that mimics Vercel's clean-URL rewrites.

Plain `python3 -m http.server` 404s on /about and /client-wins because it only
serves literal file paths. Vercel rewrites those to *.html via vercel.json, so
without this the local preview doesn't match production.

Usage: python3 scripts/preview-server.py [port]
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1 + threading: browsers hold keep-alive sockets open, which would
    # stall every other request on a single-threaded server.
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # mirror vercel.json redirects: /foo.html -> /foo (and landing -> /)
    REDIRECTS = {
        '/landing.html': '/', '/landing': '/', '/index.html': '/',
        '/about.html': '/about', '/client-wins.html': '/client-wins',
        '/privacy.html': '/privacy', '/terms.html': '/terms',
        '/login.html': '/login', '/apply.html': '/apply',
        '/onboarding.html': '/onboarding',
    }

    def do_GET(self):
        base = self.path.split('?')[0]
        target = self.REDIRECTS.get(base)
        if target:
            qs = self.path[len(base):]
            self.send_response(308)
            self.send_header('Location', target + qs)
            # keep-alive needs an explicit length or the client waits for a body
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        return super().do_GET()

    def translate_path(self, path):
        local = super().translate_path(path)
        # Extensionless URL with no matching file/dir -> try the .html sibling
        if not os.path.exists(local) and not os.path.splitext(local)[1]:
            if os.path.isfile(local + '.html'):
                return local + '.html'
        # Bare / -> landing page (index.html only redirects)
        if os.path.isdir(local) and os.path.abspath(local) == ROOT:
            return os.path.join(ROOT, 'landing.html')
        return local

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


with Server(("", PORT), Handler) as httpd:
    print(f"Preview running: http://localhost:{PORT}  (clean URLs enabled)")
    httpd.serve_forever()
