/**
 * Image attachments
 * -----------------
 * Images travel with a user message as `message.images` and are placed in the
 * text with markers such as `[image 1]`. The marker order is the order in which
 * Ollama receives the images, and each marker becomes Ollama's `[img]`
 * placeholder, so the model sees every image exactly where it was written.
 *
 * Image bytes live only in memory: `StateManager.persist` drops the `data`
 * field, so after a reload a message keeps its markers, file names and sizes
 * but shows a placeholder instead of the picture.
 */

export const MARKER_RE = /\[image (\d+)\]/g;
export const MAX_IMAGES = 10;
export const MAX_EDGE = 2048;
/** Rough prompt cost of one image, used when trimming the history. */
export const IMAGE_TOKENS = 768;

const OLLAMA_PLACEHOLDER = '[img]';

/**
 * Sorts a draft's images in the order their markers appear in the text,
 * appends a marker for every image the text no longer mentions, and renumbers
 * the markers 1..n so they match the returned array.
 * @param {string} text
 * @param {Array<Object>} images - draft attachments, each with an `id`
 * @returns {{content: string, images: Array<Object>}}
 */
export function finalizeDraft(text, images) {
  if (!images || images.length === 0) return { content: text, images: [] };
  const byId = new Map(images.map((img) => [String(img.id), img]));
  const ordered = [];
  const seen = new Set();
  let content = text.replace(MARKER_RE, (match, id) => {
    const img = byId.get(id);
    if (!img || seen.has(id)) return match; // typed by hand, or a duplicate: plain text
    seen.add(id);
    ordered.push(img);
    return `\u0000${ordered.length}\u0000`;
  });
  const missing = images.filter((img) => !seen.has(String(img.id)));
  if (missing.length) {
    const tail = missing.map((img) => {
      ordered.push(img);
      return `\u0000${ordered.length}\u0000`;
    });
    content = `${content.trimEnd()}${content.trim() ? '\n' : ''}${tail.join(' ')}`;
  }
  content = content.replace(/\u0000(\d+)\u0000/g, '[image $1]');
  return {
    content,
    images: ordered.map(({ id, ...rest }) => rest),
  };
}

/**
 * Converts a stored user message into what Ollama receives: `[img]` where an
 * image is still in memory, an explanatory note where it is not.
 * @param {Object} message - {content, images}
 * @returns {{content: string, images?: string[]}}
 */
export function toModelMessage(message) {
  const images = Array.isArray(message.images) ? message.images : [];
  if (images.length === 0) return { role: 'user', content: String(message.content || '') };
  const payload = [];
  const content = String(message.content || '').replace(MARKER_RE, (match, n) => {
    const img = images[Number(n) - 1];
    if (!img) return match;
    if (!img.data) return `[image ${n}: "${img.name}" was attached but is no longer available]`;
    payload.push(stripDataUrl(img.data));
    return OLLAMA_PLACEHOLDER;
  });
  const result = { role: 'user', content };
  if (payload.length) result.images = payload;
  return result;
}

/** Number of images of a message that will actually be sent. */
export function availableImageCount(message) {
  return (message.images || []).filter((img) => img.data).length;
}

export function stripDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Marker text used in exports and titles. */
export function describeMarkers(text, images) {
  return String(text || '').replace(MARKER_RE, (match, n) => {
    const img = images?.[Number(n) - 1];
    return img ? `[image ${n}: ${img.name}]` : match;
  });
}

/**
 * Loads a File into a data URL, downscaling very large pictures so the
 * request stays reasonable. Resolves {name, type, width, height, data, bytes}.
 */
export async function loadImageFile(file) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name || 'This file'} is not an image.`);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name || 'This image'} could not be decoded by the browser.`);
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const keepOriginal = scale === 1 && (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp');
    let blob = file;
    let width = bitmap.width;
    let height = bitmap.height;
    if (!keepOriginal) {
      width = Math.max(1, Math.round(bitmap.width * scale));
      height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      const type = file.type === 'image/png' || file.type === 'image/gif' ? 'image/png' : 'image/jpeg';
      blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
      if (!blob) throw new Error('The image could not be converted.');
    }
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('The image could not be read.'));
      reader.readAsDataURL(blob);
    });
    return { name: file.name || 'image', type: blob.type, width, height, data, bytes: blob.size };
  } finally {
    bitmap.close?.();
  }
}

