"""Covers /dispatch/stream's node-by-node SSE progress: the dashboard's
live agent-reasoning panel depends on receiving one event per LangGraph
node, each carrying a fully valid accumulated DispatchState (not just the
bare partial), in the order the graph actually executed them.
"""

from __future__ import annotations

import itertools
import os

import pytest

from aegis_contracts import DispatchState, DispatchStatus
from app.graph import compiled_app
from app.nodes import compute_route_estimates, dispatch_lifecycle, ingest_extract_triage, load_resources, rank_assignments

requires_supabase = pytest.mark.skipif(
    not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured -- reserve_ambulance needs a real DB",
)

DEMO_PATIENT_LAT = 19.0596
DEMO_PATIENT_LNG = 72.8295


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    counter = itertools.count()

    def fake_clock():
        return next(counter) * 0.01

    for module in (
        ingest_extract_triage,
        load_resources,
        compute_route_estimates,
        rank_assignments,
        dispatch_lifecycle,
    ):
        monkeypatch.setattr(module, "clock", fake_clock)
    yield


async def _collect_stream_events(initial: DispatchState) -> list[tuple[str, DispatchState]]:
    """Mirrors the merge logic in app.main.dispatch_stream/_merge_update
    without going through the HTTP layer, matching how every other test
    in this suite exercises the graph directly rather than via TestClient."""
    from app.main import _merge_update

    app = compiled_app()
    accumulated = initial
    events: list[tuple[str, DispatchState]] = []
    async for chunk in app.astream(initial, stream_mode="updates"):
        for node_name, partial in chunk.items():
            accumulated = _merge_update(accumulated, partial)
            events.append((node_name, accumulated))
    return events


@pytest.mark.asyncio
async def test_garbled_transcript_streams_intake_nodes_then_await_review():
    initial = DispatchState(
        call_id="call-stream-garbled-001",
        raw_transcript="[static] can't hear you [inaudible]",
        caller_lat=DEMO_PATIENT_LAT,
        caller_lng=DEMO_PATIENT_LNG,
    )
    events = await _collect_stream_events(initial)
    node_order = [node for node, _ in events]

    assert node_order == [
        "ingest_call",
        "extract_incident",
        "apply_triage_rules",
        "dispatch_prearrival_guidance",
        "await_review",
    ]
    # Every event's accumulated state must be well-formed at every step.
    for _, state in events:
        DispatchState.model_validate(state.model_dump(mode="json"))

    final_node, final_state = events[-1]
    assert final_node == "await_review"
    assert final_state.status == DispatchStatus.AWAITING_REVIEW
    assert final_state.review_reason is not None


@requires_supabase
@pytest.mark.asyncio
async def test_clean_cardiac_call_streams_every_node_through_completion():
    initial = DispatchState(
        call_id="call-stream-clean-cardiac-001",
        raw_transcript="chest pain, left arm numb, not breathing right",
        caller_lat=DEMO_PATIENT_LAT,
        caller_lng=DEMO_PATIENT_LNG,
    )
    try:
        events = await _collect_stream_events(initial)
    finally:
        from app import reservation_store

        reservation_store.release("call-stream-clean-cardiac-001")

    node_order = [node for node, _ in events]
    for expected_step in (
        "ingest_call",
        "extract_incident",
        "apply_triage_rules",
        "dispatch_prearrival_guidance",
        "load_resources",
        "compute_route_estimates",
        "rank_assignments",
        "finalize_ranking",
        "validate_proposal",
        "reserve_ambulance",
        "validate_reservation",
        "simulate_dispatch",
        "monitor_or_finish",
    ):
        assert expected_step in node_order, f"missing SSE event for node {expected_step}"

    final_node, final_state = events[-1]
    assert final_node == "monitor_or_finish"
    assert final_state.status == DispatchStatus.COMPLETED
