"""Template for a new AEGIS plugin microservice. Copy this whole
directory, rename it, then:

1. Rename the FastMCP name below and implement your tool(s) in logic.py.
2. Add an entry to /services.yaml with this service's name, base_url,
   and the list of tool names it exposes.
3. Any node in core-orchestrator (or any other service) can now reach it
   via `aegis_contracts.load_default_registry().get("<your-service-name>")`
   -- no other code changes required to "attach" it.
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

PORT = int(os.environ.get("PORT", "8099"))

mcp = FastMCP("template-new-service", host="0.0.0.0", port=PORT)


@mcp.custom_route("/health", methods=["GET"])
async def health(_: Request) -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "template_new_service"})


@mcp.tool()
def example_tool(x: int) -> dict:
    """Replace with your real tool(s). Keep them deterministic where the
    master prompt's Design Law 1 applies -- push any LLM use to a
    dedicated extraction/complexity-check step, never into scoring or
    validation logic."""
    return {"result": x * 2, "data_source": "template_new_service"}


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
