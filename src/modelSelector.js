import config from './config.js';

export let selectedModelSettings = null;


function handleModelSelect(model) {
    selectedModelSettings = model;
    renderModels();
    // Hide model selector and show main content
    document.getElementById('modelSelector').classList.add('hidden');
    document.querySelector('.main-content').classList.remove('hidden');
    
    // Initialize conversation with selected model
    if (window.startNewConversation) {
        window.startNewConversation();
    }
}

function renderModels() {
    const container = document.getElementById('modelCards');
    container.innerHTML = '';
    
    config.models.forEach((model, index) => {
        const card = document.createElement('div');
        card.className = `model-card ${selectedModelSettings?.name === model.name ? 'selected' : ''}`;
        card.innerHTML = `
            <div>
                <h3>${model.name}</h3>
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

        card.addEventListener('click', () => handleModelSelect(model));
        container.appendChild(card);
    });
}

export {
    renderModels,
}