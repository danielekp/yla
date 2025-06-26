#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testMCP() {
  console.log('Testing MCP Server...');
  
  try {
    // Create client
    const client = new Client({
      name: 'test-client',
      version: '1.0.0',
    });

    const transport = new StdioClientTransport({
      command: 'node',
      args: ['src/mcp-server.js'],
    });

    await client.connect(transport);
    console.log('✅ Connected to MCP server');

    // Test listing tools
    const tools = await client.listTools();
    console.log('✅ Available tools:', tools.tools.map(t => t.name));

    // Test executing a command
    const result = await client.callTool({
      name: 'execute_bash_command',
      arguments: {
        command: 'echo "Hello from MCP!"',
        description: 'Test command to verify MCP functionality'
      },
    });

    console.log('✅ Command execution result:', result.content[0].text);

    // Extract command ID
    const commandId = result.content[0].text.match(/Command ID:\s*(\d+)/)?.[1];
    
    if (commandId) {
      console.log(`✅ Command ID extracted: ${commandId}`);
      
      // Test approving the command
      const approveResult = await client.callTool({
        name: 'approve_command',
        arguments: {
          commandId: commandId
        },
      });

      console.log('✅ Command approval result:', approveResult.content[0].text);
    }

    await client.close();
    console.log('✅ Test completed successfully');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testMCP(); 