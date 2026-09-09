// config.js

/**
 * Configuration settings for the chatbot
 *
 * The `models` list is optional: every model installed on the Ollama server
 * is listed automatically, with its parameters and system prompt read from
 * Ollama, and custom models can be created from the "Create model" form in
 * the app. Add an entry here to offer a Download button for a model that is
 * not installed yet, or to override what Ollama reports (fields set here win).
 *
 * Per-model fields (all optional except `name`):
 *   name          Exact Ollama model name (see `ollama list`)
 *   description   Shown on the model card (optional)
 *   size          Shown on the model card (optional, informational only)
 *   num_ctx       Context window in tokens. Sent to Ollama with every request
 *                 and used to trim long conversations client-side.
 *   temperature, top_k, top_p
 *                 Default sampling parameters. Sent with every request and used
 *                 as the starting values of the "Regenerate" sliders.
 *   systemMessage Informational copy of the SYSTEM prompt baked into the
 *                 Modelfile. Displayed on the model card, not sent to the model.
 *   think         Optional. true/false to force thinking on/off, or "low",
 *                 "medium", "high" for models that support effort levels
 *                 (e.g. gpt-oss). When omitted, thinking is enabled for every
 *                 model that reports the "thinking" capability.
 *   modelfile     Optional. Path of the Modelfile used to build a custom model.
 *                 When set, a missing model shows build instructions instead of
 *                 a Download button (custom models cannot be pulled).
 *
 * @type {Object}
 */
const config = {
    // Model settings
    models: [
        // Optional entries, e.g. to offer a Download button or override server values:
        // { name: "qwen3.5:35b", num_ctx: 32768, temperature: 0.6, top_k: 40, top_p: 0.9, size: "23GB" }
    ],

    // API settings
    api: {
        // Base URL of the Ollama server. All endpoints (/api/chat, /api/tags,
        // /api/show, /api/pull, /api/version) are derived from it.
        baseUrl: "http://localhost:11434",

        // Tokens kept free for the model's reasoning and answer when trimming
        // the conversation history. Defaults to a quarter of num_ctx (min 2048).
        // reserveTokens: 8192,

        // How long Ollama keeps the model loaded after a reply ("5m", "1h", -1 = forever).
        keepAlive: "10m",
    }
};

export default config;
