# Tracking feature requests and progress. 

The features given by human, will be noted by Ai to track the progress. Once the AI has updated the progress, a human would verify the results and update here. 

## Date - 01/Mar/2026

### Human Review comments 

Tested functionalities
- [x] Test Pages for Vanila and JSP 
- [x] Accepts Photos, Zip and JSON
- [x] Responses rendered in the test pages to satisfaction
- [x] Planned feature set from `Todo.md` is considered complete

Bugs found
- [ ] Extension view not refreshed automatically. It loads the responses only when closing and re-opening the side panel. 

Testing status
- Testing is ongoing
- Additional bugs will be filed separately with detailed analysis and fix notes later

### AI generated updates

#### Proposed checklist for Todo.md implementation

Reference baseline:
- Existing project pattern: `reference-extension-samples/functional-samples/cookbook.sidepanel-global`
- User-gesture/opening behavior constraint: `reference-extension-samples/functional-samples/cookbook.sidepanel-open`

Assumptions for implementation:
- "Storage in the extension's own directory" will be implemented as extension-owned local persistence, not writes into the unpacked source folder. Planned split is: conversation payload history in IndexedDB, lightweight settings/usage metadata in `chrome.storage.local`.
- Optional Todo items will stay out of the first pass unless human review asks to include them now.
- Unsupported uploaded entries inside ZIP payloads will be skipped without failing the full request, matching the Todo note.

Planned work items:
- [x] Add a normalized request ingestion layer in `ai-sidepanel` so advanced mode and API mode both accept JSON, image payloads, base64 image payloads, and ZIP payloads.
- [x] Parse ZIP uploads locally in the extension, extract supported JSON/text/image files, and convert them into OpenAI-compatible `messages` content blocks with text in `text` segments and images in `image_url` segments.
- [x] Preserve current JSON request compatibility while relaxing validation to ignore unsupported file entries instead of throwing.
- [x] Refactor AI request assembly so the side panel can submit multimodal payloads from a single shared pipeline.
- [x] Add persistent conversation/output history storage using extension-local persistence and track estimated storage usage separately.
- [x] Expand settings to support multiple configured models, a selectable default model, a storage-usage display, and a "Clean Storage" action.
- [x] Update side panel UI to surface stored history and keep API/basic/advanced flows working with the new persistence model.
- [x] Update `tests/vanila-html` to send the new payload shapes and render returned results for JSON, image, and ZIP-based requests.
- [x] Create a containerized sample JSP app under `tests` with at least `Analyze Photos` and `Analyze Zip` pages wired to the extension API, using the sample assets already present in `tests/example-inputs`.
- [x] Update `ai-sidepanel/README.md` with the new request formats, storage behavior, settings options, and test-page/JSP usage notes.
- [x] Add implementation findings and non-obvious Chrome extension constraints to `Agent-Notes.md`.

Status:
- Implementation completed by AI on 01/Mar/2026.
- Human review confirms the requested feature set is complete.
- Testing is ongoing for follow-up bug discovery.
- No test command was run by the AI, per repo instruction.

#### Compose test harness updates

- [x] Add a single compose project under `tests/` with `gateway`, `vanilla`, and `jsp` services.
- [x] Add a front-door nginx gateway with path-based routing for `/`, `/vanilla/`, and `/jsp/`.
- [x] Serve the vanilla test app through a dedicated nginx service with shared read-only mounts for `tests/example-inputs`.
- [x] Adapt the JSP container workflow so shared test assets are mounted by compose instead of duplicated per service image.
- [x] Update the vanilla page asset resolution so it works correctly when served from `http://localhost:8080/vanilla/`.
- [x] Update test documentation for the compose-based workflow.

Compose harness status:
- Implementation completed by AI on 01/Mar/2026.
- Human verification confirms the compose harness is usable for current test flows.
- Testing is ongoing and additional bug reports will be documented later.
- The AI did not run `docker compose` or any package test command, per repo instruction.

## Date - 19/Mar/2026

### AI generated updates

#### Proposed checklist for latest Todo.md implementation (Skills + Modes)

Reference baseline:
- `reference-extension-samples/functional-samples/cookbook.sidepanel-global`
- `reference-extension-samples/functional-samples/cookbook.sidepanel-open`

Assumptions/defaults:
- Hybrid skills source: repository endpoint + ZIP build endpoint.
- Default ZIP endpoint: `http://localhost/skills/latest.zip`.
- Skills refresh cadence: startup + every 15 minutes.
- User mode hides `Advanced` and `API` tabs but keeps basic chat, settings, and history.
- API/event processing remains active in background for both extension modes.

