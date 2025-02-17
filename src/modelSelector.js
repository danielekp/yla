import config from './config.js';

export let selectedModelSettings = null;

let activeDownloads = new Map();

/**
 * Downloads a model using Ollama's pull API
 * @param {string} modelName - Name of the model to download
 * @returns {Promise} - Promise that resolves when download is complete
 */
async function downloadModel(modelName, abortController) {
    try {
        const response = await fetch('http://localhost:11434/api/pull', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: modelName }),
            signal: abortController.signal,
        });

        if (!response.ok) {
            throw new Error('Failed to start model download');
        }

        return response;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Download aborted');
            throw new Error('Download cancelled');
        }
        throw error;
    }
}

async function handleModelDownload(event, modelName) {
    event.stopPropagation();
    const card = event.target.closest('.model-card');
    const downloadButton = card.querySelector('.download-model-button');
    const progressBar = card.querySelector('.progress-bar');
    const progressContainer = card.querySelector('.download-progress');
    const statusElement = card.querySelector('.download-status');
    const cancelButton = card.querySelector('.cancel-button');

    // Initialize abort controller
    const abortController = new AbortController();
    activeDownloads.set(modelName, abortController);

    // UI updates
    downloadButton.disabled = true;
    progressContainer.style.display = 'block';
    cancelButton.style.display = 'block';
    statusElement.textContent = 'Starting download...';

    try {
        const response = await downloadModel(modelName, abortController);
        const reader = response.body.getReader();
        let totalSize = 0;
        let completedSize = 0;

        let currentDigest = null;
        let layerTotal = 0;
        let layerCompleted = 0;
        let overallProgress = 0;

        let layers = new Map(); // Track each layer's progress
        let totalAllLayers = 0;
        let completedAllLayers = 0;

        // Modify the chunk processing loop
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunks = new TextDecoder().decode(value).split('\n');
            for (const chunk of chunks) {
                if (!chunk) continue;
                try {
                    const data = JSON.parse(chunk);
                    
                    if (data.error) {
                        statusElement.textContent = `Error: ${data.error}`;
                        throw new Error(data.error);
                    }

                    const status = data.status || '';
                    
                    if (status === 'pulling manifest') {
                        statusElement.textContent = 'Fetching model information...';
                    }
                    else if (status.startsWith('pulling') || status.startsWith('downloading')) {
                        // Track progress per layer
                        if (data.digest) {
                            // Update layer information
                            if (!layers.has(data.digest)) {
                                // New layer detected
                                layers.set(data.digest, {
                                    total: data.total || 0,
                                    completed: data.completed || 0
                                });
                                totalAllLayers += data.total || 0;
                            } else {
                                // Update existing layer progress
                                const layer = layers.get(data.digest);
                                const prevCompleted = layer.completed;
                                layer.completed = data.completed || prevCompleted;
                                completedAllLayers += (layer.completed - prevCompleted);
                            }

                            // Calculate progress only when we have valid numbers
                            if (totalAllLayers > 0) {
                                const progress = Math.round((completedAllLayers / totalAllLayers) * 100);
                                progressBar.style.width = `${progress}%`;
                                statusElement.textContent = `Downloading ${formatBytes(completedAllLayers)} of ${formatBytes(totalAllLayers)} (${progress}%)`;
                            }
                        }
                    }
                    else if (status === 'success') {
                        progressBar.style.width = '100%';
                        statusElement.textContent = 'Download complete!';
                        setTimeout(() => renderModels(), 1500);
                    }
                    else {
                        statusElement.textContent = status;
                    }
                } catch (e) {
                    console.error('Error processing chunk:', e);
                    statusElement.textContent = `Error: ${e.message}`;
                    throw e;
                }
            }
        }
    } catch (error) {
        statusElement.textContent = `Error: ${error.message}`;
        progressBar.style.width = '0%';
    } finally {
        // Cleanup
        activeDownloads.delete(modelName);
        downloadButton.disabled = false;
        downloadButton.textContent = 'Download Model';
        cancelButton.style.display = 'none';
        progressContainer.style.display = 'none';
    }
}

