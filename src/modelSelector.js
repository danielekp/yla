import config from './config.js';
import { listModels, showModel, pullModel, describeError, getBaseUrl } from './ollamaClient.js';

/**
 * Model Selector Module - Handles model selection, availability checking, and downloading
 */
const ModelSelector = (function () {
  const STORAGE_KEY = 'yla_selected_model';

  let selectedModel = null;
  let renderToken = 0;
  const activeDownloads = new Map();

  // ==============================
  // State
  // ==============================

  function getSelectedModel() {
    return selectedModel;
  }

  function setSelectedModel(model) {
    selectedModel = model;
    try {
      localStorage.setItem(STORAGE_KEY, model.name);
    } catch (error) {
      console.warn('Could not save model selection to localStorage', error);
    }
  }

  function getSavedModelName() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  // ==============================
  // Data
  // ==============================

  /**
   * Returns the configured models annotated with availability and, for
   * installed models, the capabilities reported by the server.
   * Throws when the server cannot be reached.
   */
  async function fetchModels() {
    const installed = await listModels();
    const installedNames = new Set(installed.map((m) => m.name));

    const models = config.models.map((model) => ({
      ...model,
      available: installedNames.has(model.name),
    }));

    await Promise.all(
      models
        .filter((m) => m.available)
        .map(async (m) => {
          try {
            const info = await showModel(m.name);
            m.capabilities = info.capabilities;
            m.serverParameters = info.parameters;
          } catch (error) {
            console.warn(`Could not read details for ${m.name}:`, error);
          }
        })
    );

    return models;
  }

  // ==============================
  // UI
  // ==============================

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatNumber(value) {
    return typeof value === 'number' ? value.toLocaleString() : String(value ?? '–');
  }

  function buildCommand(model) {
    return `ollama create ${model.name.replace(/:latest$/, '')} -f ${model.modelfile}`;
  }

  /**
   * Creates a model card element.
   */
  function createModelCard(model, { onSelect, onDownload, onCancel, onRefresh }) {
    const card = el('div', `model-card${model.available ? '' : ' unavailable'}`);
    card.dataset.modelName = model.name;

    const content = el('div', 'model-content');
    if (model.available) {
      content.tabIndex = 0;
      content.setAttribute('role', 'button');
      content.setAttribute('aria-label', `Use model ${model.name}`);
    }

    const head = el('div', 'model-card-head');
    head.appendChild(el('h3', null, model.name));
    const badges = el('div', 'model-badges');
    if (!model.available) badges.appendChild(el('span', 'model-badge badge-missing', 'Not installed'));
    if (model.available && model.name === getSavedModelName()) {
      badges.appendChild(el('span', 'model-badge badge-last', 'Last used'));
    }
    if (model.available && Array.isArray(model.capabilities)) {
      if (model.capabilities.includes('thinking') && model.think !== false) {
        badges.appendChild(el('span', 'model-badge badge-thinking', 'Thinking'));
      }
      if (model.capabilities.includes('vision')) badges.appendChild(el('span', 'model-badge badge-cap', 'Vision'));
    }
    head.appendChild(badges);
    content.appendChild(head);

    if (model.description) content.appendChild(el('p', 'model-description', model.description));
    if (model.size) content.appendChild(el('p', 'model-size-line', model.size));

    const features = el('div', 'model-features');
    const feature = (label, value) => {
      const item = el('div', 'feature-item');
      item.appendChild(el('span', 'feature-label', label));
      item.appendChild(el('span', 'feature-value', value));
      return item;
    };
    const serverCtx = model.serverParameters?.num_ctx;
    features.appendChild(
      feature(
        'Context Window',
        typeof serverCtx === 'number' && serverCtx !== model.num_ctx
          ? `${formatNumber(model.num_ctx)} (Modelfile: ${formatNumber(serverCtx)})`
          : formatNumber(model.num_ctx)
      )
    );
    features.appendChild(feature('Temperature', formatNumber(model.temperature)));
    features.appendChild(feature('Top K', formatNumber(model.top_k)));
    features.appendChild(feature('Top P', formatNumber(model.top_p)));
    content.appendChild(features);

    const system = el('div', 'system-message');
    system.appendChild(el('span', 'system-label', 'System Role:'));
    system.appendChild(el('span', 'system-text', model.systemMessage || 'No system message defined'));
    content.appendChild(system);

    if (model.available) {
      content.addEventListener('click', () => onSelect(model));
      content.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(model);
        }
      });
    }
    card.appendChild(content);

    if (!model.available) {
      const section = el('div', 'download-section');
      if (model.modelfile) {
        const note = el('p', 'download-note');
        note.textContent = 'This is a custom model built from a Modelfile. Create it from the project folder, then refresh:';
        section.appendChild(note);
        const cmd = el('code', 'build-command', buildCommand(model));
        section.appendChild(cmd);
        const actions = el('div', 'download-controls');
        const copy = el('button', 'secondary-button', 'Copy command');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(buildCommand(model));
            copy.textContent = 'Copied';
            setTimeout(() => (copy.textContent = 'Copy command'), 1500);
          } catch {
            copy.textContent = 'Copy failed';
          }
        });
        const refresh = el('button', 'secondary-button', 'Check again');
        refresh.type = 'button';
        refresh.addEventListener('click', () => onRefresh());
        actions.append(copy, refresh);
        section.appendChild(actions);
      } else {
        const button = el('button', 'download-model-button', 'Download Model');
        button.type = 'button';
        const progress = el('div', 'download-progress');
        progress.appendChild(el('div', 'progress-bar'));
        const controls = el('div', 'download-controls');
        const status = el('div', 'download-status');
        status.setAttribute('aria-live', 'polite');
        const cancel = el('button', 'cancel-button hidden', 'Cancel');
        cancel.type = 'button';
        controls.append(status, cancel);
        section.append(button, progress, controls);

        // A pull started from an earlier render is still running: show its state.
        const active = activeDownloads.get(model.name);
        if (active) {
          button.disabled = true;
          progress.classList.add('visible');
          cancel.classList.remove('hidden');
          progress.firstChild.style.width = `${active.percent || 0}%`;
          status.textContent = active.text || 'Downloading…';
        }

        button.addEventListener('click', (e) => {
          e.stopPropagation();
          onDownload(model.name, card);
        });
        cancel.addEventListener('click', (e) => {
          e.stopPropagation();
          onCancel(model.name);
        });
      }
      card.appendChild(section);
    }

    return card;
  }

  function downloadElements(card) {
    return {
      button: card.querySelector('.download-model-button'),
      progress: card.querySelector('.download-progress'),
      bar: card.querySelector('.progress-bar'),
      status: card.querySelector('.download-status'),
      cancel: card.querySelector('.cancel-button'),
    };
  }

  /** Elements of the card currently shown for a model (cards are re-rendered). */
  function currentDownloadUI(modelName) {
    const selector = `.model-card[data-model-name="${window.CSS?.escape ? CSS.escape(modelName) : modelName}"]`;
    const card = document.querySelector(selector);
    return card ? downloadElements(card) : null;
  }

  function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function formatBytes(bytes) {
    if (!bytes || !Number.isFinite(bytes)) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function setHint(text, isError = false) {
    const hint = document.getElementById('modelSelectorHint');
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle('error', isError);
  }

  // ==============================
  // Controller
  // ==============================

  function hideSelector() {
    document.getElementById('modelSelector')?.classList.add('hidden');
    document.querySelector('.main-content')?.classList.remove('hidden');
  }

  function showModelSelector() {
    document.getElementById('modelSelector')?.classList.remove('hidden');
    document.querySelector('.main-content')?.classList.add('hidden');
    renderModels();
  }

  function isSelectorVisible() {
    const selector = document.getElementById('modelSelector');
    return !!selector && !selector.classList.contains('hidden');
  }

  function handleModelSelect(model) {
    setSelectedModel(model);
    hideSelector();
    document.dispatchEvent(new CustomEvent('yla:model-selected', { detail: model }));
  }

  async function handleModelDownload(modelName, card) {
    if (activeDownloads.has(modelName)) return;
    const controller = new AbortController();
    const state = { controller, percent: 0, text: 'Starting download…' };
    activeDownloads.set(modelName, state);

    const apply = () => {
      const ui = currentDownloadUI(modelName) || downloadElements(card);
      if (ui.button) ui.button.disabled = true;
      ui.progress?.classList.add('visible');
      ui.cancel?.classList.remove('hidden');
      ui.status?.classList.remove('error');
      if (ui.bar) ui.bar.style.width = `${state.percent}%`;
      if (ui.status) ui.status.textContent = state.text;
    };
    apply();

    try {
      await pullModel(modelName, {
        signal: controller.signal,
        onProgress: ({ status, completed, total, percent, done, layer }) => {
          state.percent = percent;
          if (done) state.text = 'Download complete';
          else if (status === 'pulling manifest') state.text = 'Fetching model information…';
          else if (layer && total > 0) {
            state.text = `Downloading ${formatBytes(completed)} of ${formatBytes(total)} (${percent}%)`;
          } else state.text = status ? `${capitalize(status)}…` : 'Downloading…';
          apply();
        },
      });
      state.text = 'Download complete';
      apply();
      setTimeout(() => renderModels(), 800);
    } catch (error) {
      let message = describeError(error);
      if (error.name === 'AbortError') message = 'Download cancelled';
      else if (/file does not exist|not found/i.test(message)) {
        message = 'This model is not in the Ollama library. Check the name in config.js, or build it with ollama create.';
      }
      activeDownloads.delete(modelName);
      const ui = currentDownloadUI(modelName) || downloadElements(card);
      if (ui.status) {
        ui.status.textContent = message;
        ui.status.classList.add('error');
      }
      if (ui.bar) ui.bar.style.width = '0%';
    } finally {
      activeDownloads.delete(modelName);
      const ui = currentDownloadUI(modelName) || downloadElements(card);
      if (ui.button) ui.button.disabled = false;
      ui.cancel?.classList.add('hidden');
      ui.progress?.classList.remove('visible');
    }
  }

  function handleDownloadCancel(modelName) {
    const state = activeDownloads.get(modelName);
    if (state) state.controller.abort();
  }

  /**
   * Renders the model selection interface.
   */
  async function renderModels() {
    const container = document.getElementById('modelCards');
    if (!container) return;
    const token = ++renderToken;

    setHint('Checking installed models…');
    if (!container.childElementCount) {
      container.innerHTML = '<div class="model-loading">Contacting Ollama…</div>';
    }

    let models;
    try {
      models = await fetchModels();
    } catch (error) {
      if (token !== renderToken) return;
      container.innerHTML = '';
      const panel = el('div', 'model-error-message');
      panel.appendChild(el('h3', null, 'Cannot reach Ollama'));
      panel.appendChild(el('p', null, describeError(error)));
      panel.appendChild(el('p', 'model-error-hint', `Start it with "ollama serve" (expected at ${getBaseUrl()}), then retry.`));
      const retry = el('button', 'primary-button', 'Retry');
      retry.type = 'button';
      retry.id = 'retryModelsButton';
      retry.addEventListener('click', () => renderModels());
      panel.appendChild(retry);
      container.appendChild(panel);
      setHint('Ollama is not reachable.', true);
      return;
    }
    if (token !== renderToken) return;

    container.innerHTML = '';
    if (models.length === 0) {
      container.appendChild(el('div', 'model-error-message', 'No models are configured. Add one to src/config.js.'));
      setHint('No models configured.', true);
      return;
    }

    const handlers = {
      onSelect: handleModelSelect,
      onDownload: handleModelDownload,
      onCancel: handleDownloadCancel,
      onRefresh: renderModels,
    };
    models.forEach((model) => container.appendChild(createModelCard(model, handlers)));

    const availableCount = models.filter((m) => m.available).length;
    if (availableCount === 0) {
      setHint('None of the configured models is installed yet. Install one below, then it becomes selectable.', true);
    } else if (selectedModel) {
      setHint(`Current model: ${selectedModel.name}. Pick another one, or go back to the chat.`);
    } else {
      setHint('Choose the model you want to chat with.');
    }

    // Keep the in-memory selection in sync with fresh server data.
    if (selectedModel) {
      const fresh = models.find((m) => m.name === selectedModel.name && m.available);
      if (fresh) selectedModel = fresh;
    }

    // Offer a way back when a model is already active.
    let back = document.getElementById('closeModelSelector');
    if (selectedModel) {
      if (!back) {
        back = el('button', 'secondary-button model-selector-back', 'Back to chat');
        back.type = 'button';
        back.id = 'closeModelSelector';
        back.addEventListener('click', hideSelector);
        document.querySelector('.model-selector-header')?.appendChild(back);
      }
      back.classList.remove('hidden');
    } else if (back) {
      back.classList.add('hidden');
    }
  }

  function init() {
    document.getElementById('refreshModelsButton')?.addEventListener('click', () => renderModels());
    document.addEventListener('yla:connection-restored', () => {
      if (isSelectorVisible()) renderModels();
    });
  }

  init();

  return {
    getSelectedModel,
    renderModels,
    showModelSelector,
  };
})();

export const selectedModelSettings = {
  get() {
    return ModelSelector.getSelectedModel();
  },
};
export const renderModels = ModelSelector.renderModels;
export const showModelSelector = ModelSelector.showModelSelector;
