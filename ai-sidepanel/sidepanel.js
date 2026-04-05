const inputJsonEl = document.getElementById('inputJson');
const runBtn = document.getElementById('runBtn');
const settingsBtn = document.getElementById('settingsBtn');
const statusEl = document.getElementById('status');
const outputJsonEl = document.getElementById('outputJson');
const copyBtn = document.getElementById('copyBtn');
const modelSelectEl = document.getElementById('modelSelect');
const developerControls = document.getElementById('developerControls');
const includeTabContentToggle = document.getElementById('includeTabContentToggle');
const includeSessionInfoToggle = document.getElementById('includeSessionInfoToggle');
const historyListEl = document.getElementById('historyList');
const historyUsageEl = document.getElementById('historyUsage');
const tasksListEl = document.getElementById('tasksList');
const tasksUsageEl = document.getElementById('tasksUsage');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const tasksViewBtn = document.getElementById('tasksViewBtn');
const historyViewBtn = document.getElementById('historyViewBtn');
const tasksPanel = document.getElementById('tasksPanel');
const historyPanel = document.getElementById('historyPanel');

const basicModeBtn = document.getElementById('basicModeBtn');
const advancedModeBtn = document.getElementById('advancedModeBtn');
const apiModeBtn = document.getElementById('apiModeBtn');
const basicMode = document.getElementById('basicMode');
const advancedMode = document.getElementById('advancedMode');
const apiMode = document.getElementById('apiMode');

const apiSource = document.getElementById('apiSource');
const apiAgent = document.getElementById('apiAgent');
const apiName = document.getElementById('apiName');
const apiModel = document.getElementById('apiModel');
const apiStatus = document.getElementById('apiStatus');
const apiOutput = document.getElementById('apiOutput');

// Chat elements
const chatModeBtn = document.getElementById('chatModeBtn');
const skillModeBtn = document.getElementById('skillModeBtn');
const newChatBtn = document.getElementById('newChatBtn');
const chatMessagesEl = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatCancelBtn = document.getElementById('chatCancelBtn');

let currentOutput = null;
let currentMode = 'basic';
let currentSettings = null;
let extensionMode = 'developer';
let includeTabContent = false;
let includeSessionInfo = true;
let jobsPollHandle = null;
let currentRunnerJobs = [];
let activeBottomView = 'tasks';
let activeJobByMode = { basic: null, advanced: null };
const deliveredJobResults = new Set();
const expandedTaskIds = new Set();
const expandedHistoryIds = new Set();
let taskResultViewMode = {};  // jobId -> 'markdown' | 'raw'

// Chat state
let chatMode = 'chat'; // 'chat' or 'skill'
let chatMessages = []; // Array of { role: 'user'|'assistant'|'system', content: string }
let chatBusy = false;
let chatCancelled = false;
let pendingSkillJobId = null;

document.addEventListener('DOMContentLoaded', initializeSidepanel);

async function initializeSidepanel() {
  runBtn.addEventListener('click', handleRun);
  settingsBtn.addEventListener('click', handleSettings);
  copyBtn.addEventListener('click', handleCopy);
  refreshHistoryBtn.addEventListener('click', refreshActivityPanels);
  tasksViewBtn.addEventListener('click', () => switchActivityView('tasks'));
  historyViewBtn.addEventListener('click', () => switchActivityView('history'));

  basicModeBtn.addEventListener('click', () => switchMode('basic'));
  advancedModeBtn.addEventListener('click', () => switchMode('advanced'));
  apiModeBtn.addEventListener('click', () => switchMode('api'));
  includeTabContentToggle.addEventListener('change', handleIncludeTabToggleChange);
  includeSessionInfoToggle.addEventListener('change', handleIncludeSessionToggleChange);

  // Chat event listeners
  chatModeBtn.addEventListener('click', () => switchChatMode('chat'));
  skillModeBtn.addEventListener('click', () => switchChatMode('skill'));
  newChatBtn.addEventListener('click', handleNewChat);
  chatSendBtn.addEventListener('click', handleChatSend);
  chatCancelBtn.addEventListener('click', handleChatCancel);
  chatInput.addEventListener('keydown', handleChatKeydown);
  chatInput.addEventListener('input', autoResizeChatInput);

  chrome.storage.local.onChanged.addListener(handleStorageChanges);

  currentSettings = await StorageUtils.loadSettings();
  extensionMode = currentSettings.extensionMode || 'developer';
  applyTheme(currentSettings.theme || 'light');
  applyExtensionMode(extensionMode);
  renderModelOptions(currentSettings);
  await loadContextPreferences();
  await loadChatMode();
  await loadMode();
  await loadApiSession();
  switchActivityView('tasks');
  await refreshActivityPanels();
  jobsPollHandle = setInterval(refreshRunnerJobs, 2000);
}

