import {
  sendMessage,
  stopGeneration,
  isGenerating,
  startNewConversation,
  changeModel,
  toggleSidebar,
  setSidebar,
  isSidebarOpen,
  toggleTheme,
} from './logic.js';
import { renderModels } from './modelSelector.js';
import { getVersion, describeError } from './ollamaClient.js';

/**
 * Main application initializer
 * Handles app initialization, event binding, and API connection management
 */
const AppInitializer = (function () {
  const MOBILE_BREAKPOINT = 768;

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // ==============================
  // Event Management
  // ==============================

  const EventManager = {
    registerEvent(elementId, eventType, handler, options = {}) {
      const element = document.getElementById(elementId);
      if (!element) {
        console.warn(`Element #${elementId} not found for ${eventType} event`);
        return;
      }
      element.addEventListener(eventType, handler, options);
    },

    initializeEventListeners() {
      const textarea = document.getElementById('messageInput');
      if (textarea) {
        textarea.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            sendMessage();
          } else if (e.key === 'Escape' && isGenerating()) {
            e.preventDefault();
            stopGeneration();
          }
        });
      }

      this.registerEvent('sendButton', 'click', () => {
        if (isGenerating()) stopGeneration();
        else sendMessage();
      });
      this.registerEvent('newChatButton', 'click', startNewConversation);
      this.registerEvent('toggleSidebarButton', 'click', toggleSidebar);
      this.registerEvent('themeToggleButton', 'click', toggleTheme);
      this.registerEvent('modelPill', 'click', changeModel);
      this.registerEvent('connectionStatus', 'click', () => ConnectionManager.checkConnection(true));

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isGenerating() && !e.defaultPrevented) {
          stopGeneration();
        }
      });

      // A failed chat request usually means Ollama went away: refresh the pill.
      document.addEventListener('yla:request-failed', () => ConnectionManager.checkConnection());

      window.addEventListener('resize', debounce(this.handleWindowResize, 150));
    },

    handleWindowResize() {
      if (window.innerWidth < MOBILE_BREAKPOINT && isSidebarOpen()) {
        setSidebar(false);
      }
    },
  };

  // ==============================
  // Connection Manager
  // ==============================

  const ConnectionManager = {
    _isConnected: null,
    timer: null,
    onlineInterval: 60000,
    offlineInterval: 10000,

    get isConnected() {
      return !!this._isConnected;
    },

    schedule(delay) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.checkConnection(), delay);
    },

    async checkConnection(isUserInitiated = false) {
      const statusElement = document.getElementById('connectionStatus');
      if (!statusElement) return false;
      const statusText = statusElement.querySelector('.status-text');

      if (isUserInitiated && statusText) statusText.textContent = 'Checking…';

      try {
        const { version } = await getVersion({ timeout: 5000 });
        const wasConnected = this._isConnected;
        this._isConnected = true;

        statusElement.classList.remove('error');
        statusElement.classList.add('connected');
        if (statusText) statusText.textContent = version ? `Ollama ${version}` : 'Connected';
        statusElement.title = `Connected to Ollama${version ? ` ${version}` : ''} (click to check again)`;

        if (wasConnected === false) {
          document.dispatchEvent(new CustomEvent('yla:connection-restored'));
        }
        this.schedule(this.onlineInterval);
        return true;
      } catch (error) {
        this._isConnected = false;
        statusElement.classList.remove('connected');
        statusElement.classList.add('error');
        if (statusText) {
          statusText.textContent =
            error.name === 'AbortError' || error.name === 'TimeoutError'
              ? 'Ollama not responding'
              : 'Ollama offline';
        }
        statusElement.title = `${describeError(error)} (click to retry)`;
        this.schedule(this.offlineInterval);
        return false;
      }
    },

    startConnectionMonitoring() {
      this.checkConnection();
    },
  };

  // ==============================
  // Theme Manager
  // ==============================

  const ThemeManager = {
    initializeTheme() {
      let savedTheme = null;
      try {
        savedTheme = localStorage.getItem('theme');
      } catch {
        /* ignore */
      }
      const media = window.matchMedia('(prefers-color-scheme: dark)');

      if (savedTheme === 'dark' || savedTheme === 'light') {
        this.setDarkMode(savedTheme === 'dark');
      } else {
        // Follow the system preference until the user picks a theme explicitly.
        this.setDarkMode(media.matches);
      }

      media.addEventListener('change', (e) => {
        let stored = null;
        try {
          stored = localStorage.getItem('theme');
        } catch {
          /* ignore */
        }
        if (stored !== 'dark' && stored !== 'light') this.setDarkMode(e.matches);
      });
    },

    setDarkMode(isDark) {
      document.documentElement.classList.toggle('dark-mode', isDark);
      const icon = document.querySelector('.theme-toggle-icon');
      if (icon) icon.src = isDark ? 'media/sun.png' : 'media/moon.png';
    },
  };

  // ==============================
  // Application Initializer
  // ==============================

  let initialized = false;

  function initializeApplication() {
    try {
      if (!initialized) {
        ThemeManager.initializeTheme();
        EventManager.initializeEventListeners();
        initialized = true;
      }
      ConnectionManager.startConnectionMonitoring();
      renderModels();
    } catch (error) {
      console.error('Error during application initialization:', error);
      showInitError(error);
    }
  }

  function showInitError(error) {
    document.querySelector('.init-error')?.remove();
    const banner = document.createElement('div');
    banner.className = 'init-error';
    banner.setAttribute('role', 'alert');
    const title = document.createElement('h3');
    title.textContent = 'Application Error';
    const text = document.createElement('p');
    text.textContent = `There was a problem initializing the application: ${error.message}`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      banner.remove();
      initializeApplication();
    });
    banner.append(title, text, retry);
    document.body.prepend(banner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApplication);
  } else {
    initializeApplication();
  }

  return {
    checkConnection: () => ConnectionManager.checkConnection(true),
    toggleTheme,
  };
})();

export default AppInitializer;