Planned work items:
- [x] Add `SkillsManager` and integrate it into request lifecycle so relevant skills are injected into agent/system context.
- [x] Add repository + ZIP loaders for skills, with lenient `SKILL.md` parsing and deterministic dedupe (ZIP overrides repository on name collisions).
- [x] Persist runtime skills catalog/state (`skillsConfig`, `skillsState`) and expose status for UI.
- [x] Add periodic refresh scheduling (startup + `chrome.alarms` every 15 minutes) and preserve last-good catalog when a refresh fails.
- [x] Extend settings page to configure `extensionMode` (`developer|user`) and skills source/update options, including manual refresh action.
- [x] Gate sidepanel UI by extension mode: Developer shows `Basic/Advanced/API`; User shows only basic flow plus settings/history.
- [x] Keep external page API integration events unchanged (`ai-sidepanel-api-call`, `ai-sidepanel-response`, `ai-sidepanel-status`).
- [x] Update `ai-sidepanel/README.md` for skills support + mode behavior.
- [x] Add non-obvious implementation findings to `Agent-Notes.md`.

Status:
- Implementation completed by AI on 19/Mar/2026.
- No automated test command will be run by AI, per repo instruction.

#### Follow-up update - Repository `.skill` format

Requested change:
- Switch skills repository ingestion to directory-style `.skill` packages (`repositoryUrl/*.skill`).
- Remove separate skills ZIP source config.
- Add UI controls to enable/disable discovered skills individually, plus enable-all/disable-all.

Completed:
- [x] Refactor repository loader to discover `.skill` links from repository listing and parse each zip package for `SKILL.md`.
- [x] Remove ZIP source settings from config and UI.
- [x] Add per-skill toggles in settings (with enable-all/disable-all), persisted via `skillsConfig.disabledSkillNames`.
- [x] Apply only enabled skills during request-time skill selection.
- [x] Update `ai-sidepanel/README.md` to document `.skill` repository layout.

#### Follow-up update - Skill Runner backend

Requested change:
- Add runner backend options: Claude / Copilot CLI / Cursor.
- Add local vs remote runner mode and bypass API when runner backend is selected.
- In User mode basic flow, pass page cookies and page data via prompt contract.

Completed:
- [x] Add `runnerConfig` settings schema (`processingTarget`, `runnerType`, `runnerMode`, `remoteUrl`, `nativeHostName`, `timeoutMs`).
- [x] Extend settings UI with processing backend and runner configuration controls.
- [x] Add service worker runner execution path that bypasses API when `processingTarget=skill-runner`.
- [x] Implement remote runner HTTP invocation and local runner native-messaging invocation.
- [x] Include page cookies/page data in basic prompt context and forward to runner using `promptArg: --prompt`.
- [x] Update `README.md` with skill-runner integration flow and prerequisites.

#### Follow-up update - `skill-launcher` app

Requested change:
- Create a launcher app in `skill-launcher/` compatible with extension runner design.
- Support running as remote service and local-native host.
- Receive config, update/sync skills in backend, run runner, return output to extension.

Completed:
- [x] Add `skill-launcher/app.py` entrypoint with `--mode remote|native`.
- [x] Add shared launcher core to sync `.skill` packages from repository and execute CLI runner commands.
- [x] Add remote HTTP endpoints (`/run`, `/update-skills`, `/health`).
- [x] Add Native Messaging loop compatible with `chrome.runtime.sendNativeMessage`.
- [x] Update extension runner payload to include `skillsConfig` and selected-skill context.
- [x] Add launcher docs in `skill-launcher/README.md`.

#### Follow-up update - Local runner folders and workdir

Requested change:
- Use local runner-specific skill folders within `skill-launcher` root.
- Run CLI commands in launcher working directory.

Completed:
- [x] Sync skills into `skill-launcher/.claude/skills`, `skill-launcher/.copilot/skills`, and `skill-launcher/.cursor/skills`.
- [x] Store runner state next to each runner folder (`skills-state.json`).
- [x] Execute runner commands with `cwd=skill-launcher` root.
- [x] Update launcher docs and ignore generated local runner folders in `.gitignore`.

#### Follow-up update - Runner prompt args and prompt content

Requested change:
- Runner-specific prompt arguments (`claude --print`, `copilot --prompt`, `cursor agent -p`).
- Do not embed full skill content into runner prompt when skills are already synced.

Completed:
- [x] Update launcher command templates for Claude/Copilot/Cursor.
- [x] Update extension runner payload to send runner-appropriate `promptArg`.
- [x] Use base agent prompt for runner flow (no injected skill body), while keeping selected skill metadata in context.

#### Follow-up update - Include Active Tab Content toggle

