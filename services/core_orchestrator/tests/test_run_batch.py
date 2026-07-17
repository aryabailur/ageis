"""run_batch's whole point is proving double-booking is impossible under
real concurrency, not just "the code looks like it prevents it". Fires
several calls at once, all competing for the same small fleet, and checks
Supabase's own unique constraint is what kept them from colliding.
"""

from __future__ import annotations

import itertools
import os

import pytest

from aegis_contracts import DispatchState, DispatchStatus
from app import reservation_store
from app.nodes import compute_route_estimates, dispatch_lifecycle, ingest_extract_triage, load_resources, rank_assignments
from app.run_batch import run_batch

DEMO_PATIENT_LAT = 19.0596
DEMO_PATIENT_LNG = 72.8295

requires_supabase = pytest.mark.skipif(
    not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured -- reserve_ambulance needs a real DB",
)

BATCH_CALL_IDS = [f"call-batch-{i:03d}" for i in range(5)]


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
        for call_id in BATCH_CALL_IDS:
            reservation_store.release(call_id)


@requires_supabase
@pytest.mark.asyncio
async def test_concurrent_batch_never_double_books_an_ambulance():
    incidents = [
        {
            "call_id": call_id,
            "raw_transcript": "chest pain, left arm numb, not breathing right",
            "caller_lat": DEMO_PATIENT_LAT,
            "caller_lng": DEMO_PATIENT_LNG,
        }
        for call_id in BATCH_CALL_IDS
    ]

    results = await run_batch(incidents)
    assert all(r is not None for r in results), "no incident should raise out of the batch"

    booked_ambulance_ids = [r.reservation.ambulance_id for r in results if r.reservation is not None]
    assert len(booked_ambulance_ids) == len(set(booked_ambulance_ids)), (
        "the same ambulance was reserved for two different calls -- "
        "the fleet only has 2 ALS units, so some calls should fail "
        "safely or await review rather than double-book"
    )

    # With only 2 ALS ambulances available and 5 concurrent cardiac calls,
    # not everyone can get dispatched -- that's expected and correct.
    # What matters is nobody got a duplicate/conflicting reservation.
    statuses = {r.status for r in results}
    assert statuses <= {DispatchStatus.COMPLETED, DispatchStatus.FAILED, DispatchStatus.AWAITING_REVIEW}
