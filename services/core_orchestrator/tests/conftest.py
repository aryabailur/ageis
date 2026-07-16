"""Spins up the two attached MCP microservices (hospital_ambulance_data,
routing) as real subprocesses on the ports declared in services.yaml, so
the orchestrator's end-to-end tests exercise genuine MCP round-trips
instead of mocks -- this is the "stub-swap" the master prompt calls for.
"""

from __future__ import annotations

import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

from app import mcp_client

REPO_ROOT = Path(__file__).resolve().parents[3]


def _wait_for_health(url: str, timeout_s: float = 15.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            resp = httpx.get(url, timeout=1.0)
            if resp.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(0.2)
    raise RuntimeError(f"Service at {url} did not become healthy in time")


def _port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


@pytest.fixture(scope="session", autouse=True)
def mcp_services():
    procs = []
    specs = [
        ("services/hospital_ambulance_data", 8001),
        ("services/routing", 8002),
    ]
    for rel_path, port in specs:
        if _port_in_use(port):
            continue  # already running (e.g. started manually for a demo)
        proc = subprocess.Popen(
            [sys.executable, "-m", "app.server"],
            cwd=str(REPO_ROOT / rel_path),
        )
        procs.append(proc)

    for _rel_path, port in specs:
        _wait_for_health(f"http://localhost:{port}/health")

    yield

    for proc in procs:
        proc.terminate()
        proc.wait(timeout=5)


@pytest.fixture(autouse=True)
async def close_mcp_sessions_after_each_test():
    """mcp_client caches one session per (base_url, event loop) (see its
    module docstring). pytest-asyncio hands every test function its own
    loop, so a session created during this test must be explicitly closed
    before that loop goes away -- otherwise Python's GC finalizes it later
    in whatever loop happens to be running, crashing with a cross-task
    cancel-scope error that has nothing to do with the test that trips it.
    """
    yield
    await mcp_client.close_sessions_for_current_loop()
