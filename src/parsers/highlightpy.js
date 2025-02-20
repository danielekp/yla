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

(function (root, factory) {
    if (typeof exports === "object" && typeof module === "object") {
      module.exports = factory();
    } else if (typeof define === "function" && define.amd) {
      define([], factory);
    } else {
      root.PythonHighlighter = factory();
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
     * highlightPython
     * @param {string} code - The Python code to highlight.
     * @returns {string} HTML string with syntax highlighting.
     */
    function highlightPython(code) {
      if (typeof code !== "string") {
        throw new Error("Input must be a string.");
      }
  
      // Escape HTML to ensure safe display.
      code = escapeHtml(code);
  
      // Phase 1: Extract strings and comments to protect them.
      var tokens = [];
      // Pattern matches:
      //   - Python comments: from '#' to end of line
      //   - Triple-quoted strings ('''...''' or """...""")
      //   - Single-quoted and double-quoted strings.
      var pattern = /(#[^\n]*|'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g;
      code = code.replace(pattern, function (match) {
        tokens.push(match);
        return "~~~" + (tokens.length - 1) + "~~~";
      });
  
      // Phase 2: Highlight keywords, numbers, and operators.
      // Highlight Python keywords.
      var keywords = /\b(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/g;
      code = code.replace(keywords, '<span class="hl-keyword">$&</span>');
  
      // Highlight numbers (integers and floating-point).
      code = code.replace(/\b\d+(\.\d+)?\b/g, '<span class="hl-number">$&</span>');
  
      // Highlight operators and punctuation.
      // This regex matches common Python operators.
      code = code.replace(/([+\-*/%=&|<>!^~]+)/g, '<span class="hl-operator">$1</span>');
  
      // Phase 3: Reinsert the protected tokens.
      code = code.replace(/~~~(\d+)~~~/g, function (match, index) {
        var token = tokens[+index];
        // If the token starts with '#', treat it as a comment; otherwise, as a string.
        if (token.charAt(0) === "#") {
          return '<span class="hl-comment">' + token + '</span>';
        } else {
          return '<span class="hl-string">' + token + '</span>';
        }
      });
  
      return code;
    }
  
    // Expose the API.
    return {
      highlight: highlightPython
    };
  });