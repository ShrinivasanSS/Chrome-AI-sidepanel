# Skill Launcher Backend

Backend app compatible with the Chrome extension's Skill Runner flow.

It supports two interfaces:

- `remote` HTTP mode for remote/local network runner hosting
- `native` mode for Chrome Native Messaging (local machine CLI launch)

## Features

- Receives runner payload from extension (`runner`, `promptArg`, `prompt`, `timeoutMs`, `context`, `skillsConfig`)
- Syncs `.skill` packages from configured repository URL before each run
- Extracts packages into local per-runner folders under `skill-launcher`:
  - `./.claude/skills`
  - `./.copilot/skills`
  - `./.cursor/skills`
- Executes selected CLI runner (`claude`, `copilot`, or `cursor`) with `--prompt`-style argument
- Executes runner commands with working directory set to `skill-launcher` root
- Returns command output back to extension

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
  "promptArg": "--prompt",
  "prompt": "Analyze this page context...",
  "timeoutMs": 120000,
  "skillsConfig": {
    "repositoryEnabled": true,
    "repositoryUrl": "http://localhost/skills/repository"
  },
  "context": {
    "source": {
      "url": "https://example.com"
    }
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
