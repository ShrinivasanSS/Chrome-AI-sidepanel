const apiUrlEl = document.getElementById('apiUrl');
const apiKeyEl = document.getElementById('apiKey');
const modelsContainerEl = document.getElementById('modelsContainer');
const defaultModelIdEl = document.getElementById('defaultModelId');
const addModelBtn = document.getElementById('addModelBtn');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const statusEl = document.getElementById('status');
const exampleCallEl = document.getElementById('exampleCall');
const settingsForm = document.getElementById('settingsForm');
const refreshStorageBtn = document.getElementById('refreshStorageBtn');
const clearStorageBtn = document.getElementById('clearStorageBtn');

const storageTotalEl = document.getElementById('storageTotal');
const storageHistoryEl = document.getElementById('storageHistory');
const storageLocalEl = document.getElementById('storageLocal');
const storageCountEl = document.getElementById('storageCount');
const storageUpdatedAtEl = document.getElementById('storageUpdatedAt');

let currentSettings = null;

document.addEventListener('DOMContentLoaded', initializeSettingsPage);

async function initializeSettingsPage() {
  settingsForm.addEventListener('submit', handleSave);
  testBtn.addEventListener('click', handleTest);
  addModelBtn.addEventListener('click', () => {
    renderModelRow({ label: '', value: '' });
    syncDefaultModelOptions();
  });
  refreshStorageBtn.addEventListener('click', refreshStorageMetrics);
  clearStorageBtn.addEventListener('click', handleClearStorage);
  apiUrlEl.addEventListener('input', updateExample);
  apiKeyEl.addEventListener('input', updateExample);

  currentSettings = await StorageUtils.loadSettings();
  renderSettings(currentSettings);
  await refreshStorageMetrics();
}

function renderSettings(settings) {
  apiUrlEl.value = settings.apiUrl;
  apiKeyEl.value = settings.apiKey;
  modelsContainerEl.innerHTML = '';
  settings.models.forEach((model) => renderModelRow(model));
  syncDefaultModelOptions(settings.defaultModelId);
  updateExample();
}

function renderModelRow(model) {
  const row = document.createElement('div');
  row.className = 'model-row';
  row.innerHTML = `
    <div>
      <label>Label</label>
      <input type="text" class="model-label" placeholder="Friendly name" value="${escapeAttribute(model.label || '')}">
    </div>
    <div>
      <label>Model value</label>
      <input type="text" class="model-value" placeholder="gpt-4o-mini" value="${escapeAttribute(model.value || model.label || '')}">
    </div>
    <div>
      <button type="button" class="remove-model-btn danger">Remove</button>
    </div>
  `;

  row.querySelector('.model-label').addEventListener('input', syncDefaultModelOptions);
  row.querySelector('.model-value').addEventListener('input', syncDefaultModelOptions);
  row.querySelector('.remove-model-btn').addEventListener('click', () => {
    row.remove();
    syncDefaultModelOptions();
  });

  modelsContainerEl.appendChild(row);
}

function collectModels() {
  const rows = Array.from(modelsContainerEl.querySelectorAll('.model-row'));
  return rows.map((row, index) => {
    const label = row.querySelector('.model-label').value.trim();
    const value = row.querySelector('.model-value').value.trim();
    return {
      id: `${(label || value || `model-${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label: label || value,
      value: value || label
    };
  }).filter((model) => model.label && model.value);
}

function syncDefaultModelOptions(selectedValue) {
  const selected = selectedValue || defaultModelIdEl.value;
  const models = collectModels();
  defaultModelIdEl.innerHTML = '';

  if (models.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Add a model first';
    defaultModelIdEl.appendChild(option);
    return;
  }

  models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = `${model.label} (${model.value})`;
    defaultModelIdEl.appendChild(option);
  });

  defaultModelIdEl.value = models.some((model) => model.id === selected)
    ? selected
    : models[0].id;

  updateExample();
}

async function handleSave(event) {
  event.preventDefault();

  const models = collectModels();
  if (models.length === 0) {
    showStatus('Add at least one model before saving.', 'error');
    return;
  }

  const settings = {
    apiUrl: apiUrlEl.value.trim(),
    apiKey: apiKeyEl.value.trim(),
    models,
    defaultModelId: defaultModelIdEl.value
  };

  try {
    saveBtn.disabled = true;
    currentSettings = await StorageUtils.saveSettings(settings);
    renderSettings(currentSettings);
    showStatus('Settings saved.', 'success');
    await refreshStorageMetrics();
  } catch (error) {
    showStatus(`Failed to save settings: ${error.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

async function handleTest() {
  try {
    const provisionalSettings = StorageUtils.sanitizeSettings({
      apiUrl: apiUrlEl.value.trim(),
      apiKey: apiKeyEl.value.trim(),
      models: collectModels(),
      defaultModelId: defaultModelIdEl.value
    });

    const model = StorageUtils.getDefaultModel(provisionalSettings);
    showStatus('Testing connection...', 'loading');
    testBtn.disabled = true;

    const response = await fetch(`${provisionalSettings.apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provisionalSettings.apiKey}`
      },
      body: JSON.stringify({
        model: model.value,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Respond with "Connection test successful."' }
        ],
        max_tokens: 60
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const reply = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : 'No message content returned';

    showStatus(`Connection successful. Reply: ${reply}`, 'success');
  } catch (error) {
    showStatus(`Connection failed: ${error.message}`, 'error');
  } finally {
    testBtn.disabled = false;
  }
}

async function refreshStorageMetrics() {
  const metrics = await StorageUtils.refreshStorageMetrics();
  storageTotalEl.textContent = `Total usage: ${StorageUtils.formatBytes(metrics.totalBytes)}`;
  storageHistoryEl.textContent = `History store: ${StorageUtils.formatBytes(metrics.historyBytes)}`;
  storageLocalEl.textContent = `Local settings/session data: ${StorageUtils.formatBytes(metrics.localBytes)}`;
  storageCountEl.textContent = `Stored conversations: ${metrics.historyCount}`;
  storageUpdatedAtEl.textContent = metrics.updatedAt
    ? `Last refreshed: ${new Date(metrics.updatedAt).toLocaleString()}`
    : 'Last refreshed: -';
}

async function handleClearStorage() {
  try {
    clearStorageBtn.disabled = true;
    await HistoryStore.clearConversations();
    await chrome.storage.local.remove(['apiCurrentSession']);
    await refreshStorageMetrics();
    showStatus('Conversation history cleared.', 'success');
  } catch (error) {
    showStatus(`Failed to clear storage: ${error.message}`, 'error');
  } finally {
    clearStorageBtn.disabled = false;
  }
}

function updateExample() {
  const settings = StorageUtils.sanitizeSettings({
    apiUrl: apiUrlEl.value.trim(),
    apiKey: apiKeyEl.value.trim(),
    models: collectModels(),
    defaultModelId: defaultModelIdEl.value
  });
  const model = StorageUtils.getDefaultModel(settings);

  exampleCallEl.textContent = [
    `POST ${settings.apiUrl}/v1/chat/completions`,
    `Authorization: Bearer ${settings.apiKey}`,
    'Content-Type: application/json',
    '',
    JSON.stringify({
      model: model.value,
      messages: [
        { role: 'system', content: 'Agent instructions' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Task: Analyze the supplied ZIP and screenshots.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } }
          ]
        }
      ]
    }, null, 2)
  ].join('\n');
}

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.style.display = 'block';
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
