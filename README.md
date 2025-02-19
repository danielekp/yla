# yla
![yla](src/media/assistant.png "YLA Interface Preview") 

Run your own AI chatbot locally with Ollama, ensuring data privacy and avoiding cloud breaches. This lightweight setup requires no frameworks like React - just Ollama, a simple HTTP server, and a browser.

Evaluate and experiment LLM freely, **own your AI**.

## Features
- **Local AI Control**: Select from multiple configured models
- **Privacy First**: All processing happens on your machine
- **No Cloud Dependencies**: Works completely offline
- **Model Validation**: Auto-check against installed Ollama models
- **Custom Personalities**: Create specialized assistants with Modelfiles
- **Try Different Parameters**: You can resend a message changing temperature, top_p, and top_k


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
# Choose based on your hardware
ollama pull deepseek-r1:7b   # 7B parameter version
ollama pull deepseek-r1:32b  # Medium-sized model
```

### 3. Launch Application
#### **Linux**:
```bash
chmod +x scripts/run_yla.sh
./scripts/run_yla.sh
```

#### **Windows**:
```cmd
ollama serve
python -m http.server 8000
# Open http://localhost:8000/src/yla.html
```

## Custom Model Configuration

Create and use specialized models using Ollama's Modelfiles:

1. **Create a Modelfile** in the `custom_models` directory:
```bash
# Example technical-assistant.txt
FROM deepseek-r1:7b
SYSTEM """
You are an expert technical assistant. 
Respond in markdown format with detailed explanations.
"""
PARAMETER num_ctx 32768
```

2. **Build your custom model**:
```bash
ollama create my-expert -f ./custom_models/technical-assistant.txt
```

3. **Update config.js**:
```javascript
models: [
    {
        name: "my-expert:latest",
        num_ctx: 32768,
        temperature: 0.7,
        top_k: 40,
        top_p: 0.9,
        systemMessage: "You are an expert technical assistant. 
Respond in markdown format with detailed explanations.",
        size: "4.1GB"
    }
]
```

### Configuration Reference
| Field           | Description                                  | Example       |
|-----------------|----------------------------------------------|---------------|
| `name`          | Ollama model name (exact match required). Add version in case of custom models     | "my-expert:latest"   |
| `num_ctx`       | Context window size (tokens)                 | 32768         |
| `systemMessage` | Hidden behavior instructions. It does not affect the model, but it is used to show, in case of custom model, the SYSTEM message defined in the creation phase               | "You are an expert technical assistant. 
Respond in markdown format with detailed explanations."  |
| `temperature`   | Response creativity                          | 0.3-1.8       |

> **_NOTE:_**  For custom models remember to add the version (_:latest_ by default) in the config.

## Configuration Example
```javascript
// config.js
const config = {
    models: [
        {
            name: "Yla:latest",          // Must match Ollama model name
            num_ctx: 65536,         // Context window size
            temperature: 0.7,       // 0-2 (0=precise, 2=creative)
            top_k: 40,              // 1-100
            top_p: 0.9,              // 0-1
            systemMessage: "Friendly general assistant",
            size: "4.1GB"
        }
    ],
    
    api: {
        endpoint: "http://localhost:11434/v1/chat/completions",
        available_models: "http://localhost:11434/v1/models",
        headers: {
            'Content-Type': 'application/json'
        }
    }
};
```

## Model Management
- **Validation**: App checks installed models on launch
- **Selection**: Choose model from initial carousel
- **Persistence**: Selected model remembered until page refresh
- **Visual Feedback**: 
  - ✅ Available models - full color, clickable
  - ⚠️ Missing models - grayed out with warning

> **Note**: Model names in config.js must exactly match Ollama model names. Use `ollama list` to verify installed models.

## Troubleshooting
**Model Not Found**:
1. Verify model name matches Ollama's list
2. Check Ollama is running: `ollama serve`
3. Ensure model files are in `custom_models` directory

**Performance Issues**:
- Reduce `num_ctx` for smaller context windows
- Use smaller model variants (e.g., 7B instead of 32B)
- Close other memory-intensive applications