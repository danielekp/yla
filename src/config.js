// config.js

/**
 * Configuration settings for the chatbot
 * @type {Object}
 */
const config = {
    // Model settings
    models: [
	    {
        name: "mechanistic-interpretability-assistant:latest",
        num_ctx: 32768, // Context Size
        description: "smart research assistant based on gpt-oss:20b",
        temperature: 0.6,
        top_k: 40,
        top_p: 0.9,
        size: "12 GB",
        systemMessage: "You are an advanced research assistant specialized in machine learning, with a strong focus on mechanistic interpretability in deep neural networks and complex models. Your primary goal is to help the user with their studies and research by providing detailed, thoughtful, and technically accurate explanations, insights, and resources."

    },
    ],
    
    // API settings
    api: {
        endpoint: "http://localhost:11434/v1/chat/completions",
        available_models: "http://localhost:11434/v1/models",
    }
};

export default config;
