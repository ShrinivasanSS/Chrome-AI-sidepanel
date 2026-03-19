import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict

from launcher_core import SkillLauncher


class SkillLauncherHandler(BaseHTTPRequestHandler):
    launcher: SkillLauncher = None

    def _write_json(self, payload: Dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            self._write_json({"status": "ok"})
            return
        self._write_json({"error": "Not found"}, status=404)

    def do_POST(self):  # noqa: N802
        if self.path not in ("/run", "/update-skills"):
            self._write_json({"error": "Not found"}, status=404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            self._write_json({"success": False, "error": f"Invalid JSON: {exc}"}, status=400)
            return

        if self.path == "/update-skills":
            payload["action"] = "update-skills"

        result = self.launcher.handle_payload(payload)
        status = 200 if result.get("success", False) else 500
        self._write_json(result, status=status)


def run_server(host: str, port: int, launcher_root: str) -> None:
    launcher = SkillLauncher(Path(launcher_root))
    handler_type = type("BoundSkillLauncherHandler", (SkillLauncherHandler,), {})
    handler_type.launcher = launcher
    server = ThreadingHTTPServer((host, port), handler_type)
    print(f"Skill launcher server listening on http://{host}:{port}")
    server.serve_forever()
