# yla
![yla](src/media/assistant.png "YLA") 

Run your own AI chatbot locally with Ollama, ensuring data privacy and avoiding cloud breaches. This lightweight setup requires no frameworks like React - just Ollama, a simple HTTP server, and a browser.

Evaluate and experiment LLM freely, **own your AI**.

![yla](src/media/app-screen.png "YLA Interface Preview") 

## Features
- **Local AI Control**: Select from multiple configured models, and switch model at any time from the header
- **Privacy First**: All processing happens on your machine
- **No Internet Dependencies**: Works completely offline
- **Custom Personalities**: Create specialized assistants with Modelfiles
- **Explore Different Parameters**: You can resend a message changing temperature, top_p, and top_k. Every reply shows the parameters that produced it, the token count and the generation speed
- **Expand with New Models on Ollama**: When a new open-source model is deployed on Ollama server, you can download it and use it right away.
- **Visualize Reasoning**: The reasoning of thinking models (DeepSeek, Qwen, Gemma, gpt-oss, ...) is streamed live in a collapsible panel above the answer, using Ollama's native `think` API
- **Stay in Control**: Stop a generation at any time, retry after an error, and keep the partial answer when a request is interrupted
- **Markdown Rendering**: Headings, lists (nested), tables, code blocks with language label, quotes and links (opened in a new tab)


## Installation

### 1. Install Ollama
#### **Linux**:
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

