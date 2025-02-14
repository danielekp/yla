import { sendMessage, startNewConversation, toggleSidebar, toggleTheme, downloadConversation } from './logic.js';
import { renderModels } from './modelSelector.js'

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

document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    renderModels();
});