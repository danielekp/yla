import {
  sendMessage,
  startNewConversation,
  toggleSidebar,
  toggleTheme,
  downloadConversation,
} from './logic.js';
import { renderModels } from './modelSelector.js';
import config from './config.js';

/**
 * Main application initializer
 * Handles app initialization, event binding, and API connection management
 */
const AppInitializer = (function () {
  // ==============================
  // Event Management
  // ==============================

  const EventManager = {
    /**
     * Registers an event listener with error handling
     * @param {string} elementId - ID of the element to attach the event to
     * @param {string} eventType - Type of event (e.g., 'click')
     * @param {Function} handler - Event handler function
     * @param {Object} options - Additional options for addEventListener
     */
    registerEvent(elementId, eventType, handler, options = {}) {
      const element = document.getElementById(elementId);
      if (element) {
        try {
          element.addEventListener(eventType, handler, options);
        } catch (error) {
          console.error(`Error registering ${eventType} event on #${elementId}:`, error);
        }
      } else {
        console.warn(`Element #${elementId} not found for ${eventType} event`);
      }
    },

    /**
     * Sets up all application event listeners
     */
    initializeEventListeners() {
      // Text input area handling
      const textarea = document.getElementById('messageInput');
      if (textarea) {
        // Send message on Enter (but not with Shift+Enter)
        textarea.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        });

        // Auto-resize textarea with debounce
        const resizeTextarea = this.debounce(function () {
          this.style.height = 'auto';
          const newHeight = Math.min(this.scrollHeight, 150);
          this.style.height = `${newHeight}px`;
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth',
          });
        }, 30);

        textarea.addEventListener('input', resizeTextarea);
      }

      // Button event listeners
      this.registerEvent('sendButton', 'click', sendMessage);
      this.registerEvent('newChatButton', 'click', startNewConversation);
      this.registerEvent('toggleSidebarButton', 'click', toggleSidebar);
      this.registerEvent('themeToggleButton', 'click', toggleTheme);

      // Connection status retry on click
      this.registerEvent('connectionStatus', 'click', () =>
        ConnectionManager.checkConnection(true)
      );

      // Add window resize handler to adjust layout
      window.addEventListener('resize', this.debounce(this.handleWindowResize, 150));

      console.log('Event listeners initialized');
    },

    /**
     * Handles window resize events for responsive layout
     */
    handleWindowResize() {
      const isMobileView = window.innerWidth < 768;
      const sidebar = document.getElementById('sidebar');

      // Auto-collapse sidebar on mobile view
      if (isMobileView && sidebar && sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
      }
    },

    /**
     * Creates a debounced version of a function
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @returns {Function} Debounced function
     */
    debounce(func, wait) {
      let timeout;
      return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
      };
    },
  };

  // ==============================
  // Network Utilities
  // ==============================

  const NetworkUtils = {
    /**
     * Performs a fetch operation with timeout
     * @param {string} resource - URL to fetch
     * @param {Object} options - Fetch options
     * @returns {Promise<Response>} Fetch response
     */
    async fetchWithTimeout(resource, options = {}) {
      const { timeout = 3000, ...fetchOptions } = options;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(resource, {
          ...fetchOptions,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    },

    /**
     * Formats an error into a user-friendly message
     * @param {Error} error - The error object
     * @returns {string} User-friendly error message
     */
    getErrorMessage(error) {
      if (!error) return 'Unknown error';

      if (error.name === 'AbortError') return 'Connection timeout';
      if (error.message.includes('Failed to fetch')) return 'Server offline';
      if (error.message.includes('server error')) return 'Server error';
      if (error.message.includes('Unexpected token')) return 'Invalid response';
      if (error.message.includes('NetworkError')) return 'Network error';
      if (error.message.includes('CORS')) return 'CORS error - check server config';

      return error.message || 'Connection failed';
    },
  };

  // ==============================
  // Connection Manager
  // ==============================

  const ConnectionManager = {
    _isConnected: false,
    checkInterval: null,
    retryCount: 0,
    maxRetries: 3,

    /**
     * Gets connection status
     * @returns {boolean} Current connection status
     */
    get isConnected() {
      return this._isConnected;
    },

    /**
     * Sets connection status
     * @param {boolean} value - New connection status
     */
    setConnected(value) {
      this._isConnected = !!value;
    },

    /**
     * Checks the API connection status
     * @param {boolean} isUserInitiated - Whether the check was initiated by the user
     * @returns {Promise<boolean>} Connection status
     */
    async checkConnection(isUserInitiated = false) {
      const statusElement = document.getElementById('connectionStatus');
      if (!statusElement) return false;

      const statusDot = statusElement.querySelector('.status-dot');
      const statusText = statusElement.querySelector('.status-text');

      // If user initiated, show checking status
      if (isUserInitiated && statusText) {
        statusText.textContent = 'Checking...';
      }

      try {
        // Use fetchWithTimeout for the initial ping
        const pingResponse = await NetworkUtils.fetchWithTimeout(config.api.available_models, {
          method: 'GET',
          timeout: 5000, // Longer timeout for user-initiated checks
          // Removed custom headers to avoid CORS issues
        });

        if (!pingResponse.ok) {
          throw new Error(`Server error: ${pingResponse.status}`);
        }

        // Connection successful
        this.setConnected(true);
        this.retryCount = 0;

        statusElement.classList.remove('error');
        statusElement.classList.add('connected');

        if (statusText) {
          statusText.textContent = 'Connected';

          // Check for Ollama version
          const ollamaVersion = pingResponse.headers.get('ollama-version');
          if (ollamaVersion) {
            statusText.textContent = `Ollama ${ollamaVersion}`;
            setTimeout(() => {
              if (statusText) statusText.textContent = 'Connected';
            }, 2000);
          }
        }

        return true;
      } catch (error) {
        this.setConnected(false);
        this.retryCount++;

        statusElement.classList.remove('connected');
        statusElement.classList.add('error');

        if (statusText) {
          const errorMessage = NetworkUtils.getErrorMessage(error);
          statusText.textContent = errorMessage;

          // If user initiated and failed, offer specific guidance
          if (isUserInitiated) {
            statusText.textContent = `${errorMessage}. Check if Ollama is running.`;
          }
        }

        console.error('Connection error:', error);

        // If we have automatic retries left, try again with backoff
        if (!isUserInitiated && this.retryCount <= this.maxRetries) {
          const retryDelay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 10000);
          console.log(`Will retry connection in ${retryDelay}ms (attempt ${this.retryCount})`);

          setTimeout(() => this.checkConnection(), retryDelay);
        }

        return false;
      }
    },

    /**
     * Starts periodic connection checking
     * @param {number} interval - Check interval in milliseconds
     */
    startConnectionMonitoring(interval = 300000) {
      // Clear any existing interval
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
      }

      // Initial check
      this.checkConnection();

      // Set up regular checking using arrow function to preserve 'this' context
      this.checkInterval = setInterval(() => this.checkConnection(), interval);
    },

    /**
     * Stops connection monitoring
     */
    stopConnectionMonitoring() {
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }
    },
  };

  // ==============================
  // Theme Manager
  // ==============================

  const ThemeManager = {
    /**
     * Initializes theme based on localStorage or system preference
     */
    initializeTheme() {
      // First check localStorage
      const savedTheme = localStorage.getItem('theme');

      if (savedTheme === 'dark') {
        this.setDarkMode(true);
      } else if (savedTheme === 'light') {
        this.setDarkMode(false);
      } else {
        // If no saved preference, check system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.setDarkMode(prefersDark);
        localStorage.setItem('theme', prefersDark ? 'dark' : 'light');
      }

      // Listen for system theme changes
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        // Only apply system changes if user hasn't explicitly set a preference
        if (!localStorage.getItem('theme')) {
          this.setDarkMode(e.matches);
        }
      });
    },

    /**
     * Sets dark mode state
     * @param {boolean} isDark - Whether to enable dark mode
     */
    setDarkMode(isDark) {
      const htmlElement = document.documentElement;
      const themeToggleIcon = document.querySelector('.theme-toggle-icon');

      if (isDark) {
        htmlElement.classList.add('dark-mode');
        if (themeToggleIcon) themeToggleIcon.src = 'media/sun.png';
      } else {
        htmlElement.classList.remove('dark-mode');
        if (themeToggleIcon) themeToggleIcon.src = 'media/moon.png';
      }
    },
  };

  /**
   * Initialize the sidebar toggle button state
   * Ensures sidebar is closed by default and toggle button position is correct
   */
  function initializeSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const toggleButton = document.getElementById('toggleSidebarButton');
    const mainContent = document.querySelector('.main-content');

    if (sidebar && toggleButton) {
      // Ensure sidebar starts in closed state (remove 'active' class if present)
      sidebar.classList.remove('active');

      // Ensure toggle button shows closed state
      toggleButton.classList.add('sidebar-closed');

      if (mainContent) {
        mainContent.classList.remove('sidebar-active');
      }

      // Force correct initial position
      toggleButton.style.left = '0';
    }
  }

  // ==============================
  // Application Initializer
  // ==============================

  /**
   * Main application initialization
   */
  function initializeApplication() {
    try {
      console.log('Initializing application...');

      // Initialize theme first to prevent flash of wrong theme
      ThemeManager.initializeTheme();

      // Set up event listeners
      EventManager.initializeEventListeners();

      initializeSidebarToggle();

      // Start connection monitoring
      ConnectionManager.startConnectionMonitoring();

      // Initialize model selector
      renderModels();

      console.log('Application initialized successfully');
    } catch (error) {
      console.error('Error during application initialization:', error);

      // Show error to user
      const container = document.querySelector('.main-content') || document.body;
      const errorElement = document.createElement('div');
      errorElement.className = 'init-error';
      errorElement.innerHTML = `
                <h3>Application Error</h3>
                <p>There was a problem initializing the application: ${error.message}</p>
                <button id="retryInitButton">Retry</button>
            `;
      container.prepend(errorElement);

      // Add retry button handler
      const retryButton = document.getElementById('retryInitButton');
      if (retryButton) {
        retryButton.addEventListener('click', () => {
          errorElement.remove();
          initializeApplication();
        });
      }
    }
  }

  // Wait for DOM to be ready before initializing
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApplication);
  } else {
    // DOM already loaded, initialize immediately
    initializeApplication();
  }

  window.addEventListener('beforeunload', () => {
    try {
      // Get conversations from localStorage
      const savedConversations = localStorage.getItem('yla_conversations');
      if (savedConversations) {
        let conversations = JSON.parse(savedConversations);
        
        // Filter out empty conversations
        const originalCount = conversations.length;
        conversations = conversations.filter(convo => {
          return convo.messages && convo.messages.length > 0;
        });
        
        // Save back to localStorage if any were removed
        if (conversations.length < originalCount) {
          localStorage.setItem('yla_conversations', JSON.stringify(conversations));
          console.log(`Removed ${originalCount - conversations.length} empty conversations`);
        }
      }
    } catch (error) {
      console.error('Error cleaning up empty conversations:', error);
    }
  });

  // Public API
  return {
    checkConnection: () => ConnectionManager.checkConnection(true),
    toggleTheme: toggleTheme,
  };
})();

// Export a clean public API for any external usage
export default AppInitializer;
