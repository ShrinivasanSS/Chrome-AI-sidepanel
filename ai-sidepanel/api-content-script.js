(function() {
  'use strict';

  function isValidRequestShape(requestData) {
    if (!requestData || typeof requestData !== 'object') {
      return 'Request payload must be an object';
    }

    if (!requestData.agent || typeof requestData.agent !== 'string') {
      return 'Request must include an "agent" string';
    }

    if (!requestData.name || typeof requestData.name !== 'string') {
      return 'Request must include a "name" string';
    }

    const hasParams = Array.isArray(requestData.params) && requestData.params.length > 0;
    const hasTasks = Array.isArray(requestData.tasks) && requestData.tasks.length > 0;

    if (!hasParams && !hasTasks) {
      return 'Request must include a non-empty "params" or "tasks" array';
    }

    return null;
  }

  function dispatchToPage(eventName, detail) {
    document.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  function initializeContentScript() {
    document.addEventListener('ai-sidepanel-api-call', (event) => {
      try {
        const requestData = event.detail;
        const validationError = isValidRequestShape(requestData);
        if (validationError) {
          throw new Error(validationError);
        }

        chrome.runtime.sendMessage({
          command: 'api-request',
          data: requestData,
          source: {
            url: window.location.href,
            title: document.title,
            timestamp: new Date().toISOString()
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            dispatchToPage('ai-sidepanel-response', {
              success: false,
              error: chrome.runtime.lastError.message
            });
            return;
          }

          dispatchToPage('ai-sidepanel-response', response);
        });
      } catch (error) {
        dispatchToPage('ai-sidepanel-response', {
          success: false,
          error: error.message
        });
      }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.command === 'api-status-update') {
        dispatchToPage('ai-sidepanel-status', request.data);
        sendResponse({ received: true });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeContentScript);
  } else {
    initializeContentScript();
  }
})();
