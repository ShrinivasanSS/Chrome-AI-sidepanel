importScripts('storage-utils.js', 'history-store.js', 'zip-utils.js', 'request-normalizer.js');

chrome.runtime.onInstalled.addListener(async () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await StorageUtils.loadSettings();
  await StorageUtils.refreshStorageMetrics();
});

chrome.runtime.onStartup.addListener(async () => {
  await StorageUtils.loadSettings();
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
      const response = await callAi(settings, model, normalized.agent, task);
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
    warnings: normalized.warnings
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

async function callAi(settings, model, agent, task) {
  const requestBody = {
    model: model.value,
    messages: [
      { role: 'system', content: agent },
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

    sendResponse({
      success: true,
      data: {
        title: tab.title,
        url: tab.url,
        screenshot,
        pageText: pageData.text,
        meta: pageData.meta,
        headings: pageData.headings,
        links: pageData.links
      }
    });
  } catch (error) {
    console.error('[Service Worker] Tab capture error:', error);
    sendResponse({ success: false, error: error.message });
  }
}
