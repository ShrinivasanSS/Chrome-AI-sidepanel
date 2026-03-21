# Skill Launcher Backend

Backend app compatible with the Chrome extension's Skill Runner flow.

It supports two interfaces:

- `remote` HTTP mode for remote/local network runner hosting
- `native` mode for Chrome Native Messaging (local machine CLI launch)

## Features

- Receives runner payload from extension (`runner`, `promptArg`, `runnerInput`, `timeoutMs`, `context`, `skillsConfig`)
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
- Returns command output back to extension
- Builds final runner prompt text from structured `runnerInput` JSON contract
- Adds built-in runner guidance for authenticated `curl`/Playwright flows using env-provided cookies/session
- Sets environment variables for runner process:
  - `SKILL_RUNNER_CONTEXT`
  - `SKILL_RUNNER_SESSION_INFO` (trusted-domain cookies/session snapshot payload)
  - `SKILL_RUNNER_COOKIE_HEADER`
  - `SKILL_RUNNER_COOKIES_JSON`
  - `SKILL_RUNNER_INPUT`

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

## Run (Native Messaging Mode)

```powershell
cd skill-launcher
python app.py --mode native
```

For Chrome integration, register this script (or packaged executable) as a Native Messaging host and set extension `Native Host Name` to that host id.

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

Extracted skills and state are stored under runner-local folders in launcher root:

- `skill-launcher/.claude/skills/` and `skill-launcher/.claude/skills-state.json`
- `skill-launcher/.copilot/skills/` and `skill-launcher/.copilot/skills-state.json`
- `skill-launcher/.cursor/skills/` and `skill-launcher/.cursor/skills-state.json`

If you need a different root, use:

```powershell
python app.py --mode remote --launcher-root "D:\\path\\to\\skill-launcher"
```
