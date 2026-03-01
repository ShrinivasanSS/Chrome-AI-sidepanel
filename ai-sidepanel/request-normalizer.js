(function(global) {
  'use strict';

  function ensureTaskArray(request) {
    if (Array.isArray(request.params)) {
      return request.params;
    }

    if (Array.isArray(request.tasks)) {
      return request.tasks;
    }

    throw new Error('Request must include a non-empty "params" or "tasks" array');
  }

  function normalizeTextBlock(label, value) {
    return {
      label,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    };
  }

  function appendPlainSupplement(supplements, collector) {
    const textValues = supplements.filter((entry) => typeof entry === 'string');
    if (textValues.length > 0) {
      collector.textBlocks.push(normalizeTextBlock('Supplements', textValues.join(', ')));
    }
  }

  function getPayloadType(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    return String(payload.type || payload.kind || payload.format || '').toLowerCase();
  }

  async function appendPayload(payload, collector, labelPrefix) {
    if (payload == null) {
      return;
    }

    if (typeof payload === 'string') {
      collector.textBlocks.push(normalizeTextBlock(labelPrefix, payload));
      return;
    }

    if (Array.isArray(payload)) {
      for (const entry of payload) {
        await appendPayload(entry, collector, labelPrefix);
      }
      return;
    }

    if (typeof payload !== 'object') {
      collector.warnings.push(`Ignored unsupported payload type: ${typeof payload}`);
      return;
    }

    const payloadType = getPayloadType(payload);

    if (!payloadType) {
      collector.textBlocks.push(normalizeTextBlock(labelPrefix, payload));
      return;
    }

    if (payloadType === 'text') {
      collector.textBlocks.push(normalizeTextBlock(payload.label || labelPrefix, payload.text || payload.data || ''));
      return;
    }

    if (payloadType === 'json') {
      const value = payload.value !== undefined ? payload.value : payload.data;
      collector.textBlocks.push(normalizeTextBlock(payload.label || payload.fileName || labelPrefix, value));
      return;
    }

    if (payloadType === 'image' || payloadType === 'image_base64' || payloadType === 'screenshot') {
      const image = global.ZipUtils.normalizeImageData(payload, payload.mediaType || 'image/png');
      collector.images.push({
        label: payload.label || payload.fileName || 'Image attachment',
        url: image.dataUrl
      });
      return;
    }

    if (payloadType === 'zip' || payloadType === 'zip_base64') {
      const zipResult = await global.ZipUtils.extractSupportedEntries(payload);

      zipResult.entries.forEach((entry) => {
        if (entry.kind === 'image') {
          collector.images.push({
            label: entry.fileName,
            url: entry.dataUrl
          });
          return;
        }

        if (entry.kind === 'json') {
          collector.textBlocks.push(normalizeTextBlock(`ZIP JSON: ${entry.fileName}`, entry.value));
          return;
        }

        collector.textBlocks.push(normalizeTextBlock(`ZIP Text: ${entry.fileName}`, entry.rawText));
      });

      collector.warnings.push(...zipResult.warnings);
      return;
    }

    collector.warnings.push(`Ignored unsupported payload format: ${payloadType}`);
  }

  async function normalizeTask(task, index) {
    if (!task || typeof task !== 'object') {
      throw new Error(`Task ${index + 1} must be an object`);
    }

    if (!task.input || typeof task.input !== 'string') {
      throw new Error(`Task ${index + 1} is missing a valid "input" field`);
    }

    const collector = {
      textBlocks: [],
      images: [],
      warnings: []
    };

    if (task.data !== undefined) {
      await appendPayload(task.data, collector, 'Data');
    }

    if (Array.isArray(task.attachments)) {
      await appendPayload(task.attachments, collector, 'Attachment');
    }

    if (Array.isArray(task.payloads)) {
      await appendPayload(task.payloads, collector, 'Payload');
    }

    if (Array.isArray(task.supplements)) {
      appendPlainSupplement(task.supplements, collector);
      const objectSupplements = task.supplements.filter((entry) => entry && typeof entry === 'object');
      if (objectSupplements.length > 0) {
        await appendPayload(objectSupplements, collector, 'Supplement');
      }
    }

    const sections = [`Task: ${task.input}`];
    collector.textBlocks.forEach((block) => {
      const text = typeof block.text === 'string' ? block.text.trim() : '';
      if (text) {
        sections.push(`${block.label}:\n${text}`);
      }
    });

    if (collector.images.length > 0) {
      sections.push(`Images attached: ${collector.images.map((entry) => entry.label).join(', ')}`);
    }

    if (collector.warnings.length > 0) {
      sections.push(`Ignored items:\n- ${collector.warnings.join('\n- ')}`);
    }

    return {
      input: task.input,
      userText: sections.join('\n\n'),
      images: collector.images,
      warnings: collector.warnings
    };
  }

  async function normalizeRequest(rawRequest) {
    if (!rawRequest || typeof rawRequest !== 'object') {
      throw new Error('Request payload must be an object');
    }

    if (!rawRequest.agent || typeof rawRequest.agent !== 'string') {
      throw new Error('Request is missing a valid "agent" string');
    }

    if (!rawRequest.name || typeof rawRequest.name !== 'string') {
      throw new Error('Request is missing a valid "name" string');
    }

    const tasks = ensureTaskArray(rawRequest);
    if (tasks.length === 0) {
      throw new Error('Request does not contain any tasks');
    }

    const normalizedTasks = [];
    const warnings = [];

    for (let index = 0; index < tasks.length; index += 1) {
      const task = await normalizeTask(tasks[index], index);
      normalizedTasks.push(task);
      warnings.push(...task.warnings);
    }

    return {
      agent: rawRequest.agent,
      name: rawRequest.name,
      preferredModel: rawRequest.modelId || rawRequest.model || null,
      tasks: normalizedTasks,
      warnings
    };
  }

  function buildUserMessage(task) {
    if (!task.images || task.images.length === 0) {
      return {
        role: 'user',
        content: task.userText
      };
    }

    return {
      role: 'user',
      content: [
        { type: 'text', text: task.userText },
        ...task.images.map((image) => ({
          type: 'image_url',
          image_url: { url: image.url }
        }))
      ]
    };
  }

  global.RequestNormalizer = {
    normalizeRequest,
    buildUserMessage
  };
})(typeof self !== 'undefined' ? self : window);
