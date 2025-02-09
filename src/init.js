import { sendMessage, startNewConversation, toggleSidebar, toggleTheme, downloadConversation } from './logic.js';
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
        textarea.style.height = Math.min(textarea.scrollHeight, config.chat.maxInputHeight) + "px";
    });

    document.getElementById('sendButton')?.addEventListener('click', sendMessage);
    document.getElementById('newChatButton')?.addEventListener('click', startNewConversation);
    document.getElementById('toggleSidebarButton')?.addEventListener('click', toggleSidebar);
    document.getElementById('themeToggleButton')?.addEventListener('click', toggleTheme);
    document.getElementById('downloadButton')?.addEventListener('click', downloadConversation);
}

function displayWelcomeMessage() {
    const container = document.getElementById('chatContainer');
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', 'assistant-message');
    messageDiv.innerHTML = marked.parse(config.chat.welcomeMessage);
    container.appendChild(messageDiv);
}

document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    displayWelcomeMessage();
});