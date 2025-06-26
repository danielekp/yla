#!/bin/bash

# YLA Test Runner
# This script helps you run all the tests for YLA

echo "🚀 YLA Test Runner"
echo "=================="

# Check if MCP bridge is running
echo "📡 Checking MCP bridge status..."
if curl -s http://localhost:3001/health > /dev/null; then
    echo "✅ MCP bridge is running on port 3001"
else
    echo "❌ MCP bridge is not running"
    echo "   Start it with: npm run mcp-bridge"
    echo ""
fi

# Check if frontend server is running
echo "🌐 Checking frontend server status..."
if curl -s http://localhost:8000 > /dev/null; then
    echo "✅ Frontend server is running on port 8000"
else
    echo "❌ Frontend server is not running"
    echo "   Start it with: npm run dev"
    echo ""
fi

echo ""
echo "📋 Available Tests:"
echo "=================="
echo "1. MCP Server Test (Node.js):"
echo "   npm run test-mcp"
echo ""
echo "2. HTML Tests (Browser):"
echo "   Open these URLs in your browser:"
echo "   - http://localhost:8000/tests/test-command-detection.html"
echo "   - http://localhost:8000/tests/test-mcp-integration.html"
echo "   - http://localhost:8000/tests/test-frontend.html"
echo "   - http://localhost:8000/tests/test-thinking-streaming.html"
echo "   - http://localhost:8000/tests/test-thinking-brackets.html"
echo "   - http://localhost:8000/tests/test-current-state.html"
echo ""
echo "3. Manual API Tests:"
echo "   curl http://localhost:3001/health"
echo "   curl http://localhost:3001/tools"
echo "   curl http://localhost:3001/pending-commands"
echo ""

# Run MCP test if bridge is running
if curl -s http://localhost:3001/health > /dev/null; then
    echo "🧪 Running MCP server test..."
    npm run test-mcp
    echo ""
fi

echo "✨ Test runner completed!"
echo ""
echo "💡 Tips:"
echo "   - Make sure both MCP bridge and frontend server are running"
echo "   - Open test HTML files in your browser to run interactive tests"
echo "   - Check browser console for detailed test results" 