import config from './config.js';
import {
  listModels,
  showModel,
  pullModel,
  createModel,
  deleteModel,
  describeError,
  getBaseUrl,
} from './ollamaClient.js';
import { fetchLibrary, fetchLibraryTags, LibraryUnavailableError } from './libraryClient.js';

/**
 * Model Selector Module - Handles model selection, availability checking,
 * downloading, and creating/deleting custom models on the Ollama server.
 */
const ModelSelector = (function () {
  const STORAGE_KEY = 'yla_selected_model';

  // Ollama's own defaults, used for installed models whose Modelfile does not
  // set a parameter and that have no entry in config.js.
  const DEFAULT_PARAMS = { num_ctx: 4096, temperature: 0.8, top_k: 40, top_p: 0.9 };

  let selectedModel = null;
  let renderToken = 0;
  let installedNames = [];
  let installedModels = [];
  const activeDownloads = new Map();
  let activeCreate = null;

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

  function pickNumber(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && Number.isFinite(Number(value))) return Number(value);
    }
    return undefined;
  }

  /**
   * Returns every model the user can pick: the entries of config.js (installed
   * or not) followed by the other models installed on the server. Installed
   * models take their parameters and system prompt from the server, and
   * config.js entries override them field by field.
   * Throws when the server cannot be reached.
   */
  async function fetchModels() {
    const installed = await listModels();
    const installedByName = new Map(installed.map((m) => [m.name, m]));
    installedModels = installed.slice().sort((a, b) => a.name.localeCompare(b.name));
    installedNames = installedModels.map((m) => m.name);

    const configured = config.models.map((model) => ({
      ...model,
      source: 'config',
      available: installedByName.has(model.name),
    }));
    const configuredNames = new Set(configured.map((m) => m.name));
    const extra = installed
      .filter((m) => !configuredNames.has(m.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({ name: m.name, source: 'server', available: true }));
    const models = configured.concat(extra);

    await Promise.all(
      models
        .filter((m) => m.available)
        .map(async (m) => {
          const bytes = installedByName.get(m.name)?.size;
          if (!m.size && bytes) m.size = formatBytes(bytes);
          try {
            const info = await showModel(m.name);
            m.capabilities = info.capabilities;
            m.serverParameters = info.parameters;
            m.serverSystem = info.system;
            m.parentModel = info.parentModel;
            const p = info.parameters || {};
            m.num_ctx = pickNumber(m.num_ctx, p.num_ctx, DEFAULT_PARAMS.num_ctx);
            m.temperature = pickNumber(m.temperature, p.temperature, DEFAULT_PARAMS.temperature);
            m.top_k = pickNumber(m.top_k, p.top_k, DEFAULT_PARAMS.top_k);
            m.top_p = pickNumber(m.top_p, p.top_p, DEFAULT_PARAMS.top_p);
            if (!m.systemMessage && info.system) m.systemMessage = info.system;
            if (!m.description && info.parentModel) m.description = `Custom model based on ${info.parentModel}`;
          } catch (error) {
            console.warn(`Could not read details for ${m.name}:`, error);
            m.num_ctx = pickNumber(m.num_ctx, DEFAULT_PARAMS.num_ctx);
            m.temperature = pickNumber(m.temperature, DEFAULT_PARAMS.temperature);
            m.top_k = pickNumber(m.top_k, DEFAULT_PARAMS.top_k);
            m.top_p = pickNumber(m.top_p, DEFAULT_PARAMS.top_p);
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
  function createModelCard(model, { onSelect, onDownload, onCancel, onRefresh, onDelete }) {
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
    if (model.available && model.parentModel) badges.appendChild(el('span', 'model-badge badge-cap', 'Custom'));
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

    if (model.available) {
      const foot = el('div', 'model-card-foot');
      const remove = el('button', 'model-remove-button', 'Remove from Ollama');
      remove.type = 'button';
      remove.title = `Delete ${model.name} from the Ollama server`;
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        foot.replaceChildren(confirmDelete(model, foot, remove, onDelete));
      });
      foot.appendChild(remove);
      card.appendChild(foot);
    }

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

  /** Inline confirmation shown in place of the Remove button. */
  function confirmDelete(model, foot, removeButton, onDelete) {
    const box = el('div', 'model-confirm');
    box.appendChild(el('span', null, `Delete ${model.name} from Ollama? The files are removed from disk.`));
    const yes = el('button', 'danger-button', 'Delete');
    yes.type = 'button';
    const no = el('button', 'secondary-button', 'Keep');
    no.type = 'button';
    const status = el('span', 'download-status');
    no.addEventListener('click', () => foot.replaceChildren(removeButton));
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      no.disabled = true;
      status.textContent = 'Deleting…';
      try {
        await onDelete(model);
      } catch (error) {
        yes.disabled = false;
        no.disabled = false;
        status.textContent = describeError(error);
        status.classList.add('error');
      }
    });
    box.append(yes, no, status);
    return box;
  }

  // ==============================
  // Create-model form
  // ==============================

  const CreateForm = {
    els() {
      const id = (name) => document.getElementById(name);
      return {
        button: id('createModelButton'),
        panel: id('createModelPanel'),
        name: id('createModelName'),
        from: id('createModelFrom'),
        system: id('createModelSystem'),
        numCtx: id('createModelCtx'),
        temperature: id('createModelTemp'),
        topK: id('createModelTopK'),
        topP: id('createModelTopP'),
        list: id('baseModelList'),
        variantRow: id('baseModelVariantRow'),
        variant: id('baseModelVariant'),
        info: id('baseModelInfo'),
        progress: id('createModelProgress'),
        status: id('createModelStatus'),
        cancel: id('createModelCancel'),
        submit: id('createModelSubmit'),
      };
    },

    isOpen() {
      const { panel } = this.els();
      return !!panel && !panel.classList.contains('hidden');
    },

    open() {
      const ui = this.els();
      if (!ui.panel) return;
      ui.panel.classList.remove('hidden');
      ui.button?.setAttribute('aria-expanded', 'true');
      this.loadLibrary();
      this.renderBaseList();
      if (!activeCreate) this.setStatus('');
      ui.name?.focus();
    },

    close() {
      const ui = this.els();
      if (!ui.panel) return;
      if (activeCreate) activeCreate.controller.abort();
      ui.panel.classList.add('hidden');
      ui.button?.setAttribute('aria-expanded', 'false');
      this.setStatus('');
      this.setBusy(false);
    },

    toggle() {
      this.isOpen() ? this.close() : this.open();
    },

    // ---- Base model picker ----

    library: null,
    libraryError: null,
    libraryLoading: false,
    selectedBase: null,

    async loadLibrary() {
      if (this.library || this.libraryLoading) return;
      this.libraryLoading = true;
      this.libraryError = null;
      this.renderBaseList();
      try {
        this.library = await fetchLibrary();
      } catch (error) {
        this.libraryError =
          error instanceof LibraryUnavailableError
            ? error.message
            : `Ollama library unavailable: ${describeError(error)}`;
      } finally {
        this.libraryLoading = false;
        this.renderBaseList();
      }
    },

    /** Fills the listbox with installed models and library models matching the typed text. */
    renderBaseList() {
      const ui = this.els();
      if (!ui.list) return;
      const filter = (ui.from?.value || '').trim().toLowerCase();
      const family = filter.split(':')[0];
      const previous = ui.list.value;
      const option = (value, text, { disabled = false, title = '' } = {}) => {
        const node = document.createElement('option');
        node.value = value;
        node.textContent = text;
        node.disabled = disabled;
        if (title) node.title = title;
        return node;
      };
      const group = (label) => {
        const node = document.createElement('optgroup');
        node.label = label;
        return node;
      };
      const groups = [];

      const installed = installedModels.filter((m) => !filter || m.name.toLowerCase().includes(filter));
      const installedGroup = group('Installed on this server');
      if (installed.length) {
        installed.forEach((m) => installedGroup.appendChild(option(`installed:${m.name}`, `${m.name}  ·  ${formatBytes(m.size)}`)));
      } else {
        installedGroup.appendChild(option('', installedModels.length ? 'No installed model matches' : 'Nothing installed yet', { disabled: true }));
      }
      groups.push(installedGroup);

      const libraryGroup = group(this.libraryLoading ? 'Ollama library (loading…)' : 'Ollama library');
      if (this.libraryError) {
        libraryGroup.appendChild(option('', this.libraryError, { disabled: true, title: this.libraryError }));
      } else if (this.library) {
        const matches = this.library.filter(
          (m) =>
            !filter ||
            m.name.toLowerCase().includes(filter) ||
            m.name.toLowerCase() === family ||
            (m.description || '').toLowerCase().includes(filter)
        );
        if (matches.length) {
          matches.forEach((m) => {
            const sizes = m.sizes?.length ? m.sizes.join(', ') : 'see variants';
            const summary = `${m.name}  ·  ${sizes}${m.description ? `  ·  ${m.description}` : ''}`;
            libraryGroup.appendChild(option(`library:${m.name}`, summary, { title: m.description || m.name }));
          });
        } else {
          libraryGroup.appendChild(option('', 'No library model matches', { disabled: true }));
        }
      } else if (this.libraryLoading) {
        libraryGroup.appendChild(option('', 'Fetching the list from ollama.com…', { disabled: true }));
      }
      groups.push(libraryGroup);

      const raw = (ui.from?.value || '').trim();
      const known =
        installedModels.some((m) => m.name.toLowerCase() === filter) ||
        (this.library || []).some((m) => m.name.toLowerCase() === filter || m.name.toLowerCase() === family);
      if (raw && !known) {
        const other = group('Other');
        other.appendChild(option(`typed:${raw}`, `Use "${raw}" as typed`));
        groups.push(other);
      }

      ui.list.replaceChildren(...groups);
      if (previous && [...ui.list.options].some((o) => o.value === previous && !o.disabled)) ui.list.value = previous;
    },

    setBaseInfo(text) {
      const { info } = this.els();
      if (info) info.textContent = text;
    },

    /** Called when the user picks an entry of the listbox. */
    async onBasePicked() {
      const ui = this.els();
      const value = ui.list?.value || '';
      const [kind, ...rest] = value.split(':');
      const name = rest.join(':');
      if (!kind || !name) return;
      this.selectedBase = { kind, name };
      ui.variantRow?.classList.add('hidden');

      if (kind === 'installed') {
        ui.from.value = name;
        const entry = installedModels.find((m) => m.name === name);
        this.setBaseInfo(`${name} is installed (${formatBytes(entry?.size)}). No download needed.`);
        return;
      }
      if (kind === 'typed') {
        ui.from.value = name;
        this.setBaseInfo(`${name} will be pulled from the Ollama library as typed.`);
        return;
      }

      // Library model: fetch its variants, then let the user pick one.
      const model = (this.library || []).find((m) => m.name === name);
      ui.from.value = name;
      this.setBaseInfo(`Loading the variants of ${name}…`);
      let tags = [];
      try {
        tags = await fetchLibraryTags(name);
      } catch (error) {
        if (this.selectedBase?.name !== name) return;
        this.setBaseInfo(`${name}:latest will be used (variants unavailable: ${describeError(error)}).`);
        return;
      }
      if (this.selectedBase?.name !== name || !ui.variant) return;
      if (!tags.length) {
        this.setBaseInfo(`${name}:latest will be used (no variant list found).`);
        return;
      }
      ui.variant.replaceChildren(
        ...tags.map((t) => {
          const node = document.createElement('option');
          node.value = t.name;
          const bits = [t.tag, t.cloud ? 'cloud (runs on ollama.com)' : t.size || 'size unknown'];
          if (t.context) bits.push(`${t.context} context`);
          if (t.inputs) bits.push(t.inputs);
          node.textContent = bits.join('  ·  ');
          return node;
        })
      );
      const preferred = tags.find((t) => t.tag === 'latest') || tags.find((t) => !t.cloud) || tags[0];
      ui.variant.value = preferred.name;
      ui.from.value = preferred.name;
      ui.variantRow?.classList.remove('hidden');
      const desc = model?.description ? ` ${model.description}` : '';
      this.setBaseInfo(`${tags.length} variant${tags.length === 1 ? '' : 's'} on ollama.com.${desc}`);
    },

    setStatus(text, { error = false, percent } = {}) {
      const ui = this.els();
      if (ui.status) {
        ui.status.textContent = text;
        ui.status.classList.toggle('error', error);
      }
      if (ui.progress) {
        ui.progress.classList.toggle('visible', percent !== undefined);
        if (percent !== undefined && ui.progress.firstChild) ui.progress.firstChild.style.width = `${percent}%`;
      }
    },

    setBusy(busy) {
      const ui = this.els();
      for (const key of ['name', 'from', 'list', 'variant', 'system', 'numCtx', 'temperature', 'topK', 'topP', 'submit']) {
        if (ui[key]) ui[key].disabled = busy;
      }
      if (ui.submit) ui.submit.textContent = busy ? 'Working…' : 'Create model';
      if (ui.cancel) ui.cancel.textContent = busy ? 'Stop' : 'Cancel';
    },

    /** Reads and validates the form. Returns {spec} or {error}. */
    read() {
      const ui = this.els();
      const name = (ui.name?.value || '').trim();
      const from = (ui.from?.value || '').trim();
      if (!name) return { error: 'Give the model a name.', field: ui.name };
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*(?::[A-Za-z0-9._-]+)?$/.test(name)) {
        return {
          error: 'Model names can only contain letters, digits, dots, dashes and underscores, plus an optional :tag.',
          field: ui.name,
        };
      }
      if (!from) return { error: 'Choose the base model.', field: ui.from };
      const fullName = name.includes(':') ? name : `${name}:latest`;
      const baseName = from.includes(':') ? from : `${from}:latest`;
      if (fullName === baseName) return { error: 'The new model needs a different name from its base.', field: ui.name };

      const parameters = {};
      const numeric = (input, key, { min, max, integer = false }) => {
        const raw = (input?.value ?? '').trim();
        if (raw === '') return null;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
          return `${key} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`;
        }
        parameters[key] = value;
        return null;
      };
      const problems = [
        [numeric(ui.numCtx, 'num_ctx', { min: 512, max: 4194304, integer: true }), ui.numCtx],
        [numeric(ui.temperature, 'temperature', { min: 0, max: 2 }), ui.temperature],
        [numeric(ui.topK, 'top_k', { min: 1, max: 1000, integer: true }), ui.topK],
        [numeric(ui.topP, 'top_p', { min: 0, max: 1 }), ui.topP],
      ].filter(([msg]) => msg);
      if (problems.length) return { error: problems[0][0], field: problems[0][1] };

      return {
        spec: {
          name: fullName,
          from: baseName,
          system: (ui.system?.value || '').trim(),
          parameters,
        },
      };
    },

    async submit() {
      if (activeCreate) return;
      const { spec, error, field } = this.read();
      if (error) {
        this.setStatus(error, { error: true });
        field?.focus();
        return;
      }
      if (installedNames.includes(spec.name) && !this.confirmedOverwrite) {
        this.confirmedOverwrite = spec.name;
        this.setStatus(`${spec.name} already exists. Press "Create model" again to replace it.`, { error: true });
        return;
      }
      this.confirmedOverwrite = null;

      const controller = new AbortController();
      activeCreate = { controller };
      this.setBusy(true);

      try {
        if (!installedNames.includes(spec.from)) {
          this.setStatus(`Downloading ${spec.from}…`, { percent: 0 });
          await pullModel(spec.from, {
            signal: controller.signal,
            onProgress: ({ status, completed, total, percent, layer }) => {
              const text =
                layer && total > 0
                  ? `Downloading ${spec.from}: ${formatBytes(completed)} of ${formatBytes(total)} (${percent}%)`
                  : status === 'pulling manifest'
                    ? `Fetching information about ${spec.from}…`
                    : `Downloading ${spec.from}: ${status || 'starting'}…`;
              this.setStatus(text, { percent });
            },
          });
        }
        this.setStatus(`Creating ${spec.name}…`, { percent: 100 });
        await createModel(spec, {
          signal: controller.signal,
          onProgress: ({ status, done }) => {
            if (!done) this.setStatus(`Creating ${spec.name}: ${status}…`, { percent: 100 });
          },
        });
        activeCreate = null;
        this.setBusy(false);
        this.reset();
        this.close();
        setHint(`${spec.name} is ready. Pick it below.`);
        await renderModels({ keepHint: true });
      } catch (error) {
        let message = describeError(error);
        if (error.name === 'AbortError') message = 'Stopped. Nothing was created.';
        else if (/file does not exist|not found/i.test(message)) {
          message = `${spec.from} is not installed and is not in the Ollama library. Check the base model name.`;
        }
        this.setStatus(message, { error: true });
      } finally {
        activeCreate = null;
        this.setBusy(false);
      }
    },

    reset() {
      const ui = this.els();
      if (ui.name) ui.name.value = '';
      if (ui.system) ui.system.value = '';
      this.confirmedOverwrite = null;
    },

    init() {
      const ui = this.els();
      ui.list?.addEventListener('change', () => this.onBasePicked());
      ui.variant?.addEventListener('change', () => {
        if (ui.from && ui.variant.value) ui.from.value = ui.variant.value;
      });
      ui.from?.addEventListener('input', () => {
        this.selectedBase = null;
        ui.variantRow?.classList.add('hidden');
        this.renderBaseList();
      });
      ui.button?.addEventListener('click', () => this.toggle());
      ui.cancel?.addEventListener('click', () => {
        if (activeCreate) {
          activeCreate.controller.abort();
        } else {
          this.close();
        }
      });
      ui.panel?.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submit();
      });
      for (const key of ['name', 'from']) {
        ui[key]?.addEventListener('input', () => {
          this.confirmedOverwrite = null;
          if (ui.status?.classList.contains('error') && !activeCreate) this.setStatus('');
        });
      }
    },
  };

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

  async function handleModelDelete(model) {
    await deleteModel(model.name);
    if (selectedModel && selectedModel.name === model.name) {
      selectedModel = null;
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      document.dispatchEvent(new CustomEvent('yla:model-removed', { detail: model }));
    }
    setHint(`${model.name} was removed from Ollama.`);
    await renderModels({ keepHint: true });
  }

  /**
   * Renders the model selection interface.
   */
  async function renderModels({ keepHint = false } = {}) {
    const container = document.getElementById('modelCards');
    if (!container) return;
    const token = ++renderToken;
    const previousHint = document.getElementById('modelSelectorHint')?.textContent;

    if (!keepHint) setHint('Checking installed models…');
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
    if (CreateForm.isOpen()) CreateForm.renderBaseList();
    if (models.length === 0) {
      const empty = el('div', 'model-empty-message');
      empty.appendChild(el('p', null, 'No models are installed on this Ollama server yet.'));
      empty.appendChild(
        el('p', 'model-error-hint', 'Use "Create model" above to download a base model and build your own on top of it, or add an entry to src/config.js.')
      );
      container.appendChild(empty);
      setHint('No models installed.', true);
      return;
    }

    const handlers = {
      onSelect: handleModelSelect,
      onDownload: handleModelDownload,
      onCancel: handleDownloadCancel,
      onRefresh: renderModels,
      onDelete: handleModelDelete,
    };
    models.forEach((model) => container.appendChild(createModelCard(model, handlers)));

    const availableCount = models.filter((m) => m.available).length;
    if (keepHint && previousHint) {
      setHint(previousHint);
    } else if (availableCount === 0) {
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
    CreateForm.init();
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
