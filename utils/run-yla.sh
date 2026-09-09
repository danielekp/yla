#!/bin/bash

# Launches Ollama, a static file server and the Yla UI, then cleans up when
# the browser window is closed.  Works from any directory (the desktop entry
# starts it without a working directory), and does not depend on where the
# repository was cloned.

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${YLA_PORT:-8000}"

# OLLAMA_HOST may be "host", "host:port" or a full URL (Ollama accepts all three).
OLLAMA_URL="${OLLAMA_HOST:-http://localhost:11434}"
case "$OLLAMA_URL" in
    http://*|https://*) ;;
    *) OLLAMA_URL="http://$OLLAMA_URL" ;;
esac
if ! printf '%s' "$OLLAMA_URL" | grep -Eq '^https?://[^/]+:[0-9]+'; then
    OLLAMA_URL="${OLLAMA_URL%/}:11434"
fi
OLLAMA_URL="${OLLAMA_URL%/}"

ollama_up() {
    command -v curl >/dev/null 2>&1 || return 1
    curl -s --max-time "${1:-2}" "$OLLAMA_URL/api/version" >/dev/null 2>&1
}

cd "$PROJECT_DIR" || { echo "Cannot find project directory: $PROJECT_DIR"; exit 1; }

cleanup() {
    [ -n "$PYTHON_SERVER_PID" ] && kill "$PYTHON_SERVER_PID" 2>/dev/null
    [ -n "$OLLAMA_PID" ] && kill "$OLLAMA_PID" 2>/dev/null
    echo "Ollama server and Python server stopped."
}
trap cleanup EXIT

# Start Ollama only if it is not already running (it is often a system service).
if ollama_up 2; then
    echo "Ollama already running at $OLLAMA_URL"
else
    ollama serve &
    OLLAMA_PID=$!
    # Give the server a moment to come up (falls back to a fixed wait without curl).
    if command -v curl >/dev/null 2>&1; then
        for _ in $(seq 1 20); do
            ollama_up 1 && break
            sleep 0.5
        done
    else
        sleep 3
    fi
fi

# Serve the project files (the UI is a static page) and proxy the Ollama
# model library for the "Create model" form (see utils/serve.py).
python3 "$PROJECT_DIR/utils/serve.py" "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
PYTHON_SERVER_PID=$!
sleep 1

# Open the UI and wait for the window to close.
# Change this to your default browser if you do not use Chromium.
# Note: --incognito discards saved conversations, theme and model choice when
# the window is closed. Remove the flag (or use --user-data-dir=<dir>) to keep them.
chromium --incognito --app="http://localhost:$PORT/src/yla.html"
