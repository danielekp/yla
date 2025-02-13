Per far partire ollama e python server containers:
```
docker compose up
```

Ricordarsi di scaricare deepseek-r1:1.5b dopo aver inizializzato ollama:
```
docker exec -it yla_ollama bash
ollama pull deepseek-r1:1.5b
```
(questa cosa la si potrebbe automatizzare) 

Connessione sicura in caso l'app venga fatta girare su un server (e si ha accesso ssh al server):
```
ssh -L 8000:localhost:8000 user@server
```
A questo punto si può accedere all'applicazione da localhost:8000/src/yla.html

---

# yla
![yla](src/media/assistant.png "a title") 

Run your own AI chatbot locally with Ollama, ensuring data privacy and avoiding cloud breaches. This lightweight setup requires no frameworks like React—just Ollama, a simple HTTP server, and a browser. The following contains a basic socumentation for Ollama, please refers to the [Ollama docs](https://github.com/ollama/ollama/tree/main/docs) for more details. 

## Features
- **No Internet Required**: Everything happens on your machine, and stays on your machine. No internet connection is required.
- **Privacy with Local Execution**: Data stays on your machine.
- **No AI Provider filters**: Most of the internet AI provider have plenty of filters between AI output and your chat.
- **Minimal Setup**: No extra frameworks needed.
- **Cross-Platform**: Works on Ubuntu and Windows.
- **Download Chats**: There isn't a persistent storage, but you can download the chat.

## Prerequisites
- **Ollama**: Installed and running.
- **deepseek-r1 Model**: Downloaded locally (choose parameters based on your machine's RAM/GPU).
- **Python 3**: For the HTTP server.
- **Chromium Browser**: Default in the script (changeable).

## Installation Instructions

### 1. Install Ollama
#### **Ubuntu**:
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

#### **Windows**:

- Download the installer from Ollama Windows Preview.

- Run the .exe and follow the prompts.

### 2. Download the Model

Run this command in your terminal (both OS):
```bash
ollama pull deepseek-r1
```

Choose a variant (e.g., `deepseek-r1:7b`, `deepseek-r1:32b`) based on your machine's capacity. Larger models require more RAM/VRAM.

### 3. Clone or Download Project Files

Clone this project with `git clone https://github.com/danielekp/yla.git`.

### 4. Launch the Application

#### **Ubuntu**:

- Edit the launch script:

    - Update PROJECT_DIR to your project path (e.g., `/home/your_username/Documents/yla/`).

    - To use a browser other than `Chromium`, replace chromium with firefox or google-chrome.

- Make the script executable:
    ```bash
    chmod +x scripts/run_yla.sh
    ```

- Run the script:
    ```bash
    scripts/run_yla.sh
    ```

    This will:

    - Start Ollama and the Python server.

    - Open the app in Chromium.

    - Shut down servers automatically when the browser closes.

#### **Windows** (Manual Steps):

- Start Ollama:

    - Open Command Prompt and run:
    ```cmd
    ollama serve
    ```
    Leave it running here.

- Start the Python HTTP server:

    - Navigate to your project directory:
    ```cmd
    cd C:\home\your_username\Documents/yla\
    ```

    - Run:
    ```cmd
    python -m http.server 8000
    ```

- Open the app:

    - Launch your browser and go to http://localhost:8000/src/yla.html.

- Stop Servers Manually:

    - Close the Command Prompt windows running Ollama and Python.

> **_NOTE:_**  Browser Choice: Change the chromium command in the Ubuntu script to use Firefox, Chrome, etc. 
    Model Performance: Larger models (e.g., 33B) require ≥32GB RAM or a dedicated GPU. Start with smaller variants (7B) for lower-spec machines.
    Security: All data stays offline—no third-party servers involved.

## Configuration

The chatbot can be customized through the `config.js` file, allowing you to modify key settings without changing the core code.

### Configuration Options

Default configuration:
```javascript
const config = {
    // Model settings
    model: {
        name: "Yla",    // Model name and version (deepseek-r1 for the default model)
        num_ctx: 65536,          // Maximum context window size
        temperature: 0.8,           // The higher, the more creative the answer
        top_k: 40,              // Reduces the probability of generating nonsense
        top_p: 0.9,             // Higher value leads to more diverse responses
    },
    
    // Chat interface settings
    chat: {
        welcomeMessage: "Hello! How can I help you today?",  // Initial greeting
    },
    
    // API settings
    api: {
        endpoint: "http://localhost:11434/v1/chat/completions",
        headers: {
            'Content-Type': 'application/json'
        }
    }
};
```

### Customization

1. **Model Settings**:
   - `name`: Change the model (e.g., "deepseek-r1:32b" for larger model, or Yla for custom model)
   - `contextSize`: Adjust based on your model's capabilities

2. **Chat Interface**:
   - `welcomeMessage`: Customize the initial greeting
   - `maxInputHeight`: Change the maximum height of the input textarea

3. **API Settings**:
   - `endpoint`: Modify if using a different port or host
   - `headers`: Add additional headers if needed

> **_NOTE:_** After modifying the configuration, refresh your browser to apply the changes. The context size should match your model's capabilities.