export function formatDimensions(img) {
  return img?.width && img?.height ? `${img.width}×${img.height}` : '';
}

/**
 * Manages the attachment strip under the message input: adding images from
 * the file picker, the clipboard or a drop, inserting their markers at the
 * caret, and removing them.
 */
export function createAttachmentManager({ textarea, strip, fileInput, button, dropZone, canAttach, notify }) {
  let images = [];
  let nextId = 1;
  let busy = 0;

  function markerFor(img) {
    return `[image ${img.id}]`;
  }

  function insertMarker(img) {
    const marker = markerFor(img);
    if (textarea.value.includes(marker)) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const trail = after && !/^\s/.test(after) ? ' ' : ' ';
    const insert = `${lead}${marker}${trail}`;
    textarea.setRangeText(insert, start, end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function removeMarker(img) {
    const marker = markerFor(img);
    const value = textarea.value;
    if (!value.includes(marker)) return;
    textarea.value = value.replace(new RegExp(`[ \\t]?${marker.replace(/[[\]]/g, '\\$&')}[ \\t]?`, 'g'), (m) =>
      m.startsWith(' ') && m.endsWith(' ') ? ' ' : ''
    );
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function render() {
    strip.replaceChildren();
    strip.classList.toggle('hidden', images.length === 0);
    images.forEach((img) => {
      const item = document.createElement('div');
      item.className = 'attachment';
      item.dataset.id = String(img.id);
      item.title = `${img.name} · ${formatDimensions(img)} · click to place ${markerFor(img)} at the cursor`;

      const thumb = document.createElement('img');
      thumb.src = img.data;
      thumb.alt = img.name;
      thumb.addEventListener('click', () => {
        insertMarker(img);
        textarea.focus();
      });

      const badge = document.createElement('span');
      badge.className = 'attachment-badge';
      badge.textContent = String(img.id);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'attachment-remove';
      remove.setAttribute('aria-label', `Remove ${img.name}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        images = images.filter((i) => i !== img);
        removeMarker(img);
        render();
        textarea.focus();
      });

      item.append(thumb, badge, remove);
      strip.appendChild(item);
    });
  }

  async function addFiles(files) {
    const list = Array.from(files || []).filter((f) => f && f.type && f.type.startsWith('image/'));
    if (list.length === 0) {
      if (files && files.length) notify('Only images can be attached.', 'warning');
      return;
    }
    const allowed = canAttach();
    if (allowed !== true) {
      notify(allowed || 'The current model cannot read images.', 'warning');
      return;
    }
    if (images.length + list.length > MAX_IMAGES) {
      notify(`At most ${MAX_IMAGES} images per message.`, 'warning');
      list.length = Math.max(0, MAX_IMAGES - images.length);
      if (list.length === 0) return;
    }
    busy++;
    button.classList.add('loading');
    try {
      for (const file of list) {
        try {
          const loaded = await loadImageFile(file);
          const img = { id: nextId++, ...loaded };
          images.push(img);
          render();
          insertMarker(img);
        } catch (error) {
          notify(error.message || 'The image could not be read.', 'error');
        }
      }
    } finally {
      busy--;
      if (busy === 0) button.classList.remove('loading');
    }
  }

  function refreshAvailability() {
    const allowed = canAttach();
    button.disabled = allowed !== true;
    button.title =
      allowed === true
        ? 'Attach images (or paste / drop them into the message)'
        : allowed || 'The current model cannot read images';
  }

  function clear() {
    images = [];
    nextId = 1;
    render();
  }

  // ---- wiring
  button.addEventListener('click', () => {
    if (button.disabled) return;
    fileInput.value = '';
    fileInput.click();
  });
  fileInput.addEventListener('change', () => addFiles(fileInput.files));

  textarea.addEventListener('paste', (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const files = items.filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile());
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  });

  let dragDepth = 0;
  dropZone.addEventListener('dragenter', (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    dragDepth++;
    dropZone.classList.add('drop-active');
  });
  dropZone.addEventListener('dragover', (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  dropZone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropZone.classList.remove('drop-active');
  });
  dropZone.addEventListener('drop', (event) => {
    dragDepth = 0;
    dropZone.classList.remove('drop-active');
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  });

  return {
    /** Draft images, each with an `id` matching its `[image id]` marker. */
    getImages: () => images.slice(),
    hasImages: () => images.length > 0,
    isBusy: () => busy > 0,
    addFiles,
    clear,
    refreshAvailability,
  };
}
