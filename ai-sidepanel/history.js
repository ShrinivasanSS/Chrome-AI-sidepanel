const historyListEl = document.getElementById('historyList');
const historyUsageEl = document.getElementById('historyUsage');
const refreshBtn = document.getElementById('refreshBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');

const expandedIds = new Set();
const viewModes = {}; // id -> 'markdown' | 'raw'

document.addEventListener('DOMContentLoaded', initializeHistoryPage);

async function initializeHistoryPage() {
  refreshBtn.addEventListener('click', loadHistory);
  clearBtn.addEventListener('click', handleClear);

  // Apply theme
  const settings = await StorageUtils.loadSettings();
  applyTheme(settings.theme || 'light');

  await loadHistory();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}

async function loadHistory() {
  try {
    const [conversations, metrics] = await Promise.all([
      HistoryStore.getRecentConversations(50),
      StorageUtils.refreshStorageMetrics()
    ]);

    historyUsageEl.textContent = `${metrics.historyCount} conversation(s) stored · ${StorageUtils.formatBytes(metrics.totalBytes)}`;

    if (conversations.length === 0) {
      historyListEl.innerHTML = '<div class="muted">No history yet.</div>';
      return;
    }

    historyListEl.innerHTML = '';

    conversations.forEach((entry, index) => {
      const itemId = entry.id || entry.createdAt || `history-${index}`;
      const isExpanded = expandedIds.has(itemId);
      const outputData = entry.outputData || {};
      const responses = Array.isArray(outputData.response) ? outputData.response : [];
      const viewMode = viewModes[itemId] || 'markdown';

      const item = document.createElement('div');
      item.className = 'history-item';

      const sourceText = entry.source && entry.source.url
        ? entry.source.url
        : entry.source && entry.source.type
          ? entry.source.type
          : 'unknown';

      item.innerHTML = `
        <div class="history-header">
          <div class="history-title">${escapeHtml(entry.requestName || 'Request')}</div>
          <div class="history-meta">${escapeHtml(entry.mode || '-')} · ${escapeHtml(entry.model || '-')}</div>
          <div class="history-toggle">${isExpanded ? 'Collapse' : 'Expand'}</div>
        </div>
        <div class="history-content${isExpanded ? ' expanded' : ''}">
          <div class="muted">${new Date(entry.createdAt).toLocaleString()}</div>
          <div class="muted">Source: ${escapeHtml(sourceText)}</div>
          ${responses.length > 0 ? `
            <div class="toolbar" style="margin-top: 8px; margin-bottom: 8px;">
              <button class="mode-btn view-markdown-btn ${viewMode === 'markdown' ? 'active' : ''}" style="padding: 4px 10px; font-size: 12px;">Formatted</button>
              <button class="mode-btn view-raw-btn ${viewMode === 'raw' ? 'active' : ''}" style="padding: 4px 10px; font-size: 12px;">Raw JSON</button>
            </div>
          ` : ''}
          <div class="history-result-container"></div>
          ${responses.length === 0 ? `
            <div class="section-title" style="margin-top: 12px;">Request</div>
            <pre>${escapeHtml(JSON.stringify(entry.requestData, null, 2))}</pre>
            <div class="section-title" style="margin-top: 12px;">Output</div>
            <pre>${escapeHtml(JSON.stringify(entry.outputData, null, 2))}</pre>
          ` : ''}
        </div>
      `;

      // Render result view
      const resultContainer = item.querySelector('.history-result-container');
      if (responses.length > 0) {
        renderResultView(resultContainer, responses, outputData, viewMode);

        const markdownBtn = item.querySelector('.view-markdown-btn');
        const rawBtn = item.querySelector('.view-raw-btn');
        if (markdownBtn && rawBtn) {
          markdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            viewModes[itemId] = 'markdown';
            markdownBtn.classList.add('active');
            rawBtn.classList.remove('active');
            renderResultView(resultContainer, responses, outputData, 'markdown');
          });
          rawBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            viewModes[itemId] = 'raw';
            rawBtn.classList.add('active');
            markdownBtn.classList.remove('active');
            renderResultView(resultContainer, responses, outputData, 'raw');
          });
        }
      }

      // Toggle expand/collapse
      const header = item.querySelector('.history-header');
      const content = item.querySelector('.history-content');
      const toggle = item.querySelector('.history-toggle');
      header.addEventListener('click', () => {
        const nowExpanded = content.classList.toggle('expanded');
        toggle.textContent = nowExpanded ? 'Collapse' : 'Expand';
        if (nowExpanded) {
          expandedIds.add(itemId);
        } else {
          expandedIds.delete(itemId);
        }
      });

      historyListEl.appendChild(item);
    });
  } catch (error) {
    historyListEl.innerHTML = `<div class="muted" style="color:#c5221f;">Failed to load history: ${escapeHtml(error.message)}</div>`;
  }
}

function renderResultView(container, responses, rawOutput, viewMode) {
  container.innerHTML = '';
  if (viewMode === 'raw') {
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(rawOutput, null, 2);
    container.appendChild(pre);
  } else {
    if (!responses || responses.length === 0) {
      container.innerHTML = '<div class="muted">No results.</div>';
      return;
    }
    responses.forEach((result) => {
      const responseText = typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
      const renderedContent = result.success && window.MarkdownRenderer
        ? MarkdownRenderer.render(responseText)
        : escapeHtml(responseText);

      const resultEl = document.createElement('div');
      resultEl.className = 'result-item';
      resultEl.innerHTML = `
        <div class="result-header" style="cursor: default;">
          <div>${result.success ? '✓' : '✗'}</div>
          <div class="result-title">${escapeHtml(result.input || '')}</div>
        </div>
        <div class="result-content expanded markdown-content">${renderedContent}</div>
      `;
      container.appendChild(resultEl);
      if (window.MarkdownRenderer) {
        MarkdownRenderer.attachCodeCopyHandlers(resultEl);
      }
    });
  }
}

async function handleClear() {
  try {
    clearBtn.disabled = true;
    await HistoryStore.clearConversations();
    await StorageUtils.refreshStorageMetrics();
    showStatus('History cleared.', 'success');
    await loadHistory();
  } catch (error) {
    showStatus(`Failed to clear: ${error.message}`, 'error');
  } finally {
    clearBtn.disabled = false;
  }
}

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.style.display = 'block';
  setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}