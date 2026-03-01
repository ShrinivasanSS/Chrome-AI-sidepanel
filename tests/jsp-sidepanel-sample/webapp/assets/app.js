window.JspSidepanelDemo = (function() {
  'use strict';

  function createView(pageId) {
    const statusEl = document.getElementById(`${pageId}-status`);
    const logEl = document.getElementById(`${pageId}-log`);
    const resultsEl = document.getElementById(`${pageId}-results`);

    function setStatus(message, type) {
      statusEl.textContent = message;
      statusEl.className = `status ${type || ''}`.trim();
    }

    function appendLog(detail) {
      logEl.textContent = `${new Date().toLocaleTimeString()} ${JSON.stringify(detail, null, 2)}\n\n${logEl.textContent}`;
    }

    function renderOutput(output) {
      if (!output || !Array.isArray(output.response)) {
        resultsEl.innerHTML = '<div class="muted">No structured result was returned.</div>';
        return;
      }

      resultsEl.innerHTML = output.response.map((entry) => `
        <div class="result-card">
          <strong>${escapeHtml(entry.input)}</strong>
          <pre>${escapeHtml(entry.response)}</pre>
        </div>
      `).join('');
    }

    document.addEventListener('ai-sidepanel-response', (event) => {
      const detail = event.detail || {};
      appendLog(detail);

      if (detail.success === false) {
        setStatus(`Request failed: ${detail.error}`, 'error');
        return;
      }

      if (detail.output) {
        renderOutput(detail.output);
        setStatus('Completed request. Results rendered below.', 'success');
        return;
      }

      setStatus('Request accepted by the extension.', 'success');
    });

    document.addEventListener('ai-sidepanel-status', (event) => {
      const detail = event.detail || {};
      appendLog(detail);

      if (detail.type === 'started') {
        setStatus(`Started "${detail.name}" with model ${detail.model}.`);
      } else if (detail.type === 'progress') {
        setStatus(`Processing ${detail.completed + 1}/${detail.total}: ${detail.input}`);
      } else if (detail.type === 'completed') {
        setStatus('Completed request. Results rendered below.', 'success');
        renderOutput(detail.output);
      } else if (detail.type === 'error') {
        setStatus(`Request failed: ${detail.error}`, 'error');
      }
    });

    return {
      setStatus,
      renderOutput
    };
  }

  function triggerRequest(request) {
    document.dispatchEvent(new CustomEvent('ai-sidepanel-api-call', {
      detail: request
    }));
  }

  async function fetchJson(path) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}`);
    }
    return response.json();
  }

  async function toDataUrl(path, explicitMimeType) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}`);
    }

    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return `data:${explicitMimeType || blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
  }

  async function sendPhotosRequest() {
    const [languagesImage, trendsImage] = await Promise.all([
      toDataUrl('./example-inputs/screenshots/languages.png', 'image/png'),
      toDataUrl('./example-inputs/screenshots/trends.png', 'image/png')
    ]);

    triggerRequest({
      agent: 'You are an image analyst. Compare the supplied screenshots and extract useful observations.',
      name: 'JSP_PHOTO_ANALYZER',
      params: [{
        input: 'Analyze the provided screenshots',
        data: 'Describe what appears in the screenshots and summarize any notable trends.',
        supplements: [
          { type: 'image_base64', mediaType: 'image/png', data: languagesImage, fileName: 'languages.png' },
          { type: 'image_base64', mediaType: 'image/png', data: trendsImage, fileName: 'trends.png' }
        ]
      }]
    });
  }

  async function sendZipRequest() {
    const zipData = await toDataUrl('./example-inputs/zip/sample-json-screenshots.zip', 'application/zip');
    triggerRequest({
      agent: 'You are a multimodal reviewer. Read the JSON and screenshots inside the ZIP file, then summarize the package.',
      name: 'JSP_ZIP_ANALYZER',
      params: [{
        input: 'Analyze the ZIP package',
        data: {
          type: 'zip',
          fileName: 'sample-json-screenshots.zip',
          data: zipData
        },
        supplements: [
          'Ignore unsupported files and report what was extracted.'
        ]
      }]
    });
  }

  async function sendJsonRequest() {
    const request = await fetchJson('./example-inputs/json/example-math-input.json');
    request.name = 'JSP_JSON_ANALYZER';
    request.agent = 'You are a structured data reviewer. Summarize the supplied JSON tasks and provide concise results.';
    triggerRequest(request);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    createView,
    sendPhotosRequest,
    sendZipRequest,
    sendJsonRequest
  };
})();
