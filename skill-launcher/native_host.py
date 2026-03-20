import json
import struct
import sys
from pathlib import Path

from launcher_core import SkillLauncher


def _read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack("<I", raw_length)[0]
    message_bytes = sys.stdin.buffer.read(message_length)
    return json.loads(message_bytes.decode("utf-8"))


def _write_message(message):
    encoded = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def run_native_host(launcher_root: str, verbose: bool = False, log_file: str = None):
    launcher = SkillLauncher(
        Path(launcher_root),
        verbose=verbose,
        log_file=Path(log_file) if log_file else None,
    )
    while True:
        message = _read_message()
        if message is None:
            break
        try:
            result = launcher.handle_payload(message or {})
        except Exception as exc:
            result = {"success": False, "error": str(exc)}
        _write_message(result)
