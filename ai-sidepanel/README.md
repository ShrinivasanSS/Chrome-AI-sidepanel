# AI Agent Side Panel Extension

Chrome side panel extension for sending structured and multimodal requests to an OpenAI-compatible backend.

## Current scope

- Global side panel on all sites using Manifest V3 and `<all_urls>`
- Three entry modes:
  - `Developer mode`: `Basic`, `Advanced`, and `API`
  - `User mode`: `Basic` only (with settings/history still available)
- Sidepanel input toggle for Basic/Advanced:
  - `Include Active Tab Content` (default: off)
  - `Include Cookies/Session` (default: on, trusted domains only)
- Sidepanel activity area has toggleable views:
  - `Current Tasks` (skill-runner queue + timers + expandable results)
  - `History` (stored conversation history)
- Multiformat request ingestion:
  - Legacy JSON request format
  - Base64/data-URL image payloads
  - Base64/data-URL ZIP payloads containing JSON, text, and images
- Local conversation history stored in extension-owned IndexedDB
- Settings stored in `chrome.storage.local`
- Multiple configured models with a selectable default model
- Storage usage display and `Clean Storage` action in settings
- Skills support from repository-hosted `.skill` packages with periodic background refresh

## Installation

1. Open `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `ai-sidepanel` folder

## Settings

Open the extension options page and configure:

- `Theme Mode` (`Light` or `Dark`)
- `Extension Mode` (`Developer` or `User`)
- `Trusted Session Domains` (whitelist for forwarding cookies/session storage to runner)
- `API Base URL`
- `API Key`
- One or more model entries
- `Default Model`
- Skills configuration:
  - `Repository Base URL` (directory listing containing `*.skill` files)
  - Enable/disable repository source
  - Auto-refresh toggle + interval (minutes)
  - Max skills applied per request
  - Enable/disable individual discovered skills (or all skills)
  - Manual `Refresh Skills Now` action
- Processing backend configuration:
  - `Target`: API or Skill Runner
  - `Skill Runner`: Claude / Copilot CLI / Cursor
  - `Runner Location`: Local (native host) or Remote URL
  - `Remote Runner URL`
  - `Native Host Name` (for local runner)
  - `Runner Timeout (ms)`

The extension migrates older single-model settings into the new model list automatically.

## Skills behavior

- Skills are loaded from the configured repository URL.
- The repository should list files ending with `.skill`.
- Each `.skill` file is a ZIP package that contains a standard skill folder structure (for example `SKILL.md`, `scripts/`, `references/`, `assets/`).
- Refresh cadence:
  - On extension startup
  - Periodically via `chrome.alarms` (default every 15 minutes)
  - Manual refresh from settings
- `skillsState` in local storage tracks:
  - `lastAttemptAt`
  - `lastSuccessAt`
  - source health/errors
  - catalog summary

`SKILL.md` parsing behavior:

- YAML frontmatter is parsed leniently
- Required fields are still enforced:
  - `name`
  - `description` (or inferred fallback from body text)
- Invalid skill documents are skipped with warnings instead of failing the whole refresh.

### Example repository layout

```
http://localhost/skills/repository/
  a1.skill
  b2.skill
```

Notes:
- The extension fetches the repository URL and discovers all links that end with `.skill`.
- Every discovered `.skill` package is downloaded and parsed for `SKILL.md`.

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

During request processing, relevant/selected skills are appended to the effective system prompt so the model can follow specialized instructions.

For sidepanel Basic and Advanced modes:
- If `Include Active Tab Content` is enabled, the request is enriched with current tab text/screenshot/metadata.
- If disabled (default), only the typed prompt/request payload is sent.
- If `Include Cookies/Session` is enabled, cookies are collected for all trusted domains and sent as per-domain payload.
- Active-tab local/session storage snapshots are only forwarded when the active tab itself is trusted.

## Skill runner flow

- If `Target = Skill Runner`, the extension bypasses API chat-completions calls.
- Skill-runner requests are queued in extension storage and return immediately with `jobId`.
- Queue states: `queued`, `running`, `completed`, `failed`, `timed_out`.
- Sidepanel polls queue status and shows wait/timeout timers in `Current Tasks`.
- In User mode, Basic prompt flow sends structured JSON context to runner host:
  - `runnerInput.userMessage` + `runnerInput.taskInput` (without bulky normalized cookie/tab blobs)
  - `runnerInput.sessionInfo` (cookies + storage snapshots)
  - `runnerInput.skills` (selected skill metadata)
  - `runnerInput.pageContent` (page text/headings/meta/links when enabled)
  - `runnerInput.activeTabInfo` (active tab metadata in separate JSON field)
  - `runnerInput.request` + `runnerInput.source` metadata
- Extension no longer builds a monolithic runner prompt string in skill-runner mode.
- Host payload includes:
  - `runner` (`claude`, `copilot`, `cursor`)
  - `promptArg` (runner-specific, for backward compatibility)
  - `runnerInput` (structured contract)
  - optional context metadata
- Skill launcher builds the final CLI prompt from `runnerInput` and injects session-aware usage guidance.
- Runner process env includes:
  - `SKILL_RUNNER_SESSION_INFO_JSON` (cookies + storage snapshot JSON for trusted domains)
  - `SKILL_RUNNER_SESSION_ALLOWED` (`1` if session forwarding is allowed)
  - `SKILL_RUNNER_ACTIVE_DOMAIN` (active tab hostname)
  - `SKILL_RUNNER_COOKIES` (cookie header for active domain)
  - `SKILL_RUNNER_REQUEST_HEADERS` (JSON request headers for active domain)
- Local runner mode:
  - uses `chrome.runtime.sendNativeMessage(...)`
  - requires an installed Native Messaging host that launches the actual CLI binary
- Remote runner mode:
  - POSTs JSON to configured runner URL
  - expects a text response or JSON containing `output`
- Runner argument mapping:
  - Claude: `--print`
  - Copilot: `--prompt`
  - Cursor: `agent -p`

Reference implementation:
- `skill-launcher/` contains a compatible backend app with:
  - HTTP server (`POST /run`, `POST /update-skills`, `GET /health`)
  - Native Messaging mode for local CLI execution

Skill sync trigger behavior:
- On `Save Settings` and `Refresh Skills` in extension settings, backend launcher `update-skills` is also invoked so runner-local skills are refreshed immediately.

## Local storage

The extension stores data only in extension-owned browser storage:

- `IndexedDB`: full conversation input/output history
- `chrome.storage.local`: settings, current API session, current mode, and storage usage metrics
  - Includes `extensionMode`, `skillsConfig`, and `skillsState`

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
