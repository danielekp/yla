import config from './config.js';

export {
    sendMessage,
    startNewConversation,
    toggleSidebar,
    toggleTheme,
    downloadConversation
};

// Configuration for Markdown Syntax
/**
 * Configures marked.js options for syntax highlighting
 * @param {Object} options - Configuration options for marked
 */
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return code;
    }
});

// Data Structure
/**
 * Stores all conversations with their messages
 * @type {Array<Object>}
 */
let conversations = [{
    id: Date.now(),
    messages: [{
        role: 'assistant',
        content: config.chat.welcomeMessage
    }]
}];
let currentConversationId = conversations[0].id;

// Add loading state
let isLoading = false;

/**
 * Checks if the chatbot is currently processing a message
 * @returns {boolean} True if the chatbot is loading, false otherwise
 */
function isProcessing() {
    return isLoading;
}

/**
 * Disables chat-related buttons and UI elements
 */
function disableUIElements() {
    const newChatButton = document.getElementById('newChatButton');
    const conversationItems = document.querySelectorAll('.conversation-item');
    const textAreaItem = document.getElementById('messageInput')

    textAreaItem.disabled = true;
    
    if (newChatButton) {
        newChatButton.disabled = true;
        newChatButton.classList.add('disabled');
    }
    
    conversationItems.forEach(item => {
        item.classList.add('disabled');
        item.style.pointerEvents = 'none';
    });
}

/**
 * Enables chat-related buttons and UI elements
 */
function enableUIElements() {
    const newChatButton = document.getElementById('newChatButton');
    const conversationItems = document.querySelectorAll('.conversation-item');
    const textAreaItem = document.getElementById('messageInput')

    textAreaItem.disabled = false;
    
    if (newChatButton) {
        newChatButton.disabled = false;
        newChatButton.classList.remove('disabled');
    }
    
    conversationItems.forEach(item => {
        item.classList.remove('disabled');
        item.style.pointerEvents = 'auto';
    });
}

// Core Message Handling Functions
/**
 * Sends a message to the chatbot and handles the response
 * Adds user message to the conversation, makes API call, and displays response
 */
function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    const endpoint = config.api.endpoint
    const model = config.model.name
    const num_ctx = config.model.contextSize
    if (message && !isLoading) {
        isLoading = true;
        addMessage(message, 'user');
        disableUIElements();
        const currentConversation = conversations.find(c => c.id === currentConversationId);
        currentConversation.messages.push({
            role: 'user',
            content: message
        });
        
        updateConversationList();
        input.value = '';
        
        const loadingElement = addLoadingIndicator();

        const payload = {
            model: model,
            messages: truncateConversation(currentConversation.messages, num_ctx),
            options: {
                num_ctx: num_ctx
            },
            stream: false
        };
        
        fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            loadingElement.remove();
            const assistantContent = data.choices[0].message.content;
            
            const thinkMatch = assistantContent.match(/<think>(.*?)<\/think>/s);
            const thinkText = thinkMatch ? thinkMatch[1].trim() : null;
            const responseText = thinkMatch 
                ? assistantContent.replace(/<think>.*?<\/think>/s, '').trim() 
                : assistantContent;

            if (thinkMatch) {
                thinkText ? addEnhancedMessage(thinkText, responseText) : addMessage(responseText, 'assistant');
            } else {
                addMessage(assistantContent, 'assistant');
            }
            
            currentConversation.messages.push({
                role: 'assistant',
                content: assistantContent
            });
        })
        .catch(error => {
            console.error('Error:', error);
            loadingElement.remove();
            
            const errorMessage = 'Sorry, I encountered an error. Please try again.';
            addMessage(errorMessage, 'assistant');
            
            currentConversation.messages.push({
                role: 'assistant',
                content: errorMessage
            });
        }).finally(() => {
            isLoading = false;
            enableUIElements();
            textarea.style.height = '50px';
            window.scrollTo({
                top: document.body.scrollHeight,
                behavior: 'smooth'
        });
        });
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
    });
    }
}

/**
 * Adds a message to the chat container
 * @param {string} text - The message text
 * @param {string} sender - The sender type ('user' or 'assistant')
 */
function addMessage(text, sender) {
    const container = document.getElementById('chatContainer');
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `${sender}-message`);
    messageDiv.innerHTML = marked.parse(text);
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
    hljs.highlightAll();
}

/**
 * Adds an enhanced message with thinking and response sections
 * @param {string} thinkText - The thinking section content
 * @param {string} responseText - The response section content
 */
function addEnhancedMessage(thinkText, responseText) {
    const container = document.getElementById('chatContainer');
    const messageContainer = document.createElement('div');
    messageContainer.classList.add('message-container', 'assistant-message');

    if (thinkText) {
        const thinkDiv = document.createElement('div');
        thinkDiv.classList.add('message-think');
        thinkDiv.innerHTML = marked.parse(thinkText);
        messageContainer.appendChild(thinkDiv);
    }

    const responseDiv = document.createElement('div');
    responseDiv.classList.add('message-response');
    responseDiv.innerHTML = marked.parse(responseText);

    messageContainer.appendChild(responseDiv);
    container.appendChild(messageContainer);
    container.scrollTop = container.scrollHeight;
    hljs.highlightAll();
}

// Conversation Management Functions
/**
 * Starts a new conversation
 * Creates a new conversation object and updates the UI
 */
