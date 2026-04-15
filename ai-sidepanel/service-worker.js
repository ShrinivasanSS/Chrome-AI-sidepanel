importScripts('storage-utils.js', 'history-store.js', 'zip-utils.js', 'request-normalizer.js', 'skills-manager.js');

const RUNNER_JOBS_KEY = 'runnerJobsState';
const MAX_RUNNER_JOBS = 80;
let runnerQueueProcessing = false;
const runnerJobRuntimeCache = new Map();
const RUNNER_JOB_STALE_BUFFER_MS = 5000;

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const settings = await StorageUtils.loadSettings();
    await applySidePanelMode(settings.sidePanelMode || 'global');
    await SkillsManager.refreshSkills({ reason: 'installed' });
    await SkillsManager.scheduleRefreshAlarm();
    await ensureRunnerJobsState();
    await StorageUtils.refreshStorageMetrics();
  } catch (error) {
    console.error('[Service Worker] onInstalled initialization failed:', error);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    const settings = await StorageUtils.loadSettings();
    await applySidePanelMode(settings.sidePanelMode || 'global');
    await SkillsManager.refreshSkills({ reason: 'startup' });
    await SkillsManager.scheduleRefreshAlarm();
    await ensureRunnerJobsState();
    await startRunnerQueueProcessing();
  } catch (error) {
    console.error('[Service Worker] onStartup initialization failed:', error);
  }
});

// ─── Side Panel Mode Management ─────────────────────────────────────────────

let currentSidePanelMode = 'global';

async function applySidePanelMode(mode) {
  currentSidePanelMode = mode === 'tab' ? 'tab' : 'global';

  if (currentSidePanelMode === 'global') {
    // Global mode: single panel shared across all tabs
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });
  } else {
    // Tab mode: set panel per-tab on activation
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    // Apply to the currently active tab immediately
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        await chrome.sidePanel.setOptions({
          tabId: tab.id,
          path: 'sidepanel.html',
          enabled: true
        });
      }
    } catch (err) {
      console.warn('[Service Worker] Could not set tab-specific panel on init:', err);
    }
  }
}

// Enable side panel for each tab when it's updated/activated (tab mode)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (currentSidePanelMode !== 'tab') return;
  if (changeInfo.status === 'complete' && tab.url) {
    try {
      await chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel.html',
        enabled: true
      });
    } catch (err) {
      // Ignore errors for restricted tabs (chrome://, etc.)
    }
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (currentSidePanelMode !== 'tab') return;
  try {
    await chrome.sidePanel.setOptions({
      tabId: activeInfo.tabId,
      path: 'sidepanel.html',
      enabled: true
    });
  } catch (err) {
    // Ignore errors for restricted tabs
  }
});

