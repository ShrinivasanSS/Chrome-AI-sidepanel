// Simple markdown renderer for AI responses
// This provides basic markdown parsing without external dependencies

class MarkdownRenderer {
  static render(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    // Escape HTML to prevent XSS
    let html = this.escapeHtml(text);

    // Apply markdown transformations in order
    html = this.renderCodeBlocks(html);
    html = this.renderInlineCode(html);
    html = this.renderHeaders(html);
    html = this.renderBold(html);
    html = this.renderItalic(html);
    html = this.renderLinks(html);
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
    // Handle code blocks with ``` syntax
    return text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang ? ` class="language-${lang}"` : '';
      return `<pre><code${language}>${code.trim()}</code></pre>`;
    });
  }

  static renderInlineCode(text) {
    // Handle inline code with ` syntax
    return text.replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  static renderHeaders(text) {
    // Handle headers with # syntax
    return text.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, content) => {
      const level = hashes.length;
      return `<h${level}>${content}</h${level}>`;
    });
  }

  static renderBold(text) {
    // Handle bold with **text** or __text__ syntax
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
               .replace(/__(.*?)__/g, '<strong>$1</strong>');
  }

  static renderItalic(text) {
    // Handle italic with *text* or _text_ syntax
    return text.replace(/\*(.*?)\*/g, '<em>$1</em>')
               .replace(/_(.*?)_/g, '<em>$1</em>');
  }

  static renderLinks(text) {
    // Handle links with [text](url) syntax
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  static renderLists(text) {
    // Handle unordered lists with - or * syntax
    text = text.replace(/^(\s*)([-*+])\s+(.+)$/gm, '$1<li>$3</li>');
    
    // Wrap consecutive list items in <ul> tags
    text = text.replace(/(<li>.*<\/li>(\n|$))+/gs, (match) => {
      return '<ul>' + match.trim() + '</ul>';
    });

    // Handle ordered lists with 1. syntax
    text = text.replace(/^(\s*)(\d+\.)\s+(.+)$/gm, '$1<li>$3</li>');
    
    // Wrap consecutive numbered list items in <ol> tags
    text = text.replace(/(<li>.*<\/li>(\n|$))+/gs, (match) => {
      // Check if this was from numbered list (this is a simplified approach)
      return '<ol>' + match.trim() + '</ol>';
    });

    return text;
  }

  static renderParagraphs(text) {
    // Split by double newlines and wrap in paragraphs
    const paragraphs = text.split(/\n\s*\n/);
    
    return paragraphs
      .map(para => {
        para = para.trim();
        if (!para) return '';
        
        // Don't wrap if it's already a block element
        if (para.match(/^<(h[1-6]|ul|ol|pre|blockquote)/)) {
          return para;
        }
        
        return `<p>${para}</p>`;
      })
      .join('\n');
  }

  // Additional utility methods for enhanced formatting
  static renderBlockquotes(text) {
    // Handle blockquotes with > syntax
    return text.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
  }

  static renderTables(text) {
    // Basic table support (simplified)
    const lines = text.split('\n');
    let inTable = false;
    let tableRows = [];
    let result = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.includes('|')) {
        if (!inTable) {
          inTable = true;
          tableRows = [];
        }
        
        const cells = line.split('|').map(cell => cell.trim()).filter(cell => cell);
        const isHeaderSeparator = cells.every(cell => /^[-:]+$/.test(cell));
        
        if (!isHeaderSeparator) {
          const cellTag = tableRows.length === 0 ? 'th' : 'td';
          const row = `<tr>${cells.map(cell => `<${cellTag}>${cell}</${cellTag}>`).join('')}</tr>`;
          tableRows.push(row);
        }
      } else {
        if (inTable) {
          result.push(`<table>${tableRows.join('')}</table>`);
          inTable = false;
          tableRows = [];
        }
        result.push(line);
      }
    }
    
    if (inTable) {
      result.push(`<table>${tableRows.join('')}</table>`);
    }
    
    return result.join('\n');
  }
}

// Make available globally
window.MarkdownRenderer = MarkdownRenderer;