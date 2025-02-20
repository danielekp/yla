/**
 * PythonHighlighter Module
 * ---------------------------
 * This module provides a robust function to highlight Python code.
 *
 * Features:
 * - Escapes HTML for safe display.
 * - Extracts strings (single, double, and triple-quoted) and comments (lines starting with #)
 *   to protect them from being altered by other regex rules.
 * - Highlights Python keywords, numbers, and operators.
 *
 * This allows you to use the same style sheet across multiple language highlighters.
 *
 * Usage:
 *   // In a browser:
 *   var highlighted = PythonHighlighter.highlight(pythonCode);
 *
 *   // In CommonJS or AMD:
 *   // const PythonHighlighter = require('./python');
 *   // let highlighted = PythonHighlighter.highlight(pythonCode);
 */

const PythonHighlighter = (function() {
  "use strict";

  function escapeHtml(html) {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return String(html).replace(/[&<>"']/g, match => replacements[match]);
  }

  function highlightPython(code) {
    if (typeof code !== "string") {
      throw new Error("Input must be a string.");
    }

    // Escape HTML
    code = escapeHtml(code);

    // Extract strings and comments
    const tokens = [];
    const pattern = /(#[^\n]*|'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g;
    code = code.replace(pattern, function(match) {
      tokens.push(match);
      return "~~~" + (tokens.length - 1) + "~~~";
    });

    // Highlight keywords with proper closing tags
    const keywords = /\b(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/g;
    code = code.replace(keywords, '<span class="hl-keyword">$&</span>');

    // Highlight numbers with proper closing tags
    code = code.replace(/\b\d+(\.\d+)?\b/g, '<span class="hl-number">$&</span>');

    // Highlight operators with proper closing tags
    code = code.replace(/([+\-*/%=&|<>!^~]+)/g, '<span class="hl-operator">$1</span>');

    // Reinsert protected tokens with proper closing tags
    code = code.replace(/~~~(\d+)~~~/g, function(match, index) {
      const token = tokens[+index];
      if (token.charAt(0) === "#") {
        return '<span class="hl-comment">' + token + '</span>';
      } else {
        return '<span class="hl-string">' + token + '</span>';
      }
    });

    return code;
  }

  return {
    highlight: highlightPython
  };
})();

export { PythonHighlighter };