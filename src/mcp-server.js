import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Define schemas for the methods
const ToolCallSchema = z.object({
  method: z.literal('tools/call'),
  params: z.object({
    name: z.string(),
    arguments: z.record(z.any())
  })
});

const ToolListSchema = z.object({
  method: z.literal('tools/list'),
  params: z.optional(z.record(z.any()))
});

// Create the MCP server
const server = new Server(
  {
    name: 'yla-bash-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Store pending commands that need user approval
const pendingCommands = new Map();

// Tool to execute bash commands
server.setRequestHandler(ToolCallSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'execute_bash_command') {
    const { command, description } = args;
    
    // Generate a unique ID for this command
    const commandId = Date.now().toString();
    
    // Store the command for later execution
    pendingCommands.set(commandId, {
      command,
      description: description || `Execute: ${command}`,
      timestamp: new Date().toISOString(),
    });

    return {
      content: [
        {
          type: 'text',
          text: `I want to execute the following command:\n\n**${command}**\n\n${description ? `**Purpose:** ${description}\n\n` : ''}**Command ID:** ${commandId}\n\nPlease approve this command by calling the \`approve_command\` tool with the command ID: ${commandId}`,
        },
      ],
      isError: false,
    };
  }

  if (name === 'approve_command') {
    const { commandId } = args;
    
    const pendingCommand = pendingCommands.get(commandId);
    if (!pendingCommand) {
      return {
        content: [
          {
            type: 'text',
            text: `Command with ID ${commandId} not found or already executed.`,
          },
        ],
        isError: true,
      };
    }

    try {
      // Execute the command
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const { stdout, stderr } = await execAsync(pendingCommand.command, {
        timeout: 30000, // 30 second timeout
        shell: '/bin/bash',
      });

      // Remove the command from pending list
      pendingCommands.delete(commandId);

      let result = `Command executed successfully!\n\n**Output:**\n\`\`\`\n${stdout}\n\`\`\``;
      
      if (stderr) {
        result += `\n\n**Stderr:**\n\`\`\`\n${stderr}\n\`\`\``;
      }

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
        isError: false,
      };
    } catch (error) {
      // Remove the command from pending list
      pendingCommands.delete(commandId);

      return {
        content: [
          {
            type: 'text',
            text: `Error executing command: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === 'list_pending_commands') {
    if (pendingCommands.size === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No pending commands.',
          },
        ],
        isError: false,
      };
    }

    const commandsList = Array.from(pendingCommands.entries())
      .map(([id, cmd]) => `**ID:** ${id}\n**Command:** ${cmd.command}\n**Description:** ${cmd.description}\n**Timestamp:** ${cmd.timestamp}\n`)
      .join('\n---\n');

    return {
      content: [
        {
          type: 'text',
          text: `**Pending Commands:**\n\n${commandsList}`,
        },
      ],
      isError: false,
    };
  }

  if (name === 'deny_command') {
    const { commandId } = args;
    
    const pendingCommand = pendingCommands.get(commandId);
    if (!pendingCommand) {
      return {
        content: [
          {
            type: 'text',
            text: `Command with ID ${commandId} not found or already processed.`,
          },
        ],
        isError: true,
      };
    }

    // Remove the command from pending list
    pendingCommands.delete(commandId);

    return {
      content: [
        {
          type: 'text',
          text: `Command with ID ${commandId} has been denied and removed from pending list.`,
        },
      ],
      isError: false,
    };
  }

  if (name === 'clear_pending_commands') {
    const count = pendingCommands.size;
    pendingCommands.clear();
    
    return {
      content: [
        {
          type: 'text',
          text: `Cleared ${count} pending commands.`,
        },
      ],
      isError: false,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Unknown tool: ${name}`,
      },
    ],
    isError: true,
  };
});

// List available tools
server.setRequestHandler(ToolListSchema, async () => {
  return {
    tools: [
      {
        name: 'execute_bash_command',
        description: 'Execute a bash command with user approval',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The bash command to execute',
            },
            description: {
              type: 'string',
              description: 'Description of what the command does',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'approve_command',
        description: 'Approve and execute a pending command',
        inputSchema: {
          type: 'object',
          properties: {
            commandId: {
              type: 'string',
              description: 'The ID of the command to approve',
            },
          },
          required: ['commandId'],
        },
      },
      {
        name: 'list_pending_commands',
        description: 'List all pending commands that need approval',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'deny_command',
        description: 'Deny and remove a pending command',
        inputSchema: {
          type: 'object',
          properties: {
            commandId: {
              type: 'string',
              description: 'The ID of the command to deny',
            },
          },
          required: ['commandId'],
        },
      },
      {
        name: 'clear_pending_commands',
        description: 'Clear all pending commands (useful for resetting state)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('YLA MCP Server started'); 