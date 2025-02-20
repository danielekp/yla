/**
 * JSHighlighter Module
 * ----------------------
 * This module provides a robust function to highlight JavaScript code.
 *
 * Features:
 * - Escapes HTML for safe display.
 * - Extracts strings (double, single, template) and comments (single-line, multi-line)
 *   and protects them from being altered by other regex rules.
 * - Highlights JavaScript keywords, numbers, and (optionally) operators.
 *
 * Usage:
 *   // In browser (global variable)
 *   var highlighted = JSHighlighter.highlight(jsCode);
 *
 *   // In CommonJS or AMD environments:
 *   // const JSHighlighter = require('./JSHighlighter');
 *   // let highlighted = JSHighlighter.highlight(jsCode);
 */

(function (root, factory) {
  if (typeof exports === "object" && typeof module === "object") {
    module.exports = factory();
  } else if (typeof define === "function" && define.amd) {
    define([], factory);
  } else {
    root.JSHighlighter = factory();
  }
})(this, function () {
  "use strict";

  // Utility: Escapes HTML special characters.
  function escapeHtml(html) {
    var replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return String(html).replace(/[&<>"']/g, function (match) {
      return replacements[match];
    });
  }

  /**
   * highlightJS
   * @param {string} code - The JavaScript code to highlight.
   * @returns {string} - HTML string with syntax highlighting.
   */
  function highlightJS(code) {
    if (typeof code !== "string") {
      throw new Error("Input must be a string.");
    }

    // Escape HTML to ensure safe display.
    code = escapeHtml(code);

    // Phase 1: Extract strings and comments to protect them.
    var tokens = [];
    // This regex matches:
    //  - Multi-line comments: /**/ 
    //  - Single-line comments: //...
    //  - Double-quoted strings: "..."
    //  - Single-quoted strings: '...'
    //  - Template literals: `...`
    var pattern = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
    code = code.replace(pattern, function (match) {
      tokens.push(match);
      return "~~~" + (tokens.length - 1) + "~~~";
    });

    // Phase 2: Highlight keywords, numbers, and operators.
    // Keywords (common JS keywords)
    var keywords = /\b(?:break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|let|new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield)\b/g;
    code = code.replace(keywords, '<span class="hl-keyword">$&</span>');

    // Numbers (integer and floating point)
    code = code.replace(/\b\d+(\.\d+)?\b/g, '<span class="hl-number">$&</span>');

    // Optionally highlight operators and punctuation.
    // You can customize this regex for different operators.
    code = code.replace(/([+\-*/=<>!&|^%]+)/g, '<span class="hl-operator">$1</span>');

    // Phase 3: Reinsert the protected tokens.
    code = code.replace(/~~~(\d+)~~~/g, function (match, index) {
      var token = tokens[+index];
      // Determine the class based on the token content.
      if (/^(\/\*[\s\S]*?\*\/|\/\/[^\n]*)$/.test(token)) {
        return '<span class="hl-comment">' + token + '</span>';
      } else {
        return '<span class="hl-string">' + token + '</span>';
      }
    });

    return code;
  }

  // Expose the API.
  return {
    highlight: highlightJS
  };
});