Requested change:
- Add option in sidepanel Basic/Advanced input flow to include active tab content or not.
- Default should be disabled.

Completed:
- [x] Add `Include Active Tab Content` toggle in sidepanel UI (default OFF).
- [x] Persist toggle state in `chrome.storage.local` (`includeTabContent`).
- [x] Basic mode: when ON, capture and include active tab context; when OFF, send only typed prompt.
- [x] Advanced mode: when ON, enrich tasks with active tab content and metadata; when OFF, send JSON as-is.

#### Follow-up update - Theme + skill sync refinements

Requested change:
- Restore dark/light theme switching.
- Flatten copied skill folders under runner skill roots.
- Invoke backend skill launcher refresh on settings save and manual refresh.

Completed:
- [x] Add theme mode setting (`light`/`dark`) and apply theme in settings + sidepanel pages.
- [x] Persist theme in extension settings storage.
- [x] Flatten `.skill` extraction to `./<runner>/skills/<skillname>/...` so runners discover `SKILL.md` correctly.
- [x] Invoke launcher `update-skills` from extension service worker during `settings-updated` and `refresh-skills` flows.

#### Follow-up update - Trusted session forwarding controls

Requested change:
- Add separate sidepanel controls for page content and cookies/session forwarding.
- Add trusted-domain whitelist in settings for session forwarding.
- Pass trusted session payload to runner environment.

Completed:
- [x] Add `Trusted Session Domains` setting and persist whitelist.
- [x] Add separate sidepanel toggle for `Include Cookies/Session` (default ON) in addition to page-content toggle.
- [x] Enforce trusted-domain check before forwarding cookies/session snapshots.
- [x] Capture localStorage/sessionStorage snapshots from active tab and include when allowed.
- [x] Export runner env var `SKILL_RUNNER_SESSION_INFO` before launching runner command.

#### Follow-up update - Skill launcher verbose logging

Requested change:
- Add verbose mode to skill-launcher that logs incoming requests, runner env, and outputs to a file.

Completed:
- [x] Add verbose logging support in launcher core with JSONL log events.
- [x] Log request lifecycle events: incoming payloads, skills sync results, runner invocation, runner success/failure outputs.
- [x] Add CLI options `--verbose` and `--log-file` in `skill-launcher/app.py`.
- [x] Wire verbose/log file options into both remote server and native messaging host modes.
- [x] Document verbose mode usage and logged events in `skill-launcher/README.md`.

## Date - 20/Mar/2026

### AI generated updates

#### Proposed checklist - Structured runner payload + launcher-side context assembly

Requested change:
- In skill-runner mode, stop flattening all context into one text prompt in extension.
- Send structured JSON payload to skill-launcher (user message, session info, selected skills, page content, metadata).
- Build final runner prompt/context in skill-launcher and set cookie/session env there.
- Include explicit instructions for using session details via env cookies (for curl/playwright style usage).

Planned work items:
- [x] Define a stable structured contract for runner invocation payload (extension -> launcher), including `userMessage`, `sessionInfo`, `pageContent`, `source`, and `skills`.
- [x] Refactor `ai-sidepanel/service-worker.js` runner path to send structured payload fields in skill-runner mode instead of pre-composed monolithic prompt text.
- [x] Update `skill-launcher` request parsing to accept the structured payload for both remote and native flows.
- [x] Move prompt assembly logic into launcher core so runner-specific prompt text is generated server-side.
- [x] Ensure launcher sets/extends session env variables from structured session payload (including cookies header/json and storage snapshots) before invoking Claude/Copilot/Cursor.
- [x] Add default runner instructions in launcher prompt assembly to guide use of env session details for authenticated curl/playwright operations.
- [x] Keep non skill-runner API mode behavior unchanged.
- [x] Update `ai-sidepanel/README.md` and `skill-launcher/README.md` to document the structured runner contract and launcher-built context behavior.
- [x] Add implementation notes/edge cases discovered during this refactor to `Agent-Notes.md`.

## Date - 22/Mar/2026

### AI generated updates

#### Proposed checklist - Skill Runner Reliability + Task Queue + Multi-Domain Cookie Env Mapping

Requested change:
- Replace long-lived skill-runner request waiting with queued job processing in extension.
- Add current-task queue UX with timeout countdown and collapsible results.
- Forward cookies for all trusted domains with domain-specific env var mapping in runner.
- Add launcher-side queued execution with file-backed output artifacts and task status APIs.

