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

// markdown_parser.js
const MarkdownParser = (function () {
  "use strict";

  // Utility: Escape HTML for safe output in code blocks.
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

  // Inline parser: handles bold, italics, inline code, and links.
  function parseInline(text) {
    // Bold: **text** or __text__
    text = text.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');
    // Italics: *text* or _text_
    text = text.replace(/(\*|_)(.*?)\1/g, '<em>$2</em>');
    // Inline code: `code`
    text = text.replace(/`([^`]+?)`/g, function (match, p1) {
      return '<code>' + escapeHtml(p1) + '</code>';
    });
    // Links: [text](url)
    text = text.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '<a href="$2">$1</a>');
    return text;
  }

  // Block-level parser: handles code blocks, headers, horizontal rules,
  // blockquotes, lists, tables, and paragraphs.
  function parseBlocks(markdown, depth = 0) {
    // Prevent infinite recursion
    if (depth > 10) {
      console.warn('Maximum nesting depth exceeded in markdown parsing');
      return markdown;
    }

    var lines = Array.isArray(markdown) ? markdown : markdown.split("\n");
    var html = "";
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      // Skip blank lines.
      if (line.trim() === "") {
        i++;
        continue;
      }

      // Code Block: delimited by triple backticks.
      if (line.trim().startsWith("```")) {
        const langMatch = line.trim().match(/^```(\w+)?/);
        const codeLang = langMatch && langMatch[1] ? langMatch[1] : "";
        let codeBuffer = "";
        i++;
        
        // Keep track of nested code block depth
        let nestedDepth = 1;
        
        while (i < lines.length) {
          if (lines[i].trim().startsWith("```")) {
            nestedDepth--;
            if (nestedDepth === 0) break;
          } else if (lines[i].trim().startsWith("```")) {
            nestedDepth++;
          }
          codeBuffer += lines[i] + "\n";
          i++;
        }
        
        html += '<pre><code' + 
          (codeLang ? ' class="language-' + escapeHtml(codeLang) + '"' : '') + 
          '>' + escapeHtml(codeBuffer.trim()) + '</code></pre>\n';
        i++; // Skip closing ```
        continue;
      }

      // Headers: Lines starting with 1-6 '#' characters followed by a space.
      var headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headerMatch) {
        var level = headerMatch[1].length;
        html += "<h" + level + ">" + parseInline(headerMatch[2]) + "</h" + level + ">\n";
        i++;
        continue;
      }

      // Horizontal Rule: --- or *** or ___ (with optional spaces).
      if (line.trim().match(/^(\*\s*\*\s*\*|-\s*-\s*-|_\s*_\s*_)$/)) {
        html += "<hr />\n";
        i++;
        continue;
      }

      // Blockquote: Lines starting with '>'.
      if (line.trim().startsWith(">")) {
        var blockquoteBuffer = "";
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          blockquoteBuffer += lines[i].replace(/^>\s?/, "") + "\n";
          i++;
        }
        html += "<blockquote>" + parseBlocks(blockquoteBuffer, depth + 1) + "</blockquote>\n";
        continue;
      }

      // Unordered List: Lines starting with -, +, or *.
      if (line.trim().match(/^([-+*])\s/)) {
        var listHtml = "";
        var listItems = [];
        var startIndent = line.search(/\S/);
        
        while (i < lines.length) {
          var currentLine = lines[i];
          var currentIndent = currentLine.search(/\S/);
          var listMarker = currentLine.trim().match(/^([-+*])\s/);
          
          // If this is a new list item at the same level
          if (listMarker && currentIndent === startIndent) {
            listItems.push(currentLine.trim().replace(/^[-+*]\s/, ''));
            i++;
          }
          // If this is indented content belonging to the current list item
          else if (currentIndent > startIndent) {
            if (listItems.length > 0) {
              listItems[listItems.length - 1] += '\n' + currentLine;
            }
            i++;
          }
          // If we've reached the end of the list
          else {
            break;
          }
        }
        
        listHtml = listItems.map(item => 
          "<li>" + parseInline(item.trim()) + "</li>"
        ).join('\n');
        
        html += "<ul>\n" + listHtml + "</ul>\n";
        continue;
      }

      // Ordered List: Lines starting with a number followed by a dot.
      if (line.trim().match(/^\d+\.\s/)) {
        var listHtml = "";
        var listItems = [];
        var startIndent = line.search(/\S/);
        
        while (i < lines.length) {
          var currentLine = lines[i];
          var currentIndent = currentLine.search(/\S/);
          var listMarker = currentLine.trim().match(/^\d+\.\s/);
          
          // If this is a new list item at the same level
          if (listMarker && currentIndent === startIndent) {
            listItems.push(currentLine.trim().replace(/^\d+\.\s/, ''));
            i++;
          }
          // If this is indented content belonging to the current list item
          else if (currentIndent > startIndent) {
            if (listItems.length > 0) {
              listItems[listItems.length - 1] += '\n' + currentLine;
            }
            i++;
          }
          // If we've reached the end of the list
          else {
            break;
          }
        }
        
        listHtml = listItems.map(item => 
          "<li>" + parseInline(item.trim()) + "</li>"
        ).join('\n');
        
        html += "<ol>\n" + listHtml + "</ol>\n";
        continue;
      }

      // Table: Look for a header row with pipes followed by an alignment row.
      if (line.indexOf("|") !== -1 && i + 1 < lines.length) {
        var alignRegex = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/;
        if (alignRegex.test(lines[i + 1])) {
          var headerCells = line.split("|").map(function (cell) { return cell.trim(); });
          var alignCells = lines[i + 1].split("|").map(function (cell) {
            cell = cell.trim();
            if (/^:\-+:$/.test(cell)) return "center";
            else if (/^:\-+/.test(cell)) return "left";
            else if (/^\-+:$/.test(cell)) return "right";
            else return null;
          });
          var tableHtml = "<table>\n<thead>\n<tr>";
          for (var j = 0; j < headerCells.length; j++) {
            if (headerCells[j]) {
              tableHtml += '<th' +
                (alignCells[j] ? ' style="text-align:' + alignCells[j] + ';"' : "") +
                ">" + parseInline(headerCells[j]) + "</th>";
            }
          }
          tableHtml += "</tr>\n</thead>\n<tbody>\n";
          i += 2; // Skip header and alignment row.
          while (i < lines.length && lines[i].indexOf("|") !== -1) {
            var rowCells = lines[i].split("|").map(function (cell) { return cell.trim(); });
            tableHtml += "<tr>";
            for (var k = 0; k < rowCells.length; k++) {
              if (rowCells[k]) {
                tableHtml += '<td' +
                  (alignCells[k] ? ' style="text-align:' + alignCells[k] + ';"' : "") +
                  ">" + parseInline(rowCells[k]) + "</td>";
              }
            }
            tableHtml += "</tr>\n";
            i++;
          }
          tableHtml += "</tbody>\n</table>\n";
          html += tableHtml;
          continue;
        }
      }

      // Paragraph: Accumulate lines until a blank line.
      var paragraph = line;
      i++;
      while (i < lines.length && lines[i].trim() !== "") {
        paragraph += " " + lines[i];
        i++;
      }
      html += "<p>" + parseInline(paragraph.trim()) + "</p>\n";
    }
    return html;
  }

  function sanitizeHtml(html) {
    if (typeof document !== "undefined") {
      var temp = document.createElement("div");
      temp.innerHTML = html;

      var scripts = temp.getElementsByTagName("script");
      while (scripts.length) {
        scripts[0].parentNode.removeChild(scripts[0]);
      }

      var elements = temp.getElementsByTagName("*");
      for (var i = 0; i < elements.length; i++) {
        for (var j = elements[i].attributes.length - 1; j >= 0; j--) {
          var attr = elements[i].attributes[j];
          if (/^on/i.test(attr.name)) {
            elements[i].removeAttribute(attr.name);
          }
        }
      }
      return temp.innerHTML;
    } else {
      return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
                 .replace(/\son\w+="[^"]*"/gi, "");
    }
  }

  function parseMarkdown(markdown, options) {
    if (typeof markdown !== "string") {
      throw new Error("Input must be a string.");
    }
    options = options || {};
    markdown = markdown.replace(/\r\n/g, "\n");
    var html = parseBlocks(markdown);
    if (options.sanitize) {
      html = sanitizeHtml(html);
    }
    return html;
  }

  return {
    parse: parseMarkdown
  };
})();

export { MarkdownParser };