"""Run every attached microservice locally, no Docker required. Reads
ports straight out of services.yaml -- the same plugin registry every
service uses at runtime -- so adding a new service to that file also
makes it start here automatically.
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
NPM = "npm.cmd" if sys.platform == "win32" else "npm"

RUN_COMMANDS = {
    "hospital_ambulance_data": [sys.executable, "-m", "app.server"],
    "routing": [sys.executable, "-m", "app.server"],
    "core_orchestrator": [sys.executable, "-m", "app.main"],
    "dashboard": [NPM, "run", "dev"],
}


def main() -> None:
    manifest = yaml.safe_load((REPO_ROOT / "services.yaml").read_text(encoding="utf-8"))
    procs = []
    try:
        for entry in manifest["services"]:
            name = entry["name"]
            if name not in RUN_COMMANDS:
                continue
            port = urlparse(entry["base_url"]).port
            print(f"starting {name} on port {port}...")
            proc = subprocess.Popen(RUN_COMMANDS[name], cwd=str(REPO_ROOT / "services" / name))
            procs.append((name, entry, proc))

        for name, entry, _proc in procs:
            if entry["kind"] == "ui":
                continue
            _wait_for_health(name, entry["base_url"] + entry["health_path"])

        print("\nAll services attached. Dashboard: http://localhost:5173")
        print("Press Ctrl+C to stop everything.\n")
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for _name, _entry, proc in procs:
            proc.terminate()
        for _name, _entry, proc in procs:
            proc.wait(timeout=5)


def _wait_for_health(name: str, url: str, timeout_s: float = 20.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            if httpx.get(url, timeout=1.0).status_code == 200:
                print(f"  {name} healthy")
                return
        except Exception:
            pass
        time.sleep(0.3)
    raise RuntimeError(f"{name} did not become healthy at {url}")


if __name__ == "__main__":
    main()