function handleStorageChanges(changes, areaName) {
  if (areaName !== 'local') {
    return;
  }

  if (changes.apiCurrentSession) {
    renderApiSession(changes.apiCurrentSession.newValue || null);
    if (changes.apiCurrentSession.newValue) {
      switchMode('api');
    }
  }

  if (changes.models || changes.defaultModelId || changes.apiUrl || changes.apiKey || changes.trustedSessionDomains || changes.runnerCookieEnvMap) {
    StorageUtils.loadSettings().then((settings) => {
      currentSettings = settings;
      extensionMode = settings.extensionMode || 'developer';
      applyTheme(settings.theme || 'light');
      applyExtensionMode(extensionMode);
      renderModelOptions(settings);
    });
  }

  if (changes.runnerJobsState) {
    refreshRunnerJobs();
  }

  if (changes.theme) {
    applyTheme(changes.theme.newValue || 'light');
  }

  if (changes.extensionMode) {
    extensionMode = changes.extensionMode.newValue || 'developer';
    applyExtensionMode(extensionMode);
    if (extensionMode === 'user' && currentMode !== 'basic') {
      switchMode('basic');
    }
  }

  if (changes.storageMetrics) {
    updateHistoryUsage(changes.storageMetrics.newValue);
  }
}

function switchActivityView(view) {
  activeBottomView = view === 'history' ? 'history' : 'tasks';
  const showTasks = activeBottomView === 'tasks';
  tasksPanel.style.display = showTasks ? 'block' : 'none';
  historyPanel.style.display = showTasks ? 'none' : 'block';
  tasksViewBtn.classList.toggle('active', showTasks);
  historyViewBtn.classList.toggle('active', !showTasks);
}

async function loadMode() {
  const result = await chrome.storage.local.get(['currentMode']);
  await switchMode(result.currentMode || 'basic');
}

async function switchMode(mode) {
  if (extensionMode === 'user' && mode !== 'basic') {
    mode = 'basic';
  }

  currentMode = mode;
  await chrome.storage.local.set({ currentMode: mode });

  basicMode.style.display = mode === 'basic' ? 'block' : 'none';
  advancedMode.style.display = mode === 'advanced' ? 'block' : 'none';
  apiMode.style.display = mode === 'api' ? 'block' : 'none';

  basicModeBtn.classList.toggle('active', mode === 'basic');
  advancedModeBtn.classList.toggle('active', mode === 'advanced');
  apiModeBtn.classList.toggle('active', mode === 'api');
}

function applyExtensionMode(mode) {
  const isDeveloperMode = mode !== 'user';

  advancedModeBtn.style.display = isDeveloperMode ? 'inline-block' : 'none';
  apiModeBtn.style.display = isDeveloperMode ? 'inline-block' : 'none';
  advancedMode.style.display = isDeveloperMode && currentMode === 'advanced' ? 'block' : 'none';
  apiMode.style.display = isDeveloperMode && currentMode === 'api' ? 'block' : 'none';
  developerControls.style.display = isDeveloperMode ? 'flex' : 'none';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}

function renderModelOptions(settings) {
  const selected = modelSelectEl.value || settings.defaultModelId;
  modelSelectEl.innerHTML = '';

  settings.models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = `${model.label} (${model.value})`;
    modelSelectEl.appendChild(option);
  });

  modelSelectEl.value = settings.models.some((model) => model.id === selected)
    ? selected
    : settings.defaultModelId;
}

function getSelectedModelId() {
  return modelSelectEl.value || (currentSettings && currentSettings.defaultModelId) || 'gpt-4o-mini';
}

