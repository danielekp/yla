// config.js

/**
 * Configuration settings for the chatbot
 * @type {Object}
 */
const config = {
    // Model settings
    model: {
        name: "deepseek-r1:7b",
        contextSize: 8192  // num_ctx
    },
    
    // Chat interface settings
    chat: {
        welcomeMessage: "Hello! How can I help you today?",
        maxInputHeight: 150,  // maximum height for input textarea in pixels
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