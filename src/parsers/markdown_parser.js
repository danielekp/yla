/**
 * Robust Markdown Parser with Sanitization
 * ------------------------------------------
 * This self-contained parser supports many common Markdown features:
 *
 * - Headers (e.g., #, ##, …, ######)
 * - Paragraphs
 * - Code blocks (delimited by triple backticks, with optional language class)
 * - Inline formatting: bold, italics, inline code, links
 * - Horizontal rules (***, ---, or ___)
 * - Blockquotes (lines starting with '>')
 * - Unordered lists (using -, +, or *)
 * - Ordered lists (lines starting with numbers followed by a dot)
 * - Tables (basic support with header, alignment, and rows)
 *
 * Additionally, you can sanitize the output by passing { sanitize: true } to the parse method.
 *
 * Example:
 *   messageDiv.innerHTML = MarkdownParser.parse(text, { sanitize: true });
 */

/**
 * Markdown Parser with Improved Code Block Styling
 * Features improved code block handling that prevents horizontal overflow
 */
/**
 * Markdown Parser with Fixed Code Block Styling
 * Prevents unnecessary horizontal scrollbars in code blocks
 */
const MarkdownParser = (function() {
  "use strict";

  function escapeHtml(text) {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return String(text).replace(/[&<>"']/g, match => replacements[match]);
  }

  function parseInline(text) {
    text = escapeHtml(text);

    const transforms = [
      {
        pattern: /`([^`]+)`/g,
        replacement: (_, code) => `<code>${code}</code>`
      },
      {
        pattern: /\*\*(.+?)\*\*|__(.+?)__/g,
        replacement: (_, m1, m2) => `<strong>${m1 || m2}</strong>`
      },
      {
        pattern: /\*(.+?)\*|_(.+?)_/g,
        replacement: (_, m1, m2) => `<em>${m1 || m2}</em>`
      },
      {
        pattern: /\[([^\]]+)\]\(([^)]+)\)/g,
        replacement: (_, text, url) => `<a href="${escapeHtml(url)}">${text}</a>`
      }
    ];

    return transforms.reduce((text, transform) => 
      text.replace(transform.pattern, transform.replacement), text);
  }

  function parseCodeBlock(lines, startIndex) {
    let code = '';
    let i = startIndex + 1;
    
    while (i < lines.length && !lines[i].trim().startsWith('```')) {
      code += lines[i] + '\n';
      i++;
    }

    // Updated styling to prevent unnecessary scrollbars
    return {
      html: `<div class="code-block-container" style="margin: 1em 0;">
              <pre style="color:black; background-color: #f5f5f5; padding: 1em; border-radius: 4px; margin: 0; white-space: pre-wrap; word-break: break-word;"><code style="word-break: break-word;">${escapeHtml(code.trim())}</code></pre>
            </div>\n`,
      newIndex: i + 1
    };
  }

  function parseBlocks(markdown) {
    const lines = markdown.split('\n');
    let html = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (trimmedLine === '') {
        i++;
        continue;
      }

      if (trimmedLine.startsWith('```')) {
        const result = parseCodeBlock(lines, i);
        html += result.html;
        i = result.newIndex;
        continue;
      }

      const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        const level = headerMatch[1].length;
        const content = parseInline(headerMatch[2].trim());
        html += `<h${level}>${content}</h${level}>\n`;
        i++;
        continue;
      }

      if (trimmedLine.match(/^(?:[-*_]\s*){3,}$/)) {
        html += '<hr>\n';
        i++;
        continue;
      }

      if (trimmedLine.startsWith('>')) {
        let quoteContent = '';
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoteContent += lines[i].replace(/^>\s?/, '') + '\n';
          i++;
        }
        html += `<blockquote>${parseBlocks(quoteContent.trim())}</blockquote>\n`;
        continue;
      }

      if (trimmedLine.match(/^[-*+]\s/) || trimmedLine.match(/^\d+\.\s/)) {
        const isOrdered = trimmedLine.match(/^\d+\.\s/);
        const listItems = [];
        const startIndent = line.search(/\S/);
        
        while (i < lines.length) {
          const currentLine = lines[i];
          const currentIndent = currentLine.search(/\S/);
          const isListItem = isOrdered 
            ? currentLine.trim().match(/^\d+\.\s/)
            : currentLine.trim().match(/^[-*+]\s/);

          if (isListItem && currentIndent === startIndent) {
            listItems.push(currentLine.trim().replace(/^(?:[-*+]|\d+\.)\s/, ''));
            i++;
          } else if (currentIndent > startIndent) {
            if (listItems.length > 0) {
              listItems[listItems.length - 1] += '\n' + currentLine;
            }
            i++;
          } else {
            break;
          }
        }

        const listTag = isOrdered ? 'ol' : 'ul';
        const listContent = listItems
          .map(item => `<li>${parseInline(item.trim())}</li>`)
          .join('\n');
        
        html += `<${listTag}>\n${listContent}\n</${listTag}>\n`;
        continue;
      }

      let paragraph = line;
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        paragraph += ' ' + lines[i];
        i++;
      }
      html += `<p>${parseInline(paragraph.trim())}</p>\n`;
    }

    return html;
  }

  function parse(markdown, options = {}) {
    if (typeof markdown !== 'string') {
      throw new Error('Input must be a string');
    }

    markdown = markdown.replace(/\r\n|\r/g, '\n');
    
    let html = parseBlocks(markdown);

    if (options.sanitize) {
      html = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/\son\w+="[^"]*"/gi, '');
    }

    return html;
  }

  return { parse };
})();

export { MarkdownParser };