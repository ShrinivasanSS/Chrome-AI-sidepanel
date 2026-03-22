const apiUrlEl = document.getElementById('apiUrl');
const apiKeyEl = document.getElementById('apiKey');
const extensionModeEl = document.getElementById('extensionMode');
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
const refreshSkillsBtn = document.getElementById('refreshSkillsBtn');
const enableAllSkillsBtn = document.getElementById('enableAllSkillsBtn');
const disableAllSkillsBtn = document.getElementById('disableAllSkillsBtn');
const skillsToggleListEl = document.getElementById('skillsToggleList');
const skillsToggleSummaryEl = document.getElementById('skillsToggleSummary');

const skillsRepositoryEnabledEl = document.getElementById('skillsRepositoryEnabled');
const skillsRepositoryUrlEl = document.getElementById('skillsRepositoryUrl');
const skillsAutoRefreshEl = document.getElementById('skillsAutoRefresh');
const skillsRefreshIntervalEl = document.getElementById('skillsRefreshInterval');
const skillsMaxAppliedEl = document.getElementById('skillsMaxApplied');
const skillsCountEl = document.getElementById('skillsCount');
const skillsLastSuccessEl = document.getElementById('skillsLastSuccess');
const skillsLastAttemptEl = document.getElementById('skillsLastAttempt');
const skillsSourceHealthEl = document.getElementById('skillsSourceHealth');
const skillsErrorsEl = document.getElementById('skillsErrors');
const processingTargetEl = document.getElementById('processingTarget');
const runnerTypeEl = document.getElementById('runnerType');
const runnerModeEl = document.getElementById('runnerMode');
const runnerRemoteUrlEl = document.getElementById('runnerRemoteUrl');
const runnerNativeHostNameEl = document.getElementById('runnerNativeHostName');
const runnerTimeoutMsEl = document.getElementById('runnerTimeoutMs');
const themeModeEl = document.getElementById('themeMode');
const trustedSessionDomainsEl = document.getElementById('trustedSessionDomains');
const runnerCookieEnvMapEl = document.getElementById('runnerCookieEnvMap');

const storageTotalEl = document.getElementById('storageTotal');
const storageHistoryEl = document.getElementById('storageHistory');
const storageLocalEl = document.getElementById('storageLocal');
const storageCountEl = document.getElementById('storageCount');
const storageUpdatedAtEl = document.getElementById('storageUpdatedAt');

let currentSettings = null;
let lastSkillsCatalog = [];

document.addEventListener('DOMContentLoaded', initializeSettingsPage);

async function initializeSettingsPage() {
  settingsForm.addEventListener('submit', handleSave);
  testBtn.addEventListener('click', handleTest);
  refreshSkillsBtn.addEventListener('click', handleRefreshSkills);
  enableAllSkillsBtn.addEventListener('click', () => setAllSkillToggleState(true));
  disableAllSkillsBtn.addEventListener('click', () => setAllSkillToggleState(false));
  addModelBtn.addEventListener('click', () => {
    renderModelRow({ label: '', value: '' });
    syncDefaultModelOptions();
  });
  refreshStorageBtn.addEventListener('click', refreshStorageMetrics);
  clearStorageBtn.addEventListener('click', handleClearStorage);
  apiUrlEl.addEventListener('input', updateExample);
  apiKeyEl.addEventListener('input', updateExample);
  themeModeEl.addEventListener('change', handleThemeChange);
  processingTargetEl.addEventListener('change', updateExample);
  runnerTypeEl.addEventListener('change', updateExample);
  runnerModeEl.addEventListener('change', updateExample);
  runnerRemoteUrlEl.addEventListener('input', updateExample);
  runnerNativeHostNameEl.addEventListener('input', updateExample);
  trustedSessionDomainsEl.addEventListener('input', updateExample);
  runnerCookieEnvMapEl.addEventListener('input', updateExample);
  runnerModeEl.addEventListener('change', updateRunnerFieldVisibility);
  processingTargetEl.addEventListener('change', updateRunnerFieldVisibility);

  currentSettings = await StorageUtils.loadSettings();
  renderSettings(currentSettings);
  await Promise.all([
    refreshStorageMetrics(),
    refreshSkillsState()
  ]);
}

