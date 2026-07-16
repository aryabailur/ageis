"""Core orchestrator HTTP entrypoint. Kept as a thin FastAPI wrapper
around the LangGraph app so the dashboard (or any client) drives a full
dispatch with one call, while the graph itself stays runnable directly
from Python (see tests/) without any HTTP layer at all.
"""

from __future__ import annotations

import os
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from aegis_contracts import DispatchState, load_default_registry
from aegis_contracts.supabase_client import get_client

from .graph import compiled_app
from .mcp_client import call_tool
from .run_batch import run_batch

app = FastAPI(title="AEGIS Core Orchestrator")

# The React dashboard calls this API directly from the browser. Dev-mode
# origins only; tighten this to the deployed dashboard's real origin
# before shipping anywhere non-local.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_graph_app = compiled_app()


class DispatchRequest(BaseModel):
    call_id: str
    raw_transcript: str
    caller_lat: float
    caller_lng: float


class HospitalStatusRequest(BaseModel):
    status: Literal["OPEN", "DIVERSION"]


@app.get("/health")
async def health():
    return {"status": "ok", "service": "core_orchestrator"}


@app.post("/dispatch")
async def dispatch(request: DispatchRequest):
    initial = DispatchState(
        call_id=request.call_id,
        raw_transcript=request.raw_transcript,
        caller_lat=request.caller_lat,
        caller_lng=request.caller_lng,
    )
    result = await _graph_app.ainvoke(initial)
    return DispatchState.model_validate(result).model_dump(mode="json")


@app.post("/dispatch/batch")
async def dispatch_batch(requests: list[DispatchRequest]):
    """Drives N calls concurrently against the shared fleet -- exercises
    the Supabase reservations table's ambulance_id uniqueness constraint
    under real concurrency, not just one call at a time."""
    incidents = [r.model_dump() for r in requests]
    results = await run_batch(incidents)
    return [DispatchState.model_validate(r).model_dump(mode="json") for r in results]


@app.get("/baseline")
async def naive_baseline(lat: float, lng: float):
    """Proxies get_nearest_ignoring_constraints for the dashboard (the
    browser can't speak MCP). Returns the deliberately-wrong naive
    nearest-to-nearest pick the demo compares AEGIS against."""
    registry = load_default_registry()
    service = registry.get("hospital_ambulance_data")
    try:
        return await call_tool(service.base_url, "get_nearest_ignoring_constraints", {"lat": lat, "lng": lng})
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"hospital_ambulance_data unreachable: {exc}") from exc


@app.post("/admin/hospitals/{hospital_id}/status")
async def set_hospital_status(hospital_id: str, request: HospitalStatusRequest):
    """Demo/ops trigger for the diversion -> replan beat: flips a
    hospital's live status directly in Supabase. validate_reservation
    re-checks this on every in-flight call, so flipping a hospital that's
    already reserved (but not yet dispatched) triggers a real replan."""
    result = (
        get_client()
        .table("hospitals")
        .update({"status": request.status})
        .eq("id", hospital_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"Unknown hospital_id: {hospital_id}")
    return result.data[0]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
