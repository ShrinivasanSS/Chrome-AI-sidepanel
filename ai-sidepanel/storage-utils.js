(function(global) {
  'use strict';

  const DEFAULT_MODEL = {
    id: 'gpt-4o-mini',
    label: 'gpt-4o-mini',
    value: 'gpt-4o-mini'
  };

  const DEFAULT_STORAGE_METRICS = {
    historyBytes: 0,
    historyCount: 0,
    localBytes: 0,
    totalBytes: 0,
    updatedAt: null
  };

  const DEFAULT_SKILLS_CONFIG = {
    repositoryEnabled: true,
    repositoryUrl: 'http://localhost/skills/repository',
    autoRefresh: true,
    refreshIntervalMinutes: 15,
    maxAppliedSkills: 4,
    disabledSkillNames: []
  };

  const DEFAULT_RUNNER_CONFIG = {
    processingTarget: 'api',
    runnerType: 'claude',
    runnerMode: 'remote',
    remoteUrl: 'http://localhost:7070/run',
    nativeHostName: 'com.local.skillrunner.host',
    timeoutMs: 120000
  };

  const DEFAULT_THEME = 'light';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function sanitizeText(value, fallback) {
    if (typeof value !== 'string') {
      return fallback;
    }

    const trimmed = value.trim();
    return trimmed || fallback;
  }

  function makeModelId(value, index) {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return normalized || `model-${index + 1}`;
  }

  function normalizeModelEntry(entry, index) {
    if (typeof entry === 'string') {
      const value = sanitizeText(entry, DEFAULT_MODEL.value);
      return {
        id: makeModelId(value, index),
        label: value,
        value
      };
    }

    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const value = sanitizeText(entry.value || entry.model || entry.name, '');
    if (!value) {
      return null;
    }

    const label = sanitizeText(entry.label, value);
    const id = sanitizeText(entry.id, makeModelId(label || value, index));

    return { id, label, value };
  }

  function normalizeModels(models, legacyModel) {
    const candidates = Array.isArray(models) && models.length > 0
      ? models
      : legacyModel
        ? [legacyModel]
        : [clone(DEFAULT_MODEL)];

    const normalized = [];
    const seenIds = new Set();

    candidates.forEach((entry, index) => {
      const model = normalizeModelEntry(entry, index);
      if (!model) {
        return;
      }

      let id = model.id;
      let suffix = 1;
      while (seenIds.has(id)) {
        suffix += 1;
        id = `${model.id}-${suffix}`;
      }

      seenIds.add(id);
      normalized.push({
        id,
        label: model.label,
        value: model.value
      });
    });

    return normalized.length > 0 ? normalized : [clone(DEFAULT_MODEL)];
  }

  function normalizeApiUrl(apiUrl) {
    const value = sanitizeText(apiUrl, 'http://localhost:5001');
    return value.endsWith('/') ? value.slice(0, -1) : value;
  }

  function normalizeStorageMetrics(metrics) {
    return {
      historyBytes: Number(metrics && metrics.historyBytes) || 0,
      historyCount: Number(metrics && metrics.historyCount) || 0,
      localBytes: Number(metrics && metrics.localBytes) || 0,
      totalBytes: Number(metrics && metrics.totalBytes) || 0,
      updatedAt: metrics && metrics.updatedAt ? metrics.updatedAt : null
    };
  }

  function normalizeExtensionMode(value) {
    return value === 'user' ? 'user' : 'developer';
  }

  function normalizeTheme(value) {
    return value === 'dark' ? 'dark' : DEFAULT_THEME;
  }

  function normalizeTrustedDomains(rawDomains) {
    const source = Array.isArray(rawDomains)
      ? rawDomains
      : typeof rawDomains === 'string'
        ? rawDomains.split(/[\n,]+/)
        : [];

    const seen = new Set();
    const normalized = [];
    source.forEach((entry) => {
      if (typeof entry !== 'string') {
        return;
      }
      let domain = entry.trim().toLowerCase();
      domain = domain.replace(/^https?:\/\//, '');
      domain = domain.split('/')[0];
      if (!domain) {
        return;
      }
      if (!seen.has(domain)) {
        seen.add(domain);
        normalized.push(domain);
      }
    });

    return normalized;
  }

  function normalizeSkillsConfig(rawConfig) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const defaults = global.SkillsManager && SkillsManager.DEFAULT_SKILLS_CONFIG
      ? SkillsManager.DEFAULT_SKILLS_CONFIG
      : DEFAULT_SKILLS_CONFIG;

    const disabledSkillNames = Array.isArray(source.disabledSkillNames)
      ? source.disabledSkillNames
        .filter((name) => typeof name === 'string')
        .map((name) => name.trim())
        .filter(Boolean)
      : [];

    return {
      repositoryEnabled: source.repositoryEnabled !== false,
      repositoryUrl: sanitizeText(source.repositoryUrl, defaults.repositoryUrl),
      autoRefresh: source.autoRefresh !== false,
      refreshIntervalMinutes: Math.max(1, Number(source.refreshIntervalMinutes) || defaults.refreshIntervalMinutes),
      maxAppliedSkills: Math.max(1, Number(source.maxAppliedSkills) || defaults.maxAppliedSkills),
      disabledSkillNames
    };
  }

  function normalizeRunnerConfig(rawConfig) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const processingTarget = source.processingTarget === 'skill-runner' ? 'skill-runner' : 'api';
    const runnerType = ['claude', 'copilot', 'cursor'].includes(source.runnerType)
      ? source.runnerType
      : DEFAULT_RUNNER_CONFIG.runnerType;
    const runnerMode = source.runnerMode === 'local' ? 'local' : 'remote';

    return {
      processingTarget,
      runnerType,
      runnerMode,
      remoteUrl: sanitizeText(source.remoteUrl, DEFAULT_RUNNER_CONFIG.remoteUrl),
      nativeHostName: sanitizeText(source.nativeHostName, DEFAULT_RUNNER_CONFIG.nativeHostName),
      timeoutMs: Math.max(5000, Number(source.timeoutMs) || DEFAULT_RUNNER_CONFIG.timeoutMs)
    };
  }

  function sanitizeSettings(rawSettings) {
    const normalizedModels = normalizeModels(rawSettings.models, rawSettings.model);
    const defaultModelId = sanitizeText(rawSettings.defaultModelId, normalizedModels[0].id);
    const hasDefault = normalizedModels.some((entry) => entry.id === defaultModelId);

    return {
      apiUrl: normalizeApiUrl(rawSettings.apiUrl),
      apiKey: sanitizeText(rawSettings.apiKey, 'sk-nokey'),
      models: normalizedModels,
      defaultModelId: hasDefault ? defaultModelId : normalizedModels[0].id,
      storageMetrics: normalizeStorageMetrics(rawSettings.storageMetrics),
      extensionMode: normalizeExtensionMode(rawSettings.extensionMode),
      skillsConfig: normalizeSkillsConfig(rawSettings.skillsConfig),
      runnerConfig: normalizeRunnerConfig(rawSettings.runnerConfig),
      theme: normalizeTheme(rawSettings.theme),
      trustedSessionDomains: normalizeTrustedDomains(rawSettings.trustedSessionDomains)
    };
  }

  async function migrateLegacySettings() {
    const localSettings = await chrome.storage.local.get([
      'apiUrl',
      'apiKey',
      'models',
      'defaultModelId',
      'model',
      'storageMetrics',
      'extensionMode',
      'skillsConfig',
      'runnerConfig',
      'theme',
      'trustedSessionDomains'
    ]);

    if (
      localSettings.apiUrl ||
      localSettings.apiKey ||
      localSettings.models ||
      localSettings.defaultModelId ||
      localSettings.extensionMode ||
      localSettings.skillsConfig ||
      localSettings.runnerConfig ||
      localSettings.theme ||
      localSettings.trustedSessionDomains
    ) {
      const sanitized = sanitizeSettings(localSettings);
      await chrome.storage.local.set(sanitized);
      return sanitized;
    }

    const syncSettings = await chrome.storage.sync.get(['apiUrl', 'apiKey', 'model']);
    const sanitized = sanitizeSettings(syncSettings);
    await chrome.storage.local.set(sanitized);

    if (syncSettings.apiUrl || syncSettings.apiKey || syncSettings.model) {
      await chrome.storage.sync.remove(['apiUrl', 'apiKey', 'model']);
    }

    return sanitized;
  }

  async function loadSettings() {
    const existing = await chrome.storage.local.get([
      'apiUrl',
      'apiKey',
      'models',
      'defaultModelId',
      'model',
      'storageMetrics',
      'extensionMode',
      'skillsConfig',
      'runnerConfig',
      'theme',
      'trustedSessionDomains'
    ]);

    const hasStructuredSettings = (
      existing.apiUrl ||
      existing.apiKey ||
      existing.models ||
      existing.defaultModelId ||
      existing.extensionMode ||
      existing.skillsConfig ||
      existing.runnerConfig ||
      existing.theme ||
      existing.trustedSessionDomains
    );
    if (!hasStructuredSettings) {
      return migrateLegacySettings();
    }

    const sanitized = sanitizeSettings(existing);
    await chrome.storage.local.set(sanitized);
    return sanitized;
  }

  async function saveSettings(settings) {
    const sanitized = sanitizeSettings(settings);
    await chrome.storage.local.set(sanitized);
    return sanitized;
  }

  function getDefaultModel(settings) {
    const active = settings.models.find((entry) => entry.id === settings.defaultModelId);
    return active || settings.models[0];
  }

  function resolveModel(settings, preferredValue) {
    if (preferredValue && typeof preferredValue === 'string') {
      const preferred = preferredValue.trim();
      const matched = settings.models.find((entry) =>
        entry.id === preferred || entry.label === preferred || entry.value === preferred
      );

      if (matched) {
        return matched;
      }

      return {
        id: makeModelId(preferred, 0),
        label: preferred,
        value: preferred
      };
    }

    return getDefaultModel(settings);
  }

  function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function estimateLocalBytes() {
    const data = await chrome.storage.local.get(null);
    return new TextEncoder().encode(JSON.stringify(data)).length;
  }

  async function getStorageMetrics() {
    const result = await chrome.storage.local.get(['storageMetrics']);
    return normalizeStorageMetrics(result.storageMetrics || DEFAULT_STORAGE_METRICS);
  }

  async function setStorageMetrics(metrics) {
    const normalized = normalizeStorageMetrics(metrics);
    normalized.updatedAt = normalized.updatedAt || new Date().toISOString();
    await chrome.storage.local.set({ storageMetrics: normalized });
    return normalized;
  }

  async function refreshStorageMetrics() {
    const historyMetrics = global.HistoryStore
      ? await global.HistoryStore.getMetrics()
      : { historyBytes: 0, historyCount: 0 };

    const localBytes = await estimateLocalBytes();
    return setStorageMetrics({
      historyBytes: historyMetrics.historyBytes,
      historyCount: historyMetrics.historyCount,
      localBytes,
      totalBytes: historyMetrics.historyBytes + localBytes,
      updatedAt: new Date().toISOString()
    });
  }

  function formatBytes(bytes) {
    const numeric = Number(bytes) || 0;
    if (numeric < 1024) {
      return `${numeric} B`;
    }
    if (numeric < 1024 * 1024) {
      return `${(numeric / 1024).toFixed(1)} KB`;
    }
    return `${(numeric / (1024 * 1024)).toFixed(2)} MB`;
  }

  global.StorageUtils = {
    DEFAULT_MODEL: clone(DEFAULT_MODEL),
    DEFAULT_STORAGE_METRICS: clone(DEFAULT_STORAGE_METRICS),
    DEFAULT_SKILLS_CONFIG: clone(DEFAULT_SKILLS_CONFIG),
    DEFAULT_RUNNER_CONFIG: clone(DEFAULT_RUNNER_CONFIG),
    DEFAULT_THEME,
    loadSettings,
    saveSettings,
    sanitizeSettings,
    normalizeModels,
    getDefaultModel,
    resolveModel,
    createId,
    estimateLocalBytes,
    getStorageMetrics,
    setStorageMetrics,
    refreshStorageMetrics,
    formatBytes
  };
})(typeof self !== 'undefined' ? self : window);