function renderSettings(settings) {
  apiUrlEl.value = settings.apiUrl;
  apiKeyEl.value = settings.apiKey;
  extensionModeEl.value = settings.extensionMode || 'developer';
  themeModeEl.value = settings.theme || 'light';
  applyTheme(settings.theme || 'light');
  trustedSessionDomainsEl.value = Array.isArray(settings.trustedSessionDomains)
    ? settings.trustedSessionDomains.join('\n')
    : '';
  runnerCookieEnvMapEl.value = formatCookieEnvMap(settings.runnerCookieEnvMap, settings.trustedSessionDomains);

  modelsContainerEl.innerHTML = '';
  settings.models.forEach((model) => renderModelRow(model));
  syncDefaultModelOptions(settings.defaultModelId);

  const skillsConfig = settings.skillsConfig || StorageUtils.DEFAULT_SKILLS_CONFIG;
  skillsRepositoryEnabledEl.checked = skillsConfig.repositoryEnabled !== false;
  skillsRepositoryUrlEl.value = skillsConfig.repositoryUrl || StorageUtils.DEFAULT_SKILLS_CONFIG.repositoryUrl;
  skillsAutoRefreshEl.checked = skillsConfig.autoRefresh !== false;
  skillsRefreshIntervalEl.value = String(skillsConfig.refreshIntervalMinutes || 15);
  skillsMaxAppliedEl.value = String(skillsConfig.maxAppliedSkills || 4);

  const runnerConfig = settings.runnerConfig || StorageUtils.DEFAULT_RUNNER_CONFIG;
  processingTargetEl.value = runnerConfig.processingTarget || 'api';
  runnerTypeEl.value = runnerConfig.runnerType || 'claude';
  runnerModeEl.value = runnerConfig.runnerMode || 'remote';
  runnerRemoteUrlEl.value = runnerConfig.remoteUrl || StorageUtils.DEFAULT_RUNNER_CONFIG.remoteUrl;
  runnerNativeHostNameEl.value = runnerConfig.nativeHostName || StorageUtils.DEFAULT_RUNNER_CONFIG.nativeHostName;
  runnerTimeoutMsEl.value = String(runnerConfig.timeoutMs || StorageUtils.DEFAULT_RUNNER_CONFIG.timeoutMs);
  updateRunnerFieldVisibility();

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

function collectSkillsConfig() {
  return {
    repositoryEnabled: skillsRepositoryEnabledEl.checked,
    repositoryUrl: skillsRepositoryUrlEl.value.trim(),
    autoRefresh: skillsAutoRefreshEl.checked,
    refreshIntervalMinutes: Number(skillsRefreshIntervalEl.value) || 15,
    maxAppliedSkills: Number(skillsMaxAppliedEl.value) || 4,
    disabledSkillNames: getDisabledSkillNamesFromUi()
  };
}

function collectRunnerConfig() {
  return {
    processingTarget: processingTargetEl.value === 'skill-runner' ? 'skill-runner' : 'api',
    runnerType: runnerTypeEl.value,
    runnerMode: runnerModeEl.value === 'local' ? 'local' : 'remote',
    remoteUrl: runnerRemoteUrlEl.value.trim(),
    nativeHostName: runnerNativeHostNameEl.value.trim(),
    timeoutMs: Number(runnerTimeoutMsEl.value) || 120000
  };
}

function collectTrustedDomains() {
  return trustedSessionDomainsEl.value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseCookieEnvMap() {
  const output = {};
  runnerCookieEnvMapEl.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const index = line.indexOf('=');
      if (index <= 0) {
        return;
      }
      const domain = line.slice(0, index).trim().toLowerCase();
      const envName = line.slice(index + 1).trim();
      if (!domain || !envName) {
        return;
      }
      output[domain] = envName;
    });
  return output;
}

