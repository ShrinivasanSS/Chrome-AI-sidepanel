# AI generated notes 
Use this section for reducing repeated searches.

## March 1 2026

- `chrome.sidePanel.open()` is still constrained by user-gesture rules, so API requests triggered from regular pages should not rely on opening the panel programmatically. Processing was moved into the service worker and the side panel now acts as a viewer for the current API session and stored history.
- For "storage in the extension's own directory", the workable MV3 interpretation is extension-owned browser storage:
  - `IndexedDB` for conversation history
  - `chrome.storage.local` for settings, current API session, and storage metrics
- ZIP support was implemented without adding a bundler. A lightweight local ZIP reader is enough for the sample archive because it only needs central-directory parsing plus support for:
  - `store` compression (`method 0`)
  - `deflate` compression (`method 8`) via `DecompressionStream('deflate-raw')`
- Unsupported ZIP entries are ignored and surfaced as warnings instead of hard failures, matching the Todo requirement.
- The repo previously referenced `tests/vanila-html/example-math-input.json` from the IDE context, but that file did not exist. A local copy was added to the `vanila-html` folder to keep the sample area self-contained.
- The compose test harness uses a single nginx gateway with path-prefix stripping:
  - `/vanilla/` -> static nginx service
  - `/jsp/` -> Tomcat/JSP service
- The vanilla page needed URL resolution based on `window.location.href`; parent-relative asset paths were brittle once the page moved behind `/vanilla/`.
- Shared test assets are mounted read-only from `tests/example-inputs` into the compose services so future test apps can reuse the same sample files without rebuilding images.
- Docker bind mounts should not overlap on nested paths. Mounting `tests/vanila-html` to `/usr/share/nginx/html` and then trying to mount `tests/example-inputs` inside `/usr/share/nginx/html/example-inputs` causes container startup failure. The working pattern is:
  - mount app content at `/usr/share/nginx/html`
  - mount shared assets at a separate path such as `/opt/example-inputs`
  - expose the asset URL path with nginx `alias`
- Current compose entrypoint in the repo is `http://localhost:9090/`, not `8080`.
- As of the latest human review, the planned feature set is complete. Testing remains active and follow-up bugs will be documented separately instead of being mixed into the completed implementation notes.

## March 19 2026

- For MV3 service workers, periodic skills refresh should use `chrome.alarms` instead of `setInterval`; alarms survive worker suspension and rehydrate execution when Chrome wakes the worker.
- "Repository skills" in-browser cannot safely assume direct filesystem traversal. The implemented pattern uses an HTTP repository base URL and discovers `.skill` package links from the directory listing.
- To avoid breaking runtime behavior during source outages, skills refresh keeps the previous catalog when a refresh returns zero new skills and at least one source error. This preserves last-known-good skill behavior.
- Repository discovery now treats `.skill` packages as the source of truth; duplicate skill names inside multiple packages are deduplicated by name (latest discovered package wins for that name).
- User mode only gates sidepanel visibility for `Advanced` and `API`; background API request processing remains active to preserve external page integrations.
- Skills repository format was changed from index-driven metadata to directory-discovered `.skill` packages. The loader now parses repository listing HTML/text for links ending with `.skill`, downloads each package, and reads `SKILL.md` from inside the ZIP.
- Per-skill enable/disable now uses a deny list (`skillsConfig.disabledSkillNames`) so newly discovered skills are enabled by default unless explicitly disabled.
- Chrome extensions cannot launch local binaries directly. Local runner support must go through Native Messaging (`chrome.runtime.sendNativeMessage`) with a separately installed host binary that shells out to `claude`, `copilot`, or `cursor`.
- Remote runner mode is operational over HTTP and should return either plain text or JSON with an `output` field for display in extension responses.
- `skill-launcher` now provides both transports from the same core:
  - remote HTTP (`/run`, `/update-skills`, `/health`)
  - native messaging (length-prefixed JSON protocol)
- Runner payload now includes `skillsConfig`, so launcher can sync `.skill` packages from the configured repository before each run and keep backend skill state aligned with extension settings.
- Launcher skill sync paths were updated to local tool folders under launcher root (`.claude/skills`, `.copilot/skills`, `.cursor/skills`). Runner commands now execute with launcher root as the process `cwd`.
- Runner CLI argument mapping is now explicit per tool:
  - Claude: `--print`
  - Copilot: `--prompt`
  - Cursor: `agent -p`
