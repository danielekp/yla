import {
  sendMessage,
  startNewConversation,
  toggleSidebar,
  toggleTheme,
  downloadConversation,
} from './logic.js';
import { renderModels } from './modelSelector.js';
import config from './config.js';

/**
 * Initializes all event listeners for the chat interface
 * Includes handlers for:
 * - Message input (Enter key and input sizing)
 * - Button clicks (send, new chat, sidebar toggle, theme toggle, download)
 */
function initializeEventListeners() {
  const textarea = document.getElementById('messageInput');
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 150);
    textarea.style.height = `${newHeight}px`;
    textarea.scrollTop = textarea.scrollHeight;
  });

  document.getElementById('sendButton')?.addEventListener('click', sendMessage);
  document.getElementById('newChatButton')?.addEventListener('click', startNewConversation);
  document.getElementById('toggleSidebarButton')?.addEventListener('click', toggleSidebar);
  document.getElementById('themeToggleButton')?.addEventListener('click', toggleTheme);
  document.getElementById('downloadButton')?.addEventListener('click', downloadConversation);
}

/**
 * Performs a fetch request with a timeout
 * @param {string} resource - The URL to fetch
 * @param {Object} options - Fetch options including timeout duration
 * @param {number} [options.timeout=3000] - Timeout in milliseconds
 * @returns {Promise} - Promise that resolves with the fetch response
 * @throws {Error} - Throws if the request times out or fails
 */
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 3000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

/**
 * Performs a fetch request with a timeout
 * @param {string} resource - The URL to fetch
 * @param {Object} options - Fetch options including timeout duration
 * @param {number} [options.timeout=3000] - Timeout in milliseconds
 * @returns {Promise} - Promise that resolves with the fetch response
 * @throws {Error} - Throws if the request times out or fails
 */
function getErrorMessage(error) {
  if (error.name === 'AbortError') return 'Connection timeout';
  if (error.message.includes('Failed to fetch')) return 'Server offline';
  if (error.message.includes('server error')) return 'Server error';
  if (error.message.includes('Unexpected token')) return 'Invalid response';
  return 'Connection failed';
}

/**
 * Checks API connection status and updates UI accordingly
 * Performs initial check and sets up periodic checking
 * @returns {Promise<void>}
 */
async function checkAPIConnection() {
  const statusElement = document.getElementById('connectionStatus');
  const statusDot = statusElement.querySelector('.status-dot');
  const statusText = statusElement.querySelector('.status-text');

  try {
    // Use fetchWithTimeout for the initial ping
    const pingResponse = await fetchWithTimeout(config.api.available_models, {
      method: 'GET',
      timeout: 3000,
    });

    if (!pingResponse.ok) throw new Error('Server error');

    statusElement.classList.remove('error');
    statusElement.classList.add('connected');
    statusText.textContent = 'Connected';

    const ollamaVersion = pingResponse.headers.get('ollama-version');
    if (ollamaVersion) {
      statusText.textContent = `Ollama ${ollamaVersion}`;
      setTimeout(() => {
        statusText.textContent = 'Connected';
      }, 2000);
    }
  } catch (error) {
    statusElement.classList.remove('connected');
    statusElement.classList.add('error');
    statusText.textContent = getErrorMessage(error);
    console.error('Connection error:', error);
  }
}

// Check connection on startup and every 5 minutes
checkAPIConnection();
setInterval(checkAPIConnection, 300000);

// Optional: Add click to retry
document.getElementById('connectionStatus').addEventListener('click', checkAPIConnection);

document.addEventListener('DOMContentLoaded', () => {
  initializeEventListeners();
  renderModels();
});
