import io
import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
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
        self.runner_commands = dict(DEFAULT_RUNNER_COMMANDS)
        self.verbose = bool(verbose)
        self.log_file = log_file.resolve() if log_file else (self.launcher_root / "skill-launcher.log")
        if runner_commands:
            for key, cmd in runner_commands.items():
                if isinstance(cmd, list) and all(isinstance(part, str) for part in cmd):
                    self.runner_commands[key] = cmd
        if self.verbose:
            self.log_file.parent.mkdir(parents=True, exist_ok=True)
            self._log("launcher_initialized", {
                "launcherRoot": str(self.launcher_root),
                "logFile": str(self.log_file),
            })

    def handle_payload(self, payload: Dict) -> Dict:
        self._log("incoming_payload", payload)
        action = _normalize_text(payload.get("action"))
        if action == "update-skills":
            runner = _normalize_text(payload.get("runner")) or "claude"
            skills_config = payload.get("skillsConfig") or {}
            summary = self.sync_skills(skills_config, runner)
            self._log("update_skills_result", summary)
            return {"success": True, "updated": summary}

        result = self.run_skill_runner(payload)
        self._log("run_skill_runner_result", result)
        return result

    def run_skill_runner(self, payload: Dict) -> Dict:
        runner = _normalize_text(payload.get("runner")) or "claude"
        prompt_arg = _normalize_text(payload.get("promptArg")) or "--prompt"
        prompt = _normalize_text(payload.get("prompt"))
        timeout_ms = int(payload.get("timeoutMs") or 120000)
        context = payload.get("context") or {}
        skills_config = payload.get("skillsConfig") or {}

        if not prompt:
            return {"success": False, "error": "Missing prompt"}

        sync_summary = self.sync_skills(skills_config, runner)
        command = self._build_command(runner, prompt_arg, prompt)
        skills_dir = self._runner_skills_dir(runner)

        env = os.environ.copy()
        env["SKILL_RUNNER_TYPE"] = runner
        env["SKILL_RUNNER_SKILLS_DIR"] = str(skills_dir)
        env["SKILL_RUNNER_WORKDIR"] = str(self.launcher_root)
        env["SKILL_RUNNER_CONTEXT"] = _json_dumps(context)
        source = context.get("source") if isinstance(context, dict) else {}
        session_info = {
            "url": source.get("url"),
            "title": source.get("title"),
            "cookies": source.get("cookies", []),
            "cookieHeader": source.get("cookieHeader", ""),
            "sessionStorageSnapshot": source.get("sessionStorageSnapshot", {}),
            "localStorageSnapshot": source.get("localStorageSnapshot", {}),
            "sessionInfoAllowed": source.get("sessionInfoAllowed", False),
        }
        env["SKILL_RUNNER_SESSION_INFO"] = _json_dumps(session_info)
        log_env = {
            key: env.get(key, "")
            for key in ("SKILL_RUNNER_TYPE", "SKILL_RUNNER_SKILLS_DIR", "SKILL_RUNNER_WORKDIR", "SKILL_RUNNER_CONTEXT", "SKILL_RUNNER_SESSION_INFO")
        }
        self._log("runner_invocation", {
            "runner": runner,
            "promptArg": prompt_arg,
            "command": command,
            "timeoutMs": timeout_ms,
            "env": log_env,
        })

        started = time.time()
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                env=env,
                cwd=str(self.launcher_root),
                timeout=max(5, timeout_ms / 1000.0),
            )
        except FileNotFoundError:
            self._log("runner_error", {"error": "command not found", "command": command})
            return {
                "success": False,
                "error": f"Runner command not found: {command[0]}",
                "command": command,
                "sync": sync_summary,
            }
        except subprocess.TimeoutExpired:
            self._log("runner_error", {"error": "timeout", "timeoutMs": timeout_ms, "command": command})
            return {
                "success": False,
                "error": f"Runner timed out after {timeout_ms} ms",
                "command": command,
                "sync": sync_summary,
            }
        except Exception as exc:
            self._log("runner_error", {"error": str(exc), "command": command})
            return {
                "success": False,
                "error": f"Runner execution failed: {exc}",
                "command": command,
                "sync": sync_summary,
            }

        duration_ms = int((time.time() - started) * 1000)
        stdout = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()

        if result.returncode != 0:
            self._log("runner_exit_nonzero", {
                "returncode": result.returncode,
                "stdout": stdout,
                "stderr": stderr,
                "durationMs": duration_ms,
            })
            return {
                "success": False,
                "error": f"Runner exited with code {result.returncode}",
                "stderr": stderr,
                "stdout": stdout,
                "command": command,
                "sync": sync_summary,
                "durationMs": duration_ms,
            }

        success_payload = {
            "success": True,
            "output": stdout or stderr,
            "command": command,
            "sync": sync_summary,
            "durationMs": duration_ms,
        }
        self._log("runner_exit_success", success_payload)
        return success_payload

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
