/**
 * Ollama library client
 * ---------------------
 * Reads the catalogue of models published on ollama.com through the small
 * proxy built into `utils/serve.py` (the browser cannot read ollama.com
 * directly). Results are cached for the lifetime of the page.
 */

const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map();

/** Raised when the page is served by something other than utils/serve.py. */
export class LibraryUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LibraryUnavailableError';
  }
}

function apiUrl(path) {
  return new URL(path, window.location.href).toString();
}

async function getJson(path, { signal } = {}) {
  const key = path;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_TTL) return hit.value;

  let response;
  try {
    response = await fetch(apiUrl(path), { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new LibraryUnavailableError('The model library could not be loaded.');
  }
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (response.status === 404 || (response.ok && !data)) {
    throw new LibraryUnavailableError(
      'The model library is only available when the app is started with utils/serve.py (or run-yla.sh).'
    );
  }
  if (!response.ok) {
    throw new Error(data?.error || `The model library answered HTTP ${response.status}`);
  }
  cache.set(key, { time: Date.now(), value: data });
  return data;
}

/**
 * Models published on ollama.com, most popular first.
 * @returns {Promise<Array<{name: string, description: string, sizes: string[], capabilities: string[], pulls: string, updated: string}>>}
 */
export async function fetchLibrary(opts) {
  const data = await getJson('/api/library', opts);
  return Array.isArray(data.models) ? data.models : [];
}

/**
 * Tags (variants) of one library model, with download size and context window.
 * @returns {Promise<Array<{name: string, tag: string, size: string, context: string, inputs: string, updated: string, cloud: boolean}>>}
 */
export async function fetchLibraryTags(model, opts) {
  const data = await getJson(`/api/library/${encodeURIComponent(model)}`, opts);
  return Array.isArray(data.tags) ? data.tags : [];
}
