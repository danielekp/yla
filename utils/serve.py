#!/usr/bin/env python3
"""
Static file server for Yla with a small proxy for the Ollama model library.

Serves the repository like `python3 -m http.server` and adds two JSON routes
used by the "Create model" form, because the browser cannot read ollama.com
directly (no CORS headers there):

    GET /api/library          -> {"models": [{name, description, sizes, capabilities, pulls, updated}]}
    GET /api/library/<model>  -> {"model": name, "tags": [{name, size, context, inputs, updated}]}

Both are scraped from https://ollama.com/library and cached for an hour.

Usage: python3 utils/serve.py [port] [--bind ADDRESS]
"""
import argparse
import html
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIBRARY_URL = os.environ.get("YLA_LIBRARY_URL", "https://ollama.com/library").rstrip("/")
CACHE_TTL = 3600
FETCH_TIMEOUT = 20
MODEL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
SIZE_BADGE_RE = re.compile(r"^\d+(?:\.\d+)?[bmk]$|^\d+x\d+(?:\.\d+)?b$", re.I)

_cache = {}
_cache_lock = threading.Lock()


def strip_tags(text):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text))).strip()


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "yla/2.0 (+https://github.com/danielekp/yla)"})
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:
        return response.read().decode("utf-8", "replace")


def parse_library(page):
    """Parses https://ollama.com/library into a list of models."""
    start = page.find('id="repo"')
    body = page[start:] if start >= 0 else page
    models = []
    for item in re.findall(r"<li\b[^>]*>(.*?)</li>", body, re.S):
        link = re.search(r'href="/library/([^"/?#]+)"', item)
        if not link:
            continue
        name = link.group(1)
        desc = re.search(r'<p class="max-w-lg[^"]*">(.*?)</p>', item, re.S)
        badges = [
            strip_tags(text)
            for text in re.findall(r'<span\s+class="inline-flex items-center rounded-md[^"]*">([^<]*)</span>', item)
        ]
        sizes = [b for b in badges if SIZE_BADGE_RE.match(b)]
        capabilities = [b for b in badges if b and not SIZE_BADGE_RE.match(b)]
        pulls = re.search(r"<span\s*>([^<]+)</span>\s*<span[^>]*>\s*(?:&nbsp;)?Pulls", item)
        updated = re.search(r"(?:Updated\s*)?(\b(?:\d+\s+\w+|yesterday|today)\s+ago|yesterday|today)\b", strip_tags(item))
        models.append(
            {
                "name": name,
                "description": strip_tags(desc.group(1)) if desc else "",
                "sizes": sizes,
                "capabilities": capabilities,
                "pulls": pulls.group(1).strip() if pulls else "",
                "updated": updated.group(1) if updated else "",
            }
        )
    return models


def parse_tags(page, model):
    """Parses https://ollama.com/library/<model>/tags into a list of tags."""
    tags = []
    seen = set()
    pattern = re.compile(r'<a href="/library/([^"]+)" class="md:hidden[^"]*">(.*?)</a>', re.S)
    for full_name, block in pattern.findall(page):
        if not full_name.startswith(model + ":") or full_name in seen:
            continue
        seen.add(full_name)
        text = strip_tags(block)
        parts = [p.strip() for p in text.split("•")]
        size = next((p for p in parts if re.match(r"^\d+(?:\.\d+)?\s*[KMGT]B$", p)), "")
        context = re.search(r"(\d+[KM]?)\s+context window", text)
        inputs = re.search(r"((?:[A-Z][a-z]+(?:,\s*)?)+)\s+input", text)
        updated = re.search(r"(\d+\s+\w+\s+ago|yesterday|today)", text)
        tags.append(
            {
                "name": full_name,
                "tag": full_name.split(":", 1)[1],
                "size": size,
                "context": context.group(1) if context else "",
                "inputs": inputs.group(1).strip() if inputs else "",
                "updated": updated.group(1) if updated else "",
                "cloud": "cloud" in full_name.split(":", 1)[1] or "Usage" in text,
            }
        )
    return tags


def cached(key, loader):
    now = time.time()
    with _cache_lock:
        entry = _cache.get(key)
        if entry and now - entry[0] < CACHE_TTL:
            return entry[1]
    value = loader()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


def library():
    return cached("library", lambda: {"models": parse_library(fetch(LIBRARY_URL)), "source": LIBRARY_URL})


def library_tags(model):
    def load():
        page = fetch(f"{LIBRARY_URL}/{model}/tags")
        return {"model": model, "tags": parse_tags(page, model), "source": f"{LIBRARY_URL}/{model}/tags"}

    return cached(f"tags:{model}", load)


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/library":
            return self.serve_json(library)
        if path.startswith("/api/library/"):
            model = path[len("/api/library/"):].rstrip("/")
            if not MODEL_NAME_RE.match(model):
                return self.send_json(400, {"error": "invalid model name"})
            return self.serve_json(lambda: library_tags(model))
        return super().do_GET()

    def serve_json(self, loader):
        try:
            self.send_json(200, loader())
        except urllib.error.HTTPError as error:
            self.send_json(502, {"error": f"ollama.com answered HTTP {error.code}"})
        except Exception as error:  # network down, timeout, parse failure
            self.send_json(502, {"error": f"Could not reach ollama.com: {error}"})

    def send_json(self, code, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        if os.environ.get("YLA_SERVE_QUIET"):
            return
        super().log_message(fmt, *args)


def main():
    parser = argparse.ArgumentParser(description="Serve Yla and proxy the Ollama model library.")
    parser.add_argument("port", nargs="?", type=int, default=8000)
    parser.add_argument("--bind", default="", help="address to bind (default: all interfaces)")
    args = parser.parse_args()
    handler = partial(Handler, directory=PROJECT_DIR)
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    port = server.server_address[1]
    print(f"Serving {PROJECT_DIR} on http://{args.bind or '0.0.0.0'}:{port}/src/yla.html", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