- For runner backend mode, extension no longer appends full skill instruction bodies into prompt text; synced local skills are expected to be used by the runner directly.
- Sidepanel now has a persisted `includeTabContent` toggle (default `false`) used by both Basic and Advanced modes:
  - Basic OFF: pure typed query
  - Basic ON: capture + include page text/screenshot/meta/cookies
  - Advanced OFF: payload unchanged
  - Advanced ON: each task is enriched with captured tab context as supplements
- Theme support restored via persisted `theme` setting (`light`/`dark`) and applied on both options and sidepanel views via `data-theme`.
- Launcher sync path bug fixed: skill package extraction is flattened to runner-local directories (`./.claude/skills/<skillname>/...`, etc.), avoiding nested `<skillname>.skill/<skillname>/SKILL.md` layouts that break runner discovery.
- Service worker now triggers launcher `update-skills` during settings save (`settings-updated`) and manual skills refresh (`refresh-skills`) to keep backend skill cache aligned.
- Session forwarding is now split from page-content forwarding in sidepanel controls. Cookies/storage are sent only when:
  - `Include Cookies/Session` toggle is enabled, and
  - active tab domain matches `trustedSessionDomains` whitelist from settings.
- Runner environment now receives `SKILL_RUNNER_SESSION_INFO` JSON for trusted session payloads, alongside `SKILL_RUNNER_CONTEXT`.
- `skill-launcher` verbose diagnostics are now available via `app.py --verbose [--log-file ...]`. Logs are JSONL entries that capture payload intake, skill sync results, runner command/env snapshot (`SKILL_RUNNER_*`), and runner stdout/stderr outcomes for easier debugging across remote and native modes.
- Skill-runner contract now supports structured `runnerInput` from extension (`userMessage`, `sessionInfo`, `skills`, `pageContent`, `request/source metadata`) so extension no longer needs to flatten all context into one prompt string.
- Prompt construction for CLI runners is now centralized in `skill-launcher` (`launcher_core.py`). This makes remote/native behavior consistent and keeps per-runner guidance in one place.
- Launcher now exports cookie/session helpers beyond `SKILL_RUNNER_SESSION_INFO`: `SKILL_RUNNER_COOKIE_HEADER` and `SKILL_RUNNER_COOKIES_JSON`. This improves scriptability for authenticated `curl` and browser automation flows.

## March 22 2026

