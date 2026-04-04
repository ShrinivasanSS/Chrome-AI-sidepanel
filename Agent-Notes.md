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
