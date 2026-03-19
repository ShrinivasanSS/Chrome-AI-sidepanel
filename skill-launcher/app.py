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
        "--launcher-root",
        default=str(Path(__file__).parent.resolve()),
        help="Root directory for runner workdir and local tool folders (.claude/.copilot/.cursor)",
    )
    parser.add_argument(
        "--runtime-root",
        dest="launcher_root_compat",
        default=None,
        help="Deprecated alias for --launcher-root",
    )
    args = parser.parse_args()
    launcher_root = args.launcher_root_compat or args.launcher_root

    if args.mode == "native":
        run_native_host(launcher_root)
        return

    run_server(args.host, args.port, launcher_root)


if __name__ == "__main__":
    main()
