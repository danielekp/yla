import config from './config.js';

/**
 * Model Selector Module - Handles model selection, availability checking, and downloading
 */
const ModelSelector = (function() {
    // Module state
    let selectedModel = null;
    const activeDownloads = new Map();
    
    // ==============================
    // State Management
    // ==============================
    
    /**
     * Gets the current selected model settings
     * @returns {Object|null} The selected model settings or null if none selected
     */
    function getSelectedModel() {
        return selectedModel;
    }
    
    /**
     * Sets the currently selected model
     * @param {Object} model - The model settings object
     */
    function setSelectedModel(model) {
        selectedModel = model;
        // Optionally persist selection to localStorage
        try {
            localStorage.setItem('yla_selected_model', model.name);
        } catch (error) {
            console.warn('Could not save model selection to localStorage', error);
        }
    }
    
    /**
     * Attempts to restore the previously selected model from localStorage
     * @param {Array} availableModels - Array of available models
     */
    function restoreSelectedModel(availableModels) {
        try {
            const savedModelName = localStorage.getItem('yla_selected_model');
            if (savedModelName) {
                const model = availableModels.find(m => m.name === savedModelName && m.available);
                if (model) {
                    setSelectedModel(model);
                    return true;
                }
            }
        } catch (error) {
            console.warn('Error restoring model selection', error);
        }
        return false;
    }
    
    // ==============================
    // API Service
    // ==============================
    
    const ApiService = {
        /**
         * Checks which models are available on the server
         * @returns {Promise<Array>} Array of model objects with availability status
         */
        async checkModelAvailability() {
            try {
                const response = await fetch(config.api.available_models, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    },
                    timeout: 5000 // 5 second timeout
                });
                
                if (!response.ok) {
                    throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                const availableModels = new Set(data.data?.map(m => m.id) || []);
                
                return config.models.map(model => ({
                    ...model,
                    available: availableModels.has(model.name)
                }));
            } catch (error) {
                console.error('Error checking model availability:', error);
                // Return all models as unavailable when there's a server error
                return config.models.map(model => ({...model, available: false}));
            }
        },
        
        /**
         * Initiates a model download
         * @param {string} modelName - Name of the model to download
         * @param {AbortController} abortController - Controller to allow cancellation
         * @returns {Promise<Response>} The fetch response object
         */
        async downloadModel(modelName, abortController) {
            try {
                const downloadUrl = 'http://localhost:11434/api/pull';
                const response = await fetch(downloadUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        name: modelName,
                        insecure: false // Add additional params as needed
                    }),
                    signal: abortController?.signal
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    throw new Error(errorData.error || `Failed to start model download (${response.status})`);
                }
                
                return response;
            } catch (error) {
                if (error.name === 'AbortError') {
                    console.log(`Download of ${modelName} aborted by user`);
                    throw new Error('Download cancelled');
                }
                console.error(`Download error for ${modelName}:`, error);
                throw error;
            }
        }
    };
    
    // ==============================
    // Download Manager
    // ==============================
    
    const DownloadManager = {
        /**
         * Adds a download to the active downloads map
         * @param {string} modelName - The name of the model
         * @param {AbortController} controller - The abort controller for the download
         */
        addDownload(modelName, controller) {
            activeDownloads.set(modelName, controller);
        },
        
        /**
         * Removes a download from the active downloads map
         * @param {string} modelName - The name of the model
         */
        removeDownload(modelName) {
            activeDownloads.delete(modelName);
        },
        
        /**
         * Cancels an active download
         * @param {string} modelName - The name of the model to cancel
         * @returns {boolean} Whether a download was found and cancelled
         */
        cancelDownload(modelName) {
            const controller = activeDownloads.get(modelName);
            if (controller) {
                controller.abort();
                this.removeDownload(modelName);
                return true;
            }
            return false;
        },
        
        /**
         * Formats a byte size into a human-readable string
         * @param {number} bytes - The size in bytes
         * @returns {string} Formatted size string (e.g., "4.2 MB")
         */
        formatBytes(bytes) {
            if (bytes === 0) return '0 Bytes';
            if (!bytes || isNaN(bytes)) return 'Unknown size';
            
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        },
        
        /**
         * Processes download progress data from a stream
         * @param {Object} data - JSON data from the download stream
         * @param {Map} layers - Map to track layer download progress
         * @param {Object} progress - Object with totalAllLayers and completedAllLayers properties
         * @returns {Object} Updated progress object and status message
         */
        processDownloadProgress(data, layers, progress) {
            const { status, digest, total, completed } = data;
            let statusMessage = status || '';
            
            if (status === 'pulling manifest') {
                statusMessage = 'Fetching model information...';
            }
            else if ((status?.startsWith('pulling') || status?.startsWith('downloading')) && digest) {
                // Track progress per layer
                if (!layers.has(digest)) {
                    // New layer detected
                    layers.set(digest, {
                        total: total || 0,
                        completed: completed || 0
                    });
                    progress.totalAllLayers += total || 0;
                } else {
                    // Update existing layer progress
                    const layer = layers.get(digest);
                    const prevCompleted = layer.completed;
                    layer.completed = completed || prevCompleted;
                    progress.completedAllLayers += (layer.completed - prevCompleted);
                }
                
                // Calculate progress only when we have valid numbers
                if (progress.totalAllLayers > 0) {
                    const progressPercent = Math.round((progress.completedAllLayers / progress.totalAllLayers) * 100);
                    statusMessage = `Downloading ${this.formatBytes(progress.completedAllLayers)} of ${this.formatBytes(progress.totalAllLayers)} (${progressPercent}%)`;
                }
            }
            else if (status === 'success') {
                statusMessage = 'Download complete!';
                progress.completedAllLayers = progress.totalAllLayers;
            }
            
            return {
                progress,
                statusMessage,
                isComplete: status === 'success',
                isError: data.error ? data.error : false
            };
        }
    };
    
    // ==============================
    // UI Manager
    // ==============================
    
    const UIManager = {
        /**
         * Updates UI elements for a specific model card to show download progress
         * @param {Object} elements - Object containing references to UI elements
         * @param {number} progressPercent - Download progress percentage (0-100)
         * @param {string} statusMessage - Status message to display
         */
        updateDownloadProgress(elements, progressPercent, statusMessage) {
            const { progressBar, statusElement } = elements;
            
            if (progressBar) {
                progressBar.style.width = `${progressPercent}%`;
            }
            
            if (statusElement) {
                statusElement.textContent = statusMessage;
            }
        },
        
        /**
         * Sets up the UI for starting a model download
         * @param {HTMLElement} card - The model card element
         * @returns {Object} References to UI elements
         */
        setupDownloadUI(card) {
            const downloadButton = card.querySelector('.download-model-button');
            const progressBar = card.querySelector('.progress-bar');
            const progressContainer = card.querySelector('.download-progress');
            const statusElement = card.querySelector('.download-status');
            const cancelButton = card.querySelector('.cancel-button');
            
            if (downloadButton) downloadButton.disabled = true;
            if (progressContainer) progressContainer.style.display = 'block';
            if (cancelButton) cancelButton.style.display = 'block';
            if (statusElement) statusElement.textContent = 'Starting download...';
            if (progressBar) progressBar.style.width = '0%';
            
            return {
                downloadButton,
                progressBar,
                progressContainer,
                statusElement,
                cancelButton
            };
        },
        
        /**
         * Resets the UI after a download completes or fails
         * @param {Object} elements - Object containing references to UI elements
         * @param {boolean} isError - Whether the download failed
         * @param {string} errorMessage - Error message to display (if applicable)
         */
        resetDownloadUI(elements, isError = false, errorMessage = '') {
            const { downloadButton, progressBar, progressContainer, statusElement, cancelButton } = elements;
            
            if (downloadButton) {
                downloadButton.disabled = false;
                downloadButton.textContent = 'Download Model';
            }
            
            if (cancelButton) {
                cancelButton.style.display = 'none';
            }
            
            if (progressContainer) {
                // If error, keep it visible for a while to show the error message
                if (isError) {
                    setTimeout(() => {
                        if (progressContainer) progressContainer.style.display = 'none';
                    }, 5000);
                } else {
                    progressContainer.style.display = 'none';
                }
            }
            
            if (isError && statusElement) {
                statusElement.textContent = errorMessage;
                statusElement.classList.add('error');
            }
        },
        
        /**
         * Creates a model card element for the UI
         * @param {Object} model - The model data object
         * @param {Function} onSelect - Callback when a model is selected
         * @param {Function} onDownload - Callback when download is requested
         * @param {Function} onCancel - Callback when download is cancelled
         * @returns {HTMLElement} The created model card element
         */
        createModelCard(model, onSelect, onDownload, onCancel) {
            const card = document.createElement('div');
            card.className = `model-card ${!model.available ? 'unavailable' : ''}`;
            card.dataset.modelName = model.name;
            
            // Create the main content wrapper
            const mainContent = document.createElement('div');
            mainContent.className = 'model-content';
            
            // Add the main content HTML
            mainContent.innerHTML = `
                <h3>${model.name}</h3>
                ${!model.available ? '<div class="unavailable-badge">Not Installed</div>' : ''}
                <p>${model.description || ' '}</p>
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
                mainContent.addEventListener('click', () => onSelect(model));
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
                downloadButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onDownload(model.name, card);
                });
                
                const cancelButton = downloadSection.querySelector('.cancel-button');
                cancelButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onCancel(model.name);
                });
                
                // Add the download section to the card
                card.appendChild(downloadSection);
            }
            
            return card;
        }
    };
    
    // ==============================
    // Controller Functions
    // ==============================
    
    /**
     * Handles the model selection process
     * @param {Object} model - The selected model
     */
    function handleModelSelect(model) {
        setSelectedModel(model);
        
        // Update UI for selection
        const modelSelector = document.getElementById('modelSelector');
        const mainContent = document.querySelector('.main-content');
        
        if (modelSelector) modelSelector.classList.add('hidden');
        if (mainContent) mainContent.classList.remove('hidden');
        
        // When model is selected, app will automatically create a new conversation
        // because of the initialization logic in ChatController
    }
    
    /**
     * Handles the model download process
     * @param {string} modelName - Name of the model to download
     * @param {HTMLElement} card - The model card element
     */
    async function handleModelDownload(modelName, card) {
        // Create abort controller for this download
        const abortController = new AbortController();
        DownloadManager.addDownload(modelName, abortController);
        
        // Setup UI for download
        const uiElements = UIManager.setupDownloadUI(card);
        
        try {
            // Start the download
            const response = await ApiService.downloadModel(modelName, abortController);
            const reader = response.body.getReader();
            
            // Track download progress
            const layers = new Map();
            const progress = {
                totalAllLayers: 0,
                completedAllLayers: 0
            };
            
            // Process the stream
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunks = new TextDecoder().decode(value).split('\n');
                for (const chunk of chunks) {
                    if (!chunk) continue;
                    
                    try {
                        const data = JSON.parse(chunk);
                        
                        if (data.error) {
                            throw new Error(data.error);
                        }
                        
                        // Process progress data
                        const progressUpdate = DownloadManager.processDownloadProgress(
                            data, layers, progress
                        );
                        
                        // Update UI with progress
                        const progressPercent = progress.totalAllLayers > 0
                            ? Math.round((progress.completedAllLayers / progress.totalAllLayers) * 100)
                            : 0;
                            
                        UIManager.updateDownloadProgress(
                            uiElements,
                            progressPercent,
                            progressUpdate.statusMessage
                        );
                        
                        // Handle completion
                        if (progressUpdate.isComplete) {
                            UIManager.updateDownloadProgress(
                                uiElements,
                                100,
                                'Download complete!'
                            );
                            
                            // Wait a moment before refreshing the model list
                            setTimeout(() => renderModels(), 1500);
                            break;
                        }
                    } catch (e) {
                        console.error('Error processing download chunk:', e);
                        throw e;
                    }
                }
            }
        } catch (error) {
            // Handle specific error messages
            let errorMessage = error.message;
            if (errorMessage.includes("not exist")) {
                errorMessage = "This model does not exist in the Ollama library. Try a custom model.";
            } else if (error.name === 'AbortError') {
                errorMessage = "Download cancelled.";
            }
            
            // Update UI with error
            UIManager.resetDownloadUI(uiElements, true, `Error: ${errorMessage}`);
        } finally {
            // Cleanup regardless of outcome
            DownloadManager.removeDownload(modelName);
            setTimeout(() => UIManager.resetDownloadUI(uiElements), 3000);
        }
    }
    
    /**
     * Handles cancelling a model download
     * @param {string} modelName - Name of the model being downloaded
     */
    function handleDownloadCancel(modelName) {
        if (DownloadManager.cancelDownload(modelName)) {
            const card = document.querySelector(`[data-model-name="${modelName}"]`);
            if (card) {
                const progressBar = card.querySelector('.progress-bar');
                const statusElement = card.querySelector('.download-status');
                
                if (progressBar) progressBar.style.width = '0%';
                if (statusElement) statusElement.textContent = 'Download cancelled';
            }
        }
    }
    
    /**
     * Renders the model selection interface
     */
    async function renderModels() {
        try {
            const modelsWithAvailability = await ApiService.checkModelAvailability();
            const container = document.getElementById('modelCards');
            
            if (!container) {
                console.error('Model cards container not found');
                return;
            }
            
            // Clear existing cards
            container.innerHTML = '';
            
            // Create model cards
            modelsWithAvailability.forEach(model => {
                const card = UIManager.createModelCard(
                    model,
                    handleModelSelect,
                    handleModelDownload,
                    handleDownloadCancel
                );
                container.appendChild(card);
            });
            
            // Try to restore previously selected model
            const restored = restoreSelectedModel(modelsWithAvailability);
            
            // Auto-select first available model if none was restored and at least one is available
            if (!restored) {
                const firstAvailable = modelsWithAvailability.find(m => m.available);
                if (firstAvailable) {
                    // Instead of auto-selecting, we could just show a suggestion
                    console.log('Suggestion: Select model', firstAvailable.name);
                }
            }
        } catch (error) {
            console.error('Error rendering models:', error);
            // Show error in the UI
            const container = document.getElementById('modelCards');
            if (container) {
                container.innerHTML = `
                    <div class="model-error-message">
                        <h3>Error Loading Models</h3>
                        <p>Could not connect to the model server. Please check that Ollama is running.</p>
                        <button id="retryModelsButton">Retry</button>
                    </div>
                `;
                
                const retryButton = document.getElementById('retryModelsButton');
                if (retryButton) {
                    retryButton.addEventListener('click', renderModels);
                }
            }
        }
    }
    
    // Public API
    return {
        getSelectedModel,
        renderModels
    };
})();

// Export the public interface
export const selectedModelSettings = {
    get() { return ModelSelector.getSelectedModel(); }
};
export const renderModels = ModelSelector.renderModels;