Planned work items:
- [x] Add skill-runner queue lifecycle storage in extension (`queued`, `running`, `completed`, `failed`, `timed_out`) with timestamps and timeout metadata.
- [x] Refactor service worker `process-request` path to return immediate `accepted + jobId` for skill-runner requests and process queue asynchronously (FIFO, single worker).
- [x] Add runtime commands for queue consumers (`get-runner-jobs`, `get-runner-job`, optional cancel placeholder).
- [x] Update sidepanel UI with `Current Tasks` vs `History` toggle view, queue list, elapsed/wait timer, timeout countdown, and expandable completed task results.
- [x] Move existing history list into the toggleable `History` view without losing prior history behavior.
- [x] Add runner cookie env mapping setting (`domain=ENV_VAR`) with normalized persistence (`runnerCookieEnvMap`) and auto-domain defaults.
- [x] Extend tab/session capture to include cookies across all trusted domains and pass `cookiesByDomain`/`cookieHeadersByDomain` in runner payload.
- [x] Update skill-launcher to enqueue tasks, run from queue, persist per-task files (`stdout`, `stderr`, metadata/result), and expose task status/result endpoints for remote/native modes.
- [x] Export per-domain cookie env vars before runner launch, preserving existing `SKILL_RUNNER_SESSION_INFO` contract.
- [x] Update `ai-sidepanel/README.md`, `skill-launcher/README.md`, and add implementation findings to `Agent-Notes.md`.

Status:
- Implementation completed by AI on 22/Mar/2026.
- Human validation pending.

## Date - 13/Apr/2026

### AI generated updates

#### Feature implementation — Global/Tab-wise sidepanel + History page + Cline continuation

Requested changes:
1. Extension option to select global vs tab-wise sidepanel (default: Global).
2. Tab-wise sidepanel with per-tab chat isolation; history moved to standalone page.
3. Cline task continuation support via `RUNNER_CONTINUE_COMMANDS` map.

Planned work items:
- [x] **Feature 1: Side Panel Mode setting** — Add `sidePanelMode` (`global`/`tab`) to storage-utils, settings page, and service worker. In tab mode, `chrome.sidePanel.setOptions` is called per-tab on `tabs.onUpdated`/`tabs.onActivated`.
- [x] **Feature 2a: Tab-wise chat isolation** — In tab mode, detect current tab ID, persist `chatMessages` per tab in `chrome.storage.local` (key: `chatMessages_<tabId>`). Clean up storage on tab close via `tabs.onRemoved`.
- [x] **Feature 2b: History page** — Create standalone `history.html`/`history.js` page (styled like settings page) with full history list, formatted/raw toggle, clear history, and storage metrics. Sidepanel "History" button now opens this page in a new tab instead of inline rendering.
- [x] **Feature 3: Cline task continuation** — Add `DEFAULT_RUNNER_CONTINUE_COMMANDS` map in `launcher_core.py` with Cline template: `cline -v --yolo -T {taskId} {prompt}`. Add `_build_continue_command`, `_extract_runner_task_id`, and `_supports_continuation` methods. `_run_payload` checks for `continueTaskId` in payload and uses continue command when available. First task's stdout is parsed to extract the Cline task ID (returned as `runnerTaskId` in result).
- [x] **Runner type fix** — Added `cline` to the allowed `runnerType` list in `normalizeRunnerConfig` in `storage-utils.js`.

Files created:
- `ai-sidepanel/history.html` — Standalone history page
- `ai-sidepanel/history.js` — History page logic

Files modified:
- `ai-sidepanel/storage-utils.js` — Added `sidePanelMode`, `DEFAULT_SIDEPANEL_MODE`, `normalizeSidePanelMode`, cline in runner types
- `ai-sidepanel/settings.html` — Added Side Panel Mode dropdown
- `ai-sidepanel/settings.js` — Save/load `sidePanelMode`
- `ai-sidepanel/service-worker.js` — Tab-wise panel mode, `applySidePanelMode`, tab listeners, per-tab chat cleanup
- `ai-sidepanel/sidepanel.js` — Tab-scoped chat state, `loadTabChatMessages`/`saveTabChatMessages`, history button opens page
- `skill-launcher/launcher_core.py` — `DEFAULT_RUNNER_CONTINUE_COMMANDS`, continuation support in `_run_payload`, task ID extraction

Status:
- Implementation completed by AI on 13/Apr/2026.
- Human validation pending.

---

#### README update — sync docs with implemented features

Scope:
- Reviewed all features implemented since the last README update (Apr 5–9, 2026 entries in Progress.md).
- Updated both `README.md` (root) and `ai-sidepanel/README.md` to reflect the current state of the extension.

Changes made:

**Root `README.md`**
- [x] Added "Default Chat Mode" and "Vision" checkbox to Quick Start > Configure settings steps.
- [x] Added "Additional Instructions", "Include Screenshot", and "Default Chat Mode" bullets under Features > Chat Interface.
- [x] Added full-page screenshot tile capture bullet to Features > Multimodal Input.
- [x] Added page context extraction (UserID, UniqueID, timezone) bullet to Features > Skill Runner.

**`ai-sidepanel/README.md`**
- [x] Added `Additional Instructions` and `Include Screenshot` items to Current Scope > Sidepanel input toggles.
- [x] Added `Vision` checkbox description and `Default Chat Mode` setting to the Settings section.
- [x] Added "Additional Instructions" and "Include Screenshot" bullet points to Chat UI features section.
- [x] Added `runnerInput.additionalInstructions` to the runner input contract list in Skill runner flow.
- [x] Added new "Page context extraction" subsection documenting URL/page-text scanning, extracted fields, and `SKILL_RUNNER_ADDITIONAL_INSTRUCTIONS` env var behavior.

Status:
- Documentation update completed by AI on 13/Apr/2026.
- No code changes were made.

## Date - 09/Apr/2026

### AI generated updates

#### Proposed checklist - Additional Instructions field + Page context extraction in skill-launcher

Requested change:
- When active page content is passed from the extension, pass the loaded page URL and formatted content (not raw HTML) — already done via `pageText` field.
- The skill-launcher should pre-process the URL and page content to extract information like UserID, UniqueID, and timezone (if present), and add these to the default instruction of the skill launcher.
- The extension should have an additional instructions text input field, and that shall be passed along with the request info.
- The skill launcher shall process the additional instructions from extension along with the user info.

Planned work items:
- [x] Add "Additional Instructions" textarea in `sidepanel.html` below the existing toggles in the Input Context section.
- [x] In `sidepanel.js`, read the additional instructions field and attach to `source.additionalInstructions` before sending to service worker.
- [x] In `service-worker.js` `buildRunnerInput()`, extract `additionalInstructions` from `source` and include it as a top-level field in the runner input payload.
- [x] In `launcher_core.py` `_export_structured_env()`, export `SKILL_RUNNER_ADDITIONAL_INSTRUCTIONS` env var when present.
- [x] Add `_extract_page_context_info(url, page_text)` method in `launcher_core.py` that extracts UserID, UniqueID, and timezone from URL query params and page content text using regex patterns.
- [x] Update `_build_prompt_from_runner_input()` in `launcher_core.py` to include extracted user context (UserID, UniqueID, timezone) and additional instructions as labelled sections in the CLI prompt.

Status:
- Extension-side changes (sidepanel.html, sidepanel.js, service-worker.js) completed by AI on 09/Apr/2026.
- launcher_core.py env var export (`SKILL_RUNNER_ADDITIONAL_INSTRUCTIONS`) completed by AI on 09/Apr/2026.
- Code snippets for `_extract_page_context_info` and updated `_build_prompt_from_runner_input` provided to human for manual application.
- Human validation pending.

## Date - 05/Apr/2026

### AI generated updates

#### Proposed checklist - Chat Mode (default) with Skill Mode fallback

Requested change:
- Add a Chat Mode (default) where the user sees a chat bar with input box and conversational chat messages.
- When mode is "chat", messages are sent to the backend in OpenAI/Anthropic compatible format (multi-turn `messages` array with `system`, `user`, `assistant` roles) with current page info in the system message. Works like a regular chatbot.
- When mode is "skill" (the existing behavior), the chat still displays in the same chat UI, but behind the scenes it launches the skill launcher. When the user sends follow-up messages, the context is passed as a concatenated string: `User - "USER_MESSAGE#1"\nRUNRESULT#1\n\nUser - "USER_MESSAGE#2"` so the runner sees the full conversation history.
- The "Basic" mode becomes the chat view. The mode toggle (Chat vs Skill) determines backend routing.
- Chat history (messages) is stored per-session in memory and optionally persisted.

Assumptions/defaults:
- The existing Basic mode UI is replaced by a chat-style interface (message bubbles, input bar at bottom).
- A toggle switch in the chat area lets users pick "Chat" or "Skill" mode. Default is configurable in settings (default: "chat").
- In Chat mode, the extension sends the full `messages` array to the OpenAI-compatible API endpoint each turn, maintaining proper multi-turn conversation.
- In Skill mode, each user message triggers the existing skill-runner flow, but with accumulated conversation context concatenated into the input string.
- The Advanced and API tabs remain available in developer mode, unchanged.
- Page context (URL, title, optionally page content) is included in the system message for Chat mode or in the runner payload for Skill mode — respecting the existing `includeTabContent` toggle.

