import config from './config.js';
import { selectedModelSettings } from './modelSelector.js';
import { MarkdownParser } from './parsers/markdown_parser.js';

/**
 * ChatApp - Main application module for local AI assistant
 */
const ChatApp = (function () {
  // ==============================
  // State Management
  // ==============================

  const StateManager = (function () {
    // Private state
    let conversations = [];
    let isLoading = false;
    let currentConversationId = null;

    // Initialize from localStorage if available
    function init() {
      try {
        const savedConversations = localStorage.getItem('yla_conversations');
        if (savedConversations) {
          conversations = JSON.parse(savedConversations);
        }

        const lastActiveConversation = localStorage.getItem('yla_current_conversation');
        if (lastActiveConversation) {
          currentConversationId = parseInt(lastActiveConversation);

          // Verify the current conversation exists in the loaded conversations
          if (!conversations.some((c) => c.id === currentConversationId)) {
            currentConversationId = conversations.length > 0 ? conversations[0].id : null;
          }
        }
      } catch (error) {
        console.error('Error loading saved conversations:', error);
        // Continue with empty conversations if loading fails
      }
    }

    // Save to localStorage
    function persistState() {
      try {
        localStorage.setItem('yla_conversations', JSON.stringify(conversations));
        if (currentConversationId) {
          localStorage.setItem('yla_current_conversation', currentConversationId.toString());
        }
      } catch (error) {
        console.error('Error saving conversations:', error);
        UIManager.showToast('Failed to save conversations', 'error');
      }
    }

    // Getters
    function getConversations() {
      return [...conversations]; // Return a copy to prevent direct mutation
    }

    function getCurrentConversation() {
      return conversations.find((c) => c.id === currentConversationId) || null;
    }

    function getCurrentConversationMessages() {
      const conversation = getCurrentConversation();
      return conversation ? [...conversation.messages] : [];
    }

    function isAppLoading() {
      return isLoading;
    }

    // Setters and modifiers
    function setLoading(loading) {
      isLoading = loading;
      // Update UI based on loading state
      if (loading) {
        UIManager.disableUIElements();
      } else {
        UIManager.enableUIElements();
      }
    }

    function createConversation() {
      const newConversation = {
        id: Date.now(),
        title: `Chat ${conversations.length + 1}`,
        messages: [],
        createdAt: new Date().toISOString(),
      };

      conversations.unshift(newConversation);
      currentConversationId = newConversation.id;
      persistState();

      return newConversation;
    }

    function setCurrentConversation(id) {
      currentConversationId = id;
      persistState();
    }

    function addMessageToCurrentConversation(message) {
        const conversation = getCurrentConversation();
        
        if (!conversation) {
          console.error('No active conversation to add message to - creating new conversation');
          const newConversation = createConversation();
          newConversation.messages.push(message);
          
          // Update title with first user message if this is the first message
          if (message.role === 'user') {
            newConversation.title =
              message.content.substring(0, 30) + (message.content.length > 30 ? '...' : '');
          }
        } else {
          // Validate message object
          if (!message || !message.role || message.content === undefined) {
            console.error('Invalid message object:', message);
            return;
          }
          
          // Add message to existing conversation
          conversation.messages.push(message);
    
          // Update title with first user message if this is the first message
          if (
            message.role === 'user' &&
            conversation.messages.filter((m) => m.role === 'user').length === 1
          ) {
            conversation.title =
              message.content.substring(0, 30) + (message.content.length > 30 ? '...' : '');
          }
        }
    
        // Make sure to persist state after adding the message
        persistState();
      }

    /**
    * Estimates the number of tokens in text with high accuracy
    * @param {string} text - The text to estimate tokens for
    * @returns {number} - Estimated token count
    */
    function estimateTokens(text) {
    if (!text) return 0;
    
    // Replace code blocks with placeholders for more accurate estimation
    const codeBlockRegex = /```[\s\S]*?```/g;
    const codeBlocks = text.match(codeBlockRegex) || [];
    
    // Handle code blocks separately (they tokenize differently)
    let codeBlockTokens = 0;
    codeBlocks.forEach(block => {
        // Code typically has higher token-to-character ratio due to tokenization of symbols
        const lines = block.split('\n').length;
        const chars = block.length;
        // Base token count plus overhead for each line and special chars
        codeBlockTokens += Math.ceil(chars / 3) + (lines * 0.5);
    });
    
    // Remove code blocks from text for separate processing
    let processedText = text.replace(codeBlockRegex, '');
    
    // Special token handling for markdown formatting
    const markdownTokens = (processedText.match(/[*_`#>-]|<\/?[a-z]+>/g) || []).length;
    
    // Accurate token estimation for normal text
    // Split by whitespace for words, but also count punctuation
    const words = processedText.split(/\s+/).filter(Boolean).length;
    const punctuation = (processedText.match(/[.,;:!?()[\]{}'"]/g) || []).length;
    
    // URLs and technical terms tend to tokenize into more tokens than regular words
    const urlsAndTechnical = (processedText.match(/https?:\/\/\S+|\b[A-Z][a-z]+[A-Z]\w+\b|\b[A-Z]{2,}\b/g) || []).length;
    
    // Calculate base token count (cl100k tokenizer averages ~1.3 tokens per word for English)
    const baseTokens = Math.ceil(words * 1.3);
    
    // Add tokens for punctuation (each typically counts as one token)
    const punctuationTokens = punctuation;
    
    // Add extra tokens for URLs and technical terms (they tokenize into more tokens)
    const technicalTokens = urlsAndTechnical * 2;
    
    // Add tokens for markdown formatting
    const formattingTokens = markdownTokens;
    
    // Return the total estimated token count
    return baseTokens + punctuationTokens + technicalTokens + formattingTokens + codeBlockTokens;
    }

    /**
     * Estimates token count for a message object
     * @param {Object} message - Message object with role and content
     * @returns {number} - Estimated token count
     */
    function estimateMessageTokens(message) {
    if (!message || !message.content) return 0;
    
    // Base token overhead for each message (role encoding, formatting)
    const roleOverhead = 4; // ~4 tokens for role encoding
    
    // Calculate content tokens
    const contentTokens = estimateTokens(message.content);
    
    // Thinking sections in assistant messages have additional tokens
    let thinkingTokens = 0;
    if (message.role === 'assistant') {
        const thinkMatch = message.content.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
        // The <think> tags themselves add tokens
        thinkingTokens = 4; // ~2 tokens for each tag
        
        // Estimate tokens in the thinking content
        const thinkContent = thinkMatch[1];
        thinkingTokens += estimateTokens(thinkContent);
        }
    }
    
    return roleOverhead + contentTokens + thinkingTokens;
    }

    /**
     * Estimates token count for an array of messages
     * @param {Array} messages - Array of message objects
     * @returns {number} - Total estimated token count
     */
    function estimateMessagesTokens(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return 0;
    
    // For message arrays, there's a small metadata overhead
    const metadataOverhead = 2;
    
    // Sum up tokens for all messages
    const messageTokens = messages.reduce((sum, message) => 
        sum + estimateMessageTokens(message), 0);
    
    return metadataOverhead + messageTokens;
    }

    /**
     * Analyzes message importance based on multiple factors
     * @param {Object} message - Message object
     * @param {Array} allMessages - All messages in conversation
     * @param {number} messageIndex - Index of the message in the conversation
     * @returns {number} - Importance score (higher = more important)
     */
    function calculateMessageImportance(message, allMessages, messageIndex) {
    if (!message || !message.content) return 0;
    
    let importance = 0;
    
    // System messages are highest priority
    if (message.role === 'system') {
        importance += 100;
    }
    
    // Recency is important (more recent = more relevant to current context)
    // Scale from 0-20 based on position
    const recencyScore = 20 * (messageIndex / Math.max(1, allMessages.length - 1));
    importance += recencyScore;
    
    // Content length can indicate information density
    // But we want to normalize this to avoid biasing too much toward verbose messages
    const contentLength = message.content.length;
    const lengthScore = Math.min(10, contentLength / 100); // Cap at 10 points
    importance += lengthScore;
    
    // Check for likely important content indicators
    const content = message.content.toLowerCase();
    
    // Questions tend to be important context
    if (content.includes('?')) {
        importance += 5;
    }
    
    // Code blocks often contain important information
    if (content.includes('```')) {
        importance += 8;
    }
    
    // Lists often contain structured, important information
    if (content.match(/(\n[*-]|\n\d+\.)/)) {
        importance += 5;
    }
    
    // Specific request indicators
    if (content.match(/\bplease\b|\bcan you\b|\bcould you\b/)) {
        importance += 3;
    }
    
    // Messages containing key information terms
    if (content.match(/\bimportant\b|\bnote\b|\bremember\b|\bkey\b|\bessential\b/)) {
        importance += 7;
    }
    
    // References to specific entities (might be important for context)
    const namedEntityCount = (content.match(/\b[A-Z][a-z]+\b/g) || []).length;
    importance += Math.min(5, namedEntityCount);
    
    return importance;
    }

    /**
     * Finds pairs of messages that should be kept together
     * @param {Array} messages - All messages in conversation
     * @returns {Object} - Map of message indices to their paired indices
     */
    function identifyMessagePairs(messages) {
    const pairs = {};
    
    for (let i = 0; i < messages.length - 1; i++) {
        // Identify user-assistant pairs (Q&A pairs)
        if (messages[i].role === 'user' && messages[i+1].role === 'assistant') {
        pairs[i] = i+1;
        pairs[i+1] = i;
        }
        
        // Identify followup clarifications
        if (i < messages.length - 2 && 
            messages[i].role === 'assistant' && 
            messages[i+1].role === 'user' && 
            messages[i+2].role === 'assistant' &&
            messages[i+1].content.length < 100) { // Short user message might be a clarification
        pairs[i+1] = i+2;
        pairs[i+2] = i+1;
        }
    }
    
    return pairs;
    }

    /**
     * Super smart function to truncate conversation history while maintaining context quality
     * @param {Array} messages - Array of message objects to truncate
     * @param {number} maxTokens - Maximum number of tokens to keep
     * @returns {Array} - Truncated array of messages
     */
    function smartTruncateConversationHistory(messages, maxTokens) {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    if (!maxTokens || maxTokens <= 0) return [];
    
    // If we're already under the token limit, return all messages
    const totalTokens = estimateMessagesTokens(messages);
    if (totalTokens <= maxTokens) return [...messages];
    
    // Always extract and keep system messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const systemTokens = estimateMessagesTokens(systemMessages);
    
    // Reserve tokens for system messages
    const remainingTokens = maxTokens - systemTokens;
    if (remainingTokens <= 0) {
        // If system messages alone exceed token limit, we need to truncate them
        // (rare case, but we should handle it)
        return smartTruncateMessages(systemMessages, maxTokens);
    }
    
    // Non-system messages for processing
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    
    // Always keep the most recent exchange (last user message and response if available)
    let recentMessages = [];
    const lastUserIndex = findLastIndex(nonSystemMessages, m => m.role === 'user');
    
    if (lastUserIndex !== -1) {
        recentMessages.push(nonSystemMessages[lastUserIndex]);
        // Include the assistant's response if it exists
        if (lastUserIndex < nonSystemMessages.length - 1 && 
            nonSystemMessages[lastUserIndex + 1].role === 'assistant') {
        recentMessages.push(nonSystemMessages[lastUserIndex + 1]);
        }
    }
    
    const recentTokens = estimateMessagesTokens(recentMessages);
    
    // Update remaining tokens after reserving for recent messages
    const remainingAfterRecent = remainingTokens - recentTokens;
    if (remainingAfterRecent <= 0) {
        // If recent messages exceed remaining tokens, we must sacrifice some content
        return [...systemMessages, ...smartTruncateMessages(recentMessages, remainingTokens)];
    }
    
    // Calculate importance scores for remaining messages
    const candidateMessages = nonSystemMessages.filter(
        (_, index) => !recentMessages.includes(nonSystemMessages[index])
    );
    
    const scoredMessages = candidateMessages.map((message, index) => ({
        message,
        originalIndex: nonSystemMessages.indexOf(message),
        importance: calculateMessageImportance(
        message, 
        nonSystemMessages, 
        nonSystemMessages.indexOf(message)
        ),
        tokens: estimateMessageTokens(message)
    }));
    
    // Identify messages that should be kept together
    const messagePairs = identifyMessagePairs(nonSystemMessages);
    
    // Sort by importance (descending)
    scoredMessages.sort((a, b) => b.importance - a.importance);
    
    // Select messages until we reach the token limit
    const selectedMessages = [];
    let usedTokens = 0;
    
    for (const scored of scoredMessages) {
        // Check if this message would exceed our remaining token budget
        if (usedTokens + scored.tokens > remainingAfterRecent) {
        continue;
        }
        
        // Add the message
        selectedMessages.push({
        message: scored.message,
        originalIndex: scored.originalIndex
        });
        usedTokens += scored.tokens;
        
        // Check if this message has a paired message we should also include
        const pairedIndex = messagePairs[scored.originalIndex];
        if (pairedIndex !== undefined && !selectedMessages.some(m => m.originalIndex === pairedIndex)) {
        const pairedMessage = nonSystemMessages[pairedIndex];
        const pairedTokens = estimateMessageTokens(pairedMessage);
        
        // Only add the paired message if we have enough tokens
        if (usedTokens + pairedTokens <= remainingAfterRecent) {
            selectedMessages.push({
            message: pairedMessage,
            originalIndex: pairedIndex
            });
            usedTokens += pairedTokens;
        }
        }
    }
    
    // Sort selected messages by their original order
    selectedMessages.sort((a, b) => a.originalIndex - b.originalIndex);
    
    // Combine system, selected, and recent messages in the proper order
    const result = [
        ...systemMessages,
        ...selectedMessages.map(m => m.message),
        ...recentMessages
    ];
    
    return result;
    }

    /**
     * Helper function to truncate a specific set of messages to a token limit
     * @param {Array} messages - Messages to truncate
     * @param {number} maxTokens - Maximum tokens to use
     * @returns {Array} - Truncated messages
     */
    function smartTruncateMessages(messages, maxTokens) {
    if (messages.length <= 1) return messages;
    
    // If we have multiple messages, try to truncate content rather than removing messages
    const result = [...messages];
    let totalTokens = estimateMessagesTokens(result);
    
    // If we need to truncate, start with reducing content length
    if (totalTokens > maxTokens) {
        // Sort by length (descending) so we truncate the longest messages first
        const messagesByLength = [...result].sort(
        (a, b) => b.content.length - a.content.length
        );
        
        for (const message of messagesByLength) {
        if (totalTokens <= maxTokens) break;
        
        const originalMessage = result.find(m => m === message);
        if (!originalMessage) continue;
        
        const originalTokens = estimateMessageTokens(originalMessage);
        
        // Calculate how many tokens we need to save
        const tokensToSave = Math.min(
            originalTokens - 20, // Keep at least some minimal content
            totalTokens - maxTokens + 10 // +10 for safety margin
        );
        
        if (tokensToSave <= 0) continue;
        
        // Estimate characters to remove (rough approximation)
        const charsToRemove = Math.ceil(tokensToSave * 3);
        
        // Truncate the message with an indicator
        const newContent = originalMessage.content.substring(
            0, 
            originalMessage.content.length - charsToRemove
        ) + "... [truncated]";
        
        originalMessage.content = newContent;
        
        // Recalculate total tokens
        totalTokens = estimateMessagesTokens(result);
        }
    }
    
    return result;
    }

    /**
     * Helper function to find the last index of an element satisfying a predicate
     * @param {Array} array - The array to search
     * @param {Function} predicate - Function that returns true for the element to find
     * @returns {number} - The last index or -1 if not found
     */
    function findLastIndex(array, predicate) {
    for (let i = array.length - 1; i >= 0; i--) {
        if (predicate(array[i], i, array)) {
        return i;
        }
    }
    return -1;
    }

    /**
     * Truncates conversation history with consideration for conversation flow
     * @param {number} maxTokens - Maximum number of tokens to keep
     * @returns {Array} Truncated conversation history
     */
    function truncateConversationHistory(maxTokens) {
    const conversation = getCurrentConversation();
    if (!conversation) return [];
    
    return smartTruncateConversationHistory(conversation.messages, maxTokens);
    }

    function updateConversationAfterResend(messageContent) {
      const conversation = getCurrentConversation();
      if (!conversation) return;

      const messageIndex = conversation.messages.findIndex(
        (m) => m.content === messageContent && m.role === 'user'
      );

      if (messageIndex !== -1) {
        // Keep only messages up to and including the resent message
        conversation.messages = conversation.messages.slice(0, messageIndex + 1);
        persistState();
      }
    }

    // Initialize state
    init();

    /**
     * Deletes a conversation by ID
     * @param {number} conversationId - ID of the conversation to delete
     * @returns {boolean} Whether the deletion was successful
     */
    function deleteConversation(conversationId) {
      // Don't allow deleting the current conversation
      if (conversationId === currentConversationId) {
        console.warn('Cannot delete the current conversation');
        return false;
      }

      const initialLength = conversations.length;
      conversations = conversations.filter((c) => c.id !== conversationId);

      // Check if we actually removed something
      if (conversations.length !== initialLength) {
        persistState();
        return true;
      }

      return false;
    }

    // Public API
    return {
      getConversations,
      getCurrentConversation,
      getCurrentConversationMessages,
      isAppLoading,
      setLoading,
      createConversation,
      setCurrentConversation,
      addMessageToCurrentConversation,
      truncateConversationHistory,
      updateConversationAfterResend,
      deleteConversation,
      persistState,
    };
  })();

  // ==============================
  // API Service
  // ==============================

  const ApiService = (function () {
    /**
     * Calls the AI model API with the given message and parameters
     * @param {Object} options - Options for the API call
     * @param {string} options.message - Message to send
     * @param {number} options.temperature - Temperature parameter
     * @param {number} options.top_k - Top-k parameter
     * @param {number} options.top_p - Top-p parameter
     * @param {Function} options.onThinking - Callback for thinking updates
     * @param {Function} options.onResponse - Callback for response updates
     * @param {Function} options.onComplete - Callback when request is complete
     * @param {Function} options.onError - Callback for errors
     */
    async function callModel(options) {
      const {
        message,
        temperature = 0.7,
        top_k = 40,
        top_p = 0.9,
        onThinking,
        onResponse,
        onComplete,
        onError,
      } = options;
  
      // Get the current model settings from the updated interface
      const currentModel = selectedModelSettings.get();
  
      if (!currentModel) {
        onError(new Error('No model selected'));
        return;
      }
  
      const endpoint = config.api.endpoint;
      const model = currentModel.name;
      const num_ctx = currentModel.num_ctx;
  
      // Prepare conversation history - DEBUG FORMAT TO VERIFY STRUCTURE
      const messages = StateManager.truncateConversationHistory(num_ctx);
      console.log("Sending messages to API:", JSON.stringify(messages, null, 2));
  
      // Format messages properly for the API
      const formattedMessages = formatMessagesForAPI(messages);
  
      const payload = {
        model: model,
        messages: formattedMessages,
        options: {
          temperature: temperature,
          top_k: top_k,
          top_p: top_p,
        },
        stream: true,
      };
  
      // Variables to accumulate content
      let currentSection = '';
      let thinkContent = '';
      let responseContent = '';
  
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
  
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
  
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
  
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
  
          if (done) break;
  
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
  
          for (const line of lines) {
            if (!line || !line.trim()) continue;
  
            const trimmedLine = line.trim();
  
            if (trimmedLine === 'data: [DONE]') continue;
  
            if (trimmedLine.startsWith('data: ')) {
              let jsonStr = trimmedLine.slice(6).trim();
              try {
                if (!jsonStr) continue;
  
                const data = JSON.parse(jsonStr);
  
                if (
                  data.choices &&
                  data.choices[0] &&
                  data.choices[0].delta &&
                  data.choices[0].delta.content !== undefined
                ) {
                  const content = data.choices[0].delta.content;
  
                  // Process different parts of the response
                  if (content.includes('<think>')) {
                    currentSection = 'think';
                    const withoutOpenTag = content.replace('<think>', '');
                    thinkContent += withoutOpenTag;
                    onThinking && onThinking(thinkContent);
                  } else if (content.includes('</think>')) {
                    currentSection = 'response';
                    const withoutCloseTag = content.replace('</think>', '');
                    responseContent = withoutCloseTag;
                    onResponse && onResponse(responseContent);
                  } else {
                    if (currentSection === 'think') {
                      thinkContent += content;
                      onThinking && onThinking(thinkContent);
                    } else {
                      responseContent += content;
                      onResponse && onResponse(responseContent);
                    }
                  }
                }
              } catch (e) {
                // Only log actual errors, not the [DONE] message
                if (jsonStr !== '[DONE]') {
                  console.error('Error parsing JSON string:', jsonStr);
                  console.error('Error details:', e);
                }
              }
            }
          }
        }
  
        // Compose the complete assistant message
        let assistantContent = '';
        if (thinkContent) {
          assistantContent += `<think>${thinkContent}</think>`;
        }
        assistantContent += responseContent;
  
        onComplete && onComplete(assistantContent);
      } catch (error) {
        console.error('API call error:', error);
        onError && onError(error);
      }
    }
  
    /**
     * Formats messages to ensure they're properly structured for the API
     * @param {Array} messages - Array of message objects
     * @returns {Array} - Properly formatted messages for the API
     */
    function formatMessagesForAPI(messages) {
      if (!Array.isArray(messages)) return [];
      
      return messages.map(message => {
        // Create a clean message object with just role and content
        const formattedMessage = {
          role: message.role,
          content: message.content
        };
        
        // Handle special case where content might be null or undefined
        if (!formattedMessage.content) {
          formattedMessage.content = "";
        }
        
        return formattedMessage;
      });
    }
  
    return {
      callModel,
    };
  })();

  // ==============================
  // UI Manager
  // ==============================

  const UIManager = (function () {
    // DOM element cache
    const elements = {
      chatContainer: document.getElementById('chatContainer'),
      messageInput: document.getElementById('messageInput'),
      newChatButton: document.getElementById('newChatButton'),
      conversationList: document.getElementById('conversationList'),
      sidebar: document.getElementById('sidebar'),
    };

    // Toast message system
    function showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;

      document.body.appendChild(toast);
      setTimeout(() => {
        toast.classList.add('show');
      }, 10);

      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          document.body.removeChild(toast);
        }, 300);
      }, 3000);
    }

    /**
     * Disables chat-related UI elements during loading
     */
    function disableUIElements() {
      if (elements.newChatButton) {
        elements.newChatButton.disabled = true;
        elements.newChatButton.classList.add('disabled');
      }

      if (elements.messageInput) {
        elements.messageInput.disabled = true;
      }

      const conversationItems = document.querySelectorAll('.conversation-item');
      conversationItems.forEach((item) => {
        item.classList.add('disabled');
        item.style.pointerEvents = 'none';
      });
    }

    /**
     * Enables chat-related UI elements after loading
     */
    function enableUIElements() {
      if (elements.newChatButton) {
        elements.newChatButton.disabled = false;
        elements.newChatButton.classList.remove('disabled');
      }

      if (elements.messageInput) {
        elements.messageInput.disabled = false;
        elements.messageInput.focus();
      }

      const conversationItems = document.querySelectorAll('.conversation-item');
      conversationItems.forEach((item) => {
        item.classList.remove('disabled');
        item.style.pointerEvents = 'auto';
      });
    }

    /**
     * Renders a user message in the chat container
     * @param {string} text - The message text
     */
    function renderUserMessage(text) {
      const messageDiv = document.createElement('div');
      messageDiv.classList.add('message', 'user-message');
      messageDiv.innerHTML = MarkdownParser.parse(text, { sanitize: true });

      addResendControls(messageDiv, text);

      elements.chatContainer.appendChild(messageDiv);
      scrollToBottom();
    }

    /**
     * Prepares the UI for an incoming assistant message
     * @returns {Object} References to created DOM elements
     */
    function prepareAssistantMessageUI() {
      const messageContainer = document.createElement('div');
      messageContainer.classList.add('message-container', 'assistant-message');

      // Create think div first
      const thinkDiv = document.createElement('div');
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
      const responseDiv = document.createElement('div');
      responseDiv.classList.add('message-response');
      messageContainer.appendChild(responseDiv);

      elements.chatContainer.appendChild(messageContainer);
      scrollToBottom();

      return {
        container: messageContainer,
        thinkDiv: thinkDiv,
        responseDiv: responseDiv,
      };
    }

    /**
     * Updates the thinking section of an assistant message
     * @param {HTMLElement} thinkDiv - The thinking div element
     * @param {string} content - The thinking content
     */
    function updateThinkingContent(thinkDiv, content) {
      const existingLoader = thinkDiv.querySelector('.think-loading');
      if (existingLoader) {
        existingLoader.remove();
      }

      thinkDiv.innerHTML = content;
      scrollToBottom();
    }

    /**
     * Updates the response section of an assistant message
     * @param {HTMLElement} responseDiv - The response div element
     * @param {string} content - The response content
     */
    function updateResponseContent(responseDiv, content) {
      responseDiv.innerHTML = MarkdownParser.parse(content);
      scrollToBottom();
    }

    /**
     * Renders a complete assistant message with thinking and response content
     * @param {string} thinkText - The thinking content
     * @param {string} responseText - The response content
     */
    function renderAssistantMessage(thinkText, responseText) {
      const container = document.createElement('div');
      container.classList.add('message-container', 'assistant-message');

      if (thinkText) {
        const thinkDiv = document.createElement('div');
        thinkDiv.classList.add('message-think');
        thinkDiv.innerHTML = MarkdownParser.parse(thinkText);
        container.appendChild(thinkDiv);
      }

      const responseDiv = document.createElement('div');
      responseDiv.classList.add('message-response');
      responseDiv.innerHTML = MarkdownParser.parse(responseText);

      container.appendChild(responseDiv);
      elements.chatContainer.appendChild(container);
      scrollToBottom();
    }

    /**
     * Renders an error message in the chat container
     * @param {string} errorMessage - The error message to display
     */
    function renderErrorMessage(errorMessage) {
      const messageDiv = document.createElement('div');
      messageDiv.classList.add('message', 'assistant-message', 'error-message');
      messageDiv.textContent = errorMessage;
      elements.chatContainer.appendChild(messageDiv);
      scrollToBottom();
    }

    /**
     * Clears the chat container
     */
    function clearChatContainer() {
      elements.chatContainer.innerHTML = '';
    }

    /**
     * Updates the conversation list in the sidebar
     * @param {Array} conversations - Array of conversation objects
     * @param {number} currentConversationId - ID of the current active conversation
     * @param {Function} onConversationSelect - Callback for conversation selection
     */
    /**
     * Creates a model card element for the UI
     * @param {Object} model - The model data object
     * @param {Function} onSelect - Callback when a model is selected
     * @param {Function} onDownload - Callback when download is requested
     * @param {Function} onCancel - Callback when download is cancelled
     * @returns {HTMLElement} The created model card element
     */
    function updateConversationList(
      conversations,
      currentConversationId,
      onConversationSelect,
      onConversationDelete
    ) {
      const list = elements.conversationList;
      if (!list) return;

      list.innerHTML = '';

      // Global event handler for delete confirmation
      const handleDocumentClick = (e) => {
        const confirmations = document.querySelectorAll('.conversation-delete-confirm');
        if (confirmations.length === 0) return;

        // If clicked outside any confirmation UI, remove all confirmations
        let clickedInside = false;
        confirmations.forEach((confirm) => {
          if (confirm.contains(e.target) || e.target.closest('.conversation-delete-btn')) {
            clickedInside = true;
          }
        });

        if (!clickedInside) {
          confirmations.forEach((confirm) => confirm.remove());
          document.removeEventListener('click', handleDocumentClick);
        }
      };

      conversations.forEach((conv) => {
        const item = document.createElement('div');
        item.classList.add('conversation-item');
        item.dataset.conversationId = conv.id;

        if (conv.id === currentConversationId) {
          item.classList.add('active');
        }

        // Create container for conversation title
        const titleSpan = document.createElement('span');
        titleSpan.className = 'conversation-title';
        titleSpan.textContent = conv.title || `Chat ${conv.id}`;
        item.appendChild(titleSpan);

        // Create delete button (visible on hover)
        const deleteButton = document.createElement('button');
        deleteButton.className = 'conversation-delete-btn';
        deleteButton.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                `;

        // Only allow deletion of non-active conversations
        if (conv.id === currentConversationId) {
          deleteButton.classList.add('disabled');
          deleteButton.title = 'Cannot delete the active conversation';
        } else {
          deleteButton.title = 'Delete this conversation';
          deleteButton.onclick = (e) => {
            e.stopPropagation(); // Prevent triggering the conversation selection

            // Remove any existing confirmation UI first
            const existingConfirmations = document.querySelectorAll('.conversation-delete-confirm');
            existingConfirmations.forEach((el) => el.remove());

            // Create confirmation UI
            const confirmUI = document.createElement('div');
            confirmUI.className = 'conversation-delete-confirm';
            confirmUI.innerHTML = `
                            <span>Delete?</span>
                            <div class="confirm-buttons">
                                <button class="confirm-yes">Yes</button>
                                <button class="confirm-no">No</button>
                            </div>
                        `;

            // Position the confirmation UI
            item.appendChild(confirmUI);

            // Add global click handler to dismiss if clicked outside
            document.addEventListener('click', handleDocumentClick);

            // Handle confirmation buttons
            confirmUI.querySelector('.confirm-yes').addEventListener('click', (e) => {
              e.stopPropagation();
              confirmUI.remove();
              document.removeEventListener('click', handleDocumentClick);
              onConversationDelete(conv.id);
            });

            confirmUI.querySelector('.confirm-no').addEventListener('click', (e) => {
              e.stopPropagation();
              confirmUI.remove();
              document.removeEventListener('click', handleDocumentClick);
            });
          };
        }

        item.appendChild(deleteButton);

        // Set click handler for the entire item
        item.onclick = (e) => {
          // Only select conversation if not clicking the delete button or confirmation
          const isDeleteUI =
            e.target.closest('.conversation-delete-btn') ||
            e.target.closest('.conversation-delete-confirm');
          if (!isDeleteUI) {
            onConversationSelect(conv.id);
          }
        };

        list.appendChild(item);
      });
    }

    /**
     * Scrolls the chat container to the bottom
     */
    function scrollToBottom() {
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth',
      });
    }

    /**
     * Toggles the sidebar visibility
     */
    function toggleSidebar() {
      if (elements.sidebar) {
        elements.sidebar.classList.toggle('active');
        
        // Toggle the sidebar-closed class on the toggle button
        const toggleButton = document.getElementById('toggleSidebarButton');
        if (toggleButton) {
          toggleButton.classList.toggle('sidebar-closed', !elements.sidebar.classList.contains('active'));
        }
        
        // Toggle the sidebar-active class on main content for responsive layout
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
          mainContent.classList.toggle('sidebar-active', elements.sidebar.classList.contains('active'));
        }
      }
    }

    /**
     * Creates and adds parameter controls under a user message for message resending
     * @param {HTMLElement} messageDiv - The message div element to attach controls to
     * @param {string} messageContent - The content of the message for resending
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
      controls.querySelectorAll('.param-slider').forEach((slider) => {
        const valueDisplay = controls.querySelector(
          `.value-display[data-for="${slider.classList[1]}"]`
        );
        slider.addEventListener('input', () => {
          valueDisplay.textContent = parseFloat(slider.value).toFixed(2);
        });
      });

      // Handle panel positioning
      messageDiv.addEventListener('mouseenter', () => {
        const rect = messageDiv.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom;

        // Position panel above if not enough space below
        const parameterPanel = controls.querySelector('.parameter-panel');
        if (spaceBelow < 400) {
          parameterPanel.classList.add('above');
        } else {
          parameterPanel.classList.remove('above');
        }
      });

      // Handle regenerate button click
      controls.querySelector('.resend-btn').addEventListener('click', () => {
        if (StateManager.isAppLoading()) {
          return; // Prevent resend during loading
        }

        const temp = parseFloat(controls.querySelector('.temp').value);
        const topK = parseInt(controls.querySelector('.topk').value);
        const topP = parseFloat(controls.querySelector('.topp').value);

        // Remove subsequent messages in UI
        let currentNode = messageDiv.nextSibling;
        while (currentNode) {
          const nextNode = currentNode.nextSibling;
          currentNode.remove();
          currentNode = nextNode;
        }

        // Update conversation history in state
        StateManager.updateConversationAfterResend(messageContent);

        // Resend message
        ChatController.resendMessage(messageContent, temp, topK, topP);
      });

      messageDiv.appendChild(controls);
    }

    // Helper functions for theme
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

    // Initialize UI
    function init() {
      // Set initial theme based on localStorage
      const savedTheme = localStorage.getItem('theme') || 'light';
      if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark-mode');
        const themeToggleIcon = document.querySelector('.theme-toggle-icon');
        if (themeToggleIcon) {
          themeToggleIcon.src = 'media/sun.png';
        }
      }

      // Add debounce to textarea height adjustment
      if (elements.messageInput) {
        elements.messageInput.addEventListener(
          'input',
          debounce(function () {
            this.style.height = 'auto';
            const newHeight = Math.min(this.scrollHeight, 150);
            this.style.height = `${newHeight}px`;
          }, 100)
        );
      }
    }

    // Utility function for debouncing
    function debounce(func, wait) {
      let timeout;
      return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
      };
    }

    // Initialize UI on module load
    init();

    // Public API
    return {
      showToast,
      disableUIElements,
      enableUIElements,
      renderUserMessage,
      prepareAssistantMessageUI,
      updateThinkingContent,
      updateResponseContent,
      renderAssistantMessage,
      renderErrorMessage,
      clearChatContainer,
      updateConversationList,
      toggleSidebar,
      toggleTheme,
    };
  })();

  // ==============================
  // Export/Import Utilities
  // ==============================

  const ExportImportManager = (function () {
    /**
     * Downloads the current conversation as a text file
     */
    function downloadConversation() {
      const currentConversation = StateManager.getCurrentConversation();
      if (!currentConversation) {
        UIManager.showToast('No conversation to download', 'warning');
        return;
      }

      let content = '';
      currentConversation.messages.forEach((msg) => {
        // Extract thinking from assistant messages if present
        if (msg.role === 'assistant') {
          const thinkMatch = msg.content.match(/<think>(.*?)<\/think>/s);
          if (thinkMatch) {
            const thinking = thinkMatch[1].trim();
            const response = msg.content.replace(/<think>.*?<\/think>/s, '').trim();
            content += `Assistant (thinking):\n${thinking}\n\n`;
            content += `Assistant (response):\n${response}\n\n`;
          } else {
            content += `Assistant: ${msg.content}\n\n`;
          }
        } else {
          content += `User: ${msg.content}\n\n`;
        }
      });

      const blob = new Blob([content], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);

      // Generate filename based on conversation title or date
      const filename = currentConversation.title
        ? `chat-${currentConversation.title.replace(/[^a-z0-9]/gi, '_').substring(0, 30)}.txt`
        : `chat-${new Date().toISOString().slice(0, 10)}.txt`;

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      UIManager.showToast('Conversation downloaded', 'success');
    }

    return {
      downloadConversation,
    };
  })();

  // ==============================
  // Chat Controller
  // ==============================

  const ChatController = (function () {
    /**
     * Handles sending a user message
     */
    function sendMessage() {
      const currentModel = selectedModelSettings.get();
  
      if (!currentModel) {
        UIManager.showToast('Please select a model first', 'warning');
        return;
      }
  
      const temperature = currentModel.temperature;
      const top_k = currentModel.top_k;
      const top_p = currentModel.top_p;
  
      const input = document.getElementById('messageInput');
      const message = input.value.trim();
  
      if (!message || StateManager.isAppLoading()) {
        return;
      }
  
      // Reset input
      input.value = '';
      input.style.height = '50px';
  
      // Create conversation if it doesn't exist
      if (!StateManager.getCurrentConversation()) {
        StateManager.createConversation();
        UIManager.clearChatContainer();
      }
  
      // Add message to UI
      UIManager.renderUserMessage(message);
  
      // Add message to state - IMPORTANT: Do this before API call
      StateManager.addMessageToCurrentConversation({
        role: 'user',
        content: message,
      });
      
      // Call model
      processModelCall(message, temperature, top_k, top_p);
    }
  
    /**
     * Handles resending a message with different parameters
     * @param {string} message - The message to resend
     * @param {number} temperature - Temperature parameter
     * @param {number} top_k - Top-k parameter
     * @param {number} top_p - Top-p parameter
     */
    function resendMessage(message, temperature, top_k, top_p) {
      processModelCall(message, temperature, top_k, top_p, false);
    }
  
    /**
     * Processes a model call with the given parameters
     * @param {string} message - The message to send
     * @param {number} temperature - Temperature parameter
     * @param {number} top_k - Top-k parameter
     * @param {number} top_p - Top-p parameter
     * @param {boolean} addToState - Whether to add the message to state
     */
    function processModelCall(message, temperature, top_k, top_p, addToState = true) {
      // Set loading state
      StateManager.setLoading(true);
  
      // Prepare UI for assistant response
      const uiElements = UIManager.prepareAssistantMessageUI();
  
      // Call model
      ApiService.callModel({
        message,
        temperature,
        top_k,
        top_p,
        onThinking: (thinkingContent) => {
          UIManager.updateThinkingContent(uiElements.thinkDiv, thinkingContent);
        },
        onResponse: (responseContent) => {
          UIManager.updateResponseContent(uiElements.responseDiv, responseContent);
        },
        onComplete: (completeContent) => {
          // Verify we have response content
          if (!completeContent) {
            console.error("Empty response content received from API");
            completeContent = "Sorry, I couldn't generate a proper response.";
          }
  
          if (addToState) {
            // Double-check that we have a valid conversation
            if (!StateManager.getCurrentConversation()) {
              console.error("No active conversation to add message to");
              StateManager.createConversation();
            }
            
            // Add the message to the state
            StateManager.addMessageToCurrentConversation({
              role: 'assistant',
              content: completeContent,
            });
            
            // Ensure state is persisted
            StateManager.persistState();
            }
  
          // Update conversation list to reflect new messages
          updateConversationList();
  
          // Reset loading state
          StateManager.setLoading(false);
        },
        onError: (error) => {
          console.error('Error calling model:', error);
  
          // Remove the message container
          uiElements.container.remove();
  
          // Show error message
          UIManager.renderErrorMessage('Sorry, I encountered an error. Please try again.');
  
          if (addToState) {
            StateManager.addMessageToCurrentConversation({
              role: 'assistant',
              content: 'Sorry, I encountered an error. Please try again.',
            });
            
            // Ensure state is persisted after error
            StateManager.persistState();
          }
  
          // Reset loading state
          StateManager.setLoading(false);
        },
      });
    }

    /**
     * Starts a new conversation
     */
    function startNewConversation() {
      const currentModel = selectedModelSettings.get();

      if (!currentModel) {
        UIManager.showToast('Please select a model first', 'warning');
        return;
      }

      if (StateManager.isAppLoading()) {
        return; // Prevent creating new chat during loading
      }

      // Create new conversation in state
      StateManager.createConversation();

      // Clear chat container
      UIManager.clearChatContainer();

      // Ensure sidebar is visible and update list
      const sidebar = document.getElementById('sidebar');
      if (sidebar && !sidebar.classList.contains('active')) {
        sidebar.classList.add('active');
      }

      updateConversationList();

      // Focus input
      const input = document.getElementById('messageInput');
      if (input) {
        input.focus();
      }
    }

    /**
     * Loads a specific conversation
     * @param {number} conversationId - ID of the conversation to load
     */
    function loadConversation(conversationId) {
      if (StateManager.isAppLoading()) {
        return; // Prevent loading during active request
      }

      // Set current conversation in state
      StateManager.setCurrentConversation(conversationId);

      // Clear chat container
      UIManager.clearChatContainer();

      // Render conversation messages
      const conversation = StateManager.getCurrentConversation();
      if (conversation) {
        conversation.messages.forEach((msg) => {
          if (msg.role === 'user') {
            UIManager.renderUserMessage(msg.content);
          } else if (msg.role === 'assistant') {
            const thinkMatch = msg.content.match(/<think>(.*?)<\/think>/s);
            if (thinkMatch) {
              const thinkText = thinkMatch[1].trim();
              const responseText = msg.content.replace(/<think>.*?<\/think>/s, '').trim();
              UIManager.renderAssistantMessage(thinkText, responseText);
            } else {
              UIManager.renderAssistantMessage('', msg.content);
            }
          }
        });
      }

      // Update conversation list
      updateConversationList();

      // Focus input
      const input = document.getElementById('messageInput');
      if (input) {
        input.value = '';
        input.focus();
      }
    }

    /**
     * Handles deleting a conversation
     * @param {number} conversationId - ID of the conversation to delete
     */
    function deleteConversation(conversationId) {
      const success = StateManager.deleteConversation(conversationId);
      if (success) {
        updateConversationList();
      }
    }

    /**
     * Updates the conversation list in the UI
     */
    function updateConversationList() {
      UIManager.updateConversationList(
        StateManager.getConversations(),
        StateManager.getCurrentConversation()?.id,
        loadConversation,
        deleteConversation
      );
    }

    // Initialize controller
    function init() {
      // Load conversations from localStorage
      const conversations = StateManager.getConversations();

      // Always start a new conversation when app initializes
      // We need to wait for model selection first
      if (selectedModelSettings.get()) {
        startNewConversation();
      } else {
        const checkModelInterval = setInterval(() => {
          if (selectedModelSettings.get()) {
            startNewConversation();
            clearInterval(checkModelInterval);
          }
        }, 200);

        // Clear interval after 10 seconds to prevent infinite checking
        setTimeout(() => clearInterval(checkModelInterval), 10000);
      }
    }

    // Initialize on module load
    init();

    // Public API
    return {
      sendMessage,
      resendMessage,
      startNewConversation,
      loadConversation,
      deleteConversation,
      updateConversationList,
    };
  })();

  // Public API
  return {
    sendMessage: ChatController.sendMessage,
    startNewConversation: ChatController.startNewConversation,
    toggleSidebar: UIManager.toggleSidebar,
    toggleTheme: UIManager.toggleTheme,
    downloadConversation: ExportImportManager.downloadConversation,
    updateConversationList: ChatController.updateConversationList,
  };
})();

// Export the public API
export const {
  sendMessage,
  startNewConversation,
  toggleSidebar,
  toggleTheme,
  downloadConversation,
  updateConversationList,
} = ChatApp;
