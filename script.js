marked.setOptions({
    highlight: function(code, lang) {
      // If the language is valid, highlight it. Otherwise, return the unmodified code.
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return code;
    }
  });

// Auto-expanding textarea
const textarea = document.getElementById('messageInput');

textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px";
});

// Store all conversations
let conversations = [{
    id: Date.now(),
    messages: [{
        role: 'assistant',
        content: 'Hello! How can I help you today?'
    }]
}];
let currentConversationId = conversations[0].id;

function concatenateMessages() {
    const currentConversation = conversations.find(c => c.id === currentConversationId);
    if (!currentConversation) return;

    // Format the conversation with "User:" and "Assistant:" prefixes
    let content = '';
    currentConversation.messages.forEach(msg => {
        const prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
        content += prefix + msg.content + '\n\n';
    });

    return content;
}

function downloadConversation() {
    const currentConversation = conversations.find(c => c.id === currentConversationId);
    if (!currentConversation) return;

    // Format the conversation with "User:" and "Assistant:" prefixes
    let content = '';
    currentConversation.messages.forEach(msg => {
        const prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
        content += prefix + msg.content + '\n\n';
    });

    // Create a Blob containing the formatted text
    const blob = new Blob([content], { type: 'text/plain' });
    
    // Create a temporary link element to trigger the download
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    
    // Get the first user message for the filename, or use a default
    const firstUserMsg = currentConversation.messages.find(m => m.role === 'user');
    const filename = firstUserMsg 
        ? `chat-${firstUserMsg.content.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}.txt`
        : `chat-${new Date().toISOString().slice(0,10)}.txt`;
    
    a.download = filename;
    
    // Trigger the download
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

function addLoadingIndicator() {
    const container = document.getElementById('chatContainer');
    // Create the container div for the loading message
    const loadingDiv = document.createElement('div');
    loadingDiv.classList.add('loading-message');
    
    // Create an img element for the icon
    const iconImg = document.createElement('img');
    iconImg.src = 'assistant.png';
    iconImg.alt = 'Assistant loading';
    iconImg.classList.add('loading-icon');
    
    // Optionally, add some text next to the icon. (Optional)
    // const loadingText = document.createElement('span');
    // loadingText.textContent = 'Assistant is typing...';
    // loadingDiv.appendChild(iconImg);
    // loadingDiv.appendChild(loadingText);
    
    // If you prefer just the rotating icon, do:
    loadingDiv.appendChild(iconImg);
    
    // Append the loading div to the chat container
    container.appendChild(loadingDiv);
    // Scroll to the bottom
    container.scrollTop = container.scrollHeight;
    
    return loadingDiv;
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('active');
    updateConversationList();
}

function updateConversationList() {
    const list = document.getElementById('conversationList');
    list.innerHTML = '';
    
    conversations.forEach((conv, index) => {
        const item = document.createElement('div');
        item.classList.add('conversation-item');
        if (conv.id === currentConversationId) {
            item.classList.add('active');
        }
        
        // Get the first user message or use a default title
        const firstMessage = conv.messages.find(m => m.role === 'user');
        const title = firstMessage 
            ? firstMessage.content.substring(0, 30) + (firstMessage.content.length > 30 ? '...' : '')
            : `Chat ${conversations.length - index}`;
        
        item.textContent = title;
        item.onclick = () => loadConversation(conv.id);
        list.appendChild(item);
    });
}

function startNewConversation() {
    // Save current conversation in memory
    const newConversation = {
        id: Date.now(),
        messages: [{
            role: 'assistant',
            content: 'Hello! How can I help you today?'
        }]
    };
    
    conversations.unshift(newConversation);
    currentConversationId = newConversation.id;
    
    // Clear chat container and add initial message
    const container = document.getElementById('chatContainer');
    container.innerHTML = '';
    addMessage('Hello! How can I help you today?', 'assistant');
    
    // Update conversation list
    updateConversationList();
}

function addEnhancedMessage(thinkText, responseText) {
    const container = document.getElementById('chatContainer');
    const messageContainer = document.createElement('div');
    messageContainer.classList.add('message-container', 'assistant-message');

    // Create think section if available
    if (thinkText) {
        const thinkDiv = document.createElement('div');
        thinkDiv.classList.add('message-think');
        // Convert Markdown in thinkText, if needed
        thinkDiv.innerHTML = marked.parse(thinkText);
        messageContainer.appendChild(thinkDiv);
    }

    // Create response section
    const responseDiv = document.createElement('div');
    responseDiv.classList.add('message-response');
    responseDiv.innerHTML = marked.parse(responseText);

    messageContainer.appendChild(responseDiv);
    container.appendChild(messageContainer);
    container.scrollTop = container.scrollHeight;
    hljs.highlightAll();
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    const model = "deepseek-r1:7b"
    const num_ctx = 8192
    if (message) {
        // Add user message
        addMessage(message, 'user');
        
        // Save user message to current conversation
        const currentConversation = conversations.find(c => c.id === currentConversationId);
        currentConversation.messages.push({
            role: 'user',
            content: message
        });
        
        // Update conversation list to show new first message
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
        console.log(payload.messages);
        // Fetch response from server
        fetch('http://localhost:11434/v1/chat/completions', {
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
            
            // Parse the response for <think> and main content
            const thinkMatch = assistantContent.match(/<think>(.*?)<\/think>/s);
            const thinkText = thinkMatch ? thinkMatch[1].trim() : null;
            const responseText = thinkMatch 
                ? assistantContent.replace(/<think>.*?<\/think>/s, '').trim() 
                : assistantContent;

            if (thinkMatch) {
                if (thinkText) {
                    // Render using enhanced message rendering if there is think content
                    addEnhancedMessage(thinkText, responseText);
                } else {
                    // If the think tag is present but empty, render only the response text.
                    addMessage(responseText, 'assistant');
                }
            } else {
                addMessage(assistantContent, 'assistant');
            }
            
            // Save assistant response to current conversation
            currentConversation.messages.push({
                role: 'assistant',
                content: assistantContent
            });

            window.scrollTo({
                top: document.body.scrollHeight,
                behavior: 'smooth' // Optional: Add smooth scrolling effect
            });
        })
        .catch(error => {
            console.error('Error:', error);
            // Remove loading indicator on error
            loadingElement.remove();
            
            const errorMessage = 'Sorry, I encountered an error. Please try again.';
            addMessage(errorMessage, 'assistant');
            
            // Save error message to current conversation
            currentConversation.messages.push({
                role: 'assistant',
                content: errorMessage
            });
        });
        textarea.style.height = '50px';
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth' // Optional: Add smooth scrolling effect
        });
          
    }
}

