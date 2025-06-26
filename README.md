# yla
![yla](src/media/assistant.png "YLA") 

Run your own AI chatbot locally with Ollama, ensuring data privacy and avoiding cloud breaches. This lightweight setup requires no frameworks like React - just Ollama, a simple HTTP server, and a browser.

Evaluate and experiment LLM freely, **own your AI**.

![yla](src/media/app-screen.png "YLA Interface Preview") 

## Features
- **Local AI Control**: Select from multiple configured models
- **Privacy First**: All processing happens on your machine
- **No Internet Dependencies**: Works completely offline
- **Custom Personalities**: Create specialized assistants with Modelfiles
- **Explore Different Parameters**: You can resend a message changing temperature, top_p, and top_k
- **Expand with New Models on Ollama**: When a new open-source model is deployed on Ollama server, you can download it and use it right away.
- **Visualize Reasoning**: Currently the reasoning part is showed, but it must be wrapped in the `<think>` tag (DeepSeek reasoning token), but it can be extend/modified.
- **MCP Integration**: Execute bash commands with AI assistance and user approval
- **Secure Command Execution**: All commands require explicit user approval with safety checks

## Installation

### 1. Install Ollama
#### **Linux**:
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

#### **Windows**:
Download from [Ollama Windows Preview](https://ollama.com/download)

### 2. Setup Base Models

```bash
# Start Ollama server locally
ollama serve
```
> Ollama could be running in background, so the previous command could fail. Please check if it running at the default url _localhost:11434_

```bash
# Choose based on your hardware
ollama pull deepseek-r1:7b   # 7B parameter version
ollama pull deepseek-r1:32b  # Medium-sized model
```

Check Ollama list of avaiable models [here](https://ollama.com/search).

> Models can also be downloaded from Yla interface, but you have to specify the name in the config file.

### 3. Launch Application

#### **Standard Mode (Linux)**:
```bash
chmod +x utils/run-yla.sh
./utils/run-yla.sh
```
> Default script uses Chromium. Please change it if you want to use a different browser!

#### **MCP Mode (Linux)**:
```bash
chmod +x utils/run-yla.sh
./utils/run-yla.sh --mcp
```
> This starts YLA with MCP (Model Context Protocol) support enabled.

#### **Windows**:
```cmd
ollama serve
python -m http.server 8000
# Open http://localhost:8000/src/yla.html on your browser
```

### Startup Script Options

The `utils/run-yla.sh` script supports the following options:

```bash
# Start YLA without MCP (default)
./utils/run-yla.sh

# Start YLA with MCP support
./utils/run-yla.sh --mcp
./utils/run-yla.sh -m

# Show help
./utils/run-yla.sh --help
./utils/run-yla.sh -h
```

The script will:
- Start Ollama server automatically
- Start Python HTTP server on port 8000
- Start MCP HTTP Bridge on port 3001 (if MCP is enabled)
- Open YLA in your browser
- Clean up all services when you close the browser

## MCP (Model Context Protocol) Integration

YLA supports MCP integration, allowing AI models to execute terminal commands with user approval. This enables powerful capabilities like file system exploration, system information gathering, package management, and process monitoring.

### MCP Architecture

```
User → YLA Web Interface → Ollama API → AI Model
                                    ↓
                              MCP HTTP Bridge → MCP Server → Bash Commands
```

### MCP Components

1. **MCP Server** (`src/mcp-server.js`) - Handles command execution and approval workflow
2. **MCP Client** (`src/mcp-client.js`) - Communicates with the MCP server
3. **HTTP Bridge** (`src/mcp-http-bridge.js`) - Provides HTTP API for frontend communication
4. **HTTP Client** (`src/mcp-http-client.js`) - Frontend client that communicates via HTTP
5. **MCP UI** (`src/mcp-ui.js`) - Provides user interface for command approval

### MCP Setup

#### 1. Install Dependencies
```bash
npm install
```

#### 2. Start the MCP HTTP Bridge
```bash
npm run mcp-bridge
```
This starts the HTTP bridge server on port 3001.

#### 3. Start Your Frontend
```bash
npm run dev
```
This starts a simple HTTP server for your frontend.

### How MCP Works

1. When the AI assistant wants to execute a command, it calls the `execute_bash_command` tool
2. The command is stored as "pending" and requires user approval
3. A notification appears in the UI showing the pending command
4. User can approve or deny the command
5. If approved, the command executes and results are returned to the AI

### Available MCP Tools

#### `execute_bash_command`
Executes a bash command with user approval.

**Parameters:**
- `command` (string, required): The bash command to execute
- `description` (string, optional): Description of what the command does

#### `approve_command`
Approves and executes a pending command.

**Parameters:**
- `commandId` (string, required): The ID of the command to approve

#### `deny_command`
Denies and removes a pending command.

**Parameters:**
- `commandId` (string, required): The ID of the command to deny

#### `list_pending_commands`
Lists all pending commands that need approval.

#### `clear_pending_commands`
Clears all pending commands.

### MCP HTTP API Endpoints

#### Health Check
```
GET /health
```
Returns the status of the MCP bridge and whether MCP is initialized.

#### Get Available Tools
```
GET /tools
```
Returns a list of available MCP tools.

#### Execute Command
```
POST /execute-command
Content-Type: application/json

{
  "command": "echo 'Hello World'",
  "description": "Test command"
}
```
Creates a pending command that requires approval.

#### Approve Command
```
POST /approve-command
Content-Type: application/json

{
  "commandId": "1234567890"
}
```
Approves and executes a pending command.

#### Deny Command
```
POST /deny-command
Content-Type: application/json

{
  "commandId": "1234567890"
}
```
Denies and removes a pending command.

#### Get Pending Commands
```
GET /pending-commands
```
Returns a list of all pending commands.

#### Clear All Pending Commands
```
POST /clear-all-pending-commands
```
Clears all pending commands.

### MCP Usage

#### For Users

1. **View Pending Commands**: Click the checkmark button in the header to see pending commands
2. **Approve Commands**: Click "Approve" to execute a command
3. **Deny Commands**: Click "Deny" to reject a command
4. **Monitor Activity**: The UI automatically shows when new commands are pending

#### For AI Assistants

The AI can now suggest and execute commands like:

- "Let me check your system information" → `uname -a`
- "I'll help you list your files" → `ls -la`
- "Let me check your disk usage" → `df -h`

### MCP Security Features

- **User Consent**: All commands require explicit approval
- **Command Validation**: Dangerous commands are blocked
- **Command Timeout**: Commands timeout after 30 seconds
- **Shell Restriction**: Commands run in `/bin/bash` with limited privileges
- **Error Handling**: Failed commands are reported back to the user
- **HTTP Bridge**: Frontend communicates via HTTP, not direct SDK access
- **Denied Command Persistence**: Denied commands are remembered to prevent reappearance

### Supported Commands

The MCP integration supports most bash commands, including:

- **File Operations**: `ls`, `cat`, `head`, `tail`, `find`, `grep`
- **System Info**: `uname`, `df`, `free`, `ps`, `top`
- **Network**: `ping`, `curl`, `wget`, `netstat`
- **Package Management**: `apt`, `dpkg`, `snap`
- **Process Management**: `kill`, `pkill`, `systemctl`

### Blocked Commands

For security reasons, the following commands are blocked:

- `rm -rf` (recursive force delete)
- `dd if=` (disk operations)
- `mkfs` (filesystem operations)
- `fdisk` (partition operations)
- Fork bombs and other dangerous patterns

### MCP Testing

#### Test MCP Server Directly
```bash
npm run test-mcp
```

#### Test HTTP Bridge
```bash
npm run mcp-bridge
# Then use curl commands above
```

#### Test Frontend Integration
```bash
# Start HTTP bridge
npm run mcp-bridge

# In another terminal, start frontend server
npm run dev

# Open tests/test-frontend.html in browser
```

#### Test Command Detection
Open `tests/test-command-detection.html` in your browser to test command detection patterns.

#### Test MCP Integration
Open `tests/test-mcp-integration.html` in your browser to test the complete MCP workflow.

### MCP Troubleshooting

#### MCP Server Not Starting
```bash
# Check if port 3001 is available
netstat -tuln | grep 3001

# Kill any existing process on port 3001
sudo lsof -ti:3001 | xargs kill -9

# Restart the MCP server
node start-mcp.js
```

#### Model Not Responding
1. **Check Ollama**: Ensure Ollama is running
   ```bash
   curl http://localhost:11434/api/tags
   ```

2. **Check Model**: Ensure your MCP-enabled model is available
   ```bash
   ollama list
   ```

#### Commands Not Executing
1. **Check MCP Status**: Verify MCP server is running
   ```bash
   curl http://localhost:3001/health
   ```

2. **Check Tools**: Verify tools are available
   ```bash
   curl http://localhost:3001/tools
   ```

3. **Check Permissions**: Ensure the MCP server has proper permissions

## Custom Model Configuration

Create and use specialized models using Ollama's Modelfiles:

1. **Create a Modelfile** in the `utils/custom_models` directory:
```bash
# Example technical-assistant.txt
FROM deepseek-r1:7b
SYSTEM """
You are an expert technical assistant. 
Respond in markdown format with detailed explanations.
"""
PARAMETER num_ctx 32768
```

2. **Build your custom model**:
```bash
ollama create my-expert -f ./utils/custom_models/technical-assistant.txt
```

3. **Add it to config.js**:
```javascript
models: [
    {
        name: "my-expert:latest",
        description: "smart coding assistant",
        num_ctx: 32768,
        temperature: 0.7,
        top_k: 40,
        top_p: 0.9,
        systemMessage: "You are an expert technical assistant. 
Respond in markdown format with detailed explanations.",
        size: "4.1GB"
    }
]
```

### Configuration Reference
| Field           | Description                                  | Example       |
|-----------------|----------------------------------------------|---------------|
| `name`          | Ollama model name (exact match required). Add version in case of custom models     | "my-expert:latest"   |
| `description`          | Brief description (optional)     | "smart coding assistant"   |
| `size`       | Size of the model. Used only to add the information on the model panel                 | "4.1GB" 
| `num_ctx`       | Context window size (tokens)                 | 32768         |
| `systemMessage` | Hidden behavior instructions. It does not affect the model, but it is used to show, in case of custom model, the SYSTEM message defined in the creation phase               | "You are an expert technical assistant. Respond in markdown format with detailed explanations."  |
| `temperature`   | Response creativity                          | 0.3-1.8       |

> For custom models remember to add the version (_:latest_ by default) in the config.

## Configuration Example
```javascript
// config.js
const config = {
    models: [
        {
            name: "Yla:latest",          // Must match Ollama model name
            num_ctx: 65536,         // Context window size
            temperature: 0.7,       // 0-2 (0=precise, 2=creative)
            top_k: 40,              // 1-100
            top_p: 0.9,              // 0-1
            systemMessage: "Friendly general assistant",
            size: "4.1GB"
        }
    ],
    
    api: {
        endpoint: "http://localhost:11434/v1/chat/completions",
        available_models: "http://localhost:11434/v1/models",
    }
};
```
![yla](src/media/model-selection-screen.png "YLA Model Selection")

## Model Management
- **Validation**: App checks installed models on launch
- **Selection**: Choose model from initial carousel
- **Download**: If it is not present on Ollama server, it will try to pull the model from Ollama. In case the download is allowed only for valid names
- **Persistence**: Selected model remembered until page refresh
- **Visual Feedback**: 
  - ✅ Available models - full color, clickable
  - ⚠️ Missing models - grayed out with warning. Possibility of download

> **Note**: Model names in config.js must exactly match Ollama model names. Use `ollama list` to verify installed models.

## Testing

YLA includes comprehensive test suites located in the `tests/` directory:

- **test-command-detection.html**: Tests command detection patterns
- **test-mcp-integration.html**: Tests MCP integration workflow
- **test-frontend.html**: Tests frontend functionality
- **test-thinking-streaming.html**: Tests thinking/streaming features
- **test-thinking-brackets.html**: Tests thinking bracket parsing
- **test-current-state.html**: Tests current application state
- **test-mcp.js**: Node.js MCP server tests

To run tests:
1. Start the MCP bridge: `npm run mcp-bridge`
2. Open test files in your browser
3. Follow the test instructions

## Troubleshooting
**Model Not Found**:
1. Verify model name matches Ollama's list
2. Check Ollama is running: `ollama serve`
3. Ensure model files are in `utils/custom_models` directory

**Performance Issues**:
- Reduce `num_ctx` for smaller context windows
- Use smaller model variants (e.g., 7B instead of 32B)
- Close other memory-intensive applications

**MCP Issues**:
- Check if MCP server is running on port 3001
- Verify model supports MCP tools
- Check browser console for error messages
- Use test files in `tests/` directory to isolate issues