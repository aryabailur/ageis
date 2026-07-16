"""Routing MCP microservice: exposes get_route_estimate over
streamable-http, with a live-provider -> Haversine fallback ladder baked
in (see logic.py). The signature never changes as providers are swapped.
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import logic

PORT = int(os.environ.get("PORT", "8002"))

mcp = FastMCP("routing", host="0.0.0.0", port=PORT)


@mcp.custom_route("/health", methods=["GET"])
async def health(_: Request) -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "routing"})


@mcp.tool()
def get_route_estimate(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    traffic_aware: bool = True,
) -> dict:
    """Traffic-aware ETA + distance between two points. Falls back to a
    labeled Haversine + average-speed estimate when no live provider is
    configured or the live call fails."""
    return logic.route_estimate(origin_lat, origin_lng, dest_lat, dest_lng, traffic_aware)


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