function handleDownloadCancel(modelName) {
    const abortController = activeDownloads.get(modelName);
    if (abortController) {
        abortController.abort();
        activeDownloads.delete(modelName);
    }
}

// Helper function to format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Checks the availability of models by fetching data from an API.
 *
 * This function sends a request to the specified API endpoint to retrieve available models,
 * compares them against a list of configured models, and updates each model object with an
 * 'available' property indicating its presence in the fetched data.
 *
 * @returns {Array} An array of objects representing the models. Each object includes all
 *                  properties from the original configuration and an additional 'available'
 *                  boolean property.
 */
async function checkModelAvailability() {
    try {
        const response = await fetch(config.api.available_models);
        if (!response.ok) throw new Error('Failed to fetch models');
        
        const data = await response.json();
        const availableModels = new Set(data.data.map(m => m.id));
        
        return config.models.map(model => ({
            ...model,
            available: availableModels.has(model.name)
        }));
    } catch (error) {
        console.error('Error checking model availability:', error);
        return config.models.map(model => ({...model, available: false}));
    }
}

function handleModelSelect(model) {
    selectedModelSettings = model;
    // Hide model selector and show main content
    window.startNewConversation();
    document.getElementById('modelSelector').classList.add('hidden');
    document.querySelector('.main-content').classList.remove('hidden');
}

async function renderModels() {
    const modelsWithAvailability = await checkModelAvailability();
    const container = document.getElementById('modelCards');
    container.innerHTML = '';
    
    modelsWithAvailability.forEach(model => {
        const card = document.createElement('div');
        card.className = `model-card ${!model.available ? 'unavailable' : ''}`;
        
        // Create the main content wrapper
        const mainContent = document.createElement('div');
        mainContent.className = 'model-content';
        
        // Add the main content HTML
        mainContent.innerHTML = `
            <h3>${model.name}</h3>
            ${!model.available ? '<div class="unavailable-badge">Not Installed</div>' : ''}
            <p>${model.description || 'No description provided'}</p>
            <p>${model.size}</p>
            <div class="model-features">
                <div class="feature-item">
                    <span class="feature-label">Context Window</span>
                    <span class="feature-value">${model.num_ctx.toLocaleString()}</span>
                </div>
                <div class="feature-item">
                    <span class="feature-label">Temperature</span>
                    <span class="feature-value">${model.temperature}</span>
                </div>
                <div class="feature-item">
                    <span class="feature-label">Top K</span>
                    <span class="feature-value">${model.top_k}</span>
                </div>
                <div class="feature-item">
                    <span class="feature-label">Top P</span>
                    <span class="feature-value">${model.top_p}</span>
                </div>
            </div>
            <div class="system-message">
                <span class="system-label">System Role:</span>
                <span class="system-text">${model.systemMessage || 'No system message defined'}</span>
            </div>
        `;
        
        // Add click handler to the main content
        if (model.available) {
            mainContent.addEventListener('click', () => handleModelSelect(model));
        }
        
        // Add the main content to the card
        card.appendChild(mainContent);
        
        // Add download section for unavailable models
        if (!model.available) {
            
            const downloadSection = document.createElement('div');
            downloadSection.className = 'download-section';
            downloadSection.innerHTML = `
                <button class="download-model-button">Download Model</button>
                <div class="download-progress">
                    <div class="progress-bar"></div>
                </div>
                <div class="download-controls">
                    <div class="download-status"></div>
                    <button class="cancel-button" style="display: none;">Cancel</button>
                </div>
            `;
            
            // Add click handler to the download button
            const downloadButton = downloadSection.querySelector('.download-model-button');
            downloadButton.addEventListener('click', (e) => handleModelDownload(e, model.name));
            const cancelButton = downloadSection.querySelector('.cancel-button');
            cancelButton.addEventListener('click', (e) => {
                e.stopPropagation();
                handleDownloadCancel(model.name);
            });
            // Add the download section to the card
            card.appendChild(downloadSection);
        }
        
        container.appendChild(card);
    });
}

export {
    renderModels,
}