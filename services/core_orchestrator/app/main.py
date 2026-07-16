"""Core orchestrator HTTP entrypoint. Kept as a thin FastAPI wrapper
around the LangGraph app so the dashboard (or any client) drives a full
dispatch with one call, while the graph itself stays runnable directly
from Python (see tests/) without any HTTP layer at all.
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from aegis_contracts import DispatchState

from .graph import compiled_app

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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
