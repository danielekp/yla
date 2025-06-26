#!/bin/bash

# YLA Startup Script with MCP Support
# This script starts YLA with optional MCP (Model Context Protocol) integration

# Define the directory where your HTML file is located
PROJECT_DIR="/home/sd23297/Documents/yla/"

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -m, --mcp          Start with MCP (Model Context Protocol) support"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                 Start YLA without MCP"
    echo "  $0 --mcp           Start YLA with MCP support"
    echo "  $0 -m              Start YLA with MCP support (short form)"
}

# Parse command line arguments
USE_MCP=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mcp)
            USE_MCP=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

echo "🚀 Starting YLA..."
if [ "$USE_MCP" = true ]; then
    echo "📡 MCP (Model Context Protocol) support: ENABLED"
else
    echo "📡 MCP support: DISABLED"
fi
echo ""

# Change to the project directory
cd "$PROJECT_DIR" || exit

# Start Ollama server in the background
echo "🦙 Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to start
sleep 3

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null; then
    echo "❌ Failed to start Ollama server"
    exit 1
fi
echo "✅ Ollama server is running"

# Start MCP HTTP Bridge if MCP is enabled
if [ "$USE_MCP" = true ]; then
    echo "🔗 Starting MCP HTTP Bridge..."
    node src/mcp-http-bridge.js &
    MCP_BRIDGE_PID=$!
    
    # Wait for MCP bridge to start
    sleep 3
    
    # Check if MCP bridge is running
    if ! curl -s http://localhost:3001/health > /dev/null; then
        echo "❌ Failed to start MCP HTTP Bridge"
        kill $OLLAMA_PID
        exit 1
    fi
    echo "✅ MCP HTTP Bridge is running on port 3001"
fi

# Start Python HTTP server
echo "🌐 Starting Python HTTP server..."
PORT=8000
python3 -m http.server $PORT &
PYTHON_SERVER_PID=$!

# Wait for Python server to start
sleep 2

# Check if Python server is running
if ! curl -s http://localhost:$PORT > /dev/null; then
    echo "❌ Failed to start Python HTTP server"
    kill $OLLAMA_PID
    if [ "$USE_MCP" = true ]; then
        kill $MCP_BRIDGE_PID
    fi
    exit 1
fi
echo "✅ Python HTTP server is running on port $PORT"

echo ""
echo "🎉 YLA is ready!"
echo "📱 Opening YLA in your browser..."
echo ""

# Open Chromium and wait for it to close
# Change this to your default browser if needed
chromium --app="http://localhost:$PORT/src/yla.html" &
CHROMIUM_PID=$!

# Wait for Chromium to close
wait $CHROMIUM_PID

echo ""
echo "🛑 Shutting down YLA..."

# Cleanup: Stop all servers
kill $OLLAMA_PID
kill $PYTHON_SERVER_PID

if [ "$USE_MCP" = true ]; then
    kill $MCP_BRIDGE_PID
    echo "✅ MCP HTTP Bridge stopped"
fi

echo "✅ Ollama server stopped"
echo "✅ Python HTTP server stopped"
echo ""
echo "👋 YLA has been shut down successfully."