function addMessage(text, sender) {
    const container = document.getElementById('chatContainer');
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `${sender}-message`);
    
    // Use marked to convert markdown to HTML
    messageDiv.innerHTML = marked.parse(text);
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
    hljs.highlightAll();
}



function loadConversation(conversationId) {
    const conversation = conversations.find(c => c.id === conversationId);
    if (conversation) {
        currentConversationId = conversation.id;
        const container = document.getElementById('chatContainer');
        container.innerHTML = '';
        conversation.messages.forEach(msg => {
        if (msg.role === 'user') {
            addMessage(msg.content, 'user');
        } else if (msg.role === 'assistant') {
            // Parse the message for the <think> section.
            const thinkMatch = msg.content.match(/<think>(.*?)<\/think>/s);
            if (thinkMatch) {
                const thinkText = thinkMatch[1].trim();
                const responseText = msg.content.replace(/<think>.*?<\/think>/s, '').trim();
                if (thinkText) {
                    addEnhancedMessage(thinkText, responseText);
                } else {
                    // If the think tag is present but empty, render only the response text.
                    addMessage(responseText, 'assistant');
                }
            } else {
                addMessage(msg.content, 'assistant');
            }
        }
    });
        
        updateConversationList();
    }
}

// Initialize conversation list
updateConversationList();

// Theme toggle functionality
function toggleTheme() {
    const htmlElement = document.documentElement;
    const themeToggleIcon = document.querySelector('.theme-toggle-icon');
    
    if (htmlElement.classList.contains('dark-mode')) {
        htmlElement.classList.remove('dark-mode');
        themeToggleIcon.src = 'moon.png';
        localStorage.setItem('theme', 'light');
    } else {
        htmlElement.classList.add('dark-mode');
        themeToggleIcon.src = 'sun.png';
        localStorage.setItem('theme', 'dark');
    }
}

function truncateConversation(currentConversation, num_ctx) {
    const messagesWithTokens = currentConversation.map(msg => {
        const wordCount = msg.content.split(/\s+/).length;
        const tokens = Math.ceil(wordCount*3); // Round up to be conservative, n_tokens = number_of_words * 3
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