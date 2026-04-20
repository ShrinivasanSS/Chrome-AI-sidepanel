import argparse
from pathlib import Path

from native_host import run_native_host
from remote_server import run_server


def main():
    parser = argparse.ArgumentParser(description="Skill launcher backend for Chrome AI sidepanel extension")
    parser.add_argument("--mode", choices=["remote", "native"], default="remote")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7070)
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose JSONL request/runner logging",
    )
    parser.add_argument(
        "--log-file",
        default=None,
        help="Optional log file path (default: <launcher-root>/skill-launcher.log)",
    )
    parser.add_argument(
        "--launcher-root",
        default=str(Path(__file__).parent.resolve()),
        help="Root directory for runner workdir and local tool folders (.claude/.copilot/.cursor)",
    )
    parser.add_argument(
        "--workdir",
        default=None,
        help="Working directory for runner subprocesses (default: launcher-root). "
             "Set to a parent directory if the runner needs to find .agents or .claude config folders.",
    )
    parser.add_argument(
        "--runtime-root",
        dest="launcher_root_compat",
        default=None,
        help="Deprecated alias for --launcher-root",
    )
    args = parser.parse_args()
    launcher_root = args.launcher_root_compat or args.launcher_root
    log_file = args.log_file
    workdir = args.workdir

    if args.mode == "native":
        run_native_host(launcher_root, verbose=args.verbose, log_file=log_file, workdir=workdir)
        return

    run_server(args.host, args.port, launcher_root, verbose=args.verbose, log_file=log_file, workdir=workdir)


if __name__ == "__main__":
    main()
