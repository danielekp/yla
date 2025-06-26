import mcpHTTPClient from './mcp-http-client.js';

/**
 * MCP UI Manager
 * Handles the user interface for MCP command approval
 */
class MCPUIManager {
  constructor() {
    this.pendingCommandsContainer = null;
    this.commandNotificationContainer = null;
    this.isInitialized = false;
    this.shownCommandIds = new Set(); // Track which commands have been shown
    this.deniedCommandIds = new Set(); // Track which commands have been denied
    
    // Load denied commands from localStorage
    this.loadDeniedCommands();
  }

  /**
   * Load denied commands from localStorage
   */
  loadDeniedCommands() {
    try {
      const savedDeniedCommands = localStorage.getItem('yla_denied_commands');
      if (savedDeniedCommands) {
        const deniedCommandsArray = JSON.parse(savedDeniedCommands);
        this.deniedCommandIds = new Set(deniedCommandsArray);
        console.log('MCP UI: Loaded', this.deniedCommandIds.size, 'denied commands from localStorage:', Array.from(this.deniedCommandIds));
      } else {
        console.log('MCP UI: No denied commands found in localStorage');
      }
    } catch (error) {
      console.warn('MCP UI: Error loading denied commands from localStorage:', error);
      this.deniedCommandIds = new Set();
    }
  }

  /**
   * Save denied commands to localStorage
   */
  saveDeniedCommands() {
    try {
      const deniedCommandsArray = Array.from(this.deniedCommandIds);
      localStorage.setItem('yla_denied_commands', JSON.stringify(deniedCommandsArray));
      console.log('MCP UI: Saved', this.deniedCommandIds.size, 'denied commands to localStorage');
    } catch (error) {
      console.warn('MCP UI: Error saving denied commands to localStorage:', error);
    }
  }

  /**
   * Add a command to denied list and persist it
   */
  addDeniedCommand(commandId) {
    this.deniedCommandIds.add(commandId);
    this.saveDeniedCommands();
  }

  /**
   * Clear old denied commands (older than 24 hours)
   */
  clearOldDeniedCommands() {
    try {
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      
      // Convert command IDs to timestamps and filter out old ones
      const currentDeniedCommands = Array.from(this.deniedCommandIds).filter(commandId => {
        const timestamp = parseInt(commandId);
        return !isNaN(timestamp) && (now - timestamp) < oneDayMs;
      });
      
      if (currentDeniedCommands.length !== this.deniedCommandIds.size) {
        this.deniedCommandIds = new Set(currentDeniedCommands);
        this.saveDeniedCommands();
        console.log('MCP UI: Cleared old denied commands, kept', this.deniedCommandIds.size, 'recent ones');
      }
    } catch (error) {
      console.warn('MCP UI: Error clearing old denied commands:', error);
    }
  }

  /**
   * Clear all denied commands (useful for resetting state)
   */
  clearAllDeniedCommands() {
    this.deniedCommandIds.clear();
    this.saveDeniedCommands();
    console.log('MCP UI: Cleared all denied commands');
  }

  /**
   * Get the count of denied commands
   */
  getDeniedCommandsCount() {
    return this.deniedCommandIds.size;
  }

  /**
   * Get the list of denied commands (for debugging)
   */
  getDeniedCommands() {
    return Array.from(this.deniedCommandIds);
  }

  /**
   * Initialize the MCP UI
   */
  async initialize() {
    if (this.isInitialized) return;

    // Initialize MCP HTTP client
    const clientInitialized = await mcpHTTPClient.initialize();
    if (!clientInitialized) {
      console.error('Failed to initialize MCP HTTP client');
      return false;
    }

    // Clear old denied commands (older than 24 hours)
    this.clearOldDeniedCommands();

    // Clear any old pending commands on startup to prevent stale state
    try {
      await mcpHTTPClient.clearAllPendingCommands();
      console.log('MCP UI: Cleared old pending commands on startup');
    } catch (error) {
      console.warn('MCP UI: Could not clear old pending commands:', error);
    }

    // Create UI elements
    this.createUIElements();
    this.bindEvents();
    
    // Start monitoring for pending commands
    this.startCommandMonitoring();
    
    this.isInitialized = true;
    return true;
  }