async function handleRun() {
  try {
    const text = inputJsonEl.value.trim();
    if (!text) {
      throw new Error('Please enter JSON input');
    }

    const parsed = JSON.parse(text);
    parsed.modelId = getSelectedModelId();

    let requestPayload = parsed;
    const useSkillRunner = currentSettings
      && currentSettings.runnerConfig
      && currentSettings.runnerConfig.processingTarget === 'skill-runner';
    let source = { type: 'sidepanel-advanced' };
    if (includeTabContent || includeSessionInfo) {
      const trustedDomains = (currentSettings && currentSettings.trustedSessionDomains) || [];
      const tabData = await captureCurrentTab({ trustedDomains });
      const trustedActive = isTrustedDomain(tabData.url, trustedDomains);
      const allowSession = includeSessionInfo && trustedDomains.length > 0;
      const includeStorageSnapshots = allowSession && trustedActive;
      if (!useSkillRunner) {
        requestPayload = attachActiveTabContextToRequest(parsed, tabData, {
          includePageContent: includeTabContent,
          includeSession: allowSession,
          includeStorageSnapshots
        });
      }
      source = {
        type: 'sidepanel-advanced',
        url: tabData.url,
        title: tabData.title,
        ...(includeTabContent ? {
          pageText: tabData.pageText || '',
          headings: tabData.headings || [],
          meta: tabData.meta || {},
          links: tabData.links || []
        } : {}),
        ...(allowSession ? {
          cookies: trustedActive ? (tabData.cookies || []) : [],
          cookieHeader: trustedActive ? (tabData.cookieHeader || '') : '',
          cookiesByDomain: tabData.cookiesByDomain || {},
          cookieHeadersByDomain: tabData.cookieHeadersByDomain || {},
          sessionStorageSnapshot: includeStorageSnapshots ? (tabData.sessionStorageSnapshot || {}) : {},
          localStorageSnapshot: includeStorageSnapshots ? (tabData.localStorageSnapshot || {}) : {}
        } : {}),
        sessionInfoAllowed: allowSession
      };
    }

    showStatus(statusEl, 'Processing request...', 'loading');
    runBtn.disabled = true;

    const response = await sendRuntimeMessage({
      command: 'process-request',
      mode: 'advanced',
      source,
      data: requestPayload
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    if (response.accepted && response.jobId) {
      activeJobByMode.advanced = response.jobId;
      showStatus(statusEl, `Queued runner job ${response.jobId}. Waiting for execution...`, 'loading');
      await refreshRunnerJobs();
    } else {
      displayOutput(response.output);
      showStatus(statusEl, `Completed ${response.output.response.length} task(s).`, 'success');
      await renderHistory();
    }
  } catch (error) {
    console.error('[Sidepanel] Advanced request failed:', error);
    showStatus(statusEl, `Error: ${error.message}`, 'error');
  } finally {
    runBtn.disabled = false;
  }
}

async function loadContextPreferences() {
  const result = await chrome.storage.local.get(['includeTabContent', 'includeSessionInfo']);
  includeTabContent = result.includeTabContent === true;
  includeSessionInfo = result.includeSessionInfo !== false;
  includeTabContentToggle.checked = includeTabContent;
  includeSessionInfoToggle.checked = includeSessionInfo;
}

async function handleIncludeTabToggleChange() {
  includeTabContent = includeTabContentToggle.checked;
  await chrome.storage.local.set({ includeTabContent });
}

async function handleIncludeSessionToggleChange() {
  includeSessionInfo = includeSessionInfoToggle.checked;
  await chrome.storage.local.set({ includeSessionInfo });
}

function attachActiveTabContextToRequest(requestObject, tabData, options) {
  const clone = JSON.parse(JSON.stringify(requestObject));
  const taskList = Array.isArray(clone.params)
    ? clone.params
    : Array.isArray(clone.tasks)
      ? clone.tasks
      : null;

  if (!taskList || taskList.length === 0) {
    return clone;
  }

  const includePageContent = !!(options && options.includePageContent);
  const includeSession = !!(options && options.includeSession);
  const includeStorageSnapshots = !!(options && options.includeStorageSnapshots);
  const allowSession = includeSession;
  taskList.forEach((task) => {
    if (!task || typeof task !== 'object') {
      return;
    }
    if (!Array.isArray(task.supplements)) {
      task.supplements = [];
    }
    task.supplements.push({ type: 'json', label: 'Active Tab Meta', value: { title: tabData.title, url: tabData.url } });
    if (includePageContent) {
      task.supplements.push(
        { type: 'text', label: 'Active Tab Page Content', text: tabData.pageText || '' },
        { type: 'screenshot', data: tabData.screenshot, fileName: 'captured-tab.png' },
        { type: 'json', label: 'Headings', value: tabData.headings || [] },
        { type: 'json', label: 'Meta', value: tabData.meta || {} },
        { type: 'json', label: 'Links', value: tabData.links || [] }
      );
    }
    if (allowSession) {
      task.supplements.push(
        { type: 'json', label: 'Cookies By Domain', value: tabData.cookieHeadersByDomain || {} }
      );
      if (includeStorageSnapshots) {
        task.supplements.push(
          { type: 'json', label: 'Session Storage', value: tabData.sessionStorageSnapshot || {} },
          { type: 'json', label: 'Local Storage', value: tabData.localStorageSnapshot || {} }
        );
      }
    }
  });

  return clone;
}

function isTrustedDomain(url, trustedDomains) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const list = Array.isArray(trustedDomains) ? trustedDomains : [];
    return list.some((entry) => {
      const domain = String(entry || '').trim().toLowerCase();
      if (!domain) {
        return false;
      }
      if (domain.startsWith('*.')) {
        const suffix = domain.slice(1);
        return host.endsWith(suffix);
      }
      return host === domain || host.endsWith(`.${domain}`);
    });
  } catch (error) {
    return false;
  }
}

async function loadApiSession() {
  const response = await sendRuntimeMessage({ command: 'get-api-session' });
  if (response.success) {
    renderApiSession(response.session);
  }
}