- Long-running skill-runner requests over one-shot `chrome.runtime.sendMessage` can still fail with channel-closed errors even when listeners return `true`. Queueing requests in extension storage and immediately returning `accepted + jobId` removes that failure mode in sidepanel flows.
- A simple persisted queue (`chrome.storage.local`) with statuses `queued/running/completed/failed/timed_out` is enough to drive sidepanel task UX and survive sidepanel reopen.
- Trusted-domain cookie forwarding is easier to consume in runners when sent as `cookieHeadersByDomain` plus a domain->env map (`runnerCookieEnvMap`) rather than a single active-tab cookie header.
- Capturing cookies for all trusted domains should be done in service worker (`chrome.cookies.getAll({ domain })`), not in content scripts.
- Launcher task execution is more debuggable when each run writes `request.json`, `stdout.txt`, `stderr.txt`, and `result.json` under a per-task directory and task APIs return those file paths.
- For domain cookie envs, sanitize env names to uppercase `[A-Z0-9_]` and auto-generate defaults like `<DOMAIN>_COOKIES` when explicit mapping is missing.
- Heavy per-job payloads (`normalized` task objects + full source blobs) cause high CPU when queue state is persisted frequently; keep heavy execution payload in memory and persist only queue metadata/progress.
- Polling both sidepanel and runner status every second is unnecessarily expensive for long tasks; moving to 2-second polling significantly reduces background churn while preserving UX.
- If runner prompt already receives structured `activeTabInfo` + `sessionInfo`, avoid also appending `normalizedTaskText` since it often duplicates large cookie/tab JSON and bloats tokens/logs.
- For incident/debug reporting, store the exact launched command per runner task in `task-runs/<task-id>/launch-command.json` and reference it from `result.json`.
- **Prompt size was the main cause of slow runner launches.** The old prompt builder embedded cookies, session info, page content, active tab info, agent instructions, and full skill metadata inline — producing multi-KB command lines passed via `claude --print <massive_prompt>`. This hits OS command-line length limits on Windows and causes slow process spawning. Fix: move all bulk data into environment variables and keep the CLI prompt to ~30 lines (preamble + user message only).
- **Env var consistency for skill scripts**: Skill scripts (e.g. `site24x7_client.py`) read `AGENT_SHARED_PATH`, `SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN`, `SKILL_RUNNER_COOKIE_HEADER`, and domain-mapped vars like `SITE24X7_COOKIES`. The launcher must set all of these consistently. Previously `AGENT_SHARED_PATH` and `SKILL_RUNNER_COOKIE_HEADER` were never set by the launcher.
- **Shared library packages** (`shared.zip`) sit alongside `.skill` packages in the repository. The launcher now discovers them (by `shared` in name + `.zip` extension, or a `"shared"` array in JSON listings) and extracts their contents into `<runner>/shared/`. The `AGENT_SHARED_PATH` env var is set to this directory automatically.
- The shared zip extractor handles the single-top-directory-wrapper pattern: if `shared.zip` contains `shared/__init__.py`, `shared/base_script.py`, etc., the wrapper `shared/` prefix is stripped so files end up directly in the `<runner>/shared/` dir.
- New structured env vars exported by launcher: `SKILL_RUNNER_REQUEST_MODE`, `SKILL_RUNNER_REQUEST_NAME`, `SKILL_RUNNER_REQUEST_MODEL`, `SKILL_RUNNER_SOURCE_TYPE`, `SKILL_RUNNER_SOURCE_URL`, `SKILL_RUNNER_SOURCE_TITLE`, `SKILL_RUNNER_ACTIVE_TAB_JSON`, `SKILL_RUNNER_PAGE_CONTENT_JSON`, `SKILL_RUNNER_SESSION_INFO_JSON`, `SKILL_RUNNER_SESSION_ALLOWED`, `SKILL_RUNNER_SELECTED_SKILLS_JSON`, `SKILL_RUNNER_AGENT_INSTRUCTIONS`, `SKILL_RUNNER_TASK_IMAGES_JSON`.
- The full prompt is also saved to `task-runs/<task-id>/prompt.txt` for debugging, even though only a slim version is passed to the CLI.
- **Self-contained skills are the better pattern.** Instead of a shared library extracted to `AGENT_SHARED_PATH`, skill scripts should co-locate all dependencies in their own `scripts/` directory. The sample `alert-validation` skill now has `site24x7_client.py` directly in `scripts/` alongside `script.py`, imported via `sys.path.insert(0, os.path.dirname(__file__))`. This eliminates the shared path dependency entirely.
- **Ultra-slim prompt for Claude speed.** Claude `--print` processes the entire prompt before starting. The old prompt had 30+ lines of env var documentation. The new prompt is ~10 lines: skill names + "read SKILL.md" + page URL + page text (if sent) + user message. Claude starts responding much faster.
- **Cookie data should never be in the CLI prompt.** Cookies are only consumed by Python scripts (via `requests` library) or `curl` commands. The runner (Claude/Copilot/Cursor) only needs to know that "cookies are in env vars and scripts handle them automatically." This principle keeps the prompt focused on the user's actual task.
- When rebuilding DOM on auto-refresh intervals, expand/collapse state must be tracked externally (Set of IDs) and restored on each render. DOM-position-based state (e.g. "first item expanded") breaks on every poll cycle.
- Completed runner jobs should not stay in Current Tasks — they clutter the active view. Moving them to History on completion keeps the task queue clean and the history comprehensive.
- **Domain auto-detection from active tab is critical.** `SITE24X7_DOMAIN` should never need manual config. The launcher derives it from the active tab URL: if tab is on `site24x7.eu` → `https://www.site24x7.eu`, `site24x7.com` → `https://www.site24x7.com`. The `_export_structured_env` method sets both `SKILL_RUNNER_SOURCE_ORIGIN` and `SITE24X7_DOMAIN` automatically.
- **Python scripts derive domain from env chain.** `site24x7_client.py` now checks `SITE24X7_DOMAIN` → `SKILL_RUNNER_SOURCE_ORIGIN` → `SKILL_RUNNER_SOURCE_URL` in priority order. No manual config needed when running from the extension.
- **Claude prompt includes curl guidance.** The prompt tells the runner to `echo $SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN` before making curl requests. This way Claude can generate proper authenticated curl commands even without skill Python scripts.
- **The prompt now includes the active tab origin** so the runner knows which domain it's working with and can construct proper API URLs.

