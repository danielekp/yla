import config from './config.js';
import { selectedModelSettings } from './modelSelector.js';
import { MarkdownParser } from './parsers/markdown_parser.js';

// Data Structure
/**
 * Stores all conversations with their messages
 * @type {Array<Object>}
 */
let conversations = [];

// Add loading state
let isLoading = false;

let currentConversationId;

/**
 * Disables chat-related buttons and UI elements
 */
function disableUIElements() {
    const newChatButton = document.getElementById('newChatButton');
    const conversationItems = document.querySelectorAll('.conversation-item');
    const textAreaItem = document.getElementById('messageInput');

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

/**
 * Get message from textarea and calls the API call function
 */
function sendMessage() {
    if (!selectedModelSettings){
        console.log("Select a model!")
        return;
    }
    const temperature = selectedModelSettings.temperature;
    const top_k = selectedModelSettings.top_k;
    const top_p = selectedModelSettings.top_p;
    const input = document.getElementById('messageInput');
    input.style.height = `50px`;
    const message = input.value.trim();
    input.value = '';
    callAPI(message, temperature, top_k, top_p, true);
}

// Core Message Handling Functions
/**
 * Sends a message to the chatbot and handles the response
 * Adds user message to the conversation, makes API call, and displays response
 * @param {string} message - Message to be sent
 * @param {float} temperature - Temperature
 * @param {float} top_k - top_k
 * @param {float} top_p - top_p
 * @param {boolean} add_msg - Whether to add the message (false in case of resending)
 */
function callAPI(message, temperature, top_k, top_p, add_msg) {
    if (!selectedModelSettings){
        console.log("Select a model!")
        return;
    }
    const endpoint = config.api.endpoint;
    const model = selectedModelSettings.name;
    const num_ctx = selectedModelSettings.num_ctx;
    
    if (message && !isLoading) {
        isLoading = true;
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
        });
        const currentConversation = conversations.find(c => c.id === currentConversationId);
        if (add_msg) {
            addMessage(message, 'user');
            currentConversation.messages.push({
                role: 'user',
                content: message
            });
        }
        disableUIElements();
        updateConversationList();
        
        let responseDiv;
        let thinkDiv;
        let messageContainer;
        let currentSection = '';
        let thinkContent = '';
        let responseContent = '';

        // Create containers immediately
        messageContainer = document.createElement('div');
        messageContainer.classList.add('message-container', 'assistant-message');

        // Create think div first
        thinkDiv = document.createElement('div');
        thinkDiv.classList.add('message-think');
        const loadingIndicator = document.createElement('div');
        loadingIndicator.classList.add('think-loading');
        const iconImg = document.createElement('img');
        iconImg.src = 'media/assistant.png';
        iconImg.alt = 'Assistant thinking';
        iconImg.classList.add('loading-icon');
        loadingIndicator.appendChild(iconImg);
        const loadingText = document.createElement('span');
        loadingText.textContent = 'Thinking...';
        loadingText.classList.add('loading-text');
        loadingIndicator.appendChild(loadingText);
        thinkDiv.appendChild(loadingIndicator);
        messageContainer.appendChild(thinkDiv);

        // Create response div
        responseDiv = document.createElement('div');
        responseDiv.classList.add('message-response');
        messageContainer.appendChild(responseDiv);

        document.getElementById('chatContainer').appendChild(messageContainer);

        function processStreamChunk(content) {
            const existingLoader = thinkDiv.querySelector('.think-loading');
            if (existingLoader) {
                existingLoader.remove();
            }
            // Check for think tags in the accumulated content
            if (content.includes('<think>')) {
                currentSection = 'think';
                // Remove the opening tag
                const withoutOpenTag = content.replace('<think>', '');
                thinkContent += withoutOpenTag;
                thinkDiv.innerHTML = thinkContent;
            } else if (content.includes('</think>')) {
                currentSection = 'response';
                // Remove the closing tag and any think content
                const withoutCloseTag = content.replace('</think>', '');
                // Only add the remaining content after </think> to response
                responseContent = withoutCloseTag;
                responseDiv.innerHTML = MarkdownParser.parse(responseContent);
            } else {
                // Add content to appropriate section
                if (currentSection === 'think') {
                    thinkContent += content;
                    thinkDiv.innerHTML = thinkContent;
                } else {
                    responseContent += content;
                    responseDiv.innerHTML = MarkdownParser.parse(responseContent);
                }
            }
            messageContainer.scrollIntoView({
                behavior: 'smooth',
                block: 'end'
            });
        }

        const payload = {
            model: model,
            messages: truncateConversation(currentConversation.messages, num_ctx),
            options: {
                temperature: temperature,
                top_k: top_k,
                top_p: top_p,
            },
            stream: true  // Enable streaming
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
            return response.body.getReader();
        })
        .then(reader => {
            const decoder = new TextDecoder();
            
            function readChunk() {
                return reader.read().then(({ done, value }) => {
                    if (done) {
                        isLoading = false;
                        enableUIElements();
                        window.scrollTo({
                            top: document.body.scrollHeight,
                            behavior: 'smooth'
                        });
                        let assistantContent = '';
                        if (thinkContent) {
                            assistantContent += `<think>${thinkContent}</think>`;
                        }
                        assistantContent += responseContent;
                        
                        currentConversation.messages.push({
                            role: 'assistant',
                            content: assistantContent
                        });
                        
                        updateConversationList();
                        return;
                    }
            
                    // Process chunk
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');
                    
                    lines.forEach(line => {
                        // Skip empty lines
                        if (!line || !line.trim()) return;
                        
                        const trimmedLine = line.trim();
                        
                        // Handle the [DONE] message
                        if (trimmedLine === 'data: [DONE]') {
                            return; // Skip processing this line
                        }
                        
                        if (trimmedLine.startsWith('data: ')) {
                            let jsonStr = trimmedLine.slice(6).trim();
                            try {
                                
                                // Skip empty JSON strings
                                if (!jsonStr) return;
                                
                                const data = JSON.parse(jsonStr);
                                
                                // Handle Ollama format
                                if (data.choices && 
                                    data.choices[0] && 
                                    data.choices[0].delta && 
                                    data.choices[0].delta.content !== undefined) {
                                    
                                    const content = data.choices[0].delta.content;
                                    processStreamChunk(content);
                                }
                            } catch (e) {
                                // Only log actual errors, not the [DONE] message
                                if (jsonStr !== '[DONE]') {
                                    console.error('Error parsing JSON string:', jsonStr);
                                    console.error('Error details:', e);
                                }
                            }
                        }
                    });
            
                    return readChunk();
                });
            }            
            
            return readChunk();
        })
        .catch(error => {
            console.error('Error:', error);
            messageContainer.remove();
            
            const errorMessage = 'Sorry, I encountered an error. Please try again.';
            addMessage(errorMessage, 'assistant');
            
            currentConversation.messages.push({
                role: 'assistant',
                content: errorMessage
            });
            
            isLoading = false;
            enableUIElements();
        });
    }
}