function renderApiSession(session) {
  if (!session) {
    apiSource.textContent = 'Waiting for an API request from a page.';
    apiAgent.textContent = '-';
    apiName.textContent = '-';
    apiModel.textContent = '-';
    apiOutput.innerHTML = '<div class="muted">No API session has been processed yet.</div>';
    apiStatus.style.display = 'none';
    return;
  }

  const sourceUrl = session.source && session.source.url ? session.source.url : 'Unknown source';
  apiSource.textContent = `${sourceUrl} (${new Date(session.createdAt).toLocaleString()})`;
  apiAgent.textContent = session.agent;
  apiName.textContent = session.name;
  apiModel.textContent = session.model;

  const progressText = session.status === 'processing'
    ? `Processing ${session.progress.completed}/${session.progress.total}`
    : `Completed ${session.progress.completed}/${session.progress.total}`;
  showStatus(apiStatus, progressText, session.status === 'processing' ? 'loading' : 'success');

  if (session.responses && session.responses.length > 0) {
    displayResponseCards(apiOutput, session.responses, true);
  } else {
    apiOutput.innerHTML = '<div class="muted">Results will appear here when an API request arrives.</div>';
  }
}

function displayOutput(output) {
  currentOutput = output;
  outputJsonEl.textContent = JSON.stringify(output, null, 2);
  copyBtn.style.display = 'inline-block';
}

async function handleCopy() {
  if (!currentOutput) {
    return;
  }

  await navigator.clipboard.writeText(JSON.stringify(currentOutput, null, 2));
  const original = copyBtn.textContent;
  copyBtn.textContent = 'Copied';
  setTimeout(() => {
    copyBtn.textContent = original;
  }, 1500);
}

function handleSettings() {
  chrome.runtime.openOptionsPage();
}

async function refreshActivityPanels() {
  await Promise.all([
    renderHistory(),
    refreshRunnerJobs()
  ]);
}

async function refreshRunnerJobs() {
  try {
    const response = await sendRuntimeMessage({ command: 'get-runner-jobs' });
    if (!response.success) {
      return;
    }
    currentRunnerJobs = Array.isArray(response.jobs) ? response.jobs : [];
    renderRunnerJobs(currentRunnerJobs);
    syncTrackedJobStatuses();
  } catch (error) {
    console.warn('[Sidepanel] Failed to refresh runner jobs:', error);
  }
}

function renderRunnerJobs(jobs) {
  // Only show queued and running jobs in Current Tasks.
  // Completed/failed/timed_out jobs are shown in History tab.
  const active = jobs.filter((job) => job.status === 'queued' || job.status === 'running');

  tasksUsageEl.textContent = `${active.length} active task(s)`;

  if (active.length === 0) {
    tasksListEl.innerHTML = '<div class="muted">No active tasks. Completed tasks appear in the History tab.</div>';
    return;
  }

  tasksListEl.innerHTML = '';
  active.forEach((job) => {
    const item = document.createElement('div');
    item.className = 'task-item';
    const timerText = buildJobTimerText(job);
    const progress = job.progress || {};
    item.innerHTML = `
      <div class="task-header">
        <div class="task-title">${escapeHtml(job.requestName || 'Runner Task')}</div>
        <div class="task-meta">${escapeHtml(job.status)}${job.queuePosition ? ` · Queue ${job.queuePosition}` : ''}</div>
        <div class="task-toggle">${timerText}</div>
      </div>
      <div class="task-content expanded">
        <div class="muted">Mode: ${escapeHtml(job.mode || '-')} · Runner: ${escapeHtml((job.runner && job.runner.type) || '-')} (${escapeHtml((job.runner && job.runner.mode) || '-')})</div>
        <div class="muted">Created: ${job.createdAt ? new Date(job.createdAt).toLocaleString() : '-'}</div>
        <div class="muted">Started: ${job.startedAt ? new Date(job.startedAt).toLocaleString() : '-'}</div>
        <div class="muted">Progress: ${progress.completed || 0}/${progress.total || 0}${progress.input ? ' — ' + escapeHtml(progress.input) : ''}</div>
        ${job.error ? `<div class="muted" style="color:#c5221f;">${escapeHtml(job.error)}</div>` : ''}
      </div>
    `;
    tasksListEl.appendChild(item);
  });
}

function buildJobTimerText(job) {
  const now = Date.now();
  const queuedAt = job.queuedAt ? new Date(job.queuedAt).getTime() : now;
  const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : null;
  if (job.status === 'queued') {
    return `Waiting ${formatDuration(now - queuedAt)}`;
  }
  if (job.status === 'running') {
    const activeStartedAt = job.activeTaskStartedAt ? new Date(job.activeTaskStartedAt).getTime() : startedAt || now;
    const elapsed = now - activeStartedAt;
    const timeoutMs = job.activeTaskTimeoutMs || job.timeoutMs || 120000;
    const remaining = Math.max(0, timeoutMs - elapsed);
    return `Elapsed ${formatDuration(elapsed)} · Timeout in ${formatDuration(remaining)}`;
  }
  return job.finishedAt ? `Done in ${formatDuration(new Date(job.finishedAt).getTime() - (startedAt || queuedAt))}` : 'Done';
}

