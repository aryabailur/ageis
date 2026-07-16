"""Exercises the actual "diversion -> replan" beat: validate_reservation's
freshness check (not the stale snapshot from ranking time) is what has to
notice the hospital went to DIVERSION, and replan has to release the
stale reservation before a second one can be booked under the same
call_id (reservations.call_id is unique).
"""

from __future__ import annotations

import itertools
import os

import pytest

from aegis_contracts import DispatchState, DispatchStatus
from app import reservation_store
from app.graph import compiled_app
from app.nodes import (
    compute_route_estimates,
    dispatch_lifecycle,
    gates,
    ingest_extract_triage,
    load_resources,
    rank_assignments,
)

DEMO_PATIENT_LAT = 42.3601
DEMO_PATIENT_LNG = -71.0589
CALL_ID = "call-diversion-replan-001"

requires_supabase = pytest.mark.skipif(
    not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured -- reserve_ambulance needs a real DB",
)


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


@pytest.fixture(autouse=True)
def clean_reservation_store():
    yield
    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        reservation_store.release(CALL_ID)


@requires_supabase
@pytest.mark.asyncio
async def test_hospital_diverting_mid_flight_triggers_replan_not_a_stale_dispatch(monkeypatch):
    """Simulates the exact scripted beat: the first hospital picked is
    diverted the instant we go to confirm it (validate_reservation's live
    recheck), so AEGIS must bounce to a different valid hospital and
    dispatch there instead -- with no human touching it."""
    call_count = itertools.count()

    async def fake_call_tool(base_url, tool_name, arguments):
        assert tool_name == "get_hospital_capacity"
        # First check: the originally-selected hospital just diverted.
        # Every check after that: it's fine (simulates the replanned pick).
        status = "DIVERSION" if next(call_count) == 0 else "OPEN"
        return {"status": status}

    monkeypatch.setattr(dispatch_lifecycle, "call_tool", fake_call_tool)

    app = compiled_app()
    initial = DispatchState(
        call_id=CALL_ID,
        raw_transcript="chest pain, left arm numb, not breathing right",
        caller_lat=DEMO_PATIENT_LAT,
        caller_lng=DEMO_PATIENT_LNG,
    )
    result = await app.ainvoke(initial)
    final = DispatchState.model_validate(result)

    assert final.status == DispatchStatus.COMPLETED
    assert final.replan_count == 1
    assert final.selected is not None
    assert final.reservation is not None
    assert final.reservation.hospital_id == final.selected.hospital.id
    assert final.reservation.ambulance_id == final.selected.ambulance.id


def test_after_validate_reservation_gate_routes_to_replan_on_diversion():
    """Unit-level check of the gate itself, independent of the full graph
    and Supabase: a fresh DIVERSION reading must route to replan (while
    replan budget remains), not to simulate_dispatch."""
    from aegis_contracts import Ambulance, CandidateAssignment, Hospital, Reservation

    candidate = CandidateAssignment(
        ambulance=Ambulance(id="unit-7", lat=0, lng=0, capability="ALS"),
        hospital=Hospital(id="hosp-cardiac-center", lat=0, lng=0, bed_count=3, specialties=["cardiac"], status="OPEN"),
        score=5.0,
    )
    state = DispatchState(
        call_id="unit-test-call",
        selected=candidate,
        reservation=Reservation(
            reservation_id="res-x",
            ambulance_id="unit-7",
            hospital_id="hosp-cardiac-center",
            idempotency_key="x",
            confirmed=True,
        ),
        hospital_status_at_validation="DIVERSION",
        replan_count=0,
        max_replans=2,
    )
    assert gates.after_validate_reservation(state) == "replan"

    state.replan_count = 2
    assert gates.after_validate_reservation(state) == "fail_safely"

    state.hospital_status_at_validation = "OPEN"
    state.replan_count = 0
    assert gates.after_validate_reservation(state) == "simulate_dispatch"
