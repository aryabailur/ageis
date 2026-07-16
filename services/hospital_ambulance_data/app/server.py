"""Hospital + Ambulance data MCP microservice.

Exposes get_eligible_ambulances / get_eligible_hospitals /
get_hospital_capacity / set_hospital_status /
get_relocation_recommendations / get_nearest_ignoring_constraints as real
MCP tools over streamable-http, so any MCP-speaking client (the
core-orchestrator, an IDE, a future service) can attach to it purely by URL
— no shared code required beyond the MCP protocol itself.
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import logic

PORT = int(os.environ.get("PORT", "8001"))

mcp = FastMCP("hospital-ambulance-data", host="0.0.0.0", port=PORT)


@mcp.custom_route("/health", methods=["GET"])
async def health(_: Request) -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "hospital_ambulance_data"})


@mcp.tool()
def get_eligible_ambulances(
    lat: float, lng: float, requires_als: bool = False, max_radius_km: float = 15.0
) -> list[dict]:
    """Return available ambulances near (lat, lng), optionally filtered to
    ALS-capable units only, sorted nearest first."""
    return logic.eligible_ambulances(lat, lng, requires_als, max_radius_km)


@mcp.tool()
def get_eligible_hospitals(
    lat: float, lng: float, required_specialty: str | None = None, max_radius_km: float = 25.0
) -> list[dict]:
    """Return open hospitals with beds near (lat, lng), optionally filtered
    to a required specialty (e.g. 'cardiac'), sorted nearest first."""
    return logic.eligible_hospitals(lat, lng, required_specialty, max_radius_km)


@mcp.tool()
def get_hospital_capacity(hospital_id: str) -> dict:
    """Return live bed count / status / specialties for one hospital."""
    return logic.hospital_capacity(hospital_id)


@mcp.tool()
def set_hospital_status(hospital_id: str, status: str) -> dict:
    """Set a hospital to OPEN or DIVERSION and return its updated row."""
    return logic.set_hospital_status(hospital_id, status)


@mcp.tool()
def get_relocation_recommendations(
    max_recommendations: int = 3, max_relocation_km: float = 15.0
) -> dict:
    """Recommend advisory staging targets for idle ambulances based on
    rolling seven-day demand-zone counts. Does not move or reserve units;
    callers must revalidate a recommendation before acting on it."""
    return logic.relocation_recommendations(max_recommendations, max_relocation_km)


@mcp.tool()
def get_nearest_ignoring_constraints(lat: float, lng: float) -> dict:
    """Naive nearest-to-nearest baseline with no capability/status
    filtering at all — used only for the demo's quantified comparison
    against AEGIS's constraint-aware ranking."""
    return logic.nearest_ignoring_constraints(lat, lng)


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
