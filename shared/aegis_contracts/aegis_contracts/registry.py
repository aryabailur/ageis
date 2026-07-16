"""The plugin mechanism: a microservice is "attached" by adding one entry
to services.yaml (or setting one env var override) — no core code changes.

Any service in the system (core-orchestrator, dashboard, a future service)
loads the same registry and asks for a peer by name or by the MCP tool it
claims to expose. This keeps the "attach like plugins" property real: the
orchestrator never hardcodes a hostname, only a service name / tool name.
"""

from __future__ import annotations

import os
from pathlib import Path

import yaml
from pydantic import BaseModel


class ServiceManifestEntry(BaseModel):
    name: str
    base_url: str
    kind: str  # "mcp" | "http" | "ui"
    health_path: str = "/health"
    tools: list[str] = []


class ServiceRegistry:
    def __init__(self, entries: dict[str, ServiceManifestEntry]):
        self._entries = entries

    @classmethod
    def load(cls, manifest_path: str | Path) -> "ServiceRegistry":
        path = Path(manifest_path)
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        entries: dict[str, ServiceManifestEntry] = {}
        for item in raw.get("services", []):
            entry = ServiceManifestEntry.model_validate(item)
            env_override = os.environ.get(f"AEGIS_SERVICE_{entry.name.upper()}_URL")
            if env_override:
                entry.base_url = env_override
            entries[entry.name] = entry
        return cls(entries)

    def get(self, name: str) -> ServiceManifestEntry:
        if name not in self._entries:
            raise KeyError(
                f"No service named '{name}' is attached. "
                f"Known services: {sorted(self._entries)}. "
                "Add it to services.yaml to attach it."
            )
        return self._entries[name]

    def resolve_tool(self, tool_name: str) -> ServiceManifestEntry:
        for entry in self._entries.values():
            if tool_name in entry.tools:
                return entry
        raise KeyError(f"No attached service exposes tool '{tool_name}'.")

    def all(self) -> list[ServiceManifestEntry]:
        return list(self._entries.values())


def default_manifest_path() -> Path:
    """services.yaml at the repo root, resolved relative to this file so it
    works no matter which service process imports it."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "services.yaml"
        if candidate.exists():
            return candidate
    raise FileNotFoundError("Could not locate services.yaml above " + str(here))


def load_default_registry() -> ServiceRegistry:
    return ServiceRegistry.load(default_manifest_path())
