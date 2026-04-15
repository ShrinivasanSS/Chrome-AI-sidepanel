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
from urllib.parse import urljoin, urlparse, parse_qs
from urllib.request import Request, urlopen


DEFAULT_RUNNER_COMMANDS = {
    "claude": ["claude", "--dangerously-skip-permissions","--print", "{prompt}"],
    "copilot": ["copilot", "--yolo", "{prompt}"],
    "cursor": ["agent", "-p", "{prompt}"],
    "cline": ["cline", "-v", "--yolo", "{prompt}"],
}

# Continue commands for runners that support task resumption.
# {taskId} is replaced with the task ID extracted from the first run's output.
# Only runners listed here support continuation; others always launch fresh.
DEFAULT_RUNNER_CONTINUE_COMMANDS = {
    "cline": ["cline", "-v", "--yolo", "-T", "{taskId}", "{prompt}"],
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


def _normalize_env_name(value: object, fallback: str) -> str:
    name = _normalize_text(value).upper()
    name = re.sub(r"[^A-Z0-9_]", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    if not name:
        name = fallback
    if re.match(r"^[0-9]", name):
        name = f"COOKIES_{name}"
    return name


def _default_cookie_env_name(domain: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", domain.upper()).strip("_")
    base = normalized or "DOMAIN"
    return f"{base}_COOKIES"


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
        self.runner_continue_commands = dict(DEFAULT_RUNNER_CONTINUE_COMMANDS)
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
            prompt = self._build_prompt_from_runner_input(runner_input, task_dir=self.tasks_root / task_id)

        if not prompt:
            return {"success": False, "status": "failed", "error": "Missing prompt"}

        task_dir = self.tasks_root / task_id
        task_dir.mkdir(parents=True, exist_ok=True)
        request_file = task_dir / "request.json"
        prompt_file = task_dir / "prompt.txt"
        stdout_file = task_dir / "stdout.txt"
        stderr_file = task_dir / "stderr.txt"
        result_file = task_dir / "result.json"
        command_file = task_dir / "launch-command.json"
        request_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        prompt_file.write_text(prompt, encoding="utf-8")

        sync_summary = self._sync_skills_cached(skills_config, runner)

        # Check if this is a continuation of a previous runner task
        continue_task_id = _normalize_text(payload.get("continueTaskId"))
        if continue_task_id and self._supports_continuation(runner):
            continue_cmd = self._build_continue_command(runner, prompt_arg, prompt, continue_task_id)
            if continue_cmd:
                command = continue_cmd
                self._log("runner_continuation", {
                    "taskId": task_id,
                    "continueTaskId": continue_task_id,
                    "runner": runner,
                    "command": continue_cmd,
                })
            else:
                command = self._build_command(runner, prompt_arg, prompt)
        else:
            command = self._build_command(runner, prompt_arg, prompt)
        skills_dir = self._runner_skills_dir(runner)
        shared_dir = self._runner_shared_dir(runner)
        command_file.write_text(json.dumps({
            "taskId": task_id,
            "runner": runner,
            "promptArg": prompt_arg,
            "command": command,
            "commandText": " ".join(shlex.quote(part) for part in command),
            "promptFile": str(prompt_file),
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }, indent=2), encoding="utf-8")

        env = os.environ.copy()
        env["SKILL_RUNNER_TYPE"] = runner
        env["SKILL_RUNNER_SKILLS_DIR"] = str(skills_dir)
        env["SKILL_RUNNER_WORKDIR"] = str(self.launcher_root)

        # Set AGENT_SHARED_PATH for skill scripts that import shared libraries
        if shared_dir.exists():
            env["AGENT_SHARED_PATH"] = str(shared_dir)

        # Export structured data as env vars (keeps prompt small)
        self._export_structured_env(env, runner_input, context)

        # Export cookie/session env vars
        session_info = self._build_session_info(runner_input, context)
        cookies = session_info.get("cookies")
        if not isinstance(cookies, list):
            cookies = []
            session_info["cookies"] = cookies
        env["SKILL_RUNNER_COOKIES_JSON"] = _json_dumps(cookies)

        # Set SKILL_RUNNER_COOKIE_HEADER (active-tab cookie header for legacy/compat)
        cookie_header = _normalize_text(session_info.get("cookieHeader"))
        if cookie_header:
            env["SKILL_RUNNER_COOKIE_HEADER"] = cookie_header

        # Export active-domain env vars (SKILL_RUNNER_COOKIES, SKILL_RUNNER_REQUEST_HEADERS)
        self._export_active_domain_envs(env, session_info)

        # Export per-domain cookie env vars (<DOMAIN>_COOKIES etc.)
        self._export_domain_cookie_envs(env, session_info)

        # Export standard request headers for curl/python usage
        request_headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.5",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
        }
        env["SKILL_RUNNER_REQUEST_HEADERS_JSON"] = _json_dumps(request_headers)

        log_env = {
            key: env.get(key, "")
            for key in (
                "SKILL_RUNNER_TYPE",
                "SKILL_RUNNER_SKILLS_DIR",
                "SKILL_RUNNER_WORKDIR",
                "AGENT_SHARED_PATH",
                "SKILL_RUNNER_COOKIE_HEADER",
                "SKILL_RUNNER_COOKIES_JSON",
                "SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN",
                "SKILL_RUNNER_SESSION_ALLOWED",
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

            # Extract runner task ID for continuation support
            extracted_task_id = self._extract_runner_task_id(stdout, runner)

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
                "runnerTaskId": extracted_task_id,
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

    def _export_active_domain_envs(self, env: Dict[str, str], session_info: Dict):
        """Export cookie/header env vars for the active domain only.

        Sets:
        - SKILL_RUNNER_ACTIVE_DOMAIN
        - SKILL_RUNNER_COOKIES (cookie header string)
        - SKILL_RUNNER_REQUEST_HEADERS (JSON headers)
        """
        headers_by_domain = session_info.get("cookieHeadersByDomain")
        if not isinstance(headers_by_domain, dict):
            headers_by_domain = {}
        request_headers_by_domain = session_info.get("requestHeadersByDomain")
        if not isinstance(request_headers_by_domain, dict):
            request_headers_by_domain = {}

        active_domain = _normalize_cookie_domain(session_info.get("activeDomain") or session_info.get("url"))
        if not active_domain and len(headers_by_domain) == 1:
            only_domain = next(iter(headers_by_domain.keys()))
            active_domain = _normalize_cookie_domain(only_domain)
        if active_domain:
            env["SKILL_RUNNER_ACTIVE_DOMAIN"] = active_domain

        cookie_header = ""
        if headers_by_domain:
            for domain, value in headers_by_domain.items():
                if _normalize_cookie_domain(domain) == active_domain:
                    cookie_header = _normalize_text(value)
                    break
        if not cookie_header:
            cookie_header = _normalize_text(session_info.get("cookieHeader"))
        if cookie_header:
            env["SKILL_RUNNER_COOKIES"] = cookie_header

        request_headers = {}
        if request_headers_by_domain:
            for domain, value in request_headers_by_domain.items():
                if _normalize_cookie_domain(domain) == active_domain and isinstance(value, dict):
                    request_headers = value
                    break

        if not request_headers:
            request_headers = {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-GB,en;q=0.5",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
            }

        env["SKILL_RUNNER_REQUEST_HEADERS"] = _json_dumps(request_headers)

    def _export_domain_cookie_envs(self, env: Dict[str, str], session_info: Dict):
        """Export per-domain cookie env vars using the cookieEnvMap from settings.

        Sets for each trusted domain:
        - <ENV_NAME> (JSON with domain, cookieHeader, cookies)
        - <ENV_NAME>_JSON (JSON cookie array)
        - SKILL_RUNNER_COOKIE_HEADERS_BY_DOMAIN (JSON {domain: cookieHeader})
        - SKILL_RUNNER_COOKIES_BY_DOMAIN_JSON (JSON {domain: [cookies]})
        """
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

    def _export_structured_env(self, env: Dict[str, str], runner_input: Dict, context: Dict):
        """Export bulk structured data as env vars so the CLI prompt stays small."""
        if not isinstance(runner_input, dict):
            runner_input = {}
        if not isinstance(context, dict):
            context = {}

        # Request metadata
        request = runner_input.get("request") if isinstance(runner_input.get("request"), dict) else {}
        env["SKILL_RUNNER_REQUEST_MODE"] = _normalize_text(request.get("mode"))
        env["SKILL_RUNNER_REQUEST_NAME"] = _normalize_text(request.get("requestName"))
        env["SKILL_RUNNER_REQUEST_MODEL"] = _normalize_text(request.get("model"))

        # Source / active tab info + derive origin for scripts
        source = runner_input.get("source") if isinstance(runner_input.get("source"), dict) else {}
        source_url = _normalize_text(source.get("url"))
        env["SKILL_RUNNER_SOURCE_TYPE"] = _normalize_text(source.get("type"))
        env["SKILL_RUNNER_SOURCE_URL"] = source_url
        env["SKILL_RUNNER_SOURCE_TITLE"] = _normalize_text(source.get("title"))

        # Derive origin (scheme + hostname) from source URL for domain-specific scripts
        if source_url:
            try:
                from urllib.parse import urlparse
                parsed_url = urlparse(source_url)
                if parsed_url.hostname:
                    origin = f"{parsed_url.scheme}://{parsed_url.hostname}"
                    env["SKILL_RUNNER_SOURCE_ORIGIN"] = origin
                    # Auto-set SITE24X7_DOMAIN if the active tab is on a site24x7 domain
                    hostname_lower = parsed_url.hostname.lower()
                    if "site24x7" in hostname_lower:
                        # e.g. site24x7.com, site24x7.eu, site24x7.cn, site24x7.in
                        # Derive the www base: https://www.site24x7.eu
                        tld = hostname_lower.split("site24x7")[-1].lstrip(".")
                        site24x7_domain = f"https://www.site24x7.{tld}" if tld else "https://www.site24x7.com"
                        env["SITE24X7_DOMAIN"] = site24x7_domain
            except Exception:
                pass

        active_tab = runner_input.get("activeTabInfo") if isinstance(runner_input.get("activeTabInfo"), dict) else {}
        env["SKILL_RUNNER_ACTIVE_TAB_JSON"] = _json_dumps(active_tab)

        # Page content (full text, headings, meta, links) — exported as JSON env var
        page_content = runner_input.get("pageContent") if isinstance(runner_input.get("pageContent"), dict) else {}
        env["SKILL_RUNNER_PAGE_CONTENT_JSON"] = _json_dumps(page_content)

        # Session info (full object for scripts that need it)
        session_info = runner_input.get("sessionInfo") if isinstance(runner_input.get("sessionInfo"), dict) else {}
        env["SKILL_RUNNER_SESSION_INFO_JSON"] = _json_dumps(session_info)
        env["SKILL_RUNNER_SESSION_ALLOWED"] = "1" if session_info.get("sessionInfoAllowed") else "0"

        # Selected skills metadata
        skills = runner_input.get("skills") if isinstance(runner_input.get("skills"), list) else []
        env["SKILL_RUNNER_SELECTED_SKILLS_JSON"] = _json_dumps(skills)

        # Agent instructions (can be large)
        agent_instructions = _normalize_text(runner_input.get("agentInstructions"))
        if agent_instructions:
            env["SKILL_RUNNER_AGENT_INSTRUCTIONS"] = agent_instructions

        # Additional instructions forwarded from the extension UI
        additional_instructions = _normalize_text(runner_input.get("additionalInstructions"))
        if additional_instructions:
            env["SKILL_RUNNER_ADDITIONAL_INSTRUCTIONS"] = additional_instructions

        # Task images list
        task_images = runner_input.get("taskImages") if isinstance(runner_input.get("taskImages"), list) else []
        if task_images:
            env["SKILL_RUNNER_TASK_IMAGES_JSON"] = _json_dumps(task_images)

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
                "requestHeadersByDomain": source.get("requestHeadersByDomain", {}),
                "sessionStorageSnapshot": source.get("sessionStorageSnapshot", {}),
                "localStorageSnapshot": source.get("localStorageSnapshot", {}),
                "sessionInfoAllowed": source.get("sessionInfoAllowed", False),
                "activeDomain": source.get("activeDomain", ""),
                "cookieEnvMap": context.get("runnerCookieEnvMap", {}),
            }

        session_info["url"] = session_info.get("url") or source.get("url")
        session_info["title"] = session_info.get("title") or source.get("title")
        if "requestHeadersByDomain" not in session_info:
            session_info["requestHeadersByDomain"] = source.get("requestHeadersByDomain", {})
        if "activeDomain" not in session_info:
            session_info["activeDomain"] = source.get("activeDomain", "")
        if not isinstance(session_info.get("cookies"), list):
            session_info["cookies"] = []
        if not isinstance(session_info.get("cookiesByDomain"), dict):
            session_info["cookiesByDomain"] = {}
        if not isinstance(session_info.get("cookieHeadersByDomain"), dict):
            session_info["cookieHeadersByDomain"] = {}
        if not isinstance(session_info.get("requestHeadersByDomain"), dict):
            session_info["requestHeadersByDomain"] = {}
        if not isinstance(session_info.get("activeDomain"), str):
            session_info["activeDomain"] = ""
        if not isinstance(session_info.get("sessionStorageSnapshot"), dict):
            session_info["sessionStorageSnapshot"] = {}
        if not isinstance(session_info.get("localStorageSnapshot"), dict):
            session_info["localStorageSnapshot"] = {}
        session_info["cookieHeader"] = _normalize_text(session_info.get("cookieHeader"))
        session_info["sessionInfoAllowed"] = bool(session_info.get("sessionInfoAllowed"))
        return session_info
    
    def _extract_page_context_info(self, url: str, page_text: str) -> Dict:
        """Extract user context fields (UserID, UniqueID, timezone) from URL query params
        and page content text. Returns a dict with any found values."""
        info = {}

        # --- Extract from URL query parameters ---
        if url:
            try:
                parsed = urlparse(url)
                params = parse_qs(parsed.query, keep_blank_values=False)
                # Common param names for user/account identifiers
                for key in ("userId", "userid", "user_id", "uid", "accountId", "account_id"):
                    if key in params:
                        info["userId"] = params[key][0]
                        break
                for key in ("uniqueId", "uniqueid", "unique_id", "uuid", "sessionId", "session_id"):
                    if key in params:
                        info["uniqueId"] = params[key][0]
                        break
                for key in ("timezone", "tz", "timeZone", "time_zone"):
                    if key in params:
                        info["timezone"] = params[key][0]
                        break
            except Exception:
                pass

        # --- Extract from page text (scan for labelled values) ---
        if page_text:
            # UserID patterns: "User ID: 12345", "userId: abc123", "Account ID: ..."
            if "userId" not in info:
                m = re.search(
                    r"(?:user\s*id|userid|account\s*id|accountid)\s*[:\-]\s*([A-Za-z0-9_@.\-]+)",
                    page_text, re.IGNORECASE
                )
                if m:
                    info["userId"] = m.group(1).strip()

            # UniqueID / UUID patterns
            if "uniqueId" not in info:
                m = re.search(
                    r"(?:unique\s*id|uniqueid|uuid|session\s*id|sessionid)\s*[:\-]\s*([A-Za-z0-9_\-]+)",
                    page_text, re.IGNORECASE
                )
                if m:
                    info["uniqueId"] = m.group(1).strip()

            # Timezone patterns: "Timezone: Asia/Kolkata", "Time Zone: UTC+5:30"
            if "timezone" not in info:
                m = re.search(
                    r"(?:time\s*zone|timezone|tz)\s*[:\-]\s*([A-Za-z0-9/_+\-:]+)",
                    page_text, re.IGNORECASE
                )
                if m:
                    info["timezone"] = m.group(1).strip()

        return info

    def _extract_href_info(self, page_text: str, limit: int = 10) -> str:
        """Extract query parameters from <a href="..."> tags in page text.

        Parses up to `limit` href tags, extracts each (path, param, value) triple,
        and deduplicates by (param, value). Returns a CSV-like table string, or
        empty string if nothing found.
        """
        if not page_text:
            return ""

        # Find all href values in <a href="..."> tags
        href_pattern = re.compile(r'<a\s[^>]*href\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
        hrefs = href_pattern.findall(page_text)

        if not hrefs:
            return ""

        rows = []
        seen_param_values: set = set()

        for href in hrefs[:limit]:
            try:
                parsed = urlparse(href)
                path = parsed.path.strip("/").split("/")[-1] if parsed.path else ""
                if not path or not parsed.query:
                    continue
                params = parse_qs(parsed.query, keep_blank_values=False)
                for param_name, values in params.items():
                    for value in values:
                        key = (param_name, value)
                        if key in seen_param_values:
                            continue
                        seen_param_values.add(key)
                        rows.append((path, param_name, value))
            except Exception:
                continue

        if not rows:
            return ""

        lines = ["Link_Paths, Params, Value"]
        for path, param, value in rows:
            lines.append(f"{path}, {param}, {value}")
        return "\n".join(lines)

    def _build_prompt_from_runner_input(self, runner_input: Dict, task_dir: Optional[Path] = None) -> str:
        """Build an ultra-slim prompt for CLI runners (claude --print).

        DESIGN PRINCIPLES:
        - Only the user's question and page content reference go in the prompt.
        - Page content is written to a file (page-content.txt) and the file path is
          referenced in the prompt — never embedded inline — to avoid OS command-line
          length limits and slow runner startup.
        - Cookies, session data, metadata are in env vars only (for scripts/curl).
        - Skill names are listed so the runner knows which SKILL.md files to use.
        - Active tab origin is included so the runner knows the target domain.
        - Brief curl guidance so runner can make authenticated requests without scripts.
        """
        source = runner_input.get("source") if isinstance(runner_input.get("source"), dict) else {}
        page_content = runner_input.get("pageContent") if isinstance(runner_input.get("pageContent"), dict) else {}
        skills = runner_input.get("skills")
        if not isinstance(skills, list):
            skills = []

        user_message = _normalize_text(runner_input.get("userMessage"))
        task_input = _normalize_text(runner_input.get("taskInput"))

        # Compact skill name list
        skill_names = [s.get("name", "unknown") if isinstance(s, dict) else str(s) for s in skills]

        # Derive origin from source URL
        source_url = _normalize_text(source.get("url"))
        source_title = _normalize_text(source.get("title"))
        source_origin = ""
        if source_url:
            try:
                from urllib.parse import urlparse
                parsed = urlparse(source_url)
                source_origin = f"{parsed.scheme}://{parsed.hostname}" if parsed.hostname else ""
            except Exception:
                pass

        sections = []

        # Skill usage instruction (brief)
        if skill_names:
            sections.append(f"Use available skills: {', '.join(skill_names)}")
            sections.append("Read the SKILL.md files for instructions. Run scripts from the skills directory.")
            sections.append("")

        # Active tab context
        if source_url:
            sections.append(f"Active tab: {source_title} ({source_url})" if source_title else f"Active tab: {source_url}")
            if source_origin:
                sections.append(f"Origin: {source_origin}")

        # Authenticated request guidance with concrete examples
        if source_url:
            target = source_origin or source_url
            sections.append("")
            sections.append("For authenticated HTTP requests, use env vars directly (never type out values):")
            sections.append(f"  curl -b \"$SKILL_RUNNER_COOKIES\" {target}/api/endpoint")
            sections.append("Request headers are in $SKILL_RUNNER_REQUEST_HEADERS (JSON object).")
            sections.append("Scripts in skills/ handle cookies and headers from env vars automatically.")
            sections.append("")

        # Write page text to a file and reference the path — never embed inline
        page_text = _normalize_text(page_content.get("text"))
        if page_text:
            if task_dir is not None:
                try:
                    task_dir.mkdir(parents=True, exist_ok=True)
                    page_content_file = task_dir / "page-content.txt"
                    href_info = self._extract_href_info(page_text)
                    if href_info:
                        file_content = (
                            "--- Extracted Href Parameters ---\n"
                            + href_info
                            + "\n--- End Extracted Href Parameters ---\n\n"
                            + page_text
                        )
                    else:
                        file_content = page_text
                    page_content_file.write_text(file_content, encoding="utf-8")
                    sections.append(f"Page content is available at: {page_content_file}")
                    sections.append("Read that file to understand the current page context before answering.")
                    sections.append("")
                except Exception:
                    # Fallback: embed truncated text if file write fails
                    if len(page_text) > 4000:
                        page_text = page_text[:4000] + "\n...(truncated)"
                    sections.extend(["Page content:", page_text, ""])
            else:
                # No task dir available — embed truncated text as fallback
                if len(page_text) > 4000:
                    page_text = page_text[:4000] + "\n...(truncated)"
                sections.extend(["Page content:", page_text, ""])

        # Extract user context (UserID, UniqueID, timezone) from URL + page text
        page_context = self._extract_page_context_info(source_url, page_text)
        if page_context:
            context_lines = ["User context extracted from page:"]
            if page_context.get("userId"):
                context_lines.append(f"  User ID: {page_context['userId']}")
            if page_context.get("uniqueId"):
                context_lines.append(f"  Unique ID: {page_context['uniqueId']}")
            if page_context.get("timezone"):
                context_lines.append(f"  Timezone: {page_context['timezone']}")
            sections.extend(context_lines)
            sections.append("")

        # Additional instructions forwarded from the extension UI
        additional_instructions = _normalize_text(runner_input.get("additionalInstructions"))
        if additional_instructions:
            sections.append("Additional instructions:")
            sections.append(additional_instructions)
            sections.append("")

        # The actual user task
        if task_input and task_input != user_message:
            sections.append(task_input)

        sections.append(user_message or "(empty user message)")

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
            package_urls, shared_urls = self._discover_repo_urls(repository_url)
        except Exception as exc:
            return {"status": "error", "error": f"Failed to discover packages: {exc}", "count": 0}

        runner_dir = self._runner_skills_dir(runner)
        runner_dir.mkdir(parents=True, exist_ok=True)

        # Extract shared library packages first (e.g. shared.zip)
        shared_dir = self._runner_shared_dir(runner)
        shared_warnings = []
        for url in shared_urls:
            try:
                shared_bytes = self._http_get_bytes(url)
                self._extract_shared_package(shared_bytes, shared_dir)
            except Exception as exc:
                shared_warnings.append(f"shared {url}: {exc}")

        extracted = []
        warnings = list(shared_warnings)
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
            "sharedDir": str(shared_dir) if shared_dir.exists() else None,
            "sharedPackages": len(shared_urls),
            "warnings": warnings,
        }
        state_file = self._runner_state_file(runner)
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps(state, indent=2), encoding="utf-8")
        self._log("skills_sync_state", state)
        return {"status": "ok", **state}

    def _runner_skills_dir(self, runner: str) -> Path:
        return self._runner_root_dir(runner) / "skills"

    def _runner_shared_dir(self, runner: str) -> Path:
        return self._runner_root_dir(runner) / "shared"

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

    def _build_continue_command(self, runner: str, prompt_arg: str, prompt: str, task_id: str) -> Optional[List[str]]:
        """Build a continue command for runners that support task resumption.

        Returns None if the runner does not have a continue command template.
        """
        runner_key = runner.lower()
        template = self.runner_continue_commands.get(runner_key)
        if not template:
            return None

        variables = {
            "promptArg": prompt_arg,
            "prompt": prompt,
            "taskId": task_id,
        }
        try:
            return [part.format(**variables) for part in template]
        except (KeyError, IndexError):
            return None

    @staticmethod
    def _extract_runner_task_id(stdout: str, runner: str) -> Optional[str]:
        """Extract a runner task ID from the first output of a CLI runner.

        For Cline, the task ID is typically the first non-empty line of stdout.
        The format may be a bare UUID/ID or prefixed like "Task ID: xxx".
        """
        if not stdout:
            return None

        runner_key = runner.lower()
        lines = [line.strip() for line in stdout.strip().splitlines() if line.strip()]
        if not lines:
            return None

        if runner_key == "cline":
            first_line = lines[0]
            # Check for "Task ID: <id>" pattern
            m = re.match(r"(?:task\s*id\s*[:\-]\s*)(.+)", first_line, re.IGNORECASE)
            if m:
                return m.group(1).strip()
            # If first line looks like a bare ID (alphanumeric, hyphens, underscores)
            if re.match(r"^[A-Za-z0-9_\-]{4,}$", first_line):
                return first_line
            # Fallback: scan first few lines for a task ID pattern
            for line in lines[:5]:
                m = re.search(r"(?:task[_\-\s]*id\s*[:\-=]\s*)([A-Za-z0-9_\-]+)", line, re.IGNORECASE)
                if m:
                    return m.group(1).strip()

        return None

    def _supports_continuation(self, runner: str) -> bool:
        """Check if a runner has a continue command template."""
        return runner.lower() in self.runner_continue_commands

    def _discover_repo_urls(self, repository_url: str) -> Tuple[List[str], List[str]]:
        """Discover both .skill package URLs and shared .zip URLs from a repository listing.

        Returns (skill_urls, shared_urls) tuple.
        Shared packages are identified by:
        - JSON listing: "shared" array or links containing "shared" in name
        - HTML/text listing: links ending in .zip with "shared" in the name
        """
        base_url = repository_url if repository_url.endswith("/") else repository_url + "/"
        response_bytes, content_type = self._http_get(base_url)
        text = response_bytes.decode("utf-8", errors="replace")
        skill_links = []
        shared_links = []

        if "application/json" in content_type:
            parsed = json.loads(text)
            all_links = []
            if isinstance(parsed, list):
                all_links = [item for item in parsed if isinstance(item, str)]
            elif isinstance(parsed, dict):
                if isinstance(parsed.get("skills"), list):
                    all_links = [item for item in parsed["skills"] if isinstance(item, str)]
                if isinstance(parsed.get("shared"), list):
                    shared_links.extend(item for item in parsed["shared"] if isinstance(item, str))
            for link in all_links:
                lower = link.lower()
                if lower.endswith(".skill") or ".skill?" in lower:
                    skill_links.append(link)
                elif lower.endswith(".zip") and "shared" in lower:
                    shared_links.append(link)
        else:
            # Discover .skill links
            skill_links.extend(re.findall(r'href\s*=\s*["\']([^"\']+\.skill(?:\?[^"\']*)?)["\']', text, flags=re.IGNORECASE))
            if not skill_links:
                skill_links.extend(
                    line.strip()
                    for line in text.splitlines()
                    if line.strip().lower().endswith(".skill")
                )
            # Discover shared .zip links
            zip_hrefs = re.findall(r'href\s*=\s*["\']([^"\']+\.zip(?:\?[^"\']*)?)["\']', text, flags=re.IGNORECASE)
            for href in zip_hrefs:
                if "shared" in href.lower():
                    shared_links.append(href)
            if not shared_links:
                for line in text.splitlines():
                    stripped = line.strip()
                    if stripped.lower().endswith(".zip") and "shared" in stripped.lower():
                        shared_links.append(stripped)

        # Resolve skill URLs
        skill_resolved = []
        seen = set()
        for link in skill_links:
            full = urljoin(base_url, link.strip())
            if full not in seen:
                seen.add(full)
                skill_resolved.append(full)

        # Resolve shared URLs
        shared_resolved = []
        shared_seen = set()
        for link in shared_links:
            full = urljoin(base_url, link.strip())
            if full not in shared_seen:
                shared_seen.add(full)
                shared_resolved.append(full)

        return skill_resolved, shared_resolved

    def _discover_skill_urls(self, repository_url: str) -> List[str]:
        """Legacy compatibility wrapper."""
        skill_urls, _ = self._discover_repo_urls(repository_url)
        return skill_urls

    def _extract_shared_package(self, package_bytes: bytes, shared_dir: Path) -> None:
        """Extract a shared library ZIP into the runner's shared/ directory.

        The contents are merged into shared_dir (existing files are overwritten).
        This supports the convention where skill scripts import from
        AGENT_SHARED_PATH (e.g. ``from base_script import call_api``).
        """
        shared_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(package_bytes), "r") as archive:
            # Check for a single top-level directory wrapper (e.g. shared/)
            top_dirs = set()
            for info in archive.infolist():
                parts = info.filename.split("/", 1)
                if len(parts) > 1:
                    top_dirs.add(parts[0])
            single_wrapper = len(top_dirs) == 1

            for member in archive.infolist():
                filename = member.filename
                # Strip single top-level wrapper directory if present
                if single_wrapper:
                    prefix = next(iter(top_dirs)) + "/"
                    if filename.startswith(prefix):
                        filename = filename[len(prefix):]
                    elif filename.rstrip("/") == next(iter(top_dirs)):
                        continue  # skip the wrapper dir itself

                if not filename or filename.endswith("/"):
                    target = shared_dir / filename
                    target.mkdir(parents=True, exist_ok=True)
                    continue

                target = shared_dir / filename
                resolved = target.resolve()
                if not str(resolved).startswith(str(shared_dir.resolve())):
                    continue  # skip unsafe paths

                resolved.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member, "r") as src, open(resolved, "wb") as dst:
                    dst.write(src.read())

        self._log("shared_package_extracted", {"sharedDir": str(shared_dir)})

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