function formatCookieEnvMap(map, trustedDomains) {
  const trusted = Array.isArray(trustedDomains) ? trustedDomains : [];
  const source = map && typeof map === 'object' ? map : {};
  const lines = [];
  trusted.forEach((domain) => {
    const key = String(domain || '').trim().toLowerCase();
    if (!key) {
      return;
    }
    const envName = source[key] || StorageUtils.defaultCookieEnvName(key);
    lines.push(`${key}=${envName}`);
  });
  Object.keys(source).forEach((domain) => {
    const key = String(domain || '').trim().toLowerCase();
    if (!key || trusted.includes(key)) {
      return;
    }
    lines.push(`${key}=${source[key]}`);
  });
  return lines.join('\n');
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
    extensionMode: extensionModeEl.value === 'user' ? 'user' : 'developer',
    theme: themeModeEl.value === 'dark' ? 'dark' : 'light',
    trustedSessionDomains: collectTrustedDomains(),
    runnerCookieEnvMap: parseCookieEnvMap(),
    models,
    defaultModelId: defaultModelIdEl.value,
    skillsConfig: collectSkillsConfig(),
    runnerConfig: collectRunnerConfig()
  };

  try {
    saveBtn.disabled = true;
    let updatedState = null;
    currentSettings = await StorageUtils.saveSettings(settings);
    renderSettings(currentSettings);
    try {
      const syncResponse = await sendRuntimeMessage({ command: 'settings-updated' });
      if (syncResponse && syncResponse.success) {
        updatedState = syncResponse.state || null;
      }
    } catch (workerError) {
      console.warn('[Settings] Saved settings but background refresh failed:', workerError);
    }
    showStatus('Settings saved.', 'success');
    await Promise.all([
      refreshStorageMetrics(),
      refreshSkillsState(updatedState)
    ]);
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
      extensionMode: extensionModeEl.value === 'user' ? 'user' : 'developer',
      theme: themeModeEl.value === 'dark' ? 'dark' : 'light',
      trustedSessionDomains: collectTrustedDomains(),
      runnerCookieEnvMap: parseCookieEnvMap(),
      models: collectModels(),
      defaultModelId: defaultModelIdEl.value,
      skillsConfig: collectSkillsConfig(),
      runnerConfig: collectRunnerConfig()
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

async function handleRefreshSkills() {
  try {
    refreshSkillsBtn.disabled = true;
    showStatus('Refreshing skills catalog...', 'loading');
    const response = await sendRuntimeMessage({ command: 'refresh-skills' });
    if (!response.success) {
      throw new Error(response.error || 'Skills refresh failed');
    }
    await refreshSkillsState(response.state);
    showStatus('Skills catalog refreshed.', 'success');
  } catch (error) {
    showStatus(`Failed to refresh skills: ${error.message}`, 'error');
  } finally {
    refreshSkillsBtn.disabled = false;
  }
}

async function refreshSkillsState(preloadedState) {
  let state = preloadedState;
  if (!state) {
    const response = await sendRuntimeMessage({ command: 'get-skills-state' });
    if (response.success) {
      state = response.state;
    }
  }

  if (!state) {
    lastSkillsCatalog = [];
    skillsCountEl.textContent = 'Skills in catalog: -';
    skillsLastSuccessEl.textContent = 'Last success: -';
    skillsLastAttemptEl.textContent = 'Last attempt: -';
    skillsSourceHealthEl.textContent = 'Source health: -';
    skillsErrorsEl.textContent = '';
    renderSkillToggleList([], []);
    return;
  }

  skillsCountEl.textContent = `Skills in catalog: ${state.catalogCount || 0}`;
  skillsLastSuccessEl.textContent = `Last success: ${state.lastSuccessAt ? new Date(state.lastSuccessAt).toLocaleString() : '-'}`;
  skillsLastAttemptEl.textContent = `Last attempt: ${state.lastAttemptAt ? new Date(state.lastAttemptAt).toLocaleString() : '-'}`;

  const sourceParts = [];
  if (state.sources && state.sources.repository) {
    sourceParts.push(`Repository: ${state.sources.repository.ok ? 'ok' : state.sources.repository.enabled ? 'error' : 'disabled'} (${state.sources.repository.count || 0})`);
  }
  skillsSourceHealthEl.textContent = `Source health: ${sourceParts.join(' | ') || '-'}`;

  const errorLines = [];
  if (state.lastError) {
    errorLines.push(`Last error: ${state.lastError}`);
  }
  if (state.launcherSync) {
    if (state.launcherSync.status === 'ok') {
      errorLines.push(`Launcher sync: ok (${state.launcherSync.mode || 'n/a'})`);
    } else if (state.launcherSync.status === 'error') {
      errorLines.push(`Launcher sync error: ${state.launcherSync.error || 'unknown error'}`);
    } else if (state.launcherSync.status === 'skipped') {
      errorLines.push(`Launcher sync: skipped (${state.launcherSync.reason || 'n/a'})`);
    }
  }
  if (Array.isArray(state.warnings) && state.warnings.length > 0) {
    errorLines.push(`Warnings: ${state.warnings.slice(0, 3).join(' | ')}`);
  }
  skillsErrorsEl.textContent = errorLines.join('\n');

  lastSkillsCatalog = Array.isArray(state.catalog) ? state.catalog.slice() : [];
  const disabled = (currentSettings && currentSettings.skillsConfig && Array.isArray(currentSettings.skillsConfig.disabledSkillNames))
    ? currentSettings.skillsConfig.disabledSkillNames
    : [];
  renderSkillToggleList(lastSkillsCatalog, disabled);
}

function renderSkillToggleList(catalog, disabledNames) {
  const disabledLookup = new Set((disabledNames || []).map((name) => String(name).toLowerCase()));
  skillsToggleListEl.innerHTML = '';

  if (!Array.isArray(catalog) || catalog.length === 0) {
    skillsToggleListEl.innerHTML = '<div class="help-text">No skills discovered yet.</div>';
    skillsToggleSummaryEl.textContent = '0 available';
    return;
  }

  catalog.forEach((skill) => {
    const row = document.createElement('label');
    row.className = 'skills-toggle-item';
    row.innerHTML = `
      <input type="checkbox" class="skill-toggle-checkbox" data-skill-name="${escapeAttribute(skill.name)}">
      <span><strong>${escapeHtml(skill.name)}</strong> - ${escapeHtml(skill.description || '')}</span>
    `;
    const checkbox = row.querySelector('.skill-toggle-checkbox');
    checkbox.checked = !disabledLookup.has(String(skill.name).toLowerCase());
    checkbox.addEventListener('change', () => {
      const total = catalog.length;
      const enabledCount = getEnabledSkillNamesFromUi().length;
      skillsToggleSummaryEl.textContent = `${total} available, ${enabledCount} enabled`;
    });
    skillsToggleListEl.appendChild(row);
  });

  const enabled = getEnabledSkillNamesFromUi().length;
  skillsToggleSummaryEl.textContent = `${catalog.length} available, ${enabled} enabled`;
}

function setAllSkillToggleState(enabled) {
  const checkboxes = skillsToggleListEl.querySelectorAll('.skill-toggle-checkbox');
  checkboxes.forEach((checkbox) => {
    checkbox.checked = enabled;
  });
  const total = checkboxes.length;
  skillsToggleSummaryEl.textContent = `${total} available, ${enabled ? total : 0} enabled`;
}

function getEnabledSkillNamesFromUi() {
  const checkboxes = Array.from(skillsToggleListEl.querySelectorAll('.skill-toggle-checkbox'));
  return checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.dataset.skillName);
}

