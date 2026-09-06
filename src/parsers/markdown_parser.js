/**
 * Markdown Parser with Sanitization
 * ---------------------------------
 * Self-contained, dependency-free parser for the subset of Markdown that
 * chat models actually emit:
 *
 * - Headings (#, ##, …, ######)
 * - Paragraphs, hard line breaks (two trailing spaces or a backslash)
 * - Fenced code blocks (``` or ~~~, optional language, unclosed fences tolerated)
 * - Inline: bold, italic, bold+italic, strikethrough, inline code, links,
 *   bare URLs, images (rendered as links so nothing is fetched automatically)
 * - Horizontal rules
 * - Blockquotes
 * - Nested ordered / unordered / task lists
 * - Pipe tables with column alignment
 *
 * All text is HTML-escaped before any markup is generated, and link targets
 * are restricted to http(s), mailto and relative URLs, so model output cannot
 * inject markup or script.  Links open in a new tab so the chat is never
 * navigated away from.
 *
 * Example:
 *   element.innerHTML = MarkdownParser.parse(text);
 */
const MarkdownParser = (function () {
  'use strict';

  // ==============================
  // Helpers
  // ==============================

  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (m) => HTML_ESCAPES[m]);
  }

  /** Width of the leading whitespace of a line (tab = 4 columns). */
  function indentOf(line) {
    let cols = 0;
    for (const ch of line) {
      if (ch === ' ') cols += 1;
      else if (ch === '\t') cols += 4;
      else break;
    }
    return cols;
  }

  /** Removes up to `cols` columns of leading whitespace. */
  function stripIndent(line, cols) {
    let removed = 0;
    let i = 0;
    while (i < line.length && removed < cols) {
      if (line[i] === ' ') removed += 1;
      else if (line[i] === '\t') removed += 4;
      else break;
      i++;
    }
    return line.slice(i);
  }

  /**
   * Accepts a (already HTML-escaped) URL only if it cannot run script.
   * Relative URLs and http(s)/mailto are fine; anything with another scheme
   * (javascript:, data:, vbscript:, …) is rejected.
   */
  function isSafeUrl(url) {
    const trimmed = url.trim();
    if (/^(https?:|mailto:)/i.test(trimmed)) return true;
    return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  }

  function linkHtml(href, innerHtml, extraClass) {
    const cls = extraClass ? ` class="${extraClass}"` : '';
    return `<a href="${href.trim()}"${cls} target="_blank" rel="noopener noreferrer">${innerHtml}</a>`;
  }

  // ==============================
  // Inline parsing
  // ==============================

  const RE_CODE_SPAN = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  const RE_IMAGE = /!\[([^\]]*)\]\(\s*((?:[^\s()]|\([^\s()]*\))+)(?:\s+(?:&quot;|&#39;)[^)]*(?:&quot;|&#39;))?\s*\)/g;
  const RE_LINK = /\[([^\]]+)\]\(\s*((?:[^\s()]|\([^\s()]*\))+)(?:\s+(?:&quot;|&#39;)[^)]*(?:&quot;|&#39;))?\s*\)/g;
  const RE_ANGLE_AUTOLINK = /&lt;(https?:\/\/[^\s&]+(?:&amp;[^\s&]+)*)&gt;/g;
  const RE_BARE_URL = /(^|[\s(])(https?:\/\/[^\s<]+)/g;
  const RE_TRAILING_URL_PUNCT = /(?:[.,;:!?)\]*_~]+|&gt;|&quot;|&#39;)+$/;
  const RE_ESCAPED_PUNCT = /\\([\\`*_{}\[\]()#+\-.!|~<>])/g;

  /** Applies emphasis markup to already-escaped text. */
  function applyEmphasis(text) {
    return (
      text
        // ***bold italic***  (spans are bounded so unmatched markers stay linear)
        .replace(/\*\*\*(?=\S)([\s\S]{1,600}?)(?<=\S)\*\*\*/g, '<strong><em>$1</em></strong>')
        // **bold**
        .replace(/\*\*(?=\S)([\s\S]{1,600}?)(?<=\S)\*\*/g, '<strong>$1</strong>')
        // __bold__ (not inside words)
        .replace(/(?<![A-Za-z0-9_])__(?=\S)([\s\S]{1,600}?)(?<=\S)__(?![A-Za-z0-9_])/g, '<strong>$1</strong>')
        // ~~strikethrough~~
        .replace(/~~(?=\S)([\s\S]{1,600}?)(?<=\S)~~/g, '<del>$1</del>')
        // *italic*
        .replace(/\*(?=[^\s*])([^*\n]*?)(?<=[^\s*])\*/g, '<em>$1</em>')
        // _italic_ (not inside words such as snake_case)
        .replace(/(?<![A-Za-z0-9_])_(?=[^\s_])([^_\n]*?)(?<=[^\s_])_(?![A-Za-z0-9_])/g, '<em>$1</em>')
    );
  }

  /**
   * Splits a bare URL into the part to link and trailing punctuation that
   * belongs to the surrounding sentence (e.g. a final period or a closing
   * emphasis marker).
   * @returns {{href: string, rest: string}}
   */
  function splitBareUrl(url) {
    const trailing = url.match(RE_TRAILING_URL_PUNCT);
    let href = url;
    let rest = '';
    if (trailing) {
      href = url.slice(0, url.length - trailing[0].length);
      rest = trailing[0];
      // Keep closing parentheses that balance an opening one inside the URL,
      // e.g. https://en.wikipedia.org/wiki/A_(b)
      while (rest.startsWith(')') && (href.split('(').length > href.split(')').length)) {
        href += ')';
        rest = rest.slice(1);
      }
    }
    return { href, rest };
  }

  /**
   * Parses inline markdown.  Order matters: code spans and links are
   * extracted into placeholders first so that their contents are never
   * touched by emphasis or autolinking.
   */
  function parseInline(raw) {
    let text = escapeHtml(raw);
    const slots = [];
    const stash = (html) => {
      slots.push(html);
      return `\u0000${slots.length - 1}\u0000`;
    };

    // Backslash escapes: the escaped character must survive every later pass.
    text = text.replace(RE_ESCAPED_PUNCT, (_, ch) => stash(escapeHtml(ch)));

    text = text.replace(RE_CODE_SPAN, (_, ticks, code) => stash(`<code>${code.trim()}</code>`));

    text = text.replace(RE_IMAGE, (_, alt, src) =>
      isSafeUrl(src) ? stash(linkHtml(src, alt || src, 'md-image-link')) : alt
    );

    text = text.replace(RE_LINK, (_, label, href) =>
      isSafeUrl(href) ? stash(linkHtml(href, applyEmphasis(label))) : applyEmphasis(label)
    );

    text = text.replace(RE_ANGLE_AUTOLINK, (_, url) => stash(linkHtml(url, url)));
    text = text.replace(RE_BARE_URL, (_, lead, url) => {
      const { href, rest } = splitBareUrl(url);
      if (!href) return lead + url;
      return lead + stash(linkHtml(href, href)) + rest;
    });

    text = applyEmphasis(text);

    // Hard breaks: two trailing spaces or a backslash before a newline.
    // Other newlines inside a paragraph are soft breaks (rendered as a space).
    text = text.replace(/(?: {2,}|\\)\n/g, '<br>').replace(/\n/g, ' ');

    // Placeholders can nest (a code span inside a link label), so resolve until none remain.
    let guard = 0;
    while (/\u0000\d+\u0000/.test(text) && guard++ < 10) {
      text = text.replace(/\u0000(\d+)\u0000/g, (m, n) => (slots[Number(n)] !== undefined ? slots[Number(n)] : m));
    }
    return text;
  }

  // ==============================
  // Block parsing
  // ==============================

  const RE_FENCE = /^\s{0,3}(`{3,}|~{3,})[ \t]*([^`\n]*)$/;
  const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
  const RE_HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const RE_QUOTE = /^\s{0,3}>\s?/;
  const RE_LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+(.*)|\s*$)/;
  const RE_TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
  const RE_TASK = /^\[([ xX])\]\s+/;

  function isBlankLine(line) {
    return line.trim() === '';
  }

  function isListItem(line) {
    return RE_LIST_ITEM.test(line) && !RE_HR.test(line);
  }

  function isTableStart(lines, i) {
    if (i + 1 >= lines.length || !lines[i].includes('|')) return false;
    const delim = lines[i + 1];
    if (!RE_TABLE_DELIM.test(delim) || !delim.includes('-')) return false;
    // GFM: the delimiter row must have as many cells as the header row.
    return splitTableRow(delim).length === splitTableRow(lines[i]).length;
  }

  /** True when the line starts a block that must interrupt a paragraph. */
  function startsBlock(line) {
    return (
      RE_FENCE.test(line) ||
      RE_HEADING.test(line) ||
      RE_HR.test(line) ||
      RE_QUOTE.test(line) ||
      isListItem(line)
    );
  }

  function parseFence(lines, i) {
    const open = lines[i].match(RE_FENCE);
    const fenceChar = open[1][0];
    const fenceLen = open[1].length;
    const lang = (open[2] || '').trim().split(/\s+/)[0] || '';
    const code = [];
    let j = i + 1;
    while (j < lines.length) {
      const closing = lines[j].match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (closing && closing[1][0] === fenceChar && closing[1].length >= fenceLen) break;
      code.push(lines[j]);
      j++;
    }
    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
    const html =
      `<div class="code-block-container">${langLabel}` +
      `<pre><code${langAttr}>${escapeHtml(code.join('\n'))}\n</code></pre></div>\n`;
    return { html, next: Math.min(j + 1, lines.length) };
  }

  function parseQuote(lines, i) {
    const inner = [];
    let j = i;
    while (j < lines.length && RE_QUOTE.test(lines[j])) {
      inner.push(lines[j].replace(RE_QUOTE, ''));
      j++;
    }
    return { html: `<blockquote>\n${parseBlocks(inner)}</blockquote>\n`, next: j };
  }

  function splitTableRow(line) {
    let row = line.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
    return row.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
  }

  function parseTable(lines, i) {
    const headers = splitTableRow(lines[i]);
    const aligns = splitTableRow(lines[i + 1]).map((cell) => {
      const left = cell.startsWith(':');
      const right = cell.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return '';
    });
    const alignAttr = (idx) => (aligns[idx] ? ` style="text-align: ${aligns[idx]}"` : '');

    let html = '<div class="table-container"><table>\n<thead>\n<tr>';
    headers.forEach((h, idx) => {
      html += `<th${alignAttr(idx)}>${parseInline(h)}</th>`;
    });
    html += '</tr>\n</thead>\n<tbody>\n';

    let j = i + 2;
    while (j < lines.length && !isBlankLine(lines[j]) && lines[j].includes('|')) {
      const cells = splitTableRow(lines[j]);
      html += '<tr>';
      for (let c = 0; c < headers.length; c++) {
        html += `<td${alignAttr(c)}>${parseInline(cells[c] || '')}</td>`;
      }
      html += '</tr>\n';
      j++;
    }
    html += '</tbody>\n</table></div>\n';
    return { html, next: j };
  }

  function parseList(lines, i) {
    const first = lines[i].match(RE_LIST_ITEM);
    const baseIndent = indentOf(lines[i]);
    const ordered = /\d/.test(first[2]);
    const startNumber = ordered ? parseInt(first[2], 10) : 1;

    const items = [];
    let current = null;
    let contentIndent = baseIndent + first[2].length + 1;
    let j = i;

    while (j < lines.length) {
      const line = lines[j];

      if (isBlankLine(line)) {
        // Look past the blank line: does the list continue?
        let k = j + 1;
        while (k < lines.length && isBlankLine(lines[k])) k++;
        if (k >= lines.length) break;
        const nextIndent = indentOf(lines[k]);
        const nextIsItem = isListItem(lines[k]);
        const continues =
          nextIndent >= contentIndent ||
          (nextIsItem && nextIndent >= baseIndent && nextIndent < contentIndent);
        if (!continues) break;
        if (current) current.lines.push('');
        j++;
        continue;
      }

      const indent = indentOf(line);
      const itemMatch = line.match(RE_LIST_ITEM);
      const isItem = itemMatch && !RE_HR.test(line);

      if (isItem && indent < contentIndent) {
        if (indent < baseIndent) break;
        const itemOrdered = /\d/.test(itemMatch[2]);
        if (itemOrdered !== ordered) break; // a different kind of list starts
        current = { lines: [itemMatch[3] || ''] };
        items.push(current);
        contentIndent = indent + itemMatch[2].length + 1;
        j++;
        continue;
      }

      if (indent >= contentIndent) {
        current.lines.push(stripIndent(line, contentIndent));
        j++;
        continue;
      }

      // Lazy continuation: a plain text line directly after item text.
      const prev = current.lines[current.lines.length - 1];
      if (!isItem && prev !== undefined && prev.trim() !== '' && !startsBlock(line) && !isTableStart(lines, j)) {
        current.lines.push(line.trim());
        j++;
        continue;
      }
      break;
    }

    const tag = ordered ? 'ol' : 'ul';
    const startAttr = ordered && startNumber !== 1 ? ` start="${startNumber}"` : '';
    let html = `<${tag}${startAttr}>\n`;
    for (const item of items) {
      html += `<li>${renderListItem(item.lines)}</li>\n`;
    }
    html += `</${tag}>\n`;
    return { html, next: j };
  }

  function renderListItem(itemLines) {
    // Leading paragraph: consecutive non-blank lines that do not start a block.
    const lead = [];
    let idx = 0;
    while (
      idx < itemLines.length &&
      !isBlankLine(itemLines[idx]) &&
      (idx === 0 || (!startsBlock(itemLines[idx]) && !isTableStart(itemLines, idx)))
    ) {
      lead.push(itemLines[idx]);
      idx++;
    }
    let leadText = lead.join('\n');
    let prefix = '';
    const task = leadText.match(RE_TASK);
    if (task) {
      const checked = task[1].toLowerCase() === 'x';
      prefix = `<input type="checkbox" disabled${checked ? ' checked' : ''}> `;
      leadText = leadText.slice(task[0].length);
    }
    let html = prefix + parseInline(leadText);
    const rest = itemLines.slice(idx);
    if (rest.some((l) => !isBlankLine(l))) {
      html += '\n' + parseBlocks(rest);
    }
    return html;
  }

  function parseBlocks(lines) {
    let html = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (isBlankLine(line)) {
        i++;
        continue;
      }

      if (RE_FENCE.test(line)) {
        const r = parseFence(lines, i);
        html += r.html;
        i = r.next;
        continue;
      }

      const heading = line.match(RE_HEADING);
      if (heading) {
        const level = heading[1].length;
        html += `<h${level}>${parseInline(heading[2])}</h${level}>\n`;
        i++;
        continue;
      }

      if (RE_HR.test(line)) {
        html += '<hr>\n';
        i++;
        continue;
      }

      if (RE_QUOTE.test(line)) {
        const r = parseQuote(lines, i);
        html += r.html;
        i = r.next;
        continue;
      }

      if (isTableStart(lines, i)) {
        const r = parseTable(lines, i);
        html += r.html;
        i = r.next;
        continue;
      }

      if (isListItem(line)) {
        const r = parseList(lines, i);
        html += r.html;
        i = r.next;
        continue;
      }

      // Paragraph: gather until a blank line or the start of another block.
      const para = [line];
      i++;
      while (i < lines.length && !isBlankLine(lines[i]) && !startsBlock(lines[i]) && !isTableStart(lines, i)) {
        para.push(lines[i]);
        i++;
      }
      html += `<p>${parseInline(para.join('\n').trim())}</p>\n`;
    }

    return html;
  }

  // ==============================
  // Public API
  // ==============================

  /**
   * Converts markdown to HTML. The output is always safe to assign to
   * innerHTML: every piece of text is escaped before markup is generated and
   * link targets are scheme-checked.
   * @param {string} markdown - Source text
   * @returns {string} HTML string
   */
  function parse(markdown) {
    if (typeof markdown !== 'string') {
      throw new Error('Input must be a string');
    }
    const lines = markdown.replace(/\r\n|\r/g, '\n').split('\n');
    return parseBlocks(lines);
  }

  return { parse, escapeHtml };
})();

export { MarkdownParser };