function syncTrackedJobStatuses() {
  // Only track advanced mode jobs here; basic/chat mode jobs are handled by awaitSkillJobResult
  const advancedJobId = activeJobByMode.advanced;
  if (!advancedJobId) {
    return;
  }

  const job = currentRunnerJobs.find((entry) => entry.id === advancedJobId);
  if (!job) {
    return;
  }

  if (job.status === 'queued') {
    const queueSuffix = job.queuePosition ? ` (queue ${job.queuePosition})` : '';
    showStatus(statusEl, `Queued${queueSuffix}. Waiting ${buildJobTimerText(job)}.`, 'loading');
    return;
  }

  if (job.status === 'running') {
    const progress = job.progress || {};
    showStatus(
      statusEl,
      `Running ${progress.completed || 0}/${progress.total || 0}. ${buildJobTimerText(job)}`,
      'loading'
    );
    return;
  }

  if (deliveredJobResults.has(job.id)) {
    return;
  }

  deliveredJobResults.add(job.id);
  const output = job.output || { response: job.responses || [] };
  displayOutput(output);

  if (job.status === 'completed') {
    showStatus(statusEl, `Runner job completed (${(output.response || []).length} task result(s)). See History tab.`, 'success');
  } else if (job.status === 'timed_out') {
    showStatus(statusEl, `Runner job timed out. See History tab.`, 'error');
  } else {
    showStatus(statusEl, `Runner job finished with errors. See History tab.`, 'error');
  }

  // Auto-expand completed job in history and switch to history view
  expandedHistoryIds.add(job.id);
  taskResultViewMode[job.id] = 'markdown';
  switchActivityView('history');
  renderHistory();
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

async function renderHistory() {
  const [conversations, metrics] = await Promise.all([
    HistoryStore.getRecentConversations(10),
    StorageUtils.refreshStorageMetrics()
  ]);

  updateHistoryUsage(metrics);

  // Merge completed runner jobs into history view
  const completedJobs = currentRunnerJobs.filter((job) =>
    job.status === 'completed' || job.status === 'failed' || job.status === 'timed_out'
  );

  // Build unified list: completed runner jobs first (newest first), then stored conversations
  const historyItems = [];

  completedJobs.forEach((job) => {
    historyItems.push({
      id: job.id,
      type: 'runner-job',
      title: job.requestName || 'Runner Task',
      meta: `${job.status} · ${job.mode || '-'} · ${(job.runner && job.runner.type) || '-'}`,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      source: job.source,
      error: job.error,
      responses: (job.output && job.output.response) || job.responses || [],
      rawOutput: job.output || { response: job.responses || [] },
      durationMs: job.finishedAt && job.startedAt
        ? new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()
        : null,
      job
    });
  });

  conversations.forEach((entry) => {
    historyItems.push({
      id: entry.id || entry.createdAt,
      type: 'conversation',
      title: entry.requestName,
      meta: `${entry.mode} · ${entry.model}`,
      createdAt: entry.createdAt,
      source: entry.source,
      requestData: entry.requestData,
      outputData: entry.outputData
    });
  });

  if (historyItems.length === 0) {
    historyListEl.innerHTML = '<div class="muted">No history yet.</div>';
    return;
  }

  historyListEl.innerHTML = '';

  historyItems.forEach((entry, index) => {
    const itemId = entry.id || `history-${index}`;
    const isExpanded = expandedHistoryIds.has(itemId) || (index === 0 && expandedHistoryIds.size === 0);

    const item = document.createElement('div');
    item.className = 'history-item';

    if (entry.type === 'runner-job') {
      const viewMode = taskResultViewMode[itemId] || 'markdown';
      const responses = entry.responses || [];
      const durationText = entry.durationMs ? ` · ${formatDuration(entry.durationMs)}` : '';

      item.innerHTML = `
        <div class="history-header">
          <div class="history-title">${escapeHtml(entry.title)}</div>
          <div class="history-meta">${escapeHtml(entry.meta)}${durationText}</div>
          <div class="history-toggle">${isExpanded ? 'Collapse' : 'Expand'}</div>
        </div>
        <div class="history-content${isExpanded ? ' expanded' : ''}">
          <div class="muted">${entry.finishedAt ? new Date(entry.finishedAt).toLocaleString() : '-'}</div>
          ${entry.error ? `<div class="muted" style="color:#c5221f;">${escapeHtml(entry.error)}</div>` : ''}
          <div class="toolbar" style="margin-top: 8px; margin-bottom: 8px;">
            <button class="mode-btn view-markdown-btn ${viewMode === 'markdown' ? 'active' : ''}" style="padding: 4px 10px; font-size: 12px;">Formatted</button>
            <button class="mode-btn view-raw-btn ${viewMode === 'raw' ? 'active' : ''}" style="padding: 4px 10px; font-size: 12px;">Raw JSON</button>
          </div>
          <div class="history-result-container"></div>
        </div>
      `;

      const resultContainer = item.querySelector('.history-result-container');
      renderJobResultView(resultContainer, responses, entry.rawOutput, viewMode);

      const markdownBtn = item.querySelector('.view-markdown-btn');
      const rawBtn = item.querySelector('.view-raw-btn');
      markdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        taskResultViewMode[itemId] = 'markdown';
        markdownBtn.classList.add('active');
        rawBtn.classList.remove('active');
        renderJobResultView(resultContainer, responses, entry.rawOutput, 'markdown');
      });
      rawBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        taskResultViewMode[itemId] = 'raw';
        rawBtn.classList.add('active');
        markdownBtn.classList.remove('active');
        renderJobResultView(resultContainer, responses, entry.rawOutput, 'raw');
      });

    } else {
      // Stored conversation
      item.innerHTML = `
        <div class="history-header">
          <div class="history-title">${escapeHtml(entry.title)}</div>
          <div class="history-meta">${escapeHtml(entry.meta)}</div>
          <div class="history-toggle">${isExpanded ? 'Collapse' : 'Expand'}</div>
        </div>
        <div class="history-content${isExpanded ? ' expanded' : ''}">
          <div class="muted">Stored ${new Date(entry.createdAt).toLocaleString()}</div>
          <div class="muted">Source: ${entry.source && entry.source.url ? entry.source.url : entry.source && entry.source.type ? entry.source.type : 'unknown'}</div>
          <div class="section-title" style="margin-top: 12px;">Request</div>
          <pre>${escapeHtml(JSON.stringify(entry.requestData, null, 2))}</pre>
          <div class="section-title" style="margin-top: 12px;">Output</div>
          <pre>${escapeHtml(JSON.stringify(entry.outputData, null, 2))}</pre>
        </div>
      `;
    }

    const header = item.querySelector('.history-header');
    const content = item.querySelector('.history-content');
    const toggle = item.querySelector('.history-toggle');
    header.addEventListener('click', () => {
      const nowExpanded = content.classList.toggle('expanded');
      toggle.textContent = nowExpanded ? 'Collapse' : 'Expand';
      if (nowExpanded) {
        expandedHistoryIds.add(itemId);
      } else {
        expandedHistoryIds.delete(itemId);
      }
    });

    // Track initial expand state
    if (isExpanded) {
      expandedHistoryIds.add(itemId);
    }

    historyListEl.appendChild(item);
  });
}

