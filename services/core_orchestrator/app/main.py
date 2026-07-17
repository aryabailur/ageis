"""Core orchestrator HTTP entrypoint. Kept as a thin FastAPI wrapper
around the LangGraph app so the dashboard (or any client) drives a full
dispatch with one call, while the graph itself stays runnable directly
from Python (see tests/) without any HTTP layer at all.
"""

from __future__ import annotations

import json
import os
from typing import Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel

from aegis_contracts import (
    CandidateAssignment,
    DispatchState,
    DispatchStatus,
    Priority,
    TriageResult,
    load_default_registry,
)
from aegis_contracts.supabase_client import get_client

from . import review_store
from .graph import compiled_app, resume_from_reservation_graph, resume_from_resources_graph
from .mcp_client import call_tool
from .run_batch import run_batch
from .voice import conversation as voice_conversation
from .voice import session as voice_session
from .voice.socket import manager as voice_connection_manager
from .voice.phone_simulator import PHONE_SIMULATOR_HTML
from .voice.twilio_stream import handle_twilio_media_stream
from .voice.twilio_webhook import incoming_call_twiml

app = FastAPI(title="AEGIS Core Orchestrator")

# The React dashboard calls this API directly from the browser. Dev-mode
# origins only; allow all origins in dev/ngrok/mobile environments.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


class ReviewDecisionRequest(BaseModel):
    decision: Literal["APPROVE", "OVERRIDE"]
    # Intake-gate override: human supplies a corrected triage classification
    # (e.g. the UNKNOWN/low-confidence case in the review UI).
    triage_override: TriageResult | None = None
    # Assignment-gate override: human forces a specific candidate when no
    # candidate satisfied hard constraints on its own.
    selected_override: CandidateAssignment | None = None


def _merge_update(accumulated: DispatchState, partial: dict) -> DispatchState:
    """Applies one node's partial-state dict the same way LangGraph's own
    reducers would. Every field is plain last-write-wins EXCEPT
    reverified_candidates, which the contract (see models.py) marks
    Annotated[..., operator.add] so LangGraph concatenates each parallel
    reverify_candidate worker's single-item list instead of the last one
    clobbering the rest -- model_copy alone doesn't know about that
    reducer, so it's replicated here for this one field.

    Revalidates through model_validate rather than a bare model_copy: some
    node partials (e.g. gates.mark_awaiting_review) hand back plain string
    literals for enum fields, which LangGraph's own boundary validation
    normally coerces -- model_copy skips that, so without this the
    accumulated state's `status` could end up holding a raw str instead of
    a DispatchStatus."""
    if "reverified_candidates" in partial:
        partial = dict(partial)
        partial["reverified_candidates"] = accumulated.reverified_candidates + partial["reverified_candidates"]
    merged = accumulated.model_dump(mode="python")
    merged.update(partial)
    return DispatchState.model_validate(merged)


def _resume_graph_for(state: DispatchState):
    """Picks the resume entry point by which gate paused the call --
    mirrors the two review_reason strings gates.mark_awaiting_review
    produces. Re-running from the top would re-invoke extract_incident /
    apply_triage_rules and silently discard a human's triage override."""
    if state.selected is None and state.triage is not None and state.triage.priority != Priority.UNKNOWN:
        return resume_from_reservation_graph()
    return resume_from_resources_graph()


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


@app.post("/dispatch/stream")
async def dispatch_stream(request: DispatchRequest):
    """Same workflow as /dispatch, but emits one SSE event per LangGraph
    node as it completes instead of waiting for the whole run to finish --
    this is what lets the dashboard show live agent-reasoning progress
    instead of a single opaque spinner. Each event carries a full,
    validly-shaped DispatchState snapshot (not just the bare partial), so
    the frontend has one event contract to handle regardless of which
    node produced it."""

    async def event_stream():
        accumulated = DispatchState(
            call_id=request.call_id,
            raw_transcript=request.raw_transcript,
            caller_lat=request.caller_lat,
            caller_lng=request.caller_lng,
        )
        async for chunk in _graph_app.astream(accumulated, stream_mode="updates"):
            for node_name, partial in chunk.items():
                accumulated = _merge_update(accumulated, partial)
                payload = {"node": node_name, "state": accumulated.model_dump(mode="json")}
                yield f"data: {json.dumps(payload)}\n\n"

        if accumulated.status == DispatchStatus.AWAITING_REVIEW:
            review_store.save(accumulated)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/dispatch/{call_id}/review")
