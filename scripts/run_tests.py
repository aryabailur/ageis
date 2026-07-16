"""Run every service's test suite. Each service's tests are independent
(the point of the microservice split), so a failure in one doesn't stop
the others from reporting.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SERVICE_DIRS = ["hospital_ambulance_data", "routing", "core_orchestrator"]


def main() -> int:
    failures = []
    for service in SERVICE_DIRS:
        service_dir = REPO_ROOT / "services" / service
        print(f"\n=== {service} ===")
        result = subprocess.run([sys.executable, "-m", "pytest", "tests/", "-q"], cwd=str(service_dir))
        if result.returncode != 0:
            failures.append(service)
    if failures:
        print(f"\nFAILED: {failures}")
        return 1
    print("\nAll service test suites passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
