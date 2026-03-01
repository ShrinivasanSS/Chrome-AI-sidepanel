# AI Agent Side Panel Extension

Chrome side panel extension for sending structured and multimodal requests to an OpenAI-compatible backend.

## Current scope

- Global side panel on all sites using Manifest V3 and `<all_urls>`
- Three entry modes:
  - `Basic`: capture current tab text plus screenshot
  - `Advanced`: paste request JSON directly
  - `API`: receive requests from regular web pages or the JSP sample app
- Multiformat request ingestion:
  - Legacy JSON request format
  - Base64/data-URL image payloads
  - Base64/data-URL ZIP payloads containing JSON, text, and images
- Local conversation history stored in extension-owned IndexedDB
- Settings stored in `chrome.storage.local`
- Multiple configured models with a selectable default model
- Storage usage display and `Clean Storage` action in settings

## Installation

1. Open `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `ai-sidepanel` folder

## Settings

Open the extension options page and configure:

- `API Base URL`
- `API Key`
- One or more model entries
- `Default Model`

The extension migrates older single-model settings into the new model list automatically.

## Supported request formats

### Legacy JSON

```json
{
  "agent": "You are a helpful assistant.",
  "name": "TEXT_ANALYZER",
  "params": [
    {
      "input": "Summarize this text",
      "data": "Plain text data",
      "supplements": ["concise", "structured"]
    }
  ]
}
```

### Image payloads

```json
{
  "agent": "Analyze the supplied screenshots.",
  "name": "PHOTO_ANALYZER",
  "params": [
    {
      "input": "Compare the screenshots",
      "data": "Describe the important differences.",
      "supplements": [
        {
          "type": "image_base64",
          "mediaType": "image/png",
          "fileName": "trends.png",
          "data": "data:image/png;base64,..."
        }
      ]
    }
  ]
}
```

### ZIP payloads

```json
{
  "agent": "Review the extracted package.",
  "name": "ZIP_ANALYZER",
  "params": [
    {
      "input": "Analyze the ZIP package",
      "data": {
        "type": "zip",
        "fileName": "sample-json-screenshots.zip",
        "data": "data:application/zip;base64,..."
      },
      "supplements": [
        "Ignore unsupported files"
      ]
    }
  ]
}
```

ZIP processing behavior:

- Supported entries are JSON, plain text, markdown, CSV, and common image formats
- JSON/text files are converted into text blocks
- Images are converted into `image_url` content blocks
- Unsupported entries are skipped and noted as warnings instead of failing the full request

## Backend request shape

The extension always sends OpenAI-compatible chat completion requests:

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    { "role": "system", "content": "Agent instructions" },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Task: ..." },
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
      ]
    }
  ]
}
```

If a task has no images, the user message is sent as plain text.

## Local storage

The extension stores data only in extension-owned browser storage:

- `IndexedDB`: full conversation input/output history
- `chrome.storage.local`: settings, current API session, current mode, and storage usage metrics

The `Clean Storage` button removes stored conversation history and the active API session snapshot.

## External page integration

Any regular page can trigger the extension by dispatching:

```js
document.dispatchEvent(new CustomEvent('ai-sidepanel-api-call', {
  detail: requestObject
}));
```

The content script forwards progress and results back as:

- `ai-sidepanel-response`
- `ai-sidepanel-status`

## Included demos

- Vanilla HTML demo: `tests/vanila-html/api-test-page.html`
- JSP demo container: `tests/jsp-sidepanel-sample`

## Notes

- The service worker now performs API processing, so API-page requests can complete even if the side panel is only being used as a viewer for history/current session state.
- No automated test command is run by the agent for this project. Human verification should be recorded in `Progress.md`.