## March 23 2026

- Simplified runner env vars: launcher now exports only `SKILL_RUNNER_COOKIES` + `SKILL_RUNNER_REQUEST_HEADERS` for the active domain (plus `SKILL_RUNNER_ACTIVE_DOMAIN` as metadata). This avoids per-domain env names and removes the need for `runnerCookieEnvMap` in settings/UI.
- Extension now generates request header maps in the service worker and forwards them alongside cookie headers in runner payloads.
- `site24x7_client.py` was updated to read only the two simplified env vars and no longer parses per-domain env names.

## April 5 2026

- **Chat Mode replaces old Basic mode UI.** The previous textarea + "Capture & Analyze" button is replaced by a chat-style interface with message bubbles, an input bar, and Chat/Skill toggle. The old `handleCapture` function and `basicQuestion`/`captureBtn`/`basicStatus`/`basicOutput` elements are no longer connected to the new chat UI but left in the JS for backward compatibility if Advanced mode needs them.
- **Chat vs Skill mode stored in `chrome.storage.local` as `chatMode`**, not inside the sanitized settings schema. This keeps it lightweight and avoids migrating the settings schema. The settings page reads/writes it directly via `chrome.storage.local.get/set`.
- **Chat mode sends full OpenAI messages array.** Each turn builds: `[system (with page context), ...conversation history]`. Page context in the system message is truncated to 8KB to avoid token bloat.
- **Skill mode concatenates conversation as a string.** Format: `User - "msg"\n\nRUNRESULT#N\nresponse\n\nUser - "next msg"`. This preserves conversation context across skill-runner invocations without requiring the runner to understand multi-turn protocols.
- **Skill mode with queued runner jobs requires async polling.** When the skill runner returns `accepted + jobId`, the chat UI polls `get-runner-job` every 2 seconds until the job completes, then injects the result as an assistant bubble. A 5-minute timeout prevents indefinite waiting.
- **Service worker has a new `chat-message` command** that dispatches to either `callAiWithMessages` (chat mode) or `processRequestLifecycle` via `enqueueSkillRunnerRequest` (skill mode). The `callAiWithMessages` function accepts an arbitrary messages array and does not go through `RequestNormalizer`.
- **The `DEFAULT_CHAT_MODE` constant** is in `StorageUtils` for reference but is not enforced through `sanitizeSettings` — it's a display-layer concern stored separately.

## April 7 2026

- **Cookie data flow regression.** The `buildRunnerInput()` function in `service-worker.js` was restructured at some point to use a simplified `domains` object in `sessionInfo` instead of the flat fields (`cookies`, `cookieHeader`, `cookiesByDomain`, `cookieHeadersByDomain`, `cookieEnvMap`) that `launcher_core.py`'s `_build_session_info()` expects. This caused all cookie/session env vars to be empty in the runner process. The fix restores the flat field structure in `sessionInfo`.
- **`runnerCookieEnvMap` must be injected into context.** The `callSkillRunner()` function must read `settings.runnerCookieEnvMap` and pass it into the context object before `buildRunnerInput()` is called. Without this, the per-domain env var naming from settings is lost.
- **Dual env var strategy for cookies.** The launcher now exports both:
  1. **Active-domain vars** (`SKILL_RUNNER_COOKIES`, `SKILL_RUNNER_REQUEST_HEADERS`) — for simple scripts that only need the current tab's domain.
  2. **Per-domain vars** (`<DOMAIN>_COOKIES`, `SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN`, etc.) — for scripts that need to work with multiple trusted domains.
  This ensures backward compatibility with both old and new skill scripts.
- **Timeout behavior depends on `timeoutMs` flowing through the full chain.** The extension passes `runnerConfig.timeoutMs` → payload `timeoutMs` → launcher `_run_payload` → `subprocess.run(timeout=...)`. The extension-side `waitForRemoteRunnerTask` adds 15 seconds of headroom (`timeoutMs + 15000`). If the configured timeout is 120000ms (2 min), the subprocess gets 120s and the extension waits up to 135s. The stale job recovery in the extension uses `timeoutMs + RUNNER_JOB_STALE_BUFFER_MS (5000)` to mark jobs as timed out.
- **`storage-utils.js`, `settings.js`, `settings.html`, and `sidepanel.js` already had the correct cookie env map code.** The diff fragments in the bug report showed what was *previously removed* but had actually been restored in a later commit. The real missing piece was in `service-worker.js` and `launcher_core.py`.

