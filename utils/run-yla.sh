#!/bin/bash

# Define the directory where your HTML file is located
PROJECT_DIR="/home/Documents/yla/"

# Start Ollama server in the background
ollama serve &
OLLAMA_PID=$!

# Change to the directory containing the HTML file
cd "$PROJECT_DIR" || exit

# Start a simple Python server (serving files from HTML_DIR)
PORT=8000
python3 -m http.server $PORT &
PYTHON_SERVER_PID=$!

# Wait a bit to ensure servers are running
sleep 2

# Open Chromium and wait for it to close
# Change this to your default browser
chromium --app="http://localhost:$PORT/src/yla.html" 

# Cleanup: Stop the servers when Chromium is closed
kill $OLLAMA_PID
kill $PYTHON_SERVER_PID

echo "Ollama server and Python server stopped."