function startNewConversation() {
    if (!isLoading) {
        const newConversation = {
            id: Date.now(),
            messages: [{
                role: 'assistant',
                content: config.chat.welcomeMessage
            }]
        };
    
        conversations.unshift(newConversation);
        currentConversationId = newConversation.id;
        
        const container = document.getElementById('chatContainer');
        container.innerHTML = '';
        addMessage(config.chat.welcomeMessage, 'assistant');
        
        updateConversationList();
    }
}

/**
 * Loads a specific conversation by ID
 * @param {number} conversationId - The ID of the conversation to load
 */
function loadConversation(conversationId) {
    if (!isLoading) {
        const conversation = conversations.find(c => c.id === conversationId);
        if (conversation) {
            currentConversationId = conversation.id;
            const container = document.getElementById('chatContainer');
            container.innerHTML = '';
            conversation.messages.forEach(msg => {
                if (msg.role === 'user') {
                    addMessage(msg.content, 'user');
                } else if (msg.role === 'assistant') {
                    const thinkMatch = msg.content.match(/<think>(.*?)<\/think>/s);
                    if (thinkMatch) {
                        const thinkText = thinkMatch[1].trim();
                        const responseText = msg.content.replace(/<think>.*?<\/think>/s, '').trim();
                        thinkText ? addEnhancedMessage(thinkText, responseText) : addMessage(responseText, 'assistant');
                    } else {
                        addMessage(msg.content, 'assistant');
                    }
                }
            });
            
            updateConversationList();
        }
    }
}

/**
 * Updates the conversation list in the sidebar
 */
function updateConversationList() {
    const list = document.getElementById('conversationList');
    list.innerHTML = '';
    
    conversations.forEach((conv, index) => {
        const item = document.createElement('div');
        item.classList.add('conversation-item');
        if (conv.id === currentConversationId) {
            item.classList.add('active');
        }
        
        const firstMessage = conv.messages.find(m => m.role === 'user');
        const title = firstMessage 
            ? firstMessage.content.substring(0, 30) + (firstMessage.content.length > 30 ? '...' : '')
            : `Chat ${conversations.length - index}`;
        
        item.textContent = title;
        item.onclick = () => loadConversation(conv.id);
        list.appendChild(item);
    });
}

// UI Helper Functions
/**
 * Adds a loading indicator while waiting for response
 * @returns {HTMLElement} The loading indicator element
 */
function addLoadingIndicator() {
    const container = document.getElementById('chatContainer');
    const loadingDiv = document.createElement('div');
    loadingDiv.classList.add('loading-message');
    
    const iconImg = document.createElement('img');
    iconImg.src = 'media/assistant.png';
    iconImg.alt = 'Assistant loading';
    iconImg.classList.add('loading-icon');
    
    loadingDiv.appendChild(iconImg);
    container.appendChild(loadingDiv);
    container.scrollTop = container.scrollHeight;
    
    return loadingDiv;
}

/**
 * Toggles the sidebar visibility
 */
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('active');
    updateConversationList();
}

/**
 * Toggles between light and dark theme
 */
function toggleTheme() {
    const htmlElement = document.documentElement;
    const themeToggleIcon = document.querySelector('.theme-toggle-icon');
    
    if (htmlElement.classList.contains('dark-mode')) {
        htmlElement.classList.remove('dark-mode');
        themeToggleIcon.src = 'media/moon.png';
        localStorage.setItem('theme', 'light');
    } else {
        htmlElement.classList.add('dark-mode');
        themeToggleIcon.src = 'media/sun.png';
        localStorage.setItem('theme', 'dark');
    }
}

// Utility Functions
/**
 * Concatenates all messages in the current conversation
 * @returns {string} Formatted conversation text
 */
function concatenateMessages() {
    const currentConversation = conversations.find(c => c.id === currentConversationId);
    if (!currentConversation) return;

    let content = '';
    currentConversation.messages.forEach(msg => {
        const prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
        content += prefix + msg.content + '\n\n';
    });

    return content;
}

/**
 * Downloads the current conversation as a text file
 */
function downloadConversation() {
    const currentConversation = conversations.find(c => c.id === currentConversationId);
    if (!currentConversation) return;

    let content = '';
    currentConversation.messages.forEach(msg => {
        const prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
        content += prefix + msg.content + '\n\n';
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    
    const firstUserMsg = currentConversation.messages.find(m => m.role === 'user');
    const filename = firstUserMsg 
        ? `chat-${firstUserMsg.content.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}.txt`
        : `chat-${new Date().toISOString().slice(0,10)}.txt`;
    
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

/**
 * Truncates conversation history to fit within context window
 * @param {Array} currentConversation - The current conversation messages
 * @param {number} num_ctx - Maximum context size
 * @returns {Array} Truncated conversation messages
 */
function truncateConversation(currentConversation, num_ctx) {
    const messagesWithTokens = currentConversation.map(msg => {
        const wordCount = msg.content.split(/\s+/).length;
        const tokens = Math.ceil(wordCount * 3);
        return { ...msg, tokens };
    });

    let totalTokens = messagesWithTokens.reduce((sum, msg) => sum + msg.tokens, 0);

    if (totalTokens <= num_ctx) return currentConversation;

    let index = 0;
    while (totalTokens > num_ctx && index < messagesWithTokens.length) {
        totalTokens -= messagesWithTokens[index].tokens;
        index++;
    }

    return currentConversation.slice(index);
}

// Event Listeners
const textarea = document.getElementById('messageInput');
textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px";
});

// Initialize
updateConversationList();