## April 9 2026

- **`additionalInstructions` field flow.** The additional instructions typed by the user in the sidepanel are attached to `source.additionalInstructions` in `sidepanel.js`, extracted in `service-worker.js` `buildRunnerInput()` as a top-level field on the runner input object, exported as `SKILL_RUNNER_ADDITIONAL_INSTRUCTIONS` env var in `launcher_core.py` `_export_structured_env()`, and also injected as a labelled section in the CLI prompt by `_build_prompt_from_runner_input()`. This dual approach (env var + prompt) ensures both skill scripts and the CLI runner can consume it.
- **Page context extraction (`_extract_page_context_info`).** The launcher scans the source URL query params first (checking common key names like `userId`, `uid`, `accountId`, `uniqueId`, `uuid`, `sessionId`, `timezone`, `tz`), then falls back to regex scanning of the page text for labelled patterns like `User ID: 12345` or `Timezone: Asia/Kolkata`. Extracted values are injected into the CLI prompt as a `User context extracted from page:` block. This is best-effort — if no values are found, the block is omitted.
- **`urlparse`/`parse_qs` import.** The `urlparse` and `parse_qs` functions were already imported at the top of `launcher_core.py` via `from urllib.parse import urljoin, urlparse, parse_qs`. The `_export_structured_env` method had a redundant local `from urllib.parse import urlparse` import that was already present — this is harmless but can be cleaned up.
- **Prompt section ordering.** The `_build_prompt_from_runner_input` prompt sections are ordered: skill usage hint → active tab context → curl guidance → page content → extracted user context → additional instructions → task input → user message. This ordering ensures the runner sees user-provided context and instructions immediately before the actual task, reducing the chance of the runner ignoring them.

## April 13 2026

- **Global vs Tab-wise sidepanel.** Chrome's `sidePanel` API supports both modes: global (set `default_path` in manifest, use `setPanelBehavior`) and per-tab (call `sidePanel.setOptions({ tabId, path, enabled: true })` on each tab). The extension now supports both via a `sidePanelMode` setting. In global mode, one panel is shared across all tabs. In tab mode, `sidePanel.setOptions` is called on `tabs.onUpdated` (status=complete) and `tabs.onActivated`. The manifest `side_panel.default_path` remains as fallback for both modes.
- **Tab-wise chat isolation.** When `sidePanelMode === 'tab'`, chat messages are persisted per tab in `chrome.storage.local` with key `chatMessages_<tabId>`. On tab close (`tabs.onRemoved`), the per-tab storage is cleaned up. The sidepanel detects its current tab via `chrome.tabs.query({ active: true, currentWindow: true })` on initialization. In global mode, chat state remains in-memory only (existing behavior).
- **History moved to standalone page.** The inline history panel in the sidepanel was consuming significant vertical space in the narrow panel. It's now a standalone `history.html` page (styled like `settings.html`) that opens in a new tab. The sidepanel "History" button calls `chrome.tabs.create({ url: chrome.runtime.getURL('history.html') })`. The inline history rendering code (`renderHistory`, `renderJobResultView`, etc.) remains in `sidepanel.js` for runner job status tracking but the primary history view is now the standalone page.
- **Cline task continuation.** Cline CLI returns a task ID as the first output line when starting a new task, and supports `-T <taskId>` to resume an existing task. The launcher now has `DEFAULT_RUNNER_CONTINUE_COMMANDS` mapping runners to their continue command templates. For Cline: `cline -v --yolo -T {taskId} {prompt}`. The `_run_payload` method checks for a `continueTaskId` field in the payload; if present and the runner supports continuation, it uses the continue command. The `_extract_runner_task_id` method parses stdout for the task ID using pattern matching (bare ID on first line, or `Task ID: <id>` prefix).
- **Runner type validation.** The `normalizeRunnerConfig` function in `storage-utils.js` previously only allowed `claude`, `copilot`, `cursor` as valid runner types, causing `cline` selections to default to `claude`. Added `cline` to the allowed list.
- **`continueTaskId` integration point.** The launcher's `_run_payload` accepts `continueTaskId` in the payload dict. The extension-side code (or any caller of the remote/native runner API) can pass this field to trigger continuation. The first successful run returns `runnerTaskId` in the result, which callers can store and pass back for subsequent tasks in the same job.
