import config from './config.js';

/**
 * Ollama API client
 * -----------------
 * Thin wrapper around the native Ollama HTTP API (not the OpenAI-compatible
 * layer, which ignores top_k / num_ctx and overrides Modelfile defaults).
 * Contains no DOM code so it can be unit-tested outside the browser.
 */

/** Error raised for HTTP or protocol failures; carries the HTTP status. */
export class ApiError extends Error {
  constructor(message, { status = 0, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (cause) this.cause = cause;
  }
}

/** Base URL of the Ollama server, without a trailing slash. */
export function getBaseUrl() {
  const api = config.api || {};
  let base = api.baseUrl;
  if (!base && api.endpoint) {
    // Backward compatibility with configs that only had an `endpoint` URL.
    try {
      base = new URL(api.endpoint).origin;
    } catch {
      base = null;
    }
  }
  return (base || 'http://localhost:11434').replace(/\/+$/, '');
}

function url(path) {
  return `${getBaseUrl()}${path}`;
}

/** Turns any thrown value into a short message suitable for the UI. */
export function describeError(error) {
  if (!error) return 'Unknown error';
  if (error.name === 'TimeoutError') return error.message || 'Ollama did not respond in time';
  if (error.name === 'AbortError') return 'Request cancelled';
  if (error instanceof ApiError) return error.message;
  const msg = String(error.message || error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return `Cannot reach Ollama at ${getBaseUrl()}. Is it running?`;
  }
  if (/^network error$/i.test(msg.trim())) {
    return 'The connection to Ollama was interrupted before the reply finished.';
  }
  return msg;
}

/** Extracts the error message from an Ollama error body (native or OpenAI-shaped). */
function errorMessageFromBody(body, status) {
  if (body && typeof body === 'object') {
    if (typeof body.error === 'string') return body.error;
    if (body.error && typeof body.error.message === 'string') return body.error.message;
  }
  if (typeof body === 'string' && body.trim()) {
    if (body.trimStart().startsWith('<')) {
      return `HTTP ${status} with a non-JSON body. Is ${getBaseUrl()} really an Ollama server?`;
    }
    return body.trim().slice(0, 300);
  }
  return `Ollama responded with HTTP ${status}`;
}

/** Parses a JSON body, turning HTML or garbage into a readable error. */
async function parseJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(
      `Unexpected non-JSON response from ${getBaseUrl()}. Is it really an Ollama server?`,
      { status: response.status }
    );
  }
}

async function throwForStatus(response) {
  const text = await response.text().catch(() => '');
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* plain text body */
  }
  throw new ApiError(errorMessageFromBody(body, response.status), { status: response.status });
}

/**
 * Reads a newline-delimited JSON stream, yielding one parsed object per line.
 * Handles multi-byte characters and JSON objects split across network chunks.
 * @param {ReadableStream} stream
 */
export async function* readNdjson(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed);
        } catch (e) {
          console.warn('Skipping malformed stream line:', trimmed.slice(0, 200));
        }
      }
      if (done) break;
    }
  } finally {
    // Cancel so the connection is closed even when the consumer stops early
    // (e.g. a pull that reported success before the body ended).
    try {
      await reader.cancel();
    } catch {
      /* stream already closed or errored */
    }
    reader.releaseLock();
  }
}

/** Fetch with a timeout expressed in milliseconds. */
async function fetchWithTimeout(resource, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException(`No response from Ollama within ${Math.round(timeoutMs / 1000)} s`, 'TimeoutError')
      ),
    timeoutMs
  );
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pings the server.
 * @returns {Promise<{version: string}>}
 */
export async function getVersion({ timeout = 5000 } = {}) {
  const response = await fetchWithTimeout(url('/api/version'), { method: 'GET' }, timeout);
  if (!response.ok) await throwForStatus(response);
  const data = await parseJson(response);
  return { version: data.version || '' };
}

/**
 * Lists the models installed on the server.
 * @returns {Promise<Array<{name: string, size: number}>>}
 */
export async function listModels({ timeout = 5000 } = {}) {
  const response = await fetchWithTimeout(url('/api/tags'), { method: 'GET' }, timeout);
  if (!response.ok) await throwForStatus(response);
  const data = await parseJson(response);
  return (data.models || []).map((m) => ({ name: m.name || m.model, size: m.size || 0 }));
}

/**
 * Parses the `parameters` blob returned by /api/show ("key   value" per line).
 */
function parseParameters(text) {
  const params = {};
  if (typeof text !== 'string') return params;
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^(\S+)\s+(.+)$/);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.trim().replace(/^"(.*)"$/, '$1');
    const num = Number(value);
    if (params[key] === undefined) {
      params[key] = Number.isFinite(num) && value !== '' ? num : value;
    } else {
      // Repeated keys (e.g. several `stop` entries) become arrays.
      params[key] = [].concat(params[key], value);
    }
  }
  return params;
}

/**
 * Returns capabilities, Modelfile parameters and system prompt for a model.
 * @returns {Promise<{capabilities: string[], parameters: Object, system: string, family: string, parentModel: string}>}
 */
