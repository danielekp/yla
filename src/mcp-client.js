import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * MCP Client for YLA
 * Handles communication with the MCP server for bash command execution
 */
class YLAMCPClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.pendingCommands = new Map();
  }

  /**
   * Initialize the MCP client
   */
  async initialize() {
    try {
      this.client = new Client({
        name: 'yla-client',
        version: '1.0.0',
      });

      const transport = new StdioClientTransport({
        command: 'node',
        args: ['src/mcp-server.js'],
      });

      await this.client.connect(transport);
      this.isConnected = true;
      console.log('MCP Client connected successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize MCP client:', error);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Execute a bash command (requires approval)
   * @param {string} command - The bash command to execute
   * @param {string} description - Description of what the command does
   * @returns {Promise<Object>} - Result with command ID and message
   */
  async executeBashCommand(command, description = '') {
    console.log('MCP Client: executeBashCommand called with:', { command, description });
    
    if (!this.isConnected) {
      console.error('MCP Client: Not connected');
      throw new Error('MCP client not connected');
    }

    try {
      console.log('MCP Client: Calling client.callTool...');
      const result = await this.client.callTool({
        name: 'execute_bash_command',
        arguments: {
          command,
          description,
        },
      });

      console.log('MCP Client: callTool result:', result);
      console.log('MCP Client: result.content[0].text:', result.content[0].text);

      // Extract command ID from the response
      const commandId = this.extractCommandId(result.content[0].text);
      console.log('MCP Client: extracted commandId:', commandId);
      
      if (commandId) {
        console.log('MCP Client: Adding command to pending commands');
        this.pendingCommands.set(commandId, {
          command,
          description,
          timestamp: new Date().toISOString(),
        });
      }

      const response = {
        success: true,
        commandId,
        message: result.content[0].text,
      };
      
      console.log('MCP Client: returning response:', response);
      return response;
    } catch (error) {
      console.error('MCP Client: Error executing bash command:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Approve and execute a pending command
   * @param {string} commandId - The ID of the command to approve
   * @returns {Promise<Object>} - Result of command execution
   */
  async approveCommand(commandId) {
    if (!this.isConnected) {
      throw new Error('MCP client not connected');
    }

    try {
      const result = await this.client.callTool({
        name: 'approve_command',
        arguments: {
          commandId,
        },
      });

      // Remove from pending commands
      this.pendingCommands.delete(commandId);

      return {
        success: !result.isError,
        message: result.content[0].text,
      };
    } catch (error) {
      console.error('Error approving command:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Deny and remove a pending command
   * @param {string} commandId - The ID of the command to deny
   * @returns {Promise<Object>} - Result of command denial
   */
  async denyCommand(commandId) {
    if (!this.isConnected) {
      throw new Error('MCP client not connected');
    }

    try {
      const result = await this.client.callTool({
        name: 'deny_command',
        arguments: {
          commandId,
        },
      });

      // Remove from pending commands
      this.pendingCommands.delete(commandId);

      return {
        success: !result.isError,
        message: result.content[0].text,
      };
    } catch (error) {
      console.error('Error denying command:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Clear all pending commands
   * @returns {Promise<Object>} - Result of clearing commands
   */
  async clearPendingCommands() {
    if (!this.isConnected) {
      throw new Error('MCP client not connected');
    }

    try {
      const result = await this.client.callTool({
        name: 'clear_pending_commands',
        arguments: {},
      });

      // Clear local pending commands
      this.pendingCommands.clear();

      return {
        success: !result.isError,
        message: result.content[0].text,
      };
    } catch (error) {
      console.error('Error clearing pending commands:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List all pending commands
   * @returns {Promise<Object>} - List of pending commands
   */
  async listPendingCommands() {
    if (!this.isConnected) {
      throw new Error('MCP client not connected');
    }

    try {
      const result = await this.client.callTool({
        name: 'list_pending_commands',
        arguments: {},
      });

      return {
        success: true,
        message: result.content[0].text,
      };
    } catch (error) {
      console.error('Error listing pending commands:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get available tools from the MCP server
   * @returns {Promise<Array>} - List of available tools
   */
  async getAvailableTools() {
    if (!this.isConnected) {
      throw new Error('MCP client not connected');
    }

    try {
      const result = await this.client.listTools();
      return result.tools;
    } catch (error) {
      console.error('Error getting available tools:', error);
      return [];
    }
  }

  /**
   * Extract command ID from response text
   * @param {string} text - Response text from MCP server
   * @returns {string|null} - Command ID if found
   */
  extractCommandId(text) {
    console.log('MCP Client: extractCommandId called with text:', text);
    
    // Handle multiple formats including newlines
    const patterns = [
      /\*\*Command ID:\*\*\s*(\d+)/,  // **Command ID:** 123
      /Command ID:\s*(\d+)/,           // Command ID: 123
      /\*\*Command ID:\*\*\s*(\d+)/m,  // With multiline flag
      /Command ID:\s*(\d+)/m,          // With multiline flag
    ];
    
    for (let i = 0; i < patterns.length; i++) {
      const match = text.match(patterns[i]);
      console.log(`MCP Client: pattern ${i} result:`, match);
      if (match) {
        console.log('MCP Client: extracted command ID:', match[1]);
        return match[1];
      }
    }
    
    console.log('MCP Client: no command ID found');
    return null;
  }

  /**
   * Get all pending commands from local cache
   * @returns {Map} - Map of pending commands
   */
  getPendingCommands() {
    return new Map(this.pendingCommands);
  }

  /**
   * Disconnect the MCP client
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.error('Error disconnecting MCP client:', error);
      }
    }
    this.isConnected = false;
  }
}

// Create and export a singleton instance
const mcpClient = new YLAMCPClient();

export default mcpClient; 