#### **Windows**:
Download from [Ollama Windows Preview](https://ollama.com/download)

### 2. Setup Base Models

```bash
# Start Ollama server locally
ollama serve
```
> Ollama could be running in background, so the previous command could fail. Please check if it running at the default url _localhost:11434_



```bash
# Choose based on your hardware
ollama pull deepseek-r1:7b   # 7B parameter version
ollama pull deepseek-r1:32b  # Medium-sized model
```

Check Ollama list of avaiable models [here](https://ollama.com/search).

> Models can also be downloaded from Yla interface, but you have to specify the name in the config file.

### 3. Launch Application
#### **Linux**:
```bash
chmod +x utils/run-yla.sh
./utils/run-yla.sh
```
> Default script uses Chromium in incognito mode, so conversations are discarded when the window is closed. Edit the script if you want to use a different browser or keep your chat history (remove `--incognito`).
> The script can be started from any directory, e.g. from the desktop entry in `utils/yla.desktop` (adjust the paths in that file to your clone).

#### **Windows**:
```cmd
ollama serve
python -m http.server 8000
# Open http://localhost:8000/src/yla.html on your browser
```

## Custom Model Configuration

Create and use specialized models using Ollama's Modelfiles:

1. **Create a Modelfile** in the `utils/custom_models` directory:
```bash
# Example utils/custom_models/technical-assistant.txt
FROM deepseek-r1:7b
SYSTEM """
You are an expert technical assistant. 
Respond in markdown format with detailed explanations.
"""
PARAMETER num_ctx 32768
```

2. **Build your custom model** (from the root of the project):
```bash
ollama create my-expert -f ./utils/custom_models/technical-assistant.txt
```

3. **Add it to config.js**:
```javascript
models: [
    {
        name: "my-expert:latest",
        description: "smart coding assistant",
        num_ctx: 32768,
        temperature: 0.7,
        top_k: 40,
        top_p: 0.9,
        systemMessage: "You are an expert technical assistant. Respond in markdown format with detailed explanations.",
        size: "4.1GB",
        modelfile: "utils/custom_models/technical-assistant.txt"
    }
]
```

### Configuration Reference
| Field           | Description                                  | Example       |
|-----------------|----------------------------------------------|---------------|
| `name`          | Ollama model name (exact match required). Add version in case of custom models     | "my-expert:latest"   |
| `description`   | Brief description (optional)     | "smart coding assistant"   |
| `size`          | Size of the model. Used only to add the information on the model panel                 | "4.1GB" 
| `num_ctx`       | Context window size (tokens). Sent to Ollama with every request and used to trim long conversations so they fit                | 32768         |
| `temperature`   | Response creativity. Sent with every request and used as default of the "Regenerate" slider | 0.3-1.8       |
| `top_k`, `top_p` | Sampling parameters. Sent with every request and used as defaults of the "Regenerate" sliders | 40, 0.9 |
| `systemMessage` | Informational copy of the SYSTEM prompt of the Modelfile. It is shown on the model card but **not** sent to the model (the Modelfile already contains it)               | "You are an expert technical assistant. Respond in markdown format with detailed explanations."  |
| `think`         | Optional. `true`/`false` forces thinking on/off; `"low"`, `"medium"`, `"high"` set the effort for models that support levels (e.g. gpt-oss). When omitted, thinking is enabled for every model that reports the `thinking` capability | true |
| `modelfile`     | Optional. Path of the Modelfile used to build a custom model. When the model is not installed, the card shows the `ollama create` command instead of a Download button (custom models cannot be pulled) | "utils/custom_models/yla.txt" |

> For custom models remember to add the version (_:latest_ by default) in the config.

## Configuration Example
```javascript
// config.js
const config = {
    models: [
        {
            name: "Yla:latest",          // Must match Ollama model name
            num_ctx: 65536,              // Context window size
            temperature: 0.7,            // 0-2 (0=precise, 2=creative)
            top_k: 40,                   // 1-100
            top_p: 0.9,                  // 0-1
            systemMessage: "Friendly general assistant",
            size: "4.1GB",
            modelfile: "utils/custom_models/yla.txt"
        }
    ],
    
    api: {
        baseUrl: "http://localhost:11434", // Ollama server; every endpoint is derived from it
        keepAlive: "10m",                  // How long Ollama keeps the model loaded after a reply
        // reserveTokens: 8192,            // Tokens kept free for the reply when trimming history (default: num_ctx / 4)
    }
};
```
![yla](src/media/model-selection-screen.png "YLA Model Selection")

## Model Management
- **Validation**: App checks installed models on launch (and again with the Refresh button, or when Ollama comes back online)
- **Selection**: Choose model from initial carousel. The current model is shown in the header: click it to switch model without losing the conversation
- **Download**: If it is not present on Ollama server, it will try to pull the model from Ollama. Custom models (with a `modelfile` in the config) show the `ollama create` command to build them instead
- **Persistence**: The last used model is highlighted at the next launch. Conversations are saved in the browser (localStorage) unless the browser runs in incognito mode
- **Visual Feedback**: 
  - ✅ Available models - full color, clickable. A "Thinking" badge marks models that support reasoning
  - ⚠️ Missing models - grayed out with warning. Possibility of download
  - ❌ Ollama offline - an error panel with a Retry button, instead of misleading "not installed" badges

> **Note**: Model names in config.js must exactly match Ollama model names. Use `ollama list` to verify installed models.

## How requests are sent
Yla talks to Ollama's native `/api/chat` endpoint (not the OpenAI-compatible one, which ignores `top_k` and `num_ctx` and overrides the Modelfile temperature). Each request carries `options: {temperature, top_k, top_p, num_ctx}` from the config (or from the Regenerate sliders) and, for thinking models, `think`. The system prompt comes from the Modelfile.

The history sent with each message is trimmed to the most recent turns that fit in `num_ctx` minus a reserve for the reply (see `reserveTokens`). When older turns are left out, the reply's footer says so. Reasoning is never sent back to the model.

## Troubleshooting
**Model Not Found**:
1. Verify model name matches Ollama's list
2. Check Ollama is running: `ollama serve`
3. Ensure model files are in `utils/custom_models` directory and the model was built with `ollama create`

**Ollama offline**: the header pill turns red and the model selector shows a Retry button. The app rechecks the connection every few seconds and reloads the model list when Ollama is back.

**Performance Issues**:
- Reduce `num_ctx` for smaller context windows
- Use smaller model variants (e.g. 7B instead of 32B)
- Close other memory-intensive applications
