# Skill Launcher Backend

Backend app compatible with the Chrome extension's Skill Runner flow.

It supports two interfaces:

- `remote` HTTP mode for remote/local network runner hosting
- `native` mode for Chrome Native Messaging (local machine CLI launch)

## Features

- Receives runner payload from extension (`runner`, `promptArg`, `runnerInput`, `timeoutMs`, `context`, `skillsConfig`)
- Queues runner tasks (FIFO) and exposes task-status APIs for polling
- Syncs `.skill` packages from configured repository URL before each run
- Extracts packages into local per-runner folders under `skill-launcher`:
  - `./.claude/skills`
  - `./.copilot/skills`
  - `./.cursor/skills`
- Skill package extraction is flattened so each skill root is directly under runner skills folder:
  - `./.claude/skills/<skillname>/SKILL.md`
  - `./.copilot/skills/<skillname>/SKILL.md`
  - `./.cursor/skills/<skillname>/SKILL.md`
- Executes selected CLI runner (`claude`, `copilot`, or `cursor`) with `--prompt`-style argument
- Executes runner commands with working directory set to `skill-launcher` root
- Persists per-task artifacts under `task-runs/<task-id>/` (`request.json`, `stdout.txt`, `stderr.txt`, `result.json`)
- Builds final runner prompt text from structured `runnerInput` JSON contract
- Adds built-in runner guidance for authenticated `curl`/Playwright flows using env-provided cookies/session
- Discovers and extracts shared library packages (`shared.zip`) alongside `.skill` packages
- Shared libraries are extracted to `<runner>/shared/` and exposed via `AGENT_SHARED_PATH` env var
- Sets environment variables for runner process (all bulk data is in env, prompt stays small):
  - `AGENT_SHARED_PATH` — path to shared Python libraries used by skill scripts
  - `SKILL_RUNNER_COOKIE_HEADER` — active-tab cookie header string
  - `SKILL_RUNNER_COOKIES_JSON` — active-tab cookie array
  - `SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN` — JSON `{domain: cookieHeader}`
  - `SKILL_RUNNER_COOKIES_BY_DOMAIN_JSON` — JSON `{domain: [cookies]}`
  - `<DOMAIN>_COOKIES` / `<DOMAIN>_COOKIES_JSON` — per-domain cookie data
  - `SKILL_RUNNER_AGENT_INSTRUCTIONS` — full agent/system prompt instructions
  - `SKILL_RUNNER_PAGE_CONTENT_JSON` — page text, headings, meta, links
  - `SKILL_RUNNER_ACTIVE_TAB_JSON` — active tab URL, title, meta
  - `SKILL_RUNNER_SESSION_INFO_JSON` — full session/cookie/storage info
  - `SKILL_RUNNER_SESSION_ALLOWED` — `1` or `0`
  - `SKILL_RUNNER_SELECTED_SKILLS_JSON` — selected skill metadata
  - `SKILL_RUNNER_TASK_IMAGES_JSON` — task image attachments (if any)
  - `SKILL_RUNNER_REQUEST_MODE`, `SKILL_RUNNER_REQUEST_NAME`, `SKILL_RUNNER_REQUEST_MODEL`
  - `SKILL_RUNNER_SOURCE_TYPE`, `SKILL_RUNNER_SOURCE_URL`, `SKILL_RUNNER_SOURCE_TITLE`

## Run (Remote Mode)

```powershell
cd skill-launcher
python app.py --mode remote --host 127.0.0.1 --port 7070
```

Health check:

```powershell
curl http://127.0.0.1:7070/health
```

Run endpoint:

- `POST /run`
- Returns `accepted + task.id` (queued). Use task-status endpoints to fetch result.
- JSON body example:

```json
{
  "runner": "claude",
  "promptArg": "--print",
  "timeoutMs": 120000,
  "skillsConfig": {
    "repositoryEnabled": true,
    "repositoryUrl": "http://localhost/skills/repository"
  },
  "runnerInput": {
    "request": { "mode": "basic", "requestName": "PAGE_ANALYZER", "model": "gpt-4o-mini" },
    "agentInstructions": "You are a helpful AI assistant.",
    "userMessage": "Task: find namespaces...",
    "taskInput": "find namespaces",
    "normalizedTaskText": "Task: find namespaces...\n\nData:\n...",
    "skills": [{ "name": "example-skill", "source": "repository" }],
    "source": { "type": "sidepanel-basic", "url": "https://example.com", "title": "Example" },
    "pageContent": { "text": "", "headings": [], "meta": {}, "links": [] },
    "sessionInfo": {
      "cookies": [],
      "cookieHeader": "",
      "sessionStorageSnapshot": {},
      "localStorageSnapshot": {},
      "sessionInfoAllowed": false
    }
  },
  "context": {
    "source": { "url": "https://example.com" }
  }
}
```

Update skills only:

- `POST /update-skills`
- body can include `runner` and `skillsConfig`

Task status endpoints:

- `GET /tasks?limit=50`
- `GET /tasks/<taskId>?includeOutput=1`

## Run (Native Messaging Mode)

```powershell
cd skill-launcher
python app.py --mode native
```

For Chrome integration, register this script (or packaged executable) as a Native Messaging host and set extension `Native Host Name` to that host id.

Native messaging task actions now include:
- `run-skill-runner` (enqueue task)
- `get-task-status` (`taskId`, optional `includeOutput`)
- `list-tasks`

## Verbose Logging

Verbose mode writes JSONL diagnostic logs for request/runner lifecycle events.

- Enable with `--verbose`
- Optional custom path with `--log-file`
- Default log file: `<launcher-root>/skill-launcher.log`

Examples:

```powershell
python app.py --mode remote --verbose
python app.py --mode remote --verbose --log-file "D:\\logs\\skill-launcher.jsonl"
python app.py --mode native --verbose
```

Logged events include:

- incoming request payloads (`incoming_payload`)
- runner invocation command and exported `SKILL_RUNNER_*` env snapshot (`runner_invocation`)
- skill sync status (`skills_sync_state`, `update_skills_result`)
- runner stdout/stderr and result status (`runner_exit_success`, `runner_exit_nonzero`, `runner_error`)

## Command Overrides

Default runner commands:

- `claude --print <prompt>`
- `copilot --prompt <prompt>`
- `cursor agent -p <prompt>`

You can override command templates with environment variables:

- `SKILL_RUNNER_COMMAND_CLAUDE`
- `SKILL_RUNNER_COMMAND_COPILOT`
- `SKILL_RUNNER_COMMAND_CURSOR`

Example:

```powershell
$env:SKILL_RUNNER_COMMAND_CLAUDE='claude --print --prompt "{prompt}"'
python app.py --mode remote --launcher-root .
```

## Runtime Data

Extracted skills, shared libraries, and state are stored under runner-local folders in launcher root:

- `skill-launcher/.claude/skills/` — extracted skill packages
- `skill-launcher/.claude/shared/` — shared Python libraries (from `shared.zip`)
- `skill-launcher/.claude/skills-state.json` — sync state
- Same structure for `.copilot/` and `.cursor/`

If you need a different root, use:

```powershell
python app.py --mode remote --launcher-root "D:\\path\\to\\skill-launcher"
```