export async function showModel(name, { timeout = 8000 } = {}) {
  const response = await fetchWithTimeout(
    url('/api/show'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
    timeout
  );
  if (!response.ok) await throwForStatus(response);
  const data = await parseJson(response);
  return {
    capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
    parameters: parseParameters(data.parameters),
    system: typeof data.system === 'string' ? data.system : '',
    family: data.details?.family || '',
    parentModel: data.details?.parent_model || '',
  };
}

/**
 * Decides the `think` value to send for a model.
 * @param {Object} model - Config entry, optionally with `capabilities` attached
 * @returns {boolean|string|undefined} undefined means "do not send the field"
 */
export function resolveThink(model) {
  if (!model) return undefined;
  if (model.think !== undefined && model.think !== null && model.think !== 'auto') {
    return model.think;
  }
  if (Array.isArray(model.capabilities)) {
    return model.capabilities.includes('thinking') ? true : undefined;
  }
  return undefined;
}

/**
 * Streams a chat completion.
 *
 * @param {Object} params
 * @param {string} params.model
 * @param {Array<{role: string, content: string}>} params.messages
 * @param {Object} [params.options] - Sampling options (temperature, top_k, top_p, num_ctx, ...)
 * @param {boolean|string} [params.think]
 * @param {string|number} [params.keepAlive]
 * @param {AbortSignal} [params.signal]
 * @param {Function} [params.onThinking] - (delta, accumulated) for reasoning tokens
 * @param {Function} [params.onContent] - (delta, accumulated) for answer tokens
 * @returns {Promise<{thinking: string, content: string, aborted: boolean, doneReason: string|null, stats: Object|null}>}
 */
export async function chat(params) {
  const { model, messages, options, think, keepAlive, signal, onThinking, onContent } = params;

  const payload = { model, messages, stream: true };
  if (options && Object.keys(options).length) payload.options = options;
  if (think !== undefined) payload.think = think;
  if (keepAlive !== undefined) payload.keep_alive = keepAlive;

  let response;
  try {
    response = await fetch(url('/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return { thinking: '', content: '', aborted: true, doneReason: null, stats: null };
    }
    throw error;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    const message = errorMessageFromBody(body, response.status);
    // Older or non-thinking models reject `think`; retry once without it.
    if (think !== undefined && /does not support thinking/i.test(message)) {
      return chat({ ...params, think: undefined });
    }
    throw new ApiError(message, { status: response.status });
  }

  let thinking = '';
  let content = '';
  let stats = null;
  let doneReason = null;

  try {
    for await (const chunk of readNdjson(response.body)) {
      if (chunk.error) {
        throw new ApiError(errorMessageFromBody(chunk, 200));
      }
      const msg = chunk.message || {};
      if (typeof msg.thinking === 'string' && msg.thinking) {
        thinking += msg.thinking;
        onThinking && onThinking(msg.thinking, thinking);
      }
      if (typeof msg.content === 'string' && msg.content) {
        content += msg.content;
        onContent && onContent(msg.content, content);
      }
      if (chunk.done) {
        doneReason = chunk.done_reason || 'stop';
        stats = {
          promptTokens: chunk.prompt_eval_count ?? null,
          promptDurationNs: chunk.prompt_eval_duration ?? null,
          evalTokens: chunk.eval_count ?? null,
          evalDurationNs: chunk.eval_duration ?? null,
          totalDurationNs: chunk.total_duration ?? null,
          loadDurationNs: chunk.load_duration ?? null,
        };
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return { thinking, content, aborted: true, doneReason: null, stats: null };
    }
    throw error;
  }

  return { thinking, content, aborted: false, doneReason, stats };
}

/**
 * Pulls a model from the Ollama library, reporting progress.
 * @param {string} name
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {Function} [opts.onProgress] - ({status, completed, total, percent})
 */
export async function pullModel(name, { signal, onProgress } = {}) {
  const response = await fetch(url('/api/pull'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: true }),
    signal,
  });
  if (!response.ok) await throwForStatus(response);

  const layers = new Map();
  for await (const chunk of readNdjson(response.body)) {
    if (chunk.error) throw new ApiError(chunk.error);
    const { status = '', digest, total, completed } = chunk;

    if (digest) {
      layers.set(digest, { total: total || 0, completed: completed || 0 });
    }
    let totalBytes = 0;
    let doneBytes = 0;
    for (const layer of layers.values()) {
      totalBytes += layer.total;
      doneBytes += layer.completed;
    }
    const percent = totalBytes > 0 ? Math.min(100, Math.round((doneBytes / totalBytes) * 100)) : 0;

    onProgress &&
      onProgress({
        status,
        completed: doneBytes,
        total: totalBytes,
        percent: status === 'success' ? 100 : percent,
        done: status === 'success',
        layer: !!digest,
      });
    if (status === 'success') return;
  }
}

/**
 * Creates a model on the server from an existing base model, the equivalent of
 * `ollama create` with a Modelfile made of FROM, SYSTEM and PARAMETER lines.
 * Progress statuses are streamed like a pull ("creating new layer", "success").
 * @param {Object} spec
 * @param {string} spec.name        Name of the model to create (tag optional)
 * @param {string} spec.from        Installed model to build on
 * @param {string} [spec.system]    System prompt baked into the model
 * @param {Object} [spec.parameters] Modelfile parameters (num_ctx, temperature, top_k, top_p, ...)
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {Function} [opts.onProgress] - ({status, done})
 */
export async function createModel({ name, from, system, parameters }, { signal, onProgress } = {}) {
  const body = { model: name, from, stream: true };
  if (typeof system === 'string' && system.trim()) body.system = system;
  if (parameters && Object.keys(parameters).length) body.parameters = parameters;

  const response = await fetch(url('/api/create'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) await throwForStatus(response);

  for await (const chunk of readNdjson(response.body)) {
    if (chunk.error) throw new ApiError(chunk.error);
    const status = chunk.status || '';
    const done = status === 'success';
    onProgress && onProgress({ status, done });
    if (done) return;
  }
  throw new ApiError('Ollama closed the connection before the model was created.');
}

/**
 * Deletes a model from the server (`ollama rm`).
 * @param {string} name
 */
export async function deleteModel(name, { timeout = 15000 } = {}) {
  const response = await fetchWithTimeout(
    url('/api/delete'),
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
    },
    timeout
  );
  if (!response.ok) await throwForStatus(response);
}
