import express from 'express';
import cors from 'cors';
import mcpClient from './mcp-client.js';

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize MCP client
let mcpInitialized = false;

async function ensureMCPInitialized() {
  if (!mcpInitialized) {
    try {
      await mcpClient.initialize();
      mcpInitialized = true;
      console.log('MCP client initialized via HTTP bridge');
    } catch (error) {
      console.error('Failed to initialize MCP client:', error);
      throw error;
    }
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mcpInitialized });
});

// Get available tools
app.get('/tools', async (req, res) => {
  try {
    await ensureMCPInitialized();
    const tools = await mcpClient.getAvailableTools();
    res.json({ success: true, tools });
  } catch (error) {
    console.error('Error getting tools:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Execute a bash command (creates pending command)
app.post('/execute-command', async (req, res) => {
  try {
    console.log('HTTP Bridge: execute-command endpoint called');
    await ensureMCPInitialized();
    const { command, description } = req.body;
    
    console.log('HTTP Bridge: Request body:', { command, description });
    
    if (!command) {
      console.log('HTTP Bridge: Command is missing');
      return res.status(400).json({ success: false, error: 'Command is required' });
    }

    console.log('HTTP Bridge: Calling mcpClient.executeBashCommand...');
    const result = await mcpClient.executeBashCommand(command, description || '');
    console.log('HTTP Bridge: mcpClient.executeBashCommand result:', result);
    
    res.json(result);
  } catch (error) {
    console.error('HTTP Bridge: Error executing command:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Approve a pending command
app.post('/approve-command', async (req, res) => {
  try {
    await ensureMCPInitialized();
    const { commandId } = req.body;
    
    if (!commandId) {
      return res.status(400).json({ success: false, error: 'Command ID is required' });
    }

    const result = await mcpClient.approveCommand(commandId);
    res.json(result);
  } catch (error) {
    console.error('Error approving command:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get pending commands
app.get('/pending-commands', async (req, res) => {
  try {
    await ensureMCPInitialized();
    const pendingCommands = mcpClient.getPendingCommands();
    const commandsArray = Array.from(pendingCommands.entries()).map(([id, cmd]) => ({
      id,
      command: cmd.command,
      description: cmd.description,
      timestamp: cmd.timestamp
    }));
    
    res.json({ success: true, commands: commandsArray });
  } catch (error) {
    console.error('Error getting pending commands:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// List pending commands (MCP tool call)
app.post('/list-pending-commands', async (req, res) => {
  try {
    await ensureMCPInitialized();
    const result = await mcpClient.listPendingCommands();
    res.json(result);
  } catch (error) {
    console.error('Error listing pending commands:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Deny a pending command
app.post('/deny-command', async (req, res) => {
  try {
    await ensureMCPInitialized();
    const { commandId } = req.body;
    
    if (!commandId) {
      return res.status(400).json({ success: false, error: 'Command ID is required' });
    }

    // Use the MCP client's deny method
    const result = await mcpClient.denyCommand(commandId);
    res.json(result);
  } catch (error) {
    console.error('Error denying command:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all pending commands
app.post('/clear-all-pending-commands', async (req, res) => {
  try {
    await ensureMCPInitialized();
    
    const result = await mcpClient.clearPendingCommands();
    res.json(result);
  } catch (error) {
    console.error('Error clearing pending commands:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Initialize MCP client on startup
app.listen(PORT, async () => {
  console.log(`MCP HTTP Bridge server running on port ${PORT}`);
  try {
    await ensureMCPInitialized();
  } catch (error) {
    console.error('Failed to initialize MCP client on startup:', error);
  }
});

export default app; 