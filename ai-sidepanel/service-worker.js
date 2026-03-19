importScripts('storage-utils.js', 'history-store.js', 'zip-utils.js', 'request-normalizer.js', 'skills-manager.js');

chrome.runtime.onInstalled.addListener(async () => {
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await StorageUtils.loadSettings();
    await SkillsManager.refreshSkills({ reason: 'installed' });
    await SkillsManager.scheduleRefreshAlarm();
    await StorageUtils.refreshStorageMetrics();
  } catch (error) {
    console.error('[Service Worker] onInstalled initialization failed:', error);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await StorageUtils.loadSettings();
    await SkillsManager.refreshSkills({ reason: 'startup' });
    await SkillsManager.scheduleRefreshAlarm();
  } catch (error) {
    console.error('[Service Worker] onStartup initialization failed:', error);
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
    handleTabCapture(sendResponse);
    return true;
  }

  if (request.command === 'process-request') {
    handleManualRequest(request, sendResponse);
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
      sendResponse({ success: true, state });
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

  if (request.command === 'settings-updated') {
    SkillsManager.scheduleRefreshAlarm().then(() =>
      SkillsManager.refreshSkills({ reason: 'settings-updated' })
    ).then((state) => {
      sendResponse({ success: true, state });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});

async function handleManualRequest(request, sendResponse) {
  try {
    const result = await processRequestLifecycle({
      rawRequest: request.data,
      mode: request.mode || 'advanced',
      source: request.source || { type: 'sidepanel' }
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
  const settings = await StorageUtils.loadSettings();
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
        response,
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

function buildRunnerPrompt(agentPrompt, task, context) {
  const source = context && context.source ? context.source : {};
  const cookieHeader = source.cookieHeader || '';
  const cookies = Array.isArray(source.cookies) ? source.cookies : [];
  const sourceBlock = [
    `Mode: ${context.mode || 'unknown'}`,
    `Request: ${context.requestName || 'unknown'}`,
    `Source URL: ${source.url || 'unknown'}`,
    `Source Title: ${source.title || 'unknown'}`
  ].join('\n');

  return [
    agentPrompt,
    '',
    'Context:',
    sourceBlock,
    '',
    cookieHeader ? `Cookies (header): ${cookieHeader}` : 'Cookies (header): -',
    cookies.length > 0 ? `Cookies (JSON): ${JSON.stringify(cookies)}` : 'Cookies (JSON): []',
    '',
    'User Task:',
    task.userText
  ].join('\n');
}

async function callSkillRunner(settings, agentPrompt, task, context) {
  const runnerConfig = settings.runnerConfig || {};
  const prompt = buildRunnerPrompt(agentPrompt, task, context || {});

  if (runnerConfig.runnerMode === 'local') {
    return invokeLocalRunner(runnerConfig, prompt, context || {});
  }

  return invokeRemoteRunner(runnerConfig, prompt, context || {});
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

async function invokeLocalRunner(runnerConfig, prompt, context) {
  const hostName = runnerConfig.nativeHostName || 'com.local.skillrunner.host';
  const promptArg = getRunnerPromptArg(runnerConfig.runnerType);
  const response = await sendNativeMessage(hostName, {
    action: 'run-skill-runner',
    runner: runnerConfig.runnerType || 'claude',
    promptArg,
    prompt,
    timeoutMs: runnerConfig.timeoutMs || 120000,
    skillsConfig: context && context.skillsConfig ? context.skillsConfig : null,
    context
  });

  if (!response) {
    throw new Error('Local runner host returned no response');
  }

  if (response.success === false) {
    throw new Error(response.error || 'Local runner execution failed');
  }

  if (typeof response.output === 'string' && response.output.trim()) {
    return response.output;
  }

  return JSON.stringify(response);
}

async function invokeRemoteRunner(runnerConfig, prompt, context) {
  const remoteUrl = runnerConfig.remoteUrl;
  if (!remoteUrl) {
    throw new Error('Remote runner URL is not configured');
  }

  const promptArg = getRunnerPromptArg(runnerConfig.runnerType);
  const response = await fetch(remoteUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      runner: runnerConfig.runnerType || 'claude',
      promptArg,
      prompt,
      timeoutMs: runnerConfig.timeoutMs || 120000,
      skillsConfig: context && context.skillsConfig ? context.skillsConfig : null,
      context
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Remote runner failed (${response.status}): ${errorText}`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (data && data.success === false) {
      throw new Error(data.error || 'Remote runner execution failed');
    }
    if (data && typeof data.output === 'string') {
      return data.output;
    }
    return JSON.stringify(data);
  }

  return response.text();
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

async function handleTabCapture(sendResponse) {
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
        cookies,
        cookieHeader
      }
    });
  } catch (error) {
    console.error('[Service Worker] Tab capture error:', error);
    sendResponse({ success: false, error: error.message });
  }
}
