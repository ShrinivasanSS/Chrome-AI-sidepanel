// Enhanced markdown renderer for AI responses
// Provides markdown parsing with copy buttons on code blocks, tables, and blockquotes

class MarkdownRenderer {
  static render(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    // Escape HTML to prevent XSS
    let html = this.escapeHtml(text);

    // Apply markdown transformations in order (code blocks first to protect content)
    html = this.renderCodeBlocks(html);
    html = this.renderInlineCode(html);
    html = this.renderTables(html);
    html = this.renderHeaders(html);
    html = this.renderBold(html);
    html = this.renderItalic(html);
    html = this.renderStrikethrough(html);
    html = this.renderLinks(html);
    html = this.renderBlockquotes(html);
    html = this.renderHorizontalRules(html);
    html = this.renderLists(html);
    html = this.renderParagraphs(html);

    return html;
  }

  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  static renderCodeBlocks(text) {
    // Handle fenced code blocks with ``` syntax — include copy button
    return text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang || '';
      const langLabel = language ? `<span class="code-lang">${language}</span>` : '';
      const copyId = 'code-' + Math.random().toString(36).slice(2, 10);
      return `<div class="code-block-wrapper">`
        + `<div class="code-block-header">${langLabel}<button class="code-copy-btn" data-copy-target="${copyId}" onclick="MarkdownRenderer.copyCodeBlock(this)" title="Copy code">Copy</button></div>`
        + `<pre id="${copyId}"><code class="language-${language}">${code.trim()}</code></pre>`
        + `</div>`;
    });
  }

  static renderInlineCode(text) {
    return text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  }

  static renderHeaders(text) {
    return text.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, content) => {
      const level = hashes.length;
      return `<h${level}>${content}</h${level}>`;
    });
  }

  static renderBold(text) {
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
               .replace(/__(.*?)__/g, '<strong>$1</strong>');
  }

  static renderItalic(text) {
    return text.replace(/\*(.*?)\*/g, '<em>$1</em>')
               .replace(/_(.*?)_/g, '<em>$1</em>');
  }

  static renderStrikethrough(text) {
    return text.replace(/~~(.*?)~~/g, '<del>$1</del>');
  }

  static renderLinks(text) {
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  static renderBlockquotes(text) {
    // Handle multi-line blockquotes
    const lines = text.split('\n');
    const result = [];
    let inBlockquote = false;
    let blockquoteLines = [];

    for (const line of lines) {
      const bqMatch = line.match(/^&gt;\s?(.*)/);
      if (bqMatch) {
        if (!inBlockquote) {
          inBlockquote = true;
          blockquoteLines = [];
        }
        blockquoteLines.push(bqMatch[1]);
      } else {
        if (inBlockquote) {
          result.push(`<blockquote>${blockquoteLines.join('<br>')}</blockquote>`);
          inBlockquote = false;
          blockquoteLines = [];
        }
        result.push(line);
      }
    }
    if (inBlockquote) {
      result.push(`<blockquote>${blockquoteLines.join('<br>')}</blockquote>`);
    }

    return result.join('\n');
  }

  static renderHorizontalRules(text) {
    return text.replace(/^([-*_]){3,}\s*$/gm, '<hr>');
  }

  static renderLists(text) {
    // Handle unordered lists with - or * or + syntax
    text = text.replace(/^(\s*)([-*+])\s+(.+)$/gm, '$1<li>$3</li>');

    // Wrap consecutive list items in <ul> tags
    text = text.replace(/((?:<li>.*<\/li>\n?)+)/g, (match) => {
      return '<ul>' + match.trim() + '</ul>';
    });

    // Handle ordered lists with 1. syntax
    text = text.replace(/^(\s*)(\d+\.)\s+(.+)$/gm, '$1<oli>$3</oli>');

    // Wrap consecutive ordered list items
    text = text.replace(/((?:<oli>.*<\/oli>\n?)+)/g, (match) => {
      return '<ol>' + match.replace(/<\/?oli>/g, (tag) => tag.replace('oli', 'li')) + '</ol>';
    });

    return text;
  }

  static renderTables(text) {
    const lines = text.split('\n');
    let inTable = false;
    let tableRows = [];
    let result = [];
    let headerDone = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.includes('|') && line.startsWith('|')) {
        if (!inTable) {
          inTable = true;
          tableRows = [];
          headerDone = false;
        }

        const cells = line.split('|').map(cell => cell.trim()).filter((cell, idx, arr) => idx > 0 || cell);
        // Remove empty last element from trailing |
        if (cells.length > 0 && cells[cells.length - 1] === '') {
          cells.pop();
        }
        const isHeaderSeparator = cells.every(cell => /^[-:]+$/.test(cell));

        if (isHeaderSeparator) {
          headerDone = true;
        } else if (!headerDone && tableRows.length === 0) {
          const row = `<tr>${cells.map(cell => `<th>${cell}</th>`).join('')}</tr>`;
          tableRows.push(row);
        } else {
          const row = `<tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`;
          tableRows.push(row);
        }
      } else {
        if (inTable) {
          result.push(`<div class="table-wrapper"><table>${tableRows.join('')}</table></div>`);
          inTable = false;
          tableRows = [];
        }
        result.push(lines[i]);
      }
    }

    if (inTable) {
      result.push(`<div class="table-wrapper"><table>${tableRows.join('')}</table></div>`);
    }

    return result.join('\n');
  }

  static renderParagraphs(text) {
    const paragraphs = text.split(/\n\s*\n/);

    return paragraphs
      .map(para => {
        para = para.trim();
        if (!para) return '';

        // Don't wrap if it's already a block element
        if (para.match(/^<(h[1-6]|ul|ol|pre|blockquote|div|table|hr)/)) {
          return para;
        }

        // Convert single newlines to <br> within paragraphs
        return `<p>${para.replace(/\n/g, '<br>')}</p>`;
      })
      .join('\n');
  }

  // Copy code block content to clipboard
  static copyCodeBlock(button) {
    const targetId = button.getAttribute('data-copy-target');
    const codeEl = document.getElementById(targetId);
    if (!codeEl) return;

    const text = codeEl.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const original = button.textContent;
      button.textContent = 'Copied!';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = original;
        button.classList.remove('copied');
      }, 1500);
    }).catch(() => {
      // Fallback
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('copy');
      selection.removeAllRanges();
      button.textContent = 'Copied!';
      setTimeout(() => { button.textContent = 'Copy'; }, 1500);
    });
  }
}

// Make available globally
window.MarkdownRenderer = MarkdownRenderer;