async def dispatch_review(call_id: str, request: ReviewDecisionRequest):
    """Resumes a call paused in AWAITING_REVIEW by a human Approve/Override
    decision. Resumes from load_resources or reserve_ambulance (never from
    the top) so a triage override survives instead of being overwritten by
    a fresh extract_incident/apply_triage_rules pass."""
    state = review_store.pop(call_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"No call awaiting review for call_id={call_id}")

    # Which gate paused this call is decided from the ORIGINAL paused state,
    # not the post-override one -- an override that sets selected_override
    # would otherwise make an intake-gate case look like an assignment-gate
    # case and resume from the wrong entry point.
    graph = _resume_graph_for(state)

    update: dict = {"review_reason": None, "status": DispatchStatus.IN_PROGRESS}
    if request.decision == "OVERRIDE":
        if request.triage_override is not None:
            update["triage"] = request.triage_override
        if request.selected_override is not None:
            update["selected"] = request.selected_override

    resumed_state = state.model_copy(update=update)
    result = await graph.ainvoke(resumed_state)
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


@app.get("/admin/fleet")
async def fleet_snapshot():
    """Unfiltered ambulance + hospital rows for the dashboard's live map
    and capacity panel -- distinct from get_eligible_* (which filter by
    triage requirements for a specific call) and get_nearest_ignoring_constraints
    (which returns only the single nearest of each). Reads Supabase
    directly, same as set_hospital_status below, since this is a plain
    admin/observability read with no protocol logic involved."""
    client = get_client()
    ambulances = client.table("ambulances").select("*").execute().data
    hospitals = client.table("hospitals").select("*").execute().data
    return {"ambulances": ambulances, "hospitals": hospitals}


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


# --- voice call intake: browser mic + Twilio phone call ------------------
#
# Everything below produces a live transcript for a human to review and
# explicitly submit through the EXISTING /dispatch/stream endpoint above --
# nothing here calls into triage, ranking, or dispatch on its own.


class BrowserTranscriptRequest(BaseModel):
    call_id: str
    text: str
    is_final: bool
    caller_number: str | None = None
    # When true, a final chunk also drives the AI conversation turn below --
    # the plain (non-AI) browser-mic flow used by IncomingCallCard leaves
    # this false and keeps its existing behavior untouched.
    conversation_mode: bool = False
    caller_lat: float | None = None
    caller_lng: float | None = None


@app.post("/voice/browser/transcript")
async def voice_browser_transcript(request: BrowserTranscriptRequest):
    """Receives one interim/final transcript chunk from the browser's
    Web Speech API (see useBrowserSpeechRecognition.ts) and broadcasts it
    to any connected dashboard over /voice/live -- the same event shape
    Twilio calls produce via twilio_stream.py, so the frontend has one
    single code path for rendering a live transcript regardless of
    which guest mode produced it."""
    if voice_session.get(request.call_id) is None:
        voice_session.start(request.call_id, source="browser", caller_number=request.caller_number)
        await voice_connection_manager.broadcast(
            {
                "type": "call_status",
                "call_id": request.call_id,
                "status": "in_progress",
                "caller_number": request.caller_number,
                "source": "browser",
            }
        )
    voice_session.append_transcript(request.call_id, request.text, is_final=request.is_final)
    await voice_connection_manager.broadcast(
        {
            "type": "transcript_update",
            "call_id": request.call_id,
            "text": request.text,
            "is_final": request.is_final,
            "source": "browser",
        }
    )

    ai_reply = None
    is_complete = False
    patient_details = {}

    if request.conversation_mode and request.is_final and request.text.strip():
        turn = await _run_conversation_turn(
            request.call_id,
            request.text,
            caller_lat=request.caller_lat,
            caller_lng=request.caller_lng,
        )
        ai_reply = turn.reply_text
        is_complete = turn.is_complete
        patient_details = turn.extracted

    return {
        "status": "ok",
        "ai_reply": ai_reply,
        "is_complete": is_complete,
        "patient_details": patient_details,
    }


