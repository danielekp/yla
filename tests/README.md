# YLA Tests

This directory contains comprehensive test suites for YLA and its MCP integration.

## Test Files

### HTML Tests (Browser-based)

#### `test-command-detection.html`
Tests the command detection patterns in YLA. This test verifies that:
- Commands in double backticks are properly detected
- Commands in numbered lists are correctly parsed
- The "bash" keyword is properly removed from commands
- Various command formats are handled correctly

**How to run**: Open in browser at `http://localhost:8000/tests/test-command-detection.html`

#### `test-mcp-integration.html`
Tests the complete MCP integration workflow. This test verifies:
- MCP server connectivity
- Command execution flow
- User approval/denial process
- Command result handling

**How to run**: Open in browser at `http://localhost:8000/tests/test-mcp-integration.html`

#### `test-frontend.html`
Tests the frontend functionality of YLA. This test verifies:
- UI components
- User interactions
- Message handling
- Theme switching

**How to run**: Open in browser at `http://localhost:8000/tests/test-frontend.html`

#### `test-thinking-streaming.html`
Tests the thinking/streaming features of YLA. This test verifies:
- Real-time message streaming
- Thinking placeholder display
- Response formatting

**How to run**: Open in browser at `http://localhost:8000/tests/test-thinking-streaming.html`

#### `test-thinking-brackets.html`
Tests the thinking bracket parsing functionality. This test verifies:
- `<think>` tag parsing
- Reasoning content extraction
- Display formatting

**How to run**: Open in browser at `http://localhost:8000/tests/test-thinking-brackets.html`

#### `test-current-state.html`
Tests the current application state management. This test verifies:
- State persistence
- Configuration loading
- Settings management

**How to run**: Open in browser at `http://localhost:8000/tests/test-current-state.html`

### Node.js Tests

#### `test-mcp.js`
Tests the MCP server functionality directly. This test verifies:
- MCP server startup
- Tool availability
- Command execution
- Response handling

**How to run**: `npm run test-mcp`

## Running Tests

### Quick Start
1. Start the MCP bridge: `npm run mcp-bridge`
2. Start the frontend server: `npm run dev`
3. Run the test runner: `npm run test-runner`

### Manual Testing
1. **MCP Server Test**: `npm run test-mcp`
2. **HTML Tests**: Open the test files in your browser
3. **API Tests**: Use curl commands to test HTTP endpoints

### Test Runner Script
Use the automated test runner: `./tests/run-tests.sh`

This script will:
- Check if required services are running
- Run the MCP server test
- Provide instructions for running HTML tests
- Show available manual API tests

## Test Prerequisites

Before running tests, ensure:

1. **MCP Bridge is running**: `npm run mcp-bridge`
2. **Frontend Server is running**: `npm run dev`
3. **Ollama is running**: `ollama serve`
4. **Required models are available**: Check with `ollama list`

## Test Results

### MCP Server Test
- ✅ Connected to MCP server
- ✅ Available tools listed
- ✅ Command execution successful

### HTML Tests
- Check browser console for detailed results
- Look for success/error messages
- Verify UI interactions work correctly

### API Tests
- Health endpoint: `curl http://localhost:3001/health`
- Tools endpoint: `curl http://localhost:3001/tools`
- Pending commands: `curl http://localhost:3001/pending-commands`

## Troubleshooting

### Tests Not Working
1. Check if MCP bridge is running on port 3001
2. Check if frontend server is running on port 8000
3. Check browser console for JavaScript errors
4. Verify Ollama is running and models are available

### MCP Issues
1. Check MCP server logs for errors
2. Verify port 3001 is not in use
3. Check if required dependencies are installed

### Frontend Issues
1. Check browser console for errors
2. Verify all JavaScript files are loading
3. Check if the frontend server is accessible

## Adding New Tests

To add new tests:

1. **HTML Tests**: Create new HTML files in this directory
2. **Node.js Tests**: Create new JS files and add npm scripts
3. **Update Test Runner**: Modify `run-tests.sh` to include new tests
4. **Update Documentation**: Add test descriptions to this README 