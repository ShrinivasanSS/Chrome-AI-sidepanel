// Enhanced markdown renderer for AI responses
// Provides markdown parsing with copy buttons on code blocks, tables, and blockquotes
// CSP-safe: no inline event handlers — uses post-render attachCodeCopyHandlers()

class MarkdownRenderer {
  static render(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    // Escape HTML to prevent XSS
    let html = this.escapeHtml(text);

    // Extract code blocks first and replace with placeholders to protect their content
    const codeBlocks = [];
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const index = codeBlocks.length;
      const language = lang || '';
      const langLabel = language ? `<span class="code-lang">${language}</span>` : '';
      const copyId = 'code-' + Date.now().toString(36) + '-' + index;
      codeBlocks.push(
        `<div class="code-block-wrapper">`
        + `<div class="code-block-header">${langLabel}<button class="code-copy-btn" data-copy-target="${copyId}" title="Copy code">Copy</button></div>`
        + `<pre id="${copyId}"><code class="language-${language}">${code.trim()}</code></pre>`
        + `</div>`
      );
      return `%%CODEBLOCK_${index}%%`;
    });

    // Extract inline code and protect from further transforms
    const inlineCodes = [];
    html = html.replace(/`([^`]+)`/g, (match, code) => {
      const index = inlineCodes.length;
      inlineCodes.push(`<code class="inline-code">${code}</code>`);
      return `%%INLINECODE_${index}%%`;
    });

    // Apply markdown transformations (code content is safe in placeholders)
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

    // Restore inline code placeholders
    inlineCodes.forEach((code, index) => {
      html = html.replace(`%%INLINECODE_${index}%%`, code);
    });

    // Restore code block placeholders
    codeBlocks.forEach((block, index) => {
      html = html.replace(`%%CODEBLOCK_${index}%%`, block);
    });

    return html;
  }

  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
    text = text.replace(/^(\s*)([-*+])\s+(.+)$/gm, '$1<li>$3</li>');
    text = text.replace(/((?:<li>.*<\/li>\n?)+)/g, (match) => {
      return '<ul>' + match.trim() + '</ul>';
    });
    text = text.replace(/^(\s*)(\d+\.)\s+(.+)$/gm, '$1<oli>$3</oli>');
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

        const cells = line.split('|').map(cell => cell.trim()).filter((cell, idx) => idx > 0 || cell);
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

        if (para.match(/^<(h[1-6]|ul|ol|pre|blockquote|div|table|hr)/)) {
          return para;
        }
        if (para.startsWith('%%CODEBLOCK_')) {
          return para;
        }

        return `<p>${para.replace(/\n/g, '<br>')}</p>`;
      })
      .join('\n');
  }

  // Attach copy handlers to all code-copy-btn elements within a container
  // Call this AFTER inserting rendered HTML into the DOM
  static attachCodeCopyHandlers(container) {
    if (!container) return;
    const buttons = container.querySelectorAll('.code-copy-btn');
    buttons.forEach((button) => {
      // Avoid double-attaching
      if (button.dataset.copyAttached) return;
      button.dataset.copyAttached = 'true';
      button.addEventListener('click', () => {
        MarkdownRenderer.copyCodeBlock(button);
      });
    });
  }

  // Copy code block content to clipboard
  static copyCodeBlock(button) {
    const targetId = button.getAttribute('data-copy-target');
    const codeEl = document.getElementById(targetId);
    if (!codeEl) return;

    const text = codeEl.textContent;
    navigator.clipboard.writeText(text).then(() => {
      button.textContent = 'Copied!';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('copied');
      }, 1500);
    }).catch(() => {
      // Fallback for environments where clipboard API is restricted
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        button.textContent = 'Copied!';
        button.classList.add('copied');
        setTimeout(() => {
          button.textContent = 'Copy';
          button.classList.remove('copied');
        }, 1500);
      } catch (e) {
        button.textContent = 'Failed';
        setTimeout(() => { button.textContent = 'Copy'; }, 1500);
      }
    });
  }
}

// Make available globally
window.MarkdownRenderer = MarkdownRenderer;