// Clean up per-tab chat messages when a tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const key = `chatMessages_${tabId}`;
    await chrome.storage.local.remove([key]);
  } catch (err) {
    // Ignore cleanup errors
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm && alarm.name === 'skills-refresh') {
    try {
      await SkillsManager.refreshSkills({ reason: 'alarm' });
    } catch (error) {
      console.error('[Service Worker] Alarm refresh failed:', error);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.command === 'capture-tab') {
    handleTabCapture(request, sendResponse);
    return true;
  }

  if (request.command === 'process-request') {
    handleManualRequest(request, sendResponse);
    return true;
  }

  if (request.command === 'get-runner-jobs') {
    handleGetRunnerJobs(sendResponse);
    return true;
  }

  if (request.command === 'get-runner-job') {
    handleGetRunnerJob(request, sendResponse);
    return true;
  }

  if (request.command === 'cancel-runner-job') {
    cancelRunnerJob(request, sendResponse);
    return true;
  }

  if (request.command === 'api-request') {
    handleApiRequest(request, sender, sendResponse);
    return true;
  }

  if (request.command === 'get-api-session') {
    chrome.storage.local.get(['apiCurrentSession']).then((result) => {
      sendResponse({ success: true, session: result.apiCurrentSession || null });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.command === 'clear-api-session') {
    chrome.storage.local.remove(['apiCurrentSession']).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.command === 'refresh-skills') {
    SkillsManager.refreshSkills({ reason: 'manual' }).then(async (state) => {
      await SkillsManager.scheduleRefreshAlarm();
      const settings = await StorageUtils.loadSettings();
      const launcherSync = await syncLauncherSkills(settings);
      sendResponse({ success: true, state: { ...state, launcherSync } });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.command === 'get-skills-state') {
    chrome.storage.local.get(['skillsState']).then((result) => {
      sendResponse({ success: true, state: result.skillsState || null });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.command === 'chat-message') {
    handleChatMessage(request, sendResponse);
    return true;
  }

  if (request.command === 'settings-updated') {
    SkillsManager.scheduleRefreshAlarm().then(() =>
      SkillsManager.refreshSkills({ reason: 'settings-updated' })
    ).then(async (state) => {
      const settings = await StorageUtils.loadSettings();
      await applySidePanelMode(settings.sidePanelMode || 'global');
      const launcherSync = await syncLauncherSkills(settings);
      sendResponse({ success: true, state: { ...state, launcherSync } });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});

async function handleManualRequest(request, sendResponse) {
  try {
    const settings = await StorageUtils.loadSettings();
    const useSkillRunner = settings.runnerConfig && settings.runnerConfig.processingTarget === 'skill-runner';

    if (useSkillRunner) {
      const queued = await enqueueSkillRunnerRequest({
        rawRequest: request.data,
        mode: request.mode || 'advanced',
        source: request.source || { type: 'sidepanel' },
        sourceTabId: null,
        settings
      });

      sendResponse({
        success: true,
        accepted: true,
        jobId: queued.job.id,
        job: queued.job
      });
      startRunnerQueueProcessing();
      return;
    }

    const result = await processRequestLifecycle({
      rawRequest: request.data,
      mode: request.mode || 'advanced',
      source: request.source || { type: 'sidepanel' },
      settings
    });

    sendResponse({
      success: true,
      output: result.output,
      session: result.session
    });
  } catch (error) {
    console.error('[Service Worker] Manual request failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleChatMessage(request, sendResponse) {
  try {
    const settings = await StorageUtils.loadSettings();
    const chatMode = request.chatMode || 'chat';
    const modelId = request.modelId || null;
    const model = StorageUtils.resolveModel(settings, modelId);
    const useSkillRunner = settings.runnerConfig && settings.runnerConfig.processingTarget === 'skill-runner';

    if (chatMode === 'skill') {
      // Skill mode: send concatenated context as a single task through the existing process-request path
      const contextString = request.contextString || '';
      const rawRequest = {
        agent: 'You are a helpful AI assistant.',
        name: 'CHAT_SKILL',
        modelId: model.id,
        params: [{ input: contextString }]
      };

      if (useSkillRunner) {
        const queued = await enqueueSkillRunnerRequest({
          rawRequest,
          mode: 'basic',
          source: request.source || { type: 'sidepanel-chat-skill' },
          sourceTabId: null,
          settings
        });
        sendResponse({
          success: true,
          accepted: true,
          jobId: queued.job.id,
          job: queued.job
        });
        startRunnerQueueProcessing();
      } else {
        const result = await processRequestLifecycle({
          rawRequest,
          mode: 'basic',
          source: request.source || { type: 'sidepanel-chat-skill' },
          settings
        });
        const firstResponse = result.output && result.output.response && result.output.response[0];
        sendResponse({
          success: true,
          reply: firstResponse ? firstResponse.response : '',
          output: result.output
        });
      }
    } else {
      // Chat mode: send full messages array to OpenAI-compatible API
      const messages = request.messages || [];
      if (messages.length === 0) {
        throw new Error('No messages provided');
      }
      const reply = await callAiWithMessages(settings, model, messages);
      sendResponse({
        success: true,
        reply
      });
    }
  } catch (error) {
    console.error('[Service Worker] Chat message failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function callAiWithMessages(settings, model, messages) {
  const requestBody = {
    model: model.value,
    messages
  };

  const response = await fetch(`${settings.apiUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API call failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Invalid API response format');
  }

  return data.choices[0].message.content;
}

async function handleApiRequest(request, sender, sendResponse) {
  try {
    if (!sender.tab || !sender.tab.id) {
      throw new Error('API request must originate from an active browser tab');
    }

    const result = await processRequestLifecycle({
      rawRequest: request.data,
      mode: 'api',
      source: request.source || {
        type: 'external-page',
        url: sender.tab.url,
        title: sender.tab.title
      },
      sourceTabId: sender.tab.id
    });

    sendResponse({
      success: true,
      output: result.output,
      session: result.session
    });
  } catch (error) {
    console.error('[Service Worker] API request failed:', error);
    await sendStatusUpdate(sender.tab && sender.tab.id, {
      type: 'error',
      error: error.message
    });
    sendResponse({ success: false, error: error.message });
  }
}

async function processRequestLifecycle(options) {
  const normalized = await RequestNormalizer.normalizeRequest(options.rawRequest);
  const settings = options.settings || await StorageUtils.loadSettings();
  const model = StorageUtils.resolveModel(settings, normalized.preferredModel);
  const skillContext = await SkillsManager.buildAgentContext(options.rawRequest, normalized);
  const useSkillRunner = settings.runnerConfig && settings.runnerConfig.processingTarget === 'skill-runner';
  const sessionId = StorageUtils.createId(options.mode || 'request');

  const session = {
    id: sessionId,
    mode: options.mode || 'advanced',
    createdAt: new Date().toISOString(),
    source: options.source || { type: 'unknown' },
    name: normalized.name,
    agent: normalized.agent,
    model: model.value,
    status: 'processing',
    progress: {
      completed: 0,
      total: normalized.tasks.length
    },
    warnings: normalized.warnings,
    selectedSkills: skillContext.selectedSkills,
    responses: []
  };

  if (session.mode === 'api') {
    await chrome.storage.local.set({ apiCurrentSession: session });
  }

  await sendStatusUpdate(options.sourceTabId, {
    type: 'started',
    sessionId,
    name: session.name,
    model: session.model,
    total: normalized.tasks.length
  });

  const responses = [];

  for (let index = 0; index < normalized.tasks.length; index += 1) {
    const task = normalized.tasks[index];

    await sendStatusUpdate(options.sourceTabId, {
      type: 'progress',
      sessionId,
      completed: index,
      total: normalized.tasks.length,
      input: task.input
    });

    try {
      const response = useSkillRunner
        ? await callSkillRunner(settings, normalized.agent, task, {
          source: options.source,
          mode: options.mode || 'advanced',
          model: model.value,
          requestName: normalized.name,
          selectedSkills: skillContext.selectedSkills,
          skillsConfig: settings.skillsConfig || null
        })
        : await callAi(settings, model, skillContext.agentPrompt, task);
      responses.push({
        input: task.input,
        response: typeof response === 'string' ? response : response.output,
        success: true
      });
    } catch (error) {
      responses.push({
        input: task.input,
        response: `ERROR: ${error.message}`,
        success: false
      });
    }

    session.responses = responses.slice();
    session.progress = {
      completed: index + 1,
      total: normalized.tasks.length
    };

    if (session.mode === 'api') {
      await chrome.storage.local.set({ apiCurrentSession: session });
    }
  }

  const output = {
    name: normalized.name,
    model: model.value,
    response: responses
  };

  if (normalized.warnings.length > 0) {
    output.warnings = normalized.warnings;
  }
  if (skillContext.warnings.length > 0) {
    output.skillWarnings = skillContext.warnings;
  }
  if (skillContext.selectedSkills.length > 0) {
    output.appliedSkills = skillContext.selectedSkills;
  }

  session.status = 'completed';
  session.output = output;

  if (session.mode === 'api') {
    await chrome.storage.local.set({ apiCurrentSession: session });
  }

  await HistoryStore.saveConversation({
    id: sessionId,
    mode: session.mode,
    createdAt: session.createdAt,
    source: session.source,
    model: session.model,
    requestName: normalized.name,
    requestData: options.rawRequest,
    outputData: output,
    warnings: normalized.warnings,
    selectedSkills: skillContext.selectedSkills
  });

  await StorageUtils.refreshStorageMetrics();

  await sendStatusUpdate(options.sourceTabId, {
    type: 'completed',
    sessionId,
    output
  });

  return {
    output,
    session
  };
}

async function ensureRunnerJobsState() {
  const state = await getRunnerJobsState();
  if (!Array.isArray(state.jobs)) {
    await setRunnerJobsState({ jobs: [] });
    return;
  }
  const recoveredJobs = state.jobs.map((job) => {
    if (job.status !== 'running') {
      return job;
    }
    return {
      ...job,
      status: 'failed',
      error: 'Interrupted: service worker restarted while running',
      finishedAt: new Date().toISOString(),
      activeTaskIndex: null,
      activeTaskStartedAt: null,
      activeTaskTimeoutMs: null
    };
  });
  await setRunnerJobsState({ jobs: recoveredJobs });
}

async function getRunnerJobsState() {
  const result = await chrome.storage.local.get([RUNNER_JOBS_KEY]);
  const state = result[RUNNER_JOBS_KEY] || {};
  return {
    jobs: Array.isArray(state.jobs) ? state.jobs : []
  };
}

async function setRunnerJobsState(state) {
  const normalized = {
    jobs: Array.isArray(state.jobs) ? state.jobs.slice(-MAX_RUNNER_JOBS) : []
  };
  await chrome.storage.local.set({ [RUNNER_JOBS_KEY]: normalized });
  return normalized;
}

async function recoverStaleRunnerJobs(reason) {
  const state = await getRunnerJobsState();
  const now = Date.now();
  let changed = false;

  const updatedJobs = state.jobs.map((job) => {
    if (!job || job.status !== 'running') {
      return job;
    }

    const startedAt = job.activeTaskStartedAt || job.startedAt;
    const startedMs = startedAt ? new Date(startedAt).getTime() : null;
    const timeoutMs = job.activeTaskTimeoutMs || job.timeoutMs || 120000;
    const hasRuntime = runnerJobRuntimeCache.has(job.id);
    const timedOut = startedMs
      ? (now - startedMs) > (timeoutMs + RUNNER_JOB_STALE_BUFFER_MS)
      : false;

    if (hasRuntime && !timedOut) {
      return job;
    }

    changed = true;
    return {
      ...job,
      status: timedOut ? 'timed_out' : 'failed',
      error: timedOut
        ? 'Runner job timed out before completion.'
        : `Runner job lost (${reason || 'runtime cache missing'}).`,
      finishedAt: new Date().toISOString(),
      activeTaskIndex: null,
      activeTaskStartedAt: null,
      activeTaskTimeoutMs: null
    };
  });

  if (changed) {
    await setRunnerJobsState({ jobs: updatedJobs });
  }

  return changed;
}

async function listRunnerJobs() {
  const state = await getRunnerJobsState();
  return state.jobs.slice().sort((a, b) => {
    const left = new Date(b.createdAt || 0).getTime();
    const right = new Date(a.createdAt || 0).getTime();
    return left - right;
  });
}

async function findRunnerJob(jobId) {
  const state = await getRunnerJobsState();
  return state.jobs.find((job) => job.id === jobId) || null;
}

async function updateRunnerJob(jobId, updater) {
  const state = await getRunnerJobsState();
  const index = state.jobs.findIndex((entry) => entry.id === jobId);
  if (index < 0) {
    return null;
  }
  const current = state.jobs[index];
  const updated = updater(current);
  state.jobs[index] = updated;
  await setRunnerJobsState(state);
  return updated;
}

function decorateJobsForView(jobs) {
  const runningOrQueued = jobs
    .filter((job) => job.status === 'running' || job.status === 'queued')
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

  const queueLookup = new Map();
  let queueIndex = 0;
  runningOrQueued.forEach((job) => {
    if (job.status === 'running') {
      queueLookup.set(job.id, 0);
      return;
    }
    queueIndex += 1;
    queueLookup.set(job.id, queueIndex);
  });

  return jobs.map((job) => ({
    ...job,
    queuePosition: queueLookup.has(job.id) ? queueLookup.get(job.id) : null
  }));
}

async function enqueueSkillRunnerRequest(options) {
  const normalized = await RequestNormalizer.normalizeRequest(options.rawRequest);
  const settings = options.settings || await StorageUtils.loadSettings();
  const model = StorageUtils.resolveModel(settings, normalized.preferredModel);
  const skillContext = await SkillsManager.buildAgentContext(options.rawRequest, normalized);
  const sessionId = StorageUtils.createId(options.mode || 'runner-job');
  const createdAt = new Date().toISOString();
  const runnerConfig = settings.runnerConfig || {};
  const source = options.source || { type: 'sidepanel' };
  runnerJobRuntimeCache.set(sessionId, {
    normalized,
    requestData: options.rawRequest,
    source,
    sourceTabId: options.sourceTabId || null,
    skillWarnings: skillContext.warnings || [],
    selectedSkills: skillContext.selectedSkills || [],
    warnings: normalized.warnings || [],
    agent: normalized.agent,
    requestName: normalized.name,
    mode: options.mode || 'advanced',
    model: model.value,
    createdAt
  });

  const job = {
    id: sessionId,
    sessionId,
    createdAt,
    queuedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    status: 'queued',
    mode: options.mode || 'advanced',
    source: summarizeSourceForQueue(source),
    requestName: normalized.name,
    model: model.value,
    warnings: normalized.warnings,
    skillWarnings: skillContext.warnings,
    selectedSkills: skillContext.selectedSkills,
    progress: {
      completed: 0,
      total: normalized.tasks.length,
      input: ''
    },
    runner: {
      type: runnerConfig.runnerType || 'claude',
      mode: runnerConfig.runnerMode || 'remote',
      timeoutMs: runnerConfig.timeoutMs || 120000
    },
    timeoutMs: runnerConfig.timeoutMs || 120000,
    responses: [],
    output: null,
    error: null,
    launcherTasks: [],
    activeTaskIndex: null,
    activeTaskStartedAt: null,
    activeTaskTimeoutMs: null
  };

  const state = await getRunnerJobsState();
  state.jobs.push(job);
  await setRunnerJobsState(state);

  return { job };
}

async function handleGetRunnerJobs(sendResponse) {
  try {
    await recoverStaleRunnerJobs('status-poll');
    const jobs = await listRunnerJobs();
    sendResponse({ success: true, jobs: decorateJobsForView(jobs) });
    if (jobs.some((job) => job.status === 'queued') && !jobs.some((job) => job.status === 'running')) {
      startRunnerQueueProcessing();
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetRunnerJob(request, sendResponse) {
  try {
    await recoverStaleRunnerJobs('status-poll');
    const job = await findRunnerJob(request.jobId);
    if (!job) {
      sendResponse({ success: false, error: 'Runner job not found' });
      return;
    }
    const [decorated] = decorateJobsForView([job]);
    sendResponse({ success: true, job: decorated });
    if (job.status === 'queued') {
      startRunnerQueueProcessing();
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function cancelRunnerJob(request, sendResponse) {
  try {
    const updated = await updateRunnerJob(request.jobId, (job) => {
      if (job.status !== 'queued') {
        return job;
      }
      return {
        ...job,
        status: 'failed',
        error: 'Cancelled by user',
        finishedAt: new Date().toISOString()
      };
    });

    if (!updated) {
      sendResponse({ success: false, error: 'Runner job not found' });
      return;
    }
    runnerJobRuntimeCache.delete(request.jobId);
    sendResponse({ success: true, job: updated });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function startRunnerQueueProcessing() {
  if (runnerQueueProcessing) {
    return;
  }
  runnerQueueProcessing = true;
  try {
    while (true) {
      await recoverStaleRunnerJobs('queue-start');
      const state = await getRunnerJobsState();
      if (state.jobs.some((job) => job.status === 'running')) {
        break;
      }

      const next = state.jobs
        .filter((job) => job.status === 'queued')
        .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())[0];

      if (!next) {
        break;
      }

      await executeRunnerJob(next.id);
    }
  } finally {
    runnerQueueProcessing = false;
    const state = await getRunnerJobsState();
    if (state.jobs.some((job) => job.status === 'queued')) {
      startRunnerQueueProcessing();
    }
  }
}

async function executeRunnerJob(jobId) {
  const starting = await updateRunnerJob(jobId, (job) => {
    if (job.status !== 'queued') {
      return job;
    }
    return {
      ...job,
      status: 'running',
      startedAt: new Date().toISOString(),
      error: null
    };
  });

  if (!starting || starting.status !== 'running') {
    return;
  }
  const runtime = runnerJobRuntimeCache.get(jobId);
  if (!runtime || !runtime.normalized || !Array.isArray(runtime.normalized.tasks)) {
    await updateRunnerJob(jobId, (job) => ({
      ...job,
      status: 'failed',
      error: 'Queued payload not available (service worker restarted)',
      finishedAt: new Date().toISOString(),
      activeTaskIndex: null,
      activeTaskStartedAt: null,
      activeTaskTimeoutMs: null
    }));
    return;
  }

  const settings = await StorageUtils.loadSettings();
  const responses = [];
  const launcherTasks = [];
  let timedOut = false;

  for (let index = 0; index < runtime.normalized.tasks.length; index += 1) {
    const task = runtime.normalized.tasks[index];

    await updateRunnerJob(jobId, (job) => ({
      ...job,
      progress: {
        completed: index,
        total: runtime.normalized.tasks.length,
        input: task.input || ''
      },
      activeTaskIndex: index,
      activeTaskStartedAt: new Date().toISOString(),
      activeTaskTimeoutMs: job.timeoutMs || 120000
    }));

    try {
      const response = await callSkillRunner(settings, runtime.agent, task, {
        source: runtime.source,
        mode: runtime.mode,
        model: starting.model,
        requestName: starting.requestName,
        selectedSkills: starting.selectedSkills,
        skillsConfig: settings.skillsConfig || null
      });

      responses.push({
        input: task.input,
        response: response.output,
        success: true,
        launcherTaskId: response.launcherTaskId || null,
        outputFile: response.outputFile || null,
        resultFile: response.resultFile || null,
        durationMs: response.durationMs || null
      });
      if (response.launcherTaskId) {
        launcherTasks.push(response.launcherTaskId);
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      responses.push({
        input: task.input,
        response: `ERROR: ${message}`,
        success: false
      });
      if (/timed out/i.test(message)) {
        timedOut = true;
        break;
      }
    }

    await updateRunnerJob(jobId, (job) => ({
      ...job,
      responses: responses.slice(),
      launcherTasks: launcherTasks.slice(),
      progress: {
        completed: index + 1,
        total: runtime.normalized.tasks.length,
        input: task.input || ''
      }
    }));
  }

  const output = {
    name: starting.requestName,
    model: starting.model,
    response: responses
  };
  if (Array.isArray(starting.warnings) && starting.warnings.length > 0) {
    output.warnings = starting.warnings;
  }
  if (Array.isArray(starting.skillWarnings) && starting.skillWarnings.length > 0) {
    output.skillWarnings = starting.skillWarnings;
  }
  if (Array.isArray(starting.selectedSkills) && starting.selectedSkills.length > 0) {
    output.appliedSkills = starting.selectedSkills;
  }

  const finalStatus = timedOut
    ? 'timed_out'
    : responses.some((entry) => !entry.success)
      ? 'failed'
      : 'completed';

  await updateRunnerJob(jobId, (job) => ({
    ...job,
    status: finalStatus,
    finishedAt: new Date().toISOString(),
    responses: responses.slice(),
    output,
    error: finalStatus === 'completed' ? null : (timedOut ? 'Runner timed out' : 'One or more tasks failed'),
    progress: {
      completed: responses.length,
      total: runtime.normalized.tasks.length,
      input: ''
    },
    activeTaskIndex: null,
    activeTaskStartedAt: null,
    activeTaskTimeoutMs: null,
    launcherTasks: launcherTasks.slice()
  }));

  await HistoryStore.saveConversation({
    id: starting.sessionId,
    mode: runtime.mode,
    createdAt: runtime.createdAt,
    source: runtime.source,
    model: starting.model,
    requestName: starting.requestName,
    requestData: runtime.requestData,
    outputData: output,
    warnings: runtime.warnings,
    selectedSkills: runtime.selectedSkills
  });

  await StorageUtils.refreshStorageMetrics();
  runnerJobRuntimeCache.delete(jobId);
}

function summarizeSourceForQueue(source) {
  const safe = source && typeof source === 'object' ? source : {};
  return {
    type: safe.type || 'unknown',
    url: safe.url || '',
    title: safe.title || ''
  };
}

function buildRunnerInput(agentPrompt, task, context) {
  const safeContext = context && typeof context === 'object' ? context : {};
  const source = safeContext.source && typeof safeContext.source === 'object' ? safeContext.source : {};
  const selectedSkills = Array.isArray(safeContext.selectedSkills) ? safeContext.selectedSkills : [];
  const cookieHeadersByDomain = source.cookieHeadersByDomain && typeof source.cookieHeadersByDomain === 'object'
    ? source.cookieHeadersByDomain
    : {};
  const cookiesByDomain = source.cookiesByDomain && typeof source.cookiesByDomain === 'object'
    ? source.cookiesByDomain
    : {};
  const taskImages = Array.isArray(task && task.images) ? task.images : [];

  // Derive activeDomain from source URL
  let activeDomain = '';
  try {
    if (source.url) {
      activeDomain = normalizeCookieDomain(new URL(source.url).hostname);
    }
  } catch (e) { /* ignore */ }

  // Active-tab cookie header (for the current tab's domain)
  const cookieHeader = source.cookieHeader || '';
  const cookies = Array.isArray(source.cookies) ? source.cookies : [];

  // Resolve runnerCookieEnvMap from context (passed from settings)
  const runnerCookieEnvMap = safeContext.runnerCookieEnvMap && typeof safeContext.runnerCookieEnvMap === 'object'
    ? safeContext.runnerCookieEnvMap
    : {};

  // Additional instructions from the extension UI (forwarded as-is to launcher)
  const additionalInstructions = typeof source.additionalInstructions === 'string'
    ? source.additionalInstructions.trim()
    : '';

  return {
    request: {
      mode: safeContext.mode || 'unknown',
      requestName: safeContext.requestName || 'unknown',
      model: safeContext.model || 'unknown'
    },
    agentInstructions: agentPrompt || '',
    additionalInstructions,
    userMessage: task && typeof task.input === 'string' ? task.input : '',
    taskInput: task && typeof task.input === 'string' ? task.input : '',
    normalizedTaskText: task && typeof task.input === 'string' ? task.input : '',
    taskImages,
    skills: selectedSkills,
    source: {
      type: source.type || 'unknown',
      url: source.url || '',
      title: source.title || ''
    },
    pageContent: {
      text: source.pageText || '',
      headings: Array.isArray(source.headings) ? source.headings : [],
      meta: source.meta || {},
      links: Array.isArray(source.links) ? source.links : []
    },
    activeTabInfo: {
      url: source.url || '',
      title: source.title || '',
      meta: source.meta || {},
      headings: Array.isArray(source.headings) ? source.headings : [],
      links: Array.isArray(source.links) ? source.links : []
    },
    sessionInfo: {
      activeDomain,
      url: source.url || '',
      title: source.title || '',
      cookies,
      cookieHeader,
      cookiesByDomain,
      cookieHeadersByDomain,
      cookieEnvMap: runnerCookieEnvMap,
      sessionStorageSnapshot: source.sessionStorageSnapshot || {},
      localStorageSnapshot: source.localStorageSnapshot || {},
      sessionInfoAllowed: !!source.sessionInfoAllowed
    }
  };
}

async function callSkillRunner(settings, agentPrompt, task, context) {
  const runnerConfig = settings.runnerConfig || {};
  // Inject runnerCookieEnvMap from settings into context so buildRunnerInput can forward it
  const enrichedContext = {
    ...(context || {}),
    runnerCookieEnvMap: settings.runnerCookieEnvMap || {}
  };
  const runnerInput = buildRunnerInput(agentPrompt, task, enrichedContext);

  if (runnerConfig.runnerMode === 'local') {
    return invokeLocalRunner(runnerConfig, runnerInput, enrichedContext);
  }

  return invokeRemoteRunner(runnerConfig, runnerInput, enrichedContext);
}

function getRunnerPromptArg(runnerType) {
  const runner = String(runnerType || '').toLowerCase();
  if (runner === 'claude') {
    return '--print';
  }
  if (runner === 'cursor') {
    return '-p';
  }
  return '--prompt';
}

function sendNativeMessage(hostName, message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(hostName, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function invokeLocalRunner(runnerConfig, runnerInput, context) {
  const hostName = runnerConfig.nativeHostName || 'com.local.skillrunner.host';
  const promptArg = getRunnerPromptArg(runnerConfig.runnerType);
  const timeoutMs = runnerConfig.timeoutMs || 120000;
  const response = await sendNativeMessage(hostName, {
    action: 'run-skill-runner',
    runner: runnerConfig.runnerType || 'claude',
    promptArg,
    runnerInput,
    timeoutMs,
    skillsConfig: context && context.skillsConfig ? context.skillsConfig : null,
    context
  });

  if (!response) {
    throw new Error('Local runner host returned no response');
  }

  if (response.success === false) {
    throw new Error(response.error || 'Local runner execution failed');
  }

  if (response.accepted && response.task && response.task.id) {
    return waitForLocalRunnerTask(hostName, response.task.id, timeoutMs + 15000);
  }

  if (typeof response.output === 'string' && response.output.trim()) {
    return {
      output: response.output,
      launcherTaskId: response.taskId || null,
      outputFile: response.outputFile || null,
      resultFile: response.resultFile || null,
      durationMs: response.durationMs || null
    };
  }

  return {
    output: JSON.stringify(response),
    launcherTaskId: response.taskId || null
  };
}

async function waitForLocalRunnerTask(hostName, taskId, deadlineMs) {
  const start = Date.now();
  while (Date.now() - start <= deadlineMs) {
    const response = await sendNativeMessage(hostName, {
      action: 'get-task-status',
      taskId,
      includeOutput: true
    });

    if (!response || response.success === false) {
      throw new Error((response && response.error) || 'Failed to fetch local runner task status');
    }

    const task = response.task || {};
    if (task.status === 'completed') {
      const result = task.result || {};
      return {
        output: typeof result.output === 'string' ? result.output : JSON.stringify(result),
        launcherTaskId: task.id,
        outputFile: result.outputFile || null,
        resultFile: task.resultFile || null,
        durationMs: result.durationMs || null
      };
    }

    if (task.status === 'failed' || task.status === 'timed_out') {
      throw new Error(task.error || (task.result && task.result.error) || `Runner task ${task.status}`);
    }

    await sleep(2000);
  }

  throw new Error(`Local runner task timed out after ${deadlineMs} ms`);
}

async function invokeRemoteRunner(runnerConfig, runnerInput, context) {
  const remoteUrl = runnerConfig.remoteUrl;
  if (!remoteUrl) {
    throw new Error('Remote runner URL is not configured');
  }

  const promptArg = getRunnerPromptArg(runnerConfig.runnerType);
  const timeoutMs = runnerConfig.timeoutMs || 120000;
  const response = await fetch(remoteUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      runner: runnerConfig.runnerType || 'claude',
      promptArg,
      runnerInput,
      timeoutMs,
      skillsConfig: context && context.skillsConfig ? context.skillsConfig : null,
      context
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Remote runner failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (data && data.success === false) {
    throw new Error(data.error || 'Remote runner execution failed');
  }

  if (data && data.accepted && data.task && data.task.id) {
    return waitForRemoteRunnerTask(remoteUrl, data.task.id, timeoutMs + 15000);
  }

  if (data && typeof data.output === 'string') {
    return {
      output: data.output,
      launcherTaskId: data.taskId || null,
      outputFile: data.outputFile || null,
      resultFile: data.resultFile || null,
      durationMs: data.durationMs || null
    };
  }

  return {
    output: JSON.stringify(data),
    launcherTaskId: data && data.taskId ? data.taskId : null
  };
}

function buildTaskStatusUrl(remoteRunnerUrl, taskId) {
  const root = remoteRunnerUrl.replace(/\/?run\/?$/i, '').replace(/\/$/, '');
  return `${root}/tasks/${encodeURIComponent(taskId)}?includeOutput=1`;
}

async function waitForRemoteRunnerTask(remoteUrl, taskId, deadlineMs) {
  const start = Date.now();
  while (Date.now() - start <= deadlineMs) {
    const statusUrl = buildTaskStatusUrl(remoteUrl, taskId);
    const response = await fetch(statusUrl, { method: 'GET' });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Runner status failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const task = data.task || {};

    if (task.status === 'completed') {
      const result = task.result || {};
      return {
        output: typeof result.output === 'string' ? result.output : JSON.stringify(result),
        launcherTaskId: task.id,
        outputFile: result.outputFile || null,
        resultFile: task.resultFile || null,
        durationMs: result.durationMs || null
      };
    }

    if (task.status === 'failed' || task.status === 'timed_out') {
      throw new Error(task.error || (task.result && task.result.error) || `Runner task ${task.status}`);
    }

    await sleep(2000);
  }

  throw new Error(`Remote runner task timed out after ${deadlineMs} ms`);
}

function buildUpdateSkillsUrl(remoteRunnerUrl) {
  if (!remoteRunnerUrl) {
    return '';
  }
  if (/\/run\/?$/i.test(remoteRunnerUrl)) {
    return remoteRunnerUrl.replace(/\/run\/?$/i, '/update-skills');
  }
  if (/\/update-skills\/?$/i.test(remoteRunnerUrl)) {
    return remoteRunnerUrl;
  }
  return `${remoteRunnerUrl.replace(/\/$/, '')}/update-skills`;
}

async function syncLauncherSkills(settings) {
  const runnerConfig = settings && settings.runnerConfig ? settings.runnerConfig : {};
  const skillsConfig = settings && settings.skillsConfig ? settings.skillsConfig : {};
  if (skillsConfig.repositoryEnabled === false) {
    return { status: 'skipped', reason: 'repository disabled' };
  }

  const payload = {
    action: 'update-skills',
    runner: runnerConfig.runnerType || 'claude',
    skillsConfig
  };

  try {
    if (runnerConfig.runnerMode === 'local') {
      const hostName = runnerConfig.nativeHostName || 'com.local.skillrunner.host';
      const response = await sendNativeMessage(hostName, payload);
      return { status: 'ok', mode: 'local', response };
    }

    const updateUrl = buildUpdateSkillsUrl(runnerConfig.remoteUrl);
    if (!updateUrl) {
      return { status: 'skipped', reason: 'remote URL missing' };
    }

    const response = await fetch(updateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { status: 'error', mode: 'remote', error: `HTTP ${response.status}: ${errorText}` };
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      return { status: 'ok', mode: 'remote', response: await response.json() };
    }

    return { status: 'ok', mode: 'remote', response: await response.text() };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

async function callAi(settings, model, agentPrompt, task) {
  const requestBody = {
    model: model.value,
    messages: [
      { role: 'system', content: agentPrompt },
      RequestNormalizer.buildUserMessage(task)
    ]
  };

  const response = await fetch(`${settings.apiUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API call failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Invalid API response format');
  }

  return data.choices[0].message.content;
}

async function sendStatusUpdate(tabId, payload) {
  if (!tabId) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      command: 'api-status-update',
      data: payload
    });
  } catch (error) {
    console.warn('[Service Worker] Failed to forward status update:', error);
  }
}

function normalizeCookieDomain(domain) {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^\*\./, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

async function collectTrustedDomainCookies(trustedDomains) {
  const domains = Array.isArray(trustedDomains)
    ? trustedDomains.map((entry) => normalizeCookieDomain(entry)).filter(Boolean)
    : [];
  const cookiesByDomain = {};
  const cookieHeadersByDomain = {};

  for (const domain of domains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      cookiesByDomain[domain] = cookies;
      cookieHeadersByDomain[domain] = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    } catch (error) {
      console.warn('[Service Worker] Unable to read trusted-domain cookies:', domain, error);
      cookiesByDomain[domain] = [];
      cookieHeadersByDomain[domain] = '';
    }
  }

  return {
    cookiesByDomain,
    cookieHeadersByDomain
  };
}

async function handleTabCapture(request, sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }

    const screenshot = await chrome.tabs.captureVisibleTab();
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-extractor.js']
    });

    const pageData = result.result;
    let cookies = [];
    let cookieHeader = '';
    try {
      if (tab.url) {
        cookies = await chrome.cookies.getAll({ url: tab.url });
        cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
      }
    } catch (cookieError) {
      console.warn('[Service Worker] Unable to read cookies for tab:', cookieError);
    }

    const trustedCookies = await collectTrustedDomainCookies(request && request.trustedDomains);

    sendResponse({
      success: true,
      data: {
        title: tab.title,
        url: tab.url,
        screenshot,
        pageText: pageData.text,
        meta: pageData.meta,
        headings: pageData.headings,
        links: pageData.links,
        localStorageSnapshot: pageData.localStorageSnapshot || {},
        sessionStorageSnapshot: pageData.sessionStorageSnapshot || {},
        cookies,
        cookieHeader,
        cookiesByDomain: trustedCookies.cookiesByDomain,
        cookieHeadersByDomain: trustedCookies.cookieHeadersByDomain
      }
    });
  } catch (error) {
    console.error('[Service Worker] Tab capture error:', error);
    sendResponse({ success: false, error: error.message });
  }
}