function getDisabledSkillNamesFromUi() {
  const checkboxes = Array.from(skillsToggleListEl.querySelectorAll('.skill-toggle-checkbox'));
  if (checkboxes.length === 0) {
    const fallback = currentSettings && currentSettings.skillsConfig && Array.isArray(currentSettings.skillsConfig.disabledSkillNames)
      ? currentSettings.skillsConfig.disabledSkillNames
      : [];
    return fallback.slice();
  }

  return checkboxes
    .filter((checkbox) => !checkbox.checked)
    .map((checkbox) => checkbox.dataset.skillName);
}

function updateExample() {
  const settings = StorageUtils.sanitizeSettings({
    apiUrl: apiUrlEl.value.trim(),
    apiKey: apiKeyEl.value.trim(),
    extensionMode: extensionModeEl.value === 'user' ? 'user' : 'developer',
    theme: themeModeEl.value === 'dark' ? 'dark' : 'light',
    trustedSessionDomains: collectTrustedDomains(),
    runnerCookieEnvMap: parseCookieEnvMap(),
    models: collectModels(),
    defaultModelId: defaultModelIdEl.value,
    skillsConfig: collectSkillsConfig(),
    runnerConfig: collectRunnerConfig()
  });
  const model = StorageUtils.getDefaultModel(settings);
  const runnerConfig = settings.runnerConfig || StorageUtils.DEFAULT_RUNNER_CONFIG;

  exampleCallEl.textContent = [
    `POST ${settings.apiUrl}/v1/chat/completions`,
    `Authorization: Bearer ${settings.apiKey}`,
    'Content-Type: application/json',
    '',
    runnerConfig.processingTarget === 'api'
      ? JSON.stringify({
        model: model.value,
        messages: [
          { role: 'system', content: 'Agent instructions + selected skill instructions' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Task: Analyze the supplied ZIP and screenshots.' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } }
            ]
          }
        ]
      }, null, 2)
      : JSON.stringify({
        runner: runnerConfig.runnerType,
        mode: runnerConfig.runnerMode,
        timeoutMs: runnerConfig.timeoutMs,
        runnerInput: {
          userMessage: 'Analyze current page task',
          sessionInfo: {
            cookieHeadersByDomain: settings.trustedSessionDomains.reduce((acc, domain) => {
              const envName = settings.runnerCookieEnvMap[domain];
              acc[domain] = `<forwarded via ${envName}>`;
              return acc;
            }, {})
          }
        }
      }, null, 2)
  ].join('\n');
}

function updateRunnerFieldVisibility() {
  const targetIsRunner = processingTargetEl.value === 'skill-runner';
  const localMode = runnerModeEl.value === 'local';
  runnerTypeEl.disabled = !targetIsRunner;
  runnerModeEl.disabled = !targetIsRunner;
  runnerRemoteUrlEl.disabled = !targetIsRunner || localMode;
  runnerNativeHostNameEl.disabled = !targetIsRunner || !localMode;
  runnerTimeoutMsEl.disabled = !targetIsRunner;
}

function handleThemeChange() {
  applyTheme(themeModeEl.value === 'dark' ? 'dark' : 'light');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
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

      resolve(response || { success: false, error: 'No response' });
    });
  });
}