async def _run_conversation_turn(
    call_id: str, user_utterance: str, *, caller_lat: float | None, caller_lng: float | None
):
    """Runs one AI-dispatcher turn (patient utterance -> AI reply +
    extraction) and broadcasts the AI's reply and the live extraction
    over the existing /voice/live socket. Once the AI decides it has
    enough information, broadcasts a `ready_for_dispatch` signal (with
    the caller's coordinates) instead of invoking the graph itself here
    -- the dashboard's App.tsx reacts to that signal by calling the
    SAME startDispatch action DispatchForm already uses against the
    EXISTING /dispatch/stream endpoint, so there is exactly one dispatch
    code path in this project, not two. This is the one deliberate place
    dispatch starts without a human clicking a button; it's always
    visibly bannered on the dashboard so it's never a silent action."""
    turn = voice_conversation.next_turn(call_id, user_utterance)

    await voice_connection_manager.broadcast(
        {
            "type": "transcript_update",
            "call_id": call_id,
            "text": turn.reply_text,
            "is_final": True,
            "source": "ai",
        }
    )
    await voice_connection_manager.broadcast(
        {
            "type": "patient_extraction",
            "call_id": call_id,
            "patient_details": turn.extracted,
            "is_complete": turn.is_complete,
        }
    )

    session = voice_session.get(call_id)

    # Trigger early dispatch side-by-side as soon as we know the chief complaint
    # so the rest of the agents can start working while the AI voice assistant
    # continues asking follow-up questions.
    has_initial_emergency = turn.extracted.get("symptoms") or turn.extracted.get("emergency_type")
    if session and has_initial_emergency and not session.dispatched:
        session.dispatched = True
        await voice_connection_manager.broadcast(
            {
                "type": "call_status",
                "call_id": call_id,
                "ready_for_dispatch": True,
                "raw_transcript": session.transcript,
                "caller_lat": caller_lat,
                "caller_lng": caller_lng,
            }
        )

    if not turn.is_complete:
        return turn

    # When the conversation is fully complete (all questions answered), we end
    # the conversation loop. If we already dispatched early, we don't need to
    # dispatch again.
    voice_conversation.end(call_id)
    return turn


@app.post("/voice/browser/{call_id}/end")
async def voice_browser_end(call_id: str):
    """Browser-mic equivalent of Twilio's "stop" event -- marks the
    session ended so the Incoming Call card can show a final duration."""
    ended = voice_session.end(call_id)
    await voice_connection_manager.broadcast(
        {
            "type": "call_status",
            "call_id": call_id,
            "status": "ended",
            "ready_for_dispatch": True,
            "raw_transcript": ended.transcript if ended else "",
            "duration_s": ended.duration_s if ended else None,
            "source": "browser",
        }
    )
    return {"status": "ok"}


@app.websocket("/voice/live")
async def voice_live(websocket: WebSocket):
    """The dashboard connects here once and receives every transcript_update
    / call_status event broadcast by either capture mode -- the FastAPI-native
    equivalent of a Socket.io room, since this backend has no Node/Socket.io
    process to run one in."""
    await voice_connection_manager.connect(websocket)
    try:
        while True:
            # The dashboard doesn't send anything over this socket today;
            # this just keeps the connection open and detects disconnects.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        voice_connection_manager.disconnect(websocket)


@app.post("/voice/twilio/incoming-call")
async def voice_twilio_incoming_call():
    """Twilio's webhook for an incoming call to the configured phone
    number. Returns TwiML pointing Twilio at /voice/twilio/stream to
    open a Media Streams websocket -- see twilio_webhook.py."""
    return PlainTextResponse(content=incoming_call_twiml(), media_type="text/xml")


@app.websocket("/voice/twilio/stream")
async def voice_twilio_stream(websocket: WebSocket):
    """Twilio's Media Streams websocket target -- see twilio_stream.py
    for the connected/start/media/stop protocol handling and the
    Deepgram relay."""
    await handle_twilio_media_stream(websocket)


@app.get("/voice/phone-simulator")
async def voice_phone_simulator():
    """Dev/test-only page (not linked from the dashboard): lets any
    phone's own browser simulate an inbound Twilio call by streaming its
    real microphone to /voice/twilio/stream using Twilio's exact wire
    protocol -- for testing the Twilio code path without owning a
    Twilio phone number. Load over the public tunnel URL (mic access
    needs a secure/HTTPS context off localhost)."""
    return HTMLResponse(content=PHONE_SIMULATOR_HTML)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
