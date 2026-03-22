import io
import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import threading
import time
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.error import URLError, HTTPError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


DEFAULT_RUNNER_COMMANDS = {
    "claude": ["claude", "--print", "{prompt}"],
    "copilot": ["copilot", "--prompt", "{prompt}"],
    "cursor": ["cursor", "agent", "-p", "{prompt}"],
}


def _normalize_text(value: object) -> str:
    return str(value).strip() if value is not None else ""


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-")
    return cleaned or "skill"


def _normalize_cookie_domain(value: object) -> str:
    domain = _normalize_text(value).lower()
    domain = re.sub(r"^https?://", "", domain)
    domain = domain.replace("*.", "")
    domain = domain.split("/", 1)[0]
    return domain.split(":", 1)[0]


def _default_cookie_env_name(domain: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", domain.upper()).strip("_")
    base = normalized or "DOMAIN"
    return f"{base}_COOKIES"


def _normalize_env_name(value: object, fallback: str) -> str:
    name = _normalize_text(value).upper()
    name = re.sub(r"[^A-Z0-9_]", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    if not name:
        name = fallback
    if re.match(r"^[0-9]", name):
        name = f"COOKIES_{name}"
    return name


def _json_dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)

class SkillLauncher:
    def __init__(
        self,
        launcher_root: Path,
        runner_commands: Optional[Dict[str, List[str]]] = None,
        verbose: bool = False,
        log_file: Optional[Path] = None,
    ):
        self.launcher_root = launcher_root.resolve()
        self.launcher_root.mkdir(parents=True, exist_ok=True)
        self.tasks_root = self.launcher_root / "task-runs"
        self.tasks_root.mkdir(parents=True, exist_ok=True)

        self.runner_commands = dict(DEFAULT_RUNNER_COMMANDS)
        self.verbose = bool(verbose)
        self.log_file = log_file.resolve() if log_file else (self.launcher_root / "skill-launcher.log")
        if runner_commands:
            for key, cmd in runner_commands.items():
                if isinstance(cmd, list) and all(isinstance(part, str) for part in cmd):
                    self.runner_commands[key] = cmd

        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._tasks: Dict[str, Dict] = {}
        self._task_order: List[str] = []
        self._queue: List[str] = []
        self._skills_sync_cache: Dict[str, Dict] = {}
        self._worker = threading.Thread(target=self._worker_loop, daemon=True, name="skill-launcher-worker")
        self._worker.start()

        if self.verbose:
            self.log_file.parent.mkdir(parents=True, exist_ok=True)
            self._log("launcher_initialized", {
                "launcherRoot": str(self.launcher_root),
                "logFile": str(self.log_file),
                "tasksRoot": str(self.tasks_root),
            })

    def handle_payload(self, payload: Dict) -> Dict:
        self._log("incoming_payload", {
            "action": payload.get("action"),
            "runner": payload.get("runner"),
            "hasRunnerInput": isinstance(payload.get("runnerInput"), dict),
            "timeoutMs": payload.get("timeoutMs"),
        })
        action = _normalize_text(payload.get("action"))

        if action == "update-skills":
            runner = _normalize_text(payload.get("runner")) or "claude"
            skills_config = payload.get("skillsConfig") or {}
            summary = self.sync_skills(skills_config, runner)
            self._log("update_skills_result", summary)
            return {"success": True, "updated": summary}

        if action == "get-task-status":
            task_id = _normalize_text(payload.get("taskId"))
            task = self.get_task(task_id, include_output=bool(payload.get("includeOutput")))
            if not task:
                return {"success": False, "error": "Task not found"}
            return {"success": True, "task": task}

        if action == "list-tasks":
            limit = int(payload.get("limit") or 50)
            return {"success": True, "tasks": self.list_tasks(limit=limit)}

        if action == "cancel-task":
            task_id = _normalize_text(payload.get("taskId"))
            cancelled = self.cancel_task(task_id)
            if not cancelled:
                return {"success": False, "error": "Task cannot be cancelled"}
            return {"success": True, "task": cancelled}

        return self.enqueue_runner_task(payload)

    def enqueue_runner_task(self, payload: Dict) -> Dict:
        task_id = f"task-{int(time.time() * 1000)}-{os.urandom(3).hex()}"
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        task = {
            "id": task_id,
            "status": "queued",
            "createdAt": now,
            "startedAt": None,
            "finishedAt": None,
            "error": None,
            "payload": payload or {},
            "result": None,
            "resultFile": None,
            "taskDir": str(self.tasks_root / task_id),
        }

        with self._condition:
            self._tasks[task_id] = task
            self._task_order.append(task_id)
            self._queue.append(task_id)
            self._condition.notify_all()

        self._log("task_enqueued", {"taskId": task_id})
        return {
            "success": True,
            "accepted": True,
            "task": self._public_task(task, include_output=False),
        }

    def get_task(self, task_id: str, include_output: bool = False) -> Optional[Dict]:
        if not task_id:
            return None
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None
            snapshot = dict(task)
        return self._public_task(snapshot, include_output=include_output)

    def list_tasks(self, limit: int = 50) -> List[Dict]:
        with self._lock:
            ids = self._task_order[-max(1, limit):]
            tasks = [dict(self._tasks[task_id]) for task_id in reversed(ids)]
        return [self._public_task(task, include_output=False) for task in tasks]

    def cancel_task(self, task_id: str) -> Optional[Dict]:
        with self._condition:
            task = self._tasks.get(task_id)
            if not task or task.get("status") != "queued":
                return None
            task["status"] = "failed"
            task["error"] = "Cancelled by user"
            task["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if task_id in self._queue:
                self._queue.remove(task_id)
            self._condition.notify_all()
            snapshot = dict(task)
        self._log("task_cancelled", {"taskId": task_id})
        return self._public_task(snapshot, include_output=False)

    def _worker_loop(self):
        while True:
            with self._condition:
                while not self._queue:
                    self._condition.wait()
                task_id = self._queue.pop(0)
                task = self._tasks.get(task_id)
                if not task or task.get("status") != "queued":
                    continue
                task["status"] = "running"
                task["startedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                payload = dict(task.get("payload") or {})

            try:
                result = self._run_payload(task_id, payload)
                status = result.get("status") or "completed"
                error = result.get("error")
            except Exception as exc:
                status = "failed"
                error = str(exc)
                result = {"success": False, "error": str(exc), "status": status}

            with self._condition:
                task = self._tasks.get(task_id)
                if not task:
                    continue
                task["status"] = status
                task["error"] = error
                task["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                task["result"] = result
                task["resultFile"] = result.get("resultFile")
                self._condition.notify_all()

            self._log("task_finished", {
                "taskId": task_id,
                "status": status,
                "error": error,
            })

    def _run_payload(self, task_id: str, payload: Dict) -> Dict:
        runner = _normalize_text(payload.get("runner")) or "claude"
        prompt_arg = _normalize_text(payload.get("promptArg")) or "--prompt"
        prompt = _normalize_text(payload.get("prompt"))
        timeout_ms = int(payload.get("timeoutMs") or 120000)
        context = payload.get("context") or {}
        skills_config = payload.get("skillsConfig") or {}
        runner_input = payload.get("runnerInput") if isinstance(payload.get("runnerInput"), dict) else {}

        if runner_input:
            prompt = self._build_prompt_from_runner_input(runner_input)

        if not prompt:
            return {"success": False, "status": "failed", "error": "Missing prompt"}

        task_dir = self.tasks_root / task_id
        task_dir.mkdir(parents=True, exist_ok=True)
        request_file = task_dir / "request.json"
        stdout_file = task_dir / "stdout.txt"
        stderr_file = task_dir / "stderr.txt"
        result_file = task_dir / "result.json"
        command_file = task_dir / "launch-command.json"
        request_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        sync_summary = self._sync_skills_cached(skills_config, runner)
        command = self._build_command(runner, prompt_arg, prompt)
        skills_dir = self._runner_skills_dir(runner)
        command_file.write_text(json.dumps({
            "taskId": task_id,
            "runner": runner,
            "promptArg": prompt_arg,
            "command": command,
            "commandText": " ".join(shlex.quote(part) for part in command),
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }, indent=2), encoding="utf-8")

        env = os.environ.copy()
        env["SKILL_RUNNER_TYPE"] = runner
        env["SKILL_RUNNER_SKILLS_DIR"] = str(skills_dir)
        env["SKILL_RUNNER_WORKDIR"] = str(self.launcher_root)
        session_info = self._build_session_info(runner_input, context)
        cookies = session_info.get("cookies")
        if not isinstance(cookies, list):
            cookies = []
            session_info["cookies"] = cookies
        env["SKILL_RUNNER_COOKIES_JSON"] = _json_dumps(cookies)
        self._export_domain_cookie_envs(env, session_info)

        log_env = {
            key: env.get(key, "")
            for key in (
                "SKILL_RUNNER_TYPE",
                "SKILL_RUNNER_SKILLS_DIR",
                "SKILL_RUNNER_WORKDIR",
                "SKILL_RUNNER_COOKIES_JSON",
                "SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN",
            )
        }
        self._log("runner_invocation", {
            "taskId": task_id,
            "runner": runner,
            "promptArg": prompt_arg,
            "command": command,
            "timeoutMs": timeout_ms,
            "env": log_env,
            "stdoutFile": str(stdout_file),
            "stderrFile": str(stderr_file),
        })

        started = time.time()
        try:
            with stdout_file.open("w", encoding="utf-8") as stdout_handle, stderr_file.open("w", encoding="utf-8") as stderr_handle:
                result = subprocess.run(
                    command,
                    stdout=stdout_handle,
                    stderr=stderr_handle,
                    text=True,
                    env=env,
                    cwd=str(self.launcher_root),
                    timeout=max(5, timeout_ms / 1000.0),
                )
            duration_ms = int((time.time() - started) * 1000)
            stdout = stdout_file.read_text(encoding="utf-8", errors="replace").strip()
            stderr = stderr_file.read_text(encoding="utf-8", errors="replace").strip()
            if result.returncode != 0:
                payload = {
                    "success": False,
                    "status": "failed",
                    "error": f"Runner exited with code {result.returncode}",
                    "stderr": stderr,
                    "stdout": stdout,
                    "command": command,
                    "sync": sync_summary,
                    "durationMs": duration_ms,
                    "stdoutFile": str(stdout_file),
                    "stderrFile": str(stderr_file),
                    "outputFile": str(stdout_file),
                    "resultFile": str(result_file),
                    "launchCommandFile": str(command_file),
                }
                result_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
                self._log("runner_exit_nonzero", payload)
                return payload

            success_payload = {
                "success": True,
                "status": "completed",
                "output": stdout or stderr,
                "command": command,
                "sync": sync_summary,
                "durationMs": duration_ms,
                "stdoutFile": str(stdout_file),
                "stderrFile": str(stderr_file),
                "outputFile": str(stdout_file if stdout else stderr_file),
                "resultFile": str(result_file),
                "launchCommandFile": str(command_file),
            }
            result_file.write_text(json.dumps(success_payload, indent=2), encoding="utf-8")
            self._log("runner_exit_success", success_payload)
            return success_payload
        except FileNotFoundError:
            payload = {
                "success": False,
                "status": "failed",
                "error": f"Runner command not found: {command[0]}",
                "command": command,
                "sync": sync_summary,
                "stdoutFile": str(stdout_file),
                "stderrFile": str(stderr_file),
                "outputFile": str(stdout_file),
                "resultFile": str(result_file),
                "launchCommandFile": str(command_file),
            }
            result_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            self._log("runner_error", payload)
            return payload
        except subprocess.TimeoutExpired:
            duration_ms = int((time.time() - started) * 1000)
            payload = {
                "success": False,
                "status": "timed_out",
                "error": f"Runner timed out after {timeout_ms} ms",
                "command": command,
                "sync": sync_summary,
                "durationMs": duration_ms,
                "stdoutFile": str(stdout_file),
                "stderrFile": str(stderr_file),
                "outputFile": str(stdout_file),
                "resultFile": str(result_file),
                "launchCommandFile": str(command_file),
            }
            result_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            self._log("runner_error", payload)
            return payload
        except Exception as exc:
            payload = {
                "success": False,
                "status": "failed",
                "error": f"Runner execution failed: {exc}",
                "command": command,
                "sync": sync_summary,
                "stdoutFile": str(stdout_file),
                "stderrFile": str(stderr_file),
                "outputFile": str(stdout_file),
                "resultFile": str(result_file),
                "launchCommandFile": str(command_file),
            }
            result_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            self._log("runner_error", payload)
            return payload

    def _public_task(self, task: Dict, include_output: bool = False) -> Dict:
        payload = {
            "id": task.get("id"),
            "status": task.get("status"),
            "createdAt": task.get("createdAt"),
            "startedAt": task.get("startedAt"),
            "finishedAt": task.get("finishedAt"),
            "error": task.get("error"),
            "resultFile": task.get("resultFile"),
            "taskDir": task.get("taskDir"),
        }
        if include_output:
            payload["result"] = task.get("result")
        return payload

    def _export_domain_cookie_envs(self, env: Dict[str, str], session_info: Dict):
        headers_by_domain = session_info.get("cookieHeadersByDomain")
        if not isinstance(headers_by_domain, dict):
            headers_by_domain = {}
        cookies_by_domain = session_info.get("cookiesByDomain")
        if not isinstance(cookies_by_domain, dict):
            cookies_by_domain = {}
        cookie_env_map = session_info.get("cookieEnvMap")
        if not isinstance(cookie_env_map, dict):
            cookie_env_map = {}

        normalized_env_map = {
            _normalize_cookie_domain(key): _normalize_env_name(value, _default_cookie_env_name(_normalize_cookie_domain(key)))
            for key, value in cookie_env_map.items()
            if _normalize_cookie_domain(key)
        }

        normalized_headers = {}
        normalized_cookies = {}
        for domain, value in headers_by_domain.items():
            key = _normalize_cookie_domain(domain)
            if not key:
                continue
            normalized_headers[key] = _normalize_text(value)
        for domain, value in cookies_by_domain.items():
            key = _normalize_cookie_domain(domain)
            if not key:
                continue
            normalized_cookies[key] = value if isinstance(value, list) else []

        for domain, header in normalized_headers.items():
            fallback = _default_cookie_env_name(domain)
            env_name = normalized_env_map.get(domain) or _normalize_env_name(None, fallback)
            env_payload = {
                "domain": domain,
                "cookieHeader": header,
                "cookies": normalized_cookies.get(domain, []),
            }
            env[env_name] = _json_dumps(env_payload)
            env[f"{env_name}_JSON"] = _json_dumps(normalized_cookies.get(domain, []))

        env["SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN"] = _json_dumps(normalized_headers)
        env["SKILL_RUNNER_COOKIES_BY_DOMAIN_JSON"] = _json_dumps(normalized_cookies)

    def _build_session_info(self, runner_input: Dict, context: Dict) -> Dict:
        session_info = {}
        if isinstance(runner_input, dict):
            candidate = runner_input.get("sessionInfo")
            if isinstance(candidate, dict):
                session_info = dict(candidate)

        source = context.get("source") if isinstance(context, dict) else {}
        if not isinstance(source, dict):
            source = {}

        if not session_info:
            session_info = {
                "cookies": source.get("cookies", []),
                "cookieHeader": source.get("cookieHeader", ""),
                "cookiesByDomain": source.get("cookiesByDomain", {}),
                "cookieHeadersByDomain": source.get("cookieHeadersByDomain", {}),
                "sessionStorageSnapshot": source.get("sessionStorageSnapshot", {}),
                "localStorageSnapshot": source.get("localStorageSnapshot", {}),
                "sessionInfoAllowed": source.get("sessionInfoAllowed", False),
                "cookieEnvMap": context.get("runnerCookieEnvMap", {}),
            }

        session_info["url"] = session_info.get("url") or source.get("url")
        session_info["title"] = session_info.get("title") or source.get("title")
        if not isinstance(session_info.get("cookies"), list):
            session_info["cookies"] = []
        if not isinstance(session_info.get("cookiesByDomain"), dict):
            session_info["cookiesByDomain"] = {}
        if not isinstance(session_info.get("cookieHeadersByDomain"), dict):
            session_info["cookieHeadersByDomain"] = {}
        if not isinstance(session_info.get("cookieEnvMap"), dict):
            session_info["cookieEnvMap"] = context.get("runnerCookieEnvMap", {}) if isinstance(context, dict) else {}
        if not isinstance(session_info.get("sessionStorageSnapshot"), dict):
            session_info["sessionStorageSnapshot"] = {}
        if not isinstance(session_info.get("localStorageSnapshot"), dict):
            session_info["localStorageSnapshot"] = {}
        session_info["cookieHeader"] = _normalize_text(session_info.get("cookieHeader"))
        session_info["sessionInfoAllowed"] = bool(session_info.get("sessionInfoAllowed"))
        return session_info

    def _build_prompt_from_runner_input(self, runner_input: Dict) -> str:
        request = runner_input.get("request") if isinstance(runner_input.get("request"), dict) else {}
        source = runner_input.get("source") if isinstance(runner_input.get("source"), dict) else {}
        page_content = runner_input.get("pageContent") if isinstance(runner_input.get("pageContent"), dict) else {}
        active_tab_info = runner_input.get("activeTabInfo") if isinstance(runner_input.get("activeTabInfo"), dict) else {}
        session_info = runner_input.get("sessionInfo") if isinstance(runner_input.get("sessionInfo"), dict) else {}
        skills = runner_input.get("skills")
        if not isinstance(skills, list):
            skills = []
        task_images = runner_input.get("taskImages")
        if not isinstance(task_images, list):
            task_images = []

        user_message = _normalize_text(runner_input.get("userMessage"))
        task_input = _normalize_text(runner_input.get("taskInput"))
        agent_instructions = _normalize_text(runner_input.get("agentInstructions"))

        session_allowed = bool(session_info.get("sessionInfoAllowed"))
        session_guidance = [
            "Session handling guidance:",
            "- Available env vars for auth/session:",
            "  - SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN: JSON map {domain: cookieHeader}.",
            "  - SKILL_RUNNER_COOKIES_BY_DOMAIN_JSON: JSON map {domain: [cookie objects]}.",
            "  - <DOMAIN>_COOKIES: JSON string {domain, cookieHeader, cookies}.",
            "  - <DOMAIN>_COOKIES_JSON: JSON array of cookies for that domain.",
            "  - SKILL_RUNNER_COOKIES_JSON: active-tab cookie array (legacy/compat).",
            "- Use curl when a direct HTTP call is enough:",
            "  - Read cookie header from SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN or <DOMAIN>_COOKIES.",
            "  - Call: curl -H \"Cookie: <header>\" <url>.",
            "- Use a script (Playwright/Python/Node) when multi-step login/stateful flows are needed:",
            "  - Parse <DOMAIN>_COOKIES or <DOMAIN>_COOKIES_JSON and set cookies programmatically.",
            "  - Reuse those cookies across steps instead of re-authenticating.",
            "- Treat cookies/session as sensitive and avoid echoing full secrets in output.",
        ]
        if not session_allowed:
            session_guidance.append("- Session info is not trusted/allowed for this request; continue without authenticated cookie replay.")

        sections = [
            "You are running inside the skill launcher contract.",
            "",
            "Request metadata:",
            _json_dumps({
                "mode": request.get("mode"),
                "requestName": request.get("requestName"),
                "model": request.get("model"),
                "source": {
                    "type": source.get("type"),
                    "url": source.get("url"),
                    "title": source.get("title"),
                }
            }),
            "",
            "Selected skills:",
            _json_dumps(skills),
            "",
            "Page content:",
            _json_dumps({
                "text": page_content.get("text", ""),
                "headings": page_content.get("headings", []),
                "meta": page_content.get("meta", {}),
                "links": page_content.get("links", []),
            }),
            "",
            "Active tab info:",
            _json_dumps(active_tab_info),
            "",
            "Session info:",
            _json_dumps(session_info),
            "",
            "\n".join(session_guidance),
            "",
        ]

        if agent_instructions:
            sections.extend([
                "Agent instructions:",
                agent_instructions,
                "",
            ])

        if task_input:
            sections.extend([
                "Task input:",
                task_input,
                "",
            ])

        if task_images:
            sections.extend([
                "Task images:",
                _json_dumps(task_images),
                "",
            ])

        sections.extend([
            "User message:",
            user_message or "(empty user message)",
        ])
        return "\n".join(sections)

    def _sync_skills_cached(self, skills_config: Dict, runner: str) -> Dict:
        repository_url = _normalize_text(skills_config.get("repositoryUrl"))
        key = f"{runner}|{repository_url}|{bool(skills_config.get('repositoryEnabled', True))}"
        now = time.time()
        cached = self._skills_sync_cache.get(key)
        if cached and (now - cached.get("ts", 0)) < 300:
            return cached.get("value", {"status": "ok", "cached": True})
        result = self.sync_skills(skills_config, runner)
        self._skills_sync_cache[key] = {"ts": now, "value": result}
        return result

    def sync_skills(self, skills_config: Dict, runner: str) -> Dict:
        repository_enabled = bool(skills_config.get("repositoryEnabled", True))
        repository_url = _normalize_text(skills_config.get("repositoryUrl"))
        if not repository_enabled:
            return {"status": "skipped", "reason": "repository disabled", "count": 0}
        if not repository_url:
            return {"status": "skipped", "reason": "repository URL missing", "count": 0}

        try:
            package_urls = self._discover_skill_urls(repository_url)
        except Exception as exc:
            return {"status": "error", "error": f"Failed to discover .skill packages: {exc}", "count": 0}

        runner_dir = self._runner_skills_dir(runner)
        runner_dir.mkdir(parents=True, exist_ok=True)

        extracted = []
        warnings = []
        for url in package_urls:
            try:
                package_bytes = self._http_get_bytes(url)
                package_name = _safe_name(Path(url.split("?", 1)[0]).name)
                with tempfile.TemporaryDirectory(prefix="skillpkg-", dir=str(runner_dir)) as tmp_dir:
                    tmp_path = Path(tmp_dir)
                    skill_name, skill_root_dir = self._extract_skill_package(package_bytes, tmp_path)
                    target_dir = runner_dir / _safe_name(skill_name)
                    if target_dir.exists():
                        shutil.rmtree(target_dir, ignore_errors=True)
                    shutil.copytree(skill_root_dir, target_dir)
                    skill_path = self._find_skill_file(target_dir)

                extracted.append(
                    {
                        "url": url,
                        "package": package_name,
                        "skillName": skill_name,
                        "skillPath": str(skill_path),
                    }
                )
            except Exception as exc:
                warnings.append(f"{url}: {exc}")

        state = {
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "runner": runner,
            "repositoryUrl": repository_url,
            "count": len(extracted),
            "packages": extracted,
            "warnings": warnings,
        }
        state_file = self._runner_state_file(runner)
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps(state, indent=2), encoding="utf-8")
        self._log("skills_sync_state", state)
        return {"status": "ok", **state}

    def _runner_skills_dir(self, runner: str) -> Path:
        return self._runner_root_dir(runner) / "skills"

    def _runner_root_dir(self, runner: str) -> Path:
        runner_key = _safe_name(runner).lower()
        if runner_key == "copilot":
            return self.launcher_root / ".copilot"
        if runner_key == "cursor":
            return self.launcher_root / ".cursor"
        return self.launcher_root / ".claude"

    def _runner_state_file(self, runner: str) -> Path:
        return self._runner_root_dir(runner) / "skills-state.json"

    def _build_command(self, runner: str, prompt_arg: str, prompt: str) -> List[str]:
        runner_key = runner.lower()
        env_override = os.environ.get(f"SKILL_RUNNER_COMMAND_{runner_key.upper()}")
        if env_override:
            template = shlex.split(env_override)
        else:
            template = self.runner_commands.get(runner_key) or self.runner_commands["claude"]

        variables = {
            "promptArg": prompt_arg,
            "prompt": prompt,
        }
        return [part.format(**variables) for part in template]

    def _discover_skill_urls(self, repository_url: str) -> List[str]:
        base_url = repository_url if repository_url.endswith("/") else repository_url + "/"
        response_bytes, content_type = self._http_get(base_url)
        text = response_bytes.decode("utf-8", errors="replace")
        links = []

        if "application/json" in content_type:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                links = [item for item in parsed if isinstance(item, str)]
            elif isinstance(parsed, dict) and isinstance(parsed.get("skills"), list):
                links = [item for item in parsed["skills"] if isinstance(item, str)]
        else:
            links.extend(re.findall(r'href\s*=\s*["\']([^"\']+\.skill(?:\?[^"\']*)?)["\']', text, flags=re.IGNORECASE))
            if not links:
                links.extend(
                    line.strip()
                    for line in text.splitlines()
                    if line.strip().lower().endswith(".skill")
                )

        resolved = []
        seen = set()
        for link in links:
            full = urljoin(base_url, link.strip())
            if ".skill" not in full.lower():
                continue
            if full not in seen:
                seen.add(full)
                resolved.append(full)
        return resolved

    def _extract_skill_package(self, package_bytes: bytes, extract_dir: Path) -> Tuple[str, Path]:
        with zipfile.ZipFile(io.BytesIO(package_bytes), "r") as archive:
            self._safe_extract_zip(archive, extract_dir)

        candidates = self._find_skill_candidates(extract_dir)
        if not candidates:
            raise RuntimeError("Package does not contain SKILL.md")
        skill_file = candidates[0]
        text = skill_file.read_text(encoding="utf-8", errors="replace")
        skill_name = self._parse_skill_name(text) or skill_file.parent.name
        return skill_name, skill_file.parent

    def _find_skill_candidates(self, root: Path) -> List[Path]:
        return list(root.rglob("SKILL.md")) + list(root.rglob("SKILL.MD"))

    def _find_skill_file(self, root: Path) -> Path:
        candidates = self._find_skill_candidates(root)
        if not candidates:
            raise RuntimeError(f"No SKILL.md found under {root}")
        return candidates[0]

    def _parse_skill_name(self, content: str) -> Optional[str]:
        if not content.startswith("---"):
            return None
        match = re.search(r"^name\s*:\s*([^\n\r]+)$", content, flags=re.MULTILINE)
        if not match:
            return None
        return match.group(1).strip().strip("'\"")

    def _safe_extract_zip(self, archive: zipfile.ZipFile, target_dir: Path) -> None:
        for member in archive.infolist():
            member_path = target_dir / member.filename
            resolved = member_path.resolve()
            if not str(resolved).startswith(str(target_dir.resolve())):
                raise RuntimeError(f"Unsafe path in zip: {member.filename}")
            if member.is_dir():
                resolved.mkdir(parents=True, exist_ok=True)
                continue
            resolved.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member, "r") as src, open(resolved, "wb") as dst:
                dst.write(src.read())

    def _http_get_bytes(self, url: str) -> bytes:
        data, _ = self._http_get(url)
        return data

    def _http_get(self, url: str) -> Tuple[bytes, str]:
        request = Request(url, method="GET", headers={"User-Agent": "skill-launcher/1.0"})
        try:
            with urlopen(request, timeout=30) as response:
                return response.read(), response.headers.get("content-type", "").lower()
        except HTTPError as exc:
            raise RuntimeError(f"HTTP {exc.code}") from exc
        except URLError as exc:
            raise RuntimeError(str(exc)) from exc

    def _log(self, event: str, data: object) -> None:
        if not self.verbose:
            return
        try:
            payload = {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "event": event,
                "data": data,
            }
            with open(self.log_file, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
        except Exception:
            pass
