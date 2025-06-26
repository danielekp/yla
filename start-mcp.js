#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Starting MCP HTTP Bridge...');

// Start the HTTP bridge server
const bridgeProcess = spawn('node', ['src/mcp-http-bridge.js'], {
  stdio: 'inherit',
  cwd: __dirname
});

bridgeProcess.on('error', (error) => {
  console.error('Failed to start MCP HTTP Bridge:', error);
  process.exit(1);
});

bridgeProcess.on('exit', (code) => {
  console.log(`MCP HTTP Bridge exited with code ${code}`);
  process.exit(code);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\nShutting down MCP HTTP Bridge...');
  bridgeProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\nShutting down MCP HTTP Bridge...');
  bridgeProcess.kill('SIGTERM');
}); 