/**
 * Adds a message to the chat container
 * @param {string} text - The message text
 * @param {string} sender - The sender type ('user' or 'assistant')
 */
function addMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `${sender}-message`);
    messageDiv.innerHTML = MarkdownParser.parse(text, { sanitize: true });
    
    if (sender === 'user') {
        addResendControls(messageDiv, text);
    }
    
    document.getElementById('chatContainer').appendChild(messageDiv);
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
        thinkDiv.innerHTML = MarkdownParser.parse(thinkText);
        messageContainer.appendChild(thinkDiv);
    }

    const responseDiv = document.createElement('div');
    responseDiv.classList.add('message-response');
    responseDiv.innerHTML = MarkdownParser.parse(responseText);

    messageContainer.appendChild(responseDiv);
    container.appendChild(messageContainer);
    container.scrollTop = container.scrollHeight;
}

// Conversation Management Functions
/**
 * Starts a new conversation
 * Creates a new conversation object and updates the UI
 */
function startNewConversation() {
    if (!selectedModelSettings){
        console.log("Select a model!")
        return;
    }
    if (!isLoading) {
        const newConversation = {
            id: Date.now(),
            messages: []
        };
        conversations.unshift(newConversation);
        currentConversationId = newConversation.id;
        
        const container = document.getElementById('chatContainer');
        container.innerHTML = '';

        const sidebar = document.getElementById('sidebar');
        if (!sidebar.classList.contains('active')) {
            sidebar.classList.add('active');
        }
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
            const input = document.getElementById('messageInput');
            input.value = ''
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

    // At least one message is always sent
    return currentConversation.slice(Math.min(index,messagesWithTokens.length-1));
}

/**
 * Creates and adds parameter controls under a user message for message resending
 * @param {HTMLElement} messageDiv - The message div element to attach controls to
 * @param {string} messageContent - The content of the message for resending
 * 
 * @example
 * const messageDiv = document.createElement('div');
 * addResendControls(messageDiv, "What is 2+2?");
 * 
 * @details
 * Controls include:
 * - Temperature (0-2): Controls randomness
 * - Top-k (1+): Limits token selection pool
 * - Top-p (0-1): Nucleus sampling threshold
 * 
 * When resend is clicked:
 * 1. Clears subsequent messages
 * 2. Updates conversation history
 * 3. Resends with new parameters
 */
function addResendControls(messageDiv, messageContent) {
    const controls = document.createElement('div');
    controls.className = 'resend-controls';
    controls.innerHTML = `
        <button class="resend-toggle">
            <svg class="settings-icon" viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1c0 .33.03.65.07.97l-2.11 1.66c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64L19.43 13Z"/>
            </svg>
        </button>
        <div class="parameter-panel">
            <div class="param-group">
                <div class="slider-header">
                    <span class="value-label">Temperature</span>
                    <span class="value-display" data-for="temp">0.7</span>
                </div>
                <input type="range" class="param-slider temp" 
                       min="0" max="2" step="0.1" value="0.7">
            </div>

            <div class="param-group">
                <div class="slider-header">
                    <span class="value-label">Top-K</span>
                    <span class="value-display" data-for="topk">40</span>
                </div>
                <input type="range" class="param-slider topk" 
                       min="1" max="100" step="1" value="40">
            </div>

            <div class="param-group">
                <div class="slider-header">
                    <span class="value-label">Top-P</span>
                    <span class="value-display" data-for="topp">0.9</span>
                </div>
                <input type="range" class="param-slider topp" 
                       min="0" max="1" step="0.01" value="0.9">
            </div>

            <button class="resend-btn">
                <svg class="refresh-icon" viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                </svg>
                Regenerate
            </button>
        </div>
    `;

    // Update sliders and their displays
    controls.querySelectorAll('.param-slider').forEach(slider => {
        const valueDisplay = controls.querySelector(`.value-display[data-for="${slider.classList[1]}"]`);
        slider.addEventListener('input', () => {
            valueDisplay.textContent = parseFloat(slider.value).toFixed(2);
        });
    });

    // Handle regenerate button click
    controls.querySelector('.resend-btn').onclick = () => {
        const temp = parseFloat(controls.querySelector('.temp').value);
        const topK = parseInt(controls.querySelector('.topk').value);
        const topP = parseFloat(controls.querySelector('.topp').value);
        
        // Remove subsequent messages
        let currentNode = messageDiv.nextSibling;
        while (currentNode) {
            const nextNode = currentNode.nextSibling;
            currentNode.remove();
            currentNode = nextNode;
        }
        
        // Update conversation history
        const currentConversation = conversations.find(c => c.id === currentConversationId);
        const messageIndex = currentConversation.messages.findIndex(m => m.content === messageContent);
        currentConversation.messages = currentConversation.messages.slice(0, messageIndex + 1);
        
        // Resend with new parameters
        callAPI(messageContent, temp, topK, topP, false);
    };

    const parameterPanel = controls.querySelector('.parameter-panel');
    messageDiv.addEventListener('mouseenter', () => {
        const rect = messageDiv.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom;
        
        // Switch to above position if less than 300px space below
        if (spaceBelow < 400) {
            parameterPanel.classList.add('above');
        } else {
            parameterPanel.classList.remove('above');
        }
    });

    messageDiv.appendChild(controls);
}

window.startNewConversation = startNewConversation;

export {
    sendMessage,
    startNewConversation,
    toggleSidebar,
    toggleTheme,
    downloadConversation,
    updateConversationList
};