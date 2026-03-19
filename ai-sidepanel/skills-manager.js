(function(global) {
  'use strict';

  const DEFAULT_SKILLS_CONFIG = {
    repositoryEnabled: true,
    repositoryUrl: 'http://localhost/skills/repository',
    autoRefresh: true,
    refreshIntervalMinutes: 15,
    maxAppliedSkills: 4,
    disabledSkillNames: []
  };

  let runtimeCatalog = null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function clamp(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, Math.floor(numeric)));
  }

  function sanitizeConfig(rawConfig) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const disabledSkillNames = Array.isArray(source.disabledSkillNames)
      ? source.disabledSkillNames
        .filter((name) => typeof name === 'string')
        .map((name) => name.trim())
        .filter(Boolean)
      : [];

    return {
      repositoryEnabled: source.repositoryEnabled !== false,
      repositoryUrl: normalizeText(source.repositoryUrl) || DEFAULT_SKILLS_CONFIG.repositoryUrl,
      autoRefresh: source.autoRefresh !== false,
      refreshIntervalMinutes: clamp(source.refreshIntervalMinutes, 1, 1440, DEFAULT_SKILLS_CONFIG.refreshIntervalMinutes),
      maxAppliedSkills: clamp(source.maxAppliedSkills, 1, 10, DEFAULT_SKILLS_CONFIG.maxAppliedSkills),
      disabledSkillNames
    };
  }

  function parseFrontmatter(markdown) {
    const source = typeof markdown === 'string' ? markdown : '';
    if (!source.startsWith('---')) {
      return { metadata: {}, body: source };
    }

    const closingMatch = /^---\s*[\r\n]+([\s\S]*?)^[ \t]*---\s*[\r\n]?/m.exec(source);
    if (!closingMatch) {
      return {
        metadata: {},
        body: source,
        warning: 'Frontmatter delimiter not closed; using full file as instructions.'
      };
    }

    const frontmatterBlock = closingMatch[1];
    const body = source.slice(closingMatch[0].length);
    const metadata = {};
    const warnings = [];

    frontmatterBlock.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }

      const delimiter = trimmed.indexOf(':');
      if (delimiter < 1) {
        warnings.push(`Ignored malformed frontmatter line: ${trimmed}`);
        return;
      }

      const key = trimmed.slice(0, delimiter).trim();
      let value = trimmed.slice(delimiter + 1).trim();
      value = value.replace(/^['"]|['"]$/g, '');
      metadata[key] = value;
    });

    return {
      metadata,
      body,
      warnings
    };
  }

  function inferDescription(bodyText) {
    const lines = bodyText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      return '';
    }

    const headingLine = lines.find((line) => !line.startsWith('#'));
    return normalizeText(headingLine || lines[0]).slice(0, 1024);
  }

  function parseSkillDocument(args) {
    const fileContent = typeof args.content === 'string' ? args.content : '';
    const location = normalizeText(args.location) || 'unknown';
    const sourceType = normalizeText(args.sourceType) || 'unknown';
    const sourceLabel = normalizeText(args.sourceLabel) || location;
    const frontmatter = parseFrontmatter(fileContent);
    const warnings = [];

    if (frontmatter.warning) {
      warnings.push(frontmatter.warning);
    }
    if (Array.isArray(frontmatter.warnings) && frontmatter.warnings.length > 0) {
      warnings.push(...frontmatter.warnings);
    }

    const bodyText = normalizeText(frontmatter.body);
    const metadata = frontmatter.metadata || {};
    const skillName = normalizeText(metadata.name);
    const description = normalizeText(metadata.description) || inferDescription(bodyText);

    if (!skillName) {
      return {
        skill: null,
        warnings: warnings.concat(`Skipped ${location}: missing required "name" field in frontmatter.`)
      };
    }

    if (!description) {
      return {
        skill: null,
        warnings: warnings.concat(`Skipped ${location}: missing required "description" and no fallback text was found.`)
      };
    }

    return {
      skill: {
        name: skillName,
        description,
        instructions: bodyText || fileContent,
        metadata,
        location,
        source: sourceType,
        sourceLabel,
        updatedAt: new Date().toISOString()
      },
      warnings
    };
  }

  function extractSkillLinksFromHtml(html) {
    const links = [];
    const matcher = /href\s*=\s*["']([^"']+\.skill(?:\?[^"']*)?)["']/gi;
    let match = matcher.exec(html);
    while (match) {
      links.push(match[1]);
      match = matcher.exec(html);
    }
    return links;
  }

  function extractSkillLinksFromText(content) {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && /\.skill(\?.*)?$/i.test(line));
  }

  async function discoverSkillPackageUrls(repositoryUrl) {
    const baseUrl = repositoryUrl.endsWith('/')
      ? repositoryUrl
      : `${repositoryUrl}/`;
    const response = await fetch(baseUrl, { method: 'GET', cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to fetch repository listing (${response.status})`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const bodyText = await response.text();
    let links = [];

    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(bodyText);
        if (Array.isArray(parsed)) {
          links = parsed;
        } else if (parsed && Array.isArray(parsed.skills)) {
          links = parsed.skills;
        }
      } catch (error) {
        throw new Error(`Invalid repository JSON listing: ${error.message}`);
      }
    } else {
      links = extractSkillLinksFromHtml(bodyText);
      if (links.length === 0) {
        links = extractSkillLinksFromText(bodyText);
      }
    }

    const resolved = [];
    const dedupe = new Set();
    links.forEach((entry) => {
      if (typeof entry !== 'string') {
        return;
      }
      const trimmed = entry.trim();
      if (!trimmed || !/\.skill(\?.*)?$/i.test(trimmed)) {
        return;
      }
      const absolute = new URL(trimmed, baseUrl).href;
      if (!dedupe.has(absolute)) {
        dedupe.add(absolute);
        resolved.push(absolute);
      }
    });

    return resolved;
  }

  async function loadFromRepository(config) {
    const source = {
      type: 'repository',
      enabled: config.repositoryEnabled,
      ok: false,
      count: 0,
      error: null,
      warnings: [],
      skills: []
    };

    if (!config.repositoryEnabled) {
      return source;
    }

    try {
      const packageUrls = await discoverSkillPackageUrls(config.repositoryUrl);
      if (packageUrls.length === 0) {
        source.warnings.push('No .skill files were discovered in the repository listing.');
      }

      for (const packageUrl of packageUrls) {
        try {
          const response = await fetch(packageUrl, { method: 'GET', cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const zipBuffer = await response.arrayBuffer();
          const extracted = await global.ZipUtils.extractSupportedEntries(zipBuffer);
          source.warnings.push(...(extracted.warnings || []));

          const skillEntries = extracted.entries.filter((entry) => /(^|\/)SKILL\.md$/i.test(entry.fileName));
          if (skillEntries.length === 0) {
            source.warnings.push(`No SKILL.md found inside ${packageUrl}.`);
            continue;
          }

          skillEntries.forEach((entry) => {
            const parsed = parseSkillDocument({
              content: entry.rawText || '',
              location: `${packageUrl}!/${entry.fileName}`,
              sourceType: 'repository',
              sourceLabel: config.repositoryUrl
            });
            source.warnings.push(...parsed.warnings);
            if (parsed.skill) {
              source.skills.push(parsed.skill);
            }
          });
        } catch (error) {
          source.warnings.push(`Failed to load skill package ${packageUrl}: ${error.message}`);
        }
      }

      source.ok = true;
      source.count = source.skills.length;
      source.updatedAt = new Date().toISOString();
      return source;
    } catch (error) {
      source.error = error.message;
      return source;
    }
  }

  async function persistCatalog(catalog, state) {
    runtimeCatalog = catalog.slice();
    await chrome.storage.local.set({
      skillsCatalog: catalog,
      skillsState: state
    });
  }

  async function loadCachedCatalog() {
    if (runtimeCatalog) {
      return runtimeCatalog.slice();
    }

    const stored = await chrome.storage.local.get(['skillsCatalog']);
    const catalog = Array.isArray(stored.skillsCatalog) ? stored.skillsCatalog : [];
    runtimeCatalog = catalog;
    return catalog.slice();
  }

  async function refreshSkills(options) {
    const args = options || {};
    const settings = await global.StorageUtils.loadSettings();
    const config = sanitizeConfig(settings.skillsConfig);
    const startedAt = new Date().toISOString();

    const repositorySource = await loadFromRepository(config);
    const warnings = [...(repositorySource.warnings || [])];

    const dedupedSkillsMap = new Map();
    repositorySource.skills.forEach((skill) => {
      dedupedSkillsMap.set(skill.name.toLowerCase(), skill);
    });
    const dedupedSkills = Array.from(dedupedSkillsMap.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    );

    const previous = await chrome.storage.local.get(['skillsCatalog', 'skillsState']);
    const previousCatalog = Array.isArray(previous.skillsCatalog) ? previous.skillsCatalog : [];
    const latestError = repositorySource.error || null;
    const shouldKeepPreviousCatalog = dedupedSkills.length === 0 && latestError;
    const finalCatalog = shouldKeepPreviousCatalog ? previousCatalog : dedupedSkills;

    const state = {
      reason: normalizeText(args.reason) || 'manual',
      lastAttemptAt: startedAt,
      lastSuccessAt: shouldKeepPreviousCatalog
        ? ((previous.skillsState && previous.skillsState.lastSuccessAt) || null)
        : new Date().toISOString(),
      lastError: latestError || null,
      catalogCount: finalCatalog.length,
      warnings,
      sources: {
        repository: {
          enabled: repositorySource.enabled,
          ok: repositorySource.ok,
          count: repositorySource.count,
          error: repositorySource.error || null,
          updatedAt: repositorySource.updatedAt || null
        }
      },
      catalog: finalCatalog.map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
        location: skill.location,
        updatedAt: skill.updatedAt
      }))
    };

    await persistCatalog(finalCatalog, state);
    return state;
  }

  function tokenize(value) {
    return String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4);
  }

  function getRequestSkillNames(rawRequest) {
    const list = [];

    if (rawRequest && Array.isArray(rawRequest.skills)) {
      rawRequest.skills.forEach((entry) => {
        if (typeof entry === 'string') {
          list.push(entry);
        } else if (entry && typeof entry.name === 'string') {
          list.push(entry.name);
        }
      });
    }

    if (rawRequest && Array.isArray(rawRequest.skillNames)) {
      rawRequest.skillNames.forEach((entry) => {
        if (typeof entry === 'string') {
          list.push(entry);
        }
      });
    }

    return list.map((name) => name.trim()).filter(Boolean);
  }

  async function selectSkills(rawRequest, normalizedRequest, maxAppliedSkills, disabledSkillNames) {
    const disabledLookup = new Set((disabledSkillNames || []).map((name) => String(name).toLowerCase()));
    const catalog = (await loadCachedCatalog()).filter((entry) => !disabledLookup.has(entry.name.toLowerCase()));
    const requestedNames = getRequestSkillNames(rawRequest);
    const warnings = [];

    if (requestedNames.length > 0) {
      const selected = [];
      requestedNames.forEach((name) => {
        if (disabledLookup.has(name.toLowerCase())) {
          warnings.push(`Requested skill is disabled in settings: ${name}`);
          return;
        }
        const found = catalog.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
        if (found) {
          selected.push(found);
        } else {
          warnings.push(`Requested skill was not found: ${name}`);
        }
      });

      return {
        selected: selected.slice(0, maxAppliedSkills),
        warnings
      };
    }

    const corpus = [
      normalizedRequest.agent,
      normalizedRequest.name,
      ...(normalizedRequest.tasks || []).map((task) => `${task.input}\n${task.userText}`)
    ].join('\n').toLowerCase();

    const scored = catalog.map((skill) => {
      const tokens = tokenize(`${skill.name} ${skill.description}`);
      let score = 0;
      tokens.forEach((token) => {
        if (corpus.includes(token)) {
          score += 1;
        }
      });
      return { skill, score };
    }).filter((entry) => entry.score > 0);

    scored.sort((left, right) => right.score - left.score);

    return {
      selected: scored.slice(0, maxAppliedSkills).map((entry) => entry.skill),
      warnings
    };
  }

  function buildAgentPrompt(baseAgent, selectedSkills) {
    if (!Array.isArray(selectedSkills) || selectedSkills.length === 0) {
      return baseAgent;
    }

    const blocks = selectedSkills.map((skill, index) => [
      `Skill ${index + 1}: ${skill.name}`,
      `Description: ${skill.description}`,
      skill.instructions
    ].join('\n'));

    return [
      baseAgent,
      '',
      'Apply the following skill instructions when they are relevant to each user task:',
      '',
      blocks.join('\n\n---\n\n')
    ].join('\n');
  }

  async function buildAgentContext(rawRequest, normalizedRequest) {
    const settings = await global.StorageUtils.loadSettings();
    const config = sanitizeConfig(settings.skillsConfig);
    const selectedResult = await selectSkills(
      rawRequest,
      normalizedRequest,
      config.maxAppliedSkills,
      config.disabledSkillNames
    );
    const prompt = buildAgentPrompt(normalizedRequest.agent, selectedResult.selected);

    return {
      agentPrompt: prompt,
      selectedSkills: selectedResult.selected.map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: skill.source
      })),
      warnings: selectedResult.warnings
    };
  }

  async function scheduleRefreshAlarm(forceIntervalMinutes) {
    const settings = await global.StorageUtils.loadSettings();
    const config = sanitizeConfig(settings.skillsConfig);
    const intervalMinutes = clamp(
      forceIntervalMinutes || config.refreshIntervalMinutes,
      1,
      1440,
      DEFAULT_SKILLS_CONFIG.refreshIntervalMinutes
    );

    if (!config.autoRefresh) {
      await chrome.alarms.clear('skills-refresh');
      return;
    }

    await chrome.alarms.create('skills-refresh', {
      delayInMinutes: intervalMinutes,
      periodInMinutes: intervalMinutes
    });
  }

  global.SkillsManager = {
    DEFAULT_SKILLS_CONFIG: clone(DEFAULT_SKILLS_CONFIG),
    sanitizeConfig,
    refreshSkills,
    loadCachedCatalog,
    buildAgentContext,
    scheduleRefreshAlarm
  };
})(typeof self !== 'undefined' ? self : window);
