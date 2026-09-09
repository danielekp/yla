import config from './config.js';
import { selectedModelSettings, showModelSelector } from './modelSelector.js';
import { MarkdownParser } from './parsers/markdown_parser.js';
import { chat as apiChat, resolveThink, describeError } from './ollamaClient.js';

/**
 * ChatApp - Main application module for local AI assistant
 */
const ChatApp = (function () {
  const STORAGE_KEYS = {
    conversations: 'yla_conversations',
    current: 'yla_current_conversation',
    sidebar: 'yla_sidebar_open',
  };
  const TITLE_MAX_LENGTH = 40;
  const THINK_TAG_RE = /<think>([\s\S]*?)<\/think>/;

  // ==============================
  // Shared helpers
  // ==============================

  /**
   * Splits legacy "<think>…</think>answer" content into its two parts.
   * @param {string} content
   * @returns {{thinking: string, content: string}}
   */
  function splitThinkTags(content) {
    if (typeof content !== 'string') return { thinking: '', content: '' };
    const match = content.match(THINK_TAG_RE);
    if (!match) return { thinking: '', content };
    return {
      thinking: match[1].trim(),
      content: content.replace(THINK_TAG_RE, '').trim(),
    };
  }

  /**
   * Splits content that begins with an inline <think> block (models without
   * native thinking support emit the tags as text).  Returns null when the
   * text does not start with a think block; `content` is null while the block
   * is still open (streaming).
   */
  function splitInlineThinking(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trimStart();
    if (!trimmed.startsWith('<think>')) return null;
    const rest = trimmed.slice('<think>'.length);
    const close = rest.indexOf('</think>');
    if (close === -1) return { thinking: rest.trim(), content: null };
    return {
      thinking: rest.slice(0, close).trim(),
      content: rest.slice(close + '</think>'.length).trim(),
    };
  }

  /** Removes <think> blocks (closed or still open) from text. */
  function stripThinkTags(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<think>[\s\S]*$/, '')
      .trim();
  }

  /**
   * Rough token estimate: ~3.5 characters per token for Latin text, about one
   * token per character for other scripts.  Used only to keep the history
   * within the model's context window; Ollama does the exact accounting.
   * @param {string} text
   * @returns {number}
   */
  function estimateTokens(text) {
    if (!text) return 0;
    let ascii = 0;
    let other = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) < 128) ascii++;
      else other++;
    }
    return Math.ceil(ascii / 3.5 + other);
  }

  function estimateMessageTokens(message) {
    return 4 + estimateTokens(message?.content || '');
  }

  function formatSeconds(ms) {
    if (!Number.isFinite(ms)) return '';
    const s = ms / 1000;
    if (s < 10) return `${s.toFixed(1)} s`;
    if (s < 90) return `${Math.round(s)} s`;
    const m = Math.floor(s / 60);
    return `${m} min ${Math.round(s - m * 60)} s`;
  }

  function makeTitle(text) {
    const firstLine = String(text || '')
      .trim()
      .split('\n')[0]
      // Drop markdown punctuation so titles read as plain text.
      .replace(/[*_`#>~]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!firstLine) return 'New chat';
    return firstLine.length > TITLE_MAX_LENGTH
      ? firstLine.slice(0, TITLE_MAX_LENGTH).trimEnd() + '…'
      : firstLine;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ==============================
  // State Management
  // ==============================

  const StateManager = (function () {
    let conversations = [];
    let currentConversationId = null;
    let isLoading = false;

    /** Brings a stored message up to the current shape. */
    function normalizeMessage(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const role = raw.role === 'assistant' || raw.role === 'system' ? raw.role : 'user';
      const message = { ...raw, role, content: typeof raw.content === 'string' ? raw.content : '' };
      if (role === 'assistant' && !message.thinking && THINK_TAG_RE.test(message.content)) {
        const split = splitThinkTags(message.content);
        message.thinking = split.thinking;
        message.content = split.content;
      }
      return message;
    }

    function normalizeConversation(raw) {
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.messages)) return null;
      const messages = raw.messages.map(normalizeMessage).filter(Boolean);
      return {
        id: Number(raw.id) || Date.now(),
        title: typeof raw.title === 'string' && raw.title ? raw.title : makeTitle(messages[0]?.content),
        messages,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
        model: raw.model || null,
      };
    }

    function init() {
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.conversations);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            conversations = parsed
              .map(normalizeConversation)
              .filter((c) => c && c.messages.length > 0);
          }
        }
        const lastActive = parseInt(localStorage.getItem(STORAGE_KEYS.current), 10);
        if (conversations.some((c) => c.id === lastActive)) {
          currentConversationId = lastActive;
        }
      } catch (error) {
        console.error('Error loading saved conversations:', error);
        conversations = [];
        currentConversationId = null;
      }
    }

    function persist() {
      try {
        localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(conversations));
        if (currentConversationId) {
          localStorage.setItem(STORAGE_KEYS.current, String(currentConversationId));
        } else {
          localStorage.removeItem(STORAGE_KEYS.current);
        }
      } catch (error) {
        console.error('Error saving conversations:', error);
        UIManager.showToast('Could not save the conversation (storage full or unavailable)', 'error');
      }
    }

    function getConversations() {
      return [...conversations];
    }

    function getConversationById(id) {
      return conversations.find((c) => c.id === id) || null;
    }

    function getCurrentConversation() {
      return getConversationById(currentConversationId);
    }

    function isAppLoading() {
      return isLoading;
    }

    function setLoading(loading) {
      isLoading = !!loading;
      UIManager.setBusy(isLoading);
    }

    function nextId() {
      let id = Date.now();
      while (conversations.some((c) => c.id === id)) id++;
      return id;
    }

    function createConversation() {
      const now = new Date().toISOString();
      const conversation = {
        id: nextId(),
        title: 'New chat',
        messages: [],
        createdAt: now,
        updatedAt: now,
        model: selectedModelSettings.get()?.name || null,
      };
      conversations.unshift(conversation);
      currentConversationId = conversation.id;
      persist();
      return conversation;
    }

    /** Returns the current conversation, creating one when there is none. */
    function ensureConversation() {
      return getCurrentConversation() || createConversation();
    }

    function setCurrentConversation(id) {
      if (!getConversationById(id)) return false;
      currentConversationId = id;
      persist();
      return true;
    }

    /**
     * Appends a message to a conversation.
     * @returns {number} index of the new message, or -1
     */
    function addMessage(conversationId, message) {
      const conversation = getConversationById(conversationId);
      if (!conversation || !message || !message.role) return -1;
      const stored = { ...message, createdAt: message.createdAt || new Date().toISOString() };
      conversation.messages.push(stored);
      conversation.updatedAt = stored.createdAt;
      if (stored.role === 'assistant' && stored.model) conversation.model = stored.model;
      if (stored.role === 'user' && conversation.messages.filter((m) => m.role === 'user').length === 1) {
        conversation.title = makeTitle(stored.content);
      }
      persist();
      return conversation.messages.length - 1;
    }

    /** Keeps messages[0..index] of the current conversation, drops the rest. */
    function truncateMessages(conversationId, index) {
      const conversation = getConversationById(conversationId);
      if (!conversation) return;
      if (conversation.messages.length > index + 1) {
        conversation.messages = conversation.messages.slice(0, index + 1);
        conversation.updatedAt = new Date().toISOString();
        persist();
      }
    }

    function deleteConversation(id) {
      const before = conversations.length;
      conversations = conversations.filter((c) => c.id !== id);
      if (conversations.length === before) return false;
      if (currentConversationId === id) currentConversationId = null;
      persist();
      return true;
    }

    /** Removes conversations without messages (except the current one). */
    function pruneEmpty() {
      const before = conversations.length;
      conversations = conversations.filter(
        (c) => c.messages.length > 0 || c.id === currentConversationId
      );
      if (conversations.length !== before) persist();
    }

    /**
     * Builds the message list sent to the model: the most recent contiguous
     * messages that fit in the budget, always including the latest user turn.
     * @param {Object} conversation
     * @param {number} maxTokens
     * @returns {{messages: Array, dropped: number}}
     */
    function buildHistory(conversation, maxTokens) {
      if (!conversation) return { messages: [], dropped: 0 };

      const clean = conversation.messages
        .map((m) => {
          if (m.role === 'assistant') {
            return { role: 'assistant', content: stripThinkTags(m.content) };
          }
          return { role: m.role, content: String(m.content || '') };
        })
        // An assistant turn without any answer (stopped before it replied) adds nothing.
        .filter((m) => m.role !== 'assistant' || m.content !== '');

      const system = clean.filter((m) => m.role === 'system');
      const turns = clean.filter((m) => m.role !== 'system');

      let budget = maxTokens - system.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
      const kept = [];
      for (let i = turns.length - 1; i >= 0; i--) {
        const cost = estimateMessageTokens(turns[i]);
        if (kept.length > 0 && cost > budget) break;
        kept.unshift(turns[i]);
        budget -= cost;
      }
      // Start the history on a user turn so the exchange structure stays intact.
      while (kept.length > 1 && kept[0].role !== 'user') kept.shift();

      return { messages: [...system, ...kept], dropped: turns.length - kept.length };
    }

    init();

    return {
      getConversations,
      getConversationById,
      getCurrentConversation,
      isAppLoading,
      setLoading,
      createConversation,
      ensureConversation,
      setCurrentConversation,
      addMessage,
      truncateMessages,
      deleteConversation,
      pruneEmpty,
      buildHistory,
      persist,
    };
  })();

  // ==============================
  // UI Manager
  // ==============================

  const UIManager = (function () {
    const elements = {
      chatScroll: document.getElementById('chatScroll'),
      chatContainer: document.getElementById('chatContainer'),
      messageInput: document.getElementById('messageInput'),
      sendButton: document.getElementById('sendButton'),
      newChatButton: document.getElementById('newChatButton'),
      conversationList: document.getElementById('conversationList'),
      sidebar: document.getElementById('sidebar'),
      toggleSidebarButton: document.getElementById('toggleSidebarButton'),
      mainContent: document.querySelector('.main-content'),
      scrollToBottomButton: document.getElementById('scrollToBottomButton'),
      modelPill: document.getElementById('modelPill'),
      modelPillName: document.getElementById('modelPillName'),
    };

    // ---------- toasts

    function showToast(message, type = 'info') {
      document.querySelectorAll('.toast').forEach((t) => {
        if (t.textContent === message) t.remove();
      });
      const toast = el('div', `toast toast-${type}`, message);
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('show'));
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    // ---------- busy state

    function setBusy(busy) {
      if (elements.sendButton) {
        elements.sendButton.classList.toggle('stop-mode', busy);
        elements.sendButton.setAttribute('aria-label', busy ? 'Stop generating' : 'Send message');
        elements.sendButton.title = busy ? 'Stop generating (Esc)' : 'Send message (Enter)';
      }
      if (elements.newChatButton) {
        elements.newChatButton.disabled = busy;
        elements.newChatButton.classList.toggle('disabled', busy);
      }
      document.querySelectorAll('.conversation-item').forEach((item) => {
        item.classList.toggle('disabled', busy);
      });
      document.querySelectorAll('.resend-btn').forEach((btn) => {
        btn.disabled = busy;
      });
      if (elements.modelPill) elements.modelPill.disabled = busy;
      const status = document.getElementById('chatStatus');
      if (status) status.textContent = busy ? 'Generating a reply' : 'Reply finished';
    }

    // ---------- scrolling

    function isNearBottom(threshold = 80) {
      const s = elements.chatScroll;
      if (!s) return true;
      return s.scrollHeight - s.scrollTop - s.clientHeight <= threshold;
    }

    function scrollToBottom({ smooth = false } = {}) {
      const s = elements.chatScroll;
      if (!s) return;
      if (smooth) {
        s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
      } else {
        s.scrollTop = s.scrollHeight;
      }
      updateScrollButton();
    }

    function updateScrollButton() {
      if (!elements.scrollToBottomButton) return;
      elements.scrollToBottomButton.classList.toggle('hidden', isNearBottom(120));
    }

    // ---------- input

    function focusInput() {
      elements.messageInput?.focus();
    }

    /** Focuses the input only when it will not steal focus or a text selection. */
    function focusInputIfIdle() {
      const active = document.activeElement;
      const selection = window.getSelection ? window.getSelection() : null;
      const hasSelection = selection && !selection.isCollapsed;
      if ((!active || active === document.body || active === elements.sendButton) && !hasSelection) {
        elements.messageInput?.focus({ preventScroll: true });
      }
    }

    function resetInput() {
      if (!elements.messageInput) return;
      elements.messageInput.value = '';
      elements.messageInput.style.height = '';
    }

    // ---------- messages

    function clearChat() {
      if (elements.chatContainer) elements.chatContainer.innerHTML = '';
      updateScrollButton();
    }

    function removeErrorBubbles() {
      elements.chatContainer?.querySelectorAll('.error-message').forEach((n) => n.remove());
    }

    function removeMessagesAfter(node) {
      let next = node.nextSibling;
      while (next) {
        const after = next.nextSibling;
        next.remove();
        next = after;
      }
    }

    /**
     * Renders a user message bubble.
     * @param {string} text
     * @param {number} index - Position in the conversation's message array
     * @param {Object} [params] - Sampling parameters used for the reply
     */
    function renderUserMessage(text, index, params) {
      const messageDiv = el('div', 'message user-message');
      messageDiv.dataset.index = String(index);
      const body = el('div', 'user-message-body');
      body.innerHTML = MarkdownParser.parse(text);
      messageDiv.appendChild(body);
      addResendControls(messageDiv, index, params);

      const stick = isNearBottom();
      elements.chatContainer.appendChild(messageDiv);
      if (stick) scrollToBottom();
      return messageDiv;
    }

    function formatParams(params) {
      if (!params) return '';
      const parts = [];
      if (params.temperature !== undefined) parts.push(`T ${Number(params.temperature).toFixed(2)}`);
      if (params.top_k !== undefined) parts.push(`K ${params.top_k}`);
      if (params.top_p !== undefined) parts.push(`P ${Number(params.top_p).toFixed(2)}`);
      return parts.join(' · ');
    }

    function buildMeta(message) {
      const parts = [];
      if (message.model) parts.push(message.model);
      const params = formatParams(message.params);
      if (params) parts.push(params);
      const stats = message.stats;
      if (stats && stats.evalTokens) {
        let s = `${stats.evalTokens} tokens`;
        if (stats.evalDurationNs) {
          const tps = stats.evalTokens / (stats.evalDurationNs / 1e9);
          if (Number.isFinite(tps)) s += ` · ${tps.toFixed(1)} tok/s`;
        }
        parts.push(s);
      }
      if (message.droppedFromContext) {
        parts.push(`${message.droppedFromContext} earlier message${message.droppedFromContext === 1 ? '' : 's'} left out of the context`);
      }
      if (message.interrupted) parts.push('stopped');
      if (message.doneReason === 'length') parts.push('cut off: output limit reached');
      return parts.join('  ·  ');
    }

    /**
     * Creates the DOM for an assistant reply and returns a controller used to
     * stream content into it.  Rendering is throttled to one update per frame.
     */
    function createAssistantMessage({ collapsedThinking = false } = {}) {
      const container = el('div', 'message-container assistant-message');

      const think = el('div', 'message-think streaming');
      const header = el('button', 'think-header');
      header.type = 'button';
      header.setAttribute('aria-expanded', 'true');
      const icon = el('img', 'loading-icon');
      icon.src = 'media/assistant.png';
      icon.alt = '';
      const label = el('span', 'think-label', 'Thinking…');
      const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chevron.setAttribute('viewBox', '0 0 24 24');
      chevron.setAttribute('class', 'think-chevron');
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML = '<path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>';
      header.append(icon, label, chevron);
      const body = el('div', 'think-body');
      think.append(header, body);
      header.addEventListener('click', () => {
        const collapsed = think.classList.toggle('collapsed');
        header.setAttribute('aria-expanded', String(!collapsed));
      });
      if (collapsedThinking) {
        think.classList.add('collapsed');
        header.setAttribute('aria-expanded', 'false');
      }

      const response = el('div', 'message-response');
      const meta = el('div', 'message-meta hidden');
      container.append(think, response, meta);

      const stick = isNearBottom();
      elements.chatContainer.appendChild(container);
      if (stick) scrollToBottom();

      let latestThinking = '';
      let latestContent = '';
      let pendingThinking = null;
      let pendingContent = null;
      let scheduled = false;
      let hasThinking = false;
      let hasContent = false;
      let thinkingStart = null;
      let thinkingEnd = null;
      let thinkingDone = false;

      function render() {
        scheduled = false;
        const wasNearBottom = isNearBottom();
        if (pendingThinking !== null) {
          body.innerHTML = MarkdownParser.parse(pendingThinking);
          pendingThinking = null;
        }
        if (pendingContent !== null) {
          response.innerHTML = MarkdownParser.parse(pendingContent);
          pendingContent = null;
        }
        if (wasNearBottom) scrollToBottom();
        else updateScrollButton();
      }

      function schedule() {
        if (!scheduled) {
          scheduled = true;
          requestAnimationFrame(render);
        }
      }

      /**
       * Ends the "Thinking…" state. Safe to call repeatedly: an explicit
       * duration (from a stored message) always wins over the measured one.
       */
      function finishThinking(durationMs) {
        think.classList.remove('streaming');
        if (!hasThinking) {
          think.classList.add('hidden');
          thinkingDone = true;
          return;
        }
        think.classList.remove('hidden');
        if (!thinkingDone) {
          thinkingDone = true;
          thinkingEnd = performance.now();
        }
        const ms = Number.isFinite(durationMs)
          ? durationMs
          : thinkingStart !== null && thinkingEnd !== null
            ? thinkingEnd - thinkingStart
            : NaN;
        label.textContent = Number.isFinite(ms) && ms >= 500 ? `Thought for ${formatSeconds(ms)}` : 'Thinking';
      }

      return {
        container,
        setThinking(text) {
          latestThinking = text;
          if (!hasThinking) {
            hasThinking = true;
            thinkingStart = performance.now();
            think.classList.add('has-content');
            think.classList.remove('hidden');
            if (!hasContent) think.classList.add('streaming');
          }
          pendingThinking = text;
          schedule();
        },
        setResponse(text) {
          latestContent = text;
          if (!hasContent) {
            hasContent = true;
            finishThinking();
          }
          pendingContent = text;
          schedule();
        },
        getPartial() {
          return { thinking: latestThinking, content: latestContent };
        },
        /** Final render with the persisted message (also used when reloading). */
        finish(message) {
          render();
          finishThinking(message.thinkingDurationMs);
          if (!message.content) {
            response.innerHTML = message.interrupted
              ? '<p class="empty-note">Stopped before the model answered.</p>'
              : '<p class="empty-note">The model returned no answer.</p>';
          }
          const metaText = buildMeta(message);
          if (metaText) {
            meta.textContent = metaText;
            meta.classList.remove('hidden');
          }
          updateScrollButton();
        },
        /** Removes the bubble entirely (used when nothing was received). */
        discard() {
          container.remove();
        },
      };
    }

    /**
     * Renders a stored assistant message (used when loading a conversation).
     */
    function renderAssistantMessage(message) {
      const ui = createAssistantMessage({ collapsedThinking: true });
      const thinking = message.thinking !== undefined ? message.thinking : splitThinkTags(message.content).thinking;
      const content = message.thinking !== undefined ? message.content : splitThinkTags(message.content).content;
      if (thinking) ui.setThinking(thinking);
      if (content) ui.setResponse(content);
      ui.finish({ ...message, content, thinkingDurationMs: message.thinkingDurationMs });
      return ui;
    }

    /**
     * Renders an error bubble with an optional Retry action.
     * @param {string} text
     * @param {Function} [onRetry]
     */
    function renderErrorMessage(text, onRetry) {
      const bubble = el('div', 'message assistant-message error-message');
      bubble.setAttribute('role', 'alert');
      bubble.append(el('div', 'error-title', 'Something went wrong'));
      bubble.append(el('div', 'error-detail', text));
      if (onRetry) {
        const retry = el('button', 'retry-btn', 'Retry');
        retry.type = 'button';
        retry.addEventListener('click', () => {
          bubble.remove();
          onRetry();
        });
        bubble.append(retry);
      }
      const stick = isNearBottom();
      elements.chatContainer.appendChild(bubble);
      if (stick) scrollToBottom();
      return bubble;
    }

    // ---------- regenerate controls

    function addResendControls(messageDiv, index, params) {
      const model = selectedModelSettings.get();
      const temperature = params?.temperature ?? model?.temperature ?? 0.7;
      const top_k = params?.top_k ?? model?.top_k ?? 40;
      const top_p = params?.top_p ?? model?.top_p ?? 0.9;

      const controls = el('div', 'resend-controls');
      controls.innerHTML = `
        <button class="resend-toggle" type="button" aria-label="Regenerate with different parameters" title="Regenerate with different parameters" aria-expanded="false">
          <svg class="settings-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1c0 .33.03.65.07.97l-2.11 1.66c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64L19.43 13Z"/>
          </svg>
        </button>
        <div class="parameter-panel" role="group" aria-label="Sampling parameters">
          <div class="param-group">
            <div class="slider-header">
              <label class="value-label" for="temp-${index}">Temperature</label>
              <span class="value-display" data-for="temp">${Number(temperature).toFixed(2)}</span>
            </div>
            <input type="range" id="temp-${index}" class="param-slider temp" min="0" max="2" step="0.05" value="${temperature}">
          </div>
          <div class="param-group">
            <div class="slider-header">
              <label class="value-label" for="topk-${index}">Top-K</label>
              <span class="value-display" data-for="topk">${Math.round(top_k)}</span>
            </div>
            <input type="range" id="topk-${index}" class="param-slider topk" min="1" max="100" step="1" value="${top_k}">
          </div>
          <div class="param-group">
            <div class="slider-header">
              <label class="value-label" for="topp-${index}">Top-P</label>
              <span class="value-display" data-for="topp">${Number(top_p).toFixed(2)}</span>
            </div>
            <input type="range" id="topp-${index}" class="param-slider topp" min="0" max="1" step="0.01" value="${top_p}">
          </div>
          <p class="regenerate-note hidden"></p>
          <button class="resend-btn" type="button">
            <svg class="refresh-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
            Regenerate
          </button>
        </div>
      `;

      const toggle = controls.querySelector('.resend-toggle');
      const panel = controls.querySelector('.parameter-panel');

      controls.querySelectorAll('.param-slider').forEach((slider) => {
        const display = controls.querySelector(`.value-display[data-for="${slider.classList[1]}"]`);
        slider.addEventListener('input', () => {
          display.textContent =
            slider.classList.contains('topk')
              ? String(Math.round(Number(slider.value)))
              : Number(slider.value).toFixed(2);
        });
      });

      function positionPanel() {
        const rect = messageDiv.getBoundingClientRect();
        const bounds = elements.chatScroll?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight };
        const spaceBelow = bounds.bottom - rect.bottom;
        const spaceAbove = rect.top - bounds.top;
        panel.classList.toggle('above', spaceBelow < 340 && spaceAbove > spaceBelow);
      }

      function setOpen(open) {
        controls.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', String(open));
        if (open) {
          const conversation = StateManager.getCurrentConversation();
          const later = conversation ? conversation.messages.length - (index + 2) : 0;
          const note = controls.querySelector('.regenerate-note');
          if (later > 0) {
            note.textContent = `Regenerating removes the ${later} later message${later === 1 ? '' : 's'}.`;
            note.classList.remove('hidden');
          } else {
            note.classList.add('hidden');
          }
          positionPanel();
        }
      }

      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(!controls.classList.contains('open'));
      });
      messageDiv.addEventListener('mouseenter', positionPanel);
      controls.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && controls.classList.contains('open')) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          toggle.focus();
        }
      });

      controls.querySelector('.resend-btn').addEventListener('click', () => {
        if (StateManager.isAppLoading()) {
          showToast('Wait for the current response to finish, or stop it first', 'warning');
          return;
        }
        const chosen = {
          temperature: parseFloat(controls.querySelector('.temp').value),
          top_k: parseInt(controls.querySelector('.topk').value, 10),
          top_p: parseFloat(controls.querySelector('.topp').value),
        };
        setOpen(false);
        ChatController.regenerate(index, chosen);
      });

      messageDiv.appendChild(controls);
    }

    // ---------- conversation list

    function dismissDeleteConfirmations() {
      document.querySelectorAll('.conversation-delete-confirm').forEach((n) => n.remove());
    }

    function closeParameterPanels() {
      let closed = 0;
      document.querySelectorAll('.resend-controls.open').forEach((controls) => {
        controls.classList.remove('open');
        controls.querySelector('.resend-toggle')?.setAttribute('aria-expanded', 'false');
        closed++;
      });
      return closed;
    }

    /** One document-level listener closes transient popovers on outside clicks / Escape. */
    function bindOutsideClickDismiss() {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !e.defaultPrevented && closeParameterPanels() > 0) {
          e.preventDefault();
        }
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.conversation-delete-confirm') && !e.target.closest('.conversation-delete-btn')) {
          dismissDeleteConfirmations();
        }
        document.querySelectorAll('.resend-controls.open').forEach((controls) => {
          if (!controls.contains(e.target)) {
            controls.classList.remove('open');
            controls.querySelector('.resend-toggle')?.setAttribute('aria-expanded', 'false');
          }
        });
      });
    }

    function updateConversationList(conversations, currentId, { onSelect, onDelete, onDownload }) {
      const list = elements.conversationList;
      if (!list) return;
      list.innerHTML = '';

      if (conversations.length === 0) {
        list.appendChild(el('div', 'conversation-empty', 'No conversations yet'));
        return;
      }

      const busy = StateManager.isAppLoading();

      conversations.forEach((conv) => {
        const item = el('div', 'conversation-item');
        item.dataset.conversationId = String(conv.id);
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        if (conv.id === currentId) {
          item.classList.add('active');
          item.setAttribute('aria-current', 'true');
        }
        if (busy) item.classList.add('disabled');

        const title = el('span', 'conversation-title', conv.title || 'New chat');
        title.title = conv.title || 'New chat';
        item.appendChild(title);

        const buttons = el('div', 'conversation-btn-container');

        const download = el('button', 'conversation-download-btn');
        download.type = 'button';
        download.title = 'Download this conversation';
        download.setAttribute('aria-label', 'Download this conversation');
        download.innerHTML =
          '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>';
        download.addEventListener('click', (e) => {
          e.stopPropagation();
          onDownload(conv.id);
        });
        buttons.appendChild(download);

        const remove = el('button', 'conversation-delete-btn');
        remove.type = 'button';
        remove.title = 'Delete this conversation';
        remove.setAttribute('aria-label', 'Delete this conversation');
        remove.innerHTML =
          '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
        remove.addEventListener('click', (e) => {
          e.stopPropagation();
          dismissDeleteConfirmations();

          const confirmUI = el('div', 'conversation-delete-confirm');
          confirmUI.innerHTML = `
            <span>Delete?</span>
            <div class="confirm-buttons">
              <button class="confirm-yes" type="button">Yes</button>
              <button class="confirm-no" type="button">No</button>
            </div>
          `;
          item.appendChild(confirmUI);
          confirmUI.querySelector('.confirm-yes').addEventListener('click', (ev) => {
            ev.stopPropagation();
            confirmUI.remove();
            onDelete(conv.id);
          });
          confirmUI.querySelector('.confirm-no').addEventListener('click', (ev) => {
            ev.stopPropagation();
            confirmUI.remove();
          });
          confirmUI.querySelector('.confirm-no').focus();
        });
        buttons.appendChild(remove);
        item.appendChild(buttons);

        const select = (e) => {
          if (e.target.closest('.conversation-btn-container') || e.target.closest('.conversation-delete-confirm')) return;
          onSelect(conv.id);
        };
        item.addEventListener('click', select);
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            select(e);
          }
        });

        list.appendChild(item);
      });
    }

    // ---------- sidebar / theme / model pill

    function setSidebar(open) {
      if (!elements.sidebar) return;
      elements.sidebar.classList.toggle('active', open);
      if (elements.toggleSidebarButton) {
        elements.toggleSidebarButton.classList.toggle('sidebar-closed', !open);
        elements.toggleSidebarButton.setAttribute('aria-expanded', String(open));
      }
      elements.mainContent?.classList.toggle('sidebar-active', open);
      try {
        localStorage.setItem(STORAGE_KEYS.sidebar, open ? '1' : '0');
      } catch {
        /* ignore */
      }
    }

    function toggleSidebar() {
      setSidebar(!elements.sidebar?.classList.contains('active'));
    }

    function isSidebarOpen() {
      return !!elements.sidebar?.classList.contains('active');
    }

    function toggleTheme() {
      const html = document.documentElement;
      const icon = document.querySelector('.theme-toggle-icon');
      const dark = !html.classList.contains('dark-mode');
      html.classList.toggle('dark-mode', dark);
      if (icon) icon.src = dark ? 'media/sun.png' : 'media/moon.png';
      try {
        localStorage.setItem('theme', dark ? 'dark' : 'light');
      } catch {
        /* ignore */
      }
    }

    function setModelPill(model) {
      if (!elements.modelPill) return;
      if (!model) {
        elements.modelPill.classList.add('hidden');
        return;
      }
      elements.modelPillName.textContent = model.name;
      elements.modelPill.title = `Current model: ${model.name}. Click to change model.`;
      elements.modelPill.classList.remove('hidden');
    }

    function init() {
      bindOutsideClickDismiss();
      if (elements.chatScroll) {
        elements.chatScroll.addEventListener('scroll', updateScrollButton, { passive: true });
      }
      if (elements.scrollToBottomButton) {
        elements.scrollToBottomButton.addEventListener('click', () => scrollToBottom({ smooth: true }));
      }
      if (elements.messageInput) {
        elements.messageInput.addEventListener('input', () => {
          const input = elements.messageInput;
          input.style.height = 'auto';
          input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
        });
      }
      let sidebarOpen = false;
      try {
        sidebarOpen = localStorage.getItem(STORAGE_KEYS.sidebar) === '1';
      } catch {
        /* ignore */
      }
      setSidebar(sidebarOpen && window.innerWidth >= 768);
    }

    init();

    return {
      elements,
      showToast,
      setBusy,
      isNearBottom,
      scrollToBottom,
      focusInput,
      focusInputIfIdle,
      resetInput,
      clearChat,
      removeErrorBubbles,
      removeMessagesAfter,
      renderUserMessage,
      createAssistantMessage,
      renderAssistantMessage,
      renderErrorMessage,
      updateConversationList,
      setSidebar,
      toggleSidebar,
      isSidebarOpen,
      toggleTheme,
      setModelPill,
    };
  })();

  // ==============================
  // Export Utilities
  // ==============================

  const ExportImportManager = (function () {
    function conversationToText(conversation) {
      const lines = [];
      lines.push(`# ${conversation.title || 'Conversation'}`);
      lines.push(`Created: ${conversation.createdAt || ''}`);
      if (conversation.model) lines.push(`Model: ${conversation.model}`);
      lines.push('');

      conversation.messages.forEach((msg) => {
        if (msg.role === 'assistant') {
          const thinking = msg.thinking !== undefined ? msg.thinking : splitThinkTags(msg.content).thinking;
          const content = msg.thinking !== undefined ? msg.content : splitThinkTags(msg.content).content;
          const details = [];
          if (msg.model) details.push(msg.model);
          if (msg.params) {
            details.push(
              `temperature=${msg.params.temperature}, top_k=${msg.params.top_k}, top_p=${msg.params.top_p}`
            );
          }
          if (msg.interrupted) details.push('stopped by user');
          lines.push(`## Assistant${details.length ? ` (${details.join('; ')})` : ''}`);
          if (thinking) {
            lines.push('');
            lines.push('### Thinking');
            lines.push(thinking);
          }
          lines.push('');
          lines.push('### Response');
          lines.push(content || '(no answer)');
        } else {
          lines.push(`## ${msg.role === 'system' ? 'System' : 'User'}`);
          lines.push(msg.content);
        }
        lines.push('');
      });
      return lines.join('\n');
    }

    function downloadConversation(conversationId) {
      const conversation = conversationId
        ? StateManager.getConversationById(conversationId)
        : StateManager.getCurrentConversation();
      if (!conversation) {
        UIManager.showToast('Nothing to download yet', 'warning');
        return;
      }
      if (conversation.messages.length === 0) {
        UIManager.showToast('This conversation is empty', 'warning');
        return;
      }

      const blob = new Blob([conversationToText(conversation)], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const slug = (conversation.title || 'chat').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'chat';
      a.download = `yla-${slug}-${new Date(conversation.createdAt || Date.now()).toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    return { downloadConversation };
  })();

  // ==============================
  // Chat Controller
  // ==============================

  const ChatController = (function () {
    let abortController = null;

    /** Tokens available for the history after reserving room for the reply. */
    function historyBudget(model) {
      const numCtx = Number(model.num_ctx) || 4096;
      const reserve = Number(config.api?.reserveTokens) || Math.max(2048, Math.floor(numCtx / 4));
      const systemTokens = estimateTokens(model.systemMessage || '') + 32;
      return Math.max(512, numCtx - reserve - systemTokens);
    }

    function samplingOptions(model, params) {
      const options = {};
      const temperature = params?.temperature ?? model.temperature;
      const top_k = params?.top_k ?? model.top_k;
      const top_p = params?.top_p ?? model.top_p;
      if (Number.isFinite(Number(temperature))) options.temperature = Number(temperature);
      if (Number.isFinite(Number(top_k))) options.top_k = Math.round(Number(top_k));
      if (Number.isFinite(Number(top_p))) options.top_p = Number(top_p);
      if (Number.isFinite(Number(model.num_ctx))) options.num_ctx = Number(model.num_ctx);
      return options;
    }

    /**
     * Requests a reply to the user message at `userIndex` of the current
     * conversation, streaming it into the chat.
     */
    async function generate(userIndex, params) {
      const model = selectedModelSettings.get();
      if (!model) {
        UIManager.showToast('Please select a model first', 'warning');
        return;
      }
      const conversation = StateManager.getCurrentConversation();
      if (!conversation) return;
      const conversationId = conversation.id;

      StateManager.truncateMessages(conversationId, userIndex);
      const userNode = UIManager.elements.chatContainer?.querySelector(
        `.user-message[data-index="${userIndex}"]`
      );
      if (userNode) UIManager.removeMessagesAfter(userNode);
      const options = samplingOptions(model, params);
      const effectiveParams = {
        temperature: options.temperature,
        top_k: options.top_k,
        top_p: options.top_p,
      };
      const { messages, dropped } = StateManager.buildHistory(conversation, historyBudget(model));

      StateManager.setLoading(true);
      UIManager.removeErrorBubbles();
      const ui = UIManager.createAssistantMessage();
      UIManager.scrollToBottom();
      abortController = new AbortController();
      const startedAt = performance.now();
      let thinkingEndedAt = null;

      /** Splits inline <think> tags out of a reply from a model without native thinking. */
      const normalizeReply = ({ thinking, content }) => {
        if (!thinking) {
          const inline = splitInlineThinking(content);
          if (inline) return { thinking: inline.thinking, content: inline.content || '' };
        }
        return { thinking: thinking || '', content: content || '' };
      };

      try {
        const result = await apiChat({
          model: model.name,
          messages,
          options,
          think: resolveThink(model),
          keepAlive: config.api?.keepAlive,
          signal: abortController.signal,
          onThinking: (_delta, all) => ui.setThinking(all),
          onContent: (_delta, all) => {
            const head = all.trimStart();
            if (head.length < 7 && '<think>'.startsWith(head)) return; // may become a think block
            const inline = splitInlineThinking(all);
            if (inline) {
              if (inline.thinking) ui.setThinking(inline.thinking);
              if (inline.content === null) return; // still inside the think block
              if (thinkingEndedAt === null) thinkingEndedAt = performance.now();
              ui.setResponse(inline.content);
              return;
            }
            if (thinkingEndedAt === null) thinkingEndedAt = performance.now();
            ui.setResponse(all);
          },
        });

        const reply = normalizeReply(result);
        if (!reply.content && !reply.thinking) {
          ui.discard();
          if (!result.aborted) {
            UIManager.renderErrorMessage('The model returned an empty response.', () =>
              generate(userIndex, params)
            );
          }
          return;
        }

        const message = {
          role: 'assistant',
          content: reply.content,
          thinking: reply.thinking,
          model: model.name,
          params: effectiveParams,
          stats: result.stats,
          doneReason: result.doneReason,
          interrupted: result.aborted || undefined,
          droppedFromContext: dropped || undefined,
          thinkingDurationMs: reply.thinking ? Math.round((thinkingEndedAt || performance.now()) - startedAt) : undefined,
        };
        StateManager.addMessage(conversationId, message);
        ui.finish(message);
      } catch (error) {
        console.error('Error calling model:', error);
        if (!(error instanceof Object && error.status)) {
          // Network-level failure: let the header re-check the connection.
          document.dispatchEvent(new CustomEvent('yla:request-failed'));
        }
        const partial = normalizeReply(ui.getPartial());
        if (partial.content || partial.thinking) {
          const message = {
            role: 'assistant',
            content: partial.content,
            thinking: partial.thinking,
            model: model.name,
            params: effectiveParams,
            interrupted: true,
            droppedFromContext: dropped || undefined,
          };
          StateManager.addMessage(conversationId, message);
          ui.finish(message);
        } else {
          ui.discard();
        }
        UIManager.renderErrorMessage(describeError(error), () => generate(userIndex, params));
      } finally {
        abortController = null;
        StateManager.setLoading(false);
        updateConversationList();
        UIManager.focusInputIfIdle();
      }
    }

    function sendMessage() {
      const model = selectedModelSettings.get();
      if (!model) {
        UIManager.showToast('Please select a model first', 'warning');
        return;
      }
      if (StateManager.isAppLoading()) {
        UIManager.showToast('Wait for the current response to finish, or stop it first', 'warning');
        return;
      }
      const input = UIManager.elements.messageInput;
      const text = input ? input.value.trim() : '';
      if (!text) return;

      UIManager.resetInput();
      const conversation = StateManager.ensureConversation();
      const index = StateManager.addMessage(conversation.id, { role: 'user', content: text });
      UIManager.renderUserMessage(text, index);
      updateConversationList();
      generate(index);
    }

    function stopGeneration() {
      if (abortController) abortController.abort();
    }

    /**
     * Re-asks the user message at `index` with new sampling parameters,
     * discarding everything after it.
     */
    function regenerate(index, params) {
      if (StateManager.isAppLoading()) return;
      const conversation = StateManager.getCurrentConversation();
      if (!conversation || !conversation.messages[index] || conversation.messages[index].role !== 'user') return;

      generate(index, params);
    }

    function renderConversation(conversation) {
      UIManager.clearChat();
      if (!conversation) return;
      conversation.messages.forEach((msg, index) => {
        if (msg.role === 'user') {
          const next = conversation.messages[index + 1];
          UIManager.renderUserMessage(msg.content, index, next?.role === 'assistant' ? next.params : undefined);
        } else if (msg.role === 'assistant') {
          UIManager.renderAssistantMessage(msg);
        }
      });
      UIManager.scrollToBottom();
    }

    function startNewConversation() {
      if (!selectedModelSettings.get()) {
        UIManager.showToast('Please select a model first', 'warning');
        return;
      }
      if (StateManager.isAppLoading()) {
        UIManager.showToast('Wait for the current response to finish, or stop it first', 'warning');
        return;
      }
      const current = StateManager.getCurrentConversation();
      if (!current || current.messages.length > 0) {
        StateManager.createConversation();
        StateManager.pruneEmpty();
      }
      UIManager.clearChat();
      updateConversationList();
      UIManager.focusInput();
    }

    function loadConversation(conversationId) {
      if (StateManager.isAppLoading()) {
        UIManager.showToast('Wait for the current response to finish, or stop it first', 'warning');
        return;
      }
      if (!StateManager.setCurrentConversation(conversationId)) return;
      StateManager.pruneEmpty();
      renderConversation(StateManager.getCurrentConversation());
      updateConversationList();
      if (window.innerWidth < 768) UIManager.setSidebar(false);
      UIManager.focusInput();
    }

    function deleteConversation(conversationId) {
      if (StateManager.isAppLoading()) {
        UIManager.showToast('Wait for the current response to finish, or stop it first', 'warning');
        return;
      }
      const wasCurrent = StateManager.getCurrentConversation()?.id === conversationId;
      if (!StateManager.deleteConversation(conversationId)) return;
      if (wasCurrent) {
        const next = StateManager.getConversations()[0];
        if (next) {
          StateManager.setCurrentConversation(next.id);
          renderConversation(next);
        } else {
          StateManager.createConversation();
          UIManager.clearChat();
        }
      }
      updateConversationList();
    }

    function updateConversationList() {
      UIManager.updateConversationList(
        StateManager.getConversations(),
        StateManager.getCurrentConversation()?.id,
        {
          onSelect: loadConversation,
          onDelete: deleteConversation,
          onDownload: ExportImportManager.downloadConversation,
        }
      );
    }

    /** Called whenever the user picks a model in the selector. */
    function onModelSelected(model) {
      UIManager.setModelPill(model);
      const current = StateManager.getCurrentConversation();
      if (!current) {
        StateManager.createConversation();
        UIManager.clearChat();
      } else if (UIManager.elements.chatContainer?.childElementCount === 0 && current.messages.length > 0) {
        renderConversation(current);
      }
      updateConversationList();
      UIManager.focusInput();
    }

    function changeModel() {
      if (StateManager.isAppLoading()) {
        UIManager.showToast('Wait for the current response to finish, or stop it first', 'warning');
        return;
      }
      showModelSelector();
    }

    function init() {
      document.addEventListener('yla:model-selected', (e) => onModelSelected(e.detail));
      // The active model was deleted from Ollama: the chat needs a new one.
      document.addEventListener('yla:model-removed', () => UIManager.setModelPill(null));
      window.addEventListener('beforeunload', () => StateManager.pruneEmpty());
      const model = selectedModelSettings.get();
      if (model) onModelSelected(model);
    }

    init();

    return {
      sendMessage,
      stopGeneration,
      regenerate,
      startNewConversation,
      loadConversation,
      deleteConversation,
      updateConversationList,
      changeModel,
      isGenerating: () => StateManager.isAppLoading(),
    };
  })();

  return {
    sendMessage: ChatController.sendMessage,
    stopGeneration: ChatController.stopGeneration,
    isGenerating: ChatController.isGenerating,
    startNewConversation: ChatController.startNewConversation,
    changeModel: ChatController.changeModel,
    toggleSidebar: UIManager.toggleSidebar,
    setSidebar: UIManager.setSidebar,
    isSidebarOpen: UIManager.isSidebarOpen,
    toggleTheme: UIManager.toggleTheme,
    showToast: UIManager.showToast,
    downloadConversation: ExportImportManager.downloadConversation,
    updateConversationList: ChatController.updateConversationList,
  };
})();

export const {
  sendMessage,
  stopGeneration,
  isGenerating,
  startNewConversation,
  changeModel,
  toggleSidebar,
  setSidebar,
  isSidebarOpen,
  toggleTheme,
  showToast,
  downloadConversation,
  updateConversationList,
} = ChatApp;
