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
from app.nodes import (
    compute_route_estimates,
    dispatch_lifecycle,
    ingest_extract_triage,
    load_resources,
    rank_assignments,
)

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

    for module in (
        ingest_extract_triage,
        load_resources,
        compute_route_estimates,
        rank_assignments,
        dispatch_lifecycle,
    ):
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

    assert final.prearrival is not None
    assert final.prearrival.protocol_id == "CPR_HANDS_ONLY"
    assert final.prearrival.metronome_bpm == 110

    # Whether this particular run crossed SPAWN_THRESHOLD depends on live
    # MCP timing (see test_rank_assignments.py for a deterministic version
    # of that decision) -- what must always hold is internal consistency:
    # spawned_workers and reverified_candidates agree on what happened.
    viable_count = len([c for c in final.candidates if not c.rejected])
    if final.spawned_workers > 0:
        assert final.spawned_workers == viable_count
        assert len(final.reverified_candidates) == viable_count
    else:
        assert final.reverified_candidates == []

    step_names = [entry.step for entry in final.timing_log]
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
        assert expected_step in step_names, f"missing timing_log entry for {expected_step}"
    # dispatch_prearrival_guidance must fire before any resource lookup --
    # help starts before an ambulance is even chosen.
    assert step_names.index("dispatch_prearrival_guidance") < step_names.index("load_resources")


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
