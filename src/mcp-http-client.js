/**
 * Frontend MCP Client
 * Communicates with the MCP server via HTTP bridge
 */
class MCPHTTPClient {
  constructor(baseURL = 'http://localhost:3001') {
    this.baseURL = baseURL;
    this.isConnected = false;
    this.pendingCommands = new Map();
  }

  /**
   * Initialize the HTTP client
   */
  async initialize() {
    try {
      const response = await fetch(`${this.baseURL}/health`);
      if (response.ok) {
        const data = await response.json();
        this.isConnected = data.mcpInitialized;
        console.log('MCP HTTP client connected:', this.isConnected);
        return this.isConnected;
      } else {
        throw new Error('HTTP bridge not available');
      }
    } catch (error) {
      console.error('Failed to initialize MCP HTTP client:', error);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Execute a bash command (requires approval)
   */
  async executeBashCommand(command, description = '') {
    console.log('MCP HTTP Client: executeBashCommand called with:', { command, description });
    
    if (!this.isConnected) {
      console.error('MCP HTTP Client: Not connected');
      throw new Error('MCP HTTP client not connected');
    }

    try {
      console.log('MCP HTTP Client: Sending request to /execute-command...');
      const response = await fetch(`${this.baseURL}/execute-command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command, description }),
      });

      console.log('MCP HTTP Client: Response status:', response.status);
      const result = await response.json();
      console.log('MCP HTTP Client: Response result:', result);
      
      if (result.success && result.commandId) {
        console.log('MCP HTTP Client: Command queued with ID:', result.commandId);
        this.pendingCommands.set(result.commandId, {
          command,
          description,
          timestamp: new Date().toISOString(),
        });
      }

      return result;
    } catch (error) {
      console.error('MCP HTTP Client: Error executing bash command:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Approve and execute a pending command
   */
  async approveCommand(commandId) {
    if (!this.isConnected) {
      throw new Error('MCP HTTP client not connected');
    }

    try {
      const response = await fetch(`${this.baseURL}/approve-command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ commandId }),
      });

      const result = await response.json();
      
      if (result.success) {
        this.pendingCommands.delete(commandId);
      }

      return result;
    } catch (error) {
      console.error('Error approving command:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get pending commands from HTTP bridge
   */
  async getPendingCommands() {
    if (!this.isConnected) {
      throw new Error('MCP HTTP client not connected');
    }

    try {
      const response = await fetch(`${this.baseURL}/pending-commands`);
      const result = await response.json();
      
      if (result.success) {
        // Update local cache
        this.pendingCommands.clear();
        result.commands.forEach(cmd => {
          this.pendingCommands.set(cmd.id, {
            command: cmd.command,
            description: cmd.description,
            timestamp: cmd.timestamp,
          });
        });
      }

      return result;
    } catch (error) {
      console.error('Error getting pending commands:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get available tools from HTTP bridge
   */
  async getAvailableTools() {
    if (!this.isConnected) {
      throw new Error('MCP HTTP client not connected');
    }

    try {
      const response = await fetch(`${this.baseURL}/tools`);
      const result = await response.json();
      return result.success ? result.tools : [];
    } catch (error) {
      console.error('Error getting available tools:', error);
      return [];
    }
  }

  /**
   * Get all pending commands from local cache
   */
  getPendingCommandsFromCache() {
    return new Map(this.pendingCommands);
  }

  /**
   * Get pending commands count
   */
  getPendingCommandsCount() {
    return this.pendingCommands.size;
  }

  /**
   * Check connection status
   */
  async checkConnection() {
    try {
      const response = await fetch(`${this.baseURL}/health`);
      if (response.ok) {
        const data = await response.json();
        this.isConnected = data.mcpInitialized;
        return this.isConnected;
      }
      return false;
    } catch (error) {
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Disconnect the client
   */
  disconnect() {
    this.isConnected = false;
    this.pendingCommands.clear();
  }

  /**
   * Deny and remove a pending command
   */
  async denyCommand(commandId) {
    if (!this.isConnected) {
      throw new Error('MCP HTTP client not connected');
    }

    try {
      console.log('MCP HTTP Client: Denying command:', commandId);
      
      // Remove from local cache first
      this.pendingCommands.delete(commandId);
      
      // Try to remove from server (if the endpoint exists)
      try {
        const response = await fetch(`${this.baseURL}/deny-command`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ commandId }),
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log('MCP HTTP Client: Server deny result:', result);
        }
      } catch (error) {
        console.warn('MCP HTTP Client: Server deny endpoint not available, using local removal only');
      }

      return {
        success: true,
        message: 'Command denied and removed',
      };
    } catch (error) {
      console.error('MCP HTTP Client: Error denying command:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Clear all pending commands
   */
  async clearAllPendingCommands() {
    if (!this.isConnected) {
      throw new Error('MCP HTTP client not connected');
    }

    try {
      const response = await fetch(`${this.baseURL}/clear-all-pending-commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      
      if (result.success) {
        this.pendingCommands.clear();
      }

      return result;
    } catch (error) {
      console.error('Error clearing pending commands:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

// Create and export a singleton instance
const mcpHTTPClient = new MCPHTTPClient();

export default mcpHTTPClient; 