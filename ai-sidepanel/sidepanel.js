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
const basicQuestion = document.getElementById('basicQuestion');
const captureBtn = document.getElementById('captureBtn');
const basicStatus = document.getElementById('basicStatus');
const basicOutput = document.getElementById('basicOutput');

const apiSource = document.getElementById('apiSource');
const apiAgent = document.getElementById('apiAgent');
const apiName = document.getElementById('apiName');
const apiModel = document.getElementById('apiModel');
const apiStatus = document.getElementById('apiStatus');
const apiOutput = document.getElementById('apiOutput');

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
  captureBtn.addEventListener('click', handleCapture);
  includeTabContentToggle.addEventListener('change', handleIncludeTabToggleChange);
  includeSessionInfoToggle.addEventListener('change', handleIncludeSessionToggleChange);

  chrome.storage.local.onChanged.addListener(handleStorageChanges);

  currentSettings = await StorageUtils.loadSettings();
  extensionMode = currentSettings.extensionMode || 'developer';
  applyTheme(currentSettings.theme || 'light');
  applyExtensionMode(extensionMode);
  renderModelOptions(currentSettings);
  await loadContextPreferences();
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

async function handleCapture() {
  try {
    const question = basicQuestion.value.trim();
    if (!question) {
      throw new Error('Please enter a question first');
    }

    captureBtn.disabled = true;
    let request = null;
    let source = {
      type: 'sidepanel-basic'
    };

    const useSkillRunner = currentSettings
      && currentSettings.runnerConfig
      && currentSettings.runnerConfig.processingTarget === 'skill-runner';
    if (includeTabContent || includeSessionInfo) {
      showStatus(basicStatus, 'Capturing current tab...', 'loading');
      const trustedDomains = (currentSettings && currentSettings.trustedSessionDomains) || [];
      const tabData = await captureCurrentTab({ trustedDomains });
      const trustedActive = isTrustedDomain(tabData.url, trustedDomains);
      const allowSession = includeSessionInfo && trustedDomains.length > 0;
      const includeStorageSnapshots = allowSession && trustedActive;
      const sessionStatus = !allowSession
        ? 'Session info disabled.'
        : includeStorageSnapshots
          ? 'Trusted cookies + active-tab storage included.'
          : 'Trusted-domain cookies included (active-tab storage skipped; tab domain not trusted).';
      request = useSkillRunner
        ? {
          agent: 'You are a helpful AI assistant that analyzes web pages.',
          name: 'PAGE_ANALYZER',
          modelId: getSelectedModelId(),
          params: [{ input: question }]
        }
        : {
          agent: 'You are a helpful AI assistant that analyzes web pages using the provided text and screenshots.',
          name: 'PAGE_ANALYZER',
          modelId: getSelectedModelId(),
          params: [{
            input: question,
            data: [
              `Page Title: ${tabData.title}`,
              `Page URL: ${tabData.url}`,
              includeTabContent ? `Page Content: ${tabData.pageText || ''}` : 'Page Content: (not included)',
              allowSession ? `Cookies: ${tabData.cookieHeader || '-'}` : 'Cookies: (not included)',
              `Session Info: ${sessionStatus}`
            ].join('\n'),
            supplements: [
              ...(includeTabContent ? [
                { type: 'screenshot', data: tabData.screenshot, fileName: 'captured-tab.png' },
                { type: 'json', label: 'Headings', value: tabData.headings },
                { type: 'json', label: 'Meta', value: tabData.meta },
                { type: 'json', label: 'Links', value: tabData.links }
              ] : []),
              ...(allowSession ? [
                { type: 'json', label: 'Cookies By Domain', value: tabData.cookieHeadersByDomain || {} },
                ...(includeStorageSnapshots ? [
                  { type: 'json', label: 'Session Storage', value: tabData.sessionStorageSnapshot || {} },
                  { type: 'json', label: 'Local Storage', value: tabData.localStorageSnapshot || {} }
                ] : [])
              ] : [])
            ]
          }]
        };
      source = {
        type: 'sidepanel-basic',
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
      showStatus(
        basicStatus,
        allowSession
          ? 'Sending prompt with selected page/session context...'
          : 'Sending prompt (session info skipped for untrusted domain or disabled)...',
        'loading'
      );
    } else {
      request = {
        agent: 'You are a helpful AI assistant.',
        name: 'CHAT_QUERY',
        modelId: getSelectedModelId(),
        params: [{
          input: question
        }]
      };
      showStatus(basicStatus, 'Sending prompt without active tab context...', 'loading');
    }

    const response = await sendRuntimeMessage({
      command: 'process-request',
      mode: 'basic',
      source,
      data: request
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    if (response.accepted && response.jobId) {
      activeJobByMode.basic = response.jobId;
      showStatus(basicStatus, `Queued runner job ${response.jobId}. Waiting for execution...`, 'loading');
      await refreshRunnerJobs();
    } else {
      displayResponseCards(basicOutput, response.output.response, true);
      showStatus(basicStatus, 'Analysis complete.', 'success');
      await renderHistory();
    }
  } catch (error) {
    console.error('[Sidepanel] Capture failed:', error);
    showStatus(basicStatus, `Error: ${error.message}`, 'error');
  } finally {
    captureBtn.disabled = false;
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
  const active = jobs.filter((job) =>
    job.status === 'queued' || job.status === 'running' || job.status === 'completed' || job.status === 'failed' || job.status === 'timed_out'
  );

  tasksUsageEl.textContent = `${active.length} task(s) in queue/history window`;

  if (active.length === 0) {
    tasksListEl.innerHTML = '<div class="muted">No current tasks.</div>';
    return;
  }

  tasksListEl.innerHTML = '';
  active.forEach((job, index) => {
    const item = document.createElement('div');
    item.className = 'task-item';
    const timerText = buildJobTimerText(job);
    const details = (job.output && job.output.response) || job.responses || [];
    item.innerHTML = `
      <div class="task-header">
        <div class="task-title">${escapeHtml(job.requestName || 'Runner Task')}</div>
        <div class="task-meta">${escapeHtml(job.status)}${job.queuePosition ? ` · Queue ${job.queuePosition}` : ''}</div>
        <div class="task-toggle">${(job.status === 'completed' || job.status === 'failed' || job.status === 'timed_out') ? 'Expand' : timerText}</div>
      </div>
      <div class="task-content">
        <div class="muted">Mode: ${escapeHtml(job.mode || '-')} · Runner: ${escapeHtml((job.runner && job.runner.type) || '-')} (${escapeHtml((job.runner && job.runner.mode) || '-')})</div>
        <div class="muted">Created: ${job.createdAt ? new Date(job.createdAt).toLocaleString() : '-'}</div>
        <div class="muted">Started: ${job.startedAt ? new Date(job.startedAt).toLocaleString() : '-'}</div>
        <div class="muted">Finished: ${job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '-'}</div>
        <div class="muted">Progress: ${(job.progress && job.progress.completed) || 0}/${(job.progress && job.progress.total) || 0}</div>
        ${job.error ? `<div class="muted" style="color:#c5221f;">${escapeHtml(job.error)}</div>` : ''}
        <div class="section-title" style="margin-top: 12px;">Results</div>
        <pre>${escapeHtml(JSON.stringify(details, null, 2))}</pre>
      </div>
    `;

    const header = item.querySelector('.task-header');
    const content = item.querySelector('.task-content');
    const toggle = item.querySelector('.task-toggle');
    header.addEventListener('click', () => {
      const expandable = job.status === 'completed' || job.status === 'failed' || job.status === 'timed_out';
      if (!expandable) {
        return;
      }
      const expanded = content.classList.toggle('expanded');
      toggle.textContent = expanded ? 'Collapse' : 'Expand';
    });

    if (index === 0 && (job.status === 'completed' || job.status === 'failed' || job.status === 'timed_out')) {
      content.classList.add('expanded');
      toggle.textContent = 'Collapse';
    }

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
  ['basic', 'advanced'].forEach((mode) => {
    const jobId = activeJobByMode[mode];
    if (!jobId) {
      return;
    }

    const job = currentRunnerJobs.find((entry) => entry.id === jobId);
    if (!job) {
      return;
    }

    const isBasic = mode === 'basic';
    const statusNode = isBasic ? basicStatus : statusEl;
    if (job.status === 'queued') {
      const queueSuffix = job.queuePosition ? ` (queue ${job.queuePosition})` : '';
      showStatus(statusNode, `Queued${queueSuffix}. Waiting ${buildJobTimerText(job)}.`, 'loading');
      return;
    }

    if (job.status === 'running') {
      const progress = job.progress || {};
      showStatus(
        statusNode,
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
    if (isBasic) {
      displayResponseCards(basicOutput, output.response || [], true);
    } else {
      displayOutput(output);
    }

    if (job.status === 'completed') {
      showStatus(statusNode, `Runner job completed (${(output.response || []).length} task result(s)).`, 'success');
    } else if (job.status === 'timed_out') {
      showStatus(statusNode, `Runner job timed out.`, 'error');
    } else {
      showStatus(statusNode, `Runner job finished with errors.`, 'error');
    }
    renderHistory();
  });
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

  if (conversations.length === 0) {
    historyListEl.innerHTML = '<div class="muted">No conversations stored yet.</div>';
    return;
  }

  historyListEl.innerHTML = '';

  conversations.forEach((entry, index) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-header">
        <div class="history-title">${entry.requestName}</div>
        <div class="history-meta">${entry.mode} · ${entry.model}</div>
        <div class="history-toggle">Expand</div>
      </div>
      <div class="history-content">
        <div class="muted">Stored ${new Date(entry.createdAt).toLocaleString()}</div>
        <div class="muted">Source: ${entry.source && entry.source.url ? entry.source.url : entry.source && entry.source.type ? entry.source.type : 'unknown'}</div>
        <div class="section-title" style="margin-top: 12px;">Request</div>
        <pre>${escapeHtml(JSON.stringify(entry.requestData, null, 2))}</pre>
        <div class="section-title" style="margin-top: 12px;">Output</div>
        <pre>${escapeHtml(JSON.stringify(entry.outputData, null, 2))}</pre>
      </div>
    `;

    const header = item.querySelector('.history-header');
    const content = item.querySelector('.history-content');
    const toggle = item.querySelector('.history-toggle');
    header.addEventListener('click', () => {
      const expanded = content.classList.toggle('expanded');
      toggle.textContent = expanded ? 'Collapse' : 'Expand';
    });

    if (index === 0) {
      content.classList.add('expanded');
      toggle.textContent = 'Collapse';
    }

    historyListEl.appendChild(item);
  });
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