Planned work items:
- [x] **Chat UI**: Replace the Basic mode's textarea+button with a chat interface: scrollable message area (user/assistant bubbles), input bar with send button at the bottom, and a Chat/Skill mode toggle.
- [x] **Chat Mode toggle**: Add a "Chat" / "Skill" toggle in the chat area header. Persist selected chat mode in `chrome.storage.local`. Add default chat mode setting in Settings page.
- [x] **Chat message state**: Maintain an in-memory `chatMessages` array (role/content pairs) for the current session. Clear on explicit "New Chat" action.
- [x] **Chat Mode backend**: When in Chat mode, build OpenAI-compatible `messages` array (system message with page context + conversation history) and send via the existing `callAi` path through the service worker. Display streamed/returned assistant response as a new chat bubble.
- [x] **Skill Mode backend**: When in Skill mode, concatenate conversation history into a single string format (`User - "msg1"\nRUNRESULT1\n\nUser - "msg2"`) and send as the task input through the existing skill-runner or API processing path. Display the result as an assistant bubble.
- [x] **Service worker changes**: Add a new `chat-message` command that accepts the full messages array (for chat mode) or the concatenated context string (for skill mode) and routes to the appropriate backend. Return the assistant response.
- [x] **CSS styling**: Chat bubbles (user right-aligned, assistant left-aligned), input bar fixed at bottom of chat area, auto-scroll to latest message.
- [x] **Settings integration**: Add "Default Chat Mode" dropdown (Chat/Skill) in settings page. Wire into `StorageUtils` and settings save/load.
- [x] **Update README.md, Progress.md, Agent-Notes.md** with chat mode documentation.

Status:
- Implementation completed by AI on 05/Apr/2026.
- Human validation pending.

#### Follow-up update - Vision-capable model hint + Include Screenshot button

