#!/usr/bin/env python3
"""
Scene Builder — LOCAL-ONLY level editor for the platformer game.

This is a small self-contained web server (Python standard library only, no
pip installs) that hosts the visual scene editor in your browser. It is
deliberately separate from server.js and binds to 127.0.0.1 (localhost) ONLY,
so it can never be reached from the internet — the asset-listing and
scene-writing endpoints stay on your machine.

What it does:
  • serves the editor UI (tools/editor.html) at  http://127.0.0.1:8000/
  • GET  /api/assets   -> lists every image under public/assets/ (drag them in)
  • POST /api/scene    -> saves the level you build to public/scene.json
  • serves everything under public/ statically, so the editor's asset
    thumbnails, and the "Test" button (which opens /viewer.html), work.

Usage:
    python scene_editor.py            # opens on http://127.0.0.1:8000
    python scene_editor.py 9000       # choose a different port

Then edit your level, hit Save, and the game (viewer.html / overlay.html) and
server.js will all pick up the new public/scene.json. If server.js is already
running, restart it so it re-reads the coin spawn points.
"""

import json
import mimetypes
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---- Paths (resolved relative to this script, so it works from any cwd) -----
ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(ROOT, "public")
ASSETS_DIR = os.path.join(PUBLIC_DIR, "assets")
# The editor only offers art from public/assets/edit_assets — a curated, tidy
# folder you fill with the pieces you actually want to build scenes from. If it
# doesn't exist yet we fall back to scanning all of public/assets.
EDIT_ASSETS_DIR = os.path.join(ASSETS_DIR, "edit_assets")
EDITOR_HTML = os.path.join(ROOT, "tools", "editor.html")
SCENE_PATH = os.path.join(PUBLIC_DIR, "scene.json")

HOST = "127.0.0.1"  # localhost only — NOT 0.0.0.0. This is what keeps it local.
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
MAX_BODY = 4 * 1024 * 1024  # 4 MB cap on a scene save


def list_assets():
    """Editor art as web paths like /assets/edit_assets/Trees/tree_1.png.

    Scans public/assets/edit_assets so the browser only offers the curated set.
    Falls back to all of public/assets if edit_assets hasn't been created yet.
    """
    scan_dir = EDIT_ASSETS_DIR if os.path.isdir(EDIT_ASSETS_DIR) else ASSETS_DIR
    out = []
    for dirpath, _dirs, files in os.walk(scan_dir):
        for name in files:
            if os.path.splitext(name)[1].lower() in IMAGE_EXTS:
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, PUBLIC_DIR).replace(os.sep, "/")
                out.append("/" + rel)
    out.sort()
    return out


def safe_public_path(url_path):
    """Map a URL path to a file under public/, blocking path traversal.

    Returns an absolute path inside PUBLIC_DIR, or None if the request tries to
    escape it (e.g. /../server.js).
    """
    rel = url_path.lstrip("/")
    full = os.path.normpath(os.path.join(PUBLIC_DIR, rel))
    if full == PUBLIC_DIR or full.startswith(PUBLIC_DIR + os.sep):
        return full
    return None


def validate_scene(scene):
    """Light validation mirroring the old server-side checks. Returns an error
    string, or None if the scene looks OK to write."""
    if not isinstance(scene, dict):
        return "Body must be a scene object."
    world = scene.get("world")
    if not isinstance(world, dict):
        return "scene.world is required."
    try:
        float(world["width"]); float(world["height"])
    except (KeyError, TypeError, ValueError):
        return "scene.world must have numeric width and height."
    for key in ("props", "hitboxes", "coins"):
        if key in scene and not isinstance(scene[key], list):
            return f"scene.{key} must be an array."
    return None


class Handler(BaseHTTPRequestHandler):
    # Quieter, single-line logging.
    def log_message(self, fmt, *args):
        sys.stderr.write("  %s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, content_type=None):
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError:
            self.send_error(404, "Not found")
            return
        if content_type is None:
            content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        # scene.json / assets change while you edit — don't let the browser cache.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        # The editor UI itself (lives in tools/, outside public/, so it's never
        # served by the online Node server).
        if path in ("/", "/editor", "/editor.html"):
            self._send_file(EDITOR_HTML, "text/html; charset=utf-8")
            return

        if path == "/api/assets":
            self._send_json({"assets": list_assets()})
            return

        # Everything else: static files from public/ (viewer.html, overlay.html,
        # scene.json, assets/*, ...).
        full = safe_public_path(path)
        if full and os.path.isfile(full):
            self._send_file(full)
            return
        self.send_error(404, "Not found")

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/scene":
            self.send_error(404, "Not found")
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._send_json({"error": "Bad or too-large body."}, 400)
            return
        try:
            scene = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send_json({"error": "Body must be valid JSON."}, 400)
            return

        err = validate_scene(scene)
        if err:
            self._send_json({"error": err}, 400)
            return

        try:
            with open(SCENE_PATH, "w", encoding="utf-8") as f:
                json.dump(scene, f, indent=2)
        except OSError as e:
            self._send_json({"error": f"Could not write scene.json: {e}"}, 500)
            return

        coins = len(scene.get("coins", []))
        print(f"[scene] saved scene.json — {coins} coin spawn points")
        self._send_json({"ok": True, "coins": coins})


def main():
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"Ignoring invalid port '{sys.argv[1]}', using {port}.")

    # Fail early with a clear message if the project layout isn't found.
    if not os.path.isfile(EDITOR_HTML):
        sys.exit(f"Could not find {EDITOR_HTML}. Run this from the project root.")
    if not os.path.isdir(PUBLIC_DIR):
        sys.exit(f"Could not find {PUBLIC_DIR}. Run this from the project root.")

    httpd = ThreadingHTTPServer((HOST, port), Handler)
    url = f"http://{HOST}:{port}/"
    print("=" * 60)
    print("  Scene Builder (local only)")
    print(f"  Editor:  {url}")
    print(f"  Assets:  {ASSETS_DIR}")
    print(f"  Scene:   {SCENE_PATH}")
    print("  Bound to localhost — not reachable from the internet.")
    print("  Press Ctrl+C to stop.")
    print("=" * 60)

    # Pop the editor open in the default browser once the server is listening.
    # Set SCENE_EDITOR_NO_BROWSER=1 to skip this (e.g. headless / scripted use).
    if not os.environ.get("SCENE_EDITOR_NO_BROWSER"):
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
