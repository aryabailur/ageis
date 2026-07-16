"""The scenario the master prompt calls out as the one to run first
during integration: it exercises triage, both MCP services, ranking,
reservation, and completion in one pass, with zero human review — Design
Law 2's "autonomous by default" claim, proven end to end.
"""

from __future__ import annotations

import itertools
import os

import pytest

from aegis_contracts import DispatchState, DispatchStatus, Priority
from app import reservation_store
from app.graph import compiled_app
from app.nodes import compute_route_estimates, dispatch_lifecycle, ingest_extract_triage, load_resources

DEMO_PATIENT_LAT = 42.3601
DEMO_PATIENT_LNG = -71.0589

requires_supabase = pytest.mark.skipif(
    not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured -- reserve_ambulance needs a real DB",
)


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    counter = itertools.count()

    def fake_clock():
        return next(counter) * 0.01

    for module in (ingest_extract_triage, load_resources, compute_route_estimates, dispatch_lifecycle):
        monkeypatch.setattr(module, "clock", fake_clock)
    yield


CLEAN_CARDIAC_CALL_ID = "call-clean-cardiac-001"
GARBLED_CALL_ID = "call-garbled-002"

SUPABASE_CONFIGURED = bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))


@pytest.fixture(autouse=True)
def clean_reservation_store():
    yield
    if SUPABASE_CONFIGURED:
        reservation_store.release(CLEAN_CARDIAC_CALL_ID)
        reservation_store.release(GARBLED_CALL_ID)


@requires_supabase
@pytest.mark.asyncio
async def test_clean_cardiac_dispatch_reaches_completed_with_no_human_review():
    app = compiled_app()
    initial = DispatchState(
        call_id=CLEAN_CARDIAC_CALL_ID,
        raw_transcript="chest pain, left arm numb, not breathing right",
        caller_lat=DEMO_PATIENT_LAT,
        caller_lng=DEMO_PATIENT_LNG,
    )

    result = await app.ainvoke(initial)
    final = DispatchState.model_validate(result)

    assert final.status == DispatchStatus.COMPLETED
    assert final.review_reason is None
    assert final.triage.priority == Priority.P1
    assert "RULE_CARDIAC_NOT_BREATHING" in final.triage.rule_ids

    assert final.selected is not None
    assert final.selected.ambulance.capability == "ALS"
    assert "cardiac" in final.selected.hospital.specialties

    assert final.reservation is not None
    assert final.reservation.confirmed

    step_names = [entry.step for entry in final.timing_log]
    for expected_step in (
        "ingest_call",
        "extract_incident",
        "apply_triage_rules",
        "load_resources",
        "compute_route_estimates",
        "rank_assignments",
        "validate_proposal",
        "reserve_ambulance",
        "validate_reservation",
        "simulate_dispatch",
        "monitor_or_finish",
    ):
        assert expected_step in step_names, f"missing timing_log entry for {expected_step}"


@pytest.mark.asyncio
async def test_garbled_transcript_escalates_to_human_review():
    app = compiled_app()
    initial = DispatchState(
        call_id=GARBLED_CALL_ID,
        raw_transcript="[static] can't hear you [inaudible]",
        caller_lat=DEMO_PATIENT_LAT,
        caller_lng=DEMO_PATIENT_LNG,
    )

    result = await app.ainvoke(initial)
    final = DispatchState.model_validate(result)

    assert final.status == DispatchStatus.AWAITING_REVIEW
    assert final.review_reason is not None
    assert final.selected is None
    assert final.reservation is None
