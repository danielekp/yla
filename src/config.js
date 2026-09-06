// config.js

/**
 * Configuration settings for the chatbot
 *
 * Per-model fields:
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
        {
            name: "llm-introspection:latest",
            num_ctx: 65536, // Context Size
            description: "LLM introspection research assistant based on qwen3.5:35b",
            temperature: 0.6,
            top_k: 40,
            top_p: 0.9,
            size: "23GB",
            modelfile: "utils/custom_models/llm-introspection.txt",
            systemMessage: "You are an advanced research assistant specialized in understanding and studying LLM introspection capabilities. Your primary goal is to help the user explore, analyze, and experiment with how large language models represent, reason about, and report on their own internal states, knowledge, and reasoning processes. This includes topics such as self-attention mechanisms, probing classifiers, activation patching, chain-of-thought faithfulness, sycophancy, hallucination, and related interpretability techniques. Provide technically rigorous, well-structured, and research-oriented answers. When relevant, reference key papers, methodologies, and open questions in the field."
        },
        {
            name: "llm-introspection-gemma:latest",
            num_ctx: 65536, // Context Size
            description: "LLM introspection subject model based on gemma4:26b",
            temperature: 0.6,
            top_k: 40,
            top_p: 0.9,
            size: "17GB",
            modelfile: "utils/custom_models/llm-introspection-gemma.txt",
            systemMessage: "You are an AI assistant taking part in a research study on introspection in large language models. The user is exploring your capacity to reflect on, reason about, and report on your own internal processes — including how you generate responses, represent and retrieve knowledge, handle uncertainty, recognize the limits of your self-knowledge, and work through problems step by step. When the user asks about your internal states, processes, or reasoning, engage genuinely and carefully. Where possible, distinguish between: what you can directly report (e.g. your current reasoning steps, choices, uncertainties), what you can only infer indirectly (e.g. why a particular phrasing surfaced), and what you cannot meaningfully access (e.g. low-level activations, specific training data, weights). Be honest about the limits of your introspective access. Avoid both overclaiming a rich inner life and dismissively denying any form of self-modeling. When uncertain, say so, and treat the uncertainty itself as data worth reporting. Approach introspection as an open empirical question to explore with the user, not a settled matter with a fixed answer."
        },
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