function renderJobResultView(container, responses, rawOutput, viewMode) {
  container.innerHTML = '';
  if (viewMode === 'raw') {
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(rawOutput, null, 2);
    container.appendChild(pre);
  } else {
    // Markdown / formatted view
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

function updateHistoryUsage(metrics) {
  historyUsageEl.textContent = `${metrics.historyCount} conversation(s) stored · ${StorageUtils.formatBytes(metrics.totalBytes)}`;
}

function showStatus(element, message, type) {
  element.textContent = message;
  element.className = `status ${type}`;
  element.style.display = 'block';
}

function displayResponseCards(container, results, autoExpandFirst) {
  container.innerHTML = '';

  results.forEach((result, index) => {
    const icon = result.success ? '✓' : '✗';
    const renderedContent = result.success && window.MarkdownRenderer
      ? MarkdownRenderer.render(result.response)
      : escapeHtml(result.response);

    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <div class="result-header">
        <div>${icon}</div>
        <div class="result-title">${escapeHtml(result.input)}</div>
        <div class="result-toggle">Expand</div>
      </div>
      <div class="result-content markdown-content">${renderedContent}</div>
    `;

    const header = item.querySelector('.result-header');
    const content = item.querySelector('.result-content');
    const toggle = item.querySelector('.result-toggle');
    header.addEventListener('click', () => {
      const expanded = content.classList.toggle('expanded');
      toggle.textContent = expanded ? 'Collapse' : 'Expand';
    });

    if (autoExpandFirst && index === 0) {
      content.classList.add('expanded');
      toggle.textContent = 'Collapse';
    }

    container.appendChild(item);
  });
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

function sendRuntimeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function captureCurrentTab(options) {
  const trustedDomains = options && Array.isArray(options.trustedDomains)
    ? options.trustedDomains
    : [];
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ command: 'capture-tab', trustedDomains }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response.success) {
        reject(new Error(response.error));
        return;
      }

      resolve(response.data);
    });
  });
}

// ─── Chat Mode Logic ────────────────────────────────────────────────────────

async function loadChatMode() {
  const result = await chrome.storage.local.get(['chatMode']);
  const stored = result.chatMode;
  chatMode = (stored === 'skill') ? 'skill' : (StorageUtils.DEFAULT_CHAT_MODE || 'chat');
  applyChatModeToggle();
}

async function switchChatMode(mode) {
  chatMode = mode === 'skill' ? 'skill' : 'chat';
  await chrome.storage.local.set({ chatMode });
  applyChatModeToggle();
}

function applyChatModeToggle() {
  chatModeBtn.classList.toggle('active', chatMode === 'chat');
  skillModeBtn.classList.toggle('active', chatMode === 'skill');
}

function handleNewChat() {
  chatMessages = [];
  pendingSkillJobId = null;
  chatBusy = false;
  chatSendBtn.disabled = false;
  chatInput.value = '';
  renderChatMessages();
}

function handleChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleChatSend();
  }
}

function autoResizeChatInput() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
}

async function handleChatSend() {
  const text = chatInput.value.trim();
  if (!text || chatBusy) {
    return;
  }

  chatBusy = true;
  chatCancelled = false;
  chatSendBtn.disabled = true;
  chatSendBtn.style.display = 'none';
  chatCancelBtn.style.display = 'inline-block';
  chatInput.value = '';
  autoResizeChatInput();

  // Add user message to chat
  chatMessages.push({ role: 'user', content: text });
  renderChatMessages();
  scrollChatToBottom();

  // Show typing indicator
  showTypingIndicator();

  try {
    if (chatMode === 'chat') {
      await sendChatModeMessage(text);
    } else {
      await sendSkillModeMessage(text);
    }
  } catch (error) {
    if (!chatCancelled) {
      console.error('[Sidepanel] Chat send failed:', error);
      appendChatBubble('error', `Error: ${error.message}`);
    }
  } finally {
    removeTypingIndicator();
    chatBusy = false;
    chatCancelled = false;
    chatSendBtn.disabled = false;
    chatSendBtn.style.display = 'inline-block';
    chatCancelBtn.style.display = 'none';
    scrollChatToBottom();
  }
}

async function handleChatCancel() {
  chatCancelled = true;

  // If there's a pending skill job, try to cancel it
  if (pendingSkillJobId) {
    try {
      await sendRuntimeMessage({ command: 'cancel-runner-job', jobId: pendingSkillJobId });
    } catch (err) {
      console.warn('[Sidepanel] Failed to cancel runner job:', err);
    }
    pendingSkillJobId = null;
  }

  // Remove the last user message if no assistant response was added yet
  if (chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'user') {
    chatMessages.pop();
  }

  removeTypingIndicator();
  appendChatBubble('system-info', 'Cancelled.');
  chatBusy = false;
  chatSendBtn.disabled = false;
  chatSendBtn.style.display = 'inline-block';
  chatCancelBtn.style.display = 'none';
  scrollChatToBottom();
}

async function sendChatModeMessage(userText) {
  // Build system message with page context
  let systemContent = 'You are a helpful AI assistant.';

  if (includeTabContent || includeSessionInfo) {
    try {
      const trustedDomains = (currentSettings && currentSettings.trustedSessionDomains) || [];
      const tabData = await captureCurrentTab({ trustedDomains });
      const parts = [`Current page: ${tabData.title} (${tabData.url})`];
      if (includeTabContent && tabData.pageText) {
        const truncated = tabData.pageText.length > 8000
          ? tabData.pageText.slice(0, 8000) + '\n[...truncated]'
          : tabData.pageText;
        parts.push(`Page content:\n${truncated}`);
      }
      systemContent += '\n\n' + parts.join('\n\n');
    } catch (err) {
      console.warn('[Sidepanel] Could not capture tab for chat context:', err);
    }
  }

  // Build OpenAI-compatible messages array
  const messages = [
    { role: 'system', content: systemContent }
  ];

  // Add conversation history
  chatMessages.forEach((msg) => {
    messages.push({ role: msg.role, content: msg.content });
  });

  const response = await sendRuntimeMessage({
    command: 'chat-message',
    chatMode: 'chat',
    modelId: getSelectedModelId(),
    messages
  });

  if (!response.success) {
    throw new Error(response.error || 'Chat request failed');
  }

  const reply = response.reply || '';
  chatMessages.push({ role: 'assistant', content: reply });
  renderChatMessages();
}

async function sendSkillModeMessage(userText) {
  // Build concatenated context string for skill mode
  const contextString = buildSkillContextString();

  // Build source with tab info if enabled
  let source = { type: 'sidepanel-chat-skill' };
  if (includeTabContent || includeSessionInfo) {
    try {
      const trustedDomains = (currentSettings && currentSettings.trustedSessionDomains) || [];
      const tabData = await captureCurrentTab({ trustedDomains });
      const trustedActive = isTrustedDomain(tabData.url, trustedDomains);
      const allowSession = includeSessionInfo && trustedDomains.length > 0;
      source = {
        type: 'sidepanel-chat-skill',
        url: tabData.url,
        title: tabData.title,
        ...(includeTabContent ? {
          pageText: tabData.pageText || '',
          headings: tabData.headings || [],
          meta: tabData.meta || {},
          links: tabData.links || []
        } : {}),
        ...(allowSession ? {
          cookiesByDomain: tabData.cookiesByDomain || {},
          cookieHeadersByDomain: tabData.cookieHeadersByDomain || {},
        } : {}),
        sessionInfoAllowed: allowSession
      };
    } catch (err) {
      console.warn('[Sidepanel] Could not capture tab for skill context:', err);
    }
  }

  const response = await sendRuntimeMessage({
    command: 'chat-message',
    chatMode: 'skill',
    modelId: getSelectedModelId(),
    contextString,
    source
  });

  if (!response.success) {
    throw new Error(response.error || 'Skill request failed');
  }

  if (response.accepted && response.jobId) {
    // Skill runner queued - track the job for result delivery
    pendingSkillJobId = response.jobId;
    appendChatBubble('system-info', `Skill job queued (${response.jobId}). Waiting for result...`);
    // The result will be picked up by syncTrackedJobStatuses or a poll
    activeJobByMode.basic = response.jobId;
    awaitSkillJobResult(response.jobId);
    return;
  }

  // Direct response
  const reply = response.reply || '';
  chatMessages.push({ role: 'assistant', content: reply });
  renderChatMessages();
}

function buildSkillContextString() {
  const parts = [];
  let turnIndex = 0;

  for (let i = 0; i < chatMessages.length; i++) {
    const msg = chatMessages[i];
    if (msg.role === 'user') {
      turnIndex++;
      parts.push(`User - "${msg.content}"`);
    } else if (msg.role === 'assistant') {
      parts.push(`RUNRESULT#${turnIndex}\n${msg.content}`);
    }
  }

  return parts.join('\n\n');
}

async function awaitSkillJobResult(jobId) {
  // Poll for job completion — reuse the runner jobs refresh mechanism
  const maxWait = 300000; // 5 minutes max
  const pollInterval = 2000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    if (chatCancelled) {
      pendingSkillJobId = null;
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    if (chatCancelled) {
      pendingSkillJobId = null;
      return;
    }

    try {
      const response = await sendRuntimeMessage({ command: 'get-runner-job', jobId });
      if (!response.success || !response.job) {
        continue;
      }

      const job = response.job;
      if (job.status === 'completed') {
        const output = job.output || { response: job.responses || [] };
        const firstResult = output.response && output.response[0];
        const reply = firstResult ? (firstResult.response || '') : 'No response from skill runner.';
        chatMessages.push({ role: 'assistant', content: reply });
        removeTypingIndicator();
        renderChatMessages();
        scrollChatToBottom();
        chatBusy = false;
        chatSendBtn.disabled = false;
        pendingSkillJobId = null;
        return;
      }

      if (job.status === 'failed' || job.status === 'timed_out') {
        const errorMsg = job.error || `Skill job ${job.status}`;
        appendChatBubble('error', errorMsg);
        removeTypingIndicator();
        chatBusy = false;
        chatSendBtn.disabled = false;
        pendingSkillJobId = null;
        return;
      }

      // Still running or queued — continue polling
    } catch (err) {
      console.warn('[Sidepanel] Skill job poll error:', err);
    }
  }

  // Timed out waiting
  appendChatBubble('error', 'Timed out waiting for skill runner result.');
  removeTypingIndicator();
  chatBusy = false;
  chatSendBtn.disabled = false;
  pendingSkillJobId = null;
}

function renderChatMessages() {
  chatMessagesEl.innerHTML = '';

  if (chatMessages.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'chat-bubble system-info';
    placeholder.textContent = chatMode === 'chat'
      ? 'Start a conversation. Type a message below.'
      : 'Skill mode active. Your messages will be processed by the skill runner.';
    chatMessagesEl.appendChild(placeholder);
    return;
  }

  chatMessages.forEach((msg) => {
    if (msg.role === 'user') {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble user';
      bubble.textContent = msg.content;
      chatMessagesEl.appendChild(bubble);
    } else if (msg.role === 'assistant') {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble assistant';
      const rendered = window.MarkdownRenderer
        ? MarkdownRenderer.render(msg.content)
        : escapeHtml(msg.content);
      bubble.innerHTML = `<div class="markdown-content">${rendered}</div>`;
      chatMessagesEl.appendChild(bubble);
      // Attach copy handlers for code blocks (CSP-safe, no inline onclick)
      if (window.MarkdownRenderer) {
        MarkdownRenderer.attachCodeCopyHandlers(bubble);
      }
    }
  });

  scrollChatToBottom();
}

function appendChatBubble(type, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${type}`;
  bubble.textContent = text;
  chatMessagesEl.appendChild(bubble);
  scrollChatToBottom();
}

function showTypingIndicator() {
  removeTypingIndicator();
  const indicator = document.createElement('div');
  indicator.className = 'chat-typing';
  indicator.id = 'chatTypingIndicator';
  indicator.textContent = chatMode === 'chat' ? 'Thinking...' : 'Running skill...';
  chatMessagesEl.appendChild(indicator);
  scrollChatToBottom();
}

function removeTypingIndicator() {
  const existing = document.getElementById('chatTypingIndicator');
  if (existing) {
    existing.remove();
  }
}

function scrollChatToBottom() {
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}
