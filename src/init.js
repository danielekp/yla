import { sendMessage, startNewConversation, toggleSidebar, toggleTheme, downloadConversation } from './logic.js';
import { renderModels } from './modelSelector.js'
import config from './config.js';

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

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 3000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal  
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

// Error message formatter
function getErrorMessage(error) {
    if (error.name === 'AbortError') return 'Connection timeout';
    if (error.message.includes('Failed to fetch')) return 'Server offline';
    if (error.message.includes('server error')) return 'Server error';
    if (error.message.includes('Unexpected token')) return 'Invalid response';
    return 'Connection failed';
}

async function checkAPIConnection() {
    const statusElement = document.getElementById('connectionStatus');
    const statusDot = statusElement.querySelector('.status-dot');
    const statusText = statusElement.querySelector('.status-text');

    try {
        // Use fetchWithTimeout for the initial ping
        const pingResponse = await fetchWithTimeout(config.api.available_models, {
            method: 'GET',
            timeout: 3000
        });

        if (!pingResponse.ok) throw new Error('Server error');
        
        // Use fetchWithTimeout for the test request
        const testResponse = await fetchWithTimeout(config.api.endpoint, {
            method: 'POST',
            headers: config.api.headers,
            body: JSON.stringify({
                model: 'dummy',
                messages: [{role: "user", content: "ping"}]
            }),
            timeout: 5000
        });

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
        statusText.textContent = getErrorMessage(error); // Fixed here (removed 'this.')
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