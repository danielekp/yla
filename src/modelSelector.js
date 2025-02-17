import config from './config.js';

export let selectedModelSettings = null;

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
        card.innerHTML = `
            <div>
                <h3>${model.name}</h3>
                ${!model.available ? 
                    '<div class="unavailable-badge">Not Installed</div>' : ''}
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
                    <span class="system-text">${model.systemMessage}</span>
                </div>
            </div>
        `;
        if (model.available) {
            card.addEventListener('click', () => handleModelSelect(model));
        }
        container.appendChild(card);
    });
}

export {
    renderModels,
}