  /**
   * Create UI elements for MCP functionality
   */
  createUIElements() {
    // Create pending commands container
    this.pendingCommandsContainer = document.createElement('div');
    this.pendingCommandsContainer.id = 'mcp-pending-commands';
    this.pendingCommandsContainer.className = 'mcp-pending-commands hidden';
    
    // Create command notification container
    this.commandNotificationContainer = document.createElement('div');
    this.commandNotificationContainer.id = 'mcp-command-notification';
    this.commandNotificationContainer.className = 'mcp-command-notification hidden';
    
    // Add elements to DOM
    document.body.appendChild(this.pendingCommandsContainer);
    document.body.appendChild(this.commandNotificationContainer);
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .mcp-pending-commands {
        position: fixed;
        top: 80px;
        right: 20px;
        width: 350px;
        max-height: 400px;
        background: var(--bg-color);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1000;
        overflow-y: auto;
        padding: 16px;
      }

      .mcp-pending-commands.hidden {
        display: none;
      }

      .mcp-command-notification {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 400px;
        background: var(--bg-secondary);
        border: 2px solid #f59e0b;
        border-radius: 12px;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
        z-index: 1001;
        padding: 20px;
        animation: slideInRight 0.3s ease-out;
      }

      .mcp-command-notification.hidden {
        display: none;
      }

      @keyframes slideInRight {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      .mcp-notification-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--border-color);
      }

      .mcp-notification-title {
        font-weight: 600;
        color: var(--text-color);
        font-size: 16px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .mcp-notification-icon {
        width: 20px;
        height: 20px;
        color: #f59e0b;
      }

      .mcp-notification-close {
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        font-size: 18px;
        padding: 4px;
        border-radius: 4px;
        transition: background-color 0.2s;
      }

      .mcp-notification-close:hover {
        background-color: var(--border-color);
        color: var(--text-color);
      }

      .mcp-notification-content {
        margin-bottom: 16px;
      }

      .mcp-notification-command {
        font-family: monospace;
        background: var(--code-bg, #f3f4f6);
        padding: 12px;
        border-radius: 6px;
        margin: 8px 0;
        word-break: break-all;
        font-size: 14px;
        border-left: 4px solid #f59e0b;
      }

      .mcp-notification-description {
        color: var(--text-secondary);
        font-size: 14px;
        margin-bottom: 12px;
      }

      .mcp-notification-actions {
        display: flex;
        gap: 12px;
      }

      .mcp-notification-btn {
        flex: 1;
        padding: 10px 16px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .mcp-notification-btn-approve {
        background: #10b981;
        color: white;
      }

      .mcp-notification-btn-approve:hover {
        background: #059669;
        transform: translateY(-1px);
      }

      .mcp-notification-btn-deny {
        background: #ef4444;
        color: white;
      }

      .mcp-notification-btn-deny:hover {
        background: #dc2626;
        transform: translateY(-1px);
      }

      /* Command Execution Wrapper Styles */
      .command-execution-wrapper {
        margin: 16px 0;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        overflow: hidden;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        transition: all 0.3s ease;
      }

      .command-execution-wrapper:hover {
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        transform: translateY(-1px);
      }

      .command-execution-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 20px;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
        font-weight: 600;
        font-size: 14px;
      }

      .command-execution-error .command-execution-header {
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      }

      .command-execution-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        backdrop-filter: blur(10px);
      }

      .command-execution-title {
        flex: 1;
        font-size: 15px;
      }

      .command-execution-status {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        font-size: 16px;
        font-weight: bold;
        backdrop-filter: blur(10px);
      }

      .command-execution-content {
        padding: 20px;
      }

      .command-output-section {
        margin-bottom: 16px;
      }

      .command-output-header {
        margin-bottom: 12px;
      }

      .command-output-label {
        font-weight: 600;
        color: #374151;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .command-output-code {
        background: #1f2937;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid #374151;
      }

      .command-error-code {
        background: #7f1d1d;
        border-color: #dc2626;
      }

      .command-output-code pre {
        margin: 0;
        padding: 16px;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 13px;
        line-height: 1.5;
        color: #f9fafb;
        overflow-x: auto;
      }

      .command-error-code pre {
        color: #fecaca;
      }

      .command-output-code code {
        background: none;
        padding: 0;
        border: none;
        color: inherit;
      }

      /* Dark mode support */
      .dark-mode .command-execution-wrapper {
        background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
        border-color: #374151;
      }

      .dark-mode .command-output-label {
        color: #d1d5db;
      }

      .dark-mode .command-output-code {
        background: #0f172a;
        border-color: #1e293b;
      }

      .dark-mode .command-output-code pre {
        color: #e2e8f0;
      }

      .mcp-command-item {
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 12px;
        background: var(--bg-secondary);
      }

      .mcp-command-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .mcp-command-id {
        font-size: 12px;
        color: var(--text-secondary);
        font-family: monospace;
      }

      .mcp-command-text {
        font-family: monospace;
        background: var(--code-bg);
        padding: 8px;
        border-radius: 4px;
        margin: 8px 0;
        word-break: break-all;
        font-size: 13px;
      }

      .mcp-command-description {
        font-size: 14px;
        color: var(--text-secondary);
        margin-bottom: 8px;
      }

      .mcp-command-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }

      .mcp-btn {
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: background-color 0.2s;
      }

      .mcp-btn-approve {
        background: #10b981;
        color: white;
      }

      .mcp-btn-approve:hover {
        background: #059669;
      }

      .mcp-btn-deny {
        background: #ef4444;
        color: white;
      }

      .mcp-btn-deny:hover {
        background: #dc2626;
      }

      .mcp-btn-secondary {
        background: var(--border-color);
        color: var(--text-color);
      }

      .mcp-btn-secondary:hover {
        background: var(--text-secondary);
      }

      .mcp-empty-state {
        text-align: center;
        color: var(--text-secondary);
        font-style: italic;
        padding: 20px;
      }

      .mcp-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--border-color);
      }

      .mcp-title {
        font-weight: 600;
        color: var(--text-color);
      }

      .mcp-close-btn {
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        font-size: 18px;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .mcp-close-btn:hover {
        color: var(--text-color);
      }

      /* Command Detection Wrapper Styles */
      .command-detection-wrapper {
        margin: 16px 0;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
        overflow: hidden;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        transition: all 0.3s ease;
      }

      .command-detection-wrapper:hover {
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        transform: translateY(-1px);
      }

      .command-detection-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 20px;
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        color: white;
        font-weight: 600;
        font-size: 14px;
      }

      .command-detection-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        backdrop-filter: blur(10px);
      }

      .command-detection-title {
        flex: 1;
        font-size: 15px;
      }

      .command-detection-status {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        font-size: 16px;
        font-weight: bold;
        backdrop-filter: blur(10px);
      }

      .command-detection-content {
        padding: 20px;
      }

      .command-detection-message {
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .command-detection-label {
        font-weight: 600;
        color: #92400e;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .command-detection-command {
        background: #1f2937;
        color: #f9fafb;
        padding: 6px 12px;
        border-radius: 6px;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 13px;
        border: 1px solid #374151;
      }

      .command-detection-note {
        display: flex;
        align-items: center;
        color: #92400e;
        font-size: 13px;
        font-weight: 500;
        background: rgba(251, 191, 36, 0.1);
        padding: 8px 12px;
        border-radius: 6px;
        border-left: 3px solid #f59e0b;
      }

      /* Dark mode support for command detection */
      .dark-mode .command-detection-wrapper {
        background: linear-gradient(135deg, #451a03 0%, #78350f 100%);
        border-color: #92400e;
      }

      .dark-mode .command-detection-label {
        color: #fbbf24;
      }

      .dark-mode .command-detection-command {
        background: #0f172a;
        border-color: #1e293b;
        color: #e2e8f0;
      }

      .dark-mode .command-detection-note {
        color: #fbbf24;
        background: rgba(251, 191, 36, 0.1);
        border-left-color: #f59e0b;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Close button
    this.pendingCommandsContainer.addEventListener('click', (e) => {
      if (e.target.classList.contains('mcp-close-btn')) {
        this.hidePendingCommands();
      }
    });
  }

  /**
   * Show pending commands panel
   */
  showPendingCommands() {
    this.pendingCommandsContainer.classList.remove('hidden');
    this.updatePendingCommandsDisplay();
  }

  /**
   * Hide pending commands panel
   */
  hidePendingCommands() {
    this.pendingCommandsContainer.classList.add('hidden');
  }

  /**
   * Update the display of pending commands
   */
  async updatePendingCommandsDisplay() {
    const pendingCommands = mcpHTTPClient.getPendingCommandsFromCache();
    
    if (pendingCommands.size === 0) {
      this.pendingCommandsContainer.innerHTML = `
        <div class="mcp-header">
          <span class="mcp-title">Pending Commands</span>
          <button class="mcp-close-btn">&times;</button>
        </div>
        <div class="mcp-empty-state">No pending commands</div>
      `;
      return;
    }

    const commandsHTML = Array.from(pendingCommands.entries())
      .map(([id, cmd]) => this.renderCommandItem(id, cmd))
      .join('');

    this.pendingCommandsContainer.innerHTML = `
      <div class="mcp-header">
        <span class="mcp-title">Pending Commands (${pendingCommands.size})</span>
        <button class="mcp-close-btn">&times;</button>
      </div>
      ${commandsHTML}
    `;

    // Bind action buttons
    this.bindCommandActions();
  }

  /**
   * Render a single command item
   */
  renderCommandItem(id, command) {
    return `
      <div class="mcp-command-item" data-command-id="${id}">
        <div class="mcp-command-header">
          <span class="mcp-command-id">ID: ${id}</span>
          <span class="mcp-timestamp">${new Date(command.timestamp).toLocaleTimeString()}</span>
        </div>
        ${command.description ? `<div class="mcp-command-description">${command.description}</div>` : ''}
        <div class="mcp-command-text">${command.command}</div>
        <div class="mcp-command-actions">
          <button class="mcp-btn mcp-btn-approve" data-action="approve" data-command-id="${id}">
            Approve
          </button>
          <button class="mcp-btn mcp-btn-deny" data-action="deny" data-command-id="${id}">
            Deny
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Bind action buttons for commands
   */
  bindCommandActions() {
    this.pendingCommandsContainer.addEventListener('click', async (e) => {
      if (e.target.classList.contains('mcp-btn')) {
        const action = e.target.dataset.action;
        const commandId = e.target.dataset.commandId;

        if (action === 'approve') {
          await this.approveCommand(commandId);
        } else if (action === 'deny') {
          this.denyCommand(commandId);
        }
      }
    });
  }

  /**
   * Approve a command
   */
  async approveCommand(commandId) {
    console.log('MCP UI: approveCommand called with commandId:', commandId);
    
    try {
      console.log('MCP UI: Calling mcpHTTPClient.approveCommand...');
      const result = await mcpHTTPClient.approveCommand(commandId);
      console.log('MCP UI: mcpHTTPClient.approveCommand result:', result);
      
      if (result.success) {
        console.log('MCP UI: Command approved successfully, showing toast...');
        this.showToast('Command executed successfully!', 'success');
        
        // Update the chat with the command results
        this.updateChatWithCommandResults(result.message);
        
        // Remove from shown commands tracking
        this.shownCommandIds.delete(commandId);
        
        console.log('MCP UI: Updating pending commands display...');
        this.updatePendingCommandsDisplay();
      } else {
        console.error('MCP UI: Command approval failed:', result);
        
        // Extract error message from the result
        let errorMessage = 'Unknown error occurred';
        if (result.message) {
          // Try to extract the actual error from the message
          const errorMatch = result.message.match(/Error executing command: Command failed:.*?\n(.*)/s);
          if (errorMatch) {
            errorMessage = errorMatch[1].trim();
          } else {
            errorMessage = result.message;
          }
        } else if (result.error) {
          errorMessage = result.error;
        }
        
        this.showToast(`Command failed: ${errorMessage}`, 'error');
        
        // Update the chat with the error message
        this.updateChatWithCommandError(commandId, errorMessage);
        
        // Remove from shown commands tracking even if it failed
        this.shownCommandIds.delete(commandId);
        
        console.log('MCP UI: Updating pending commands display...');
        this.updatePendingCommandsDisplay();
      }
    } catch (error) {
      console.error('MCP UI: Error in approveCommand:', error);
      this.showToast(`Error approving command: ${error.message}`, 'error');
    }
  }

  /**
   * Update the chat with command execution results
   * @param {string} resultMessage - The result message from command execution
   */
  updateChatWithCommandResults(resultMessage) {
    try {
      // Find the last assistant message in the chat
      const chatContainer = document.getElementById('chatContainer');
      if (!chatContainer) {
        console.error('MCP UI: Chat container not found');
        return;
      }

      const assistantMessages = chatContainer.querySelectorAll('.assistant-message');
      if (assistantMessages.length === 0) {
        console.error('MCP UI: No assistant messages found');
        return;
      }

      const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
      const responseDiv = lastAssistantMessage.querySelector('.message-response');
      
      if (!responseDiv) {
        console.error('MCP UI: Response div not found in last assistant message');
        return;
      }

      // Extract the output from the result message
      const outputMatch = resultMessage.match(/\*\*Output:\*\*\s*```\n([\s\S]*?)\n```/);
      if (outputMatch) {
        const output = outputMatch[1].trim();
        
        // Create a modern command execution results wrapper
        const resultsHtml = `
          <div class="command-execution-wrapper">
            <div class="command-execution-header">
              <div class="command-execution-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
              </div>
              <div class="command-execution-title">Command Executed Successfully</div>
              <div class="command-execution-status">✓</div>
            </div>
            <div class="command-execution-content">
              <div class="command-output-section">
                <div class="command-output-header">
                  <span class="command-output-label">Output:</span>
                </div>
                <div class="command-output-code">
                  <pre><code>${output}</code></pre>
                </div>
              </div>
            </div>
          </div>
        `;
        
        responseDiv.innerHTML += resultsHtml;
        
        // Scroll to bottom to show the results
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth',
        });
        
        console.log('MCP UI: Chat updated with command results');
      } else {
        console.warn('MCP UI: Could not extract output from result message');
      }
    } catch (error) {
      console.error('MCP UI: Error updating chat with command results:', error);
    }
  }

  /**
   * Update the chat with command execution error
   * @param {string} commandId - The command ID that failed
   * @param {string} errorMessage - The error message
   */
  updateChatWithCommandError(commandId, errorMessage) {
    try {
      // Find the last assistant message in the chat
      const chatContainer = document.getElementById('chatContainer');
      if (!chatContainer) {
        console.error('MCP UI: Chat container not found');
        return;
      }

      const assistantMessages = chatContainer.querySelectorAll('.assistant-message');
      if (assistantMessages.length === 0) {
        console.error('MCP UI: No assistant messages found');
        return;
      }

      const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
      const responseDiv = lastAssistantMessage.querySelector('.message-response');
      
      if (!responseDiv) {
        console.error('MCP UI: Response div not found in last assistant message');
        return;
      }

      // Create a modern command error results wrapper
      const errorHtml = `
        <div class="command-execution-wrapper command-execution-error">
          <div class="command-execution-header">
            <div class="command-execution-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            <div class="command-execution-title">Command Execution Failed</div>
            <div class="command-execution-status">✗</div>
          </div>
          <div class="command-execution-content">
            <div class="command-output-section">
              <div class="command-output-header">
                <span class="command-output-label">Error:</span>
              </div>
              <div class="command-output-code command-error-code">
                <pre><code>${errorMessage}</code></pre>
              </div>
            </div>
          </div>
        </div>
      `;
      
      responseDiv.innerHTML += errorHtml;
      
      // Scroll to bottom to show the results
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth',
      });
      
      console.log('MCP UI: Chat updated with command error');
    } catch (error) {
      console.error('MCP UI: Error updating chat with command error:', error);
    }
  }

  /**
   * Deny a command
   */
  async denyCommand(commandId) {
    console.log('MCP UI: denyCommand called with commandId:', commandId);
    
    try {
      // Use the HTTP client's deny method (which now uses the MCP server)
      const result = await mcpHTTPClient.denyCommand(commandId);
      
      if (result.success) {
        // Also remove from our shown commands tracking
        this.shownCommandIds.delete(commandId);
        
        // Add to denied commands tracking to prevent re-showing (with persistence)
        this.addDeniedCommand(commandId);
        
        this.showToast('Command denied', 'info');
        this.updatePendingCommandsDisplay();
        
        console.log('MCP UI: Command denied and removed from pending list');
      } else {
        console.error('MCP UI: Failed to deny command:', result.error);
        this.showToast('Error denying command', 'error');
      }
    } catch (error) {
      console.error('MCP UI: Error denying command:', error);
      this.showToast('Error denying command', 'error');
    }
  }

  /**
   * Start monitoring for pending commands
   */
  startCommandMonitoring() {
    // Check for new commands every 2 seconds
    setInterval(async () => {
      if (!this.isInitialized) return;

      try {
        const pendingCommands = await mcpHTTPClient.getPendingCommands();
        
        if (pendingCommands.success && pendingCommands.commands.length > 0) {
          // Find the most recent command that hasn't been shown yet and isn't denied
          for (const command of pendingCommands.commands) {
            if (!this.shownCommandIds.has(command.id) && !this.deniedCommandIds.has(command.id)) {
              console.log('MCP UI: Showing notification for new command:', command.id);
              this.showCommandNotification(
                command.id,
                command.command,
                command.description
              );
              this.shownCommandIds.add(command.id);
              break; // Only show one command at a time
            } else if (this.deniedCommandIds.has(command.id)) {
              console.log('MCP UI: Skipping denied command:', command.id);
              // If we find a denied command in the pending list, remove it from the server
              try {
                await mcpHTTPClient.denyCommand(command.id);
                console.log('MCP UI: Removed denied command from server:', command.id);
              } catch (error) {
                console.warn('MCP UI: Could not remove denied command from server:', error);
              }
            }
          }
        } else {
          // If no pending commands, clear our tracking to prevent stale state
          if (this.shownCommandIds.size > 0) {
            console.log('MCP UI: No pending commands, clearing shown tracking');
            this.shownCommandIds.clear();
          }
        }
      } catch (error) {
        console.error('Error monitoring commands:', error);
      }
    }, 2000);
  }

  /**
   * Show a toast notification
   */
  showToast(message, type = 'info') {
    // Use existing toast system if available, otherwise create a simple one
    if (window.showToast) {
      window.showToast(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }

  /**
   * Execute a bash command (shows notification for approval)
   * @param {string} command - The command to execute
   * @param {string} description - Description of the command
   * @returns {Promise<Object>} - Result of command execution
   */
  async executeBashCommand(command, description = '') {
    console.log('MCP UI: executeBashCommand called with:', { command, description });
    
    if (!this.isInitialized) {
      console.error('MCP UI: Not initialized');
      throw new Error('MCP UI not initialized');
    }

    try {
      console.log('MCP UI: Calling mcpHTTPClient.executeBashCommand...');
      const result = await mcpHTTPClient.executeBashCommand(command, description);
      console.log('MCP UI: mcpHTTPClient.executeBashCommand result:', result);
      
      if (result.success && result.commandId) {
        console.log('MCP UI: Command queued successfully, showing notification...');
        
        // Check if notification is already visible for this command
        const existingNotification = this.commandNotificationContainer.querySelector(`[data-command-id="${result.commandId}"]`);
        if (existingNotification) {
          console.log('MCP UI: Notification already exists for this command, skipping...');
          return {
            success: true,
            message: `Command "${command}" is already queued for approval.`
          };
        }
        
        // Show the modern command detection wrapper in the UI
        this.showCommandDetectionInUI(command);
        
        // Show notification instead of returning approval text
        this.showCommandNotification(result.commandId, command, description);
        return {
          success: true,
          message: `Command "${command}" has been queued for approval. Please check the notification in the top-right corner.`
        };
      } else {
        console.error('MCP UI: Command execution failed:', result);
        return result;
      }
    } catch (error) {
      console.error('MCP UI: Error executing bash command:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Show command detection wrapper in the UI (not in conversation history)
   * @param {string} command - The command that was detected
   */
  showCommandDetectionInUI(command) {
    try {
      // Find the last assistant message in the chat
      const chatContainer = document.getElementById('chatContainer');
      if (!chatContainer) {
        console.error('MCP UI: Chat container not found');
        return;
      }

      const assistantMessages = chatContainer.querySelectorAll('.assistant-message');
      if (assistantMessages.length === 0) {
        console.error('MCP UI: No assistant messages found');
        return;
      }

      const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
      const responseDiv = lastAssistantMessage.querySelector('.message-response');
      
      if (!responseDiv) {
        console.error('MCP UI: Response div not found in last assistant message');
        return;
      }

      // Create the modern command detection wrapper
      const commandDetectionHtml = `
        <div class="command-detection-wrapper">
          <div class="command-detection-header">
            <div class="command-detection-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            <div class="command-detection-title">Command Detected</div>
            <div class="command-detection-status">⏳</div>
          </div>
          <div class="command-detection-content">
            <div class="command-detection-message">
              <span class="command-detection-label">Command:</span>
              <code class="command-detection-command">${command}</code>
            </div>
            <div class="command-detection-note">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="margin-right: 6px;">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              Check the notification in the top-right corner to approve and execute
            </div>
          </div>
        </div>
      `;
      
      // Add the command detection wrapper to the UI
      responseDiv.innerHTML += commandDetectionHtml;
      
      // Scroll to bottom to show the new content
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth',
      });
      
      console.log('MCP UI: Command detection wrapper added to UI');
    } catch (error) {
      console.error('MCP UI: Error showing command detection in UI:', error);
    }
  }

  /**
   * Get pending commands count
   */
  getPendingCommandsCount() {
    return mcpHTTPClient.getPendingCommandsCount();
  }

  /**
   * Show command approval notification
   * @param {string} commandId - The command ID
   * @param {string} command - The command to execute
   * @param {string} description - Description of the command
   */
  showCommandNotification(commandId, command, description = '') {
    console.log('MCP UI: showCommandNotification called with:', { commandId, command, description });
    console.log('MCP UI: this.commandNotificationContainer:', this.commandNotificationContainer);
    
    if (!this.commandNotificationContainer) {
      console.error('MCP UI: commandNotificationContainer is null or undefined');
      throw new Error('Command notification container not found');
    }
    
    try {
      this.commandNotificationContainer.innerHTML = `
        <div class="mcp-notification-header">
          <div class="mcp-notification-title">
            <svg class="mcp-notification-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
            Command Approval Required
          </div>
          <button class="mcp-notification-close" data-action="close">×</button>
        </div>
        <div class="mcp-notification-content">
          ${description ? `<div class="mcp-notification-description">${description}</div>` : ''}
          <div class="mcp-notification-command">${command}</div>
        </div>
        <div class="mcp-notification-actions">
          <button class="mcp-notification-btn mcp-notification-btn-approve" data-action="approve" data-command-id="${commandId}">
            Approve & Execute
          </button>
          <button class="mcp-notification-btn mcp-notification-btn-deny" data-action="deny" data-command-id="${commandId}">
            Deny
          </button>
        </div>
      `;

      console.log('MCP UI: Setting innerHTML completed');
      this.commandNotificationContainer.classList.remove('hidden');
      console.log('MCP UI: Removed hidden class');

      // Bind notification actions
      this.bindNotificationActions();
      console.log('MCP UI: Notification actions bound');
    } catch (error) {
      console.error('MCP UI: Error in showCommandNotification:', error);
      throw error;
    }
  }

  /**
   * Hide command notification
   */
  hideCommandNotification() {
    this.commandNotificationContainer.classList.add('hidden');
  }

  /**
   * Bind notification action handlers
   */
  bindNotificationActions() {
    console.log('MCP UI: bindNotificationActions called');
    
    try {
      // Remove any existing event listeners to prevent duplicates
      const newContainer = this.commandNotificationContainer.cloneNode(true);
      this.commandNotificationContainer.parentNode.replaceChild(newContainer, this.commandNotificationContainer);
      this.commandNotificationContainer = newContainer;
      
      this.commandNotificationContainer.addEventListener('click', async (e) => {
        console.log('MCP UI: Notification click event:', e.target.dataset);
        
        const action = e.target.dataset.action;
        const commandId = e.target.dataset.commandId;

        if (action === 'close') {
          console.log('MCP UI: Close action clicked');
          this.hideCommandNotification();
        } else if (action === 'approve') {
          console.log('MCP UI: Approve action clicked for command:', commandId);
          await this.approveCommand(commandId);
          this.hideCommandNotification();
        } else if (action === 'deny') {
          console.log('MCP UI: Deny action clicked for command:', commandId);
          this.denyCommand(commandId);
          this.hideCommandNotification();
        }
      });
      
      console.log('MCP UI: Notification event listener added successfully');
    } catch (error) {
      console.error('MCP UI: Error in bindNotificationActions:', error);
      throw error;
    }
  }
}

// Create and export singleton instance
const mcpUI = new MCPUIManager();

export default mcpUI; 