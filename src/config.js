// config.js

/**
 * Configuration settings for the chatbot
 * @type {Object}
 */
const config = {
    // Model settings
    model: {
        name: "deepseek-32b_large_context",
        num_ctx: 16384, // Context Size
        temperature: 0.7,
        top_k: 40,
        top_p: 0.9,
    },
    
    // Chat interface settings
    chat: {
        welcomeMessage: "Hello! How can I help you today?",
    },
    
    // API settings
    api: {
        endpoint: "http://localhost:11434/v1/chat/completions",
        headers: {
            'Content-Type': 'application/json'
        }
    }
};

export default config;