Requested change:
- Add a "Vision capable" checkbox per model in Settings so the user can hint which models support image input.
- If the currently selected model is vision-capable, show an "Include Screenshot" button in the sidepanel chat area.
- When clicked, capture a full-page screenshot, split it into 1280×720 chunks (to preserve quality), and include the chunks as `image_url` base64 entries in the chat `messages` array.
- Only send screenshot once per URL (don't resend on successive messages unless the tab URL changed).

Planned work items:
- [x] Add `vision` boolean to model settings row (checkbox). Persist alongside `label`/`value`.
- [x] Expose `vision` in `collectModels`, `renderModelRow`, `normalizeModelEntry`, and settings save/load.
- [x] In sidepanel, check if selected model has `vision: true`. If so, show "Include Screenshot" toggle/button in the input context area.
- [x] When enabled, capture full-page screenshot via `chrome.tabs.captureVisibleTab()`, split into 1280×720 tile chunks using an offscreen canvas, and store the base64 tiles.
- [x] Track last-screenshot URL. Only re-capture when the active tab URL changes.
- [x] In Chat mode: append image tiles as `image_url` content blocks in the user message (first turn or when URL changes).
- [ ] In Skill mode: include screenshot tiles in the source/context payload. *(deferred — skill runner does not consume image_url)*
- [ ] Update README.md and Agent-Notes.md. *(partial — can be updated after human verification)*

Status:
- Implementation completed by AI on 05/Apr/2026.
- Human validation pending.

## Date - 07/Apr/2026

### AI generated updates

#### Bug fix - Restore per-domain cookie env exports + session logging

Root cause analysis:
- The `service-worker.js` `buildRunnerInput()` function was not passing cookie data (`cookies`, `cookieHeader`, `cookiesByDomain`, `cookieHeadersByDomain`, `cookieEnvMap`) through to the launcher's `sessionInfo` object. It used a simplified `domains` structure that the launcher couldn't consume.
- The `callSkillRunner()` function was not injecting `runnerCookieEnvMap` from settings into the context.
- The `launcher_core.py` was missing the `_export_domain_cookie_envs()` method for per-domain env var exports, `_normalize_env_name()` helper, and the `SKILL_RUNNER_COOKIE_HEADER` / `SKILL_RUNNER_COOKIES_JSON` / `SKILL_RUNNER_REQUEST_HEADERS_JSON` env var exports.
- Session log keys in `_run_payload` were referencing simplified env var names instead of the full set.

Completed:
- [x] Fixed `buildRunnerInput()` in `service-worker.js` to pass full cookie data (`cookies`, `cookieHeader`, `cookiesByDomain`, `cookieHeadersByDomain`, `cookieEnvMap`, `sessionStorageSnapshot`, `localStorageSnapshot`) directly on `sessionInfo`.
- [x] Fixed `callSkillRunner()` to inject `runnerCookieEnvMap` from settings into the context before building runner input.
- [x] Restored `_normalize_env_name()` helper in `launcher_core.py`.
- [x] Restored `_export_domain_cookie_envs()` method that exports per-domain cookie env vars (`<DOMAIN>_COOKIES`, `<DOMAIN>_COOKIES_JSON`, `SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN`, `SKILL_RUNNER_COOKIES_BY_DOMAIN_JSON`).
- [x] Restored `SKILL_RUNNER_COOKIE_HEADER`, `SKILL_RUNNER_COOKIES_JSON`, and `SKILL_RUNNER_REQUEST_HEADERS_JSON` env var exports in `_run_payload`.
- [x] Updated session log keys to include cookie-related env vars.
- [x] Updated `_build_session_info` to handle `cookieEnvMap` from context.
- [x] Updated `ai-sidepanel/README.md` with full cookie env var documentation.

Status:
- Bug fix completed by AI on 07/Apr/2026.
- Human validation pending.

## Date - 23/Mar/2026

### AI generated updates

#### Proposed checklist - Simplified runner cookie/header env vars + active domain

Requested change:
- Ensure request headers are forwarded from the extension to the skill launcher.
- Simplify env vars so only two are set for the active domain: `SKILL_RUNNER_COOKIES` and `SKILL_RUNNER_REQUEST_HEADERS`.
- Provide the active domain separately so the launcher can choose the right domain values.
- Update Python scripts to consume only the two env vars.

Planned work items:
- [x] Update extension tab capture to include per-domain request header maps (generated in-extension) alongside cookie headers.
- [x] Simplify runner payload/session info to drop custom cookie env map usage and include active domain + request headers.
- [x] Update skill-launcher to set `SKILL_RUNNER_COOKIES` and `SKILL_RUNNER_REQUEST_HEADERS` for the active domain (with safe fallbacks) — kept alongside per-domain env exports for backward compatibility.
- [x] Update skill scripts (e.g., `site24x7_client.py`) to read only `SKILL_RUNNER_COOKIES` and `SKILL_RUNNER_REQUEST_HEADERS`.
- [x] Refresh documentation in `ai-sidepanel/README.md` and `skill-launcher/README.md`, and add findings to `Agent-Notes.md`.

Status:
- Implementation completed. Both simplified active-domain vars and per-domain env exports are now available.

#### Follow-up update - UI task/history split + formatted/raw views

Requested change:
- Completed tasks should move from Current Tasks to History tab.
- Add Formatted (markdown) and Raw JSON toggle views for completed results.
- Fix auto-refresh breaking expand/collapse state.

Completed:
- [x] Current Tasks tab now shows only queued/running jobs. Completed/failed/timed_out jobs appear in History.
- [x] When a job finishes, view auto-switches to History tab with the job expanded.
- [x] Each completed runner job in History has "Formatted" / "Raw JSON" toggle buttons.
- [x] Formatted view renders response text via MarkdownRenderer. Raw view shows full JSON output.
- [x] Expand/collapse state is tracked in `expandedHistoryIds` Set and preserved across auto-refresh re-renders.
- [x] View mode per job tracked in `taskResultViewMode` and preserved across re-renders.

#### Follow-up update - Self-contained skills + ultra-slim prompt

Requested change:
- Eliminate shared/ dependency and AGENT_SHARED_PATH — skill scripts should be fully self-contained in their scripts/ directory.
- Cookies should only be in env vars, never in the CLI prompt. Claude should not waste time parsing cookie/session metadata.
- Prompt should contain only: user message + page content (if sent) + skill usage instructions.

Completed:
- [x] Moved `site24x7_client.py` into `alert-validation/scripts/` directory alongside `script.py`. No more external shared path needed.
- [x] Updated `script.py` to import `site24x7_client` from its own directory via `sys.path.insert(0, _scripts_dir)`.
- [x] `site24x7_client.py` now has a `_resolve_cookie_header()` function that reads cookies from env vars in priority order: `SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN` → `<DOMAIN>_COOKIES` → `SKILL_RUNNER_COOKIE_HEADER`.
- [x] Ultra-slim prompt: rewrote `_build_prompt_from_runner_input` to contain only skill names + page URL/title + page text (truncated to 4KB) + user message. ~10-15 lines total.
- [x] No cookies, session data, agent instructions, active tab metadata, or request metadata in CLI prompt — all in env vars only.
- [x] Prompt tells runner: "Read SKILL.md files for instructions. Cookies for API calls are in environment variables (used by scripts automatically)."

#### Follow-up update - Domain auto-detection + curl guidance in prompt

Requested change:
- Claude prompt should instruct the runner to check env vars before making curl requests.
- Eliminate manual SITE24X7_DOMAIN config — derive it from the active browser tab.
- Pass active tab origin as env var so scripts and runner know the target domain.

Completed:
- [x] Prompt now includes curl guidance: "echo $SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN" before making authenticated requests.
- [x] Prompt includes active tab URL + derived origin.
- [x] Launcher auto-sets `SKILL_RUNNER_SOURCE_ORIGIN` from active tab URL.
- [x] Launcher auto-sets `SITE24X7_DOMAIN` when active tab is on any site24x7 domain (`.com`, `.eu`, `.cn`, `.in`, etc.).
- [x] `site24x7_client.py` now has `_derive_site24x7_domain()` that checks `SITE24X7_DOMAIN` → `SKILL_RUNNER_SOURCE_ORIGIN` → `SKILL_RUNNER_SOURCE_URL` — zero manual config needed.
- [x] Updated `Agent-Notes.md` with findings.

Status:
- Implementation completed by AI on 22/Mar/2026.
- Human validation pending.

#### Follow-up update - Runner payload slimming + CPU optimization

Requested change:
- Do not embed full normalized task context (cookies/tab payload) into runner task text.
- Keep cookies/tab info as structured fields; export cookies in env as JSON-formatted values.
- Reduce CPU/fan load while tasks are running.

Completed:
- [x] Service worker now sends runner task text without large normalized cookie/tab blobs; active-tab info and cookie maps remain in dedicated structured fields.
- [x] Launcher prompt builder removed `normalizedTaskText` expansion to avoid re-injecting bulky request payloads.
- [x] Launcher env export now sends cookie values as JSON strings per mapped domain env var, with domain cookie maps in `SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN`.
- [x] Removed large context/session blobs from launcher env to reduce payload churn.
- [x] Reduced polling pressure (`1s -> 2s`) for runner task status checks in extension and launcher wait loops.
- [x] Reduced extension storage churn by persisting lean queue state and keeping heavy runtime payloads in memory during execution.
- [x] Added per-task launch command artifact in `task-runs/<task-id>/launch-command.json` and included its path in `result.json`.

#### Follow-up update - Skill/shared compatibility + slim prompt

Requested change:
- Fix env var consistency between launcher and skill scripts (scripts expect `AGENT_SHARED_PATH`, `SKILL_RUNNER_COOKIE_HEADER`, domain-mapped cookies).
- Reduce CLI prompt size — move all bulk data to env vars, only pass user message + brief context in `--print` arg.
- Support shared library packages (`shared.zip`) alongside `.skill` packages in repository.

Completed:
- [x] Slim prompt: rewrote `_build_prompt_from_runner_input` to emit ~30 lines (system preamble with env var reference + user message/task input only). All bulk data (cookies, session, page content, agent instructions, active tab, skills metadata, task images) moved to env vars.
- [x] New `_export_structured_env` method sets `SKILL_RUNNER_AGENT_INSTRUCTIONS`, `SKILL_RUNNER_PAGE_CONTENT_JSON`, `SKILL_RUNNER_ACTIVE_TAB_JSON`, `SKILL_RUNNER_SESSION_INFO_JSON`, `SKILL_RUNNER_SESSION_ALLOWED`, `SKILL_RUNNER_SELECTED_SKILLS_JSON`, `SKILL_RUNNER_TASK_IMAGES_JSON`, plus `SKILL_RUNNER_REQUEST_*` and `SKILL_RUNNER_SOURCE_*` metadata.
- [x] Launcher now sets `SKILL_RUNNER_COOKIE_HEADER` (active-tab cookie header string) — previously missing, required by `site24x7_client.py`.
- [x] Launcher now sets `AGENT_SHARED_PATH` pointing to `<runner>/shared/` — previously missing, required by `base_script.py` and skill scripts.
- [x] New `_discover_repo_urls` discovers both `.skill` and `shared.zip` packages from repository listings (JSON `"shared"` array, or HTML/text links with `shared` in name + `.zip` extension).
- [x] New `_extract_shared_package` extracts shared ZIP contents into `<runner>/shared/`, handling single top-level wrapper directory stripping (e.g. `shared/base_script.py` → `<runner>/shared/base_script.py`).
- [x] `sync_skills` now extracts shared packages before skill packages.
- [x] Full prompt saved to `task-runs/<task-id>/prompt.txt` for debugging.
- [x] Updated `skill-launcher/README.md` with full env var reference and shared library docs.
- [x] Updated `Agent-Notes.md` with implementation findings.

Status:
- Implementation completed by AI on 22/Mar/2026.
- Human validation pending.
