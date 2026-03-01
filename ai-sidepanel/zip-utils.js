(function(global) {
  'use strict';

  const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
  const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'log']);
  const JSON_EXTENSIONS = new Set(['json']);

  function readUint16(view, offset) {
    return view.getUint16(offset, true);
  }

  function readUint32(view, offset) {
    return view.getUint32(offset, true);
  }

  function stripWhitespace(value) {
    return value.replace(/\s+/g, '');
  }

  function parseDataUrl(value) {
    const match = /^data:([^;]+);base64,(.+)$/i.exec(value || '');
    if (!match) {
      return null;
    }

    return {
      mediaType: match[1],
      base64: match[2]
    };
  }

  function base64ToUint8Array(base64) {
    const binary = atob(stripWhitespace(base64));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function uint8ArrayToBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  }

  function uint8ArrayToDataUrl(bytes, mediaType) {
    return `data:${mediaType};base64,${uint8ArrayToBase64(bytes)}`;
  }

  function getExtension(fileName) {
    const cleanName = fileName.split('/').pop() || fileName;
    const segments = cleanName.split('.');
    return segments.length > 1 ? segments.pop().toLowerCase() : '';
  }

  function getMediaType(fileName) {
    const extension = getExtension(fileName);
    switch (extension) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      case 'bmp':
        return 'image/bmp';
      case 'json':
        return 'application/json';
      case 'md':
        return 'text/markdown';
      case 'csv':
        return 'text/csv';
      case 'txt':
      case 'log':
      default:
        return 'text/plain';
    }
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('ZIP deflate support is unavailable in this browser context');
    }

    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  function findEndOfCentralDirectory(bytes) {
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
      if (
        bytes[offset] === 0x50 &&
        bytes[offset + 1] === 0x4b &&
        bytes[offset + 2] === 0x05 &&
        bytes[offset + 3] === 0x06
      ) {
        return offset;
      }
    }

    throw new Error('ZIP end-of-central-directory record not found');
  }

  async function decodeEntryData(compressionMethod, compressedBytes) {
    if (compressionMethod === 0) {
      return compressedBytes;
    }

    if (compressionMethod === 8) {
      return inflateRaw(compressedBytes);
    }

    throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
  }

  async function readZipEntries(input) {
    const bytes = coerceToBytes(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEndOfCentralDirectory(bytes);
    const entryCount = readUint16(view, eocdOffset + 10);
    const centralDirectoryOffset = readUint32(view, eocdOffset + 16);
    const entries = [];
    let offset = centralDirectoryOffset;

    for (let index = 0; index < entryCount; index += 1) {
      const signature = readUint32(view, offset);
      if (signature !== 0x02014b50) {
        throw new Error('Invalid ZIP central directory signature');
      }

      const compressionMethod = readUint16(view, offset + 10);
      const compressedSize = readUint32(view, offset + 20);
      const fileNameLength = readUint16(view, offset + 28);
      const extraLength = readUint16(view, offset + 30);
      const commentLength = readUint16(view, offset + 32);
      const localHeaderOffset = readUint32(view, offset + 42);
      const fileNameBytes = bytes.slice(offset + 46, offset + 46 + fileNameLength);
      const fileName = new TextDecoder().decode(fileNameBytes);

      offset += 46 + fileNameLength + extraLength + commentLength;

      if (fileName.endsWith('/')) {
        continue;
      }

      const localSignature = readUint32(view, localHeaderOffset);
      if (localSignature !== 0x04034b50) {
        throw new Error('Invalid ZIP local file header signature');
      }

      const localNameLength = readUint16(view, localHeaderOffset + 26);
      const localExtraLength = readUint16(view, localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressedBytes = bytes.slice(dataStart, dataStart + compressedSize);
      const decodedBytes = await decodeEntryData(compressionMethod, compressedBytes);

      entries.push({
        fileName,
        bytes: decodedBytes,
        mediaType: getMediaType(fileName)
      });
    }

    return entries;
  }

  function decodeText(bytes) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  async function extractSupportedEntries(input) {
    const zipEntries = await readZipEntries(input);
    const supported = [];
    const warnings = [];

    zipEntries.forEach((entry) => {
      const extension = getExtension(entry.fileName);

      if (IMAGE_EXTENSIONS.has(extension)) {
        supported.push({
          kind: 'image',
          fileName: entry.fileName,
          mediaType: entry.mediaType,
          dataUrl: uint8ArrayToDataUrl(entry.bytes, entry.mediaType)
        });
        return;
      }

      if (JSON_EXTENSIONS.has(extension)) {
        const rawText = decodeText(entry.bytes);
        try {
          supported.push({
            kind: 'json',
            fileName: entry.fileName,
            mediaType: entry.mediaType,
            rawText,
            value: JSON.parse(rawText)
          });
        } catch (error) {
          supported.push({
            kind: 'text',
            fileName: entry.fileName,
            mediaType: 'text/plain',
            rawText
          });
          warnings.push(`Parsed ${entry.fileName} as plain text because JSON parsing failed.`);
        }
        return;
      }

      if (TEXT_EXTENSIONS.has(extension)) {
        supported.push({
          kind: 'text',
          fileName: entry.fileName,
          mediaType: entry.mediaType,
          rawText: decodeText(entry.bytes)
        });
        return;
      }

      warnings.push(`Ignored unsupported ZIP entry: ${entry.fileName}`);
    });

    return {
      entries: supported,
      warnings
    };
  }

  function coerceToBytes(input) {
    if (input instanceof Uint8Array) {
      return input;
    }

    if (input instanceof ArrayBuffer) {
      return new Uint8Array(input);
    }

    if (typeof input === 'string') {
      const parsedDataUrl = parseDataUrl(input);
      if (parsedDataUrl) {
        return base64ToUint8Array(parsedDataUrl.base64);
      }

      return base64ToUint8Array(input);
    }

    if (input && typeof input === 'object') {
      if (input.data) {
        return coerceToBytes(input.data);
      }
      if (input.base64) {
        return coerceToBytes(input.base64);
      }
    }

    throw new Error('Unsupported binary input format');
  }

  function normalizeImageData(input, fallbackMediaType) {
    if (typeof input === 'string') {
      const parsedDataUrl = parseDataUrl(input);
      if (parsedDataUrl) {
        return {
          mediaType: parsedDataUrl.mediaType,
          dataUrl: input
        };
      }

      return {
        mediaType: fallbackMediaType || 'image/png',
        dataUrl: `data:${fallbackMediaType || 'image/png'};base64,${stripWhitespace(input)}`
      };
    }

    if (input && typeof input === 'object') {
      const mediaType = input.mediaType || fallbackMediaType || 'image/png';
      if (input.dataUrl) {
        return normalizeImageData(input.dataUrl, mediaType);
      }
      if (input.base64) {
        return normalizeImageData(input.base64, mediaType);
      }
      if (input.data) {
        return normalizeImageData(input.data, mediaType);
      }
    }

    throw new Error('Unsupported image payload');
  }

  global.ZipUtils = {
    parseDataUrl,
    coerceToBytes,
    normalizeImageData,
    extractSupportedEntries
  };
})(typeof self !== 'undefined' ? self : window);
